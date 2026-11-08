/**
 * 정기 배치 게이트 — `.github/scripts/schedule_gate.mjs`
 * (사용자 결정 2026-11-08: "학사일정상 변동이 있을 때 일주일 정도만 하루 한 번, 저녁에")
 *
 * 개강일·방학 시작일 앞뒤 3일(총 7일)에만 run=true. 판단 근거가 없으면 열린 쪽(run=true)으로 실패한다.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// @ts-expect-error — 워크플로 스크립트(.mjs)라 타입 선언이 없다
import { decide, todayKst, WINDOW_DAYS } from '../../.github/scripts/schedule_gate.mjs';

type Decision = { run: boolean; reason: string };
const decideTyped = decide as (timetable: unknown, today: string) => Decision;

const published: unknown = JSON.parse(readFileSync('data/timetable.json', 'utf8'));

describe('schedule_gate — 발행본의 학사일정으로 판정', () => {
  it('창은 앞뒤 3일', () => {
    expect(WINDOW_DAYS).toBe(3);
  });

  it('동계방학 시작(12.15) D-3 ~ D+3 만 실행, 그 바깥은 건너뜀', () => {
    expect(decideTyped(published, '2026-12-11').run).toBe(false);
    for (const day of ['2026-12-12', '2026-12-13', '2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18']) {
      expect(decideTyped(published, day).run, day).toBe(true);
    }
    expect(decideTyped(published, '2026-12-19').run).toBe(false);
  });

  it('2학기 개강(9.1) 주간도 잡힌다 · 평범한 날은 다음 구간을 알려 준다', () => {
    expect(decideTyped(published, '2026-09-01')).toMatchObject({ run: true });
    expect(decideTyped(published, '2026-11-08')).toMatchObject({ run: false });
    expect(decideTyped(published, '2026-11-08').reason).toContain('2026-12-15');
  });

  it('공휴일·시험만으로는 돌지 않는다(전환일 = 개강·방학 시작)', () => {
    expect(decideTyped(published, '2026-10-09').run).toBe(false); // 한글날
    expect(decideTyped(published, '2026-10-22').run).toBe(false); // 중간고사 중
  });

  it('근거가 없으면 열린 쪽으로 실패(run=true)', () => {
    expect(decideTyped(null, '2026-11-08').run).toBe(true);
    expect(decideTyped({ academicEvents: [] }, '2026-11-08').run).toBe(true);
    expect(decideTyped({ academicEvents: [{ kind: 'holiday', start: '2026-12-25' }] }, '2026-11-08').run).toBe(true);
  });

  it('todayKst 는 KST 날짜(UTC 15시 = 다음 날 0시)', () => {
    expect((todayKst as (now: Date) => string)(new Date('2026-11-08T15:00:00Z'))).toBe('2026-11-09');
    expect((todayKst as (now: Date) => string)(new Date('2026-11-08T10:10:00Z'))).toBe('2026-11-08');
  });
});
