/**
 * 분자: 앱 하단 탭바 (features/schedule/components/molecules) — T24 · docs/07 §2.
 *
 * `지금` / `전체` 2개 탭으로 화면을 나눈다(탭바 56px + safe-area bottom, 터치 ≥48px).
 * WAI-ARIA tabs 패턴: ←/→/Home/End 이동·선택 + roving tabindex(선택된 탭만 0).
 * 키보드 계산은 `data/appTab.ts` 의 순수 함수(`appTabIndexAfterKey`)를 쓴다(여기서 규칙을 다시 만들지 않는다).
 * 도메인 계산 없음 — 표시·이벤트 위임만 한다.
 */
import { el } from '../../../../shared/lib/dom';
import { tabButton } from '../../../../shared/ui/atoms/TabButton';
import { APP_TABS, appTabIndexAfterKey, type AppTab } from '../../data/appTab';
import { UI_TEXT } from '../../types/texts';

const TAB_ID_PREFIX = 'shuttle-tab';

/** 탭 버튼 id — 스모크(`#shuttle-tab-all`)·`aria-labelledby` 계약이다. */
export function appTabId(tab: AppTab): string {
  return `${TAB_ID_PREFIX}-${tab}`;
}

/** 탭이 제어하는 패널 id — 앱 셸의 화면 컨테이너. */
export function appTabPanelId(tab: AppTab): string {
  return `shuttle-tabpanel-${tab}`;
}

function labelOf(tab: AppTab): string {
  return tab === 'now' ? UI_TEXT.appTabNow : UI_TEXT.appTabAll;
}

export interface AppTabsProps {
  readonly value: AppTab;
  readonly onSelect: (tab: AppTab) => void;
}

export function appTabs(props: AppTabsProps): HTMLElement {
  const bar = el('nav', {
    class: 'shuttle-tabbar',
    attrs: { role: 'tablist', 'aria-label': UI_TEXT.appTabLegend },
    dataset: { testid: 'app-tabs' },
  });

  const move = (nextIndex: number | null): void => {
    if (nextIndex === null) return;
    const next = APP_TABS[nextIndex];
    if (next === undefined) return;
    // 포커스를 먼저 옮긴다 — 재렌더 시 페이지가 activeElement 로 포커스 위치를 복원한다.
    bar.querySelector<HTMLButtonElement>(`#${appTabId(next)}`)?.focus();
    props.onSelect(next);
  };

  APP_TABS.forEach((tab, index) => {
    const selected = tab === props.value;
    bar.appendChild(
      tabButton({
        id: appTabId(tab),
        controls: appTabPanelId(tab),
        label: labelOf(tab),
        selected,
        tabIndex: selected ? 0 : -1,
        variant: 'app',
        onSelect: () => {
          props.onSelect(tab);
        },
        onKeyDown: (event) => {
          const nextIndex = appTabIndexAfterKey(index, event.key);
          if (nextIndex === null) return;
          event.preventDefault();
          move(nextIndex);
        },
      }),
    );
  });

  return bar;
}
