/**
 * 분자: 우하단 이동 버튼 (features/schedule/components/molecules) — T28 · docs/07 §10-1.
 *
 * 우하단에 **세로 스택 2개**를 놓는다(문구를 화면에 쓰지 않는다 — 아이콘 + 스크린리더 라벨):
 *  ① `현재 시간으로` — 지금 시각 기준 **다음 출발 행**으로 즉시 이동(§9-3 자동 스크롤 로직 재사용)
 *  ② `맨 위로`       — 목록 맨 위로 즉시 이동
 *
 * 이 분자는 **표현만** 한다(배치·아이콘·라벨·터치 타깃). 이동 규칙(어디로 갈지·억제 해제)은 페이지가 갖는다.
 * 컨테이너가 세로 스택·safe-area 배치를 맡아서 페이지는 노드 하나만 붙이면 된다.
 */
import { el, svgIcon } from '../../../../shared/lib/dom';
import { iconButton } from '../../../../shared/ui/atoms/IconButton';
import { UI_TEXT } from '../../types/texts';

export interface MoveButtonsProps {
  /** `현재 시간으로` — 다음 출발 행으로 이동(억제 상태여도 동작한다). */
  readonly onNow: () => void;
  /** `맨 위로` — 목록 맨 위로 이동. */
  readonly onTop: () => void;
}

/** 시계 아이콘 — 24×24 뷰박스(외부 CDN 없이 코드로 그린다). */
const CLOCK_ICON = [
  { kind: 'circle', cx: 12, cy: 12, r: 9 },
  { kind: 'path', d: 'M12 7.5V12l3.5 2' },
] as const;

/** 위 화살표 아이콘 */
const ARROW_UP_ICON = [
  { kind: 'path', d: 'M12 19V5' },
  { kind: 'path', d: 'M5 12l7-7 7 7' },
] as const;

export function moveButtons(props: MoveButtonsProps): HTMLElement {
  return el('div', { class: 'shuttle-floating', dataset: { testid: 'move-buttons' } }, [
    iconButton({
      label: UI_TEXT.moveNowLabel,
      icon: svgIcon(CLOCK_ICON),
      testid: 'move-now',
      onClick: () => {
        props.onNow();
      },
    }),
    iconButton({
      label: UI_TEXT.moveTopLabel,
      icon: svgIcon(ARROW_UP_ICON),
      testid: 'move-top',
      onClick: () => {
        props.onTop();
      },
    }),
  ]);
}
