/**
 * 스냅샷들 → `data/timetable.json` (계약 JSON) 조립 — 순수 함수(IO 없음).
 *
 * 결정성 규칙:
 *  - 노선 순서 = `routeMeta.ROUTES` 순서(글롭 순서에 의존하지 않는다)
 *  - 요일 순서 = `DAY_TYPES`(평일 → 토 → 일)
 *  - 안내문·시내버스 참고는 `raw` 기준 중복 제거(첫 등장 순서 유지)
 *  - `contentHash` 는 **source 블록을 제외한 데이터**의 정규화 JSON 에 대한 sha256
 *    → `fetchedAt`(실행 시각)이 달라도 데이터가 같으면 해시가 같다
 *  - 부동소수 없음(순번은 정수), 키 순서는 객체 리터럴 순서로 고정
 */

import { createHash } from 'node:crypto';

import { DAY_TYPES, ScrapeError } from './types.js';
import type {
  BusRef,
  Contacts,
  DayTable,
  DayType,
  Notice,
  RouteData,
  SemesterPeriod,
  Snapshot,
  SourcePage,
  Timetable,
  TripRow,
} from './types.js';
import { ROUTES, findDay, offDaysOf } from './routeMeta.js';

export const SCHEMA_VERSION = 1 as const;

export interface AssembleOptions {
  /** 실행 시각(ISO8601 + 오프셋) — 주입(결정성 테스트에서 고정값 사용) */
  readonly fetchedAt: string;
  /** 대표 출처 URL(기본: 셔틀버스 안내 최상위 페이지) */
  readonly sourceUrl?: string;
}

/**
 * 대표 출처 URL = 셔틀버스 안내 최상위 페이지(`docs/recon/T1-사이트맵-실측.md §2` 범위 밖 "셔틀버스안내", 존재만 확인).
 * 노선 11개를 한 URL 로 요약할 수 없으므로 **페이지별 실제 URL 은 `source.pages[]`** 에 담는다.
 * (`docs/01 §4` 예시값은 아산KTX 평일 페이지를 예로 든 것 — 요약 필드의 의미는 "안내 최상위".)
 */
const DEFAULT_SOURCE_URL = 'https://lily.sunmoon.ac.kr/Page2/About/About08_04_01.aspx';

function assertSamePeriod(values: readonly SemesterPeriod[], what: string): SemesterPeriod | null {
  if (values.length === 0) return null;
  const first = values[0];
  if (first === undefined) return null;
  for (const value of values) {
    if (value.startsOn !== first.startsOn || value.endsOn !== first.endsOn || value.label !== first.label) {
      throw new ScrapeError(
        `${what} 문구가 페이지마다 다릅니다 — "${first.title}" vs "${value.title}" (계약 확정 필요)`,
      );
    }
  }
  return first;
}

/** 비어 있는 요일 표(원본에 그 요일 페이지가 없는 경우) */
function emptyDayTable(): DayTable {
  return { columns: [], keys: [], trips: [] };
}

export function buildDayTable(snapshot: Snapshot): DayTable {
  return { columns: [...snapshot.columns], keys: [...snapshot.keys], trips: snapshot.trips.map((t) => ({ ...t })) };
}

/** contentHash 대상 = source(실행 시각 포함) 를 뺀 데이터 */
export function canonicalPayload(timetable: Omit<Timetable, 'source'>): string {
  return JSON.stringify({
    schemaVersion: timetable.schemaVersion,
    semester: timetable.semester,
    holidayPeriod: timetable.holidayPeriod,
    dayTypes: timetable.dayTypes,
    routes: timetable.routes,
    notices: timetable.notices,
    busRefs: timetable.busRefs,
    contacts: timetable.contacts,
  });
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function assembleTimetable(snapshots: readonly Snapshot[], options: AssembleOptions): Timetable {
  if (snapshots.length === 0) {
    throw new ScrapeError('스냅샷이 없습니다 — data/raw/*.html 를 인자로 넘기세요');
  }

  // ⓪ 입력 순서(글롭 순서)에 의존하지 않도록 계약 순서로 정렬한다
  //    (문구·안내문처럼 "첫 등장"을 쓰는 값이 입력 순서에 흔들리면 결정성이 깨진다)
  const routeOrder = new Map<string, number>(ROUTES.map((route, index): [string, number] => [route.id, index]));
  const dayOrder = new Map<string, number>(DAY_TYPES.map((day, index): [string, number] => [day, index]));
  const orderOf = (snapshot: Snapshot): number =>
    (routeOrder.get(snapshot.routeId) ?? ROUTES.length) * 10 + (dayOrder.get(snapshot.dayType) ?? DAY_TYPES.length);
  const ordered = [...snapshots].sort((a, b) => orderOf(a) - orderOf(b));

  // ① (노선, 요일) 중복 금지
  const byKey = new Map<string, Snapshot>();
  for (const snapshot of ordered) {
    const key = `${snapshot.routeId}|${snapshot.dayType}`;
    if (byKey.has(key)) {
      throw new ScrapeError(`같은 (노선, 요일) 스냅샷이 두 번 들어왔습니다 — ${snapshot.routeId}/${snapshot.dayType}`);
    }
    byKey.set(key, snapshot);
  }

  // ② 학기(평일·주말) 문구 — 페이지별로 파싱한 값이 서로 같아야 한다
  //    (운행 중단 노선 페이지는 시간표가 없어 학기 문구도 없다 → 제외)
  const activeSnapshots = ordered.filter((s) => s.status === 'active');
  if (activeSnapshots.length === 0) {
    throw new ScrapeError('운행 중인 노선 스냅샷이 하나도 없습니다 — 계약 JSON 을 만들 수 없습니다');
  }
  const periods = activeSnapshots.map((s) => s.period);
  if (periods.some((p) => p === null)) {
    const missing = activeSnapshots.filter((s) => s.period === null).map((s) => `${s.routeId}/${s.dayType}`);
    throw new ScrapeError(`학기/휴일 문구를 찾지 못한 페이지: ${missing.join(', ')} (원본 개편 의심 — 추측 금지)`);
  }
  const present = periods.filter((p): p is SemesterPeriod => p !== null);
  const semester = assertSamePeriod(present.filter((p) => p.kind === 'semester'), '학기 시간표');
  const holidayPeriod = assertSamePeriod(present.filter((p) => p.kind === 'holiday'), '휴일 운행기간');
  if (semester === null) {
    throw new ScrapeError('평일(학기 시간표) 문구를 찾지 못했습니다 — 계약 JSON 을 만들 수 없습니다');
  }

  // ③ 출처·신선도(페이지별)
  const pages: SourcePage[] = [];
  for (const meta of ROUTES) {
    for (const dayType of DAY_TYPES) {
      const snapshot = byKey.get(`${meta.id}|${dayType}`);
      if (snapshot === undefined) continue;
      if (snapshot.sourceUpdatedAt === null) {
        throw new ScrapeError(`${meta.id}/${dayType}: "최근 업데이트" 날짜를 찾지 못했습니다(신선도 표시 불가)`);
      }
      const dayMeta = findDay(meta, dayType);
      pages.push({
        routeId: meta.id,
        dayType,
        url: dayMeta?.url ?? meta.url,
        sourceUpdatedAt: snapshot.sourceUpdatedAt,
      });
    }
  }
  const updatedDates = pages.map((p) => p.sourceUpdatedAt).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (updatedDates.length !== pages.length || updatedDates.length === 0) {
    throw new ScrapeError('페이지별 "최근 업데이트" 값이 비었거나 형식이 다릅니다');
  }
  const sourceUpdatedAt = updatedDates.reduce((a, b) => (a >= b ? a : b));

  // ④ 노선 조립
  const routes: RouteData[] = [];
  for (const meta of ROUTES) {
    const snapshotsOfRoute = DAY_TYPES.map((d) => byKey.get(`${meta.id}|${d}`)).filter(
      (s): s is Snapshot => s !== undefined,
    );
    if (snapshotsOfRoute.length === 0) {
      throw new ScrapeError(`노선 ${meta.id} 의 스냅샷이 없습니다 — 계약 JSON 은 전 노선이 필요합니다`);
    }
    const offDays = offDaysOf(meta);

    if (meta.status === 'suspended') {
      const source = snapshotsOfRoute[0];
      if (source === undefined) throw new ScrapeError(`내부 오류: ${meta.id} 스냅샷 없음`);
      const reason = source.suspendedReason;
      if (reason === null || reason === '') {
        throw new ScrapeError(`${meta.id}: 운행 중단 사유(원본 문구)를 찾지 못했습니다 — 빈 상태로 넘기지 않습니다`);
      }
      routes.push({
        id: meta.id,
        name: meta.name,
        path: source.path,
        status: 'suspended',
        suspendedReason: reason,
        columns: [],
        trips: [],
        byDay: {
          weekday: emptyDayTable(),
          saturday: emptyDayTable(),
          sunday: emptyDayTable(),
        },
        offDays: [...DAY_TYPES],
      });
      continue;
    }

    const primary = byKey.get(`${meta.id}|weekday`);
    if (primary === undefined) {
      throw new ScrapeError(`${meta.id}: 평일 스냅샷이 없습니다 — 대표 열/행을 만들 수 없습니다`);
    }
    const byDay: Record<DayType, DayTable> = {
      weekday: buildDayTable(primary),
      saturday: emptyDayTable(),
      sunday: emptyDayTable(),
    };
    for (const dayType of ['saturday', 'sunday'] as const) {
      const snapshot = byKey.get(`${meta.id}|${dayType}`);
      if (snapshot !== undefined) byDay[dayType] = buildDayTable(snapshot);
    }
    routes.push({
      id: meta.id,
      name: meta.name,
      path: primary.path,
      status: 'active',
      columns: [...primary.keys],
      trips: primary.trips.map((t) => ({ ...t })),
      byDay,
      offDays,
    });
  }

  // ⑤ 공통 정보(안내문·시내버스·문의처) — 요일/노선 순서로 중복 제거
  const notices: Notice[] = [];
  const seenNotices = new Set<string>();
  const busRefs: BusRef[] = [];
  const seenBusRefs = new Set<string>();
  const contactsList: Contacts[] = [];
  for (const meta of ROUTES) {
    for (const dayType of DAY_TYPES) {
      const snapshot = byKey.get(`${meta.id}|${dayType}`);
      if (snapshot === undefined) continue;
      for (const notice of snapshot.notices) {
        const key = notice.raw;
        if (seenNotices.has(key)) continue;
        seenNotices.add(key);
        notices.push(notice);
      }
      for (const ref of snapshot.busRefs) {
        const key = `${ref.to}|${ref.line}|${ref.stop}`;
        if (seenBusRefs.has(key)) continue;
        seenBusRefs.add(key);
        busRefs.push(ref);
      }
      if (snapshot.contacts !== null) contactsList.push(snapshot.contacts);
    }
  }
  const firstContacts = contactsList[0];
  if (firstContacts === undefined) {
    throw new ScrapeError('문의처(담당·전화)를 찾지 못했습니다 — 모든 스냅샷에서 누락');
  }
  for (const contact of contactsList) {
    if (contact.team !== firstContacts.team || contact.tel !== firstContacts.tel) {
      throw new ScrapeError(
        `문의처가 페이지마다 다릅니다 — ${firstContacts.team}/${firstContacts.tel} vs ${contact.team}/${contact.tel}`,
      );
    }
  }

  const dayTypes = DAY_TYPES.filter((dayType) =>
    routes.some((route) => (route.byDay[dayType].trips as readonly TripRow[]).length > 0),
  );

  const payload: Omit<Timetable, 'source'> = {
    schemaVersion: SCHEMA_VERSION,
    semester,
    holidayPeriod,
    dayTypes: [...dayTypes],
    routes,
    notices,
    busRefs,
    contacts: firstContacts,
  };

  const contentHash = `sha256:${sha256Hex(canonicalPayload(payload))}`;

  return {
    ...payload,
    source: {
      url: options.sourceUrl ?? DEFAULT_SOURCE_URL,
      sourceUpdatedAt,
      fetchedAt: options.fetchedAt,
      contentHash,
      pages,
    },
  };
}
