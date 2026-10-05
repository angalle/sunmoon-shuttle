/**
 * V1 보드(T12) 테스트 픽스처 — 계약(JSON)과 **같은 형태**를 `parseTimetable` 로 통과시켜 뷰모델을 만든다.
 *
 * 실제 데이터(`data/timetable.json`)의 성질을 작게 재현한다.
 *  - `r-asan`     : 평일 표에 **양방향** 회차(캠퍼스 출발 = out / 역 출발 = in) + 특이사항(`금(X)`, `월~화 2대 운행`)
 *                   + 해석 불가 표기(`중간노선 전용` → 도메인 경고) + 12편 초과(목록 잘림 검증)
 *  - `r-cheonan`  : 평일만 운행(주말 표 없음 = offDays), 캠퍼스/터미널 출발
 *  - `r-sunday`   : 일요일만 운행 — 개천절 대체휴일(2026-10-05)에 쓰이는 표
 *  - `r-suspended`: 운행 중단(보드에서 제외)
 * 안내문: 2026-10-05 대체 시간표(일요일), 2026-10-09 운행 없음(한글날).
 */

export const BOARD_RAW: unknown = {
  schemaVersion: 1,
  semester: {
    title: '2026-2학기 셔틀버스 시간표',
    label: '2026-2학기',
    startsOn: '2026-09-01',
    endsOn: '2026-12-14',
    kind: 'semester',
  },
  holidayPeriod: null,
  dayTypes: ['weekday', 'saturday', 'sunday'],
  routes: [
    {
      id: 'r-asan',
      name: '아산(KTX)역',
      path: '아산캠퍼스 > 천안아산역 > 아산캠퍼스',
      status: 'active',
      offDays: [],
      columns: ['순', '아산캠퍼스 출발', '천안아산역 출발', '아산캠퍼스 도착', '운행 특이사항'],
      trips: [{ seq: 1, depCampus: '08:00', depStation: '08:20', arrCampus: '08:35', note: '0:15' }],
      byDay: {
        weekday: {
          columns: ['순', '아산캠퍼스 출발', '천안아산역 출발', '아산캠퍼스 도착', '운행 특이사항'],
          keys: ['seq', 'depCampus', 'depStation', 'arrCampus', 'note'],
          trips: [
            { seq: 1, depCampus: '08:00', depStation: '08:20', arrCampus: '08:35', note: '0:15' },
            { seq: 2, depCampus: null, depStation: '08:30', arrCampus: '08:45', note: '금(X)' },
            { seq: 3, depCampus: null, depStation: '09:00', arrCampus: '09:15', note: '월~화 2대 운행' },
            { seq: 4, depCampus: '09:30', depStation: '09:50', arrCampus: '10:05', note: null },
            { seq: 5, depCampus: '10:00', depStation: '10:20', arrCampus: '10:35', note: null },
            { seq: 6, depCampus: '10:30', depStation: '10:50', arrCampus: '11:05', note: null },
            { seq: 7, depCampus: '11:00', depStation: '11:20', arrCampus: '11:35', note: null },
            { seq: 8, depCampus: '11:30', depStation: '11:50', arrCampus: '12:05', note: null },
            { seq: 9, depCampus: '12:00', depStation: '12:20', arrCampus: '12:35', note: null },
            { seq: 10, depCampus: '12:30', depStation: '12:50', arrCampus: '13:05', note: null },
            { seq: 11, depCampus: '13:00', depStation: '13:20', arrCampus: '13:35', note: null },
            { seq: 12, depCampus: '13:30', depStation: '13:50', arrCampus: '14:05', note: null },
            { seq: 13, depCampus: '14:00', depStation: '14:20', arrCampus: '14:35', note: null },
            { seq: 14, depCampus: '14:30', depStation: '14:50', arrCampus: '15:05', note: null },
            { seq: 15, depCampus: '15:00', depStation: '15:20', arrCampus: '15:35', note: null },
            { seq: 16, depCampus: null, depStation: '20:00', arrCampus: '20:15', note: '중간노선 전용' },
          ],
        },
        saturday: {
          columns: ['순', '아산캠퍼스 (출발)', '천안아산역', '아산캠퍼스 (도착)'],
          keys: ['seq', 'depCampus', 'depStation', 'arrCampus'],
          trips: [{ seq: 1, depCampus: '09:00', depStation: '09:20', arrCampus: '09:35' }],
        },
        sunday: null,
      },
    },
    {
      id: 'r-cheonan',
      name: '천안터미널',
      path: '아산캠퍼스 > 터미널 > 아산캠퍼스',
      status: 'active',
      offDays: ['saturday', 'sunday'],
      columns: ['순', '아산캠퍼스 (출발)', '터미널', '아산캠퍼스 (도착)'],
      trips: [{ seq: 1, depCampus: '07:30', depTerminal: '08:00', arrCampus: '08:30' }],
      byDay: {
        weekday: {
          columns: ['순', '아산캠퍼스 (출발)', '터미널', '아산캠퍼스 (도착)'],
          keys: ['seq', 'depCampus', 'depTerminal', 'arrCampus'],
          trips: [
            { seq: 1, depCampus: '07:30', depTerminal: '08:00', arrCampus: '08:30' },
            { seq: 2, depCampus: '08:05', depTerminal: '08:35', arrCampus: '09:05' },
            { seq: 3, depCampus: '09:30', depTerminal: '10:00', arrCampus: '10:30' },
          ],
        },
        saturday: null,
        sunday: null,
      },
    },
    {
      id: 'r-sunday',
      name: '일요노선',
      path: '',
      status: 'active',
      offDays: ['weekday', 'saturday'],
      columns: ['순', '출발', '도착'],
      trips: [],
      byDay: {
        weekday: null,
        saturday: null,
        sunday: {
          columns: ['순', '출발', '도착'],
          keys: ['seq', 'depCampus', 'arrCampus'],
          trips: [
            { seq: 1, depCampus: '09:00', arrCampus: '09:30' },
            { seq: 2, depCampus: '12:00', arrCampus: '12:30' },
          ],
        },
      },
    },
    {
      id: 'r-suspended',
      name: '중단노선',
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
    { kind: 'notice', text: '요금 결제: 모든 선,후불 교통카드 가능', raw: '- 요금 결제: 모든 선,후불 교통카드 가능' },
  ],
  busRefs: [{ line: '970', stop: '선문대 서문 승강장', to: '천안터미널' }],
  contacts: { team: '학생지원팀', tel: '041-530-2152' },
  source: {
    url: 'https://example.test/Page2/About/About08_04_01.aspx',
    sourceUpdatedAt: '2026-08-20',
    fetchedAt: '2026-10-05T14:39:32+09:00',
    contentHash: 'sha256:board-fixture',
    pages: [],
  },
};
