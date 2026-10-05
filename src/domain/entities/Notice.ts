/**
 * 안내문 1건 — 데이터 스키마 `docs/01-architecture.md §4` 의 `notices[]` 와 1:1.
 *
 * - `kind`: 파서(T2)가 붙이는 분류 라벨(예: `no-service`). 도메인은 **해석의 근거로 `text` 를 쓰고**
 *   `kind` 는 표시·참고용으로만 둔다(패턴 표는 `rules/serviceDay.ts` 한 곳에 있다).
 * - `date`: KST 기준 `YYYY-MM-DD` **하루**다. 원본의 기간 표기(예: `추석연휴[9.24~9.26]`)는
 *   **파서가 날짜별로 전개**해서 넣는다(계약 — `docs/01 §4`). 전개되지 않은 표기는
 *   `resolveDayService` 가 경고로 수집한다(조용히 무시 금지).
 * - `text`: 원본 문구 그대로(사용자 표시·근거).
 */
export interface Notice {
  readonly kind: string;
  readonly date: string;
  readonly text: string;
}
