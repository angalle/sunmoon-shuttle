/**
 * 분자: 요일 탭 (features/schedule/components/molecules)
 * WAI-ARIA tabs 패턴 — ←/→/Home/End 로 이동·선택, 선택된 탭만 tabindex=0(roving).
 * 도메인 계산 없음(표시 + 이벤트 위임만). 요일 라벨/노선 수는 props 로 받는다.
 */
import { el } from '../../../../shared/lib/dom';
import { tabButton } from '../../../../shared/ui/atoms/TabButton';
import type { DayType } from '../../../../../../../domain/entities/DayType';
import type { DayTabView } from '../../store/selectors';
import { UI_TEXT } from '../../types/texts';

export interface DayTabsProps {
  readonly tabs: readonly DayTabView[];
  readonly selected: DayType;
  /** 탭이 제어하는 패널 id */
  readonly panelId: string;
  readonly tabIdPrefix: string;
  readonly onSelect: (dayType: DayType) => void;
}

export function dayTabs(props: DayTabsProps): HTMLDivElement {
  const container = el('div', {
    class: 'shuttle-daytabs',
    attrs: { role: 'tablist', 'aria-label': UI_TEXT.dayTabLegend },
  });

  const move = (from: number, delta: number | 'home' | 'end'): void => {
    const count = props.tabs.length;
    if (count === 0) return;
    const nextIndex =
      delta === 'home'
        ? 0
        : delta === 'end'
          ? count - 1
          : (from + delta + count) % count;
    const next = props.tabs[nextIndex];
    if (next === undefined) return;
    // 포커스를 먼저 옮긴다 — 재렌더 시 페이지가 activeElement 로 포커스 위치를 복원한다.
    const target = container.querySelector<HTMLButtonElement>(`#${cssId(dayTabId(props.tabIdPrefix, next.dayType))}`);
    target?.focus();
    props.onSelect(next.dayType);
  };

  props.tabs.forEach((tab, index) => {
    const selected = tab.dayType === props.selected;
    const note =
      tab.routeTotal === 0
        ? undefined
        : `노선 ${String(tab.routesWithTable)}/${String(tab.routeTotal)}개`;
    container.appendChild(
      tabButton({
        id: dayTabId(props.tabIdPrefix, tab.dayType),
        controls: props.panelId,
        label: tab.isToday ? `${tab.label} (오늘)` : tab.label,
        ...(note === undefined ? {} : { note }),
        selected,
        tabIndex: selected ? 0 : -1,
        onSelect: () => {
          props.onSelect(tab.dayType);
        },
        onKeyDown: (event) => {
          if (event.key === 'ArrowRight') move(index, 1);
          else if (event.key === 'ArrowLeft') move(index, -1);
          else if (event.key === 'Home') move(index, 'home');
          else if (event.key === 'End') move(index, 'end');
          else return;
          event.preventDefault();
        },
      }),
    );
  });

  return container;
}

export function dayTabId(prefix: string, dayType: string): string {
  return `${prefix}-tab-${dayType}`;
}

/** CSS 선택자용 안전한 id(우리가 만든 값만 들어오지만 방어). */
function cssId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
