/**
 * 조립·검증·CLI 실패 경로 테스트.
 *
 * CLI 는 IO 를 주입받으므로(`tools/scraper/cli.ts`) **파일 시스템을 건드리지 않고** 실패 경로를 그대로 재현한다:
 *  ① 없는 파일 ② 잘린 HTML(표 미완성) ③ 표 구조 변조(헤더 변경·셀 초과) ④ 스키마 검증 실패(빈 배열) ⑤ 옵션 오류
 * 모든 실패에서 **출력 파일을 쓰지 않는다**(조용한 손상 금지).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findRoute, parseSnapshotFileName } from '../../tools/scraper/routeMeta.js';
import { parseSnapshot } from '../../tools/scraper/parse.js';
import { assembleTimetable } from '../../tools/scraper/assemble.js';
import { validateTimetable } from '../../tools/scraper/validate.js';
import { runScrape } from '../../tools/scraper/cli.js';
import type { CliDeps } from '../../tools/scraper/cli.js';
import type { Timetable } from '../../tools/scraper/types.js';

const RAW_DIR = join(process.cwd(), 'data', 'raw');
const FILES = [
  '2026-2학기-asan-ktx-평일.html',
  '2026-2학기-asan-ktx-토요일.html',
  '2026-2학기-asan-ktx-일요일.html',
  '2026-2학기-cheonan-station-평일.html',
  '2026-2학기-cheonan-station-토요일.html',
  '2026-2학기-cheonan-station-일요일.html',
  '2026-2학기-cheonan-terminal-평일.html',
  '2026-2학기-cheonan-terminal-토요일.html',
  '2026-2학기-cheonan-terminal-일요일.html',
  '2026-2학기-onyang-평일.html',
  '2026-2학기-cheonan-campus-평일.html',
] as const;

const PATHS = FILES.map((f) => join(RAW_DIR, f));

function readRaw(fileName: string): string {
  return readFileSync(join(RAW_DIR, fileName), 'utf8');
}

function snapshotOf(fileName: string, html = readRaw(fileName)) {
  const ref = parseSnapshotFileName(fileName);
  return parseSnapshot(html, findRoute(ref.routeId), ref.dayType);
}

function assembleAll(fetchedAt = '2026-10-05T12:00:00+09:00'): Timetable {
  return assembleTimetable(
    FILES.map((f) => snapshotOf(f)),
    { fetchedAt },
  );
}

interface FakeIo {
  readonly deps: CliDeps;
  readonly writes: { path: string; text: string }[];
  readonly errors: string[];
  readonly logs: string[];
}

function fakeIo(reads: Readonly<Record<string, string>> = {}): FakeIo {
  const writes: { path: string; text: string }[] = [];
  const errors: string[] = [];
  const logs: string[] = [];
  const deps: CliDeps = {
    readTextFile: (path) => reads[path] ?? readFileSync(path, 'utf8'),
    writeTextFile: (path, text) => {
      writes.push({ path, text });
    },
    nowIso: () => '2026-10-05T12:00:00+09:00',
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
  };
  return { deps, writes, errors, logs };
}

describe('조립: 11개 스냅샷 → 계약 JSON', () => {
  it('전 노선·요일을 담고 스키마 검증을 통과한다(issues 0)', () => {
    const timetable = assembleAll();
    expect(validateTimetable(timetable)).toEqual([]);
    expect(timetable.routes.map((r) => r.id)).toEqual([
      'asan-ktx',
      'cheonan-station',
      'cheonan-terminal',
      'onyang',
      'cheonan-campus',
    ]);
    expect(timetable.dayTypes).toEqual(['weekday', 'saturday', 'sunday']);
    expect(timetable.semester).toMatchObject({ label: '2026-2학기', startsOn: '2026-09-01', endsOn: '2026-12-14' });
    expect(timetable.holidayPeriod).toMatchObject({ startsOn: '2026-09-05', endsOn: '2026-12-13' });
    expect(timetable.source.pages).toHaveLength(11);
    expect(timetable.source.sourceUpdatedAt).toBe('2026-08-20'); // 페이지별 값 중 최신
    expect(timetable.source.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('노선별 행 수(평일·토·일)를 정확히 담는다', () => {
    const timetable = assembleAll();
    const shape = Object.fromEntries(
      timetable.routes.map((r) => [
        r.id,
        [r.byDay.weekday.trips.length, r.byDay.saturday.trips.length, r.byDay.sunday.trips.length],
      ]),
    );
    expect(shape).toEqual({
      'asan-ktx': [42, 4, 6],
      'cheonan-station': [33, 4, 5],
      'cheonan-terminal': [38, 4, 5],
      onyang: [7, 0, 0],
      'cheonan-campus': [0, 0, 0],
    });
    const total = timetable.routes.reduce(
      (sum, r) => sum + r.byDay.weekday.trips.length + r.byDay.saturday.trips.length + r.byDay.sunday.trips.length,
      0,
    );
    expect(total).toBe(148);
  });

  it('주말 페이지가 없는 노선은 빈 표 + offDays 로 표현한다(평일 표 복사 금지)', () => {
    const onyang = assembleAll().routes.find((r) => r.id === 'onyang');
    expect(onyang?.offDays).toEqual(['saturday', 'sunday']);
    expect(onyang?.byDay.saturday).toEqual({ columns: [], keys: [], trips: [] });
    expect(onyang?.byDay.sunday).toEqual({ columns: [], keys: [], trips: [] });
  });

  it('운행 중단 노선은 status=suspended + 원본 사유 문구를 담는다', () => {
    const campus = assembleAll().routes.find((r) => r.id === 'cheonan-campus');
    expect(campus?.status).toBe('suspended');
    expect(campus?.suspendedReason).toBe('2024-2학기 부터 천안캠퍼스 노선은 운행하지 않습니다.');
    expect(campus?.offDays).toEqual(['weekday', 'saturday', 'sunday']);
  });

  it('공통 정보(안내문·시내버스·문의처)를 중복 없이 담는다', () => {
    const timetable = assembleAll();
    expect(timetable.notices.length).toBe(17);
    expect(timetable.notices.filter((n) => n.kind === 'no-service').map((n) => n.text)).toContain(
      '한글날: 셔틀버스 운행 없음',
    );
    expect(timetable.busRefs).toHaveLength(15);
    expect(new Set(timetable.notices.map((n) => n.raw)).size).toBe(timetable.notices.length);
    expect(timetable.contacts).toEqual({ team: '학생지원팀', tel: '041-530-2152' });
  });

  it('JSON 직렬화 크기는 계약대로 작다(전송 예산 내)', () => {
    const json = JSON.stringify(assembleAll(), null, 2);
    expect(new TextEncoder().encode(json).length).toBeLessThan(150_000);
    // 순번은 정수로만 담긴다(부동소수 없음)
    const seqs = assembleAll().routes.flatMap((r) => r.trips.map((t) => t['seq']));
    expect(seqs.every((s) => typeof s === 'number' && Number.isInteger(s))).toBe(true);
  });
});

describe('검증기: 계약 위반을 잡아낸다', () => {
  const mutate = (fn: (clone: Timetable) => void): Timetable => {
    const clone = JSON.parse(JSON.stringify(assembleAll())) as Timetable;
    fn(clone);
    return clone;
  };

  // Timetable 은 readonly 이므로 테스트에서만 캐스팅해 훼손한다
  it('빈 문자열 셀·끊긴 순번·빈 요일 배열·깨진 hash 를 각각 잡는다', () => {
    const broken = mutate((clone) => {
      const routes = clone.routes as unknown as {
        byDay: Record<string, { trips: Record<string, unknown>[] }>;
        trips: Record<string, unknown>[];
      }[];
      const asan = routes[0];
      if (asan === undefined) throw new Error('테스트 준비 실패');
      const row = asan.byDay['weekday']?.trips[0];
      if (row === undefined) throw new Error('테스트 준비 실패');
      row['depCampus'] = '';
      const second = asan.byDay['weekday']?.trips[1];
      if (second !== undefined) second['seq'] = 99;
      const saturday = asan.byDay['saturday'];
      if (saturday !== undefined) saturday.trips = [];
      (clone.source as unknown as { contentHash: string }).contentHash = `sha256:${'0'.repeat(64)}`;
      (clone.source as unknown as { fetchedAt: string }).fetchedAt = '2026-10-05 12:00:00';
    });
    const messages = validateTimetable(broken).map((i) => `${i.where}: ${i.message}`);
    expect(messages.join('\n')).toMatch(/depCampus.*빈 문자열/);
    expect(messages.join('\n')).toMatch(/seq 가 순번/);
    expect(messages.join('\n')).toMatch(/byDay\.saturday.*행 수 하한/);
    expect(messages.join('\n')).toMatch(/contentHash.*재계산/);
    expect(messages.join('\n')).toMatch(/fetchedAt.*ISO8601/);
  });

  it('시각 열에 시각이 아닌 값이 들어가면 잡는다(열 밀림 감지)', () => {
    const broken = mutate((clone) => {
      const trips = (clone.routes[0]?.byDay['weekday']?.trips ?? []) as unknown as Record<string, unknown>[];
      const row = trips[0];
      if (row === undefined) throw new Error('테스트 준비 실패');
      row['depStation'] = '5분~10분 소요예상';
    });
    expect(validateTimetable(broken).map((i) => i.message).join('\n')).toMatch(/HH:MM 이 아닙니다/);
  });
});

describe('CLI 실패 경로: 실패하면 JSON 을 쓰지 않는다', () => {
  it('정상 실행: exit 0 · 파일 1개 기록 · 요약 로그', () => {
    const io = fakeIo();
    const code = runScrape(['--local', ...PATHS], io.deps);
    expect(code).toBe(0);
    expect(io.writes).toHaveLength(1);
    expect(io.writes[0]?.path).toBe('data/timetable.json');
    expect(io.logs.join('\n')).toContain('검증 통과(issues 0)');
    const written = JSON.parse(io.writes[0]?.text ?? '{}') as { routes: unknown[] };
    expect(written.routes).toHaveLength(5);
  });

  it('① 없는 파일 → exit 1 · 미기록 · 명확한 오류', () => {
    const io = fakeIo();
    const missing = join(RAW_DIR, 'no-such-dir', '2026-2학기-asan-ktx-평일.html');
    const code = runScrape(['--local', missing], io.deps);
    expect(code).toBe(1);
    expect(io.writes).toHaveLength(0);
    expect(io.errors.join('\n')).toContain('파일을 읽을 수 없습니다');
  });

  it('② 잘린 HTML(표 미완성) → exit 1 · 미기록', () => {
    const html = readRaw('2026-2학기-asan-ktx-평일.html');
    const cut = html.slice(0, html.indexOf('시간표시작') + 1500); // 본표 중간에서 잘림
    const io = fakeIo({ [PATHS[0] ?? '']: cut });
    const code = runScrape(['--local', PATHS[0] ?? ''], io.deps);
    expect(code).toBe(1);
    expect(io.writes).toHaveLength(0);
    expect(io.errors.join('\n')).toContain('시간표 표를 찾지 못했습니다');
  });

  it('③ 표 구조 변조 — 헤더 열 이름 변경 → exit 1 · 미기록 · 어느 열인지 명시', () => {
    const html = readRaw('2026-2학기-asan-ktx-평일.html').replace(
      '<th>운행 특이사항</th>',
      '<th>비고</th>',
    );
    const io = fakeIo({ [PATHS[0] ?? '']: html });
    const code = runScrape(['--local', PATHS[0] ?? ''], io.deps);
    expect(code).toBe(1);
    expect(io.writes).toHaveLength(0);
    expect(io.errors.join('\n')).toContain('헤더 5번째 열이 계약과 다릅니다 — 계약 "운행 특이사항", 실제 "비고"');
  });

  it('③-b 표 구조 변조 — 데이터 행에 셀 추가(열 밀림) → exit 1 · 미기록', () => {
    const html = readRaw('2026-2학기-asan-ktx-평일.html').replace(
      '    <td>0:15</td>',
      '    <td>0:15</td>\n    <td>extra-cell</td>',
    );
    const io = fakeIo({ [PATHS[0] ?? '']: html });
    const code = runScrape(['--local', PATHS[0] ?? ''], io.deps);
    expect(code).toBe(1);
    expect(io.writes).toHaveLength(0);
    const errors = io.errors.join('\n');
    expect(errors).toContain('파싱 실패');
    expect(errors).toContain('표 구조 변조 의심'); // 헤더에 없는 슬롯(6번째)에 셀이 생김
    expect(errors).toContain('slot 5');
  });

  it('④ 스키마 검증 실패(시내버스 참고 블록 소실 → busRefs 빈 배열) → exit 1 · 미기록', () => {
    const reads: Record<string, string> = {};
    for (const path of PATHS) {
      reads[path] = readFileSync(path, 'utf8').replace(/노선별 시내버스 참고/g, '노선별 시내버스');
    }
    const io = fakeIo(reads);
    const code = runScrape(['--local', ...PATHS], io.deps);
    expect(code).toBe(1);
    expect(io.writes).toHaveLength(0);
    const errors = io.errors.join('\n');
    expect(errors).toContain('스키마 검증 실패');
    expect(errors).toContain('busRefs: 빈 배열 금지');
  });

  it('⑤ 옵션 오류 — --local 없이 실행 → exit 1 · 원격 fetch 하지 않음', () => {
    const io = fakeIo();
    const code = runScrape([...PATHS], io.deps);
    expect(code).toBe(1);
    expect(io.writes).toHaveLength(0);
    expect(io.errors.join('\n')).toContain('--local 모드만 지원');
  });

  it('⑤ 옵션 오류 — 파일 인자 없음 / 알 수 없는 옵션 / 잘못된 --now → exit 1', () => {
    const a = fakeIo();
    expect(runScrape(['--local'], a.deps)).toBe(1);
    expect(a.errors.join('\n')).toContain('스냅샷 파일 경로가 필요합니다');

    const b = fakeIo();
    expect(runScrape(['--local', '--bogus', ...PATHS], b.deps)).toBe(1);
    expect(b.errors.join('\n')).toContain('알 수 없는 옵션');

    const c = fakeIo();
    expect(runScrape(['--local', '--now', '2026-10-05 12:00', ...PATHS], c.deps)).toBe(1);
    expect(c.errors.join('\n')).toContain('ISO8601');
    expect(c.writes).toHaveLength(0);
  });

  it('⑥ 파일명 규칙 위반(요일 접미사 불명) → exit 1 · 명확한 오류', () => {
    const io = fakeIo();
    const code = runScrape(['--local', join(RAW_DIR, '2026-2학기-asan-ktx-요일혼합.html')], io.deps);
    expect(code).toBe(1);
    expect(io.writes).toHaveLength(0);
    expect(io.errors.join('\n')).toContain('요일 접미사는 평일|토요일|일요일 중 하나여야 합니다');
  });
});
