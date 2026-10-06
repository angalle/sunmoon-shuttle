/**
 * 앱 조립 지점 (app/) — 부트스트랩(**유일한 wiring 지점**).
 *
 * 책임(스킬 §2 의 `app/`): 데이터 로딩·상태 생성·페이지 결선·타이머·SW 등록. **기능 로직·계산은 하지 않는다.**
 * - 현재 시각은 포트(Clock)로 주입한다(도메인은 `Date.now()` 금지 — 경계 검사).
 * - 60초마다 시각을 갱신한다(카드 지시 ④: 타이머는 화면 계층에서 관리).
 * - 데이터는 **캐시 계층 포함 로더**로 읽는다(T6 · AC-5·AC-6):
 *   네트워크가 죽어도 마지막 정상 데이터를 그리고, 그 사실을 화면 문구(오프라인 안내)로 알린다.
 *   캐시 폴백은 **오류가 아니므로** `console.error` 를 찍지 않는다(AC-5: 콘솔 오류 0).
 * - 진짜로 아무 데이터도 못 읽었을 때만 오류 상태(`F8`)로 간다 — 조용한 실패 금지.
 */
import { dayTypeFromDate } from '../../../../domain/rules/dayType';
import { formatIsoDate, kstDayFromInstant } from '../../../../domain/rules/kst';
import type { Clock } from '../../../../ports/clock';
import type { TimetableCachePort } from '../../../../ports/timetable_cache';
import { IndexedDbTimetableCache } from '../../../out/storage/indexedDbTimetableCache';
import { loadTimetableModel, type LoadedTimetable } from '../features/schedule/api/timetableApi';
import { createWebClock, readInitialSelection } from '../features/schedule/data/urlParams';
import { readUiPrefs, writeUiPrefs, effectiveStoredDayType } from '../features/schedule/api/uiPrefsApi';
import { createSchedulePage } from '../features/schedule/pages/SchedulePage';
import { ScheduleStore } from '../features/schedule/store/scheduleStore';
import { safeLocalStorage } from '../shared/lib/storage';
import { registerServiceWorker } from './serviceWorker';

/** 갱신 주기(ms) — 카드 지시: 60초 */
export const REFRESH_INTERVAL_MS = 60_000;

export interface MountOptions {
  /** 테스트·스모크에서 데이터 로더를 바꿔 끼울 수 있게 한다(기본: 캐시 포함 로더) */
  readonly load?: (() => Promise<LoadedTimetable>) | undefined;
  /** 캐시 포트 주입(기본: IndexedDB 어댑터). `null` 이면 캐시 없이 동작. */
  readonly cache?: TimetableCachePort | null | undefined;
  readonly clock?: Clock | undefined;
  readonly search?: string | undefined;
  readonly intervalMs?: number | undefined;
  /** SW 등록 강제 on/off(기본: 빌드 산출물에서만 on) */
  readonly registerSw?: boolean | undefined;
}

export function mountScheduleApp(root: HTMLElement, options: MountOptions = {}): void {
  const search = options.search ?? window.location.search;
  const clock = options.clock ?? createWebClock(search);
  const initial = readInitialSelection(search);
  const nowMs = (): number => clock.now().getTime();
  const cache = options.cache === undefined ? new IndexedDbTimetableCache() : options.cache;
  const load = options.load ?? (() => loadTimetableModel({ cache, nowMs }));

  // 화면 설정 저장(§11-1) — 저장된 요일·방향 필터를 재실행 후에도 유지한다.
  // 우선순위: URL(`?day=`) > 저장값 > 기본(오늘 요일 · `전체`). URL 은 스모크/공유 링크의 **명시 지정**이라 가장 세다.
  // 저장된 **요일**은 그날(KST) 안에서만 유효하다 — 다른 날짜로 열면(자정을 넘겼거나 `?now=` 로 다른 날을 보면)
  // 지난 선택을 따라가지 않고 오늘 요일로 시작한다(잘못된 요일 시간표 방지).
  const prefsStorage = safeLocalStorage();
  const storedPrefs = readUiPrefs(prefsStorage);
  const storedDayType = effectiveStoredDayType(storedPrefs, formatIsoDate(kstDayFromInstant(new Date(clock.now()))));

  const store = new ScheduleStore({
    status: 'loading',
    model: null,
    errorMessage: null,
    dataSource: null,
    cacheAgeMs: null,
    offlineReason: null,
    dayType: initial.dayType ?? storedDayType ?? dayTypeFromDate(clock.now()),
    routeId: initial.routeId,
    nowMs: nowMs(),
  });

  const reload = (): void => {
    store.setLoading();
    void load()
      .then((loaded) => {
        if (loaded.source === 'network') {
          store.setModel(loaded.model);
          return;
        }
        // 캐시 폴백 = 정상 동작(오프라인)이다. 콘솔 error 금지 → warn 으로 원인만 남긴다.
        console.warn('[schedule] 최신 데이터를 받지 못했습니다 — 마지막으로 받은 데이터로 표시합니다', loaded.networkError);
        store.setModel(loaded.model, {
          dataSource: loaded.source,
          cacheAgeMs: loaded.cacheAgeMs,
          offlineReason: loaded.networkError,
        });
      })
      .catch((error: unknown) => {
        // 조용한 실패 금지 — 화면에 문구로, 콘솔에 원인을 남긴다(스킬 §5). 여기는 **데이터가 아무것도 없을 때**뿐이다.
        console.error('[schedule] 데이터 로드 실패', error);
        store.setError(error instanceof Error ? error.message : String(error));
      });
  };

  // 설치 안내(T7)는 §13-2(2026-10-06 사용자 지시)로 **삭제**했다 — 브라우저 API(localStorage)는
  // 화면 설정 저장(§11-1)에만 쓴다.

  const disposePage = createSchedulePage(root, store, {
    onRetry: reload,
    // 상단 바 새로고침(T24·T27) — 같은 로더를 다시 돌린다(스피너는 status='loading' 으로 표시된다).
    onRefresh: reload,
    // §11-1 상태 저장 — 페이지가 고른 요일·방향 필터를 그대로 저장한다(실패는 삼킨다).
    initialDirection: storedPrefs.direction ?? undefined,
    onViewPrefs: (prefs) => {
      writeUiPrefs(prefsStorage, prefs);
    },
  });

  const timer = window.setInterval(() => {
    store.tick(nowMs());
  }, options.intervalMs ?? REFRESH_INTERVAL_MS);

  // 스모크 계측 훅 — 주입 시계(`?now=`)는 고정이라 분 단위 갱신을 실시간으로 볼 수 없다.
  // 주입 경로에서만 노출한다(프로덕션에는 훅이 없다): `window.__shuttleTick(<ISO>)` → 시각 한 번 이동.
  if (new URLSearchParams(search).has('now')) {
    (window as unknown as { __shuttleTick?: (iso: string) => void }).__shuttleTick = (iso: string) => {
      const parsed = Date.parse(iso);
      if (!Number.isNaN(parsed)) store.tick(parsed);
    };
  }

  // 탭 복귀 시 즉시 재계산(백그라운드 타이머 지연 보정).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') store.tick(nowMs());
  });
  window.addEventListener('pagehide', () => {
    window.clearInterval(timer);
    disposePage();
  });

  // SW 등록 — 등록 경로는 여기 1곳뿐(T6 ④). 실패해도 앱은 계속 동작한다.
  registerServiceWorker({ enabled: options.registerSw });

  reload();
}
