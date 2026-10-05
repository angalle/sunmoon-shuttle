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
import type { Clock } from '../../../../ports/clock';
import type { TimetableCachePort } from '../../../../ports/timetable_cache';
import { IndexedDbTimetableCache } from '../../../out/storage/indexedDbTimetableCache';
import { loadTimetableModel, type LoadedTimetable } from '../features/schedule/api/timetableApi';
import { createWebClock, readInitialSelection } from '../features/schedule/data/urlParams';
import {
  dismissInstallHint,
  installHintPlatform,
  isStandaloneDisplay,
  safeLocalStorage,
  shouldShowInstallHint,
} from '../features/schedule/api/installHintApi';
import { createSchedulePage } from '../features/schedule/pages/SchedulePage';
import { ScheduleStore } from '../features/schedule/store/scheduleStore';
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

  const store = new ScheduleStore({
    status: 'loading',
    model: null,
    errorMessage: null,
    dataSource: null,
    cacheAgeMs: null,
    offlineReason: null,
    dayType: initial.dayType ?? dayTypeFromDate(clock.now()),
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

  // 설치 안내(T7) — 홈 화면 추가 안내는 **한 번만**, 이미 설치(standalone)면 띄우지 않는다.
  // 브라우저 API(localStorage·matchMedia·UA)는 이 조립 지점에서만 읽어 페이지에는 값으로 넘긴다.
  const installStorage = safeLocalStorage();
  const installHintKind = shouldShowInstallHint(
    isStandaloneDisplay((query) => window.matchMedia(query)),
    installStorage,
  )
    ? installHintPlatform(window.navigator.userAgent)
    : null;

  createSchedulePage(root, store, {
    onRetry: reload,
    installHint: installHintKind,
    onDismissInstallHint: () => {
      dismissInstallHint(installStorage);
    },
  });

  const timer = window.setInterval(() => {
    store.tick(nowMs());
  }, options.intervalMs ?? REFRESH_INTERVAL_MS);

  // 탭 복귀 시 즉시 재계산(백그라운드 타이머 지연 보정).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') store.tick(nowMs());
  });
  window.addEventListener('pagehide', () => {
    window.clearInterval(timer);
  });

  // SW 등록 — 등록 경로는 여기 1곳뿐(T6 ④). 실패해도 앱은 계속 동작한다.
  registerServiceWorker({ enabled: options.registerSw });

  reload();
}
