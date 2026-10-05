/**
 * 노선 메타(계약 표) — **파일명에서 노선·요일을 읽고**, 원본 표의 열 구성을 대조한다.
 *
 * 근거: `docs/01 §4`(총괄 계약, 2026-10-05 정정) · `docs/recon/T1-사이트맵-실측.md §3`(열 헤더 원문)
 *  - 평일: 아산KTX 5열 · 천안역 7열 · 천안터미널 8열 · 온양역/터미널 8열(마지막 열 `금요일 운행여부`)
 *  - 토·일: 아산KTX·천안역 4열, 천안터미널 4열(`선문대 (출발)`/`터미널`/`선문대 (도착)`) — `운행 특이사항` 열 없음
 *  - 천안캠퍼스: 표 0개 = **운행 중단**(`status: 'suspended'`)
 *  - 토·일 페이지가 없는 노선: 온양역/터미널 · 천안캠퍼스(운행 중단)
 *
 * `label` 은 원본 헤더 원문(공백만 정규화)이다. 원본 개편으로 헤더가 바뀌면 파서가
 * **어느 열이 어떻게 달라졌는지** 명시해 실패한다(추측 금지).
 */

import { DAY_TYPES, ScrapeError } from './types.js';
import type { DayTableMeta, DayType, RouteMeta } from './types.js';

const ORIGIN = 'https://lily.sunmoon.ac.kr';

export const ROUTES: readonly RouteMeta[] = [
  {
    id: 'asan-ktx',
    name: '아산(KTX)역',
    status: 'active',
    url: `${ORIGIN}/Page2/About/About08_04_02_01_01_01.aspx`,
    days: [
      {
        dayType: 'weekday',
        url: `${ORIGIN}/Page2/About/About08_04_02_01_01_01.aspx`,
        columns: [
          { key: 'seq', label: '순', kind: 'seq' },
          { key: 'depCampus', label: '아산캠퍼스 출발', kind: 'time' },
          { key: 'depStation', label: '천안아산역 출발', kind: 'time' },
          { key: 'arrCampus', label: '아산캠퍼스 도착', kind: 'time' },
          { key: 'note', label: '운행 특이사항', kind: 'note' },
        ],
      },
      {
        dayType: 'saturday',
        url: `${ORIGIN}/Page2/About/About08_04_02_02_01.aspx`,
        columns: [
          { key: 'seq', label: '순', kind: 'seq' },
          { key: 'depCampus', label: '아산캠퍼스 (출발)', kind: 'time' },
          { key: 'depStation', label: '천안아산역', kind: 'time' },
          { key: 'arrCampus', label: '아산캠퍼스 (도착)', kind: 'time' },
        ],
      },
      {
        dayType: 'sunday',
        url: `${ORIGIN}/Page2/About/About08_04_02_03_01.aspx`,
        columns: [
          { key: 'seq', label: '순', kind: 'seq' },
          { key: 'depCampus', label: '아산캠퍼스 (출발)', kind: 'time' },
          { key: 'depStation', label: '천안아산역', kind: 'time' },
          { key: 'arrCampus', label: '아산캠퍼스 (도착)', kind: 'time' },
        ],
      },
    ],
  },
  {
    id: 'cheonan-station',
    name: '천안역',
    status: 'active',
    url: `${ORIGIN}/Page2/About/About08_04_02_01_01_02.aspx`,
    days: [
      {
        dayType: 'weekday',
        url: `${ORIGIN}/Page2/About/About08_04_02_01_01_02.aspx`,
        columns: [
          { key: 'seq', label: '순', kind: 'seq' },
          { key: 'depCampus', label: '아산캠퍼스 출발', kind: 'time' },
          { key: 'depStation', label: '천안역 출발', kind: 'time' },
          // 하이렉스파·용암마을은 시각이 아니라 **구간 소요시간**(병합 셀)이 들어 있다 → 시각으로 매핑 금지
          { key: 'viaHairexpa', label: '하이렉스파 건너편', kind: 'text' },
          { key: 'viaYongam', label: '용암마을', kind: 'text' },
          { key: 'arrCampus', label: '아산캠퍼스도착', kind: 'time' },
          { key: 'note', label: '운행 특이사항', kind: 'note' },
        ],
      },
      {
        dayType: 'saturday',
        url: `${ORIGIN}/Page2/About/About08_04_03_02_03.aspx`,
        columns: [
          { key: 'seq', label: '순', kind: 'seq' },
          { key: 'depCampus', label: '아산캠퍼스 (출발)', kind: 'time' },
          { key: 'depStation', label: '천안역', kind: 'time' },
          { key: 'arrCampus', label: '아산캠퍼스 (도착)', kind: 'time' },
        ],
      },
      {
        dayType: 'sunday',
        url: `${ORIGIN}/Page2/About/About08_04_03_03_03.aspx`,
        columns: [
          { key: 'seq', label: '순', kind: 'seq' },
          { key: 'depCampus', label: '아산캠퍼스 (출발)', kind: 'time' },
          { key: 'depStation', label: '천안역', kind: 'time' },
          { key: 'arrCampus', label: '아산캠퍼스 (도착)', kind: 'time' },
        ],
      },
    ],
  },
  {
    id: 'cheonan-terminal',
    name: '천안터미널',
    status: 'active',
    url: `${ORIGIN}/Page2/About/About08_04_02_01_02.aspx`,
    days: [
      {
        dayType: 'weekday',
        url: `${ORIGIN}/Page2/About/About08_04_02_01_02.aspx`,
        columns: [
          { key: 'seq', label: '순', kind: 'seq' },
          { key: 'depCampus', label: '아산캠퍼스 (출발)', kind: 'time' },
          { key: 'depTerminal', label: '터미널', kind: 'time' },
          { key: 'viaDujeong', label: '두정동 맥도날드', kind: 'text' },
          { key: 'viaHomeMart', label: '홈마트 에브리데이', kind: 'text' },
          { key: 'viaSeoulJeong', label: '서울대정병원', kind: 'text' },
          { key: 'arrCampus', label: '아산캠퍼스 (도착)', kind: 'time' },
          { key: 'note', label: '운행 특이사항', kind: 'note' },
        ],
      },
      // 주말 페이지의 출발/도착 열 이름은 `선문대 (출발)`/`선문대 (도착)` 다(원본 표기).
      // 의미상 같은 정차지(캠퍼스)라 키는 평일과 동일하게 depCampus/arrCampus 로 두고 **원문 라벨은 보존**한다.
      {
        dayType: 'saturday',
        url: `${ORIGIN}/Page2/About/About08_04_02_02_02.aspx`,
        columns: [
          { key: 'seq', label: '순', kind: 'seq' },
          { key: 'depCampus', label: '선문대 (출발)', kind: 'time' },
          { key: 'depTerminal', label: '터미널', kind: 'time' },
          { key: 'arrCampus', label: '선문대 (도착)', kind: 'time' },
        ],
      },
      {
        dayType: 'sunday',
        url: `${ORIGIN}/Page2/About/About08_04_02_03_02.aspx`,
        columns: [
          { key: 'seq', label: '순', kind: 'seq' },
          { key: 'depCampus', label: '선문대 (출발)', kind: 'time' },
          { key: 'depTerminal', label: '터미널', kind: 'time' },
          { key: 'arrCampus', label: '선문대 (도착)', kind: 'time' },
        ],
      },
    ],
  },
  {
    id: 'onyang',
    name: '온양역/터미널',
    status: 'active',
    url: `${ORIGIN}/Page2/About/About08_04_02_01_03.aspx`,
    days: [
      {
        dayType: 'weekday',
        url: `${ORIGIN}/Page2/About/About08_04_02_01_03.aspx`,
        columns: [
          { key: 'seq', label: '순', kind: 'seq' },
          { key: 'depCampus', label: '아산캠퍼스 (출발)', kind: 'time' },
          // 주은아파트·권곡초 열은 시각(`8:00`)과 `경유` 가 섞여 있다 → 자유 텍스트로 보존(해석은 도메인 몫)
          { key: 'viaJueun', label: '주은아파트 버스정류장', kind: 'text' },
          { key: 'viaOnyangStation', label: '온양온천역', kind: 'time' },
          { key: 'viaAsanTerminal', label: '아산터미널', kind: 'time' },
          { key: 'viaGweongok', label: '권곡초 버스정류장', kind: 'text' },
          { key: 'arrCampus', label: '아산캠퍼스 (도착)', kind: 'time' },
          // 원본 헤더가 `금요일 운행여부`(note 아님) — 값에 `경유` 등이 들어 있어도 **원문 보존**
          { key: 'note', label: '금요일 운행여부', kind: 'note' },
        ],
      },
      // 주말 페이지 없음(원본 요일 탭 노선 목록 실측) → byDay.saturday/sunday = 빈 표
    ],
  },
  {
    id: 'cheonan-campus',
    name: '천안캠퍼스',
    status: 'suspended',
    url: `${ORIGIN}/Page2/About/About08_04_02_01_04.aspx`,
    // 표 0개(운행 중단) — 원본 문구에서 사유를 파싱한다. `days` 가 비어 있는 것이 정상이다.
    days: [],
  },
];

/** 파일명에서 읽는 스냅샷 식별자 (`data/raw/<학기>-<노선>-<요일>.html`) */
export interface SnapshotRef {
  readonly fileName: string;
  readonly semesterLabel: string;
  readonly routeId: string;
  readonly dayType: DayType;
}

const DAY_TOKEN: Readonly<Record<string, DayType>> = {
  평일: 'weekday',
  토요일: 'saturday',
  일요일: 'sunday',
  weekday: 'weekday',
  saturday: 'saturday',
  sunday: 'sunday',
};

/** `<학기>-<노선>-<요일>.html` — 노선 slug 는 하이픈을 포함하므로 가운데 전체를 취한다. */
export function parseSnapshotFileName(path: string): SnapshotRef {
  const fileName = path.split('/').pop() ?? path;
  if (!fileName.endsWith('.html')) {
    throw new ScrapeError(`파일명 규칙 위반: .html 이 아닙니다 — ${fileName}`);
  }
  const parts = fileName.slice(0, -'.html'.length).split('-');
  if (parts.length < 4) {
    throw new ScrapeError(
      `파일명 규칙 위반: <학기>-<노선>-<요일>.html 형식이어야 합니다 — ${fileName} (토큰 ${parts.length}개)`,
    );
  }
  const first = parts[0];
  const second = parts[1];
  const dayToken = parts[parts.length - 1];
  if (first === undefined || second === undefined || dayToken === undefined) {
    throw new ScrapeError(`파일명 규칙 위반: 토큰이 비었습니다 — ${fileName}`);
  }
  const dayType = DAY_TOKEN[dayToken];
  if (dayType === undefined) {
    throw new ScrapeError(
      `파일명 규칙 위반: 요일 접미사는 평일|토요일|일요일 중 하나여야 합니다 — ${fileName} (읽은 값 "${dayToken}")`,
    );
  }
  const routeId = parts.slice(2, parts.length - 1).join('-');
  if (routeId === '') {
    throw new ScrapeError(`파일명 규칙 위반: 노선 slug 가 없습니다 — ${fileName}`);
  }
  return { fileName, semesterLabel: `${first}-${second}`, routeId, dayType };
}

export function findRoute(routeId: string): RouteMeta {
  const meta = ROUTES.find((r) => r.id === routeId);
  if (meta === undefined) {
    const known = ROUTES.map((r) => r.id).join(' · ');
    throw new ScrapeError(`알 수 없는 노선 id "${routeId}" — 계약(routeMeta)에 등록된 노선: ${known}`);
  }
  return meta;
}

export function findDay(meta: RouteMeta, dayType: DayType): DayTableMeta | null {
  return meta.days.find((d) => d.dayType === dayType) ?? null;
}

/** 원본 요일별 노선 목록에 이 노선의 페이지가 없는 요일 */
export function offDaysOf(meta: RouteMeta): DayType[] {
  return DAY_TYPES.filter((d) => findDay(meta, d) === null);
}
