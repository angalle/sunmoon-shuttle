import { readFileSync } from 'node:fs';
import { nextDepartures } from '../../src/domain/rules/nextDeparture';
import type { Schedule } from '../../src/domain/entities/Schedule';

// T5 계약 확인용 프로브 — T2 산출 JSON 을 T4 도메인 함수에 그대로 넣어본다.
const data = JSON.parse(readFileSync('data/timetable.json', 'utf8')) as unknown as Schedule;
const clock = { now: () => new Date('2026-10-05T08:00:00+09:00') };

for (const id of ['asan-ktx', 'cheonan-terminal', 'onyang']) {
  try {
    const r = nextDepartures({ schedule: data, routeId: id, clock });
    console.log(id, '=>', JSON.stringify(r).slice(0, 320));
  } catch (e) {
    console.log(id, '=> THREW:', (e as Error).message);
  }
}
