/**
 * 분자: 시간표 표 (features/schedule/components/molecules)
 * - 열 구성은 **데이터가 준 원문 헤더(`columns`)를 그대로** 렌더한다(노선·요일별로 다름 — F2).
 * - 의미 구조 유지: `<table>` + `<caption>` + `<th scope="col">` → 스크린리더가 표로 읽는다.
 * - `null`(원본 Χ) 셀은 빈칸이 아니라 `—` + 스크린리더 문구로 **구분 표시**한다(빈 문자열과 구분).
 */
import { el, srOnly } from '../../../../shared/lib/dom';
import type { TripRow } from '../../types/contract';
import { UI_TEXT } from '../../types/texts';

export interface TimetableTableProps {
  readonly caption: string;
  /** 원문 헤더(비어 있으면 `keys` 로 대체) */
  readonly columns: readonly string[];
  readonly keys: readonly string[];
  readonly rows: readonly TripRow[];
}

export function timetableTable(props: TimetableTableProps): HTMLTableElement {
  const headerLabels = props.columns.length > 0 ? props.columns : props.keys;
  const headerCells = headerLabels.map((label) => el('th', { attrs: { scope: 'col' }, text: label }));

  const body = el('tbody', {}, []);
  const cellKeys = props.keys.length > 0 ? props.keys : headerLabels;
  props.rows.forEach((row, index) => {
    const cells = cellKeys.map((key) => cellNode(row[key], key));
    body.appendChild(el('tr', { dataset: { row: String(index + 1) } }, cells));
  });

  return el(
    'table',
    { class: 'shuttle-table', dataset: { testid: 'timetable', rows: String(props.rows.length) } },
    [
      el('caption', {}, [props.caption, el('span', { text: ` — ${UI_TEXT.tableCaptionNote}` })]),
      el('thead', {}, [el('tr', {}, headerCells)]),
      body,
    ],
  );
}

function cellNode(value: string | number | null | undefined, key: string): HTMLElement {
  if (value === null) {
    return el(
      'td',
      { class: 'shuttle-table__cell--empty', dataset: { cell: 'empty', key }, attrs: { title: UI_TEXT.tableEmptyCellSr } },
      [UI_TEXT.tableEmptyCell, srOnly(UI_TEXT.tableEmptyCellSr)],
    );
  }
  if (value === undefined || value === '') {
    // 원본이 비어 있는 칸(Χ 와 다름) — 빈 셀로 둔다.
    return el('td', { dataset: { cell: 'blank', key } }, ['']);
  }
  return el('td', { dataset: { cell: 'value', key }, text: String(value) });
}
