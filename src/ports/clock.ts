/**
 * 시계 포트 (docs/01-architecture.md §3, T4-5).
 *
 * 도메인은 `Date.now()` 를 직접 부를 수 없다(경계 검사가 강제). 현재 시각은 이 포트로 주입한다
 * → 테스트는 고정 시각을, 앱은 시스템 시각을 넘긴다.
 *
 * 반환값은 **인스턴트**(UTC epoch)다. KST 달력 변환은 도메인 규칙(`domain/rules/kst.ts`)이
 * 고정 오프셋으로 처리하므로 호스트 TZ 와 무관하게 결정적이다.
 */
export interface Clock {
  now(): Date;
}
