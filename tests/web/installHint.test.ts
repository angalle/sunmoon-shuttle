/**
 * T7 — 설치 안내 판정/저장 단위 테스트 (카드 지시⑤ "과하지 않게 1회")
 *
 * 브라우저 없이 순수 함수만 검증한다(UA 문자열·저장소·matchMedia 를 주입).
 * - UA → 플랫폼 문구 선택(ios/android/other)
 * - 닫음 표시 저장 → 재방문 시 안내 숨김
 * - storage 가 없거나 예외를 던져도 **앱이 죽지 않는다**(사파리 프라이빗 모드)
 */
import { describe, expect, it } from 'vitest';
import {
  INSTALL_HINT_STORAGE_KEY,
  INSTALL_HINT_STORAGE_VALUE,
  dismissInstallHint,
  installHintPlatform,
  isInstallHintDismissed,
  isStandaloneDisplay,
  shouldShowInstallHint,
  type KeyValueStorage,
} from '../../src/adapters/in/web/features/schedule/api/installHintApi';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36';

function fakeStorage(initial: Record<string, string> = {}): KeyValueStorage & { readonly data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? (data[key] as string) : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const throwingStorage: KeyValueStorage = {
  getItem() {
    throw new Error('storage 차단(사파리 프라이빗 모드 모사)');
  },
  setItem() {
    throw new Error('storage 차단(사파리 프라이빗 모드 모사)');
  },
};

describe('installHintPlatform — UA 별 안내 선택', () => {
  it('iOS(iPhone/iPad) → ios', () => {
    expect(installHintPlatform(IPHONE_UA)).toBe('ios');
    expect(installHintPlatform(IPAD_UA)).toBe('ios');
  });

  it('Android → android', () => {
    expect(installHintPlatform(ANDROID_UA)).toBe('android');
  });

  it('데스크톱 → other(일반 브라우저 메뉴 안내)', () => {
    expect(installHintPlatform(DESKTOP_UA)).toBe('other');
  });
});

describe('설치 안내 1회 표시', () => {
  it('처음 방문(미설치·미닫음)에는 보여준다', () => {
    expect(shouldShowInstallHint(false, fakeStorage())).toBe(true);
  });

  it('이미 설치(standalone)면 보여주지 않는다', () => {
    expect(shouldShowInstallHint(true, fakeStorage())).toBe(false);
  });

  it('닫은 뒤에는 보여주지 않는다(재방문 포함)', () => {
    const storage = fakeStorage();
    dismissInstallHint(storage);
    expect(storage.data[INSTALL_HINT_STORAGE_KEY]).toBe(INSTALL_HINT_STORAGE_VALUE);
    expect(isInstallHintDismissed(storage)).toBe(true);
    expect(shouldShowInstallHint(false, storage)).toBe(false);
  });

  it('저장소가 없으면 안내는 보이되(정보 손실 없음) 닫기 저장은 건너뛴다', () => {
    expect(isInstallHintDismissed(null)).toBe(false);
    expect(shouldShowInstallHint(false, null)).toBe(true);
    expect(() => {
      dismissInstallHint(null);
    }).not.toThrow();
  });

  it('저장소가 예외를 던져도 앱이 죽지 않는다', () => {
    expect(isInstallHintDismissed(throwingStorage)).toBe(false);
    expect(() => {
      dismissInstallHint(throwingStorage);
    }).not.toThrow();
  });
});

describe('isStandaloneDisplay', () => {
  it('display-mode: standalone 을 그대로 반영한다', () => {
    expect(isStandaloneDisplay(() => ({ matches: true }))).toBe(true);
    expect(isStandaloneDisplay(() => ({ matches: false }))).toBe(false);
  });

  it('matchMedia 가 없거나 던져도 false 로 안전하게 떨어진다', () => {
    expect(
      isStandaloneDisplay(() => {
        throw new Error('matchMedia 미지원');
      }),
    ).toBe(false);
  });
});
