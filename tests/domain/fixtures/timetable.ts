import type { Clock } from '../../../src/ports/clock';
import type { Schedule } from '../../../src/domain/entities/Schedule';
import type { Notice } from '../../../src/domain/entities/Notice';
import type { Trip } from '../../../src/domain/entities/Trip';

/**
 * 테스트 픽스처 — 원본 스냅샷(`data/raw/2026-2학기-asan-ktx-요일혼합.html`)의 실제 값을 축약해 옮긴 것.
 * 값 자체(특이사항 문자열 `금(X)`·`월~화 2대 운행`·`중간노선 전용`, 안내사항 문구)는 원문 그대로다.
 */

function trip(
  seq: number,
  depCampus: string | null,
  depStation: string | null,
  arrCampus: string | null,
  note: string | null,
): Trip {
  return { seq, depCampus, depStation, arrCampus, note };
}

/** 아산(KTX)역 — 평일 표 (원본 42회차 중 경계에 필요한 회차만) */
const ASAN_WEEKDAY: readonly Trip[] = [
  trip(1, '08:05', '08:25', '08:40', null),
  trip(2, null, '08:35', '08:50', '금(X)'),
  trip(3, null, '09:00', '09:15', '월~화 2대 운행'),
  trip(4, '11:00', '11:20', '11:35', '중간노선 전용'),
  trip(5, null, null, null, null),
  trip(41, '20:45', '21:05', '21:20', null),
  trip(42, '21:15', '21:35', '21:50', null),
];

const ASAN_SATURDAY: readonly Trip[] = [
  trip(1, '09:30', '09:50', '10:05', null),
  trip(2, '13:00', '13:20', '13:35', null),
];

const ASAN_SUNDAY: readonly Trip[] = [
  trip(1, '10:00', '10:20', '10:35', null),
  trip(2, '16:00', '16:20', '16:35', null),
];

const CHEONAN_STATION_WEEKDAY: readonly Trip[] = [trip(1, '07:40', '08:15', '08:45', null)];

/** 원본 안내사항 4줄 — 문구는 원문 그대로, 날짜는 하루 단위로 전개된 형태(파서 계약). */
const NOTICES: readonly Notice[] = [
  { kind: 'no-service', date: '2026-10-09', text: '*한글날[10. 9.(금)]: 셔틀버스 운행 없음' },
  { kind: 'no-service', date: '2026-10-28', text: '*개교기념일[10. 28.(수)]: 셔틀버스 운행 없음' },
  { kind: 'day-type-override', date: '2026-10-05', text: '*개천절대체휴일[10. 5.(월)]: 일요일 시간표로 운행' },
  { kind: 'holiday-notice', date: '2026-10-12', text: '패턴 표에 없는 안내 문구(개발용 픽스처)' },
];

export const FIXTURE_SCHEDULE: Schedule = {
  schemaVersion: 1,
  source: {
    url: 'https://lily.sunmoon.ac.kr/Page2/About/About08_04_02_01_01_01.aspx',
    sourceUpdatedAt: '2026-08-20',
    fetchedAt: '2026-10-05T03:00:12+09:00',
    contentHash: 'sha256:fixture',
  },
  semester: { label: '2026-2학기', startsOn: '2026-09-01', endsOn: '2026-12-14' },
  dayTypes: ['weekday', 'saturday', 'sunday'],
  routes: [
    {
      id: 'asan-ktx',
      name: '아산(KTX)역',
      path: '아산캠퍼스 > 탕정역 > 시티프라디움 > 천안아산역 > 아산캠퍼스',
      columns: ['seq', 'depCampus', 'depStation', 'arrCampus', 'note'],
      trips: ASAN_WEEKDAY,
      byDay: { weekday: ASAN_WEEKDAY, saturday: ASAN_SATURDAY, sunday: ASAN_SUNDAY },
    },
    {
      id: 'cheonan-station',
      name: '천안역',
      path: '아산캠퍼스 > 월봉청솔1단지 > 천안역 > 아산캠퍼스',
      columns: ['seq', 'depCampus', 'depStation', 'arrCampus', 'note'],
      trips: CHEONAN_STATION_WEEKDAY,
      byDay: { weekday: CHEONAN_STATION_WEEKDAY, saturday: [], sunday: [] },
    },
    {
      id: 'cheonan-campus',
      name: '천안캠퍼스',
      path: '천안캠퍼스(운행하지 않음)',
      columns: ['seq', 'depCampus', 'depStation', 'arrCampus', 'note'],
      trips: [],
      byDay: { weekday: [], saturday: [], sunday: [] },
    },
  ],
  notices: NOTICES,
};

/** 고정 시각 clock — `Date.now()` 대신 이걸 주입한다(테스트 결정성). */
export function clockAt(kstIso: string): Clock {
  return { now: () => new Date(kstIso) };
}
