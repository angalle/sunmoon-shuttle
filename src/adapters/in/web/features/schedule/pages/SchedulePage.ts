/**
 * 페이지: 시간표 화면 조립 (features/schedule/pages) — 라우트 1개 = 파일 1개.
 *
 * 하는 일: 데이터 로딩 상태·선택 상태를 받아 **조립**하고 로딩/에러를 표시한다.
 * 하지 않는 일: 계산(요일·시각·운행 판정은 도메인+selectors), 데이터 요청(api 계층).
 *
 * 갱신 전략
 * - 구조 변경(데이터 로드·요일/노선 선택) → 전체 재렌더.
 * - 시각만 변경(60초 틱) → 다음 버스 카드·신선도만 부분 재렌더(포커스·스크롤 보존).
 */
import { el, replaceChildren } from '../../../shared/lib/dom';
import { button } from '../../../shared/ui/atoms/Button';
import { DAY_TYPES } from '../../../../../../domain/entities/DayType';
import { dayTypeFromDate, dayTypeLabel } from '../../../../../../domain/rules/dayType';
import {
  dayTabs,
  dayTabsWithoutModel,
  freshnessView,
  nextBusView,
  noticeGroups,
  selectedDayTable,
  selectedRoute,
} from '../store/selectors';
import type { ScheduleState, ScheduleStore } from '../store/scheduleStore';
import { UI_TEXT, FALLBACK_SOURCE_URL } from '../types/texts';
import { dayTabs as dayTabsMolecule, dayTabId } from '../components/molecules/DayTabs';
import { routeList } from '../components/molecules/RouteList';
import { freshnessPanel } from '../components/organisms/FreshnessPanel';
import { nextBusCard } from '../components/organisms/NextBusCard';
import { noticePanel } from '../components/organisms/NoticePanel';
import { sourceFooter } from '../components/organisms/SourceFooter';
import { timetablePanel } from '../components/organisms/TimetablePanel';

const TAB_ID_PREFIX = 'shuttle-day';
const TAB_PANEL_ID = 'shuttle-day-panel';

export interface SchedulePageOptions {
  readonly onRetry: () => void;
}

export function createSchedulePage(
  root: HTMLElement,
  store: ScheduleStore,
  options: SchedulePageOptions,
): () => void {
  const bannerHost = el('div', { dataset: { testid: 'banner' } });
  const tabsHost = el('div', { dataset: { testid: 'tabs-host' } });
  const panelHost = el('div', { dataset: { testid: 'panel-host' } });
  const nextBusHost = el('div', { dataset: { testid: 'next-bus-host' } });
  const timetableHost = el('div', { dataset: { testid: 'timetable-host' } });
  const noticeHost = el('div', { dataset: { testid: 'notice-host' } });
  const freshnessHost = el('div', { dataset: { testid: 'freshness-host' } });
  const footerHost = el('div', { dataset: { testid: 'footer-host' } });

  replaceChildren(root, [
    el('div', { class: 'shuttle-app' }, [
      el('a', { class: 'shuttle-skip-link', attrs: { href: '#shuttle-main' }, text: UI_TEXT.skipToContent }),
      el('header', { class: 'shuttle-header' }, [
        el('h1', { class: 'shuttle-header__title', text: UI_TEXT.appTitle }),
        el('p', { class: 'shuttle-header__subtitle', text: UI_TEXT.appSubtitle }),
      ]),
      el('main', { class: 'shuttle-main', attrs: { id: 'shuttle-main', tabindex: '-1' } }, [
        bannerHost,
        tabsHost,
        el(
          'div',
          {
            class: 'shuttle-main',
            attrs: { id: TAB_PANEL_ID, role: 'tabpanel', tabindex: '0' },
            dataset: { testid: 'day-panel' },
          },
          [panelHost, nextBusHost, timetableHost, noticeHost, freshnessHost],
        ),
        footerHost,
      ]),
    ]),
  ]);

  let lastStructureKey = '';

  /**
   * 재렌더로 포커스를 잃지 않게 한다 — 탭/노선 버튼은 키보드 사용자의 현재 위치다.
   * 재렌더 전 포커스 키를 읽어, 같은 역할의 새 노드로 되돌린다(접근성: 키보드만으로 조작).
   */
  const focusKeyOf = (node: Element | null): string | null => {
    if (node === null) return null;
    if (node.id.startsWith(`${TAB_ID_PREFIX}-tab-`)) return `tab:${node.id}`;
    const testid = node.getAttribute('data-testid');
    if (testid === 'route-button') return `route:${node.getAttribute('data-route-id') ?? ''}`;
    return null;
  };

  const restoreFocus = (key: string | null): void => {
    if (key === null) return;
    const selector = key.startsWith('tab:')
      ? `#${key.slice('tab:'.length)}`
      : `[data-testid="route-button"][data-route-id="${key.slice('route:'.length)}"]`;
    root.querySelector<HTMLElement>(selector)?.focus();
  };

  const renderStructure = (state: ScheduleState): void => {
    const focusKey = focusKeyOf(document.activeElement);
    const dayPanel = root.querySelector<HTMLElement>(`#${TAB_PANEL_ID}`);
    if (dayPanel !== null) dayPanel.setAttribute('aria-labelledby', dayTabId(TAB_ID_PREFIX, state.dayType));

    replaceChildren(bannerHost, [renderBanner(state, options)]);
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

    const model = state.model;
    if (model === null) {
      replaceChildren(panelHost, []);
      replaceChildren(noticeHost, []);
      replaceChildren(footerHost, []);
      replaceChildren(nextBusHost, [
        nextBusCard({
          view: nextBusView(state),
          routeName: '—',
          dayLabel: dayTypeLabel(state.dayType),
          headingId: 'shuttle-nextbus-heading',
        }),
      ]);
      replaceChildren(timetableHost, [
        timetablePanel({ route: null, dayType: state.dayType, table: null, headingId: 'shuttle-timetable-heading' }),
      ]);
      replaceChildren(freshnessHost, []);
      restoreFocus(focusKey);
      return;
    }

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

  const renderLive = (state: ScheduleState): void => {
    const route = selectedRoute(state);
    replaceChildren(nextBusHost, [
      nextBusCard({
        view: nextBusView(state),
        routeName: route?.name ?? '—',
        dayLabel: dayTypeLabel(state.dayType),
        headingId: 'shuttle-nextbus-heading',
      }),
    ]);
    replaceChildren(timetableHost, [
      timetablePanel({
        route,
        dayType: state.dayType,
        table: selectedDayTable(state),
        headingId: 'shuttle-timetable-heading',
      }),
    ]);
    replaceChildren(freshnessHost, [
      state.model === null
        ? null
        : freshnessPanel({ view: freshnessView(state.model, state.nowMs), headingId: 'shuttle-freshness-heading' }),
    ]);
  };

  return store.subscribe((state) => {
    const structureKey = [
      state.status,
      state.dayType,
      state.routeId ?? '',
      state.model?.source.fetchedAt ?? '',
      state.errorMessage ?? '',
      state.model?.routes.length ?? 0,
      todayKey(state.nowMs),
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
  return null;
}

/** 오늘(KST) 요일 구분 — 도메인 규칙 사용(자정 넘어가면 탭 구조가 바뀌므로 키에 포함). */
function todayKey(nowMs: number): string {
  const dayType = dayTypeFromDate(new Date(nowMs));
  return dayType;
}
