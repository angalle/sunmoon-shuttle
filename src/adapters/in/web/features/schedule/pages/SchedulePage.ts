/**
 * 페이지: 시간표 화면 조립 (features/schedule/pages) — 라우트 1개 = 파일 1개.
 *
 * 하는 일: 상태를 받아 **앱 셸을 조립**하고 로딩/에러/스플래시를 표시한다.
 * 하지 않는 일: 계산(요일·시각·운행 판정·편수는 `selectors`+도메인), 데이터 요청(api 계층).
 *
 * T27 — 시간표 중심 단순화(docs/07-mobile-ux.md §9). T24 의 화면 분리([지금]/[전체] 탭)를 없애고
 * **본문 = 시간표 하나**로 만든다:
 *
 *   상단 바(appbarHost)   현재 날짜·시각(분 단위 갱신) + ⓘ(정보 시트) + 새로고침 — 스크롤해도 고정
 *   ── 본문(#shuttle-main, 스크롤 영역) ──────────────────────────────────────
 *     ① 상단 바 아래 **최소 1줄**(예외): 오늘 운행 없음(+다음 운행) · 대체 시간표 · 방학 · 오늘 종료
 *     ② 요일 탭(평일/토/일) + 방향 필터 칩 — 시간표의 축
 *     ③ **시간표 목록 하나**(그 요일 전체 회차): 지난 편 dim · 다음 출발 행 살짝 강조(좌측 라인+배경 톤)
 *        · 요일 조건은 **짧은 토큰 1개 이하**(`금 휴`)
 *   ── 정보 시트(ⓘ, 기본 숨김) ──────────────────────────────────────────────
 *     출처(학교 링크 1개) · `데이터 갱신` · 요금/지연 안내 · 정차창 · 방학 링크 · 비공식 고지 ·
 *     미해석 경고(내부) · 개인정보처리방침 — §9-5 로 본문에서 걷어낸 것들
 *   ── 우하단 이동 버튼 2개(T28 · §10-1) ────────────────────────────────────
 *     `현재 시간으로`(다음 출발 행으로 — §9-3 로직 재사용, **억제 상태여도 동작**) · `맨 위로`
 *   ── 스플래시 ────────────────────────────────────────────────────────────
 *     진입 시 항상 표시 → 데이터 준비 시 200ms 페이드아웃(최소 400ms / 최대 2.5s — `data/splash.ts`)
 *
 * 자동 스크롤(§9-3)
 * - 진입·요일 전환·새로고침 후 **다음 출발 행**이 상단 바 바로 아래에 오도록 스크롤한다(즉시 이동).
 * - 사용자가 직접 스크롤한 뒤 **3초** 안에는 다시 스크롤하지 않는다(주기적 재스크롤 금지 — 60초 틱은 스크롤하지 않는다).
 * - 단, **이동 버튼(`현재 시간으로`)은 억제를 해제하고 항상 동작**한다(§10-1). 버튼 이동은
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
import { formatCacheAge } from '../../../../../../application/cache/timetableCachePolicy';
import { DAY_TYPES } from '../../../../../../domain/entities/DayType';
import { formatIsoDate, kstDayFromInstant } from '../../../../../../domain/rules/kst';
import {
  dayNoticeLine,
  dayTabs,
  dayTabsWithoutModel,
  freshnessView,
  noticeGroups,
  stopWindowLines,
  todayBoardView,
  timetableView,
  upcomingChanges,
  vacationNotice,
  type DirectionFilter,
  type TimetableView,
  type VacationView,
} from '../store/selectors';
import type { ScheduleState, ScheduleStore } from '../store/scheduleStore';
import { UI_TEXT, FALLBACK_SOURCE_URL } from '../types/texts';
import { dayTabs as dayTabsMolecule, dayTabId } from '../components/molecules/DayTabs';
import { directionFilter } from '../components/molecules/DirectionFilter';
import { installHint } from '../components/molecules/InstallHint';
import { skeletonCards } from '../components/molecules/SkeletonCards';
import { dailyTimetable } from '../components/organisms/DailyTimetable';
import { dayNotice } from '../components/organisms/DayNotice';
import { guideSheet } from '../components/organisms/GuideSheet';
import { moveButtons } from '../components/molecules/MoveButtons';
import type { InstallHintPlatform } from '../api/installHintApi';
import { SPLASH_MAX_MS, decideSplash, splashFadeMs, type SplashHideReason } from '../data/splash';

const TAB_ID_PREFIX = 'shuttle-day';
const DAY_PANEL_ID = 'shuttle-day-panel';
const INSTALL_HEADING_ID = 'shuttle-install-heading';
const LIST_HEADING_ID = 'shuttle-timetable-heading';
const GUIDE_HEADING_ID = 'shuttle-guide-heading';
const GUIDE_NOTICE_HEADING_ID = 'shuttle-guide-notice-heading';
const SOURCE_HEADING_ID = 'shuttle-source-heading';

/** 사용자가 직접 스크롤한 뒤 자동 스크롤을 쉬는 시간(ms) — docs/07 §9-3 */
export const AUTO_SCROLL_COOLDOWN_MS = 3000;

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
  /** 설치 안내에 쓸 플랫폼 문구 — null 이면 안내를 띄우지 않는다(이미 설치됨·닫음). */
  readonly installHint: InstallHintPlatform | null;
  readonly onDismissInstallHint: () => void;
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
  const listHost = host('list-host');
  const installHost = host('install-host');
  const sheetHost = host('sheet-host');

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
  const refreshSpinner = spinner({ size: 'sm' });
  const refreshNode = button({
    label: UI_TEXT.refreshLabel,
    variant: 'secondary',
    testid: 'app-refresh',
    busy: false,
    leading: refreshSpinner,
    onClick: () => {
      options.onRefresh();
    },
  });
  refreshNode.classList.add('shuttle-appbar__refresh');

  /** ② 스플래시 — 진입 시 표시, 데이터가 준비되면 페이드아웃(최소 400ms · 최대 2.5s). */
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

  const appNode = el('div', { class: 'shuttle-app' }, [
    el('a', { class: 'shuttle-skip-link', attrs: { href: '#shuttle-main' }, text: UI_TEXT.skipToContent }),
    el('header', { class: 'shuttle-appbar', dataset: { testid: 'appbar' } }, [
      // 앱 이름·로고는 화면에 내보내지 않는다(§9-2 — 스플래시가 이미 보여줬다). 낭독기용 제목만 남긴다.
      el('h1', { class: 'shuttle-sr-only', text: UI_TEXT.appTitle }),
      clockNode,
      el('div', { class: 'shuttle-appbar__actions' }, [infoNode, refreshNode]),
    ]),
    // 상단 바 아래 최소 1줄(예외 안내) + 오류·오프라인 안내 — 둘 다 얇은 줄이다(§9-4).
    el('div', { class: 'shuttle-stripbar' }, [bannerHost, noticeHost]),
    scroller,
    sheetHost,
    splashNode,
  ]);
  replaceChildren(root, [appNode]);

  replaceChildren(scroller, [
    el('section', { class: 'shuttle-controls' }, [tabsHost, filterHost]),
    dayPanel,
    installHost,
  ]);
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

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && guideOpen) {
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

  const appbarMargin = (): number => {
    const bar = root.querySelector<HTMLElement>('.shuttle-appbar');
    return bar === null ? 56 : Math.round(bar.getBoundingClientRect().height);
  };

  /**
   * 행의 목표 오프셋 — 행의 **스크롤 영역 기준** 위치에서 `margin`(상단 바 높이)만큼 뺀다(§9-3: 상단 바 바로 아래).
   * `offsetTop`(조상 기준)은 셸 여백·상단 바 높이까지 포함해 목표가 어긋난다(실측: 행이 상단 바 뒤로 16px 들어갔다)
   * → 스크롤포트 사각형으로 계산한다.
   */
  const offsetForRow = (row: HTMLElement, margin: number): number =>
    Math.max(0, Math.round(row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - margin));

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
    const offset = offsetForRow(row, appbarMargin());
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
        scrollToNextDeparture(true);
      },
      onTop: () => {
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
    if (active === null || active === document.body) dayPanel.focus({ preventScroll: true });
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

  /** 데이터 준비 시 하한(400ms)까지만 기다렸다 숨긴다. */
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
  /** 방향 필터(일시적 UI 상태) — 페이지가 소유한다(스킬 §5). */
  let fullFilter: DirectionFilter = 'all';

  /** 설치 안내(T7) — 표시 여부는 페이지가 지역 상태로 갖는다(1회 표시는 저장소가 판단). */
  let installVisible = options.installHint !== null;
  const renderInstall = (): void => {
    const platform = options.installHint;
    replaceChildren(installHost, [
      platform === null || !installVisible
        ? null
        : installHint({
            platform,
            headingId: INSTALL_HEADING_ID,
            onDismiss: () => {
              installVisible = false;
              options.onDismissInstallHint();
              renderInstall();
            },
          }),
    ]);
  };
  renderInstall();

  /**
   * 재렌더로 포커스를 잃지 않게 한다 — 방향 칩은 키보드 사용자의 현재 위치다.
   * 재렌더 전 포커스 키를 읽어, 같은 역할의 새 노드로 되돌린다(접근성: 키보드만으로 조작).
   */
  const focusKeyOf = (node: Element | null): string | null => {
    if (node === null) return null;
    if (node.getAttribute('data-testid') === 'direction-chip') {
      return `chip:${node.getAttribute('data-direction') ?? ''}`;
    }
    // 요일 탭(roving tabindex) — 재렌더로 탭 노드가 새로 만들어지므로 id 로 되돌린다(키보드 사용자 포커스 유지).
    const id = node.id;
    if (id.startsWith(`${TAB_ID_PREFIX}-tab-`)) return `tab:${id}`;
    return null;
  };

  const restoreFocus = (key: string | null): void => {
    if (key === null) return;
    if (key.startsWith('chip:')) {
      const direction = key.slice('chip:'.length);
      root.querySelector<HTMLElement>(`[data-testid="direction-chip"][data-direction="${direction}"]`)?.focus();
      return;
    }
    if (key.startsWith('tab:')) {
      root.querySelector<HTMLElement>(`#${key.slice('tab:'.length)}`)?.focus();
    }
  };

  /** 상단 바 — 현재 날짜·시각(KST, 분 단위) + 새로고침 진행 표시. 60초 틱마다 갱신된다. */
  const renderAppbar = (state: ScheduleState): void => {
    clockNode.setAttribute('datetime', new Date(state.nowMs).toISOString());
    clockNode.textContent = formatKstHeaderClock(state.nowMs);
    const busy = state.status === 'loading';
    refreshNode.setAttribute('aria-busy', busy ? 'true' : 'false');
    refreshNode.setAttribute('aria-label', busy ? UI_TEXT.refreshBusyLabel : UI_TEXT.refreshLabel);
    refreshSpinner.hidden = !busy;
  };

  /** ③ 시간표 목록 하나 — 로딩 중에는 스켈레톤 카드 3장(빈 화면 금지). */
  const renderRows = (state: ScheduleState): TimetableView | null => {
    if (state.model === null) {
      replaceChildren(listHost, state.status === 'loading' ? [skeletonCards({ count: 3 })] : []);
      return null;
    }
    const view = timetableView(state, fullFilter);
    replaceChildren(listHost, [dailyTimetable({ view, headingId: LIST_HEADING_ID })]);
    return view;
  };

  /** ② 방향 필터 칩 — 회차가 하나도 없는 요일에는 그리지 않는다(모두 `0편` = 소음). */
  const renderFilter = (view: TimetableView | null): void => {
    replaceChildren(filterHost, [
      view === null || view.counts.all === 0
        ? null
        : directionFilter({
            value: fullFilter,
            counts: view.counts,
            onSelect: (value: DirectionFilter) => {
              fullFilter = value;
              if (latestState !== null) {
                renderFilter(renderRows(latestState));
                return;
              }
            },
          }),
    ]);
    restoreFocus(`chip:${fullFilter}`);
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
    renderFilter(renderRows(state));
  };

  const renderStructure = (state: ScheduleState, options2: { readonly autoScroll: boolean }): void => {
    const focusKey = focusKeyOf(document.activeElement);
    dayPanel.setAttribute('aria-labelledby', dayTabId(TAB_ID_PREFIX, state.dayType));

    replaceChildren(bannerHost, [renderBanner(state, options)]);
    renderNoticeLine(state);
    replaceChildren(tabsHost, [
      dayTabsMolecule({
        tabs: state.model === null ? dayTabsWithoutModel(state.nowMs, DAY_TYPES) : dayTabs(state),
        selected: state.dayType,
        panelId: DAY_PANEL_ID,
        tabIdPrefix: TAB_ID_PREFIX,
        onSelect: (dayType) => {
          store.selectDay(dayType);
        },
      }),
    ]);

    // 정보 시트: 방학 배너가 링크를 갖지 않으므로(§9-4 얇은 1줄) 시트가 방학 링크를 맡는다.
    renderSheet(state, vacationNotice(state));

    // 본문(시간표) + 필터 + 상단 바 — 시각 의존 부분까지 한 번에 그린다.
    renderLive(state);
    restoreFocus(focusKey);
    // 요일 전환(화면 전환) 애니메이션 150~200ms — `prefers-reduced-motion` 이면 CSS 가 끈다(AC-U6).
    dayPanel.classList.remove('shuttle-tabpanel--enter');
    void dayPanel.offsetWidth;
    dayPanel.classList.add('shuttle-tabpanel--enter');
    if (options2.autoScroll) scrollToNextDeparture();
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
  return renderOfflineNotice(state);
}

/**
 * 오프라인/캐시 폴백 안내(T6 · AC-5·AC-6) — 캐시로 그린 화면임을 숨기지 않는다.
 * `cache-expired`(캐시 나이 ≥ 24h)면 노후 경고를 한 줄 더 붙인다.
 */
function renderOfflineNotice(state: ScheduleState): HTMLElement | null {
  if (state.status !== 'ready' || state.dataSource === null || state.dataSource === 'network') return null;
  const age =
    state.cacheAgeMs === null
      ? UI_TEXT.offlineNoticeAgeUnknown
      : `${formatCacheAge(state.cacheAgeMs)}${state.dataSource === 'cache-expired' ? ' (24시간 초과)' : ''}`;
  return el(
    'div',
    {
      class: 'shuttle-banner shuttle-banner--warn',
      attrs: { role: 'status' },
      dataset: { testid: 'offline-notice', source: state.dataSource },
    },
    [
      el('p', {}, [el('strong', { text: UI_TEXT.offlineNoticeTitle })]),
      state.offlineReason === null
        ? null
        : el('p', { text: `${UI_TEXT.offlineNoticeReasonPrefix}: ${state.offlineReason}` }),
      el('p', { text: `${UI_TEXT.offlineNoticeAgePrefix}: ${age}` }),
      state.dataSource === 'cache-expired' ? el('p', { text: UI_TEXT.offlineNoticeStale }) : null,
    ],
  );
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
