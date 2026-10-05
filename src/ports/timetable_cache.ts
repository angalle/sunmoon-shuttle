/**
 * 아웃바운드 포트: 시간표 캐시 계층 (docs/01-architecture.md §5 "데이터 캐시").
 *
 * 왜 필요한가
 * - **오프라인 동작(AC-6)**: 마지막으로 받은 계약 JSON 을 브라우저에 남겨 네트워크 없이 첫 화면을 그린다.
 * - **수집 실패 폴백(AC-5)**: 네트워크가 죽어도 마지막 정상 데이터를 표시한다(빈 화면 금지).
 *
 * 계약(중요)
 * - `read()` 는 **예외를 던지지 않는다** — 저장소가 없거나 깨졌으면 `null`(안전 폴백). 앱은 캐시 실패로 멈추지 않는다.
 * - `write()` 실패도 화면을 막지 않는다 — 성공 여부만 돌려준다.
 * - 만료(24h)·신선도 판정 규칙은 `application/cache/timetableCachePolicy.ts`(순수 함수)가 담당한다.
 *   어댑터(`adapters/out/storage`)는 **CRUD·원시값 검증까지만** 한다(계층 규칙: 판단은 안쪽 계층).
 */
export interface CachedTimetableEntry {
  /** 계약 JSON 원문(파싱 전). 파싱은 소비 측(`features/schedule/api`)에서 하고, 실패하면 캐시를 없는 것으로 본다. */
  readonly raw: unknown;
  /** 계약 `source.contentHash` — 변경 감지(F1) */
  readonly contentHash: string;
  /** 계약 `source.fetchedAt`(내용 반영 시각) — 화면 신선도 표시에 쓰인다 */
  readonly fetchedAt: string;
  /** 계약 `schemaVersion` — 앱이 아는 버전과 다르면 캐시를 버린다(마이그레이션 없음) */
  readonly schemaVersion: number;
  /** 캐시에 **저장한 시각**(ms epoch, 주입된 Clock 기준) — 만료 판정의 기준(계약 fetchedAt 이 아니다) */
  readonly cachedAtMs: number;
}

/** 저장 입력 — `cachedAtMs` 는 저장 시점의 시계(주입된 Clock)에서 온다. */
export interface CachedTimetableInput {
  readonly raw: unknown;
  readonly contentHash: string;
  readonly fetchedAt: string;
  readonly schemaVersion: number;
}

export interface TimetableCachePort {
  /** 캐시 읽기. 없거나 읽기 실패면 `null`(예외 금지 — 오프라인 안전). */
  read(): Promise<CachedTimetableEntry | null>;
  /** 캐시 쓰기. 실패해도 화면을 막지 않는다(성공 여부만 반환). */
  write(input: CachedTimetableInput, cachedAtMs: number): Promise<boolean>;
  /** 캐시 삭제(재시도·디버그) */
  clear(): Promise<void>;
}
