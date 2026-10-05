/**
 * 페이지: 시간표 화면 조립 (features/schedule/pages) — 라우트 1개 = 파일 1개.
 *
 * 하는 일: 상태를 받아 **조립**하고 로딩/에러를 표시한다.
 * 하지 않는 일: 계산(요일·시각·운행 판정·편수는 `selectors`+도메인), 데이터 요청(api 계층).
 *
 * V1 홈 구조(T12 · 승인 시안 `docs/mockups/v1-now-first.html`)
 *  ① 상태줄: 앱 제목 + 오늘 날짜·현재 시각(KST, 주입된 clock)
 *  ② 공지 배너(조건부): 오늘 운행 없음 / 대체 시간표 — `resolveDayService` 결과만
 *  ③ 다음 출발 카드: 노선 통합 상위 3편(시각·노선·방향·도착·특이사항)
 *  ④ 방향 필터 칩: 전체 / 학교에서 출발 / 학교로 도착
 *  ⑤ 오늘 남은 출발 목록(다음 12편 + "더 보기")
 *  ⑥ 원본 전체표는 `<details>` 로 접힘(기존 TimetableTable 재사용, 기본 닫힘)
 *  ⑦ 요일 탭은 보조("다른 날 미리보기") — 기본값은 **오늘 자동**(수동 기본값 없음), `?day=` 오버라이드 유지
 *
 * 갱신 전략
 * - 구조 변경(데이터 로드·요일/노선 선택·날짜 변경) → 전체 재렌더.
 * - 시각만 변경(60초 틱) → 상태줄·보드·노선 카드·표·신선도만 부분 재렌더(포커스·스크롤 보존).
 */
import { el, replaceChildren } from '../../../shared/lib/dom';
import { button } from '../../../shared/ui/atoms/Button';
import { formatCacheAge } from '../../../../../../application/cache/timetableCachePolicy';
import { DAY_TYPES } from '../../../../../../domain/entities/DayType';
import { dayTypeLabel } from '../../../../../../domain/rules/dayType';
import { formatIsoDate, kstDayFromInstant } from '../../../../../../domain/rules/kst';
import {
  dayTabs,
  dayTabsWithoutModel,
  freshnessView,
  nextBusView,
  noticeGroups,
  selectedDayTable,
  selectedRoute,
  serviceNoticeView,
  sourceDetailsSummary,
  todayBoardView,
  type DirectionFilter,
  type TodayBoardView,
} from '../store/selectors';
import type { ScheduleState, ScheduleStore } from '../store/scheduleStore';
import { UI_TEXT, FALLBACK_SOURCE_URL } from '../types/texts';
import { dayTabs as dayTabsMolecule, dayTabId } from '../components/molecules/DayTabs';
import { directionFilter } from '../components/molecules/DirectionFilter';
import { installHint } from '../components/molecules/InstallHint';
import { routeList } from '../components/molecules/RouteList';
import { departureList } from '../components/organisms/DepartureList';
import { freshnessPanel } from '../components/organisms/FreshnessPanel';
import { nextBusCard } from '../components/organisms/NextBusCard';
import { noticePanel } from '../components/organisms/NoticePanel';
import { serviceNoticeBanner } from '../components/organisms/ServiceNoticeBanner';
import { sourceFooter } from '../components/organisms/SourceFooter';
import { sourceWarnings } from '../components/organisms/SourceWarnings';
import { timetablePanel } from '../components/organisms/TimetablePanel';
import { upcomingBoardCard } from '../components/organisms/UpcomingBoardCard';
import type { InstallHintPlatform } from '../api/installHintApi';

const TAB_ID_PREFIX = 'shuttle-day';
const TAB_PANEL_ID = 'shuttle-day-panel';
const INSTALL_HEADING_ID = 'shuttle-install-heading';
const NOTICE_HEADING_ID = 'shuttle-v1-notice-heading';
const BOARD_HEADING_ID = 'shuttle-v1-board-heading';
const BOARD_LIST_HEADING_ID = 'shuttle-v1-board-list-heading';
const SOURCE_WARNINGS_HEADING_ID = 'shuttle-source-warnings-heading';

export interface SchedulePageOptions {
  readonly onRetry: () => void;
  /** 설치 안내에 쓸 플랫폼 문구 — null 이면 안내를 띄우지 않는다(이미 설치됨·닫음). */
  readonly installHint: InstallHintPlatform | null;
  readonly onDismissInstallHint: () => void;
}

export function createSchedulePage(
  root: HTMLElement,
  store: ScheduleStore,
  options: SchedulePageOptions,
): () => void {
  const clockHost = el('div', { dataset: { testid: 'clock-host' } });
  const bannerHost = el('div', { dataset: { testid: 'banner' } });
  const serviceNoticeHost = el('div', { dataset: { testid: 'service-notice-host' } });
  const boardHost = el('div', { dataset: { testid: 'board-host' } });
  const tabsHost = el('div', { dataset: { testid: 'tabs-host' } });
  const installHost = el('div', { dataset: { testid: 'install-host' } });
  const panelHost = el('div', { dataset: { testid: 'panel-host' } });
  const nextBusHost = el('div', { dataset: { testid: 'next-bus-host' } });
  const timetableHost = el('div', { dataset: { testid: 'timetable-host' } });
  const warningsHost = el('div', { dataset: { testid: 'warnings-host' } });
  const noticeHost = el('div', { dataset: { testid: 'notice-host' } });
  const freshnessHost = el('div', { dataset: { testid: 'freshness-host' } });
  const footerHost = el('div', { dataset: { testid: 'footer-host' } });
  /**
   * ⑥ 접힘 제목 — 오늘 요일을 명시한다(T13 옵션②). 상태가 바뀔 때마다 문구를 갱신한다.
   * (`source-details` 는 처음 한 번만 만들고, 문구만 부분 갱신한다 — 구조 재렌더 시 스크롤·열림 상태 보존)
   */
  const summary = el('summary', { dataset: { testid: 'source-details-summary' } });

  replaceChildren(root, [
    el('div', { class: 'shuttle-app' }, [
      el('a', { class: 'shuttle-skip-link', attrs: { href: '#shuttle-main' }, text: UI_TEXT.skipToContent }),
      el('header', { class: 'shuttle-header' }, [
        el('h1', { class: 'shuttle-header__title', text: UI_TEXT.appTitle }),
        el('p', { class: 'shuttle-header__subtitle', text: UI_TEXT.appSubtitle }),
        el('p', { class: 'shuttle-header__subtitle', attrs: { lang: 'en' }, text: UI_TEXT.appSubtitleEn }),
        clockHost,
      ]),
      el('main', { class: 'shuttle-main', attrs: { id: 'shuttle-main', tabindex: '-1' } }, [
        bannerHost,
        serviceNoticeHost,
        boardHost,
        el('section', { class: 'shuttle-section', dataset: { testid: 'other-days' } }, [
          el('h2', { class: 'shuttle-section__title', text: UI_TEXT.boardOtherDaysTitle }),
          tabsHost,
        ]),
        installHost,
        el(
          'div',
          {
            class: 'shuttle-main',
            attrs: { id: TAB_PANEL_ID, role: 'tabpanel', tabindex: '0' },
            dataset: { testid: 'day-panel' },
          },
          [
            // ⑥ 원본 전체표·신선도·출처·연락처·미해석 상세는 접어 둔다 — 필요할 때만 펼친다(기본 닫힘).
            //    접힘 제목에 오늘 요일을 명시해 "오늘 시간표를 여기서 확인"하게 한다(T13 옵션②).
            el('details', { class: 'shuttle-details', dataset: { testid: 'source-details' } }, [
              summary,
              panelHost,
              nextBusHost,
              timetableHost,
              warningsHost,
              freshnessHost,
              footerHost,
            ]),
            noticeHost,
          ],
        ),
      ]),
    ]),
  ]);

  let lastStructureKey = '';
  let latestState: ScheduleState | null = null;
  /** 방향 필터(일시적 UI 상태) — 페이지가 소유한다(스킬 §5: 선택 상태는 컴포넌트 로컬). */
  let boardFilter: DirectionFilter = 'all';

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
   * 재렌더로 포커스를 잃지 않게 한다 — 탭/노선/방향 칩 버튼은 키보드 사용자의 현재 위치다.
   * 재렌더 전 포커스 키를 읽어, 같은 역할의 새 노드로 되돌린다(접근성: 키보드만으로 조작).
   */
  const focusKeyOf = (node: Element | null): string | null => {
    if (node === null) return null;
    if (node.id.startsWith(`${TAB_ID_PREFIX}-tab-`)) return `tab:${node.id}`;
    const testid = node.getAttribute('data-testid');
    if (testid === 'route-button') return `route:${node.getAttribute('data-route-id') ?? ''}`;
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
    const selector = key.startsWith('tab:')
      ? `#${key.slice('tab:'.length)}`
      : `[data-testid="route-button"][data-route-id="${key.slice('route:'.length)}"]`;
    root.querySelector<HTMLElement>(selector)?.focus();
  };

  /** ① 상태줄 — 오늘 날짜·현재 시각(KST). 60초 틱마다 갱신된다. */
  const renderClock = (state: ScheduleState): void => {
    const view = todayBoardView(state);
    // ⑥ 접힘 제목의 "오늘 M월 D일 (요일)" 도 같은 주입 clock 을 쓴다(자정 경계에서 함께 넘어간다).
    summary.textContent = sourceDetailsSummary(state.nowMs);
    replaceChildren(clockHost, [
      el('p', { class: 'shuttle-clock' }, [
        el('span', { class: 'shuttle-clock__prefix', text: UI_TEXT.clockLabelPrefix }),
        el('time', {
          attrs: { datetime: new Date(state.nowMs).toISOString() },
          dataset: { testid: 'app-clock' },
          text: view.clockLabel,
        }),
      ]),
    ]);
  };

  /** ② 공지 배너(조건부) — 운행 없음 / 대체 시간표. */
  const renderServiceNotice = (state: ScheduleState): void => {
    const notice = serviceNoticeView(state);
    replaceChildren(serviceNoticeHost, [
      notice === null ? null : serviceNoticeBanner({ notice, headingId: NOTICE_HEADING_ID }),
    ]);
  };

  /** ③④⑤ 다음 출발 카드 + 방향 필터 + 오늘 남은 출발 목록. */
  const renderBoard = (view: TodayBoardView): void => {
    replaceChildren(boardHost, [
      upcomingBoardCard({ view, headingId: BOARD_HEADING_ID }),
      // 오늘 남은 편이 없으면(운행 없음·종료) 칩을 그리지 않는다 — `0편` 칩 3개는 소음이다(T13).
      view.directionFilterVisible
        ? directionFilter({
            value: boardFilter,
            counts: view.counts,
            onSelect: (value: DirectionFilter) => {
              boardFilter = value;
              if (latestState !== null) renderBoard(todayBoardView(latestState, boardFilter));
              restoreFocus(`chip:${value}`);
            },
          })
        : null,
      departureList({ view, headingId: BOARD_LIST_HEADING_ID }),
    ]);
  };

  /**
   * ⑥ 미해석 원본 표기 상세 — 홈 첫 화면에는 요약 1줄(`UpcomingBoardCard`)만 두고,
   * 사람이 확인해야 하는 전체 목록은 접힘(`source-details`) 안에서만 보여준다(T13 결함 B).
   */
  const renderWarnings = (view: TodayBoardView): void => {
    replaceChildren(warningsHost, [
      sourceWarnings({ warnings: view.warnings, headingId: SOURCE_WARNINGS_HEADING_ID }),
    ]);
  };

  const renderRouteCard = (state: ScheduleState): void => {
    const route = selectedRoute(state);
    replaceChildren(nextBusHost, [
      // 접힌 원본 영역의 노선별 카드 — 스모크가 상단 V1 카드와 구분하도록 별도 testid 를 쓴다.
      nextBusCard({
        view: nextBusView(state),
        routeName: route?.name ?? '—',
        dayLabel: dayTypeLabel(state.dayType),
        headingId: 'shuttle-nextbus-heading',
        testid: 'next-bus-card-route',
      }),
    ]);
  };

  const renderTimetable = (state: ScheduleState): void => {
    replaceChildren(timetableHost, [
      timetablePanel({
        route: selectedRoute(state),
        dayType: state.dayType,
        table: selectedDayTable(state),
        headingId: 'shuttle-timetable-heading',
      }),
    ]);
  };

  const renderFreshness = (state: ScheduleState): void => {
    replaceChildren(freshnessHost, [
      state.model === null
        ? null
        : freshnessPanel({ view: freshnessView(state.model, state.nowMs), headingId: 'shuttle-freshness-heading' }),
    ]);
  };

  /** 시각 의존 부분만 다시 그린다(60초 틱 · 구조 변경 직후). */
  const renderLive = (state: ScheduleState): void => {
    const view = todayBoardView(state, boardFilter);
    renderClock(state);
    renderBoard(view);
    renderWarnings(view);
    renderRouteCard(state);
    renderTimetable(state);
    renderFreshness(state);
  };

  const renderStructure = (state: ScheduleState): void => {
    const focusKey = focusKeyOf(document.activeElement);
    const dayPanel = root.querySelector<HTMLElement>(`#${TAB_PANEL_ID}`);
    if (dayPanel !== null) dayPanel.setAttribute('aria-labelledby', dayTabId(TAB_ID_PREFIX, state.dayType));

    replaceChildren(bannerHost, [renderBanner(state, options)]);
    renderServiceNotice(state);
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

    if (state.model === null) {
      replaceChildren(panelHost, []);
      replaceChildren(noticeHost, []);
      replaceChildren(footerHost, []);
      renderLive(state);
      restoreFocus(focusKey);
      return;
    }

    const model = state.model;
    replaceChildren(panelHost, [
      routeList({
        routes: model.routes,
        selectedRouteId: state.routeId,
        dayType: state.dayType,
        onSelect: (routeId) => {
          store.selectRoute(routeId);
        },
      }),
    ]);
    replaceChildren(noticeHost, [
      noticePanel({ groups: noticeGroups(model), busRefs: model.busRefs, headingId: 'shuttle-notice-heading' }),
    ]);
    replaceChildren(footerHost, [sourceFooter({ model, headingId: 'shuttle-source-heading' })]);
    renderLive(state);
    restoreFocus(focusKey);
  };

  return store.subscribe((state) => {
    latestState = state;
    const structureKey = [
      state.status,
      state.dayType,
      state.routeId ?? '',
      state.model?.source.fetchedAt ?? '',
      state.errorMessage ?? '',
      // 캐시 폴백 여부가 바뀌면 배너를 다시 그려야 한다(T6 — 오프라인 안내).
      state.dataSource ?? '',
      state.offlineReason ?? '',
      state.cacheAgeMs ?? '',
      state.model?.routes.length ?? 0,
      // KST 날짜가 바뀌면(23:59 → 00:01) 상태줄·공지·보드가 다음 날로 넘어가야 한다.
      dayKey(state.nowMs),
    ].join('|');
    if (structureKey !== lastStructureKey) {
      lastStructureKey = structureKey;
      renderStructure(state);
      return;
    }
    renderLive(state);
  });
}

function renderBanner(state: ScheduleState, options: SchedulePageOptions): HTMLElement | null {
  if (state.status === 'loading') {
    return el('p', { class: 'shuttle-banner', attrs: { role: 'status' }, dataset: { testid: 'loading' }, text: UI_TEXT.loading });
  }
  if (state.errorMessage !== null) {
    return el(
      'div',
      { class: 'shuttle-banner shuttle-banner--error', attrs: { role: 'alert' }, dataset: { testid: 'data-error' } },
      [
        el('p', {}, [el('strong', { text: UI_TEXT.dataErrorTitle })]),
        el('p', { text: `${UI_TEXT.dataErrorDetailPrefix}: ${state.errorMessage}` }),
        // 데이터를 못 읽어도 **원본 페이지로 갈 길**은 남긴다(조용한 실패 금지).
        el('p', {}, [
          el('a', {
            attrs: { href: state.model?.source.url ?? FALLBACK_SOURCE_URL, target: '_blank', rel: 'noopener noreferrer' },
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
