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

/** 앱이 아는 계약 스키마 버전 — 다른 버전의 캐시는 버린다(docs/01 §4: 스키마 변경 시 앱·파서 동시 배포). */
export const SUPPORTED_SCHEMA_VERSION = 1;

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

/** 캐시 레코드 → 뷰모델. 스키마 버전 불일치·파싱 실패는 `null`(네트워크로 진행). */
function parseCached(cached: CachedTimetableEntry): TimetableModel | null {
  if (cached.schemaVersion !== SUPPORTED_SCHEMA_VERSION) return null;
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
