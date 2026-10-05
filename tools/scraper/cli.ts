/**
 * `npm run scrape -- --local …` 오케스트레이션.
 *
 * 파일 IO·시계·로그는 전부 주입(`CliDeps`)으로 받는다 — 이 모듈은 순수 로직이라
 * 테스트에서 가짜 IO 로 실패 경로(없는 파일·잘린 HTML·표 변조·검증 실패 시 미기록)를 그대로 재현할 수 있다.
 *
 * **원격 fetch(자동 크롤)는 구현하지 않는다**: 원본 `robots.txt` 가 `Disallow: /Page`
 * (= `/Page2/…` 포함)로 차단하므로 코드에 네트워크 경로를 남기지 않는다(`docs/01 §8`).
 */

import { ScrapeError } from './types.js';
import type { Snapshot } from './types.js';
import { ROUTES, findRoute, parseSnapshotFileName } from './routeMeta.js';
import { parseSnapshot } from './parse.js';
import { assembleTimetable } from './assemble.js';
import { validateTimetable } from './validate.js';

export interface CliDeps {
  readTextFile(path: string): string;
  writeTextFile(path: string, text: string): void;
  nowIso(): string;
  log(line: string): void;
  error(line: string): void;
}

const USAGE = [
  '사용법: npm run scrape -- --local data/raw/*.html [--out data/timetable.json] [--now <ISO8601+09:00>]',
  '  --local  로컬 스냅샷만 파싱한다(원격 fetch 는 robots.txt /Page 차단으로 구현하지 않음)',
  '  --out    출력 경로(기본 data/timetable.json)',
  '  --now    수집 시각 주입(결정성 확인용 — 생략 시 현재 시각 KST)',
].join('\n');

const ISO_OFFSET_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

interface Args {
  local: boolean;
  out: string;
  now: string | null;
  files: string[];
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { local: false, out: 'data/timetable.json', now: null, files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token === '--local') {
      args.local = true;
      continue;
    }
    if (token === '--out') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new ScrapeError('--out 뒤에 경로가 필요합니다');
      args.out = value;
      i += 1;
      continue;
    }
    if (token === '--now') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new ScrapeError('--now 뒤에 ISO8601 시각이 필요합니다');
      if (!ISO_OFFSET_PATTERN.test(value)) {
        throw new ScrapeError(`--now 값이 ISO8601(+오프셋) 형식이 아닙니다 — "${value}"`);
      }
      args.now = value;
      i += 1;
      continue;
    }
    if (token.startsWith('--')) throw new ScrapeError(`알 수 없는 옵션: ${token}`);
    args.files.push(token);
  }
  return args;
}

export function runScrape(argv: readonly string[], deps: CliDeps): number {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    deps.error(`[scrape] ${error instanceof Error ? error.message : String(error)}`);
    deps.error(USAGE);
    return 1;
  }

  if (!args.local) {
    deps.error('[scrape] --local 모드만 지원합니다. 원격 fetch(자동 크롤)는 구현하지 않습니다 —');
    deps.error('[scrape]   원본 robots.txt 의 `Disallow: /Page` 가 `/Page2/…` 를 포함해 차단합니다(docs/01 §8).');
    deps.error(USAGE);
    return 1;
  }
  if (args.files.length === 0) {
    deps.error('[scrape] 스냅샷 파일 경로가 필요합니다 — 예: npm run scrape -- --local data/raw/*.html');
    deps.error(USAGE);
    return 1;
  }

  const snapshots: Snapshot[] = [];
  const semesterLabels = new Set<string>();
  const counts = new Map<string, number>();

  for (const file of args.files) {
    // 파일명 규칙·노선 메타를 먼저 확인한다(잘못된 이름이면 읽지도 않는다)
    let ref;
    let meta;
    try {
      ref = parseSnapshotFileName(file);
      meta = findRoute(ref.routeId);
    } catch (error) {
      deps.error(`[scrape] 스냅샷 이름/노선 확인 실패: ${file}`);
      deps.error(`[scrape]   ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }

    let html: string;
    try {
      html = deps.readTextFile(file);
    } catch (error) {
      deps.error(`[scrape] 파일을 읽을 수 없습니다: ${file} — ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    try {
      semesterLabels.add(ref.semesterLabel);
      const snapshot = parseSnapshot(html, meta, ref.dayType);
      if (snapshot.routeId !== meta.id || snapshot.dayType !== ref.dayType) {
        throw new ScrapeError(`내부 오류: 파싱 결과의 (노선, 요일)이 파일명과 다릅니다 — ${file}`);
      }
      snapshots.push(snapshot);
      counts.set(`${meta.id}/${ref.dayType}`, snapshot.trips.length);
    } catch (error) {
      deps.error(`[scrape] 파싱 실패: ${file}`);
      deps.error(`[scrape]   ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }

  if (semesterLabels.size > 1) {
    deps.error(`[scrape] 파일명의 학기가 서로 다릅니다: ${[...semesterLabels].join(' · ')} — 같은 학기 스냅샷만 함께 처리합니다`);
    return 1;
  }

  let timetable;
  try {
    timetable = assembleTimetable(snapshots, { fetchedAt: args.now ?? deps.nowIso() });
  } catch (error) {
    deps.error(`[scrape] 조립 실패: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const issues = validateTimetable(timetable);
  if (issues.length > 0) {
    deps.error(`[scrape] 스키마 검증 실패 — ${issues.length}건. **JSON 을 쓰지 않습니다**(조용한 손상 금지)`);
    for (const issue of issues) deps.error(`[scrape]   ${issue.where}: ${issue.message}`);
    return 1;
  }

  const serialized = `${JSON.stringify(timetable, null, 2)}\n`;
  try {
    deps.writeTextFile(args.out, serialized);
  } catch (error) {
    deps.error(`[scrape] 출력 실패: ${args.out} — ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const dayCounts = new Map<string, number>();
  for (const key of counts.keys()) {
    const day = key.split('/')[1] ?? '?';
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  deps.log(`[scrape] 입력 스냅샷 ${snapshots.length}개 (평일 ${dayCounts.get('weekday') ?? 0} · 토요일 ${dayCounts.get('saturday') ?? 0} · 일요일 ${dayCounts.get('sunday') ?? 0})`);
  for (const route of timetable.routes) {
    const parts = [`평일 ${route.byDay.weekday.trips.length}행`];
    if (route.offDays.includes('saturday')) parts.push('토요일 없음(원본)');
    else parts.push(`토요일 ${route.byDay.saturday.trips.length}행`);
    if (route.offDays.includes('sunday')) parts.push('일요일 없음(원본)');
    else parts.push(`일요일 ${route.byDay.sunday.trips.length}행`);
    deps.log(`[scrape]   ${route.id}(${route.name}) [${route.status}] — ${parts.join(' · ')}`);
  }
  deps.log(`[scrape] 안내문 ${timetable.notices.length}건 · 시내버스 참고 ${timetable.busRefs.length}건 · 문의 ${timetable.contacts.team} ${timetable.contacts.tel}`);
  deps.log(`[scrape] 검증 통과(issues 0) · dayTypes [${timetable.dayTypes.join(', ')}]`);
  deps.log(`[scrape] 씀: ${args.out} (${new TextEncoder().encode(serialized).length} bytes) · ${timetable.source.contentHash}`);
  deps.log(`[scrape] source.sourceUpdatedAt=${timetable.source.sourceUpdatedAt} (페이지 ${timetable.source.pages.length}개 중 최신)`);
  return 0;
}

export const EXPECTED_ROUTES = ROUTES.map((r) => r.id);
