/**
 * T29 — 요일·방향 선택 상태 저장 (docs/07-mobile-ux.md §11-1 · §16-2 · AC-U11-1/AC-U16-1).
 *
 * "요일/방향 상태는 **저장**한다(재실행 시 유지)" 를 저장소를 주입해 순수 함수로 고정한다.
 * 깨진 값·모르는 값·저장소 차단(사파리 프라이빗)에서도 **앱이 죽지 않고 기본값으로** 동작해야 한다.
 * §16-2(T38) — 방향은 **택1**(`out`·`in`)이라 옛 값 `all`(전체)은 무효다: 무시하고 기본값을 쓴다.
 */
import { describe, expect, it } from 'vitest';
import type { KeyValueStorage } from '../../../../src/adapters/in/web/shared/lib/storage';
import {
  UI_PREFS_STORAGE_KEY,
  effectiveStoredDayType,
  readUiPrefs,
  writeUiPrefs,
} from '../../../../src/adapters/in/web/features/schedule/api/uiPrefsApi';

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

describe('writeUiPrefs → readUiPrefs 왕복', () => {
  it('요일·방향을 날짜와 함께 저장하고 그대로 읽는다', () => {
    const storage = fakeStorage();
    writeUiPrefs(storage, { dayType: 'saturday', direction: 'in', stop: null, date: '2026-10-06' });
    expect(JSON.parse(storage.data[UI_PREFS_STORAGE_KEY] as string)).toEqual({
      dayType: 'saturday',
      direction: 'in', stop: null,
      date: '2026-10-06',
    });
    expect(readUiPrefs(storage)).toEqual({ dayType: 'saturday', direction: 'in', stop: null, date: '2026-10-06' });
  });

  it('두 번 저장하면 마지막 값이 남는다(한쪽만 바뀌어도 함께 갱신된다)', () => {
    const storage = fakeStorage();
    writeUiPrefs(storage, { dayType: 'sunday', direction: 'in', stop: null, date: '2026-10-11' });
    writeUiPrefs(storage, { dayType: 'sunday', direction: 'out', stop: null, date: '2026-10-11' });
    expect(readUiPrefs(storage)).toEqual({ dayType: 'sunday', direction: 'out', stop: null, date: '2026-10-11' });
  });
});

describe('effectiveStoredDayType — 요일 선택은 그날(KST) 안에서만 유효하다', () => {
  it('저장한 날과 같은 날이면 요일 선택을 되살린다(§11-1 재실행 시 유지)', () => {
    expect(effectiveStoredDayType({ dayType: 'sunday', direction: 'in', stop: null, date: '2026-10-06' }, '2026-10-06')).toBe('sunday');
  });

  it('날이 바뀌거나 다른 날짜 화면이면 되살리지 않는다(오늘 요일로 시작)', () => {
    expect(effectiveStoredDayType({ dayType: 'sunday', direction: 'in', stop: null, date: '2026-10-06' }, '2026-10-10')).toBeNull();
  });

  it('날짜 정보가 없으면(옛 저장값·깨진 값) 되살리지 않는다', () => {
    expect(effectiveStoredDayType({ dayType: 'saturday', direction: 'in', stop: null, date: null }, '2026-10-10')).toBeNull();
  });

  it('저장된 요일이 없으면 null', () => {
    expect(effectiveStoredDayType({ dayType: null, direction: 'out', stop: null, date: '2026-10-10' }, '2026-10-10')).toBeNull();
  });
});

describe('readUiPrefs — 이상한 값은 기본값(null)으로 떨어진다', () => {
  it('저장소가 없으면(프라이빗 모드) 기본값', () => {
    expect(readUiPrefs(null)).toEqual({ dayType: null, direction: null, stop: null, date: null });
  });

  it('저장된 값이 없으면 기본값', () => {
    expect(readUiPrefs(fakeStorage())).toEqual({ dayType: null, direction: null, stop: null, date: null });
  });

  it('깨진 JSON 은 기본값(예외를 던지지 않는다)', () => {
    expect(readUiPrefs(fakeStorage({ [UI_PREFS_STORAGE_KEY]: '{not json' }))).toEqual({
      dayType: null,
      direction: null,
      stop: null,
      date: null,
    });
  });

  it('모르는 요일·방향·날짜 값은 각각 무시한다(부분 복구)', () => {
    const storage = fakeStorage({ [UI_PREFS_STORAGE_KEY]: JSON.stringify({ dayType: 'holiday', direction: 'in', stop: null, date: '2026-10-06' }) });
    expect(readUiPrefs(storage)).toEqual({ dayType: null, direction: 'in', stop: null, date: '2026-10-06' });

    const storage2 = fakeStorage({ [UI_PREFS_STORAGE_KEY]: JSON.stringify({ dayType: 'sunday', direction: 'sideways', date: '2026-10-06' }) });
    expect(readUiPrefs(storage2)).toEqual({ dayType: 'sunday', direction: null, stop: null, date: '2026-10-06' });

    const storage3 = fakeStorage({
      [UI_PREFS_STORAGE_KEY]: JSON.stringify({ dayType: 'sunday', direction: 'in', stop: null, date: '10월 6일' }),
    });
    expect(readUiPrefs(storage3).date).toBeNull();
  });

  it('옛 저장값 `all`(전체)은 무효다 — 기본 방향으로 시작한다(§16-2)', () => {
    const storage = fakeStorage({
      [UI_PREFS_STORAGE_KEY]: JSON.stringify({ dayType: 'sunday', direction: 'all', date: '2026-10-06' }),
    });
    expect(readUiPrefs(storage)).toEqual({ dayType: 'sunday', direction: null, stop: null, date: '2026-10-06' });
  });

  it('JSON 이 객체가 아니면 기본값', () => {
    expect(readUiPrefs(fakeStorage({ [UI_PREFS_STORAGE_KEY]: '"sunday"' }))).toEqual({
      dayType: null,
      direction: null,
      stop: null,
      date: null,
    });
  });
});

describe('저장소가 막혀 있어도 앱 동작을 막지 않는다', () => {
  it('getItem/setItem 이 던져도 읽기는 기본값, 쓰기는 조용히 삼킨다', () => {
    expect(readUiPrefs(throwingStorage)).toEqual({ dayType: null, direction: null, stop: null, date: null });
    expect(() => {
      writeUiPrefs(throwingStorage, { dayType: 'weekday', direction: 'out', stop: null, date: '2026-10-06' });
    }).not.toThrow();
    expect(() => {
      writeUiPrefs(null, { dayType: 'weekday', direction: 'out', stop: null, date: '2026-10-06' });
    }).not.toThrow();
  });
});
