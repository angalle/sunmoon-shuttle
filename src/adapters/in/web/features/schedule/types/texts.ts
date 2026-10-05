/**
 * UI 문구 상수 (features/schedule/types) — 화면에 나가는 한국어 문구는 전부 여기서 온다
 * (스킬 §4: 하드코딩 문구는 feature 의 types/constants 에 모은다).
 *
 * ⚠️ 판정 문구 금지: 안내문·사유는 **원본 문구 그대로**(도메인이 돌려준 `reason` 등) 표시하고,
 *    여기에는 우리가 붙이는 **틀 문구**만 둔다.
 */

export const UI_TEXT = {
  appTitle: '선문대 셔틀버스 시간표',
  appSubtitle: '비공식 앱 — 아래 원본 시간표를 그대로 보여줍니다',
  skipToContent: '본문으로 건너뛰기',
  loading: '시간표를 불러오는 중…',

  dayTabLegend: '요일 선택',
  routeLegend: '노선 선택',
  routeStatusSuspended: '운행 중단',
  routeOffDay: '이 요일 운행 없음',
  routeNoTable: '이 요일 표 없음',

  tableEmptyCell: '—',
  tableEmptyCellSr: '미운행(원본 Χ)',
  tableCaptionPrefix: '원본 시간표',
  tableCaptionNote: '원본 열 구성을 그대로 표시합니다. “—” 는 미운행(원본 Χ), 빈 칸은 원본이 비어 있는 칸입니다.',

  nextBusTitle: '다음 버스',
  nextBusListTitle: '이어서 오는 버스',
  nextBusSuspendedTitle: '운행 중단 노선입니다',
  nextBusSuspendedDetail: '원본 안내 문구를 그대로 표시합니다. 운행 재개 여부는 아래 문의처로 확인해 주세요.',
  nextBusNoServiceTitle: '오늘은 셔틀버스 운행이 없습니다',
  nextBusNoServiceNextPrefix: '다음 운행',
  nextBusNoServiceNone: '앞으로 찾아본 기간 안에 다음 운행 회차가 없습니다.',
  nextBusEmptyTitle: '이 요일 시간표에 안내할 회차가 없습니다',
  nextBusEmptyDetail: '원본 표를 확인하거나 다른 노선·요일을 선택해 주세요.',
  nextBusUnknownRouteTitle: '노선 정보를 찾을 수 없습니다',
  nextBusUnknownRouteDetail: '등록된 노선에서 선택해 주세요.',
  nextBusWarningsTitle: '원본 표기 중 해석하지 못한 항목이 있습니다',
  nextBusWarningsDetail: '표시한 회차는 원본 표 기준이며, 아래 항목은 사람이 확인해야 합니다.',

  freshnessTitle: '데이터 신선도',
  freshnessSourceUpdatedLabel: '원본 페이지 최근 업데이트',
  freshnessFetchedLabel: '우리 반영 시각',
  freshnessStaleWarn: '48시간이 지났습니다 — 최신 시간표인지 확인이 필요합니다.',
  freshnessPageDetail: '페이지별 원본 최근 업데이트',

  suspectTitle: '운행 안내(원본)',
  noticeTitle: '이용 안내(원본)',
  busRefTitle: '시내버스 참고(원본)',
  busRefColumns: { line: '노선', stop: '승강장', to: '방면' },
  noNotices: '원본에서 추출된 안내문이 없습니다.',

  sourceTitle: '출처·고지',
  unofficialNotice: '이 앱은 학교 공식 앱이 아닙니다(비공식). 시간표 저작권은 학교에 있으며, 아래 원본 페이지를 출처로 표시합니다.',
  sourceLinkLabel: '원본 페이지 열기',
  sourcePagesLabel: '노선·요일별 원본 페이지',
  contactsLabel: '문의처',
  contactsMissing: '원본에서 문의처를 찾지 못했습니다.',
  dataErrorTitle: '데이터를 불러오지 못했습니다',
  dataErrorRetry: '다시 시도',
  dataErrorDetailPrefix: '원인',
} as const;

/**
 * 데이터를 못 읽었을 때 안내할 원본 링크(폴백).
 * 평소에는 JSON 의 `source.url` 을 쓰고, **데이터 자체를 못 읽은 경우에만** 이 값을 쓴다
 * (T1 실측: 셔틀버스 안내 최상위 페이지 — docs/01 §8 부록).
 */
export const FALLBACK_SOURCE_URL = 'https://lily.sunmoon.ac.kr/Page2/About/About08_04_01.aspx';

/** 요일 라벨(화면 문구) — 도메인 라벨과 별개로 탭에 쓸 짧은 표기. */
export const DAY_TAB_LABEL: Readonly<Record<'weekday' | 'saturday' | 'sunday', string>> = {
  weekday: '평일',
  saturday: '토요일',
  sunday: '일요일',
};
