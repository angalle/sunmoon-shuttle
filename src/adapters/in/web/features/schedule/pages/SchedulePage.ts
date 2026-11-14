/**
 * 페이지: 시간표 화면 조립 (features/schedule/pages) — 라우트 1개 = 파일 1개.
 *
 * 하는 일: 상태를 받아 **앱 셸을 조립**하고 로딩/에러/스플래시를 표시한다.
 * 하지 않는 일: 계산(요일·시각·운행 판정·편수는 `selectors`+도메인), 데이터 요청(api 계층).
 *
 * T27 — 시간표 중심 단순화(docs/07-mobile-ux.md §9). T24 의 화면 분리([지금]/[전체] 탭)를 없애고
 * **본문 = 시간표 하나**로 만든다:
 *
 *   상단 고정 영역(§11-1 · T29) — 3줄, 스크롤해도 고정 (§15-3 T37: 앱바 52 · 요일 40 · 칩 알약 34px · 좌우 10px)
 *     ① 현재 날짜·시각(분 단위 갱신) + ⓘ(정보 시트) + 새로고침
 *     ② 요일 전환 3개(평일/토요일/일요일)
 *     ③ 방향 택1 세그먼트 **2개**(학교 도착/터미널 도착) + 칩마다 편수 — **항상 1개 선택**(§16-2 · 해제 불가 `전체` 없음)
 *   ── 본문(#shuttle-main, 스크롤 영역) ──────────────────────────────────────
 *     ① 상단 바 아래 **최소 1줄**(예외): 오늘 운행 없음(+다음 운행) · 대체 시간표 · 방학 · 오늘 종료
 *     ② **시간표 목록 하나**(선택한 방향의 회차 · §16-2): 지난 편 dim · 다음 출발 행 살짝 강조(좌측 라인+배경 톤)
 *        · 요일 조건은 **짧은 토큰 1개 이하**(`금 휴`)
 *   ── 정보 시트(ⓘ, 기본 숨김) ──────────────────────────────────────────────
 *     출처(학교 링크 1개) · `데이터 갱신` · 요금/지연 안내 · 정차창 · 방학 링크 · 비공식 고지 ·
 *     미해석 경고(내부) · 개인정보처리방침 — §9-5 로 본문에서 걷어낸 것들
 *   ── 우하단 이동 버튼 2개(T28 · §10-1) ────────────────────────────────────
 *     `현재 시간으로`(다음 출발 행으로 — §9-3 로직 재사용, **억제 상태여도 동작**) · `맨 위로`
 *     §15-2(T37) — 선택한 요일이 **오늘이 아니면 되묻지 않는다**: 오늘 버킷으로 옮기고 짧은 안내
 *     이동 안내 문구(`UI_TEXT.moveNowTodayNotice`)를 1.5초만 띄운다(액션 버튼 없음 · 예전 `오늘 보기` 확인형 제거).
 *   ── 스플래시 ────────────────────────────────────────────────────────────
 *     진입 시 항상 표시 → 데이터 준비 시 200ms 페이드아웃(최소 1.2s / 최대 2.5s — `data/splash.ts`)
 *
 * 자동 스크롤(§9-3 · §11-1)
 * - 진입·요일 전환·새로고침 후 **다음 출발 행**이 상단 고정 영역 바로 아래에 오도록 스크롤한다(즉시 이동).
 * - 오프셋은 **고정 영역의 실제 높이**를 매번 재서 쓴다(하드코딩 금지) → 요일·필터가 바뀌어 고정 영역 높이가
 *   달라져도 다음 출발 행이 가려지지 않는다. 같은 값을 `--fixed-height` 토큰으로 내려 행의
 *   `scroll-margin-top` 도 동적이 된다.
 * - 사용자가 직접 스크롤한 뒤 **3초** 안에는 다시 스크롤하지 않는다(주기적 재스크롤 금지 — 60초 틱은 스크롤하지 않는다).
 * - 단, **이동 버튼(`현재 시간으로`)** 은 억제를 해제하고 항상 동작한다(§10-1). 버튼 이동은
 *   `prefers-reduced-motion: reduce` 면 즉시, 아니면 부드럽게(`moveScrollBehavior`) 간다.
 * - 계측값은 `window.__shuttleScroll` 로 남긴다(스모크 증거).
 *
 * 갱신 전략
 * - 구조 변경(데이터 로드·요일 선택·날짜 변경) → 전체 재렌더 + 자동 스크롤.
 * - 시각만 변경(60초 틱) → 상단 바 시계와 행 상태(dim·강조·토큰)만 다시 그린다(스크롤 없음).
 */
import { el, replaceChildren } from '../../../shared/lib/dom';
import { formatKstHeaderClock } from '../../../shared/lib/format';
import { button } from '../../../shared/ui/atoms/Button';
import { spinner } from '../../../shared/ui/atoms/Spinner';
import { DAY_TYPES, type DayType } from '../../../../../../domain/entities/DayType';
import { dayTypeFromDate } from '../../../../../../domain/rules/dayType';
import { formatIsoDate, kstDayFromInstant } from '../../../../../../domain/rules/kst';
import {
  DEFAULT_DIRECTION_SELECTION,
  dayNoticeLine,
  dayTabs,
  dayTabsWithoutModel,
  freshnessView,
  moveNowHint,
  noticeGroups,
  resolveStopId,
  stopOptions,
  stopWindowLines,
  todayBoardView,
  timetableView,
  upcomingChanges,
  vacationNotice,
  type DirectionSelection,
  type TimetableView,
  type VacationView,
} from '../store/selectors';
import type { ScheduleState, ScheduleStore } from '../store/scheduleStore';
import { UI_TEXT, FALLBACK_SOURCE_URL } from '../types/texts';
import { dayTabs as dayTabsMolecule, dayTabId } from '../components/molecules/DayTabs';
import { directionHeader } from '../components/molecules/DirectionHeader';
import { stopFilter } from '../components/molecules/StopFilter';
import { skeletonCards } from '../components/molecules/SkeletonCards';
import { toast } from '../components/molecules/Toast';
import { dailyTimetable } from '../components/organisms/DailyTimetable';
import { dayNotice } from '../components/organisms/DayNotice';
import { guideSheet } from '../components/organisms/GuideSheet';
import { moveButtons } from '../components/molecules/MoveButtons';
import { SPLASH_MAX_MS, decideSplash, splashFadeMs, type SplashHideReason } from '../data/splash';

const TAB_ID_PREFIX = 'shuttle-day';
const DAY_PANEL_ID = 'shuttle-day-panel';
const LIST_HEADING_ID = 'shuttle-timetable-heading';
const GUIDE_HEADING_ID = 'shuttle-guide-heading';
const GUIDE_NOTICE_HEADING_ID = 'shuttle-guide-notice-heading';
const SOURCE_HEADING_ID = 'shuttle-source-heading';

/** 사용자가 직접 스크롤한 뒤 자동 스크롤을 쉬는 시간(ms) — docs/07 §9-3 */
export const AUTO_SCROLL_COOLDOWN_MS = 3000;

/**
 * 정보성 안내(막차 이후 1줄)가 **스스로 사라지기까지의 시간**(ms) — 정보라 3초를 쓴다.
 * (탭하면 이 시간을 기다리지 않고 즉시 닫힌다.)
 */
export const TOAST_DURATION_MS = 3000;

/**
 * T37 §15-2 — 오늘로 **이동 안내**(`UI_TEXT.moveNowTodayNotice`)의 표시 시간(ms). 문서 계약은 1.5초(수용 기준 1.2~2.0초).
 * "알려주고 바로 실행"하는 안내라 정보성 1줄(3초)보다 짧게 둔다(화면을 오래 붙잡지 않는다).
 */
export const MOVE_NOTICE_MS = 1500;


/** 즉시 이동(진입 자동 스크롤 §9-3)의 계측 창(ms) — 프로그램 스크롤을 사용자 스크롤로 오인하지 않게 한다. */
export const INSTANT_SCROLL_WINDOW_MS = 150;

/**
 * 이동 버튼(§10-1)의 이동 애니메이션 시간(ms) — 문서 계약은 **150~200ms**.
 * 네이티브 `behavior: 'smooth'` 는 **거리에 따라 수 초**가 걸려(7000px 이동 실측) 이 계약을 못 지킨다
 * → 이동 버튼은 거리와 무관한 짧은 rAF 애니메이션을 쓴다.
 */
export const MOVE_ANIMATION_MS = 180;

/** rAF 가 멈춘 환경(백그라운드 탭 등)에서도 목표에 도착시키는 보정 여유(ms). */
export const MOVE_SETTLE_MS = 60;

/** 이동 방식 — `instant`(즉시 · 애니메이션 0) 또는 `animate`(짧은 애니메이션). */
export type MoveStyle = 'instant' | 'animate';

/**
 * 이동 버튼(§10-1)의 이동 방식.
 * `prefers-reduced-motion: reduce` 면 **즉시(애니메이션 0)**, 아니면 짧은 애니메이션(150~200ms).
 * (진입 자동 스크롤은 §9-3 계약대로 언제나 즉시다 — 여기서 바뀌지 않는다.)
 */
export function moveScrollStyle(reducedMotion: boolean): MoveStyle {
  return reducedMotion ? 'instant' : 'animate';
}

/** 스플래시 계측값(스모크 증거용) — 화면에 붙는 값이 아니라 계측용이라 window 에 남긴다. */
interface SplashMetric {
  shownAt: number;
  hiddenAt: number | null;
  reason: SplashHideReason | null;
  /** 상한 타이머를 **실제로 건 지연**(shownAt 기준 남은 시간) — 계약(≤2.5s) 실측용. */
  maxDelayMs: number | null;
}

/** 자동 스크롤 계측값(스모크 증거용) — 몇 번 스크롤했고, 언제 건너뛰었는지. */
interface ScrollMetric {
  autoScrolls: number;
  skipped: number;
  /** 이동 버튼(`현재 시간으로`·`맨 위로`)으로 움직인 횟수 — 억제 상태에서도 동작했는지의 증거(§10-1). */
  buttonScrolls: number;
  lastTargetKey: string | null;
  lastOffset: number | null;
  lastAutoAt: number | null;
  lastUserScrollAt: number | null;
}

export interface SchedulePageOptions {
  readonly onRetry: () => void;
  /** 상단 바 새로고침(수동 갱신) — 재로딩은 app/mount.ts 가 소유한다. */
  readonly onRefresh: () => void;
  /**
   * 저장된 방향 선택(§11-1 상태 저장 · §16-2) — 없으면 **기본 `터미널 도착`**(`DEFAULT_DIRECTION_SELECTION`).
   * 저장소 읽기/쓰기는 조립 지점(app/mount.ts)이 맡고 페이지는 값만 받는다.
   */
  readonly initialDirection?: DirectionSelection | undefined;
  /** 저장된(또는 URL `?route=`) 정류장 — 선택지에 없으면 첫 정류장(시안 A · `전체` 없음) */
  readonly initialStop?: string | undefined;
  /** 요일·정류장·방향 선택을 저장한다(§11-1 재실행 시 유지). `date` = 저장 시점 KST 날짜 키(요일 선택은 그날 한정). */
  readonly onViewPrefs?:
    | ((prefs: { readonly dayType: DayType; readonly direction: DirectionSelection; readonly stop: string | null; readonly date: string }) => void)
    | undefined;
  /** 스플래시·스크롤 시간 계측용 **단조 시각**(기본 `performance.now`) — 테스트 주입용. */
  readonly monotonicNow?: () => number;
  /** `prefers-reduced-motion: reduce` 판정 주입(기본: matchMedia). */
  readonly reducedMotion?: () => boolean;
}

export function createSchedulePage(
  root: HTMLElement,
  store: ScheduleStore,
  options: SchedulePageOptions,
): () => void {
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const reducedMotion = options.reducedMotion ?? defaultReducedMotion;

  const host = (testid: string): HTMLElement => el('div', { dataset: { testid } });
  const bannerHost = host('banner');
  const noticeHost = host('notice-host');
  const tabsHost = host('tabs-host');
  const filterHost = host('filter-host');
  const stopHost = host('stop-host');
  const listHost = host('list-host');
  const sheetHost = host('sheet-host');
  /** 하단 안내(토스트) 자리 — 이동 버튼 **위쪽**에 뜬다(§11-2). 여는 책임은 페이지, 배치는 CSS. */
  const toastHost = host('toast-host');

  /** ① 상단 바 — 현재 날짜·시각(크게, 분 단위 갱신) + ⓘ(정보 시트) + 새로고침. 값만 갱신한다. */
  const clockNode = el('time', { class: 'shuttle-appbar__clock', attrs: { datetime: '' }, dataset: { testid: 'app-clock' } });
  const infoNode = button({
    label: 'ⓘ',
    variant: 'secondary',
    ariaLabel: UI_TEXT.infoOpenLabel,
    testid: 'app-info',
    onClick: () => {
      setGuideOpen(true);
    },
  });
  infoNode.classList.add('shuttle-appbar__info');
  // 새로고침 버튼은 두지 않는다(2026-11-08 사용자 결정) — 데이터는 진입·복귀 때 자동으로 다시 읽고(SWR), 오프라인이면 캐시를 쓴다.

  /** ② 스플래시 — 진입 시 표시, 데이터가 준비되면 페이드아웃(최소 1.2s · 최대 2.5s). */
  const splashNode = splashScreen();
  const splashStartedAt = monotonicNow();
  const splashMetric: SplashMetric = { shownAt: splashStartedAt, hiddenAt: null, reason: null, maxDelayMs: null };
  (window as unknown as { __shuttleSplash?: SplashMetric }).__shuttleSplash = splashMetric;

  let splashHidden = false;
  let splashTimer: number | null = null;

  const scroller = el('main', { class: 'shuttle-scroll', attrs: { id: 'shuttle-main', tabindex: '-1' } });
  const dayPanel = el('section', {
    class: 'shuttle-tabpanel',
    attrs: { id: DAY_PANEL_ID, role: 'tabpanel', tabindex: '0' },
    dataset: { testid: 'day-panel' },
  });

  /**
   * 상단 고정 영역(§11-1) — **3줄**을 한 덩어리로 묶는다: 날짜·시각 / 요일 3개 / 방향 필터 3개.
   * 이 영역은 스크롤 영역(`.shuttle-scroll`) **밖**이라 스크롤해도 그대로 있고,
   * 그 실제 높이가 자동 스크롤 오프셋이다(하드코딩하지 않는다 — `fixedHeight()`).
   */
  const fixedNode = el('header', { class: 'shuttle-fixed', dataset: { testid: 'fixed-header' } }, [
    el('div', { class: 'shuttle-appbar', dataset: { testid: 'appbar' } }, [
      // 앱 이름·로고는 화면에 내보내지 않는다(§9-2 — 스플래시가 이미 보여줬다). 낭독기용 제목만 남긴다.
      el('h1', { class: 'shuttle-sr-only', text: UI_TEXT.appTitle }),
      clockNode,
      el('div', { class: 'shuttle-appbar__actions' }, [infoNode]),
    ]),
    // 상단 1줄 안내(운행 없음·대체·오늘 종료)·오류 배너 — 날짜·시각 바로 아래(2026-11-08). 예전 자리(고정 영역과 시간표 사이)는
    // 표 머리와 시간표를 갈라 놓았다. 비어 있으면 자리를 차지하지 않는다(CSS :has).
    el('div', { class: 'shuttle-stripbar', dataset: { testid: 'stripbar' } }, [bannerHost, noticeHost]),
    el('div', { class: 'shuttle-fixed__row', dataset: { testid: 'day-row' } }, [tabsHost]),
    el('div', { class: 'shuttle-fixed__row', dataset: { testid: 'stop-row' } }, [stopHost]),
    el('div', { class: 'shuttle-fixed__row', dataset: { testid: 'filter-row' } }, [filterHost]),
  ]);

  const appNode = el('div', { class: 'shuttle-app' }, [
    el('a', { class: 'shuttle-skip-link', attrs: { href: '#shuttle-main' }, text: UI_TEXT.skipToContent }),
    fixedNode,
    // 상단 고정 영역 아래 최소 1줄(예외 안내) + 오류·오프라인 안내 — 둘 다 얇은 줄이다(§9-4).
    scroller,
    toastHost,
    sheetHost,
    splashNode,
  ]);
  replaceChildren(root, [appNode]);

  // 본문은 **시간표 하나**다 — 요일·필터는 위 고정 영역이 맡는다(§9-1 · §11-1).
  replaceChildren(scroller, [dayPanel]);
  replaceChildren(dayPanel, [listHost]);


  /* ── 이용 안내 시트(ⓘ) — 표현(표시·포커스)만 페이지가 관리한다 ── */
  let guideOpen = false;
  const setGuideOpen = (open: boolean): void => {
    guideOpen = open;
    const sheet = root.querySelector<HTMLElement>('[data-testid="guide-sheet"]');
    if (sheet === null) return;
    if (open) {
      sheet.removeAttribute('hidden');
      sheet.querySelector<HTMLElement>('[data-testid="guide-close"]')?.focus();
      return;
    }
    sheet.setAttribute('hidden', '');
    root.querySelector<HTMLElement>('[data-testid="app-info"]')?.focus();
  };

  /* ── 하단 안내(토스트) — `현재 시간으로` 의 짧은 안내 (§15-2 · T37) ──
   *  · 액션 버튼이 **없다**(되묻지 않는다) · 탭하거나 Escape 로 즉시 닫힘
   *  · 수명은 호출자가 정한다: 이동 안내(`moveNowTodayNotice`) = 1.5초(`MOVE_NOTICE_MS`) · 정보 1줄 = 3초
   *  · 요일·필터가 바뀌면(구조 재렌더) 지난 안내는 의미가 없으므로 닫는다.
   */
  let toastTimer: number | null = null;

  const closeToast = (): void => {
    if (toastTimer !== null) {
      window.clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (toastHost.firstChild !== null) replaceChildren(toastHost, []);
  };

  // 오늘로 옮긴다(§15-2 ①②) — 오늘 요일 버킷으로 전환하고 **다음 출발 행으로** 스크롤한다.
  // `scrollToNextDeparture` 는 아래에서 정의되지만, 이 콜백은 사용자 클릭 때만 실행된다.
  const goToToday = (): void => {
    const state = latestState;
    if (state === null) return;
    const today = dayTypeFromDate(new Date(state.nowMs));
    // 요일 전환은 저장소가 알린다(동기 재렌더) — 그 뒤 확정된 목록에서 다음 출발 행으로 맞춘다.
    if (state.dayType !== today) store.selectDay(today);
    scrollToNextDeparture(true);
  };

  /** 한 줄 안내를 `durationMs` 동안 띄운다(액션 버튼 없음 — §15-2). */
  const showToast = (message: string, durationMs: number): void => {
    closeToast();
    replaceChildren(toastHost, [
      toast({
        message,
        onDismiss: () => {
          closeToast();
        },
      }),
    ]);
    toastTimer = window.setTimeout(() => {
      closeToast();
    }, durationMs);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (toastHost.firstChild !== null) {
      event.preventDefault();
      closeToast();
      return;
    }
    if (guideOpen) {
      event.preventDefault();
      setGuideOpen(false);
    }
  };
  document.addEventListener('keydown', onKeyDown);

  /* ── 자동 스크롤(§9-3) — 다음 출발 행을 상단 바 바로 아래로. 주기적 재스크롤 금지 ── */
  const scrollMetric: ScrollMetric = {
    autoScrolls: 0,
    skipped: 0,
    buttonScrolls: 0,
    lastTargetKey: null,
    lastOffset: null,
    lastAutoAt: null,
    lastUserScrollAt: null,
  };
  (window as unknown as { __shuttleScroll?: ScrollMetric }).__shuttleScroll = scrollMetric;

  let lastUserScrollAt: number | null = null;
  /** 프로그램 스크롤이 만든 scroll 이벤트를 사용자 스크롤로 오인하지 않게 하는 창(ms). */
  let programmaticUntil = 0;

  scroller.addEventListener(
    'scroll',
    () => {
      if (monotonicNow() < programmaticUntil) return;
      lastUserScrollAt = monotonicNow();
      scrollMetric.lastUserScrollAt = lastUserScrollAt;
    },
    { passive: true },
  );

  /**
   * 상단 **고정 영역의 실제 높이**(px) — §11-1: "고정 영역 전체 높이가 곧 자동 스크롤 오프셋이다".
   * 요일·필터 줄의 높이는 화면 폭·줄바꿈·안전영역에 따라 달라지므로 **매번 재서** 쓴다(하드코딩 금지).
   * 못 찾으면(초기 조립 전) 앱바 최소 높이로 물러선다.
   */
  const fixedHeight = (): number => {
    const node = root.querySelector<HTMLElement>('[data-testid="fixed-header"]');
    // 조립 전에만 쓰이는 물러섬 값 = 앱바 내용 높이(§15-3). 정상 경로에서는 실제 높이(≈135px)를 잰다.
    return node === null ? 52 : Math.round(node.getBoundingClientRect().height);
  };

  /** 행의 `scroll-margin-top` 이 같은 값을 쓰게 CSS 변수를 갱신한다(동적 — 고정 영역이 커지면 함께 커진다). */
  const syncFixedHeightToken = (): void => {
    appNode.style.setProperty('--fixed-height', `${String(fixedHeight())}px`);
  };

  /**
   * 행의 목표 오프셋 — 행의 **스크롤 영역 기준** 위치에서 `overlap`(고정 영역이 스크롤포트를 실제로 덮는 높이)만큼 뺀다.
   * `offsetTop`(조상 기준)은 셸 여백·고정 영역 높이까지 포함해 목표가 어긋난다(실측: 행이 상단 바 뒤로 16px 들어갔다)
   * → 스크롤포트 사각형으로 계산한다.
   */
  const offsetForRow = (row: HTMLElement, overlap: number): number =>
    Math.max(
      0,
      Math.round(row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - overlap - landingGap()),
    );

  /**
   * UI v3 — 착지 여백(px). 다음 출발 행이 고정 영역 바로 아래에 딱 붙으면 답답하고 카드 위 모서리가 사라진다
   * → 토큰 `--scroll-landing-gap`(12px)만큼 위를 남긴다. 값은 CSS 토큰에서 읽는다(하드코딩 금지).
   */
  const landingGap = (): number => {
    const value = parseFloat(getComputedStyle(appNode).getPropertyValue('--scroll-landing-gap'));
    return Number.isFinite(value) ? value : 0;
  };

  /**
   * 스크롤 오프셋에서 **빼야 하는 몫** = 고정 영역(3줄)이 스크롤 영역을 실제로 덮는 높이(px).
   * 두 영역의 사각형을 **그때그때 재서** 구한다(하드코딩 금지).
   *
   * 지금 배치는 고정 영역이 스크롤 영역 **위에** 따로 서 있으므로 겹침이 0 이고, 다음 출발 행은
   * 스크롤포트 맨 위(= 고정 영역 하단 바로 아래)에 맞춰진다 — 가려지지도, 넘겨 스크롤되지도 않는다.
   * 고정 영역이 스크롤 영역을 덮는 배치(오버레이)로 바뀌면 그만큼 내려 준다(§11-1: 요일·필터 줄이
   * 늘어나 높이가 변해도 같은 식으로 따라간다).
   *
   * `--fixed-height`(행의 `scroll-margin-top` 계약 = 고정 영역 전체 높이)와는 다른 값이다:
   * 스크롤포트가 이미 고정 영역 아래에서 시작하므로 전체 높이를 그대로 빼면 과소 스크롤(0)이 된다.
   */
  const fixedOverlap = (): number => {
    const header = root.querySelector<HTMLElement>('[data-testid="fixed-header"]');
    if (header === null) return fixedHeight();
    return Math.max(0, Math.round(header.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top));
  };

  /** rAF 프레임·보정 타이머 — 새 이동이 시작되면 앞선 이동을 취소한다. */
  let moveFrame: number | null = null;
  let moveTimer: number | null = null;

  const cancelMove = (): void => {
    if (moveFrame !== null) {
      cancelAnimationFrame(moveFrame);
      moveFrame = null;
    }
    if (moveTimer !== null) {
      window.clearTimeout(moveTimer);
      moveTimer = null;
    }
  };

  /**
   * 본문을 목표 오프셋으로 옮긴다 — 프로그램 스크롤 구간을 열어 두어 사용자 스크롤로 오인하지 않게 한다.
   * `animate`(이동 버튼 §10-1)는 **거리와 무관한** 150~200ms rAF 애니메이션이고,
   * `instant`(진입 자동 스크롤 §9-3 · reduced-motion)는 즉시 이동한다.
   */
  const moveTo = (offset: number, style: MoveStyle): void => {
    cancelMove();
    programmaticUntil = monotonicNow() + (style === 'animate' ? MOVE_ANIMATION_MS + MOVE_SETTLE_MS : INSTANT_SCROLL_WINDOW_MS);
    if (style === 'instant') {
      scroller.scrollTop = offset;
      return;
    }
    const start = scroller.scrollTop;
    const delta = offset - start;
    const startedAt = performance.now();
    const step = (): void => {
      const progress = Math.min(1, (performance.now() - startedAt) / MOVE_ANIMATION_MS);
      // easeOutCubic — 180ms 안에 정확히 도착한다(거리와 무관).
      scroller.scrollTop = Math.round(start + delta * (1 - (1 - progress) ** 3));
      if (progress < 1) {
        moveFrame = requestAnimationFrame(step);
        return;
      }
      moveFrame = null;
      scroller.scrollTop = offset;
      if (moveTimer !== null) {
        window.clearTimeout(moveTimer);
        moveTimer = null;
      }
    };
    moveFrame = requestAnimationFrame(step);
    // rAF 가 멈춘 환경(백그라운드 탭 등)에서도 목표에 도착하게 하는 보정 타이머.
    moveTimer = window.setTimeout(() => {
      cancelMove();
      scroller.scrollTop = offset;
    }, MOVE_ANIMATION_MS + MOVE_SETTLE_MS);
  };

  /**
   * 다음 출발 행을 상단 바 바로 아래로.
   * `force`(이동 버튼 §10-1)면 **사용자 스크롤 억제를 해제**하고 항상 움직인다(150~200ms 애니메이션 — reduced-motion 이면 즉시).
   * 진입·요일 전환·새로고침의 자동 스크롤은 §9-3 계약대로 즉시(instant)이고 억제 규칙을 지킨다.
   */
  const scrollToNextDeparture = (force = false): void => {
    const now = monotonicNow();
    if (!force && lastUserScrollAt !== null && now - lastUserScrollAt < AUTO_SCROLL_COOLDOWN_MS) {
      scrollMetric.skipped += 1;
      return;
    }
    const row = root.querySelector<HTMLElement>('[data-testid="timetable-row"][data-next="true"]');
    if (row === null) return;
    // 고정 영역 높이를 **지금** 재서 CSS 변수(행의 `scroll-margin-top`)에 쓰고(요일·필터가 바뀌어 높이가 달라져도 가려짐 0),
    // 오프셋은 고정 영역이 스크롤포트를 실제로 덮는 높이(`fixedOverlap`)만큼만 빼서 스크롤포트 맨 위에 맞춘다.
    const margin = fixedHeight();
    appNode.style.setProperty('--fixed-height', `${String(margin)}px`);
    const offset = offsetForRow(row, fixedOverlap());
    moveTo(offset, force ? moveScrollStyle(reducedMotion()) : 'instant');
    scrollMetric.autoScrolls += 1;
    if (force) scrollMetric.buttonScrolls += 1;
    scrollMetric.lastTargetKey = row.dataset['key'] ?? null;
    scrollMetric.lastOffset = offset;
    scrollMetric.lastAutoAt = now;
  };

  /** 목록 맨 위로(이동 버튼 §10-1) — 항상 동작하고, reduced-motion 이면 즉시. */
  const scrollToTop = (): void => {
    moveTo(0, moveScrollStyle(reducedMotion()));
    scrollMetric.buttonScrolls += 1;
  };

  // §10-1 우하단 이동 버튼 — 셸 **뒤에** 붙인다(이동 규칙·계측이 정의된 다음이라 순서가 자연스럽다).
  // 포커스 순서: 본문(요일 탭·목록) 다음, 정보 시트(숨김)·스플래시 앞.
  appNode.appendChild(
    moveButtons({
      onNow: () => {
        // §15-2(T37) — 오늘이 아니면 **되묻지 않는다**: 오늘 요일 버킷으로 전환 + 다음 출발 행으로 스크롤 +
        // 짧은 이동 안내(`UI_TEXT.moveNowTodayNotice`, 1.5초 · 액션 버튼 없음).
        const hint = latestState === null ? null : moveNowHint(latestState);
        if (hint === null) {
          closeToast();
          scrollToNextDeparture(true);
          return;
        }
        if (hint.moveToToday) {
          // 요일 전환이 구조 재렌더를 일으켜 안내를 닫으므로 **옮긴 뒤에** 안내를 띄운다(순서가 뒤바뀌면 안내가 사라진다).
          goToToday();
          showToast(hint.message, MOVE_NOTICE_MS);
          return;
        }
        // 옮길 대상이 없는 상태(오늘 편 0건·막차 이후)는 정보 1줄만 남긴다 — 이동하지 않는다.
        showToast(hint.message, TOAST_DURATION_MS);
      },
      onTop: () => {
        closeToast();
        scrollToTop();
      },
    }),
  );

  /**
   * 스플래시 숨김 — 페이드아웃(200ms, reduced-motion 이면 즉시) 후 노드를 제거하고
   * 포커스를 본문(요일 패널)으로 옮긴다(docs/07 §3).
   */
  const hideSplash = (reason: SplashHideReason): void => {
    if (splashHidden) return;
    splashHidden = true;
    if (splashTimer !== null) {
      window.clearTimeout(splashTimer);
      splashTimer = null;
    }
    splashMetric.hiddenAt = monotonicNow();
    splashMetric.reason = reason;
    splashNode.classList.add('shuttle-splash--out');
    const active = document.activeElement;
    // 포커스만 옮긴다 — 기본 포커스 스크롤이 본문을 0 으로 되돌리면 §9-3 자동 스크롤 목표가 지워진다(실측).
    // 스크립트 포커스는 테두리를 그리지 않는다 — WebKit·Android WebView 는 첫 로드의 프로그램 포커스도
    // :focus-visible 로 보아 표 아래에 청록 줄이 남았다(실측). 키보드로 다시 들어오면 테두리가 돌아온다.
    if (active === null || active === document.body) {
      dayPanel.dataset.focusOrigin = 'script';
      dayPanel.addEventListener('blur', () => delete dayPanel.dataset.focusOrigin, { once: true });
      dayPanel.focus({ preventScroll: true });
    }
    const fadeMs = splashFadeMs(reducedMotion());
    if (fadeMs <= 0) {
      removeSplash();
      return;
    }
    splashTimer = window.setTimeout(removeSplash, fadeMs);
  };

  function removeSplash(): void {
    if (splashNode.parentNode !== null) splashNode.parentNode.removeChild(splashNode);
    // 진입 화면이 곧바로 쓸모 있게 — 스플래시가 **완전히 사라진 뒤** 다음 출발 행으로 맞춘다(§9-3).
    // (셸 조립·포커스 이동이 끝난 시점이라 목표 위치가 확정된다. 사용자가 그 사이 스크롤했다면 쿨다운이 막는다.)
    scrollToNextDeparture();
  }

  /**
   * 상한(2.5s) — 기준은 **스플래시가 화면에 붙은 시각**(shownAt)이다.
   * 타이머를 걸기 전의 동기 렌더(앱 셸·시간표 조립)에 걸린 시간을 빼야
   * "2.5초를 넘겨 붙잡지 않는다"는 계약이 실제 경과 시간과 일치한다(AC-U5 실측 스모크가 이 값을 잰다).
   */
  const splashMaxDelayMs = Math.max(0, SPLASH_MAX_MS - (monotonicNow() - splashStartedAt));
  splashMetric.maxDelayMs = splashMaxDelayMs;
  const splashMaxTimer = window.setTimeout(() => {
    if (!splashHidden) hideSplash('timeout');
  }, splashMaxDelayMs);

  /** 데이터 준비 시 하한(1.2s)까지만 기다렸다 숨긴다. */
  const evaluateSplash = (state: ScheduleState): void => {
    if (splashHidden) return;
    const decision = decideSplash({
      elapsedMs: monotonicNow() - splashStartedAt,
      dataSettled: state.status !== 'loading',
    });
    if (!decision.hide || decision.reason === null) return;
    if (decision.delayMs <= 0) {
      hideSplash(decision.reason);
      return;
    }
    if (splashTimer === null) {
      const reason = decision.reason;
      splashTimer = window.setTimeout(() => {
        splashTimer = null;
        hideSplash(reason);
      }, decision.delayMs);
    }
  };

  let lastStructureKey = '';
  let latestState: ScheduleState | null = null;
  /**
   * 방향 선택(페이지 지역 상태 — 스킬 §5 · §16-2). **항상 1개**이고 `전체` 상태가 없다.
   * 저장된 값이 있으면 그 값으로 시작하고, 없으면 기본 `터미널 도착`(`DEFAULT_DIRECTION_SELECTION`).
   */
  let direction: DirectionSelection = options.initialDirection ?? DEFAULT_DIRECTION_SELECTION;
  /** 정류장 선택(시안 A) — 항상 1개. 모델이 오면 선택지에 맞춰 확정한다(`resolveStopId`). */
  let stopId: string | null = options.initialStop ?? null;
  /** 방향을 방금 뒤집었는가 — 바로 다음 렌더에서만 머리 화살표 회전 효과를 준다 */
  let headerJustFlipped = false;

  /** 요일·방향 선택 저장(§11-1) — 저장소 IO 는 조립 지점(app/mount.ts)이 갖고 여기서는 알리기만 한다.
   *  저장 시점의 날짜 키를 함께 넘긴다 — 요일 선택은 그날 안에서만 되살아난다(다른 날 화면에서 따라오지 않게). */
  const persistViewPrefs = (dayType: DayType, next: DirectionSelection): void => {
    options.onViewPrefs?.({ dayType, direction: next, stop: stopId, date: dayKey(store.getState().nowMs) });
  };

  /**
   * T38 §16-2 — 방향 선택(택1). **해제가 없다**: 눌린 방향이 곧 선택이고, 같은 칩을 다시 눌러도 선택이 유지된다.
   * 저장하고(§11-1) 필터·목록을 다시 그린다 — 0편이면 목록 자리에 얇은 1줄 + 전환 수단(자동 전환 없음)이 나온다.
   */
  function selectDirection(next: DirectionSelection): void {
    direction = next;
    persistViewPrefs(store.getState().dayType, next);
    if (latestState !== null) renderFilter(renderRows(latestState));
  }

  /** 정류장 선택(시안 A) — 저장하고 칩·방향 라벨·목록을 다시 그린 뒤 다음 출발로 옮긴다. */
  function selectStop(next: string): void {
    stopId = next;
    persistViewPrefs(store.getState().dayType, direction);
    if (latestState === null) return;
    const view = renderRows(latestState);
    renderStops(latestState);
    renderFilter(view);
    scrollToNextDeparture(true);
  }

  /**
   * 재렌더로 포커스를 잃지 않게 한다 — 방향 칩은 키보드 사용자의 현재 위치다.
   * 재렌더 전 포커스 키를 읽어, 같은 역할의 새 노드로 되돌린다(접근성: 키보드만으로 조작).
   */
  const focusKeyOf = (node: Element | null): string | null => {
    if (node === null) return null;
    if (node.getAttribute('data-testid') === 'direction-toggle') return 'toggle';
    // 요일 탭(roving tabindex) — 재렌더로 탭 노드가 새로 만들어지므로 id 로 되돌린다(키보드 사용자 포커스 유지).
    const id = node.id;
    if (id.startsWith(`${TAB_ID_PREFIX}-tab-`)) return `tab:${id}`;
    return null;
  };

  const restoreFocus = (key: string | null): void => {
    if (key === null) return;
    if (key === 'toggle') {
      root.querySelector<HTMLElement>('[data-testid="direction-toggle"]')?.focus();
      return;
    }
    if (key.startsWith('tab:')) {
      root.querySelector<HTMLElement>(`#${key.slice('tab:'.length)}`)?.focus();
    }
  };

  /** 상단 바 — 현재 날짜·시각(KST, 분 단위). 60초 틱마다 갱신된다. */
  const renderAppbar = (state: ScheduleState): void => {
    clockNode.setAttribute('datetime', new Date(state.nowMs).toISOString());
    clockNode.textContent = formatKstHeaderClock(state.nowMs);
  };

  /** ③ 시간표 목록 하나 — **선택한 방향의 회차**만 그린다(§16-2 · 두 방향이 섞이지 않는다). 로딩 중에는 스켈레톤 카드 3장(빈 화면 금지). */
  const renderRows = (state: ScheduleState): TimetableView | null => {
    if (state.model === null) {
      replaceChildren(listHost, state.status === 'loading' ? [skeletonCards({ count: 3 })] : []);
      return null;
    }
    stopId = resolveStopId(stopOptions(state), stopId);
    const view = timetableView(state, direction, stopId);
    replaceChildren(listHost, [
      dailyTimetable({
        view,
        headingId: LIST_HEADING_ID,
        // §16-2 — 0편일 때 나오는 전환 수단(`<다른 방향> 편 보기`)의 동작. 자동 전환은 없다.
        onSwitchDirection: (next) => {
          selectDirection(next);
        },
      }),
    ]);
    return view;
  };

  /**
   * ② 방향 택1 세그먼트(§16-2) — **항상 정확히 1개가 선택**되어 있다(해제 불가 · `전체` 없음).
   * 회차가 아직 없을 때(model null)도 자리는 지킨다 → 로딩 중에도 상단 3줄 구조가 흔들리지 않는다.
   */
  const renderFilter = (view: TimetableView | null): void => {
    // 칩에 포커스가 **있었을 때만** 되돌린다. 예전엔 무조건 선택 칩에 포커스를 줘서, 아무것도 누르지 않아도
    // 진입·재렌더마다 포커스 링이 칩에 떴다(2026-11-08 Android 에뮬레이터에서 발견).
    const chipHadFocus = filterHost.contains(document.activeElement);
    // 2026-11-08 — 방향은 칩 두 개가 아니라 **시간표 머리 하나**(`천안역 → 학교`)다. 누르면 반대 방향으로 뒤집힌다.
    replaceChildren(filterHost, [
      directionHeader({
        value: direction,
        stopName: view?.stopName ?? null,
        counts: view?.counts ?? { all: 0, out: 0, in: 0 },
        justFlipped: headerJustFlipped,
        onToggle: (next: DirectionSelection) => {
          headerJustFlipped = true;
          selectDirection(next);
          headerJustFlipped = false;
          scrollToNextDeparture(true);
        },
      }),
    ]);
    if (chipHadFocus || headerJustFlipped) root.querySelector<HTMLElement>('[data-testid="direction-toggle"]')?.focus({ preventScroll: true });
  };

  /** 정류장 칩 줄(시안 A) — 칩에 포커스가 있었을 때만 포커스를 되돌린다. */
  const renderStops = (state: ScheduleState): void => {
    const hadFocus = stopHost.contains(document.activeElement);
    replaceChildren(stopHost, [
      stopFilter({
        options: stopOptions(state),
        value: stopId,
        onSelect: (next) => {
          selectStop(next);
        },
      }),
    ]);
    if (hadFocus) root.querySelector<HTMLElement>(`[data-testid="stop-chip"][data-stop="${stopId ?? ''}"]`)?.focus();
  };

  /** ① 상단 바 아래 최소 1줄(운행 없음 · 대체 · 방학 · 오늘 종료) — 동시에 1줄(§9-4). */
  const renderNoticeLine = (state: ScheduleState): void => {
    const line = dayNoticeLine(state);
    replaceChildren(noticeHost, [line === null ? null : dayNotice({ line })]);
  };

  /** 정보 시트(ⓘ) — 본문에서 걷어낸 것들의 목적지(§9-5). 모델이 있을 때만 내용을 그린다. */
  const renderSheet = (state: ScheduleState, sheetVacation: VacationView | null): void => {
    const model = state.model;
    replaceChildren(sheetHost, [
      model === null
        ? null
        : guideSheet({
            headingId: GUIDE_HEADING_ID,
            noticeHeadingId: GUIDE_NOTICE_HEADING_ID,
            groups: noticeGroups(model),
            busRefs: model.busRefs,
            stopWindows: stopWindowLines(model),
            vacation: sheetVacation,
            freshness: freshnessView(model, state.nowMs),
            source: {
              model,
              headingId: SOURCE_HEADING_ID,
              hideSourceLink: sheetVacation !== null && sheetVacation.sourceUrl !== null,
            },
            warningsNotice: todayBoardView(state).warningsNotice,
            // 다가오는 운행 변동(14일 내 최대 2줄) — §9-1 로 본문에서 걷어낸 블록.
            upcoming: upcomingChanges(state),
            onClose: () => {
              setGuideOpen(false);
            },
          }),
    ]);
    // 재렌더 뒤에도 열려 있었으면 열린 상태를 유지한다(포커스는 닫기 버튼으로).
    if (guideOpen) setGuideOpen(true);
  };

  /** 시각 의존 부분만 다시 그린다(60초 틱) — 스크롤은 건드리지 않는다(§9-3). */
  const renderLive = (state: ScheduleState): void => {
    renderAppbar(state);
    const view = renderRows(state);
    renderStops(state);
    renderFilter(view);
    // 고정 영역(3줄)의 실제 높이를 CSS 토큰으로 내려 행의 `scroll-margin-top` 을 **동적**으로 맞춘다(§11-1).
    syncFixedHeightToken();
  };

  const renderStructure = (state: ScheduleState, options2: { readonly autoScroll: boolean }): void => {
    const focusKey = focusKeyOf(document.activeElement);
    // 구조가 바뀌면(요일·날짜·새로고침) 지난 안내는 의미가 없어졌다 — 먼저 닫는다(§11-2).
    closeToast();
    dayPanel.setAttribute('aria-labelledby', dayTabId(TAB_ID_PREFIX, state.dayType));

    replaceChildren(bannerHost, [renderBanner(state, options)]);
    // 데이터 출처는 화면 문구 대신 속성으로만 남긴다(진단·스모크용) — network | cache | cache-expired
    appNode.dataset.dataSource = state.dataSource ?? 'network';
    renderNoticeLine(state);
    replaceChildren(tabsHost, [
      dayTabsMolecule({
        tabs: state.model === null ? dayTabsWithoutModel(state.nowMs, DAY_TYPES) : dayTabs(state),
        selected: state.dayType,
        panelId: DAY_PANEL_ID,
        tabIdPrefix: TAB_ID_PREFIX,
        onSelect: (dayType) => {
          // 요일 선택을 저장한 뒤 전환한다(§11-1 재실행 시 유지).
          persistViewPrefs(dayType, direction);
          store.selectDay(dayType);
        },
      }),
    ]);

    // 정보 시트: 방학 배너가 링크를 갖지 않으므로(§9-4 얇은 1줄) 시트가 방학 링크를 맡는다.
    renderSheet(state, vacationNotice(state));

    // 본문(시간표) + 필터 + 상단 바 — 시각 의존 부분까지 한 번에 그린다.
    renderLive(state);
    restoreFocus(focusKey);
    // 자동 스크롤 목표는 **전환 애니메이션 전에** 잰다: `--enter` 애니메이션의 translateY 가 재는 시점에
    // 섞이면 목표가 그만큼 어긋난다(애니메이션은 목표를 잰 뒤에 시작한다).
    if (options2.autoScroll) scrollToNextDeparture();
    // 요일 전환(화면 전환) 애니메이션 150~200ms — `prefers-reduced-motion` 이면 CSS 가 끈다(AC-U6).
    dayPanel.classList.remove('shuttle-tabpanel--enter');
    void dayPanel.offsetWidth;
    dayPanel.classList.add('shuttle-tabpanel--enter');
  };

  const unsubscribe = store.subscribe((state) => {
    latestState = state;
    evaluateSplash(state);
    const structureKey = [
      state.status,
      state.dayType,
      state.model?.source.fetchedAt ?? '',
      state.errorMessage ?? '',
      // 캐시 폴백 여부가 바뀌면 배너를 다시 그려야 한다(T6 — 오프라인 안내).
      state.dataSource ?? '',
      state.offlineReason ?? '',
      state.cacheAgeMs ?? '',
      state.model?.routes.length ?? 0,
      // KST 날짜가 바뀌면(23:59 → 00:01) 상단 바·안내 줄·시간표가 다음 날로 넘어가야 한다.
      dayKey(state.nowMs),
    ].join('|');
    if (structureKey !== lastStructureKey) {
      const first = lastStructureKey === '';
      lastStructureKey = structureKey;
      // 자동 스크롤은 진입·요일 전환·새로고침(구조 변경) 때만. 진입(status=loading)에는 대상이 없다.
      renderStructure(state, { autoScroll: state.status !== 'loading' || !first });
      return;
    }
    renderLive(state);
  });

  return () => {
    unsubscribe();
    document.removeEventListener('keydown', onKeyDown);
    cancelMove();
    closeToast();
    window.clearTimeout(splashMaxTimer);
    if (splashTimer !== null) window.clearTimeout(splashTimer);
  };
}

function defaultReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function renderBanner(state: ScheduleState, options: SchedulePageOptions): HTMLElement | null {
  // 로딩 중에는 스켈레톤 카드가 그 자리를 맡는다(빈 화면·텍스트만 금지 — docs/07 §5).
  if (state.status === 'loading') return null;
  if (state.errorMessage !== null) {
    // 데이터를 못 읽어도 **학교 안내 페이지로 갈 길**은 남긴다(조용한 실패 금지).
    // ⚠️ 모델이 있을 때는 정보 시트(출처 1줄)가 링크를 갖는다 — 화면에 학교 링크가 2개가 되지 않게 한다.
    const sourceHref = state.model === null ? FALLBACK_SOURCE_URL : null;
    return el(
      'div',
      { class: 'shuttle-banner shuttle-banner--error', attrs: { role: 'alert' }, dataset: { testid: 'data-error' } },
      [
        el('p', {}, [el('strong', { text: UI_TEXT.dataErrorTitle })]),
        el('p', { text: `${UI_TEXT.dataErrorDetailPrefix}: ${state.errorMessage}` }),
        sourceHref === null
          ? null
          : el('p', {}, [
              el('a', {
                attrs: { href: sourceHref, target: '_blank', rel: 'noopener noreferrer' },
                dataset: { testid: 'source-link' },
                text: UI_TEXT.sourceLinkLabel,
              }),
            ]),
        el('p', {}, [
          button({
            label: UI_TEXT.dataErrorRetry,
            variant: 'primary',
            onClick: () => {
              options.onRetry();
            },
          }),
        ]),
      ],
    );
  }
  // 캐시·앱 안 사본으로 그린 화면이어도 **안내 문구를 띄우지 않는다**(2026-11-08 사용자 결정).
  // 데이터가 언제 것인지는 이용 안내 시트의 "최신 데이터" 줄이 보여 준다. 연결이 돌아오면 앱이 알아서 새로 받는다.
  return null;
}


/**
 * 오늘(KST) 날짜 키 — 자정을 넘으면 값이 바뀌므로 구조 재렌더를 유발한다.
 */
function dayKey(nowMs: number): string {
  return formatIsoDate(kstDayFromInstant(new Date(nowMs)));
}

/** 스플래시 — 진입 경험(T24 · §3). 실제 타이머는 페이지가 관리한다. */
function splashScreen(): HTMLElement {
  return el(
    'div',
    {
      class: 'shuttle-splash',
      attrs: { role: 'status', 'aria-live': 'polite' },
      dataset: { testid: 'splash' },
    },
    [
      el('img', {
        class: 'shuttle-splash__logo',
        attrs: { src: './icons/icon-192.png', alt: '', width: '96', height: '96' },
      }),
      el('p', { class: 'shuttle-splash__title', text: UI_TEXT.appBarTitle }),
      spinner(),
      el('p', { class: 'shuttle-splash__message', text: UI_TEXT.splashMessage }),
    ],
  );
}
