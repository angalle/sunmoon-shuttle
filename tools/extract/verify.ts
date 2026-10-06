#!/usr/bin/env node
/**
 * T21 계약 실측 검증기 — **발행물(`data/timetable.json`)과 원문(`data/raw`)을 맞대어** 확인한다.
 * (AC-D1 원문 대조 카운트 · AC-D2 원문 인용률 100%)
 *
 *   ./node_modules/.bin/tsx tools/extract/verify.ts [--data data/timetable.json] [--raw data/raw]
 *
 * 검사
 *   ① 편별 note 카운트(원문) vs 구조화 카운트(발행물) — 표기별 1:1 매핑 · 잔여 미해석은 needsReview
 *   ② `note` 에 원문 표기 잔존 0(구조화된 행은 비웠는가)
 *   ③ 신규 항목의 인용이 **원본 부분문자열**인가(누락 0 = 100%)
 *   ④ 방학 기간(periodSearch) 결과와 근거 문장
 *
 * 종료코드: 검사 하나라도 실패하면 1.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { assembleTimetable } from '../scraper/assemble.js';
import { parseSnapshot } from '../scraper/parse.js';
import { findRoute, parseSnapshotFileName } from '../scraper/routeMeta.js';
import { DAY_TYPES } from '../scraper/types.js';
import type { DayTable, DayType, Timetable, TripRow } from '../scraper/types.js';
import { pageText } from './text.js';
import { noteTextOf, parseTripNote } from './trips.js';

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.join('=')];
  }),
);

const DATA_FILE = args.get('data') ?? 'data/timetable.json';
const RAW_DIR = args.get('raw') ?? 'data/raw';
const TERM_DIR = join(RAW_DIR, 'terms');

const failures: string[] = [];
const lines: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  const line = `  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : ` — ${detail}`}`;
  lines.push(line);
  if (!ok) failures.push(line);
}

function info(label: string): void {
  lines.push(`  INFO  ${label}`);
}

/* ── 원문(파서 기준선) ───────────────────────────────────────────── */
function loadRawSources(): { file: string; text: string }[] {
  const files = readdirSync(RAW_DIR)
    .filter((file) => file.endsWith('.html'))
    .sort();
  return files.map((file) => ({ file: join(RAW_DIR, file), text: pageText(readFileSync(join(RAW_DIR, file), 'utf8')) }));
}

function loadTermSources(): { file: string; text: string }[] {
  let files: string[] = [];
  try {
    files = readdirSync(TERM_DIR)
      .filter((file) => file.endsWith('.html'))
      .sort();
  } catch {
    return [];
  }
  return files.map((file) => ({ file: join(TERM_DIR, file), text: pageText(readFileSync(join(TERM_DIR, file), 'utf8')) }));
}

function loadBaseline(): Timetable {
  const files = readdirSync(RAW_DIR)
    .filter((file) => file.endsWith('.html'))
    .sort();
  const snapshots = files.map((file) => {
    const ref = parseSnapshotFileName(file);
    return parseSnapshot(readFileSync(join(RAW_DIR, file), 'utf8'), findRoute(ref.routeId), ref.dayType);
  });
  return assembleTimetable(snapshots, { fetchedAt: '2026-10-06T09:00:00+09:00' });
}

/** 원문 note 인벤토리 — 노선·요일 표 기준(대표 배열은 같은 행이라 중복 계산하지 않는다). */
function rawNoteInventory(base: Timetable): Map<string, number> {
  const counts = new Map<string, number>();
  for (const route of base.routes) {
    for (const dayType of DAY_TYPES as readonly DayType[]) {
      for (const row of route.byDay[dayType]?.trips ?? []) {
        const note = noteTextOf(row);
        if (note === null) continue;
        counts.set(note, (counts.get(note) ?? 0) + 1);
      }
    }
  }
  return counts;
}

type Json = Record<string, unknown>;

function asRecords(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter((item): item is Json => typeof item === 'object' && item !== null && !Array.isArray(item)) : [];
}

/** 발행물의 편별 조건 행 → `{ quote, shape, noteStale }` */
function conditionInventory(
  published: Json,
): { readonly quote: string; readonly shape: string; readonly noteStale: boolean }[] {
  const out: { quote: string; shape: string; noteStale: boolean }[] = [];
  for (const route of asRecords(published['routes'])) {
    const byDay = (route['byDay'] ?? {}) as Record<string, Json>;
    for (const dayType of DAY_TYPES as readonly DayType[]) {
      const table = byDay[dayType] as unknown as DayTable | undefined;
      for (const row of (table?.trips ?? []) as readonly TripRow[]) {
        const raw = row as Record<string, unknown>;
        if (!('service' in raw) && !('durationMinutes' in raw) && !('unknownNote' in raw)) continue;
        const service = raw['service'] as Json | null;
        const unknownNote = raw['unknownNote'];
        const duration = raw['durationMinutes'];
        let quote = '';
        let shape = 'unknown';
        if (service !== null && typeof service === 'object') {
          quote = String(service['sourceQuote'] ?? '');
          shape = `service:excluded=${JSON.stringify(service['excludedDays'] ?? null)};scope=${JSON.stringify(service['dayScope'] ?? null)};vehicles=${JSON.stringify(service['vehicleCount'] ?? null)};label=${JSON.stringify(service['label'] ?? null)}`;
        } else if (typeof duration === 'number') {
          quote = `duration:${String(duration)}`;
          shape = `duration:${String(duration)}`;
        } else if (typeof unknownNote === 'string') {
          quote = unknownNote;
          shape = 'unknown';
        }
        const noteValue = raw['note'];
        out.push({ quote, shape, noteStale: typeof noteValue === 'string' && noteValue.trim() !== '' });
      }
    }
  }
  return out;
}

function expectedShape(note: string): string {
  const parsed = parseTripNote(note);
  if (parsed.outcome === 'duration') return `duration:${String(parsed.durationMinutes)}`;
  if (parsed.outcome === 'unknown') return 'unknown';
  const service = parsed.service;
  return `service:excluded=${JSON.stringify(service?.excludedDays ?? null)};scope=${JSON.stringify(service?.dayScope ?? null)};vehicles=${JSON.stringify(service?.vehicleCount ?? null)};label=${JSON.stringify(service?.label ?? null)}`;
}

function main(): void {
  const published = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as Json;
  const base = loadBaseline();
  const raw = rawNoteInventory(base);
  const publishedConditions = conditionInventory(published);

  info(`발행물 ${DATA_FILE} · schemaVersion=${String(published['schemaVersion'])}`);

  /* ① 편별 note 카운트 대조 ------------------------------------------------- */
  lines.push('');
  lines.push('  [AC-D1] 표기별 원문 카운트 vs 발행물 구조화 카운트');
  lines.push('  ────────────────────────────────────────────────────────────────');
  let rawTotal = 0;
  let mappedTotal = 0;
  let expectedTotal = 0;
  for (const [note, rawCount] of [...raw].sort((a, b) => a[0].localeCompare(b[0]))) {
    rawTotal += rawCount;
    const expected = expectedShape(note);
    // 원문 note 는 **인용(`sourceQuote`/`unknownNote`)으로 되짚을 수 있을 때만** 그 인용까지 일치시킨다.
    // 소요시간(`duration:15`)은 발행물에 원문 문자열을 남기지 않으므로(계약: `durationMinutes` 만) 모양으로만 센다.
    const byQuote = !expected.startsWith('duration:');
    const sameShape = publishedConditions.filter((item) => item.shape === expected);
    const found = byQuote ? sameShape.filter((item) => item.quote === note) : sameShape;
    expectedTotal += expected === 'unknown' ? 0 : rawCount;
    mappedTotal += found.length;
    const ok = found.length === rawCount;
    check(`"${note}" ×${String(rawCount)} → ${expected}`, ok, `발행물 ${String(found.length)}건`);
    lines.push(`        · 원문 ${String(rawCount)}건 · 기대 ${expected} · 발행물 ${String(found.length)}건`);
  }
  check('원문 편별 note 총계가 발행물 구조화 총계와 같다', mappedTotal === rawTotal, `원문 ${String(rawTotal)} · 구조화 ${String(mappedTotal)}`);
  check('`note` 에 원문 표기 잔존 0(구조화된 행은 비웠다)', publishedConditions.every((item) => !item.noteStale), `잔존 ${String(publishedConditions.filter((i) => i.noteStale).length)}건`);

  /* ② 인용률 ------------------------------------------------------------- */
  lines.push('');
  lines.push('  [AC-D2] 신규 항목 원문 인용률');
  const rawTexts = loadRawSources();
  const termTexts = loadTermSources();
  const quotable = [...rawTexts, ...termTexts];
  const quoteTargets: { readonly where: string; readonly quote: string }[] = [];
  for (const item of publishedConditions) {
    quoteTargets.push({ where: `trip조건(${item.shape})`, quote: item.quote });
  }
  for (const term of asRecords(published['terms'])) {
    const period = term['periodSearch'] as Json | null;
    if (period !== null && typeof period === 'object' && typeof period['evidenceQuote'] === 'string') {
      quoteTargets.push({ where: `periodSearch(${String(term['label'])})`, quote: String(period['evidenceQuote']) });
    }
  }
  let quoted = 0;
  for (const target of quoteTargets) {
    const base64ish = target.quote.startsWith('duration:') ? target.quote.slice('duration:'.length) : target.quote;
    const hit = quotable.some((source) => source.text.includes(base64ish));
    if (hit) quoted += 1;
    else check(`인용 검증 "${target.quote.slice(0, 40)}"`, false, `${target.where} — 원본 부분문자열 아님`);
  }
  const ratio = quoteTargets.length === 0 ? 1 : quoted / quoteTargets.length;
  check(
    `신규 항목 인용률 100% (${String(quoted)}/${String(quoteTargets.length)})`,
    ratio === 1,
    `인용 없는 항목 ${String(quoteTargets.length - quoted)}건`,
  );

  /* ③ 방학 기간 ----------------------------------------------------------- */
  lines.push('');
  lines.push('  [방학 기간] periodSearch 결과');
  const vacation = asRecords(published['terms']).find((term) => term['kind'] === 'vacation');
  if (vacation === undefined) {
    check('방학 term 존재', false, 'terms[] 에 vacation 이 없다');
  } else {
    const period = (vacation['periodSearch'] ?? null) as Json | null;
    info(`start=${JSON.stringify(vacation['start'])} end=${JSON.stringify(vacation['end'])} result=${String(period?.['result'] ?? '(없음)')}`);
    info(`file=${String(period?.['file'] ?? '(없음)')}`);
    info(`evidenceQuote=${JSON.stringify(period?.['evidenceQuote'] ?? null)}`);
    const consistent = period === null
      ? vacation['start'] === null && vacation['end'] === null
      : period['result'] === 'found'
        ? vacation['start'] !== null && vacation['end'] !== null
        : vacation['start'] === null && vacation['end'] === null;
    check('periodSearch 결과와 기간 필드가 일치한다(추측 금지)', consistent);
  }

  check('schemaVersion = 3', published['schemaVersion'] === 3, String(published['schemaVersion']));
  void expectedTotal;

  lines.push('');
  console.log(lines.join('\n'));
  if (failures.length > 0) {
    console.log(`\nVERIFY: FAIL (${String(failures.length)}건)`);
    process.exitCode = 1;
  } else {
    console.log('\nVERIFY: PASS');
  }
}

main();
