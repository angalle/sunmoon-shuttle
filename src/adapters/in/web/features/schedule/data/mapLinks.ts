/**
 * 네이버 지도 길찾기 링크 (features/schedule/data) — 순수 함수(DOM 없음).
 *
 * "지금 고른 시간표에서 **버스를 타는 곳**까지" 길찾기를 연다.
 *  - 방향 `in`(역 → 학교)  → 그 노선의 역·터미널 탑승 지점
 *  - 방향 `out`(학교 → 역) → 아산캠퍼스
 * 출발지는 비워 둔다 → 네이버 지도가 **현재 위치**를 출발지로 쓴다. 그래서 이 앱은 위치 권한이 필요 없다.
 * 거리·걸리는 시간은 네이버 지도가 보여준다(이 앱은 계산하지 않는다).
 *
 * 링크 두 가지(인증·API 키 불필요):
 *  - app : `nmap://route/public?...` — 네이버 지도 앱 URL Scheme(공식). `appname` 은 호출한 앱 식별자일 뿐 키가 아니다.
 *  - web : `https://m.map.naver.com/route.nhn?...` — 앱이 없을 때. 네이버 검색 "빠른길찾기"(대중교통)로 이어진다(2026-11-18 실측: 302 → 목적지 좌표 유지).
 *  - intent : Android Chrome 용 `intent://...#Intent;...;S.browser_fallback_url=<web>;end` — 앱이 없으면 Chrome 이 web 으로 넘긴다.
 *
 * 좌표는 WGS84(위도·경도). 출처: OpenStreetMap(2026-11-18 조회) — 역·터미널 **대표 지점**이다.
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

/** 지금 방향에서 버스를 타는 곳. 노선이 표에 없거나 정류장을 아직 안 골랐으면 null. */
export function boardingPlace(routeId: string | null, direction: 'in' | 'out'): MapPlace | null {
  if (routeId === null) return null;
  const station = STATION_PLACES[routeId];
  if (station === undefined) return null;
  return direction === 'in' ? station : CAMPUS_PLACE;
}

export interface NaverRouteLinks {
  readonly app: string;
  readonly web: string;
  readonly intent: string;
}

/** 네이버 지도 Android 패키지 */
const NAVER_MAP_PACKAGE = 'com.nhn.android.nmap';

/** 현재 위치 → `place` 대중교통 길찾기 링크(앱·웹). */
export function naverRouteLinks(place: MapPlace, appName: string = NAVER_APP_NAME): NaverRouteLinks {
  const app = new URLSearchParams({
    dlat: String(place.lat),
    dlng: String(place.lng),
    dname: place.name,
    appname: appName,
  });
  const web = new URLSearchParams({
    menu: 'route',
    ename: place.name,
    ex: String(place.lng),
    ey: String(place.lat),
    pathType: '1',
    showMap: 'true',
  });
  const webUrl = `https://m.map.naver.com/route.nhn?${web.toString()}`;
  return {
    app: `nmap://route/public?${app.toString()}`,
    web: webUrl,
    intent:
      `intent://route/public?${app.toString()}#Intent;scheme=nmap;action=android.intent.action.VIEW;` +
      `category=android.intent.category.BROWSABLE;package=${NAVER_MAP_PACKAGE};` +
      `S.browser_fallback_url=${encodeURIComponent(webUrl)};end`,
  };
}
