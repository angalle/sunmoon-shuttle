/**
 * 결정성 테스트 — 같은 입력 → 같은 JSON.
 *
 * 원본 HTML 은 ASP.NET 동적 토큰(`__VIEWSTATE`/`__EVENTVALIDATION`) 때문에 **매 요청 바이트가 다르다**
 * (`docs/recon/T1-사이트맵-실측.md §7`). 그래서 비교 대상은 **원본 HTML 해시가 아니라 파싱 결과(정규화 JSON)** 다.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findRoute, parseSnapshotFileName } from '../../tools/scraper/routeMeta.js';
import { parseSnapshot } from '../../tools/scraper/parse.js';
import { assembleTimetable, sha256Hex } from '../../tools/scraper/assemble.js';
import type { Snapshot } from '../../tools/scraper/types.js';

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

function readRaw(fileName: string): string {
  return readFileSync(join(RAW_DIR, fileName), 'utf8');
}

function snap(fileName: string, html = readRaw(fileName)): Snapshot {
  const ref = parseSnapshotFileName(fileName);
  return parseSnapshot(html, findRoute(ref.routeId), ref.dayType);
}

describe('결정성: 같은 HTML → 같은 JSON', () => {
  it('같은 스냅샷을 2회 파싱하면 직렬화 결과·해시가 동일하다(11개 전부)', () => {
    const first = FILES.map((file) => JSON.stringify(snap(file)));
    const second = FILES.map((file) => JSON.stringify(snap(file)));
    expect(second).toEqual(first);
    const firstHash = first.map((json) => sha256Hex(json));
    expect(second.map((json) => sha256Hex(json))).toEqual(firstHash);
  });

  it('ASP.NET 동적 토큰(__VIEWSTATE)만 다른 같은 페이지는 파싱 결과가 동일하다', () => {
    const html = readRaw('2026-2학기-asan-ktx-평일.html');
    const mutated = html.replace(/id="__VIEWSTATE" value="[^"]*"/, 'id="__VIEWSTATE" value="MUTATED-TOKEN-VALUE"');
    expect(mutated).not.toBe(html); // 치환이 실제로 일어났는지 확인
    expect(sha256Hex(mutated)).not.toBe(sha256Hex(html)); // HTML 해시는 다르다
    expect(JSON.stringify(snap('2026-2학기-asan-ktx-평일.html', mutated))).toBe(
      JSON.stringify(snap('2026-2학기-asan-ktx-평일.html')),
    ); // 파싱 결과는 같다
  });

  it('조립 결과: 같은 fetchedAt 이면 바이트 단위로 동일하다', () => {
    const snapshots = FILES.map((file) => snap(file));
    const run1 = JSON.stringify(assembleTimetable(snapshots, { fetchedAt: '2026-10-05T12:00:00+09:00' }));
    const run2 = JSON.stringify(assembleTimetable(snapshots, { fetchedAt: '2026-10-05T12:00:00+09:00' }));
    expect(run2).toBe(run1);
    expect(sha256Hex(run2)).toBe(sha256Hex(run1));
  });

  it('fetchedAt(수집 시각)만 다르면 contentHash(데이터 해시)는 그대로다 — 변경 감지의 근거', () => {
    const snapshots = FILES.map((file) => snap(file));
    const a = assembleTimetable(snapshots, { fetchedAt: '2026-10-05T12:00:00+09:00' });
    const b = assembleTimetable(snapshots, { fetchedAt: '2026-10-06T09:30:00+09:00' });
    expect(b.source.contentHash).toBe(a.source.contentHash);
    expect(b.source.fetchedAt).not.toBe(a.source.fetchedAt);
    expect(JSON.stringify(b.routes)).toBe(JSON.stringify(a.routes));
  });

  it('입력 순서(글롭 순서)가 달라도 결과 JSON 이 같다', () => {
    const snapshots = FILES.map((file) => snap(file));
    const forward = JSON.stringify(assembleTimetable(snapshots, { fetchedAt: '2026-10-05T12:00:00+09:00' }));
    const backward = JSON.stringify(
      assembleTimetable([...snapshots].reverse(), { fetchedAt: '2026-10-05T12:00:00+09:00' }),
    );
    expect(backward).toBe(forward);
  });
});
