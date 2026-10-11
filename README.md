# sunmoon-shuttle — 선문대 셔틀버스 시간표 앱 (재작성 계획)

**목표 한 문장**: 선문대학교 셔틀버스 시간표를 **오프라인에서도 즉시** 확인하는 **iOS·Android·웹 공용** 앱을 만들고, 원본 페이지 수집·캐싱을 **운영비 0원**으로 자동화한다.

## 범위
- **포함**: 셔틀버스 노선×요일(평일/토/일) 시간표 수집·정규화·캐시 · 다음 버스 카운트다운 · 오프라인 전면 동작 · 설치형 웹앱(PWA) · Android 앱(Capacitor) · iOS(PWA 우선, Xcode 설치 시 네이티브 빌드 가능)
- **제외(명시)**: 실시간 버스 위치(GPS), 푸시 서버 운영, 예약·결제, 학교 공식 제휴·공식 앱 대체 주장

## 대체 대상 (기존 프로젝트)
- 저장소: `angalle/SM.Univ-Bus-Schedule` — **Java 네이티브 Android**, 마지막 푸시 **2017-03-18**(9년 전), `master`
- 실측 문제: ① Android 전용(iOS 불가) ② 옛 **GCM 푸시 + 서버 의존**(`connect/GCMConnection.java`) → 서버 사망 시 동작 불가 ③ `app/app-release.apk` 커밋 ④ **`app/google-services.json` 공개 커밋**(키 노출 — 폐기 권장) ⑤ 시간표가 앱에 하드코딩(학기마다 앱 업데이트 필요)

## 가정 (뒤집히면 문서를 먼저 고친다)
| # | 가정 | 근거 | 뒤집는 조건 |
|---|---|---|---|
| A1 | 스택 = **Vite + TypeScript + PWA + Capacitor** | 이미 보유한 툴체인(Node 26·JDK17·Android SDK) 재사용, 웹 데이터 뷰어에 최적, **iOS는 PWA로 무료 즉시** | 사용자가 React Native/Flutter 선호 시 |
| A2 | 수집·캐싱 = **GitHub Actions cron + GitHub Pages** | 공개 저장소 Actions 무료, 서버 불필요, 정적 호스팅 무료·CORS 허용 | 사이트가 봇 차단 → 다른 경로 필요 |
| A3 | 요일 3종(평일/토/일) × 노선 전부 수집 | 원본 페이지 구조(탭 3개, 노선별 표) | 노선이 별도 페이지로 분리돼 있으면 매핑 단계에서 확정 |
| A4 | iOS 배포 = **PWA 먼저**(App Store $99/yr 는 비용 발생 → 후순위) | 사용자 "비용 최소" 요구 | 사용자가 App Store 등록 승인 시 |
| A5 | 앱은 **비공식**이며 원본 출처·업데이트 시각을 표시 | 저작권·신뢰 | 학교 공식 요청 시 |

## 현재 상태 (2026-10-05)
- **P3 게이트 판정 완료 (T10)** — AC-1~AC-6·AC-8 **통과**, AC-7 **조건부**(Android 에뮬레이터 실측 완료 / iOS 실기기 = 사람 게이트). 근거·원출력: `docs/03-verification.md §7`
- **수용 기준 실측 요약**: 파서 골든 15 pass(스냅샷 11종 행수·시각 셀 100% 대조) · 결정성 5 pass(2회 해시 동일) · 다음 버스 경계 18케이스 pass · 자동 반영 무변경 0건(실 Actions 2회)/변경 1건(로컬 재현) · 수집 실패 폴백·오프라인 27항목 PASS(콘솔 오류 0) · iOS 정적 44/스모크 32/자체검증 13 pass · 네트워크 요청 8건 전부 동일출처(추적 0) · `npm run test` **171 passed**
- **아직 배포되지 않았다** — 배포본은 T5 시점 빌드(오프라인·PWA 없음). `main` 이 origin 보다 **12커밋 앞**이며 push(=Pages 배포)는 사용자 승인 사안
- **미비 1건 보완 중** — 개인정보처리방침·스토어 문구(T11)
- 병행 프로젝트: `meteor-dodge`(출시 단계) 진행 중 — 워커 자원을 나눠 쓴다

## 실행 3단계 (계획 확정 후)
```bash
# 1) 골격
npm create vite@latest . -- --template vanilla-ts && npm i
# 2) 데이터 파이프라인 (Actions cron → data/timetable.json)
npm run scrape        # 로컬에서 파서 실행(원본 HTML → JSON)
# 3) 앱 실행
npm run dev           # 로컬 개발 · npm run build → GitHub Pages
```

## 개발 (로컬) — 설치 · 실행 · 테스트
```bash
npm ci                 # 1) 설치 (package-lock.json 기준 · Node ≥ 26)
npm run dev            # 2) 실행 (Vite 개발 서버 · http://localhost:5173/)
npm run test           # 3) 테스트 (vitest · tests/**)
```
그 밖의 스크립트(이름 고정 — 다른 문서·워크플로가 이 이름을 쓴다):
`npm run build`(`tsc --noEmit` + `vite build` → `dist/`) · `npm run preview`(빌드 결과 미리보기) ·
`npm run test:watch`(감시 모드) · `npm run scrape`(원본 HTML → `data/timetable.json`) ·
`npm run demo`(빌드 + `data/timetable.json` 동봉 + 데모 서버 4190 — 아래 §데모 실행) ·
`npm run lint:boundary`(헥사고날 경계 검사 — `src/domain` 순수성·`src/application`→`adapters` 금지)

### 데모 실행(T36) — 빌드 · 데이터 동봉 · 정적 서버 한 번에
```bash
npm run demo                    # 빌드 → dist/data/timetable.json 동봉 → http://127.0.0.1:4190/ (자체 점검까지)
npm run demo -- --port=4191     # 포트 변경 (또는 `PORT=4191 npm run demo`)
npm run demo -- --skip-build    # 빌드 생략(직전 dist 재사용) · `--bind=127.0.0.1` 로컬 전용 바인드
npm run demo -- --stop          # 이 스크립트가 띄운 데모 서버만 정지(남의 프로세스는 건드리지 않는다)
```
- 앱이 읽는 계약 데이터 `data/timetable.json` 은 vite 번들이 아니라 **저장소 루트**에 있고, `npm run build` 는
  `dist/` 를 통째로 비운다 → 동봉 단계가 없으면 `/data/timetable.json` 404 로 앱이 "데이터 로드 실패" 폴백에
  떨어진다(T36 재현). `npm run demo` 가 이 순서(빌드 → 동봉 → 서빙)를 매번 보장한다(deploy.yml 과 동일 순서).
- 포트가 이미 점유돼 있으면 기존 프로세스를 죽이지 않고 안내만 하고 끝난다 → **두 번 실행해도 리스너는 늘지 않는다**.
- 서버 로그: `.session-notes/demo-server.log`(gitignore) · pid 파일: `dist/.demo-server.pid`(`--stop` 용).

### 앱 화면(T5) — 렌더 스모크 (헤드리스 Chrome, 의존성 0)
```bash
# 1) 빌드 (dist/) — 앱은 dist/data/timetable.json 을 상대경로로 읽는다
npm run build
# 2) 스모크 — 빌드본을 **Pages 하위 경로**(/sunmoon-shuttle/)로 서빙해 실제 화면을 검증
node scripts/render_smoke.mjs                     # 스크린샷 .session-notes/T5-*.png · 실패 시 exit 1
node scripts/render_smoke.mjs --base=/            # 루트 경로로 서빙(로컬 dev 형태)
node scripts/render_smoke.mjs --now=2026-10-05T14:40:00+09:00   # 시각 고정(결정적 검증)
# 3) 하위 경로 수동 확인(선택)
npx vite preview --base=/sunmoon-shuttle/          # → http://localhost:4173/sunmoon-shuttle/
```
- 앱은 `./data/timetable.json` 을 **상대경로**로 요청한다(`vite.config.ts` 의 `base: './'`) → `/sunmoon-shuttle/` 하위 배포에서도 깨지지 않는다.
- 디버그용 쿼리: `?now=<ISO8601 KST>`(시각 고정) · `?day=weekday|saturday|sunday` · `?route=<routeId>`(초기 선택).

### 간편 홈 V1(T12) — 구조와 스모크
홈은 **지금(now) 중심**이다: ① 상태줄(오늘 날짜·현재 시각, KST) ② 공지 배너(운행 없음/대체 시간표, 조건부)
③ 다음 출발 카드(노선 통합 상위 3편 · 방향 · 도착 · 특이사항) ④ 방향 필터 칩(전체/학교에서 출발/학교로 도착)
⑤ 오늘 남은 출발 목록(12편 + "더 보기") ⑥ 원본 전체표는 `<details>` 로 접힘 ⑦ 요일 탭은 보조("다른 날 미리보기").
값은 전부 도메인(`dayTypeFromDate`·`resolveDayService`·`nextDepartures`)에서 오고, 60초마다 갱신되며 자정을 넘으면 다음 날로 바뀐다.
```bash
npm run build
node scripts/v1_smoke.mjs    # 헤드리스 Chrome · 시나리오 4종(평일08:00/대체휴일10:00/자정경계23:59→00:01/오늘 실측)
                             # 스크린샷 .session-notes/T12-*.png · 실패 시 exit 1
node scripts/a11y_smoke.mjs  # 접근성·PWA·다크모드 회귀(대비 4.5:1 · 터치 48px)
npm run verify:offline       # 오프라인/캐시 폴백 회귀(AC-5·AC-6)
```


## 도메인 규칙 — 다음 출발 계산 (T4)
```ts
import { nextDepartures } from './src/domain/rules/nextDeparture';

const result = nextDepartures({
  schedule,                     // data/timetable.json (docs/01 §4 스키마)
  routeId: 'asan-ktx',
  clock: { now: () => new Date() },  // 시계는 포트로 주입(도메인은 Date.now() 금지)
  count: 3,                     // 기본 3개
});

// result.status: 'ok' | 'no-service-today' | 'empty-schedule' | 'unknown-route'
// result.departures: [{ departure:'08:05', date:'2026-10-07', dayLabel:'내일', remainingMinutes, remainingSeconds, ... }]
```
- 요일·운행 여부는 `src/domain/rules/serviceDay.ts` 의 **문자열 패턴 표**(`NOTICE_RULES` / `TRIP_NOTE_RULES`)만 근거로 판정한다.
  해석하지 못한 표기는 `result.warnings` 로 모아 올린다(조용히 무시하지 않는다).
- 시각은 호스트 TZ 와 무관하게 **KST(+09:00) 고정**으로 계산한다(`src/domain/rules/kst.ts`).
- 경계 케이스 12종(자정·요일 전환·운행 없는 날·`금(X)`·`Χ`·빈 스케줄 …)은 `tests/domain/nextDeparture.test.ts`.

## 문서
| 파일 | 내용 |
|---|---|
| `docs/00-requirements.md` | 목표·사용자·기능(MUST/SHOULD/MAY)·비기능·**수용 기준 8개**·범위 밖 |
| `docs/01-architecture.md` | 구성도·기술 선택 근거·헥사고날 구조·**데이터 스키마**·배포·캐싱 전략·비용 0 설계 |
| `docs/02-monitoring.md` | 지표·임계값·알림 경로·장애 시나리오별 복구(runbook)·로그 보존 |
| `docs/03-verification.md` | AC ↔ 테스트 매핑·실행 명령·증거 형식·미달 처리 |
| `docs/04-tasks.md` | 보드 slug·태스크 10건·의존관계·가정·**결정 대기 목록** |
| `docs/05-store-listing.md` | **스토어 등록 문구**(한/영·길이 제한 실측)·카테고리·콘텐츠 등급 근거·Data safety 초안·**개인정보처리방침 URL**·비공식 고지 |
