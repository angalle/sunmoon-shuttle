/**
 * UI 문구 상수 (features/schedule/types) — 화면에 나가는 한국어 문구는 전부 여기서 온다
 * (스킬 §4: 하드코딩 문구는 feature 의 types/constants 에 모은다).
 *
 * ⚠️ 판정 문구 금지: 안내문·사유는 **학교 안내문 원문**(도메인이 돌려준 `reason` 등) 표시하고,
 *    여기에는 우리가 붙이는 **틀 문구**만 둔다.
 *
 * ⚠️ T14 — 앱 UI 에서 "읽어 온 출처"를 내세우지 않는다:
 *    이 앱은 **수집된 JSON 만** 읽어 보여준다(원본 사이트를 실시간으로 읽지 않는다).
 *    그래서 화면 문구에 `원본`(표·페이지·최근 업데이트) 표현을 쓰지 않는다 —
 *    출처 표시는 대표 페이지 1줄(`sourceLinePrefix` + 링크 1개)로만 한다.
 *    (내부 주석·로그에서 `원본` 은 계속 쓴다 — 코드 추적용.)
 */
import type { WeekdayCode } from '../../../../../../domain/entities/DayType';

export const UI_TEXT = {
  appTitle: '선문대 셔틀버스 시간표',
  /**
   * 앱바 제목(T24 · docs/07 §2) — 홈 화면 설치 앱처럼 보이도록 **짧은 이름**을 쓴다.
   * (문서 제목·매니페스트의 정식 이름은 `appTitle` 그대로다.)
   */
  appBarTitle: '선문대 셔틀',
  /** T14 — 앱이 하는 일을 그대로 말한다(옛 문구: `비공식 앱 — 아래 원본 시간표를 그대로 보여줍니다`). */
  appSubtitle: '지금 탈 수 있는 셔틀버스를 바로 보여줍니다',
  /** 한/영 병기(T7) — 영어 문장은 화면에서 `lang="en"` 으로 표시한다. */
  appSubtitleEn: 'Shows the shuttle you can take right now.',
  skipToContent: '본문으로 건너뛰기',
  loading: '시간표를 불러오는 중…',

  /* ── 앱 셸·스플래시·탭 (T24 · docs/07 §2~§3) ── */
  /** 스플래시 진행 문구 — 로고·앱 이름과 함께 `role="status"` 로 읽힌다 */
  splashMessage: '시간표 불러오는 중',
  /** 앱바 새로고침 버튼(수동 갱신) */
  refreshLabel: '새로고침',
  refreshBusyLabel: '시간표를 다시 불러오는 중',
  /** 하단 탭바(화면 분리: 지금 / 전체) */
  appTabLegend: '화면 선택',
  appTabNow: '지금',
  appTabAll: '전체',
  /** 바로가기 카드 — [지금] 화면에서 전체/안내로 이동한다(접힘 대신 별도 화면, docs/07 §4-1 ④) */
  shortcutTitle: '바로가기',
  shortcutAll: '전체 시간표 보기',
  shortcutGuide: '이용 안내',
  /** 이용 안내 시트(정차창·요금·지연 안내·방학 링크·비공식 고지) */
  guideTitle: '이용 안내',
  guideClose: '닫기',
  /** [전체] 화면의 전체 편 목록 제목 */
  fullListTitle: '전체 시간표',
  fullListEmpty: '이 시간표에 안내할 회차가 없습니다',
  fullListTotalPrefix: '총',
  fullListPastBadge: '지난 편',
  /** 스켈레톤(로딩 자리) — 화면 낭독기용 안내(빈 화면 금지) */
  skeletonLabel: '시간표를 불러오는 중…',

  /* 설치 안내(홈 화면 추가) — 카드 지시⑤: 과하지 않게 1회만 */
  installHintTitle: '홈 화면에 추가하면 앱처럼 전체화면으로 열립니다',
  installHintIos: 'Safari 하단의 공유 버튼 → “홈 화면에 추가”를 선택하세요.',
  installHintAndroid: 'Chrome 오른쪽 위 ⋮ 메뉴 → “홈 화면에 추가”(앱 설치)를 선택하세요.',
  installHintOther: '브라우저 메뉴에서 “홈 화면에 추가”(앱 설치)를 선택하세요.',
  installHintEn: 'Add to Home Screen to open it fullscreen like an app.',
  installHintNote: '이 안내는 한 번만 표시됩니다.',
  installHintDismiss: '닫기',

  /* ── T27 — 시간표 중심 단순화 (docs/07 §9) ──
   * 본문은 시간표 하나다: 잡텍스트(소개문구·히어로·변동·출처·요금 안내)는 정보 시트(ⓘ)로 옮긴다.
   * 행에 붙는 것은 **짧은 토큰 1개 이하**뿐이고(긴 사유 문구 금지), 강조는 좌측 라인 + 배경 톤만 쓴다.
   */
  /** 시간표 목록의 접근성 제목(화면에는 보이지 않는다 — `shuttle-sr-only`) */
  timetableTitle: '시간표',
  /** 강조 행(다음 출발)에 붙는 화면 낭독기용 표시 — 색·배경만으로 알리지 않는다 */
  srNextDeparture: '다음 출발',
  /** 지나간 행에 붙는 화면 낭독기용 표시 */
  srPastDeparture: '지난 편',
  /** 요일 조건 토큰 — `금` + `휴` = `금 휴` (그 요일은 이 편이 뜨지 않는다) */
  tokenHolidaySuffix: '휴',
  /** 대수 토큰 — `2` + `대` */
  tokenVehicleSuffix: '대',
  /** 상단 바 정보 시트(ⓘ) 버튼의 접근성 이름 */
  infoOpenLabel: '이용 안내 열기',
  /**
   * T28 §10-1 — 우하단 이동 버튼의 접근성 이름(화면에는 아이콘만 보인다).
   *  - `맨 위로`       : 목록 맨 위로 이동
   *  - `현재 시간으로` : 지금 시각 기준 다음 출발 행으로 이동(억제 상태여도 동작)
   */
  moveTopLabel: '맨 위로',
  moveNowLabel: '현재 시간으로',
  /** 시간표가 빈 경우(그 요일 표에 안내할 회차가 없음) */
  timetableEmptyDay: '이 시간표에 안내할 회차가 없습니다',

  dayTabLegend: '요일 선택',
  routeLegend: '노선 선택',
  routeStatusSuspended: '운행 중단',
  routeOffDay: '이 요일 운행 없음',
  routeNoTable: '이 요일 표 없음',

  /* 표 셀 문구 — 앱 UI 에서 표를 그리지 않게 됐지만(T14) 표 계약은 유지한다. */
  tableEmptyCell: '—',
  tableEmptyCellSr: '미운행',
  tableCaptionPrefix: '시간표',
  tableCaptionNote: '표의 열 구성을 그대로 표시합니다. “—” 는 미운행(Χ 표기), 빈 칸은 값이 비어 있는 칸입니다.',

  nextBusTitle: '다음 버스',
  nextBusListTitle: '이어서 오는 버스',
  nextBusSuspendedTitle: '운행 중단 노선입니다',
  nextBusSuspendedDetail: '안내 문구를 그대로 표시합니다. 운행 재개 여부는 아래 문의처로 확인해 주세요.',
  nextBusNoServiceTitle: '오늘은 셔틀버스 운행이 없습니다',
  nextBusNoServiceNextPrefix: '다음 운행',
  nextBusNoServiceNone: '앞으로 찾아본 기간 안에 다음 운행 회차가 없습니다.',
  nextBusEmptyTitle: '이 요일 시간표에 안내할 회차가 없습니다',
  nextBusEmptyDetail: '다른 노선·요일을 선택해 주세요.',
  nextBusUnknownRouteTitle: '노선 정보를 찾을 수 없습니다',
  nextBusUnknownRouteDetail: '등록된 노선에서 선택해 주세요.',
  nextBusWarningsTitle: '해석하지 못한 표기가 있습니다',
  nextBusWarningsDetail: '표시한 회차는 시간표 기준이며, 아래 항목은 사람이 확인해야 합니다.',

  /* 데이터 신선도(T14 간소화) — 앱 기준 한 줄(`데이터 갱신: …`). */
  freshnessTitle: '최신 데이터',
  freshnessFetchedLabel: '데이터 갱신',
  freshnessStaleWarn: '48시간이 지났습니다 — 최신 시간표인지 확인이 필요합니다.',

  suspectTitle: '운행 안내',
  noticeTitle: '이용 안내',
  noticeNoServiceTitle: '운행 없는 날 안내',
  noticeAlternateTitle: '대체 시간표 안내',
  busRefTitle: '시내버스 참고',
  busRefColumns: { line: '노선', stop: '승강장', to: '방면' },
  noNotices: '표시할 안내문이 없습니다.',

  sourceTitle: '출처·고지',
  unofficialNotice:
    '이 앱은 학교 공식 앱이 아닙니다(비공식). 시간표 저작권은 학교에 있으며, 학교 안내 페이지를 출처로 표시합니다.',
  /** 출처 1줄 — 대표 페이지만 링크한다(T14: 노선·요일별 링크 목록 금지). */
  sourceLinePrefix: '출처',
  sourceLineLabel: '선문대학교 셔틀버스 안내 페이지',
  sourceLinkLabel: '학교 안내 페이지 열기',
  /** 개인정보처리방침 정적 페이지(public/privacy.html) — 스토어 제출 요건(T11). */
  privacyLinkLabel: '개인정보처리방침',
  contactsLabel: '문의처',
  contactsMissing: '문의처를 찾지 못했습니다.',
  dataErrorTitle: '데이터를 불러오지 못했습니다',
  dataErrorRetry: '다시 시도',
  dataErrorDetailPrefix: '원인',

  // 오프라인/캐시 폴백 안내(T6 · AC-5·AC-6) — 캐시로 그린 화면임을 **문구로** 알린다(조용한 노후 금지).
  offlineNoticeTitle: '오프라인 — 마지막으로 받은 데이터를 표시합니다',
  offlineNoticeReasonPrefix: '최신 데이터를 받지 못했습니다',
  offlineNoticeAgePrefix: '마지막으로 받은 시각',
  offlineNoticeAgeUnknown: '알 수 없음',
  offlineNoticeStale: '이 캐시는 24시간이 지났습니다 — 최신 시간표인지 확인이 필요합니다.',

  /* ── 간편 UI(V1, T12) — 지금 중심 홈. 문구 틀만 여기 두고 값은 도메인 결과에서 온다. ── */
  /** 상태줄(오늘 날짜·현재 시각) — 값은 `formatKstClockLabel`(도메인 KST 규칙) */
  clockLabelPrefix: '오늘',
  /** 공지 배너 ① — 운행 없음. 사유는 `resolveDayService().reason`(안내문 원문) */
  serviceNoServiceTitle: '오늘 셔틀버스 운행이 없습니다',
  serviceReasonPrefix: '사유',
  /** 공지 배너 ② — 대체 시간표. `일요일 시간표로 운행합니다` 처럼 요일 라벨을 앞에 붙인다 */
  serviceAlternateSuffix: '시간표로 운행합니다',
  /** 다음 출발 카드 */
  boardNowTitle: '다음 출발',
  boardHeroLabel: '가장 가까운 출발',
  boardDepartureSuffix: '출발',
  boardArrivalSuffix: '도착',
  boardEmptyTitle: '지금은 안내할 출발이 없습니다',
  /** 오늘 남은 출발 목록 */
  boardListTitle: '오늘 남은 출발',
  boardListEmpty: '오늘 남은 출발이 없습니다',
  boardListTotalPrefix: '총',
  boardListRemainingPrefix: '남은',
  boardListCountSuffix: '편',
  boardListMorePrefix: '더 보기',
  boardTodayOverTitle: '오늘 운행이 끝났습니다',
  boardNextServicePrefix: '다음 운행',
  boardDirectionLegend: '방향 선택',
  boardDirectionAll: '전체',
  boardDirectionOut: '학교에서 출발',
  boardDirectionIn: '학교로 도착',
  boardNotesPrefix: '특이사항',
  /**
   * 운행 없는 날(T13 결함 A) — 목록 자리 문구. **"끝났습니다"를 쓰지 않는다**(배너와 정면 충돌).
   * 사유는 상단 배너가 이미 보여주므로 여기서 반복하지 않는다.
   */
  boardListNoService: '오늘은 운행이 없습니다',
  /**
   * 미해석 표기 안내(T14) — **사용자 판단에 영향을 줄 때만** 홈 1줄.
   * `TodayBoardView.warningsNotice` 는 "회차가 목록에서 빠질 수 있는" 경고만 골라 이 틀에 넣는다
   * (T14 지시: 소요시간 `0:15` 같은 주석성 표기는 노출하지 않는다 — 내부 로그·증거로만).
   */
  boardWarningsNoticePrefix: '시각을 해석하지 못한 회차 ',
  boardWarningsNoticeCountSuffix: '건은 목록에서 빠져 있을 수 있습니다',
  boardWarningsNoticeDetail: ' — 아래 출처의 학교 안내 페이지에서 확인해 주세요.',
  /** 다른 날 미리보기(요일 탭 · 보조) */
  boardOtherDaysTitle: '다른 날 미리보기',

  /* ── schema v2 표시(T17) — 값은 `data/timetable.json` 에서만 오고 여기엔 **틀 문구**만 둔다. ── */

  /** 홈 상단 — 다가오는 운행 변동(오늘 이후 14일 내 · 최대 2줄). 값·날짜는 dateRules[] 에서만. */
  upcomingChangeTitle: '다가오는 운행 변동',
  /** `dateRules[].kind = no-service` 의 상태 문구 */
  upcomingNoService: '운행 없음',
  /** `dateRules[].kind = alternate-schedule` — 앞에 요일 라벨(`effect.timetable`)을 붙인다 */
  upcomingAlternateSuffix: '시간표로 운행',
  /** `effect.timetable` 을 요일로 해석할 수 없을 때만 쓰는 대체 문구(추측 금지) */
  upcomingAlternateFallback: '대체 시간표로 운행',

  /** 홈 상단 — 오늘이 방학 기간(terms, 시작·끝이 모두 있는 항목)일 때만 */
  vacationTitle: '방학 기간입니다',
  vacationSourcePrefix: '방학 시간표',
  vacationSourceLinkLabel: '방학 시간표 안내 페이지',

  /** 접힘 1개(안내 패널)에 정리하는 정차 시간창(stopWindows) */
  stopWindowTitle: '정차 시간 안내',

  /** 다음 출발 카드·목록의 도착 예정 옆 보조 문구 — `약 15분 소요`(분 값은 tripNotes 에서) */
  durationNotePrefix: '약',
  durationNoteSuffix: '분 소요',

  /* ── T22 — 편별 요일 조건(v3 trip.service) 사유 배지 ──
   * 값(요일·대수·표기)은 데이터(`trip.service`)에서만 오고, 여기엔 **틀 문구**만 둔다.
   * 사유 코드(`tripStatus.reason`)는 `docs/06 §2` 의 확정 enum 이다 — 문구는 코드에서 조립한다.
   */
  /** `금` + `요일 운행 없음` → `금요일 운행 없음` (매주 그 요일은 이 편이 뜨지 않는다) */
  tripWeekdayExcludedSuffix: '요일 운행 없음',
  /** `월·화` + `만 운행` → `월·화만 운행` (그 요일 범위에서만 운행) */
  tripDayScopeSuffix: '만 운행',
  /** `2` + `대 운행` → `2대 운행` */
  tripVehicleCountSuffix: '대 운행',
} as const;

/** 요일 코드(JSON 표기) → 화면용 한 글자 — 사유 배지(`금요일 운행 없음`·`월·화만 운행`)를 만든다. */
export const WEEKDAY_CODE_LABEL: Readonly<Record<WeekdayCode, string>> = {
  sun: '일',
  mon: '월',
  tue: '화',
  wed: '수',
  thu: '목',
  fri: '금',
  sat: '토',
};

/**
 * 데이터를 못 읽었을 때 안내할 학교 안내 페이지(폴백).
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
