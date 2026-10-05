/**
 * 페이지: 시간표 화면 조립 (features/schedule/pages) — 라우트 1개 = 파일 1개.
 *
 * 하는 일: 상태를 받아 **조립**하고 로딩/에러를 표시한다.
 * 하지 않는 일: 계산(요일·시각·운행 판정·편수는 `selectors`+도메인), 데이터 요청(api 계층).
 *
 * T14 홈 구조 — 앱은 **수집된 JSON 만** 읽어 보여준다(학교 사이트를 실시간으로 읽지 않는다):
 *  ① 상태줄: 앱 제목 + 새 소개문구 + 오늘 날짜·현재 시각(KST, 주입된 clock)
 *  ② 공지 배너(조건부): 오늘 운행 없음 / 대체 시간표 — `resolveDayService` 결과만
 *  ③ 다음 출발 카드: 노선 통합 상위 3편 + 미해석 표기 안내 1줄(판단에 영향 줄 때만)
 *  ④ 방향 필터 칩 + 오늘 남은 출발 목록(다음 5편 + "더 보기")
 *  ⑤ 요일 탭(보조 "다른 날 미리보기") — 기본값은 **오늘 자동**, `?day=` 오버라이드 유지
 *  ⑥ 이용 안내(운행 없는 날·대체 시간표·이용 안내·시내버스 참고) — 안내문 원문 그대로
 *  ⑦ 최신 데이터 1줄: `데이터 갱신: <반영 시각> (<경과>)` (+48시간 초과 경고)
 *  ⑧ 출처·고지: 비공식 고지 + **대표 출처 1줄(링크 1개)** + 개인정보처리방침 + 문의처
 *
 * T14 에서 **없앤 것**(사용자 지시: "원본은 왜 보여?"):
 *  - 접힘 원본표(`details[data-testid="source-details"]`)와 그 안의 `TimetableTable` 렌더
 *  - 노선 선택(`RouteList`) · 노선별 다음 버스 카드(`NextBusCard`) · 시간표 패널(`TimetablePanel`)
 *  - 노선·요일별 출처 페이지 링크 목록 · contentHash 등 내부 사정 표기
 *  - 미해석 표기 **상세 목록**(홈에는 판단에 영향을 주는 안내 1줄만)
 *  - 학교 페이지 "최근 업데이트" 2행 신선도 패널 → 앱 기준 1줄
 *
 * 갱신 전략
 * - 구조 변경(데이터 로드·요일 선택·날짜 변경) → 전체 재렌더.
 * - 시각만 변경(60초 틱) → 상태줄·보드·최신 데이터 줄만 부분 재렌더(포커스·스크롤 보존).
 */
import { el, replaceChildren } from '../../../shared/lib/dom';
import { button } from '../../../shared/ui/atoms/Button';
import { formatCacheAge } from '../../../../../../application/cache/timetableCachePolicy';
import { DAY_TYPES } from '../../../../../../domain/entities/DayType';
import { formatIsoDate, kstDayFromInstant } from '../../../../../../domain/rules/kst';
import {
  dayTabs,
  dayTabsWithoutModel,
  freshnessView,
  noticeGroups,
  serviceNoticeView,
  todayBoardView,
  type DirectionFilter,
  type TodayBoardView,
} from '../store/selectors';
import type { ScheduleState, ScheduleStore } from '../store/scheduleStore';
import { UI_TEXT, FALLBACK_SOURCE_URL } from '../types/texts';
import { dayTabs as dayTabsMolecule, dayTabId } from '../components/molecules/DayTabs';
import { directionFilter } from '../components/molecules/DirectionFilter';
import { installHint } from '../components/molecules/InstallHint';
import { dataRefreshLine } from '../components/organisms/DataRefreshLine';
import { departureList } from '../components/organisms/DepartureList';
import { noticePanel } from '../components/organisms/NoticePanel';
import { serviceNoticeBanner } from '../components/organisms/ServiceNoticeBanner';
import { sourceFooter } from '../components/organisms/SourceFooter';
import { upcomingBoardCard } from '../components/organisms/UpcomingBoardCard';
import type { InstallHintPlatform } from '../api/installHintApi';

const TAB_ID_PREFIX = 'shuttle-day';
const TAB_PANEL_ID = 'shuttle-day-panel';
const INSTALL_HEADING_ID = 'shuttle-install-heading';
const NOTICE_HEADING_ID = 'shuttle-v1-notice-heading';
const BOARD_HEADING_ID = 'shuttle-v1-board-heading';
const BOARD_LIST_HEADING_ID = 'shuttle-v1-board-list-heading';
const REFRESH_HEADING_ID = 'shuttle-data-refresh-heading';

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
  const noticeHost = el('div', { dataset: { testid: 'notice-host' } });
  const refreshHost = el('div', { dataset: { testid: 'refresh-host' } });
  const footerHost = el('div', { dataset: { testid: 'footer-host' } });

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
        // 요일 탭이 제어하는 패널 — 이용 안내·최신 데이터·출처만 담는다(원본 표·노선 선택 없음, T14).
        el(
          'div',
          {
            class: 'shuttle-main',
            attrs: { id: TAB_PANEL_ID, role: 'tabpanel', tabindex: '0' },
            dataset: { testid: 'day-panel' },
          },
          [noticeHost, refreshHost, footerHost],
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
   * 재렌더로 포커스를 잃지 않게 한다 — 방향 칩·요일 탭은 키보드 사용자의 현재 위치다.
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

  /** ① 상태줄 — 오늘 날짜·현재 시각(KST). 60초 틱마다 갱신된다. */
  const renderClock = (state: ScheduleState): void => {
    const view = todayBoardView(state);
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

  /** ③④ 다음 출발 카드 + 방향 필터 + 오늘 남은 출발 목록. */
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

  /** ⑦ 최신 데이터 1줄(T14) — 앱 기준 `데이터 갱신: <반영 시각>`(+48시간 초과 경고). */
  const renderRefresh = (state: ScheduleState): void => {
    replaceChildren(refreshHost, [
      state.model === null
        ? null
        : dataRefreshLine({ view: freshnessView(state.model, state.nowMs), headingId: REFRESH_HEADING_ID }),
    ]);
  };

  /** 시각 의존 부분만 다시 그린다(60초 틱 · 구조 변경 직후). */
  const renderLive = (state: ScheduleState): void => {
    const view = todayBoardView(state, boardFilter);
    renderClock(state);
    renderBoard(view);
    renderRefresh(state);
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
      replaceChildren(noticeHost, []);
      replaceChildren(footerHost, []);
      renderLive(state);
      restoreFocus(focusKey);
      return;
    }

    const model = state.model;
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
