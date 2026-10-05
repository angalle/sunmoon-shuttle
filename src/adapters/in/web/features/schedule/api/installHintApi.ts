/**
 * 설치 안내 저장·판정 (features/schedule/api) — 브라우저 저장소·UA 를 다루는 **기능의 IO 경계**.
 *
 * 계약(카드 지시⑤: "설치 안내 UX — 홈 화면 추가 안내, 과하지 않게 1회")
 * - 안내는 **한 번만** 보여준다 → 닫으면 localStorage 에 표시를 남긴다.
 * - 이미 설치(standalone)되어 있으면 보여주지 않는다.
 * - 저장소가 막힌 환경(사파리 프라이빗 등)에서도 **예외를 던지지 않는다**(앱은 계속 동작).
 *
 * 이 모듈은 DOM 을 직접 만지지 않는다 — UA 문자열·저장소·standalone 여부를 **주입받아** 판정만 한다(테스트 가능).
 * (표현은 components/molecules/InstallHint.ts, 결선은 app/mount.ts)
 */

export type InstallHintPlatform = 'ios' | 'android' | 'other';

/** localStorage 최소 인터페이스(테스트에서 가짜 객체 주입). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const INSTALL_HINT_STORAGE_KEY = 'sunmoon-shuttle:install-hint-dismissed:v1';
export const INSTALL_HINT_STORAGE_VALUE = 'yes';

/** 사용자 에이전트로 안내 문구 종류를 고른다(설치 방법이 OS 마다 다르다). */
export function installHintPlatform(userAgent: string): InstallHintPlatform {
  // iPadOS 13+ 는 데스크톱 UA(Macintosh)를 쓰므로 터치 지원 여부도 함께 본다 — 여기서는 UA 만 본다(보수적).
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'other';
}

/** 닫은 적이 있으면 true. 저장소가 없거나 막혀 있으면 false(안내를 보여주는 쪽이 안전). */
export function isInstallHintDismissed(storage: KeyValueStorage | null): boolean {
  if (storage === null) return false;
  try {
    return storage.getItem(INSTALL_HINT_STORAGE_KEY) === INSTALL_HINT_STORAGE_VALUE;
  } catch {
    return false;
  }
}

/** 다시 보지 않도록 표시. 저장 실패는 삼킨다(안내를 닫는 동작 자체는 성공해야 한다). */
export function dismissInstallHint(storage: KeyValueStorage | null): void {
  if (storage === null) return;
  try {
    storage.setItem(INSTALL_HINT_STORAGE_KEY, INSTALL_HINT_STORAGE_VALUE);
  } catch {
    /* 저장 불가 환경 — 이번 세션에서는 닫힌 상태로 둔다(무음 실패가 아니라 설계된 동작). */
  }
}

/** 안내를 띄울지 판정 — ① 설치(standalone) 아님 ② 닫은 적 없음. */
export function shouldShowInstallHint(
  isStandalone: boolean,
  storage: KeyValueStorage | null,
): boolean {
  if (isStandalone) return false;
  return !isInstallHintDismissed(storage);
}

/** `matchMedia` 를 주입받아 standalone(홈 화면 설치) 여부를 판정한다. */
export function isStandaloneDisplay(matchMediaFn: (query: string) => { matches: boolean }): boolean {
  try {
    return matchMediaFn('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

/**
 * 예외를 던지지 않는 localStorage 접근(사파리 프라이빗 모드 등에서 접근 자체가 던진다).
 * 실패하면 null → 안내는 보이되 닫기 저장은 동작하지 않는다(앱 기능은 유지).
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
