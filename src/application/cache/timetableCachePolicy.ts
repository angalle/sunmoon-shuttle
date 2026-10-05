/**
 * 캐시 만료 정책 (application 계층 · **순수 함수**) — docs/01-architecture.md §5 만료 정책.
 *
 * 규칙(계약)
 * - 캐시 나이 ≥ 24h → **만료**. 만료돼도 삭제하지 않고 폴백으로 계속 쓴다("실패해도 캐시 유지").
 * - 만료된 캐시를 쓰는 경우 화면은 "24시간이 지났다"를 **문구로** 알린다(색만으로 전달 금지 · 조용한 노후 금지).
 * - 시계 역행(`nowMs < cachedAtMs`)은 나이 0 으로 본다(음수 나이 금지).
 *
 * 경계는 `>=` 다: 정확히 24h 는 만료로 본다(보수적 — "24h 초과 시 재검증" 요구를 확실히 만족).
 * 이 판단을 도메인(`src/domain`)에 두지 않는 이유: T6 카드가 도메인 수정 0줄을 계약으로 걸었다.
 * 정책을 옮길 때는 이 파일 하나만 옮기면 된다(어댑터·화면은 이 함수만 호출한다).
 */
export const TIMETABLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface CacheAge {
  /** 경과(ms, ≥ 0) */
  readonly ageMs: number;
  readonly expired: boolean;
}

export function timetableCacheAge(
  cachedAtMs: number,
  nowMs: number,
  ttlMs: number = TIMETABLE_CACHE_TTL_MS,
): CacheAge {
  const ageMs = Math.max(0, nowMs - cachedAtMs);
  return { ageMs, expired: ageMs >= ttlMs };
}

/**
 * 캐시 나이를 사람이 읽는 문구로. 화면(오프라인 안내)이 쓴다.
 * `formatAge`(shared/lib)는 **ISO 문자열**용이고 shared 는 어댑터 계층이라, 여기서는 순수 계산만 한다.
 */
export function formatCacheAge(ageMs: number): string {
  const clamped = Math.max(0, ageMs);
  const minutes = Math.floor(clamped / 60_000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${String(minutes)}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const restMinutes = minutes % 60;
    return restMinutes === 0 ? `${String(hours)}시간 전` : `${String(hours)}시간 ${String(restMinutes)}분 전`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${String(days)}일 전` : `${String(days)}일 ${String(restHours)}시간 전`;
}
