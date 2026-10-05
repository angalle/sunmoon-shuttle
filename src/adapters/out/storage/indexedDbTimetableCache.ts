/**
 * IndexedDB 캐시 어댑터 (adapters/out/storage) — `TimetableCachePort` 구현체.
 *
 * 역할(계층 규칙): 외부 저장소(IndexedDB)에서 **원시 레코드를 가져와 비즈니스가 아는 형태로 변환**하는 것까지.
 * 만료·폴백 **판단**은 하지 않는다(`application/cache/timetableCachePolicy.ts` · 화면/mount 몫).
 *
 * 안전 폴백(카드 요구): 카드 지시 ① "읽기 실패 시 안전 폴백".
 * - `indexedDB` 자체가 없는 환경(구형/프라이빗 모드) → 모든 연산이 no-op(null/false).
 * - `open()` 동기 예외·비동기 오류·`blocked`·응답 없음(타임아웃) → no-op. 앱을 멈추지 않는다.
 * - 저장된 레코드가 깨져 있으면(형/필드 불일치) → `null`(없는 것으로 취급).
 * 그래서 이 어댑터의 메서드는 **예외를 밖으로 던지지 않는다**(포트 계약).
 *
 * DB 구조: `sunmoon-shuttle` v1 · 오브젝트 스토어 `timetable_cache` · 키 `current`(레코드 1개).
 * 레코드를 1개만 두는 이유: 앱이 쓰는 계약 JSON 은 "현재 정본 한 벌"뿐이다(과거 이력은 git 이 보관).
 */
import type {
  CachedTimetableEntry,
  CachedTimetableInput,
  TimetableCachePort,
} from '../../../ports/timetable_cache';

export const CACHE_DB_NAME = 'sunmoon-shuttle';
export const CACHE_STORE_NAME = 'timetable_cache';
export const CACHE_DB_VERSION = 1;
/** 레코드 키(단일 레코드) */
const RECORD_KEY = 'current';
/** open 응답 대기 상한 — 응답 없는 IndexedDB 에서 앱이 멈추지 않게(in-process 타임아웃) */
export const DEFAULT_OPEN_TIMEOUT_MS = 4_000;

export interface IndexedDbTimetableCacheOptions {
  /** 주입(테스트·대체 구현). `undefined` 면 `globalThis.indexedDB`, 그것도 없으면 no-op. */
  readonly factory?: IDBFactory | undefined;
  readonly dbName?: string | undefined;
  readonly storeName?: string | undefined;
  readonly dbVersion?: number | undefined;
  readonly openTimeoutMs?: number | undefined;
}

/** IndexedDB 캐시 구현체. 생성자 주입(factory)으로 브라우저 없이도 테스트할 수 있다. */
export class IndexedDbTimetableCache implements TimetableCachePort {
  private readonly factory: IDBFactory | undefined;
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly dbVersion: number;
  private readonly openTimeoutMs: number;

  public constructor(options: IndexedDbTimetableCacheOptions = {}) {
    this.factory = options.factory ?? defaultIndexedDbFactory();
    this.dbName = options.dbName ?? CACHE_DB_NAME;
    this.storeName = options.storeName ?? CACHE_STORE_NAME;
    this.dbVersion = options.dbVersion ?? CACHE_DB_VERSION;
    this.openTimeoutMs = options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
  }

  /** 저장소를 쓸 수 있는 환경인가(진단·테스트용). */
  public get supported(): boolean {
    return this.factory !== undefined;
  }

  public async read(): Promise<CachedTimetableEntry | null> {
    try {
      const db = await this.open();
      if (db === null) return null;
      try {
        const record = await requestOf<unknown>(() =>
          db.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(RECORD_KEY),
        );
        return toEntry(record);
      } finally {
        db.close();
      }
    } catch {
      // 읽기 실패는 "캐시 없음"과 같게 취급한다(빈 화면 금지 → 네트워크/오류 UI 로 진행).
      return null;
    }
  }

  public async write(input: CachedTimetableInput, cachedAtMs: number): Promise<boolean> {
    try {
      const db = await this.open();
      if (db === null) return false;
      try {
        await requestOf(() =>
          db
            .transaction(this.storeName, 'readwrite')
            .objectStore(this.storeName)
            .put(
              {
                raw: input.raw,
                contentHash: input.contentHash,
                fetchedAt: input.fetchedAt,
                schemaVersion: input.schemaVersion,
                cachedAtMs,
              },
              RECORD_KEY,
            ),
        );
        return true;
      } finally {
        db.close();
      }
    } catch {
      // 캐시 저장 실패는 치명적이지 않다 — 화면은 이미 받은 데이터를 그리고 있다.
      return false;
    }
  }

  public async clear(): Promise<void> {
    try {
      const db = await this.open();
      if (db === null) return;
      try {
        await requestOf(() =>
          db.transaction(this.storeName, 'readwrite').objectStore(this.storeName).delete(RECORD_KEY),
        );
      } finally {
        db.close();
      }
    } catch {
      /* 삭제 실패도 조용히 넘긴다(포트 계약: 예외 금지) */
    }
  }

  /** DB 를 열고 필요하면 스토어를 만든다. 실패(없음·오류·타임아웃·차단)는 `null`. */
  private async open(): Promise<IDBDatabase | null> {
    const factory = this.factory;
    if (factory === undefined) return null;

    let request: IDBOpenDBRequest;
    try {
      request = factory.open(this.dbName, this.dbVersion);
    } catch {
      // Safari 프라이빗 모드 등에서 동기 예외가 난다.
      return null;
    }

    return await new Promise<IDBDatabase | null>((resolve) => {
      const timer = setTimeout(() => {
        resolve(null);
      }, this.openTimeoutMs);
      const settle = (value: IDBDatabase | null): void => {
        clearTimeout(timer);
        resolve(value);
      };
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) db.createObjectStore(this.storeName);
      };
      request.onsuccess = () => {
        settle(request.result);
      };
      request.onerror = () => {
        settle(null);
      };
      request.onblocked = () => {
        settle(null);
      };
    });
  }
}

/** 기본 팩토리: 브라우저의 `indexedDB`. 없으면 `undefined`(no-op 폴백). */
function defaultIndexedDbFactory(): IDBFactory | undefined {
  const scope = globalThis as { indexedDB?: IDBFactory | undefined };
  return scope.indexedDB;
}

/** `IDBRequest` 를 Promise 로 감싼다(요청 시작이 동기 예외를 던지면 reject). */
function requestOf<T>(start: () => IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let request: IDBRequest<T>;
    try {
      request = start();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB 요청 실패'));
    };
  });
}

/** 저장된 원시 레코드 → 포트 타입. 형이 어긋나면 `null`(깨진 캐시는 없는 것으로). */
function toEntry(value: unknown): CachedTimetableEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!('raw' in record)) return null;
  const { contentHash, fetchedAt, cachedAtMs, schemaVersion } = record;
  if (typeof contentHash !== 'string' || contentHash === '') return null;
  if (typeof fetchedAt !== 'string' || fetchedAt === '') return null;
  if (typeof cachedAtMs !== 'number' || !Number.isFinite(cachedAtMs)) return null;
  if (typeof schemaVersion !== 'number' || !Number.isFinite(schemaVersion)) return null;
  return { raw: record['raw'], contentHash, fetchedAt, schemaVersion, cachedAtMs };
}
