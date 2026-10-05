/**
 * IndexedDB 캐시 어댑터 테스트 (tests/adapters/out/storage) — 계층을 미러링한다.
 *
 * 카드 지시 ①: "IndexedDB 캐시 어댑터(… 읽기 실패 시 안전 폴백). 테스트는 fake-indexeddb 사용"
 * → `fake-indexeddb` 설치는 이 환경의 패키지 보안 게이트가 차단했다. 대신 저장소 안의 최소 페이크
 *   (`tests/support/fakeIndexedDb.ts`)를 쓴다. 페이크는 **실패 주입**(open 실패·응답 없음·get 실패)을
 *   지원해서 "실패해도 앱이 멈추지 않는다"는 계약을 실제로 검증할 수 있다.
 */
import { describe, expect, it } from 'vitest';
import {
  CACHE_DB_NAME,
  CACHE_STORE_NAME,
  IndexedDbTimetableCache,
} from '../../../../src/adapters/out/storage/indexedDbTimetableCache';
import { createFakeIndexedDb } from '../../../support/fakeIndexedDb';

const INPUT = {
  raw: { schemaVersion: 1, routes: [{ id: 'asan-ktx' }] },
  contentHash: 'sha256:abc',
  fetchedAt: '2026-10-05T03:00:12+09:00',
  schemaVersion: 1,
} as const;

const CACHED_AT = Date.parse('2026-10-05T14:40:00+09:00');

describe('IndexedDbTimetableCache — 저장/읽기/삭제', () => {
  it('쓰고 읽으면 원문·해시·fetchedAt·저장시각이 그대로 돌아온다', async () => {
    const fake = createFakeIndexedDb();
    const cache = new IndexedDbTimetableCache({ factory: fake.factory });

    expect(cache.supported).toBe(true);
    expect(await cache.write(INPUT, CACHED_AT)).toBe(true);

    const entry = await cache.read();
    expect(entry).toEqual({ ...INPUT, cachedAtMs: CACHED_AT });
    expect(fake.dump(CACHE_DB_NAME, CACHE_STORE_NAME)?.has('current')).toBe(true);
  });

  it('다시 쓰면 마지막 값으로 덮인다(레코드 1개)', async () => {
    const fake = createFakeIndexedDb();
    const cache = new IndexedDbTimetableCache({ factory: fake.factory });

    await cache.write(INPUT, CACHED_AT);
    await cache.write({ ...INPUT, contentHash: 'sha256:def', fetchedAt: '2026-10-06T03:00:00+09:00' }, CACHED_AT + 1000);

    const entry = await cache.read();
    expect(entry?.contentHash).toBe('sha256:def');
    expect(entry?.cachedAtMs).toBe(CACHED_AT + 1000);
    expect(fake.dump(CACHE_DB_NAME, CACHE_STORE_NAME)?.size).toBe(1);
  });

  it('clear 하면 읽기가 null 이 된다', async () => {
    const fake = createFakeIndexedDb();
    const cache = new IndexedDbTimetableCache({ factory: fake.factory });
    await cache.write(INPUT, CACHED_AT);

    await cache.clear();
    expect(await cache.read()).toBeNull();
  });
});

describe('IndexedDbTimetableCache — 안전 폴백(예외를 밖으로 던지지 않는다)', () => {
  it('팩토리가 없으면(미지원 브라우저) 모든 연산이 no-op', async () => {
    const cache = new IndexedDbTimetableCache({ factory: undefined });
    expect(cache.supported).toBe(false);
    expect(await cache.read()).toBeNull();
    expect(await cache.write(INPUT, CACHED_AT)).toBe(false);
    await expect(cache.clear()).resolves.toBeUndefined();
  });

  it('open 이 동기 예외를 던져도(사파리 프라이빗 모드 형태) no-op', async () => {
    const throwingFactory = {
      open() {
        throw new Error('SecurityError: indexedDB 사용 불가');
      },
    } as unknown as IDBFactory;
    const cache = new IndexedDbTimetableCache({ factory: throwingFactory });

    expect(await cache.read()).toBeNull();
    expect(await cache.write(INPUT, CACHED_AT)).toBe(false);
    await expect(cache.clear()).resolves.toBeUndefined();
  });

  it('open 이 비동기로 실패해도 no-op', async () => {
    const fake = createFakeIndexedDb({ failOpen: true });
    const cache = new IndexedDbTimetableCache({ factory: fake.factory });

    expect(await cache.read()).toBeNull();
    expect(await cache.write(INPUT, CACHED_AT)).toBe(false);
  });

  it('open 이 응답하지 않으면 타임아웃으로 포기한다(앱이 멈추지 않는다)', async () => {
    const fake = createFakeIndexedDb({ hangOpen: true });
    const cache = new IndexedDbTimetableCache({ factory: fake.factory, openTimeoutMs: 40 });

    const started = Date.now();
    expect(await cache.read()).toBeNull();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(30);
    expect(elapsed).toBeLessThan(2000);
  });

  it('get 이 실패하면 null(캐시 없음과 같게) — 예외를 던지지 않는다', async () => {
    const fake = createFakeIndexedDb({ failGet: true });
    const cache = new IndexedDbTimetableCache({ factory: fake.factory });

    await expect(cache.read()).resolves.toBeNull();
  });

  it('put 이 실패하면 false 를 돌려주고 조용히 끝난다', async () => {
    const fake = createFakeIndexedDb({ failPut: true });
    const cache = new IndexedDbTimetableCache({ factory: fake.factory });

    await expect(cache.write(INPUT, CACHED_AT)).resolves.toBe(false);
  });

  it('깨진 레코드(형 불일치)는 없는 것으로 취급한다', async () => {
    const fake = createFakeIndexedDb();
    const cache = new IndexedDbTimetableCache({ factory: fake.factory });
    await cache.write(INPUT, CACHED_AT);

    const store = fake.dump(CACHE_DB_NAME, CACHE_STORE_NAME);
    expect(store).toBeDefined();
    store?.set('current', { raw: INPUT.raw, contentHash: 42, fetchedAt: INPUT.fetchedAt, schemaVersion: 1, cachedAtMs: CACHED_AT });
    expect(await cache.read()).toBeNull();

    store?.set('current', { contentHash: INPUT.contentHash, fetchedAt: INPUT.fetchedAt });
    expect(await cache.read()).toBeNull();

    store?.set('current', { raw: INPUT.raw, contentHash: INPUT.contentHash, fetchedAt: INPUT.fetchedAt, schemaVersion: 1, cachedAtMs: 'nope' });
    expect(await cache.read()).toBeNull();
  });
});
