// schedule_gate.mjs — 정기 배치(extract.yml schedule)를 **오늘 돌릴지** 학사일정으로 정한다.
//
// 사용자 결정(2026-11-08): "학사일정상 변동이 있을 때 일주일 정도만 하루에 한 번, 저녁에".
//  - 셔틀 시간표는 학기 ↔ 방학이 바뀔 때 학교가 손으로 갱신한다(docs/10 §6-5·§6-7).
//  - 그래서 **개강일·방학 시작일 앞뒤 3일(총 7일)** 에만 매일 돌고, 그 밖의 날은 건너뛴다.
//  - schedule 이 아닌 실행(workflow_dispatch·data/raw push)은 이 게이트를 거치지 않는다(항상 실행).
//
// 실패는 **열린 쪽으로**(돌린다): JSON 이 없거나 academicEvents 가 없으면 run=true.
//
//   node .github/scripts/schedule_gate.mjs [--json=data/timetable.json] [--today=YYYY-MM-DD]
//   → stdout 에 사유, $GITHUB_OUTPUT 에 run=true|false
//
// 순수 판정은 `decide()` — tests/extract/schedule-gate.test.ts 가 검증한다.

import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** 전환일로 보는 학사일정 분류 */
export const ANCHOR_KINDS = ['semester-start', 'vacation-start'];
/** 전환일 앞뒤 며칠까지 돌릴지(앞 3 · 당일 · 뒤 3 = 7일) */
export const WINDOW_DAYS = 3;

const DAY_MS = 86_400_000;

function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** 오늘(KST) YYYY-MM-DD */
export function todayKst(now = new Date()) {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * @param {unknown} timetable 발행 JSON
 * @param {string} today YYYY-MM-DD (KST)
 * @returns {{ run: boolean, reason: string }}
 */
export function decide(timetable, today) {
  const events = timetable && typeof timetable === 'object' ? timetable.academicEvents : undefined;
  if (!Array.isArray(events) || events.length === 0) {
    return { run: true, reason: 'academicEvents 없음 — 판단할 수 없어 실행한다(열린 쪽으로 실패)' };
  }
  const anchors = events.filter(
    (event) => event && ANCHOR_KINDS.includes(event.kind) && typeof event.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(event.start),
  );
  if (anchors.length === 0) {
    return { run: true, reason: '전환일(개강·방학 시작)이 학사일정에 없음 — 실행한다' };
  }
  const t = dayNumber(today);
  const hit = anchors
    .map((event) => ({ event, diff: t - dayNumber(event.start) }))
    .filter(({ diff }) => Math.abs(diff) <= WINDOW_DAYS)
    .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff))[0];
  if (hit) {
    const when = hit.diff === 0 ? '당일' : hit.diff < 0 ? `D${String(hit.diff)}` : `D+${String(hit.diff)}`;
    return { run: true, reason: `전환 주간 — ${hit.event.start} ${hit.event.label} (${when})` };
  }
  const next = anchors
    .filter((event) => dayNumber(event.start) - WINDOW_DAYS > t)
    .sort((a, b) => dayNumber(a.start) - dayNumber(b.start))[0];
  return {
    run: false,
    reason: next
      ? `전환 주간 아님 — 다음 실행 구간은 ${next.start} ${next.label} 의 앞뒤 ${String(WINDOW_DAYS)}일`
      : '전환 주간 아님 — 남은 전환일 없음(다음 학년도 학사력을 반입하면 다시 잡힌다)',
  };
}

function arg(name, fallback) {
  const hit = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const jsonPath = arg('json', 'data/timetable.json');
  const today = arg('today', todayKst());
  let timetable = null;
  try {
    timetable = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (error) {
    console.log(`schedule_gate: ${jsonPath} 를 읽지 못함(${error instanceof Error ? error.message : String(error)})`);
  }
  const { run, reason } = decide(timetable, today);
  console.log(`schedule_gate: ${today} → run=${String(run)} · ${reason}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${String(run)}\nreason=${reason}\n`);
}
