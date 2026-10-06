/**
 * 페이지: 시간표 화면 조립 (features/schedule/pages) — 라우트 1개 = 파일 1개.
 *
 * 하는 일: 상태를 받아 **앱 셸을 조립**하고 로딩/에러/스플래시를 표시한다.
 * 하지 않는 일: 계산(요일·시각·운행 판정·편수는 `selectors`+도메인), 데이터 요청(api 계층).
 *
 * T24 — 모바일 앱 셸(docs/07-mobile-ux.md). 예전에는 모든 것을 한 화면에 쌓았지만("그냥 다 박아놨네")
 * 이제는 **앱바 + 화면 2개(지금/전체) + 하단 탭바 + 이용 안내 시트**로 나눈다:
 *
 *   앱바(appbarHost)            제목 `선문대 셔틀` + 오늘 날짜·시각(KST) + 새로고침(스피너)
 *   ── [지금] 탭(기본, #shuttle-tabpanel-now) ──────────────────────────────
 *     ① 배너: 오류/오프라인 → ② 오늘 안내 배너 **1개**(운행없음/대체 > 방학, docs/07 §4-1 ③)
 *     ③ 소개문구(한/영 · T14 계약) ④ 다음 출발 카드 ⑤ 지금 탈 수 있는 편 목록(5편 + 더 보기)
 *     ⑥ 바로가기 카드 2개(전체 시간표 보기 · 이용 안내) ⑦ 설치 안내(1회)
 *     ⚠️ 출처·고지·정차창·다가오는 변동은 여기 두지 않는다(전체/안내로 이동)
 *   ── [전체] 탭(#shuttle-tabpanel-all) ───────────────────────────────────
 *     ① 요일 탭(평일/토/일) ② 방향 필터 칩 ③ 전체 편 목록(사유 배지·약 N분 소요)
 *     ④ 다가오는 운행 변동(14일·최대 2줄) ⑤ 데이터 갱신 1줄 + 출처·고지
 *   ── 이용 안내 시트(#guide-sheet, 기본 숨김) ────────────────────────────
 *     정차창 · 요금·지연 안내 · 시내버스 참고 · 방학 링크(기간이 있을 때만) · 비공식 고지
 *   ── 스플래시 ──────────────────────────────────────────────────────────
 *     진입 시 항상 표시 → 데이터 준비 시 200ms 페이드아웃(최소 400ms / 최대 2.5s — `data/splash.ts`)
 *
 * 갱신 전략
 * - 구조 변경(데이터 로드·요일 선택·날짜 변경) → 전체 재렌더.
 * - 시각만 변경(60초 틱) → 앱바 시계·보드·전체 목록·최신 데이터 줄만 부분 재렌더(포커스·스크롤 보존).
 */
import { el, replaceChildren } from '../../../shared/lib/dom';
import { button } from '../../../shared/ui/atoms/Button';
import { spinner } from '../../../shared/ui/atoms/Spinner';
import { formatCacheAge } from '../../../../../../application/cache/timetableCachePolicy';
import { DAY_TYPES } from '../../../../../../domain/entities/DayType';
import { formatIsoDate, kstDayFromInstant } from '../../../../../../domain/rules/kst';
import {
  dayTabs,
  dayTabsWithoutModel,
  freshnessView,
  fullDayView,
  noticeGroups,
  serviceNoticeView,
  stopWindowLines,
  todayBoardView,
  upcomingChanges,
  vacationNotice,
  type DirectionFilter,
  type VacationView,
} from '../store/selectors';
import type { ScheduleState, ScheduleStore } from '../store/scheduleStore';
import { UI_TEXT, FALLBACK_SOURCE_URL } from '../types/texts';
import { dayTabs as dayTabsMolecule, dayTabId } from '../components/molecules/DayTabs';
import { directionFilter } from '../components/molecules/DirectionFilter';
import { installHint } from '../components/molecules/InstallHint';
import { skeletonCards } from '../components/molecules/SkeletonCards';
import { appTabs, appTabId, appTabPanelId } from '../components/molecules/AppTabs';
import { dataRefreshLine } from '../components/organisms/DataRefreshLine';
import { departureList } from '../components/organisms/DepartureList';
import { fullTimetableList } from '../components/organisms/FullTimetableList';
import { guideSheet } from '../components/organisms/GuideSheet';
import { serviceNoticeBanner } from '../components/organisms/ServiceNoticeBanner';
import { shortcutCard } from '../components/organisms/ShortcutCard';
import { sourceFooter } from '../components/organisms/SourceFooter';
import { splashScreen } from '../components/organisms/SplashScreen';
import { upcomingBoardCard } from '../components/organisms/UpcomingBoardCard';
import { upcomingChangeBanner } from '../components/organisms/UpcomingChanges';
import { vacationNoticeBanner } from '../components/organisms/VacationNotice';
import type { InstallHintPlatform } from '../api/installHintApi';
import { APP_TABS, type AppTab } from '../data/appTab';
import { SPLASH_MAX_MS, decideSplash, splashFadeMs, type SplashHideReason } from '../data/splash';

const TAB_ID_PREFIX = 'shuttle-day';
const TAB_PANEL_ID = 'shuttle-day-panel';
const INSTALL_HEADING_ID = 'shuttle-install-heading';
const NOTICE_HEADING_ID = 'shuttle-v1-notice-heading';
const BOARD_HEADING_ID = 'shuttle-v1-board-heading';
const BOARD_LIST_HEADING_ID = 'shuttle-v1-board-list-heading';
const REFRESH_HEADING_ID = 'shuttle-data-refresh-heading';
const UPCOMING_HEADING_ID = 'shuttle-upcoming-change-heading';
const VACATION_HEADING_ID = 'shuttle-vacation-heading';
const SHORTCUT_HEADING_ID = 'shuttle-shortcut-heading';
const DAY_TABS_HEADING_ID = 'shuttle-day-tabs-heading';
const FULL_LIST_HEADING_ID = 'shuttle-full-list-heading';
const GUIDE_HEADING_ID = 'shuttle-guide-heading';
const GUIDE_NOTICE_HEADING_ID = 'shuttle-guide-notice-heading';
const SOURCE_HEADING_ID = 'shuttle-source-heading';

/** 스플래시 계측값(스모크 증거용) — 화면에 붙는 값이 아니라 계측용이라 window 에 남긴다. */
interface SplashMetric {
  shownAt: number;
  hiddenAt: number | null;
  reason: SplashHideReason | null;
}

export interface SchedulePageOptions {
  readonly onRetry: () => void;
  /** 앱바 새로고침(수동 갱신) — 재로딩은 app/mount.ts 가 소유한다. */
  readonly onRefresh: () => void;
  /** 진입 시 보여줄 탭(마지막 탭 유지 — `data/appTab.ts`) */
  readonly initialTab: AppTab;
  /** 탭 전환을 저장소에 남기는 일은 조립 지점(app/mount.ts)이 한다. */
  readonly onTabChange: (tab: AppTab) => void;
  /** 설치 안내에 쓸 플랫폼 문구 — null 이면 안내를 띄우지 않는다(이미 설치됨·닫음). */
  readonly installHint: InstallHintPlatform | null;
  readonly onDismissInstallHint: () => void;
  /** 스플래시 시간 계측용 **단조 시각**(기본 `performance.now`) — 테스트 주입용. */
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
  const serviceNoticeHost = host('service-notice-host');
  const vacationHost = host('vacation-host');
  const boardHost = host('board-host');
  const shortcutHost = host('shortcut-host');
  const tabsHost = host('tabs-host');
  const installHost = host('install-host');
  const filterHost = host('filter-host');
  const fullListHost = host('full-list-host');
  const upcomingHost = host('upcoming-host');
  const refreshHost = host('refresh-host');
  const footerHost = host('footer-host');
  const sheetHost = host('sheet-host');
  const tabbarHost = host('tabbar-host');

  /** ① 앱바 — 제목 + 오늘 날짜·시각 + 새로고침. 값만 갱신하고 노드는 재사용한다(포커스 보존). */
  const clockNode = el('time', { attrs: { datetime: '' }, dataset: { testid: 'app-clock' } });
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
  const splashMetric: SplashMetric = { shownAt: splashStartedAt, hiddenAt: null, reason: null };
  (window as unknown as { __shuttleSplash?: SplashMetric }).__shuttleSplash = splashMetric;

  let splashHidden = false;
  let splashTimer: number | null = null;

  replaceChildren(root, [
    el('div', { class: 'shuttle-app' }, [
      el('a', { class: 'shuttle-skip-link', attrs: { href: '#shuttle-main' }, text: UI_TEXT.skipToContent }),
      el('header', { class: 'shuttle-appbar', dataset: { testid: 'appbar' } }, [
        el('div', { class: 'shuttle-appbar__lead' }, [
          el('h1', { class: 'shuttle-appbar__title', text: UI_TEXT.appBarTitle }),
          el('p', { class: 'shuttle-clock' }, [
            el('span', { class: 'shuttle-clock__prefix', text: UI_TEXT.clockLabelPrefix }),
            clockNode,
          ]),
        ]),
        refreshNode,
      ]),
      el('main', { class: 'shuttle-scroll', attrs: { id: 'shuttle-main', tabindex: '-1' } }, [
        // ── [지금] 화면(기본 탭) — "지금 탈 수 있는 것"만 남긴다(docs/07 §4-1) ──
        el(
          'section',
          {
            class: 'shuttle-tabpanel',
            attrs: { id: appTabPanelId('now'), role: 'tabpanel', 'aria-labelledby': appTabId('now'), tabindex: '0' },
            dataset: { testid: 'tabpanel-now' },
          },
          [
            bannerHost,
            serviceNoticeHost,
            vacationHost,
            // ③ 소개문구(한/영) — T14 계약: 이 앱이 무엇을 하는지 그대로 말한다.
            el('p', { class: 'shuttle-header__subtitle', text: UI_TEXT.appSubtitle }),
            el('p', { class: 'shuttle-header__subtitle', attrs: { lang: 'en' }, text: UI_TEXT.appSubtitleEn }),
            boardHost,
            shortcutHost,
            installHost,
          ],
        ),
        // ── [전체] 화면 — 요일 탭 + 방향 필터 + 전체 목록 + 변동 + 출처(docs/07 §4-2) ──
        el(
          'section',
          {
            class: 'shuttle-tabpanel',
            attrs: {
              id: appTabPanelId('all'),
              role: 'tabpanel',
              'aria-labelledby': appTabId('all'),
              tabindex: '0',
              hidden: '',
            },
            dataset: { testid: 'tabpanel-all' },
          },
          [
            el('section', { class: 'shuttle-section', dataset: { testid: 'day-tabs-section' } }, [
              el('h2', { class: 'shuttle-section__title', attrs: { id: DAY_TABS_HEADING_ID }, text: UI_TEXT.dayTabLegend }),
              tabsHost,
              // 요일 탭이 제어하는 패널 — 방향 필터 + 전체 편 목록
              el(
                'div',
                {
                  class: 'shuttle-main',
                  attrs: { id: TAB_PANEL_ID, role: 'tabpanel', tabindex: '0' },
                  dataset: { testid: 'day-panel' },
                },
                [filterHost, fullListHost],
              ),
            ]),
            upcomingHost,
            refreshHost,
            footerHost,
          ],
        ),
      ]),
      tabbarHost,
      sheetHost,
      splashNode,
    ]),
  ]);

  let appTab: AppTab = options.initialTab;
  tabbarHost.appendChild(
    appTabs({
      value: appTab,
      onSelect: (tab) => {
        setAppTab(tab);
        options.onTabChange(tab);
      },
    }),
  );

  /** 탭 전환 — 패널 표시/`aria-selected`/roving tabindex 를 **노드 재사용**으로 갱신한다(포커스 보존). */
  function setAppTab(tab: AppTab): void {
    appTab = tab;
    for (const candidate of APP_TABS) {
      const selected = candidate === tab;
      const panel = root.querySelector<HTMLElement>(`#${appTabPanelId(candidate)}`);
      if (panel !== null) {
        if (selected) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
        panel.classList.remove('shuttle-tabpanel--enter');
        if (selected) {
          // 150~200ms 페이드/슬라이드 — `prefers-reduced-motion` 이면 CSS 가 애니메이션을 끈다(AC-U6).
          void panel.offsetWidth;
          panel.classList.add('shuttle-tabpanel--enter');
        }
      }
      const tabNode = root.querySelector<HTMLElement>(`#${appTabId(candidate)}`);
      if (tabNode !== null) {
        tabNode.setAttribute('aria-selected', selected ? 'true' : 'false');
        tabNode.setAttribute('tabindex', selected ? '0' : '-1');
      }
    }
  }
  setAppTab(appTab);

  /**
   * 스플래시 숨김 — 페이드아웃(200ms, reduced-motion 이면 즉시) 후 노드를 제거하고
   * 포커스를 본문 첫 요소(현재 탭 패널)로 옮긴다(docs/07 §3).
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
    if (active === null || active === document.body) {
      root.querySelector<HTMLElement>(`#${appTabPanelId(appTab)}`)?.focus();
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
  }

  /** 상한(2.5s) — 로딩이 길어져도 스플래시에 갇히지 않고 스켈레톤/캐시 폴백으로 진행한다(AC-U5). */
  const splashMaxTimer = window.setTimeout(() => {
    if (!splashHidden) hideSplash('timeout');
  }, SPLASH_MAX_MS);

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

  /** 이용 안내 시트 열림/닫힘 — 표현(표시·포커스)만 페이지가 관리한다. */
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
    root.querySelector<HTMLElement>('[data-testid="shortcut-guide"]')?.focus();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && guideOpen) {
      event.preventDefault();
      setGuideOpen(false);
    }
  };
  document.addEventListener('keydown', onKeyDown);

  let lastStructureKey = '';
  let latestState: ScheduleState | null = null;
  /** [전체] 화면의 방향 필터(일시적 UI 상태) — 페이지가 소유한다(스킬 §5). */
  let fullFilter: DirectionFilter = 'all';

  /**
   * 설치 안내(T7) — 표시 여부는 **페이지가 지역 상태로** 갖는다(스토어와 무관한 UI 안내).
   * 닫으면 지역 상태를 내리고 `onDismissInstallHint` 로 저장(1회 표시)을 위임한다.
   */
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
    if (node.id.startsWith(`${TAB_ID_PREFIX}-tab-`)) return `tab:${node.id}`;
    const testid = node.getAttribute('data-testid');
    if (testid === 'direction-chip') return `chip:${node.getAttribute('data-direction') ?? ''}`;
    return null;
  };

  const restoreFocus = (key: string | null): void => {
    if (key === null) return;
    if (key.startsWith('chip:')) {
      const direction = key.slice('chip:'.length);
      root.querySelector<HTMLElement>(`[data-testid="direction-chip"][data-direction="${direction}"]`)?.focus();
      return;
    }
    root.querySelector<HTMLElement>(`#${key.slice('tab:'.length)}`)?.focus();
  };

  /** 앱바 — 오늘 날짜·현재 시각(KST) + 새로고침 진행 표시. 60초 틱마다 갱신된다. */
  const renderAppbar = (state: ScheduleState): void => {
    const view = todayBoardView(state);
    clockNode.setAttribute('datetime', new Date(state.nowMs).toISOString());
    clockNode.textContent = view.clockLabel;
    const busy = state.status === 'loading';
    refreshNode.setAttribute('aria-busy', busy ? 'true' : 'false');
    refreshNode.setAttribute('aria-label', busy ? UI_TEXT.refreshBusyLabel : UI_TEXT.refreshLabel);
    refreshSpinner.hidden = !busy;
  };

  /** 오늘 안내 배너 — 운행 없음 / 대체 시간표 / 방학 중 **최대 1개**(우선순위: 운행없음·대체 > 방학). */
  const renderTodayNotices = (state: ScheduleState): { readonly sheetVacation: VacationView | null } => {
    const notice = serviceNoticeView(state);
    const vacation = vacationNotice(state);
    // 배너는 하나뿐이다 — 운행 여부가 먼저다(docs/07 §4-1 ③).
    const bannerVacation = notice === null ? vacation : null;
    replaceChildren(serviceNoticeHost, [
      notice === null ? null : serviceNoticeBanner({ notice, headingId: NOTICE_HEADING_ID }),
    ]);
    replaceChildren(vacationHost, [
      bannerVacation === null ? null : vacationNoticeBanner({ view: bannerVacation, headingId: VACATION_HEADING_ID }),
    ]);
    // 배너가 못 보여준 방학은 이용 안내 시트가 링크를 갖는다(화면에 학교 링크 1개 유지 — T14).
    return { sheetVacation: notice === null ? null : vacation };
  };

  /** ④⑤ 다음 출발 카드 + 지금 탈 수 있는 편 목록. 데이터 준비 전에는 스켈레톤 카드 3장. */
  const renderBoard = (state: ScheduleState): void => {
    if (state.model === null) {
      replaceChildren(boardHost, state.status === 'loading' ? [skeletonCards({ count: 3 })] : []);
      return;
    }
    const view = todayBoardView(state);
    replaceChildren(boardHost, [
      upcomingBoardCard({ view, headingId: BOARD_HEADING_ID }),
      departureList({ view, headingId: BOARD_LIST_HEADING_ID }),
    ]);
  };

  /** [전체] — 방향 필터 + 전체 편 목록(선택한 요일의 모든 회차). */
  const renderFullList = (state: ScheduleState): void => {
    const view = fullDayView(state, fullFilter);
    replaceChildren(filterHost, [
      // 회차가 하나도 없는 요일(예: 표 없음)에는 `0편` 칩 3개가 소음이다(T13 규칙 유지).
      view.counts.all === 0
        ? null
        : directionFilter({
            value: fullFilter,
            counts: view.counts,
            onSelect: (value: DirectionFilter) => {
              fullFilter = value;
              if (latestState !== null) renderFullList(latestState);
              restoreFocus(`chip:${value}`);
            },
          }),
    ]);
    replaceChildren(fullListHost, [fullTimetableList({ view, headingId: FULL_LIST_HEADING_ID })]);
  };

  /** ⑦ 최신 데이터 1줄(T14) — 앱 기준 `데이터 갱신: <반영 시각>`(+48시간 초과 경고). */
  const renderRefresh = (state: ScheduleState): void => {
    replaceChildren(refreshHost, [
      state.model === null
        ? null
        : dataRefreshLine({ view: freshnessView(state.model, state.nowMs), headingId: REFRESH_HEADING_ID }),
    ]);
  };

  /** 이용 안내 시트 — 모델이 있을 때만 내용을 그린다(정차창·요금·지연 안내·시설 참고·비공식 고지). */
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
            onClose: () => {
              setGuideOpen(false);
            },
          }),
    ]);
    // 재렌더 뒤에도 열려 있었으면 열린 상태를 유지한다(포커스는 닫기 버튼으로).
    if (guideOpen) setGuideOpen(true);
  };

  /** 일시적 UI(바로가기 카드) — 전체 탭 이동 / 이용 안내 열기. */
  const renderShortcuts = (): void => {
    replaceChildren(shortcutHost, [
      shortcutCard({
        headingId: SHORTCUT_HEADING_ID,
        onOpenAll: () => setAppTab('all'),
        onOpenGuide: () => setGuideOpen(true),
      }),
    ]);
  };
  renderShortcuts();

  /** 시각 의존 부분만 다시 그린다(60초 틱 · 구조 변경 직후). */
  const renderLive = (state: ScheduleState): void => {
    renderAppbar(state);
    renderBoard(state);
    renderFullList(state);
    renderRefresh(state);
  };

  const renderStructure = (state: ScheduleState): void => {
    const focusKey = focusKeyOf(document.activeElement);
    const dayPanel = root.querySelector<HTMLElement>(`#${TAB_PANEL_ID}`);
    if (dayPanel !== null) dayPanel.setAttribute('aria-labelledby', dayTabId(TAB_ID_PREFIX, state.dayType));

    replaceChildren(bannerHost, [renderBanner(state, options)]);
    const { sheetVacation } = renderTodayNotices(state);
    replaceChildren(upcomingHost, [
      upcomingChangeBanner({ view: upcomingChanges(state), headingId: UPCOMING_HEADING_ID }),
    ]);
    replaceChildren(tabsHost, [
      dayTabsMolecule({
        tabs: state.model === null ? dayTabsWithoutModel(state.nowMs, DAY_TYPES) : dayTabs(state),
        selected: state.dayType,
        panelId: TAB_PANEL_ID,
        tabIdPrefix: TAB_ID_PREFIX,
        onSelect: (dayType) => {
          store.selectDay(dayType);
        },
      }),
    ]);
    renderSheet(state, sheetVacation);

    if (state.model === null) {
      replaceChildren(footerHost, []);
      renderLive(state);
      restoreFocus(focusKey);
      return;
    }

    const model = state.model;
    replaceChildren(footerHost, [
      sourceFooter({
        model,
        headingId: SOURCE_HEADING_ID,
        hideSourceLink: sheetVacation !== null && sheetVacation.sourceUrl !== null,
      }),
    ]);
    renderLive(state);
    restoreFocus(focusKey);
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
      // KST 날짜가 바뀌면(23:59 → 00:01) 앱바·공지·보드가 다음 날로 넘어가야 한다.
      dayKey(state.nowMs),
    ].join('|');
    if (structureKey !== lastStructureKey) {
      lastStructureKey = structureKey;
      renderStructure(state);
      return;
    }
    renderLive(state);
  });

  return () => {
    unsubscribe();
    document.removeEventListener('keydown', onKeyDown);
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
    // ⚠️ 모델이 있을 때는 푸터(T14 출처 1줄)가 링크를 갖는다 — 화면에 학교 링크가 2개가 되지 않게 한다.
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
 * (요일이 같은 날→다음 날로 넘어가는 경우에도 상태줄·공지·목록이 다음 날로 갱신된다.)
 */
function dayKey(nowMs: number): string {
  return formatIsoDate(kstDayFromInstant(new Date(nowMs)));
}
