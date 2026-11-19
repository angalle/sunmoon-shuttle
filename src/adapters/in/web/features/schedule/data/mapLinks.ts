/**
 * 네이버 지도 길찾기 링크 (features/schedule/data) — 순수 함수(DOM 없음).
 *
 * "지금 고른 셔틀 노선"의 **출발지 → 도착지** 자동차 길찾기를 연다(셔틀이 다니는 길의 거리·시간).
 *  - 방향 `in`(역 → 학교)  : 그 노선의 역·터미널 → 아산캠퍼스
 *  - 방향 `out`(학교 → 역) : 아산캠퍼스 → 그 노선의 역·터미널
 * 출발지·도착지 모두 고정 지점이다 → 이 앱은 이용자의 위치를 묻지도 읽지도 않는다(2026-11-19 사용자 요청).
 * 거리·걸리는 시간은 네이버 지도가 보여준다(이 앱은 계산하지 않는다).
 *
 * 링크(인증·API 키 불필요):
 *  - app : `nmap://route/car?slat…&dlat…` — 네이버 지도 앱 URL Scheme(공식). `appname` 은 호출한 앱 식별자일 뿐 키가 아니다.
 *  - web : `https://m.map.naver.com/route.nhn?…&pathType=0` — 앱이 없을 때. 네이버 검색 "빠른길찾기"(자동차)로 이어진다
 *          (2026-11-19 실측: 302 → 출발지·도착지 좌표 유지 · pathType 0=자동차 1=대중교통 2=자전거).
 *  - intent : Android Chrome 용 `intent://...#Intent;...;S.browser_fallback_url=<web>;end` — 앱이 없으면 Chrome 이 web 으로 넘긴다.
 *
 * 좌표는 WGS84(위도·경도). 출처: OpenStreetMap(2026-11-18 조회) — 역·터미널·캠퍼스 **대표 지점**이다.
 * 셔틀이 서는 정확한 자리(출구·승강장)는 학교 공지 기준으로 다를 수 있다 → 바꿀 때는 이 표만 고친다.
 */

export interface MapPlace {
  /** 네이버 지도에 목적지 이름으로 보이는 문구 */
  readonly name: string;
  readonly lat: number;
  readonly lng: number;
}

/** 학교 쪽 탑승 지점(학교 → 역 방향의 출발지). */
export const CAMPUS_PLACE: MapPlace = { name: '선문대학교 아산캠퍼스', lat: 36.7982739, lng: 127.0745741 };

/** 노선 id(`routes[].id`) → 역·터미널 쪽 탑승 지점(역 → 학교 방향의 출발지). 없는 노선은 버튼을 숨긴다. */
export const STATION_PLACES: Readonly<Record<string, MapPlace>> = {
  'asan-ktx': { name: '천안아산역', lat: 36.7943803, lng: 127.1044991 },
  'cheonan-station': { name: '천안역', lat: 36.8102804, lng: 127.14684 },
  'cheonan-terminal': { name: '천안종합버스터미널', lat: 36.819492, lng: 127.1559849 },
  onyang: { name: '온양온천역', lat: 36.7815372, lng: 127.0027406 },
};

/** 네이버 지도에 넘기는 호출 앱 식별자(Android 패키지 이름). */
export const NAVER_APP_NAME = 'com.angalle.sunmoonshuttle';

/** 노선의 출발지 → 도착지. */
export interface RouteEnds {
  readonly from: MapPlace;
  readonly to: MapPlace;
}

/** 지금 방향의 셔틀 노선 양 끝. 노선이 표에 없거나 정류장을 아직 안 골랐으면 null(버튼 숨김). */
export function routeEnds(routeId: string | null, direction: 'in' | 'out'): RouteEnds | null {
  if (routeId === null) return null;
  const station = STATION_PLACES[routeId];
  if (station === undefined) return null;
  return direction === 'in' ? { from: station, to: CAMPUS_PLACE } : { from: CAMPUS_PLACE, to: station };
}

export interface NaverRouteLinks {
  readonly app: string;
  readonly web: string;
  readonly intent: string;
}

/** 네이버 지도 Android 패키지 */
const NAVER_MAP_PACKAGE = 'com.nhn.android.nmap';

/** `from` → `to` 자동차 길찾기 링크(앱·웹·Android intent). */
export function naverRouteLinks({ from, to }: RouteEnds, appName: string = NAVER_APP_NAME): NaverRouteLinks {
  const app = new URLSearchParams({
    slat: String(from.lat),
    slng: String(from.lng),
    sname: from.name,
    dlat: String(to.lat),
    dlng: String(to.lng),
    dname: to.name,
    appname: appName,
  });
  const web = new URLSearchParams({
    menu: 'route',
    sname: from.name,
    sx: String(from.lng),
    sy: String(from.lat),
    ename: to.name,
    ex: String(to.lng),
    ey: String(to.lat),
    pathType: '0',
    showMap: 'true',
  });
  const webUrl = `https://m.map.naver.com/route.nhn?${web.toString()}`;
  return {
    app: `nmap://route/car?${app.toString()}`,
    web: webUrl,
    intent:
      `intent://route/car?${app.toString()}#Intent;scheme=nmap;action=android.intent.action.VIEW;` +
      `category=android.intent.category.BROWSABLE;package=${NAVER_MAP_PACKAGE};` +
      `S.browser_fallback_url=${encodeURIComponent(webUrl)};end`,
  };
}
