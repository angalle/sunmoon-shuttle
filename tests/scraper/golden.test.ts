/**
 * 골든 픽스처 테스트 — **기대값은 원본 HTML(`data/raw/*.html`)에서 직접 읽었다.**
 *
 * 근거(원본 대조):
 *  - `data/raw/README.md` 스냅샷 목록(파일별 `<tr>` 수)
 *  - `docs/recon/T1-사이트맵-실측.md §3`(노선별 표 구조·열 헤더 원문·병합 셀)
 *  - 독립 추출기(파이썬, 파서와 다른 구현) 산출: `.session-notes/evidence/t2-logical-rows.py` 계열 —
 *    열별 `null`(=Χ/빈칸) 개수는 그 출력에서 그대로 옮겼다.
 *
 * 시각 정규화 규칙: 원본 `8:05` → `08:05`(`docs/01 §4` 예시와 동일한 H:MM → HH:MM 정규화).
 *  `note` 성격 열(`운행 특이사항`, `금요일 운행여부`)은 **원문 보존**(예: `0:15`, `금(X)`, `중간노선전용`, `경유`).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findRoute, parseSnapshotFileName } from '../../tools/scraper/routeMeta.js';
import { parseSnapshot } from '../../tools/scraper/parse.js';
import type { Snapshot } from '../../tools/scraper/types.js';

const RAW_DIR = join(process.cwd(), 'data', 'raw');

function load(fileName: string): Snapshot {
  const ref = parseSnapshotFileName(join(RAW_DIR, fileName));
  return parseSnapshot(readFileSync(join(RAW_DIR, fileName), 'utf8'), findRoute(ref.routeId), ref.dayType);
}

interface GoldenCase {
  readonly file: string;
  readonly rows: number;
  readonly columns: readonly string[];
  readonly keys: readonly string[];
  readonly updatedAt: string;
  /** 열별 `null` 개수(원본의 Χ·빈칸) */
  readonly nulls: Readonly<Record<string, number>>;
  /** 스팟 행(1-based 순번 → 기대 행 전체) */
  readonly spot: Readonly<Record<number, Record<string, string | number | null>>>;
}

const CASES: readonly GoldenCase[] = [
  {
    file: '2026-2학기-asan-ktx-평일.html',
    rows: 42,
    columns: ['순', '아산캠퍼스 출발', '천안아산역 출발', '아산캠퍼스 도착', '운행 특이사항'],
    keys: ['seq', 'depCampus', 'depStation', 'arrCampus', 'note'],
    updatedAt: '2026-08-20',
    nulls: { seq: 0, depCampus: 9, depStation: 0, arrCampus: 0, note: 18 },
    spot: {
      1: { seq: 1, depCampus: '08:05', depStation: '08:25', arrCampus: '08:40', note: '0:15' },
      2: { seq: 2, depCampus: null, depStation: '08:35', arrCampus: '08:50', note: '금(X)' },
      4: { seq: 4, depCampus: null, depStation: '08:45', arrCampus: '09:00', note: '월~화 2대 운행' },
      7: { seq: 7, depCampus: null, depStation: '09:00', arrCampus: '09:15', note: '월~목 2대 운행' },
      42: { seq: 42, depCampus: '21:15', depStation: '21:35', arrCampus: '21:50', note: null },
    },
  },
  {
    file: '2026-2학기-asan-ktx-토요일.html',
    rows: 4,
    columns: ['순', '아산캠퍼스 (출발)', '천안아산역', '아산캠퍼스 (도착)'],
    keys: ['seq', 'depCampus', 'depStation', 'arrCampus'],
    updatedAt: '2025-08-27',
    nulls: { seq: 0, depCampus: 0, depStation: 0, arrCampus: 0 },
    spot: {
      1: { seq: 1, depCampus: '08:00', depStation: '08:20', arrCampus: '08:35' },
      4: { seq: 4, depCampus: '18:20', depStation: '18:40', arrCampus: '18:55' },
    },
  },
  {
    file: '2026-2학기-asan-ktx-일요일.html',
    rows: 6,
    columns: ['순', '아산캠퍼스 (출발)', '천안아산역', '아산캠퍼스 (도착)'],
    keys: ['seq', 'depCampus', 'depStation', 'arrCampus'],
    updatedAt: '2025-08-27',
    nulls: { seq: 0, depCampus: 0, depStation: 0, arrCampus: 0 },
    spot: {
      1: { seq: 1, depCampus: '09:00', depStation: '09:20', arrCampus: '09:35' },
      6: { seq: 6, depCampus: '20:00', depStation: '20:20', arrCampus: '20:35' },
    },
  },
  {
    file: '2026-2학기-cheonan-station-평일.html',
    rows: 33,
    columns: ['순', '아산캠퍼스 출발', '천안역 출발', '하이렉스파 건너편', '용암마을', '아산캠퍼스도착', '운행 특이사항'],
    keys: ['seq', 'depCampus', 'depStation', 'viaHairexpa', 'viaYongam', 'arrCampus', 'note'],
    updatedAt: '2025-08-27',
    nulls: { seq: 0, depCampus: 8, depStation: 1, viaHairexpa: 0, viaYongam: 0, arrCampus: 0, note: 16 },
    spot: {
      1: {
        seq: 1,
        depCampus: '07:40',
        depStation: '08:15',
        viaHairexpa: '5분~10분 소요예상',
        viaYongam: '5분~10분 소요예상',
        arrCampus: '08:45',
        note: null,
      },
      // 병합 셀이 없는 유일한 행(7셀) — 하이렉스파에 시각, 용암마을에 소요시간이 들어간다
      5: {
        seq: 5,
        depCampus: null,
        depStation: null,
        viaHairexpa: '08:50',
        viaYongam: '2분~5분 소요',
        arrCampus: '09:05',
        note: '중간노선 전용',
      },
      33: {
        seq: 33,
        depCampus: '21:20',
        depStation: '21:45',
        viaHairexpa: '5분~10분 소요예상',
        viaYongam: '5분~10분 소요예상',
        arrCampus: '22:10',
        note: '금(X)',
      },
    },
  },
  {
    file: '2026-2학기-cheonan-station-토요일.html',
    rows: 4,
    columns: ['순', '아산캠퍼스 (출발)', '천안역', '아산캠퍼스 (도착)'],
    keys: ['seq', 'depCampus', 'depStation', 'arrCampus'],
    updatedAt: '2025-08-27',
    nulls: { seq: 0, depCampus: 0, depStation: 0, arrCampus: 0 },
    spot: {
      1: { seq: 1, depCampus: '08:00', depStation: '08:30', arrCampus: '09:00' },
      4: { seq: 4, depCampus: '18:10', depStation: '18:40', arrCampus: '19:10' },
    },
  },
  {
    file: '2026-2학기-cheonan-station-일요일.html',
    rows: 5,
    columns: ['순', '아산캠퍼스 (출발)', '천안역', '아산캠퍼스 (도착)'],
    keys: ['seq', 'depCampus', 'depStation', 'arrCampus'],
    updatedAt: '2025-08-27',
    nulls: { seq: 0, depCampus: 0, depStation: 0, arrCampus: 0 },
    spot: {
      1: { seq: 1, depCampus: '09:00', depStation: '09:30', arrCampus: '10:00' },
      5: { seq: 5, depCampus: '19:00', depStation: '19:30', arrCampus: '20:00' },
    },
  },
  {
    file: '2026-2학기-cheonan-terminal-평일.html',
    rows: 38,
    columns: ['순', '아산캠퍼스 (출발)', '터미널', '두정동 맥도날드', '홈마트 에브리데이', '서울대정병원', '아산캠퍼스 (도착)', '운행 특이사항'],
    keys: ['seq', 'depCampus', 'depTerminal', 'viaDujeong', 'viaHomeMart', 'viaSeoulJeong', 'arrCampus', 'note'],
    updatedAt: '2025-08-27',
    nulls: {
      seq: 0,
      depCampus: 9,
      depTerminal: 1,
      viaDujeong: 0,
      viaHomeMart: 0,
      viaSeoulJeong: 0,
      arrCampus: 0,
      note: 17,
    },
    spot: {
      1: {
        seq: 1,
        depCampus: '07:30',
        depTerminal: '08:10',
        viaDujeong: '5분~20분 소요예상',
        viaHomeMart: '5분~20분 소요예상',
        viaSeoulJeong: '5분~20분 소요예상',
        arrCampus: '08:50',
        note: null,
      },
      // 병합 셀이 2칸인 행(7셀)
      9: {
        seq: 9,
        depCampus: null,
        depTerminal: null,
        viaDujeong: '08:55',
        viaHomeMart: '5~10분 소요예상',
        viaSeoulJeong: '5~10분 소요예상',
        arrCampus: '09:10',
        note: '중간노선전용',
      },
      38: {
        seq: 38,
        depCampus: '21:30',
        depTerminal: '22:00',
        viaDujeong: '5분~20분 소요예상',
        viaHomeMart: '5분~20분 소요예상',
        viaSeoulJeong: '5분~20분 소요예상',
        arrCampus: '22:30',
        note: '금(X)',
      },
    },
  },
  {
    file: '2026-2학기-cheonan-terminal-토요일.html',
    rows: 4,
    columns: ['순', '선문대 (출발)', '터미널', '선문대 (도착)'],
    keys: ['seq', 'depCampus', 'depTerminal', 'arrCampus'],
    updatedAt: '2025-08-27',
    nulls: { seq: 0, depCampus: 0, depTerminal: 0, arrCampus: 0 },
    spot: {
      1: { seq: 1, depCampus: '08:00', depTerminal: '08:30', arrCampus: '09:00' },
      4: { seq: 4, depCampus: '18:00', depTerminal: '18:30', arrCampus: '19:00' },
    },
  },
  {
    file: '2026-2학기-cheonan-terminal-일요일.html',
    rows: 5,
    columns: ['순', '선문대 (출발)', '터미널', '선문대 (도착)'],
    keys: ['seq', 'depCampus', 'depTerminal', 'arrCampus'],
    updatedAt: '2025-08-27',
    nulls: { seq: 0, depCampus: 0, depTerminal: 0, arrCampus: 0 },
    spot: {
      1: { seq: 1, depCampus: '09:00', depTerminal: '09:30', arrCampus: '10:00' },
      5: { seq: 5, depCampus: '19:30', depTerminal: '20:00', arrCampus: '20:30' },
    },
  },
  {
    file: '2026-2학기-onyang-평일.html',
    rows: 7,
    columns: ['순', '아산캠퍼스 (출발)', '주은아파트 버스정류장', '온양온천역', '아산터미널', '권곡초 버스정류장', '아산캠퍼스 (도착)', '금요일 운행여부'],
    keys: ['seq', 'depCampus', 'viaJueun', 'viaOnyangStation', 'viaAsanTerminal', 'viaGweongok', 'arrCampus', 'note'],
    updatedAt: '2025-08-27',
    nulls: { seq: 0, depCampus: 3, viaJueun: 1, viaOnyangStation: 0, viaAsanTerminal: 0, viaGweongok: 0, arrCampus: 0, note: 5 },
    spot: {
      1: {
        seq: 1,
        depCampus: null,
        viaJueun: '08:00', // 원본 "8:00" → 정규화
        viaOnyangStation: '08:10',
        viaAsanTerminal: '08:15',
        viaGweongok: '경유',
        arrCampus: '08:40',
        note: null,
      },
      2: {
        seq: 2,
        depCampus: null,
        viaJueun: null,
        viaOnyangStation: '08:45',
        viaAsanTerminal: '08:50',
        viaGweongok: '경유',
        arrCampus: '09:15',
        note: '금(X)',
      },
      4: {
        seq: 4,
        depCampus: '10:25',
        viaJueun: '경유',
        viaOnyangStation: '10:55',
        viaAsanTerminal: '11:00',
        viaGweongok: '경유',
        arrCampus: '11:20',
        note: null,
      },
      7: {
        seq: 7,
        depCampus: '18:30',
        viaJueun: '경유',
        viaOnyangStation: '19:00',
        viaAsanTerminal: '19:05',
        viaGweongok: '경유',
        arrCampus: '19:25',
        note: null,
      },
    },
  },
];

describe('골든: 원본 스냅샷 → 표(행 수·셀 값·Χ→null·특이사항)', () => {
  it.each(CASES.map((c) => [c.file, c] as const))('%s', (_fileName, golden) => {
    const snapshot = load(golden.file);

    expect(snapshot.columns).toEqual(golden.columns);
    expect(snapshot.keys).toEqual(golden.keys);
    expect(snapshot.trips.length).toBe(golden.rows);
    expect(snapshot.sourceUpdatedAt).toBe(golden.updatedAt);

    // 빈 문자열 금지(빈칸은 null 로만 표현된다)
    for (const trip of snapshot.trips) {
      for (const [key, value] of Object.entries(trip)) {
        expect(value, `${golden.file} ${key} 이 빈 문자열`).not.toBe('');
      }
    }

    // 열별 null(=Χ/빈칸) 개수
    for (const [key, expected] of Object.entries(golden.nulls)) {
      const actual = snapshot.trips.filter((trip) => trip[key] === null).length;
      expect(actual, `${golden.file} 열 ${key} 의 null 개수`).toBe(expected);
    }

    // 스팟 행 전체 값
    for (const [seqText, expected] of Object.entries(golden.spot)) {
      const seq = Number(seqText);
      const row = snapshot.trips.find((trip) => trip['seq'] === seq);
      expect(row, `${golden.file} 순번 ${seq} 행이 없음`).toBeDefined();
      expect(row).toEqual(expected);
    }
  });

  it('평일 스냅샷의 학기 문구 / 주말 스냅샷의 휴일 운행기간 문구를 각각 파싱한다', () => {
    const weekday = load('2026-2학기-asan-ktx-평일.html');
    const saturday = load('2026-2학기-asan-ktx-토요일.html');

    expect(weekday.period).toMatchObject({
      kind: 'semester',
      label: '2026-2학기',
      startsOn: '2026-09-01',
      endsOn: '2026-12-14',
    });
    expect(saturday.period).toMatchObject({
      kind: 'holiday',
      label: '2026-2학기',
      startsOn: '2026-09-05',
      endsOn: '2026-12-13',
    });
  });

  it('운행 노선 경로 원문을 보존한다', () => {
    expect(load('2026-2학기-asan-ktx-평일.html').path).toBe(
      '아산캠퍼스 > "탕정역" > 시티프라디움 > 천안아산역 > 아산캠퍼스',
    );
    expect(load('2026-2학기-onyang-평일.html').path).toBe(
      '아산캠퍼스 > 주은아파트 버스정류장 > 온양온천역 > 아산터미널 > 권곡초 버스정류장 > 아산캠퍼스',
    );
  });

  it('안내문(휴일 운행 없음·대체 시간표)을 날짜와 함께 파싱한다', () => {
    const snapshot = load('2026-2학기-asan-ktx-평일.html');
    const dated = snapshot.notices.filter((n) => n.date !== undefined);
    expect(dated).toEqual([
      { kind: 'no-service', text: '추석연휴: 셔틀버스 운행 없음', raw: '*추석연휴[9.24(목)~9.26(토)]: 셔틀버스 운행 없음', date: '2026-09-24', endDate: '2026-09-26' },
      { kind: 'no-service', text: '개천절연휴: 셔틀버스 운행 없음', raw: '*개천절연휴[10.3.(토)~10.4(일)]: 셔틀버스 운행 없음', date: '2026-10-03', endDate: '2026-10-04' },
      { kind: 'alternate-schedule', text: '개천절대체휴일: 일요일 시간표로 운행', raw: '*개천절대체휴일[10. 5.(월)]: 일요일 시간표로 운행', date: '2026-10-05' },
      { kind: 'no-service', text: '한글날: 셔틀버스 운행 없음', raw: '*한글날[10. 9.(금)]: 셔틀버스 운행 없음', date: '2026-10-09' },
      { kind: 'no-service', text: '개교기념일: 셔틀버스 운행 없음', raw: '*개교기념일[10. 28.(수)]: 셔틀버스 운행 없음', date: '2026-10-28' },
    ]);
    // 일반 안내(요금·승차 안내)도 보존
    expect(snapshot.notices.map((n) => n.text)).toContain(
      '요금 결제: 모든 선,후불 교통카드(수협, 시티 제외) 가능',
    );
    expect(snapshot.notices.map((n) => n.text)).toContain(
      '학생회관 승차 가능 시간, 이외 시간은 공대 승강장에서만 승차가능합니다.',
    );
  });

  it('시내버스 참고(노선·승강장)와 문의처를 파싱한다', () => {
    const snapshot = load('2026-2학기-asan-ktx-평일.html');
    expect(snapshot.contacts).toEqual({ team: '학생지원팀', tel: '041-530-2152' });
    expect(snapshot.busRefs).toHaveLength(15);
    expect(snapshot.busRefs.slice(0, 3)).toEqual([
      { line: '970', stop: '선문대 서문 승강장', to: '천안터미널' },
      { line: '971', stop: '선문대 서문 승강장', to: '천안터미널' },
      { line: '970', stop: '선문대 서문 승강장', to: '온양온천역/아산터미널' },
    ]);
    expect(snapshot.busRefs).toContainEqual({
      line: '순환5',
      stop: '선문대 공대 셔틀장 도로, 학생회관, 선문대 동문',
      to: '배방환승센터',
    });
  });

  it('운행 중단 노선(천안캠퍼스)은 표 0개·원본 문구를 그대로 담는다', () => {
    const snapshot = load('2026-2학기-cheonan-campus-평일.html');
    expect(snapshot.status).toBe('suspended');
    expect(snapshot.trips).toHaveLength(0);
    expect(snapshot.suspendedReason).toBe('2024-2학기 부터 천안캠퍼스 노선은 운행하지 않습니다.');
    expect(snapshot.notices.map((n) => n.text)).toContain(
      '셔틀버스 시간표/분실물/운행관련 문의: (주)모모관광 041-544-8710',
    );
  });
});
