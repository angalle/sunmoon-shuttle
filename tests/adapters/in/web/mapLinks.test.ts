/**
 * 네이버 지도 길찾기 링크(2026-11-18) — "지금 방향에서 버스 타는 곳"과 링크 형식을 고정한다.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CAMPUS_PLACE,
  NAVER_APP_NAME,
  STATION_PLACES,
  boardingPlace,
  naverRouteLinks,
} from '../../../../src/adapters/in/web/features/schedule/data/mapLinks';
import { mapOpenMode } from '../../../../src/adapters/in/web/features/schedule/api/naverMap';

const timetable = JSON.parse(readFileSync('data/timetable.json', 'utf8')) as {
  routes: { id: string; status: string }[];
};

describe('boardingPlace — 지금 방향에서 버스 타는 곳', () => {
  it('역 → 학교(in)는 역·터미널, 학교 → 역(out)은 캠퍼스', () => {
    expect(boardingPlace('asan-ktx', 'in')?.name).toBe('천안아산역');
    expect(boardingPlace('asan-ktx', 'out')).toBe(CAMPUS_PLACE);
    expect(boardingPlace('cheonan-terminal', 'in')?.name).toBe('천안종합버스터미널');
  });

  it('정류장 미선택·좌표 없는 노선은 null(버튼 숨김)', () => {
    expect(boardingPlace(null, 'in')).toBeNull();
    expect(boardingPlace('cheonan-campus', 'out')).toBeNull();
  });

  it('운행 중인 노선은 모두 좌표가 있다(데이터에 노선이 늘면 여기서 알려 준다)', () => {
    const active = timetable.routes.filter((route) => route.status === 'active').map((route) => route.id);
    expect(active.filter((id) => STATION_PLACES[id] === undefined)).toEqual([]);
  });

  it('좌표는 아산·천안 일대(위도 36.7~36.9 · 경도 126.9~127.2)', () => {
    for (const place of [CAMPUS_PLACE, ...Object.values(STATION_PLACES)]) {
      expect(place.lat).toBeGreaterThan(36.7);
      expect(place.lat).toBeLessThan(36.9);
      expect(place.lng).toBeGreaterThan(126.9);
      expect(place.lng).toBeLessThan(127.2);
    }
  });
});

describe('naverRouteLinks — 현재 위치 출발 대중교통 길찾기', () => {
  const links = naverRouteLinks({ name: '천안아산역', lat: 36.79438, lng: 127.1045 });

  it('앱: nmap://route/public · 출발지 없음(현재 위치) · 목적지 좌표·이름 · appname', () => {
    const url = new URL(links.app);
    expect(url.protocol).toBe('nmap:');
    expect(links.app.startsWith('nmap://route/public?')).toBe(true);
    expect(url.searchParams.get('dlat')).toBe('36.79438');
    expect(url.searchParams.get('dlng')).toBe('127.1045');
    expect(url.searchParams.get('dname')).toBe('천안아산역');
    expect(url.searchParams.get('appname')).toBe(NAVER_APP_NAME);
    expect(url.searchParams.has('slat')).toBe(false);
  });

  it('웹: m.map.naver.com 길찾기 · 경도=ex · 위도=ey · 대중교통', () => {
    const url = new URL(links.web);
    expect(url.origin).toBe('https://m.map.naver.com');
    expect(url.searchParams.get('ex')).toBe('127.1045');
    expect(url.searchParams.get('ey')).toBe('36.79438');
    expect(url.searchParams.get('ename')).toBe('천안아산역');
    expect(url.searchParams.get('pathType')).toBe('1');
  });
});

describe('Android Chrome intent 링크', () => {
  const links = naverRouteLinks({ name: '천안역', lat: 36.81, lng: 127.14 });
  it('네이버 지도 패키지 · nmap scheme · 앱 없으면 웹 길찾기로(browser_fallback_url)', () => {
    expect(links.intent.startsWith('intent://route/public?')).toBe(true);
    expect(links.intent).toContain('scheme=nmap;');
    expect(links.intent).toContain('package=com.nhn.android.nmap;');
    expect(links.intent).toContain(`S.browser_fallback_url=${encodeURIComponent(links.web)};end`);
  });
});

describe('mapOpenMode — 실행 환경별 여는 방식', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36';
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Safari/605.1.15';
  it('Android 앱 → nmap 직접 · Android 브라우저 → intent', () => {
    expect(mapOpenMode({ native: true, userAgent: ANDROID, maxTouchPoints: 5 })).toBe('native-app');
    expect(mapOpenMode({ native: false, userAgent: ANDROID, maxTouchPoints: 5 })).toBe('android-web');
  });
  it('iPhone·iPad(데스크톱 모드 포함) → 웹 길찾기(Safari 의 잘못된 주소 경고를 피한다)', () => {
    expect(mapOpenMode({ native: false, userAgent: IPHONE, maxTouchPoints: 5 })).toBe('web-same-tab');
    expect(mapOpenMode({ native: false, userAgent: MAC, maxTouchPoints: 5 })).toBe('web-same-tab');
  });
  it('데스크톱 → 새 탭', () => {
    expect(mapOpenMode({ native: false, userAgent: MAC, maxTouchPoints: 0 })).toBe('web-new-tab');
  });
});
