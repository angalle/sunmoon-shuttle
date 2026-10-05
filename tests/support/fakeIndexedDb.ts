/**
 * 최소 IndexedDB 페이크 (tests/support) — 캐시 어댑터 테스트용.
 *
 * 왜 직접 만드나
 * - 카드 지시는 `fake-indexeddb`(devDependency)를 쓰라고 했지만, 이 실행 환경의 **패키지 보안 게이트**가
 *   설치를 차단했다(npm install 차단 원문: `.session-notes/T6-증거.md`). 대안으로 우리 어댑터가 실제로 쓰는
 *   API 표면만 구현한 페이크를 저장소 안에 둔다(런타임·dev 의존성 0 유지).
 * - 오히려 이쪽이 유리한 점: **실패 주입**(open 실패 · 응답 없음 · get 실패)을 지원한다. 그래서 카드가 요구한
 *   "읽기 실패 시 안전 폴백" 경계를 실제로 검증할 수 있다(fake-indexeddb 는 이런 주입이 번거롭다).
 *
 * 구현 범위: `factory.open(name, version)` · `onupgradeneeded/onsuccess/onerror/onblocked` ·
 * `db.objectStoreNames.contains` · `db.createObjectStore` · `db.transaction(store, mode).objectStore(s)` ·
 * `store.get/put/delete/clear` · `db.close`. 그 밖의 IndexedDB API 는 어댑터가 쓰지 않는다.
 *
 * 실제 IDB 와 맞춘 두 가지: ① 콜백은 **비동기**로 가고 핸들러는 **호출 시점에** 읽는다(핸들러는 `open()` 반환
 * 뒤에 대입되므로 등록 시점에 캡처하면 안 된다). ② readonly 트랜잭션에서 쓰기는 예외.
 */
export interface FakeIndexedDbHooks {
  /** `open()` 이 즉시 onerror 로 실패 */
  readonly failOpen?: boolean;
  /** `open()` 이 영원히 응답하지 않음(어댑터의 타임아웃 폴백 검증) */
  readonly hangOpen?: boolean;
  /** `store.get()` 이 onerror 로 실패 */
  readonly failGet?: boolean;
  /** `store.put()` 이 onerror 로 실패 */
  readonly failPut?: boolean;
}

interface RequestLike {
  onsuccess: ((event?: unknown) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  onupgradeneeded: ((event?: unknown) => void) | null;
  onblocked: ((event?: unknown) => void) | null;
  result: unknown;
  error: Error | null;
}

type HandlerGetter = () => ((event?: unknown) => void) | null;

/** 실제 IndexedDB 처럼 다음 태스크에서 **그 시점의** 핸들러를 부른다. */
function deliverLater(getHandler: HandlerGetter): void {
  setTimeout(() => {
    const handler = getHandler();
    if (handler !== null) handler();
  }, 0);
}

function createRequest(): RequestLike {
  return { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: undefined, error: null };
}

export interface FakeIndexedDb {
  /** 어댑터에 주입할 팩토리(실제 `IDBFactory` 자리에 캐스팅해 쓴다) */
  readonly factory: IDBFactory;
  /** 저장된 원시 값(검증·손상 주입용): key → value */
  dump(dbName: string, storeName: string): Map<string, unknown> | undefined;
}

export function createFakeIndexedDb(hooks: FakeIndexedDbHooks = {}): FakeIndexedDb {
  /** dbName → (storeName → (key → value)) */
  const databases = new Map<string, Map<string, Map<string, unknown>>>();
  /** 한 번이라도 open 된 dbName — 첫 open 에서만 onupgradeneeded 를 부르기 위한 표식 */
  const opened = new Set<string>();

  const ensureDatabase = (name: string): Map<string, Map<string, unknown>> => {
    let stores = databases.get(name);
    if (stores === undefined) {
      stores = new Map();
      databases.set(name, stores);
    }
    return stores;
  };

  const factory = {
    open(name: string): RequestLike {
      const request = createRequest();
      const stores = ensureDatabase(name);

      const database = {
        name,
        objectStoreNames: {
          contains: (storeName: string) => stores.has(storeName),
          get length() {
            return stores.size;
          },
        },
        createObjectStore(storeName: string) {
          if (!stores.has(storeName)) stores.set(storeName, new Map());
          return { name: storeName };
        },
        transaction(storeName: string, mode: 'readonly' | 'readwrite' = 'readonly') {
          const data = stores.get(storeName);
          if (data === undefined) throw new Error(`NotFoundError: store ${storeName}`);
          return {
            objectStore(candidate: string) {
              if (candidate !== storeName) throw new Error(`NotFoundError: store ${candidate}`);
              return {
                get(key: string): RequestLike {
                  const getRequest = createRequest();
                  if (hooks.failGet === true) {
                    getRequest.error = new Error('fake: get 실패');
                    deliverLater(() => getRequest.onerror);
                    return getRequest;
                  }
                  getRequest.result = data.has(key) ? structuredClone(data.get(key)) : undefined;
                  deliverLater(() => getRequest.onsuccess);
                  return getRequest;
                },
                put(value: unknown, key?: string): RequestLike {
                  if (mode !== 'readwrite') throw new Error('ReadOnlyError: put 은 readwrite 트랜잭션에서만');
                  if (typeof key !== 'string' || key === '') {
                    // 실제 IDB 와 같다: out-of-line 스토어에 키 없이 put 하면 DataError.
                    throw new Error('DataError: 키를 지정하지 않았습니다');
                  }
                  const putRequest = createRequest();
                  if (hooks.failPut === true) {
                    putRequest.error = new Error('fake: put 실패');
                    deliverLater(() => putRequest.onerror);
                    return putRequest;
                  }
                  data.set(key, structuredClone(value));
                  putRequest.result = key;
                  deliverLater(() => putRequest.onsuccess);
                  return putRequest;
                },
                delete(key: string): RequestLike {
                  if (mode !== 'readwrite') throw new Error('ReadOnlyError: delete 는 readwrite 트랜잭션에서만');
                  const deleteRequest = createRequest();
                  data.delete(key);
                  deliverLater(() => deleteRequest.onsuccess);
                  return deleteRequest;
                },
                clear(): RequestLike {
                  const clearRequest = createRequest();
                  data.clear();
                  deliverLater(() => clearRequest.onsuccess);
                  return clearRequest;
                },
              };
            },
          };
        },
        close() {
          /* 실제 IDB 도 닫을 때 하는 일이 없다(진행 중 트랜잭션만 기다린다) */
        },
      };

      request.result = database;
      if (hooks.hangOpen === true) return request;
      if (hooks.failOpen === true) {
        request.error = new Error('fake: open 실패');
        deliverLater(() => request.onerror);
        return request;
      }
      if (!opened.has(name)) {
        opened.add(name);
        // 첫 open(또는 버전 상승)에서는 실제 IDB 처럼 onupgradeneeded 를 먼저 부른다.
        deliverLater(() => request.onupgradeneeded);
      }
      deliverLater(() => request.onsuccess);
      return request;
    },
  };

  return {
    factory: factory as unknown as IDBFactory,
    dump: (dbName: string, storeName: string) => databases.get(dbName)?.get(storeName),
  };
}
