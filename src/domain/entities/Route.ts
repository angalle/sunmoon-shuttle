import type { DayType } from './DayType';
import type { Trip } from './Trip';

/**
 * 노선 — 데이터 스키마 `docs/01-architecture.md §4` 의 `routes[]` 와 1:1.
 *
 * - `trips`: 원본 표의 순서(요일 구분 없이 읽은 값)
 * - `byDay`: 요일 구분별 회차 — 다음 출발 계산은 **항상 이쪽**을 쓴다(요일별 표가 다를 수 있다).
 *   값이 빈 배열이면 "그 요일 표가 비었다"는 뜻이며 오류가 아니다(명확한 상태로 반환).
 */
export interface Route {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly columns: readonly string[];
  readonly trips: readonly Trip[];
  readonly byDay: Readonly<Record<DayType, readonly Trip[]>>;
}
