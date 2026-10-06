/**
 * 브라우저 저장소 최소 인터페이스 + 안전한 접근 (shared/lib) — 도메인 지식 0.
 *
 * 왜 shared 인가: 저장소(localStorage) 접근은 **여러 기능이 함께 쓰는 기반 도구**다
 * (화면 설정 저장 §11-1 · 조립 지점의 저장소 확보). 특정 기능의 api 모듈에 두면
 * 다른 기능이 그 기능을 import 하게 되어 의존 방향이 뒤집힌다(스킬 §2: shared 는 아무도 의존하지 않는다).
 *
 * 규칙(사파리 프라이빗 모드 등 저장소가 막힌 환경):
 * - `safeLocalStorage()` 는 **예외를 던지지 않는다** — 실패하면 null 을 돌려주고, 부르는 쪽은 값 없이 동작한다.
 * - 값 읽기/쓰기 실패도 부르는 쪽이 삼킨다(앱의 본래 기능은 계속 돌아야 한다).
 */

/** 최소 저장소 계약 — 테스트에서 가짜 객체를 주입할 수 있게 좁게 잡는다. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 예외를 던지지 않는 localStorage 접근(사파리 프라이빗 모드 등에서 접근 자체가 던진다).
 * 실패하면 null → 부르는 쪽은 기본값으로 동작하고, 저장은 건너뛴다(앱 기능은 유지).
 */
export function safeLocalStorage(): KeyValueStorage | null {
  try {
    const storage = window.localStorage;
    const probeKey = 'sunmoon-shuttle:probe';
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
  }
}
