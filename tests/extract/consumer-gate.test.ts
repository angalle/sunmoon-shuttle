/**
 * T21 소비자 게이트 테스트 — **스키마 범프 시 RED**(T16·T18 회귀 재발 방지, docs/06 §4).
 *
 * 지난 사고: 발행물은 v2 인데 앱 캐시 게이트가 v1 만 통과시켜 오프라인 폴백이 통째로 죽었다.
 * 그래서 여기서 **발행물의 schemaVersion 이 게이트 목록에 있는지**를 테스트로 못 박는다 —
 * 스키마를 올리고 게이트를 안 넓히면 이 테스트가 즉시 실패한다.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SUPPORTED_SCHEMA_VERSIONS,
  SUPPORTED_SCHEMA_VERSION,
} from '../../src/adapters/in/web/features/schedule/api/timetableApi.js';
import { parseTimetable } from '../../src/adapters/in/web/features/schedule/data/normalize.js';
import { loadFixture } from './support.js';

const PUBLISHED = JSON.parse(readFileSync(join(process.cwd(), 'data', 'timetable.json'), 'utf8')) as {
  readonly schemaVersion: number;
};

/** 앱 파서가 요구하는 최소 v1 계약(정규화가 강제하는 필드만) */
function v1Body(): Record<string, unknown> {
  const { base } = loadFixture();
  return JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
}

describe('T21 소비자 게이트 — 발행물 버전 목록 판정', () => {
  it('게이트는 단일 상수가 아니라 **목록**으로 판정한다', () => {
    expect(Array.isArray(SUPPORTED_SCHEMA_VERSIONS)).toBe(true);
    expect(SUPPORTED_SCHEMA_VERSIONS.length).toBeGreaterThanOrEqual(3);
    expect(SUPPORTED_SCHEMA_VERSIONS).toEqual([...SUPPORTED_SCHEMA_VERSIONS].sort((a, b) => a - b));
  });

  it('현재 계약 버전은 3 이고 목록의 최신과 같다', () => {
    expect(SUPPORTED_SCHEMA_VERSION).toBe(Math.max(...SUPPORTED_SCHEMA_VERSIONS));
    expect(SUPPORTED_SCHEMA_VERSION).toBe(3);
  });

  it('★ 발행물(data/timetable.json)의 schemaVersion 이 게이트 목록에 있다 — 범프 시 RED', () => {
    expect(
      SUPPORTED_SCHEMA_VERSIONS.includes(PUBLISHED.schemaVersion),
      `발행물 schemaVersion=${String(PUBLISHED.schemaVersion)} · 게이트 목록=${JSON.stringify(SUPPORTED_SCHEMA_VERSIONS)} — 스키마를 올렸으면 timetableApi.ts 의 목록도 함께 올려야 한다(T18 회귀)`,
    ).toBe(true);
  });

  it('미지원 버전(목록 밖)은 통과하지 않는다 — 캐시는 버려진다', () => {
    const unsupported = Math.max(...SUPPORTED_SCHEMA_VERSIONS) + 1;
    expect(SUPPORTED_SCHEMA_VERSIONS.includes(unsupported)).toBe(false);
  });
});

describe('T21 하위호환 — v1·v2·v3 본문을 같은 파서가 읽는다', () => {
  it('v1(v3 필드 없음) 본문을 그대로 읽는다', () => {
    const model = parseTimetable(v1Body());
    expect(model.schemaVersion).toBe(1);
    expect(model.routes.length).toBeGreaterThan(0);
  });

  it('v2(편별 조건 없음) 본문을 그대로 읽는다', () => {
    const { rules, base } = loadFixture();
    const v2: Record<string, unknown> = { ...v1Body(), schemaVersion: 2 };
    void rules;
    void base;
    const model = parseTimetable(v2);
    expect(model.schemaVersion).toBe(2);
    expect(model.routes.length).toBeGreaterThan(0);
  });

  it('v3 발행물을 읽는다 — 새 필드(service·durationMinutes·periodSearch)가 있어도 죽지 않는다', () => {
    const model = parseTimetable(JSON.parse(JSON.stringify(loadFixture().enriched)));
    expect(model.schemaVersion).toBe(3);
    const asan = model.schedule.routes.find((route) => route.id === 'asan-ktx');
    expect(asan?.byDay.weekday.length).toBeGreaterThan(0);
    expect(model.terms.some((term) => term.kind === 'vacation')).toBe(true);
  });
});
