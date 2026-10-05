/**
 * 앱 조립 지점 (app/) — 부트스트랩.
 *
 * 책임(스킬 §2 의 `app/`): 데이터 로딩·상태 생성·페이지 결선·타이머. **기능 로직·계산은 하지 않는다.**
 * - 현재 시각은 포트(Clock)로 주입한다(도메인은 `Date.now()` 금지 — 경계 검사).
 * - 60초마다 시각을 갱신한다(카드 지시 ④: 타이머는 화면 계층에서 관리).
 * - 로딩 실패는 삼키지 않고 화면에 에러 문구로 보인다(무음 폴백 금지).
 */
import { dayTypeFromDate } from '../../../../domain/rules/dayType';
import { fetchTimetableModel } from '../features/schedule/api/timetableApi';
import { createWebClock, readInitialSelection } from '../features/schedule/data/urlParams';
import { createSchedulePage } from '../features/schedule/pages/SchedulePage';
import { ScheduleStore } from '../features/schedule/store/scheduleStore';
import type { TimetableModel } from '../features/schedule/types/model';
import type { Clock } from '../../../../ports/clock';

/** 갱신 주기(ms) — 카드 지시: 60초 */
export const REFRESH_INTERVAL_MS = 60_000;

export interface MountOptions {
  /** 테스트·스모크에서 데이터 로더를 바꿔 끼울 수 있게 한다(기본: fetch) */
  readonly load?: () => Promise<TimetableModel>;
  readonly clock?: Clock;
  readonly search?: string;
  readonly intervalMs?: number;
}

export function mountScheduleApp(root: HTMLElement, options: MountOptions = {}): void {
  const search = options.search ?? window.location.search;
  const clock = options.clock ?? createWebClock(search);
  const initial = readInitialSelection(search);
  const load = options.load ?? (() => fetchTimetableModel());

  const store = new ScheduleStore({
    status: 'loading',
    model: null,
    errorMessage: null,
    dayType: initial.dayType ?? dayTypeFromDate(clock.now()),
    routeId: initial.routeId,
    nowMs: clock.now().getTime(),
  });

  const reload = (): void => {
    store.setLoading();
    void load()
      .then((model) => {
        store.setModel(model);
      })
      .catch((error: unknown) => {
        // 조용한 실패 금지 — 화면에 문구로, 콘솔에 원인을 남긴다(스킬 §5).
        // eslint 없음: 콘솔 출력은 의도적이다.
        console.error('[schedule] 데이터 로드 실패', error);
        store.setError(error instanceof Error ? error.message : String(error));
      });
  };

  createSchedulePage(root, store, { onRetry: reload });

  const timer = window.setInterval(() => {
    store.tick(clock.now().getTime());
  }, options.intervalMs ?? REFRESH_INTERVAL_MS);

  // 탭 복귀 시 즉시 재계산(백그라운드 타이머 지연 보정).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') store.tick(clock.now().getTime());
  });
  window.addEventListener('pagehide', () => {
    window.clearInterval(timer);
  });

  reload();
}
