/**
 * T35 §7 **드리프트 게이트** 테스트 — 임계 ±10% · 노선 소실 · 편수 0 · 요일 버킷 소실 · 열 키 변경 + `--force-publish`.
 *
 * AC-AI1-6(총괄 계약 2026-10-09): ① 편수 10% 초과 변동 → 보류 · ② 노선 소실 → 보류 · ③ 한 경로 편수 0 → 보류 ·
 * ④ 열 키 변경 → 보류 · ⑤ `--force-publish` → 발행되되 `drift.forced: true` 기록 · ⑥ 정상 재실행 → 보류 없음.
 *
 * 비교 기준은 **저장소의 직전 발행본**(`data/timetable.json`)이다 — 단위 테스트는 합성 기준선을,
 * 통합 테스트는 그 파일을 변형한 기준선을 쓴다(실 네트워크 0).
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { checkDrift, driftTableText, forceDrift, parseBaseline, DRIFT_TRIP_THRESHOLD } from '../../tools/extract/driftGate.js';
import type { DriftBaseline, DriftSource } from '../../tools/extract/driftGate.js';
import { runExtract } from '../../tools/extract/cli.js';
import { makeRunHarness, fakeStructurer } from './support.js';
import type { ExtractDeps } from '../../tools/extract/cli.js';

const OUT = 'tmp/t35-out.json';
const LOG = 'tmp/t35-run.json';
const DRIFT_REPORT = 'tmp/t35-drift-report.json';
const DRIFT_TABLE = 'tmp/t35-drift-compare.txt';
const BASELINE = 'tmp/t35-baseline.json';

const EMPTY = new Map<string, string>();
void EMPTY;

// ─────────────────────────── 합성 입력 ───────────────────────────

function table(keys: readonly string[], count: number): { keys: string[]; trips: unknown[] } {
  return { keys: [...keys], trips: Array.from({ length: count }, (_unused, index) => ({ seq: index + 1 })) };
}

function source(routes: Readonly<Record<string, { readonly weekday: number; readonly saturday?: number; readonly sunday?: number; readonly keys?: readonly string[] }>>): DriftSource {
  return {
    routes: Object.entries(routes).map(([id, days]) => ({
      id,
      byDay: {
        weekday: table(days.keys ?? ['seq', 'depCampus'], days.weekday),
        ...(days.saturday === undefined ? {} : { saturday: table(days.keys ?? ['seq', 'depCampus'], days.saturday) }),
        ...(days.sunday === undefined ? {} : { sunday: table(days.keys ?? ['seq', 'depCampus'], days.sunday) }),
      },
    })),
  };
}

/** 발행 JSON 요약 → 기준선(`parseBaseline` 과 같은 형태 — 개수만 쓴다) */
function baselineOf(raw: string): DriftBaseline {
  const parsed = parseBaseline(raw);
  if (parsed === null) throw new Error('기준선 파싱 실패');
  return parsed;
}

function jsonOf(routes: readonly { id: string; byDay: Record<string, { keys: string[]; trips: unknown[] }> }[]): string {
  return JSON.stringify({ schemaVersion: 3, routes });
}

// ─────────────────────────── 단위: 신호 5종 ───────────────────────────

describe('T35 §7 드리프트 신호 — 임계 ±10%', () => {
  it('임계값은 10% 이고, 신호가 없으면 blocked=false', () => {
    expect(DRIFT_TRIP_THRESHOLD).toBe(0.1);
    const before = baselineOf(jsonOf([{ id: 'asan-ktx', byDay: { weekday: table(['seq'], 42) } }]));
    const report = checkDrift({ baseline: before, baselinePath: 'x.json', baselineIssue: null, next: source({ 'asan-ktx': { weekday: 42, keys: ['seq'] } }) });
    expect(report.checked).toBe(true);
    expect(report.blocked).toBe(false);
    expect(report.totals).toEqual({ before: 42, after: 42, deltaPct: 0 });
  });

  it('-15% 는 보류, +8% 는 통과(정상 개편 오작동 방지)', () => {
    const before = baselineOf(jsonOf([{ id: 'asan-ktx', byDay: { weekday: table(['seq'], 100) } }]));
    const minus15 = checkDrift({ baseline: before, baselinePath: 'x.json', baselineIssue: null, next: source({ 'asan-ktx': { weekday: 85, keys: ['seq'] } }) });
    expect(minus15.totals.deltaPct).toBe(-15);
    expect(minus15.blocked).toBe(true);
    expect(minus15.reasons.join(' ')).toContain('trip-count');

    const plus8 = checkDrift({ baseline: before, baselinePath: 'x.json', baselineIssue: null, next: source({ 'asan-ktx': { weekday: 108, keys: ['seq'] } }) });
    expect(plus8.blocked).toBe(false);
  });

  it('노선 소실 → 보류', () => {
    const before = baselineOf(jsonOf([{ id: 'asan-ktx', byDay: { weekday: table(['seq'], 4) } }, { id: 'onyang', byDay: { weekday: table(['seq'], 7) } }]));
    const report = checkDrift({ baseline: before, baselinePath: 'x.json', baselineIssue: null, next: source({ 'asan-ktx': { weekday: 4 } }) });
    expect(report.blocked).toBe(true);
    expect(report.reasons.join(' ')).toContain('route-lost');
    expect(report.routes.find((route) => route.routeId === 'onyang')?.lost).toBe(true);
  });

  it('특정 노선×요일 편 수 >0 → 0 이면 보류', () => {
    const before = baselineOf(jsonOf([{ id: 'asan-ktx', byDay: { weekday: table(['seq'], 4), saturday: table(['seq'], 4) } }]));
    const report = checkDrift({ baseline: before, baselinePath: 'x.json', baselineIssue: null, next: source({ 'asan-ktx': { weekday: 4, saturday: 0 } }) });
    expect(report.blocked).toBe(true);
    expect(report.reasons.join(' ')).toContain('day-trips-zero');
  });

  it('byDay 키 소실 → 보류', () => {
    const before = baselineOf(jsonOf([{ id: 'asan-ktx', byDay: { weekday: table(['seq'], 4), saturday: table(['seq'], 4) } }]));
    const report = checkDrift({ baseline: before, baselinePath: 'x.json', baselineIssue: null, next: source({ 'asan-ktx': { weekday: 4 } }) });
    expect(report.blocked).toBe(true);
    expect(report.reasons.join(' ')).toContain('byday-key-lost');
  });

  it('열 의미 키 집합 변경 → 보류', () => {
    const before = baselineOf(jsonOf([{ id: 'asan-ktx', byDay: { weekday: table(['seq', 'depCampus', 'arrCampus'], 2) } }]));
    const report = checkDrift({
      baseline: before,
      baselinePath: 'x.json',
      baselineIssue: null,
      next: source({ 'asan-ktx': { weekday: 2, keys: ['seq', 'depCampus', 'arrStation'] } }),
    });
    expect(report.blocked).toBe(true);
    expect(report.reasons.join(' ')).toContain('column-keys-changed');
  });

  it('기준선이 없으면 게이트를 켜지 않는다(checked=false + 사유)', () => {
    const report = checkDrift({ baseline: null, baselinePath: 'data/timetable.json', baselineIssue: '읽을 수 없음', next: source({ 'asan-ktx': { weekday: 4 } }) });
    expect(report.checked).toBe(false);
    expect(report.blocked).toBe(false);
    expect(report.skippedReason).toBe('읽을 수 없음');
    void forceDrift(report); // 강제 발행은 보류 상태에서만 의미가 있다(여기서는 그대로)
    expect(forceDrift(report).forced).toBe(false);
  });

  it('--force-publish 는 보류를 해제하고 강제 발행 사실을 남긴다', () => {
    const before = baselineOf(jsonOf([{ id: 'asan-ktx', byDay: { weekday: table(['seq'], 100) } }]));
    const blocked = checkDrift({ baseline: before, baselinePath: 'x.json', baselineIssue: null, next: source({ 'asan-ktx': { weekday: 50 } }) });
    expect(blocked.blocked).toBe(true);
    const forced = forceDrift(blocked);
    expect(forced.blocked).toBe(false);
    expect(forced.forced).toBe(true);
    expect(forced.reasons.length).toBeGreaterThan(0);
    expect(driftTableText(forced)).toContain('blocked=false');
  });

  it('parseBaseline — 손상 JSON·routes 없는 JSON 은 null(추측 금지)', () => {
    expect(parseBaseline('{')).toBeNull();
    expect(parseBaseline('[]')).toBeNull();
    expect(parseBaseline('{"schemaVersion":3}')).toBeNull();
    expect(parseBaseline('{"routes":[{"id":"asan-ktx","byDay":{"weekday":{"keys":["seq"],"trips":[{},{}]}}}]}')?.totalTrips).toBe(2);
  });
});

// ─────────────────────────── 통합: 발행 경로 ───────────────────────────

function harness(extraFiles: Map<string, string>): { readonly written: Map<string, string>; readonly logs: string[]; readonly errors: string[]; readonly deps: ExtractDeps } {
  return makeRunHarness(fakeStructurer([]) as unknown as ExtractDeps['createStructurer'], { files: extraFiles });
}

function extractArgs(extra: readonly string[] = []): string[] {
  return ['--no-ai', '--out', OUT, '--log', LOG, '--baseline', BASELINE, '--drift-report', DRIFT_REPORT, '--drift-table', DRIFT_TABLE, ...extra];
}

/** 실발행본을 변형해 기준선을 만든다(값은 세지 않는다 — 게이트는 개수·구조만 본다) */
function mutatedBaseline(mutate: (routes: { id: string; byDay: Record<string, { keys: string[]; trips: unknown[] }> }[]) => void): string {
  const published = JSON.parse(readFileSync('data/timetable.json', 'utf8')) as {
    routes: { id: string; byDay: Record<string, { keys: string[]; trips: unknown[] }> }[];
  };
  const routes = JSON.parse(JSON.stringify(published.routes)) as { id: string; byDay: Record<string, { keys: string[]; trips: unknown[] }> }[];
  mutate(routes);
  return jsonOf(routes);
}

describe('T35 AC-AI1-6 — 발행 경로 통합(보류·강제 발행·정상)', () => {
  it('① 편수 10% 초과 감소 → **발행 보류**(exit 1 · 발행물 0건 · 비교 표 아티팩트)', async () => {
    const baseline = mutatedBaseline((routes) => {
      const asan = routes.find((route) => route.id === 'asan-ktx');
      const weekday = asan?.byDay.weekday;
      if (weekday === undefined) throw new Error('asan-ktx weekday 없음');
      weekday.trips = [...weekday.trips, ...weekday.trips.slice(0, 20)]; // 기준선 168편 (−11.9%)
    });
    const files = new Map([[BASELINE, baseline]]);
    const h = harness(files);
    const code = await runExtract(extractArgs(), h.deps);

    expect(code).toBe(1);
    expect(h.written.has(OUT)).toBe(false); // 발행물 0건
    expect(h.written.has(DRIFT_REPORT)).toBe(true);
    expect(h.written.has(DRIFT_TABLE)).toBe(true);
    expect(h.errors.join('\n')).toContain('드리프트 게이트 보류');

    const report = JSON.parse(h.written.get(DRIFT_REPORT) ?? '{}') as { published: boolean; holdReason: string; drift: { blocked: boolean; reasons: string[] }; inputs: { snapshots: string[] } };
    expect(report.published).toBe(false);
    expect(report.holdReason).toBe('drift-gate');
    expect(report.drift.blocked).toBe(true);
    expect(report.drift.reasons.join(' ')).toContain('trip-count');
    expect(report.inputs.snapshots.length).toBeGreaterThan(0); // 원본 스냅샷 목록 첨부

    const table = h.written.get(DRIFT_TABLE) ?? '';
    expect(table).toContain('드리프트 게이트');
    expect(table).toContain('| asan-ktx |');

    const log = JSON.parse(h.written.get(LOG) ?? '{}') as { output: string | null; drift: { checked: boolean; blocked: boolean; totals: { deltaPct: number } } };
    expect(log.output).toBeNull();
    expect(log.drift.checked).toBe(true);
    expect(log.drift.blocked).toBe(true);
    expect(log.drift.totals.deltaPct).toBeLessThan(-10);
  });

  it('⑤ --force-publish → 발행되되 `drift.forced: true` 기록(조용한 우회 금지)', async () => {
    const baseline = mutatedBaseline((routes) => {
      const asan = routes.find((route) => route.id === 'asan-ktx');
      const weekday = asan?.byDay.weekday;
      if (weekday === undefined) throw new Error('asan-ktx weekday 없음');
      weekday.trips = [...weekday.trips, ...weekday.trips.slice(0, 20)];
    });
    const h = harness(new Map([[BASELINE, baseline]]));
    const code = await runExtract(extractArgs(['--force-publish']), h.deps);

    expect(code).toBe(0);
    expect(h.written.has(OUT)).toBe(true);
    const artifact = JSON.parse(h.written.get(OUT) ?? '{}') as { source: { extraction: { aiExtract: { drift: Record<string, unknown> } } } };
    const drift = artifact.source.extraction.aiExtract.drift;
    expect(drift['checked']).toBe(true);
    expect(drift['blocked']).toBe(false);
    expect(drift['forced']).toBe(true);
    expect((drift['reasons'] as string[]).join(' ')).toContain('trip-count');
    expect(h.logs.join('\n')).toContain('--force-publish');
  });

  it('② 노선 소실 · ④ 열 키 변경 → 보류(수치·사유 기록)', async () => {
    const lost = harness(
      new Map([
        [
          BASELINE,
          mutatedBaseline((routes) => {
            routes.push({ id: 'ghost-route', byDay: { weekday: { keys: ['seq'], trips: [] } } });
          }),
        ],
      ]),
    );
    expect(await runExtract(extractArgs(), lost.deps)).toBe(1);
    expect(lost.errors.join('\n')).toContain('route-lost');

    const keys = harness(
      new Map([
        [
          BASELINE,
          mutatedBaseline((routes) => {
            const asan = routes.find((route) => route.id === 'asan-ktx');
            const weekday = asan?.byDay.weekday;
            if (weekday === undefined) throw new Error('asan-ktx weekday 없음');
            weekday.keys = [...weekday.keys, 'ghostColumn'];
          }),
        ],
      ]),
    );
    expect(await runExtract(extractArgs(), keys.deps)).toBe(1);
    expect(keys.errors.join('\n')).toContain('column-keys-changed');
  });

  it('⑥ 정상 재실행(직전 발행본 그대로) → 보류 없음 · 드리프트 리포트에 통과 기록', async () => {
    const baseline = readFileSync('data/timetable.json', 'utf8');
    const h = harness(new Map([[BASELINE, baseline]]));
    const code = await runExtract(extractArgs(), h.deps);

    expect(code).toBe(0);
    expect(h.written.has(OUT)).toBe(true);
    const artifact = JSON.parse(h.written.get(OUT) ?? '{}') as { source: { extraction: { aiExtract: { drift: Record<string, unknown> } } } };
    expect(artifact.source.extraction.aiExtract.drift).toEqual({ checked: true, blocked: false, reasons: [] });
    const report = JSON.parse(h.written.get(DRIFT_REPORT) ?? '{}') as { published: boolean; drift: { blocked: boolean; signals: unknown[] } };
    expect(report.published).toBe(true);
    expect(report.drift.blocked).toBe(false);
    expect(report.drift.signals).toEqual([]);
  });

  it('기준선 파일이 없으면 게이트를 켜지 않고 발행한다(checked=false + 사유)', async () => {
    const h = harness(new Map());
    const code = await runExtract(extractArgs(), h.deps);

    expect(code).toBe(0);
    const log = JSON.parse(h.written.get(LOG) ?? '{}') as { drift: { checked: boolean; baselineIssue: string | null } };
    expect(log.drift.checked).toBe(false);
    expect(log.drift.baselineIssue).toContain('읽을 수 없다');
    expect(h.logs.join('\n')).toContain('드리프트 게이트(§7): 켜지 않음');
  });
});
