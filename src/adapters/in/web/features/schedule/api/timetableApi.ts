/**
 * 시간표 데이터 로딩 (features/schedule/api) — 화면 코드는 fetch·IndexedDB 를 직접 부르지 않는다(스킬 §5).
 *
 * 데이터 URL 은 `docs/01 §6` 대로 Pages 가 앱 번들과 함께 서빙하는 `data/timetable.json` 이다.
 * `vite.config.ts` 의 `base: './'` 때문에 **상대 경로**로 요청해야 하위 경로 배포에서도 맞는다.
 *
 * 두 가지 로딩 경로
 * 1. `fetchTimetableModel` — 네트워크 전용(기존 계약 유지). 실패는 `TimetableDataError` 로 던진다.
 * 2. `loadTimetableModel` — **캐시 계층 포함**(T6 · docs/01 §5):
 *    · 캐시를 먼저 읽어 두고(파싱 실패·스키마 불일치·읽기 실패는 "없음"),
 *    · 네트워크 성공 → 계약 파싱 → 캐시에 저장(실패해도 화면은 진행)
 *    · 네트워크 실패 + 캐시 있음 → **마지막 정상 데이터**를 돌려준다(AC-5). 만료(≥24h)면 `cache-expired`.
 *    · 양쪽 다 없음 → 던진다(화면은 F8 오류 배너를 띄운다 — 빈 화면 금지).
 *    캐시 폴백 경로는 **예외를 던지지 않으므로** 호출부(mount)가 콘솔 error 를 찍지 않는다(AC-5 콘솔 오류 0).
 */
import { timetableCacheAge } from '../../../../../../application/cache/timetableCachePolicy';
import type { CachedTimetableEntry, TimetableCachePort } from '../../../../../../ports/timetable_cache';
import { parseTimetable, TimetableDataError } from '../data/normalize';
import type { TimetableModel } from '../types/model';

/** 앱이 읽는 계약 데이터 경로(상대) */
export const TIMETABLE_PATH = './data/timetable.json';

/**
 * Android 앱(Capacitor)이 데이터를 받는 **원격 주소** — GitHub Pages 의 발행본(docs/07 §17, 2026-11-08 사용자 결정 B).
 * 앱은 화면(웹 번들)을 APK 안에 갖고 있어 상대 경로(`TIMETABLE_PATH`)가 **앱 안의 빌드 시점 사본**을 가리킨다
 * → 그대로 두면 시간표·학사일정이 재빌드 전까지 고정된다. 앱에서는 이 주소를 먼저 읽고,
 *   실패하면 마지막 캐시 → 앱에 들어 있는 사본(`TIMETABLE_PATH`) 순으로 물러선다.
 * Pages 는 `access-control-allow-origin: *` 로 응답한다(2026-11-08 실측) → 앱 출처(https://localhost)에서 그대로 받는다.
 */
export const REMOTE_TIMETABLE_URL = 'https://angalle.github.io/sunmoon-shuttle/data/timetable.json';

/**
 * 앱이 **캐시에서 읽어도 되는** 계약 스키마 버전 목록.
 *
 * `data/timetable.json`(발행물)과 파서(`normalize.ts`)는 함께 배포되므로, 넣는 기준은
 * "그 발행물을 이 파서가 온전히 읽는가" 다.
 *  - `1` — 최초 계약(표·안내문)
 *  - `2` — T16 이 넓힌 계약(`dateRules[]`·`terms[]`·`routes[].tripNotes[]`·`stopWindows[]`).
 *    파서는 이 배열들을 **선택**으로 읽는다(키가 없거나 배열이 아니면 `[]` — normalize.ts 주석)
 *    → v1 파일도 같은 파서로 그대로 동작한다(무중단 하위호환).
 *  - `3` — T21 이 넓힌 계약(`routes[].byDay[*].trips[].service`·`durationMinutes`·`unknownNote`·
 *    `needsReview`, `terms[].periodSearch`, `source.extraction.schemaVersion`). 파서는 편별 조건을
 *    아직 읽지 않지만(v3 표시는 T22), 발행물을 **읽어 렌더하는 데는 문제가 없다**(모르는 키는 무시).
 *
 * 목록 밖(더 높은) 버전의 캐시는 버린다 — 마이그레이션 없음(`ports/timetable_cache.ts` 계약).
 *
 * ⚠️ **발행물의 스키마 버전을 올릴 때는 이 목록도 같이 올려야 한다**(T18 회귀): T16 이 데이터를 v2 로
 * 발행했는데 이 게이트가 v1 만 통과시켜, 캐시가 저장은 되지만 읽히지 않아 **수집 실패 폴백(AC-5)이
 * 통째로 죽었다**(`npm run verify:offline` FAIL 5건). 목록을 늘리지 않으면 캐시 폴백이 조용히 사라진다.
 * → 미지원 버전 RED 테스트: `tests/extract/consumer-gate.test.ts`(발행물 version ∈ 목록 검사).
 */
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1, 2, 3];

/** 현재 계약의 스키마 버전(= 지원 목록의 최신). 캐시 게이트는 이 값이 아니라 **목록**으로 판정한다. */
export const SUPPORTED_SCHEMA_VERSION = 3;

export type FetchLike = (input: string) => Promise<Response>;

const defaultFetch: FetchLike = (input) => fetch(input);

/** 계약 JSON 을 받아 뷰모델로 파싱한다. 실패는 원인을 담은 `TimetableDataError` 로 올린다. */
export async function fetchTimetableModel(
  fetchImpl: FetchLike = defaultFetch,
  path: string = TIMETABLE_PATH,
): Promise<TimetableModel> {
  return parseTimetable(await fetchContractJson(fetchImpl, path));
}

/** 데이터 출처 — 화면이 "오프라인/노후 캐시" 를 구분해 표시하는 근거. */
export type TimetableSource = 'network' | 'cache' | 'cache-expired';

export interface LoadedTimetable {
  readonly model: TimetableModel;
  readonly source: TimetableSource;
  /** 캐시에서 왔을 때의 저장 시각(ms). 네트워크면 null */
  readonly cachedAtMs: number | null;
  /** 캐시에서 왔을 때의 나이(ms, ≥0). 네트워크면 null */
  readonly cacheAgeMs: number | null;
  /** 캐시로 폴백한 경우의 네트워크 실패 원인(화면 문구용). 네트워크 성공이면 null */
  readonly networkError: string | null;
}

export interface LoadTimetableOptions {
  readonly fetchImpl?: FetchLike | undefined;
  readonly path?: string | undefined;
  /** 캐시 포트(주입). `null`/미지정이면 캐시 없이 동작(기존 경로). */
  readonly cache?: TimetableCachePort | null | undefined;
  /** 저장·만료 판정에 쓸 시각(주입된 Clock). 기본은 시스템 시각. */
  readonly nowMs?: (() => number) | undefined;
  /**
   * 네트워크·캐시가 모두 없을 때 마지막으로 읽을 **번들 사본** 경로(Android 앱: `TIMETABLE_PATH`).
   * 미지정이면 기존처럼 오류를 던진다(웹은 `path` 자체가 같은 출처라 물러설 곳이 없다).
   */
  readonly fallbackPath?: string | undefined;
}

/** 캐시 계층을 포함한 로딩(캐시 우선 보관 + 네트워크 실패 시 폴백). */
export async function loadTimetableModel(options: LoadTimetableOptions = {}): Promise<LoadedTimetable> {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const path = options.path ?? TIMETABLE_PATH;
  const cache = options.cache ?? null;
  const readNowMs = options.nowMs ?? (() => Date.now());

  // ① 캐시 읽기 — `read()` 는 던지지 않는다(어댑터 계약). 깨진 캐시는 없는 것으로 본다.
  const cached = cache === null ? null : await cache.read();
  const cachedModel = cached === null ? null : parseCached(cached);

  // ② 네트워크 재검증
  try {
    const raw = await fetchContractJson(fetchImpl, path);
    const model = parseTimetable(raw);
    if (cache !== null) {
      // 저장은 기다리지 않는다(화면 표시를 캐시 I/O 로 늦추지 않는다). 실패해도 조용히 넘어간다.
      void cache.write(
        {
          raw,
          contentHash: model.source.contentHash,
          fetchedAt: model.source.fetchedAt,
          schemaVersion: model.schemaVersion,
        },
        readNowMs(),
      );
    }
    return { model, source: 'network', cachedAtMs: null, cacheAgeMs: null, networkError: null };
  } catch (error) {
    const networkError = messageOf(error);
    // ③ 폴백: 마지막 정상 데이터(만료됐어도 유지 — docs/01 §5 "실패해도 캐시 유지")
    if (cached !== null && cachedModel !== null) {
      const age = timetableCacheAge(cached.cachedAtMs, readNowMs());
      return {
        model: cachedModel,
        source: age.expired ? 'cache-expired' : 'cache',
        cachedAtMs: cached.cachedAtMs,
        cacheAgeMs: age.ageMs,
        networkError,
      };
    }
    // ④ 번들 사본(앱 안에 함께 들어간 빌드 시점 데이터) — 첫 실행이 오프라인이어도 화면이 뜬다.
    //    "마지막으로 가진 데이터" 로 표시한다: 나이는 발행 시각(fetchedAt) 기준, 24h 넘으면 cache-expired.
    if (options.fallbackPath !== undefined && options.fallbackPath !== path) {
      try {
        const bundled = parseTimetable(await fetchContractJson(fetchImpl, options.fallbackPath));
        const publishedMs = Date.parse(bundled.source.fetchedAt);
        const age = timetableCacheAge(Number.isFinite(publishedMs) ? publishedMs : readNowMs(), readNowMs());
        return {
          model: bundled,
          source: age.expired ? 'cache-expired' : 'cache',
          cachedAtMs: Number.isFinite(publishedMs) ? publishedMs : null,
          cacheAgeMs: age.ageMs,
          networkError,
        };
      } catch {
        // 번들 사본도 없으면 원래 오류로 간다(아래).
      }
    }
    if (error instanceof TimetableDataError) throw error;
    throw new TimetableDataError(path, networkError);
  }
}

/** 네트워크에서 계약 JSON 원문을 받는다(성공 시에만 값, 실패는 `TimetableDataError`). */
async function fetchContractJson(fetchImpl: FetchLike, path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(path);
  } catch (error) {
    throw new TimetableDataError(path, `네트워크 요청 실패: ${messageOf(error)}`);
  }
  if (!response.ok) {
    throw new TimetableDataError(path, `HTTP ${String(response.status)} ${response.statusText}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new TimetableDataError(path, `JSON 파싱 실패: ${messageOf(error)}`);
  }
}

/**
 * 캐시 레코드 → 뷰모델. 지원 목록 밖 스키마 버전·파싱 실패는 `null`(네트워크로 진행).
 * 게이트를 "한 버전 일치"로 되돌리면 발행물 버전이 오를 때 폴백이 조용히 죽는다(T18 회귀).
 */
function parseCached(cached: CachedTimetableEntry): TimetableModel | null {
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(cached.schemaVersion)) return null;
  try {
    return parseTimetable(cached.raw);
  } catch {
    // 캐시는 곁다리다 — 깨졌으면 조용히 버리고 네트워크 결과/오류 UI 로 간다.
    return null;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
