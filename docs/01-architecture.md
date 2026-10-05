# 01 — 아키텍처 설계 (선문대 셔틀버스 시간표 앱)

작성: ProjectCreator(총괄) · 2026-10-05

## 1. 구성도
```
[원본] lily.sunmoon.ac.kr/Page2/About/About08_04_02_01_0*.aspx
   │  (하루 2회, ETag/If-Modified-Since, UA 명시, 요청간 ≥1s)
   ▼
[수집] GitHub Actions (cron)                    ← 무료(공개 저장소) · 서버 0
   │  tools/scraper: 파서 실행 → 정규화
   ├─▶ data/raw/<날짜>-<요일>.html   (원본 스냅샷 = 골든 픽스처·증거)
   └─▶ data/timetable.json           (앱이 읽는 계약 데이터)
   │  변경 감지: 내용 해시 비교 → **변경 시에만 커밋**(무변경이면 커밋 0)
   ▼
[배포] GitHub Pages (정적)                      ← 무료 · CORS 허용
   ├─ 앱 번들 (index.html + js/css + manifest + SW)
   └─ data/timetable.json · data/raw/*.html
   ▼
[앱] Vite + TS (헥사고날) · PWA(Capacitor로 Android 패키징)
   ├─ Service Worker: 앱 셸 + data/timetable.json 캐시(오프라인)
   ├─ IndexedDB: 정규화 스케줄 + 즐겨찾기 + 마지막 수집 시각
   └─ 화면: 요일 탭 · 노선 표 · **다음 버스 카운트다운** · 신선도 · 안내문
```

## 2. 기술 선택과 근거
| 결정 | 선택 | 근거 | 대안(왜 안 골랐나) |
|---|---|---|---|
| 언어/빌드 | **TypeScript + Vite** | 파서·도메인·UI를 **한 언어**로 → 골든 픽스처 테스트를 Actions와 앱이 **공유** | 별도 백엔드 언어 = 중복 구현·불일치 |
| 수집/스케줄 | **GitHub Actions + Pages** | 공개 저장소 Actions **무료**, 서버·DB 불필요, Pages는 무료·HTTPS·CORS | Cloudflare Workers(무료지만 계정·배포 추가), VPS(월 과금), Firebase Functions(과금 위험) |
| 캐시 | **Service Worker + IndexedDB** | 오프라인 MUST 충족, 서버 왕복 0 → 비용·지연 최소 | localStorage(용량·동기 API 한계) |
| 크로스플랫폼 | **PWA + Capacitor** | 웹 자산 그대로 iOS/Android. **iOS는 PWA로 무료 즉시**, Android는 기존 툴체인 재사용 | React Native/Expo(새 툴체인·iOS는 EAS 유료 경로), Flutter(Dart 신규·바이너리 큼) |
| iOS 경로 | **PWA 우선** → (선택) Xcode 설치로 Capacitor iOS 로컬 빌드 | App Store는 $99/년(비용), PWA는 무료·즉시 | 지금 App Store 등록(비용 발생) |
| 파서 위치 | **`tools/scraper` (TS) — 앱과 같은 파서 모듈 import** | 파싱 규칙 단일출처. Actions는 `tsx`로 실행 | Actions 전용 파이썬 파서(중복·불일치 위험) |

## 3. 헥사고날 구조 (총괄 표준)
```
src/
  domain/                # 순수 — 브라우저·네트워크 모름
    entities/{Route,Trip,DayType,Notice,Schedule}.ts
    rules/{nextDeparture.ts, dayType.ts, serviceDay.ts}   # 다음 버스·요일·공휴일 규칙
  application/
    {getSchedule.ts, nextDepartures.ts, refreshIfStale.ts, favorites.ts}
  ports/
    {schedule_repository.ts, clock.ts, notifier.ts}
  adapters/
    in/web/             # 화면(요일 탭·표·카운트다운·신선도)
    in/static_json.ts   # Pages 의 data/timetable.json 읽기
    out/storage/indexeddb.ts
    out/net/fetch_etag.ts
    out/notify/local.ts
tools/
  scraper/{index.ts, parse.ts, http.ts}   # Actions 에서 실행 · parse.ts 는 앱 테스트와 공유
  fixtures/*.html                         # 원본 스냅샷(Actions 가 갱신)
data/
  timetable.json                          # 계약 데이터(앱 입력)
  raw/*.html                              # 원본 증거·골든
tests/
  domain/*  application/*  scraper/golden/*
.github/workflows/{scrape.yml, deploy.yml}
```
**규칙**: `domain/` 은 `fetch`·`document`·`indexedDB` 를 import 하지 않는다(경계 검사로 강제). 시간은 **포트(clock)** 로 주입해 테스트 가능·결정적으로 만든다.

## 4. 데이터 스키마 (`data/timetable.json`) — 앱-파서 계약
```jsonc
{
  "schemaVersion": 1,
  "source": {
    "url": "https://lily.sunmoon.ac.kr/Page2/About/About08_04_02_01_01_01.aspx",
    "sourceUpdatedAt": "2026-08-20",        // 원본 페이지의 "최근 업데이트"
    "fetchedAt": "2026-10-05T03:00:12+09:00",
    "contentHash": "sha256:…"               // 변경 감지·추적
  },
  "semester": { "label": "2026-2학기", "startsOn": "2026-09-01", "endsOn": "2026-12-14" },
  "dayTypes": ["weekday", "saturday", "sunday"],
  "routes": [
    {
      "id": "asan-ktx",
      "name": "아산(KTX)역",
      "path": "아산캠퍼스 > 탕정역 > 시티프라디움 > 천안아산역 > 아산캠퍼스",
      "status": "active",                       // active | suspended(=운행 중단: 천안캠퍼스)
      "columns": ["seq", "depCampus", "depStation", "arrCampus", "note"],
      // ⚠️ columns 는 **노선·요일별로 다르다**(T1 실측 2026-10-05):
      //   평일 아산KTX 5열 · 천안역 7열(데이터 33행 중 32행이 <td colspan="2"> 병합) ·
      //   천안터미널 8열(대부분 colspan="3" 병합) · 온양역/터미널 8열(**마지막 열 = 금요일 운행여부**, 값 `경유` 사용) ·
      //   토요일 아산KTX **4열(운행 특이사항 열이 없다)** · 천안캠퍼스 **표 0개(운행 중단)**
      //   → 요일별 열 구성은 `byDay[day].columns` 로 표현하고, **병합 셀(colspan)은 하나의 텍스트 값**으로 파싱한다(셀 수 강제 금지).
      "trips": [
        { "seq": 1, "depCampus": "08:05", "depStation": "08:25", "arrCampus": "08:40", "note": "0:15" },
        { "seq": 2, "depCampus": null,    "depStation": "08:35", "arrCampus": "08:50", "note": "금(X)" }
      ],
      "byDay": { "weekday": [ /* trips */ ], "saturday": [ /* … */ ], "sunday": [ /* … */ ] }
    }
  ],
  "notices": [ { "kind": "no-service", "date": "2026-10-09", "text": "한글날: 셔틀버스 운행 없음" } ],
  "busRefs": [ { "line": "970", "stop": "선문대 서문", "to": "천안터미널" } ],
  "contacts": { "team": "학생지원팀", "tel": "041-530-2152" }
}
```
- **`null` = 원본의 `Χ`(운행 없음)** — 빈 문자열과 구분(파서 규칙 고정).
- 스키마 변경은 **`schemaVersion` 증가 + 마이그레이션 함수** 필수(앱·파서 동시 배포).

## 5. 캐싱 전략 (비용 0의 핵심)
| 계층 | 방법 | 근거 |
|---|---|---|
| 앱 셸 | Service Worker **stale-while-revalidate** | 즉시 표시 + 백그라운드 갱신 |
| 데이터 | `data/timetable.json` — **캐시 우선 + `contentHash`/`fetchedAt` 비교** | 오프라인 우선, 변경 시에만 갱신 |
| 요청 절약 | 서버가 `ETag`/`Last-Modified` 주면 **304** 로 본문 생략 | 대역·시간 절약 |
| 만료 정책 | 캐시 나이 > 24h → 백그라운드 재검증, **실패해도 캐시 유지** | F8(폴백) |
| 배포 자산 | GitHub Pages 기본 CDN 캐시(자산 최대 10분) | 배포 직후 잠깐 이전 버전이 보일 수 있음 → `sw.js` 버전으로 무효화(T6) |
| 원본 서버 | **자동 요청 없음** — 사람이 저장한 스냅샷만 반입(`scrape.yml` workflow_dispatch) | robots.txt 가 `/Page`(= `/Page2/…`) 차단(§8) · 이용 예의 |

## 6. 배포/실행
| 대상 | 방법 | 비용 |
|---|---|---|
| 웹/PWA | **GitHub Pages** — `main` push → `.github/workflows/deploy.yml`(공식 Pages Actions: `configure-pages` → `upload-pages-artifact` → `deploy-pages`) | 0원 |
| 배포 게이트 | `npm ci` → `npm run lint:boundary` → `npm run test` → `npm run build` — **하나라도 실패하면 배포 잡은 실행되지 않는다**(깨진 앱·데이터 배포 금지). 계약 JSON(`data/timetable.json`)은 배포 산출물 `dist/data/` 로 동봉 | 0원 |
| 데이터 | **수동 스냅샷 반입**(`.github/workflows/scrape.yml` = `workflow_dispatch` 전용) → 파싱·검증 → 변경 시 커밋 → 위 배포가 자동 실행 | 0원 |
| Android | `npx cap sync android` → `bundleRelease` (기존 JDK17·SDK36 툴체인) → Play 내부 테스트 | 0원(Play 계정 기존) |
| iOS | **PWA(홈 화면 추가)** 지금 / Xcode 설치 시 `npx cap sync ios` 로컬 빌드(무료, 기기 설치) | 0원 (App Store 배포는 $99/yr — 후순위) |

- **Pages URL**: https://angalle.github.io/sunmoon-shuttle/ (project site → 하위 경로. `vite.config.ts` 의 `base: './'` 로 자산 경로 안전)
- ⚠️ **`schedule:`(cron) 금지** — 원본 `robots.txt` 의 `Disallow: /Page` 가 `/Page2/…`(시간표 URL 전부)를 포함해 차단한다(§8 · 결정 D5/D7). 자동 크롤 대신 **수동 스냅샷 반입**이 정본이다.
- 배포 결과·모니터링 기준·복구 절차는 `docs/02-monitoring.md`(M8·M9, R3·R5·R6, §6 신선도 점검, §7 비용)에 있다.

## 7. 리스크와 대응
| 리스크 | 영향 | 대응 |
|---|---|---|
| 원본 페이지 개편(HTML 구조 변경) | 파서 실패 → 데이터 정지 | 골든 픽스처 실패 시 Actions 실패 → 알림(02 문서) · 실패 시 **마지막 정상 데이터 유지** |
| 사이트 봇 차단/차단 정책 | 수집 중단 | 저빈도(하루 2회)·UA 명시·`robots.txt` 준수 · 필요 시 수동 스냅샷 커밋 경로 |
| 학기 개편으로 노선/요일 변경 | 표 누락 | 스키마 검증(행 수·필수 열) + 골든 재생성 PR |
| 스토어 정책(비공식·저작권) | 반려 | 출처·비공식 고지, 원본 링크, 앱 이름에 학교 공식 표기 회피 |

## 8. 사이트맵 부록 (실측 2026-10-05 — T1 조사 결과 반영)
**시간표는 노선별로 페이지가 분리**돼 있다(서버 렌더 HTML, JS 불필요):
| 노선 | URL | 표 규모(실측) |
|---|---|---|
| **아산(KTX)역** | `/Page2/About/About08_04_02_01_01_01.aspx` | 표 3개(헤더 0 + **본표 43행** = 42회차 + 특이사항 표 1) |
| **천안역** | `/Page2/About/About08_04_02_01_01_02.aspx` | 본표 **34행** |
| **천안터미널** | `/Page2/About/About08_04_02_01_02.aspx` | (미실측 — T1에서 확정) |
| **온양역/터미널** | `/Page2/About/About08_04_02_01_03.aspx` | (미실측) |
| **천안캠퍼스** | `/Page2/About/About08_04_02_01_04.aspx` | (미실측) |
- 원본 페이지에 **"최근 업데이트: 2026-08-20"** 표기 → `sourceUpdatedAt` 으로 파싱(신선도 표시의 근거).
- 부가 정보: 노선별 시내버스 참고(970·971·700·777·1200·순환5 + 승강장), 안내문(연휴·개교기념일 운행 없음, 요금·승차 위치), 공지 링크(`/Page2/Story/Notice_view.aspx?no=50242`), 시내버스 노선 PDF 6건(`/Page/Board/BDownload.aspx?fno=…`).
- **요일(평일/토/일)은 별도 URL이 아니라 페이지 내 탭** → T1에서 탭 전환 방식(JS/AJAX 여부)을 확정해야 한다(서버 렌더가 아니면 요일별 HTML 스냅샷 방법을 정한다).

### ⚠️ 수집 제약(중대 — 실측)
`https://lily.sunmoon.ac.kr/robots.txt`:
```
User-agent: *
Disallow: /Lib
Disallow: /css*
Disallow: /img*
Disallow: /image*
Disallow: /js*
Disallow: /Page          ← 접두사 규칙
```
- robots 표준(경로 **접두사** 매칭)에 따르면 **`Disallow: /Page` 는 `/Page2/...` 도 차단**한다 → **우리 대상 시간표 URL 전부가 차단 범위**다.
- 따라서 **자동 크롤(Actions cron)을 기본 경로로 삼지 않는다.** 파이프라인을 다음으로 바꾼다:
  1. **수동 스냅샷 반입이 정본**: 사람이 브라우저로 페이지를 열어 HTML 저장(또는 인쇄 → PDF) → 저장소 `data/raw/` 에 커밋 → **파서가 자동 정규화 → JSON → 앱 반영**(학기 개편 시 1회면 충분 — 시간표는 학기당 1~2회 바뀐다)
  2. 자동화를 굳이 원하면 **학교(학생지원팀 041-530-2152)에 이용 허락을 문의**한 뒤 진행(정공법). 허락 전에는 자동 수집 금지.
  3. **사용자 브라우저에서 직접 fetch 하는 우회**(프록시/서버)도 하지 않는다 — 이용약관·CORS 문제를 만들 뿐 아니라 "수집 0 서버" 원칙을 깬다.
- 앱은 이 제약을 **사용자에게 정직하게 표시**한다: 데이터 출처·원본 업데이트 시각 + "원본 페이지 개편 시 수동 반영" 안내.
