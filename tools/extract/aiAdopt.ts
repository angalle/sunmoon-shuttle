/**
 * T35 **Stage B — AI 초안 채택**(docs/08 §5).
 *
 * 규칙 파서가 **그 페이지에서 행을 0건** 만들었을 때만 AI 초안을 채택 후보로 삼는다. 조건(총괄 계약 #60):
 *  ① 검증 4종(셀 앵커·시각 집합·행 수·스키마) 전부 통과 ② 교차검증 **① 값 모순 0건 · ② key-shift 0건**
 *  (③ null-vs-값은 검증 4종을 통과했으면 허용) ③ 열 의미 키 집합 = 그 노선·요일의 **계약 키 집합**(엄격).
 *
 * 채택분은 `extractedBy: "ai"` + `needsReview: true` 로 표시하고 그 사실을 로그·알림에 남긴다.
 * **AI 가 정본을 조용히 덮어쓰는 경로는 없다** — 규칙이 행을 만든 페이지는 여기 대상이 아니다(Stage A).
 *
 * 왜 계약 키 집합을 요구하나: AI 가 만든 값을 앱이 읽는 스키마(v1)에 넣는 유일한 지점이므로,
 * 열 배정·키 이름이 계약과 정확히 같을 때만 넣는다(그 외에는 채택하지 않고 보류 — 추측 금지).
 *
 * 순수 함수다 — 파일 IO·시계 없음.
 */

import { canonicalPayload, sha256Hex } from '../scraper/assemble.js';
import { findRoute } from '../scraper/routeMeta.js';
import type { DayTable, DayType, Timetable, TripRow } from '../scraper/types.js';
import { canonicalCellValue } from './aiCrossCheck.js';
import type { AiTablePageDraft } from './types.js';

export interface AdoptedPage {
  readonly page: string;
  readonly routeId: string;
  readonly dayType: DayType;
  readonly rows: number;
  readonly extractedBy: 'ai';
  readonly needsReview: true;
  /** 채택 근거(로그·알림용) */
  readonly reason: string;
}

export interface AdoptionOutcome {
  /** 채택 반영본(채택 0건이면 입력 그대로) */
  readonly timetable: Timetable;
  readonly adopted: readonly AdoptedPage[];
}

/** 그 노선·요일의 계약 열(키·라벨) — routeMeta 계약에서 파생(손으로 적지 않는다) */
export function contractDay(routeId: string, dayType: DayType): readonly { readonly key: string; readonly label: string }[] {
  const route = findRoute(routeId);
  const day = route.days.find((entry) => entry.dayType === dayType);
  return (day?.columns ?? []).map((column) => ({ key: column.key, label: column.label }));
}

/**
 * AI 초안 행 → 계약 키 순서의 `TripRow`. 값은 정규화된 원문 토큰(시각은 `HH:MM`).
 * 계약에 없는 키의 값은 **버리지 않고 채택 자체를 거부**한다(호출측 `canAdopt` 판정).
 */
export function draftToTripRows(draft: AiTablePageDraft, routeId: string, dayType: DayType): readonly TripRow[] {
  const columns = contractDay(routeId, dayType);
  const rows: TripRow[] = [];
  for (const row of draft.rows) {
    const trip: Record<string, string | number | null> = {};
    for (const column of columns) {
      if (column.key === 'seq') {
        trip['seq'] = row.seq;
        continue;
      }
      trip[column.key] = canonicalCellValue(row.values[column.key] ?? null);
    }
    rows.push(trip);
  }
  return rows;
}

/** 채택 가능 판정(키 집합·행 번호) — 검증 4종·교차검증은 호출측이 이미 확인했다 */
export function canAdopt(draft: AiTablePageDraft, routeId: string, dayType: DayType): { readonly ok: boolean; readonly reason: string } {
  const columns = contractDay(routeId, dayType);
  if (columns.length === 0) return { ok: false, reason: '계약에 열 정의가 없다(routeMeta 확인 필요)' };
  const contractKeys = [...new Set(columns.map((column) => column.key))].sort();
  const draftKeys = [...new Set(draft.columns.map((column) => column.key))].sort();
  if (JSON.stringify(contractKeys) !== JSON.stringify(draftKeys)) {
    return {
      ok: false,
      reason: `열 의미 키 집합이 계약과 다르다 — 계약 [${contractKeys.join(', ')}] vs AI [${draftKeys.join(', ')}]`,
    };
  }
  const seqs = draft.rows.map((row) => row.seq);
  if (seqs.some((seq) => seq === null || !Number.isInteger(seq) || seq < 1)) {
    return { ok: false, reason: '순번(seq)이 1..N 정수가 아니다' };
  }
  return { ok: true, reason: `계약 열 ${String(contractKeys.length)}개 · 행 ${String(draft.rows.length)}개` };
}

export interface AdoptionRequest {
  /** 이 페이지의 계약 (노선, 요일) */
  readonly routeId: string;
  readonly dayType: DayType;
  readonly page: string;
  readonly draft: AiTablePageDraft;
  /** 사람이 읽는 채택 근거(검증 4종·교차검증 요약) */
  readonly evidence: string;
}

/**
 * 채택분을 타임테이블에 반영한다.
 *  - `byDay[day]` 를 계약 열 라벨/키 + AI 행으로 **교체**하고 `extractedBy: "ai"` · `needsReview: true` 를 붙인다.
 *  - 평일(weekday)이면 대표 배열(`routes[].columns`·`routes[].trips`)도 같이 맞춘다(v1 계약: 대표=평일).
 *  - 대상 (노선, 요일)이 이미 행을 만들었으면 **건너뛴다**(Stage A 우선 — 조용한 덮어쓰기 금지).
 */
export function adoptAiRows(base: Timetable, requests: readonly AdoptionRequest[]): AdoptionOutcome {
  const adopted: AdoptedPage[] = [];
  if (requests.length === 0) return { timetable: base, adopted };

  const routes = base.routes.map((route) => {
    const applied = requests.filter((request) => request.routeId === route.id);
    if (applied.length === 0) return route;
    const byDay: Record<DayType, DayTable> = { ...route.byDay };
    let changed = false;
    for (const request of applied) {
      const existing = route.byDay[request.dayType];
      if (existing !== undefined && existing.trips.length > 0) continue; // Stage A 우선
      const gate = canAdopt(request.draft, request.routeId, request.dayType);
      if (!gate.ok) continue;
      const columns = contractDay(request.routeId, request.dayType);
      const trips = draftToTripRows(request.draft, request.routeId, request.dayType);
      byDay[request.dayType] = {
        columns: columns.map((column) => column.label),
        keys: columns.map((column) => column.key),
        trips,
        // 채택 표시(스키마 확장 — 검증기는 columns/keys/trips 만 본다)
        extractedBy: 'ai',
        needsReview: true,
      } as DayTable;
      changed = true;
      adopted.push({
        page: request.page,
        routeId: request.routeId,
        dayType: request.dayType,
        rows: trips.length,
        extractedBy: 'ai',
        needsReview: true,
        reason: `${gate.reason} · ${request.evidence}`,
      });
    }
    if (!changed) return route;
    const weekday = byDay.weekday;
    return {
      ...route,
      byDay,
      // 대표(평일) = 평일 표 (v1 계약)
      columns: [...weekday.keys],
      trips: weekday.trips.map((row) => ({ ...row })),
    };
  });

  if (adopted.length === 0) return { timetable: base, adopted };
  // 행이 바뀌었으면 `contentHash` 를 다시 계산한다(파서와 같은 규칙 — 검증기가 재계산 대조를 한다)
  const payload: Omit<Timetable, 'source'> = {
    schemaVersion: base.schemaVersion,
    semester: base.semester,
    holidayPeriod: base.holidayPeriod,
    dayTypes: base.dayTypes,
    routes,
    notices: base.notices,
    busRefs: base.busRefs,
    contacts: base.contacts,
  };
  return {
    timetable: {
      ...payload,
      source: { ...base.source, contentHash: `sha256:${sha256Hex(canonicalPayload(payload))}` },
    },
    adopted,
  };
}
