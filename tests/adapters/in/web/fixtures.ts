/**
 * 프론트 테스트 픽스처 — 계약(JSON)과 **같은 형태**의 작은 표본을 `parseTimetable` 로 통과시켜
 * 뷰모델을 만든다(계약 → 뷰모델 경로를 테스트가 우회하지 않게).
 */
import { parseTimetable } from '../../../../src/adapters/in/web/features/schedule/data/normalize';
import type { TimetableModel } from '../../../../src/adapters/in/web/features/schedule/types/model';

/** 2026-10-05(월)은 개천절 대체휴일(일요일 시간표), 2026-10-09(금)은 한글날 운행 없음. */
export const FIXTURE_RAW: unknown = {
  schemaVersion: 1,
  semester: { title: '2026-2학기 셔틀버스 시간표', label: '2026-2학기', startsOn: '2026-09-01', endsOn: '2026-12-14', kind: 'semester' },
  holidayPeriod: null,
  dayTypes: ['weekday', 'saturday', 'sunday'],
  routes: [
    {
      id: 'route-a',
      name: 'A노선',
      path: '캠퍼스 > 역 > 캠퍼스',
      status: 'active',
      offDays: ['sunday'],
      columns: ['seq', 'depCampus', 'arrCampus'],
      trips: [{ seq: 1, depCampus: '08:05', arrCampus: '08:40' }],
      byDay: {
        weekday: {
          columns: ['순', '출발', '도착'],
          keys: ['seq', 'depCampus', 'arrCampus'],
          trips: [
            { seq: 1, depCampus: '08:05', arrCampus: '08:40' },
            { seq: 2, depCampus: '09:05', arrCampus: '09:40' },
            { seq: 3, depCampus: '10:05', arrCampus: '10:40' },
            { seq: 4, depCampus: '11:05', arrCampus: '11:40' },
          ],
        },
        saturday: {
          columns: ['순', '출발', '도착'],
          keys: ['seq', 'depCampus', 'arrCampus'],
          trips: [{ seq: 1, depCampus: '09:00', arrCampus: '09:35' }],
        },
        sunday: null,
      },
    },
    {
      id: 'route-b',
      name: 'B노선',
      path: '',
      status: 'active',
      offDays: ['saturday', 'sunday'],
      columns: ['seq'],
      trips: [],
      byDay: {
        weekday: { columns: ['순'], keys: ['seq'], trips: [] },
        saturday: null,
        sunday: null,
      },
    },
    {
      id: 'route-c',
      name: 'C노선',
      path: '',
      status: 'active',
      offDays: ['weekday', 'saturday'],
      columns: ['seq'],
      trips: [],
      byDay: {
        weekday: null,
        saturday: null,
        sunday: {
          columns: ['순', '출발'],
          keys: ['seq', 'depCampus'],
          trips: [{ seq: 1, depCampus: '12:00' }],
        },
      },
    },
    {
      id: 'route-suspended',
      name: '운행중단노선',
      path: '',
      status: 'suspended',
      suspendedReason: '2024-2학기 부터 운행하지 않습니다.',
      offDays: ['weekday', 'saturday', 'sunday'],
      columns: [],
      trips: [],
      byDay: {
        weekday: { columns: [], keys: [], trips: [] },
        saturday: { columns: [], keys: [], trips: [] },
        sunday: { columns: [], keys: [], trips: [] },
      },
    },
  ],
  notices: [
    { kind: 'no-service', text: '한글날: 셔틀버스 운행 없음', raw: '*한글날[10. 9.(금)]: 셔틀버스 운행 없음', date: '2026-10-09' },
    {
      kind: 'alternate-schedule',
      text: '개천절대체휴일: 일요일 시간표로 운행',
      raw: '*개천절대체휴일[10. 5.(월)]: 일요일 시간표로 운행',
      date: '2026-10-05',
    },
    { kind: 'notice', text: '요금 안내', raw: '- 요금 결제: 모든 선,후불 교통카드 가능' },
  ],
  busRefs: [{ line: '970', stop: '선문대 서문 승강장', to: '천안터미널' }],
  contacts: { team: '학생지원팀', tel: '041-530-2152' },
  source: {
    url: 'https://example.test/Page2/About/About08_04_01.aspx',
    sourceUpdatedAt: '2026-08-20',
    fetchedAt: '2026-10-05T14:39:32+09:00',
    contentHash: 'sha256:fixture',
    pages: [],
  },
};

export function buildFixtureModel(): TimetableModel {
  return parseTimetable(FIXTURE_RAW);
}

export const NOW = Date.parse('2026-10-06T07:40:00+09:00');

export function clockAt(kstIso: string): { now: () => Date } {
  return { now: () => new Date(kstIso) };
}
