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
- **계획 단계** — 문서 5종 작성 완료, **결정 대기 6건**(`docs/04-tasks.md` 말미) → 확정 후 보드·태스크 발행
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
npm run dev            # 2) 실행 (Vite 개발 서버)
npm run test           # 3) 테스트 (vitest · tests/**)
```
그 밖의 스크립트(이름 고정 — 다른 문서·워크플로가 이 이름을 쓴다):
`npm run build`(`tsc --noEmit` + `vite build` → `dist/`) · `npm run preview`(빌드 결과 미리보기) ·
`npm run test:watch`(감시 모드) · `npm run scrape`(원본 HTML → `data/timetable.json`) ·
`npm run lint:boundary`(헥사고날 경계 검사 — `src/domain` 순수성·`src/application`→`adapters` 금지)

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
