# 03 — 검수 기준 · 테스트 계획 · 실행 결과 (선문대 셔틀버스 시간표 앱)

작성: ProjectCreator(총괄) · 2026-10-05

## 0. 검수 규율 (협상 불가)
- 워커의 "완료"는 **자기보고**다. 총괄이 **파일을 열고 명령을 직접 실행**해 확인한 뒤 판정한다.
- 증거 없는 완료는 실패: **명령 원출력·수치·스크린샷 경로**가 있어야 한다.
- 워커는 문서에 "총괄 검수 통과"·"AC 통과" 같은 **판정 문구를 쓰지 않는다**(수치·원출력만).
- 문서와 코드가 어긋나면 **문서를 먼저** 고친다(문서 = 계약).

## 1. AC ↔ 테스트 매핑
| AC | 검증 항목 | 실행 명령 | 기대 결과 | 담당 |
|---|---|---|---|---|
| **AC-1** | 파서 정확도(골든) | `npm run test -- scraper/golden` | 평일·토·일 3종에서 **행 수·셀 값 100% 일치**(불일치 0) | game→(신규 워커) |
| **AC-2** | 파서 결정성 | `npm run test -- scraper/determinism` | 같은 HTML 2회 → **해시 동일** | 동일 |
| **AC-3** | 다음 버스 계산 | `npm run test -- domain/nextDeparture` | 경계 케이스 **≥ 12개 통과**(자정·요일 전환·공휴일·운행 없음·마지막 차 이후) | 동일 |
| **AC-4** | 자동 반영 | Actions 실행 로그 + `git log data/` | 원본 변경 시 **커밋 1건** · 무변경 시 **커밋 0건** | 동일 |
| **AC-5** | 수집 실패 폴백 | 실패 주입(`--fail-source`) + 앱 실행 | 마지막 정상 데이터 표시 · 콘솔 오류 0 · 스크린샷 1장 | 동일 |
| **AC-6** | 오프라인 동작 | 헤드리스/실기기 **비행기 모드** | 첫 화면·요일 전환·카운트다운 동작(스크린샷 3장) | 동일 |
| **AC-7** | iOS/Android 호환 | iOS Safari(실기기 또는 시뮬레이터) · Android Chrome · PWA 설치 | 3환경 스크린샷 · 홈화면 아이콘 동작 | 동일 |
| **AC-8** | 비용 0·개인정보 0 | 저장소/과금 목록 점검 + 네트워크 요청 목록 | 과금 리소스 **0건** · 추적/광고 도메인 **0건** | 총괄 직접 |

## 2. 테스트 계층
| 계층 | 대상 | 도구 | 비고 |
|---|---|---|---|
| 단위 | `domain/rules`(다음 출발·요일·공휴일) | vitest | **시계 주입**(결정적) |
| 단위 | `adapters/out/storage`(IndexedDB) | vitest + fake-indexeddb | 오프라인 캐시 |
| 골든 | `tools/scraper/parse` | vitest + `data/raw/*.html` 픽스처 | **원본 스냅샷이 계약** |
| 통합 | 앱 부팅 → 데이터 로드 → 화면 | 헤드리스 브라우저 | 콘솔 오류 0 · 렌더 확인 |
| 스모크 | 배포본(GitHub Pages) | 헤드리스 + 실기기 | AC-6·AC-7 |

## 3. 실행 명령 (워커가 그대로 실행)
```bash
npm ci
npm run test                 # 단위·골든 전부
npm run test -- scraper      # 파서 골든만
npm run scrape -- --local    # 로컬 스냅샷으로 JSON 재생성(네트워크 없이)
npm run build                # 정적 빌드
npm run verify:offline       # 오프라인 스모크(헤드리스)
```

## 4. 실행 결과 기록란
| 회차 | 날짜 | 대상(커밋) | AC | 판정 | 증거 경로 |
|---|---|---|---|---|---|
| T7 검수 | 2026-10-05 | `8276cfb` (T7 PWA·접근성·다크모드) | AC-7(PWA 설치·전체화면)·접근성 | **통과(총괄 직접 실행)** — `npm run test` **171 passed** · `npm run build` 성공(dist 44.97kB js/11.03kB css) · `npm run lint:boundary` **PASS**(domain 순수성·application→adapters 0건) · 아이콘 192/512/maskable-192/512 + apple-touch 180 + favicon 32 **치수 실측 일치**(`file`) · 하드코딩 색 **0건** · 아이콘 생성기 재실행 **멱등**(public/ 무변경) · 워커 감사 스크립트 **총괄 재실행 → 검사 36건·실패 0·exit 0** · `src/domain/**` 변경 0줄 | `8276cfb` · `.session-notes/T7-a11y-report.md`(865행) · `.session-notes/T7-{light,dark,standalone,focus-skip-link}.png` |
| T6 검수 | 2026-10-05 | `9472134`·`8b3da7b`·`40d86e3` (T6 캐시 계층) | AC-5(수집 실패 폴백)·AC-6(오프라인) | **통과(총괄 직접 실행)** — 커밋 3건 전부 `src/domain/**` 변경 **0줄**, 트리 미커밋 **0** · `npm run test` **17파일 171 passed** · `npm run build` PASS · `npm run lint:boundary` PASS · **`node scripts/offline_smoke.mjs` 총괄 재실행 → OFFLINE SMOKE: PASS · exit 0 · 27항목**(오프라인 새로고침 첫 화면·SW 제어·평일 42행=JSON·토요일 4행=JSON·카운트다운 `오늘 16:10 출발/약 1시간 30분 후`·**앱 콘솔 오류 0** / 데이터 요청 실패 주입 → **마지막 정상 데이터 + 문구 안내**(색만 아님)·오류 UI 안 감·**콘솔 오류 0** / 캐시 24h 초과 → 캐시 유지 + `24시간 초과` 문구 / 캐시 없음 → 오류 UI+원본 링크, 조용한 실패 없음) · 런타임 `dependencies` **없음** (`public/sw.js` 버전 상수 무효화 확인) | `9472134`·`8b3da7b`·`40d86e3` · `.session-notes/T6-{1..6}-*.png` · `T6-commands-raw.txt` · `T6-offline-smoke-output.txt` · `T6-증거.md` |
| T6 예외 승인 | 2026-10-05 | 〃 | — | **카드 지시 이탈 1건 승인**: 카드가 지정한 `fake-indexeddb`(devDependency)는 보안 게이트(`ecosyste.ms` 메타데이터 조회 실패·MEDIUM)로 설치 차단 → 워커가 **저장소 내 최소 페이크**(`tests/support/fakeIndexedDb.ts`, 의존성 0)로 대체하고 실 브라우저 경로는 헤드리스 CDP 스모크로 실측. 의존성 0 계약에 더 부합하므로 **총괄 승인**(카드 지시가 오히려 부적절했음). | `tests/support/fakeIndexedDb.ts` · `scripts/offline_smoke.mjs` |
| T9 검수 | 2026-10-05 | `397a650` (T9 iOS 경로 검증 도구, 16파일) | AC-6·AC-7(iOS 경로) | **통과(총괄 직접 실행)** — `node scripts/qa/ios_compat_check.mjs` → **검사 44건 PASS 44 · FAIL 0 · exit 0**(manifest·apple-* 메타·CSS 기능 기준선·SW 상대경로 등록·IndexedDB 가드) · `node scripts/qa/ios_pwa_smoke.mjs` → **IOS PWA SMOKE: PASS · exit 0**(iPhone 390×844@3x·iPhone UA, Phase A~D: 온라인/오프라인 요일전환·**standalone 전체화면 42행**·**IndexedDB 없음 → 네트워크 경로 42행 + 콘솔 오류 0**, 스크린샷 5장) · `bash scripts/qa/ios_selfcheck.sh` → **위조 주입 9종 전부 FAIL 검출(케이스 13 PASS·FAIL 0) + 주입 대상 6경로 해시 원복 동일·git status 0** · 회귀 `npm run test` **171 passed** · `build` PASS · `lint:boundary` PASS · `src/domain` 변경 0줄 · 사람 체크리스트 `scripts/qa/iOS-CHECKLIST.md`(115행, **항목별 "자동화 불가 사유" 명시** — 홈화면 추가·회전·실기기 시계·자정 경계 등) | `397a650` · `scripts/qa/{ios_compat_check.mjs,ios_pwa_smoke.mjs,ios_selfcheck.sh,iOS-CHECKLIST.md}` · `.session-notes/T9-{1..5}-*.png` · `T9-{compat-check,pwa-smoke,selfcheck,boundary,npm-test,npm-build}.txt` |
| **T10 게이트** | 2026-10-05 | `69a10f1` (HEAD — T6 `9472134`·`8b3da7b`·`40d86e3` / T7 `8276cfb` / T8 `b482593`·`8b83550`·`419f904` / T9 `397a650`) | **AC-1~AC-8** | **AC-1~AC-6·AC-8 통과 / AC-7 조건부(Android 실측 완료 · iOS 실기기 = 사람 게이트)** — 총괄 직접 실행. 근거·원출력은 **§7**. 회귀 `npm run test` **171 passed/0 fail** · `build` PASS · `lint:boundary` PASS · `src/domain` T6~T9 변경 **0줄** | `.session-notes/T10-*.txt` · `T10-android-*.png` · `T10-ios-*.txt` · `T10-ac{1,4,8}-*` · `scripts/qa/iOS-CHECKLIST.md` |
| T12 검수 | 2026-10-05 | `35fa369`·`8c5fc1a`·`37be52e`·`489acab` (T12 간편 UI V1 · 4커밋) | 사용자 지시(원본 미러링 탈피 + 오늘 날짜·현재시각 자동 바인딩) · AC-5·AC-6·접근성 회귀 | **통과(총괄 직접 실행)** — `npm run test` **19파일 216 passed**(T11 197 → +19) · `npm run build` PASS(js 55.48kB gzip 17.38kB) · `npm run lint:boundary` **PASS** · **`node scripts/v1_smoke.mjs` 총괄 재실행 → `V1 SMOKE: PASS` · exit 0 · 35항목** — ① **오늘 실측(주입 없음)**: 상태줄 `10월 5일 (월) 23:41` + 배너 `일요일 시간표로 운행합니다(개천절대체휴일)` + `총 16편 · 남은 0편` ② **자정 경계 실측**: `23:59` → `내일 07:30 출발` · `오늘 운행이 끝났습니다 · 다음 운행: 내일 07:30` / `00:01` → 상태줄 `10월 6일 (화) 00:01` · `오늘 07:30 출발`(목록 dayOffset 전부 0, 지난 편 제외) ③ 평일 08:00 → hero `오늘 08:05 출발` · 115편 · 방향 칩 `전체 113 / 학교에서 출발 89 / 학교로 도착 24` ④ 대체휴일 10:00 → hero `오늘 12:00 출발` · 16편 ⑤ V1 4요소 DOM 실재(`app-clock`·`next-bus-card`·`direction-filter`·`details[source-details]`) ⑥ 콘솔 오류 0 · **회귀 `node scripts/a11y_smoke.mjs` 46건·실패 0** · **`npm run verify:offline` PASS** · `src/domain`·`docs` 변경 **0줄** · T12 는 `package.json` 무변경(의존성 추가 0 — `dependencies` 의 `@capacitor/*` 는 T8 패키징 레이어로 기존 판정 기준 "런타임 0"을 "웹 런타임 0 + Capacitor 전용"으로 정정) | `35fa369`·`8c5fc1a`·`37be52e`·`489acab` · `scripts/v1_smoke.mjs` · `tests/adapters/in/web/{todayBoard.test.ts,boardFixtures.ts}` · `src/adapters/in/web/features/schedule/{components/molecules/DirectionFilter.ts,components/organisms/{NextBusCard,DepartureList,UpcomingBoardCard}.ts,pages/SchedulePage.ts}` · `.session-notes/T12-{1..5}-*.png` · `T12-증거.md` · `T12-v1-smoke.txt` |
| **회귀 발견(T17 이후 HEAD)** | 2026-10-06 | `06d11f6`(HEAD, T17) | **AC-5(수집 실패 폴백)·AC-6** | **FAIL — 배포·P3 최종 판정 보류** — 총괄이 `npm run verify:offline` 직접 실행 → **exit 1**, 5건 실패: ①수집 실패 시 마지막 정상 데이터 미표시(`listStatus=loading rows=0`) ②캐시 폴백 안내 `null` ③오류 UI(F8)로 감 ④**앱 콘솔 오류**(`[schedule] 데이터 로드 실패 TimetableDataError`) ⑤만료 캐시 `24시간 초과` 안내 `null`. 상태 덤프: `{cardStatus:loading, listStatus:loading, offlineNotice:null, errorBanner:true}`. **앞 단계는 정상**(온라인 로드·SW·IndexedDB 저장·오프라인 새로고침 보드 렌더·탭 전환 PASS) → **상태 전이(캐시 폴백 분기) 회귀**. T6 시점 같은 시나리오는 PASS 27항목(`.session-notes/T6-offline-smoke-output.txt`). → **수정 태스크 `t_74a9348b`(T18) 발행**, 원인 커밋 bisect 지시 | `verify:offline` 원문은 `.session-notes/` 로그 · 의심 커밋 T14 `6d8c6f8`·`6bafe1b` / T17 `6c7c327` |
| T17 검수(부분) | 2026-10-06 | `6c7c327`·`06d11f6` | 스키마 v2 표시 | **통과** — `test` **25파일 330 passed**(T16 303 → +27) · `lint:boundary` PASS · `v2_smoke` **PASS**(6케이스) · `v1_smoke` PASS · `a11y` **46/0** · T14 계약 유지(`UI_TEXT` 내 `원본` 은 주석만·`source-details` 호출 0·학교 링크 1) · `src/domain` 0줄. **단 같은 HEAD 에서 위 회귀가 확인되어 AC-5/AC-6 은 미달** | `06d11f6` · `scripts/v2_smoke.mjs` · `tests/adapters/in/web/v2Display.test.ts` · `.session-notes/T17-{1..6}-*.png` |
| **T18 회귀 수정 검수** | 2026-10-06 | `c30eea6`·`bd1db93` | AC-5·AC-6 | **통과 — 회귀 닫힘** — **근본 원인**: T16 이 `timetable.json` 을 `schemaVersion 2` 로 발행했는데 앱 캐시 읽기 게이트가 `SUPPORTED_SCHEMA_VERSION = 1`(T6)만 통과 → v2 캐시 거부 → 수집 실패 시 폴백 캐시 없음 → 로딩 정지·오류 UI·콘솔 오류. 수정: 게이트를 **지원 목록(v1·v2)** 으로 확장. 총괄 재실행: **`npm run verify:offline` → `OFFLINE SMOKE: PASS` exit 0** · `test` **25파일 334 passed**(T17 330 → +4: `v2 원문 캐시(schemaVersion 2)를 파싱해 캐시로 폴백한다` 등 RED→GREEN) · `lint:boundary` PASS · `v1_smoke`/`v2_smoke`/`a11y` 전부 PASS · `build` 성공 · 미커밋 0 | `.session-notes/` T18 증거(v1↔v2 대조 RED 원출력) · `src/adapters/out/storage/indexedDbTimetableCache.ts` |

## 5. 미달 시 처리
| 상황 | 처리 |
|---|---|
| 파서가 원본과 불일치 | `kanban_request_changes`(어느 행·열이 어떻게 다른지 원출력 포함) + 골든 픽스처 갱신 금지(원본이 기준) |
| 계산 규칙 오류 | 도메인 테스트 케이스 추가 요구(경계 케이스 명시) |
| 오프라인 미동작 | 재현 절차·네트워크 로그 요구 → 캐시 전략 재검토 |
| 비용 발생(과금 리소스) | **즉시 중단**하고 총괄이 사용자에게 보고(비용은 승인 사안) |
| 스토어 반려 | 반려 사유 원문 인용 → 문서 개정 → 재제출 |

## 6. 검수 체크리스트 (총괄이 매 검수마다)
1. 커밋 **귀속**(작업자 이름)과 **범위**(경계 침범 0) 확인
2. `npm run test` 직접 실행 → 실패 0
3. 골든 픽스처가 **원본 HTML**임을 확인(가공된 기대값 금지)
4. 오프라인/실기기 스크린샷을 **눈으로** 확인(빈 화면·깨진 표 아님)
5. 비용·개인정보 항목 실측(AC-8)
6. 판정 결과를 `docs/03 §4` 표와 프로젝트 채팅에 기록

## 7. P3 게이트 최종 판정 (T10 · 2026-10-05 · 총괄 직접 실행)

**대상**: `69a10f1` (HEAD) — T6 `9472134`·`8b3da7b`·`40d86e3` / T7 `8276cfb` / T8 `b482593`·`8b83550`·`419f904` / T9 `397a650`
**요약**: AC-1~AC-6·AC-8 **통과** · AC-7 **조건부 통과**(Android 에뮬레이터 실측 완료 / **iOS 실기기는 사람 게이트 — 총괄이 대리 판정하지 않음**)
**전체 회귀**: `npm run test` **17파일 171 passed / 0 fail** · `npm run build` PASS(index.html 1.76kB · css 11.03kB/gzip 2.43kB · js 44.97kB/gzip 14.90kB) · `npm run lint:boundary` PASS(경계 위반 0) · `git diff --numstat 0ab0501..HEAD -- src/domain` → **0줄**

| AC | 총괄이 직접 실행한 검증 | 실제 출력(원문) | 판정 |
|---|---|---|---|
| **AC-1** 파서 골든 | `npm run test` · `./node_modules/.bin/vitest run tests/scraper/golden.test.ts` · 독립 대조 도구 `T10-ac1-rows` (정규식+HTML 구조, 파서와 다른 구현) | 골든 **15 passed**(스냅샷 11종: asan-ktx 42/4/6 · cheonan-station 33/4/5 · cheonan-terminal 38/4/5 · onyang 7 · cheonan-campus 0=운행중단) · 독립 대조: **데이터 행 수 11/11 일치** + **표 안 시각 값 멀티셋 11/11 일치**(note 열 원문값 `0:15` 1건은 보존 규칙으로 상쇄) | **통과** |
| **AC-2** 결정성 | `vitest run tests/scraper/determinism.test.ts` · 독립 재현 `T10-ac12-independent.ts` (tsx) | 테스트 **5 passed** · 독립 재현: 11개 스냅샷 2회 파싱 → **해시 동일**(예 asan-ktx 평일 `6c4f43cf…`) · `__VIEWSTATE` 변조 후 HTML 바이트 상이=true / 파싱결과 동일=**true** · 조립 바이트동일=true·입력순서 무관=true · `contentHash` `sha256:16fac81b…f900` 안정 | **통과** |
| **AC-3** 다음 버스 | `vitest run tests/domain/nextDeparture.test.ts` | **18 passed**(요구 ≥12) — ①a 자정직전 ①b 자정직후 ②금밤→토 ③토밤→일 ④일밤→월 ⑤a 마지막차 30초 전 ⑤b 30초 후(→다음날 첫차) ⑥⑥b 운행없는날(한글날·개교기념일) ⑦a⑦b `금(X)` ⑧ 주석 회차 ⑨ `Χ` 제외 ⑩⑩b 요일표/대체시간표 ⑪a⑪b 노선 unknown-route ⑫ 빈 스케줄 | **통과** |
| **AC-4** 자동 반영 | 실 Actions 로그 `gh run view` ×2 · `git log -- data/` · 워크플로 셸 로직 로컬 재현 `T10-ac4-repro.sh` | 무변경 2회(러un `37269211341`·`37269154462`) 모두 **`fetchedAt 외 내용 동일 → 데이터 변경 없음 → 커밋 0건`** · 로컬 재현: 재파싱 ↔ HEAD → `changed=false`(커밋 0건) / 스냅샷 1셀 변조(`8:05`→`8:06`, `contentHash a2b9a15f…`) → `changed=true` → 반영 커밋 **1건**(스크래치 git, 워크플로 '반영 — main 커밋' 블록과 동일 명령) · `git log -- data/` 커밋 4건(초기 반입 3 + 생성물 1) | **통과**(§7.1-2 한계) |
| **AC-5** 수집 실패 폴백 | `node scripts/offline_smoke.mjs` (fetch 실패 + SW 미제어 주입) | **OFFLINE SMOKE: PASS · exit 0 · 27항목** — 실패 주입 시 **마지막 정상 데이터 42행=JSON** 표시 + 문구 안내(`오프라인 — 마지막으로 받은 데이터를 표시합니다` · `최신 데이터를 받지 못했습니다: … Failed to fetch`) · 오류 UI(F8) 미진입 · **앱 콘솔 오류 0** · 캐시 없음 → 오류 UI + 원본 링크(조용한 실패 없음) | **통과** |
| **AC-6** 오프라인 | `node scripts/offline_smoke.mjs` (오프라인 새로고침) + 스크린샷 육안 확인 | 오프라인 첫 화면 42행=JSON · SW 제어 · **요일 전환 토요일 4행=JSON** · **카운트다운 `오늘 16:10 출발 / 약 1시간 30분 후`** · 콘솔 오류 0 · 스크린샷 `T6-1/2/3` (육안: 빈 화면 아님 · 표·카운트다운 정상 · 오류 배너 없음) | **통과** |
| **AC-7** iOS/Android/PWA | ① `node scripts/qa/ios_compat_check.mjs` ② `ios_pwa_smoke.mjs` ③ `bash scripts/qa/ios_selfcheck.sh` ④ **Android 에뮬레이터 실측**(APK 설치→콜드 스타트→WebView DOM 판독) ⑤ `scripts/qa/iOS-CHECKLIST.md` | ① **44 PASS/0 FAIL** ② **32 PASS/0 FAIL**(스크린샷 5장) ③ **13 PASS/0 FAIL** — 위조 주입 9종 전부 검출·주입경로 원복 후 git status 0 ④ `com.angalle.sunmoonshuttle` 0.1.0 설치, `MainActivity` resumed·pid 생존, 첫화면/토요일전환/스크롤 스크린샷, WebView DOM 실측: 탭 3종(`shuttle-day-tab-{weekday,saturday,sunday}`)·**평일 57행 → 토요일 탭 클릭 후 19행**·hero `가장 가까운 출발 오늘 19:10 출발 약 14분 후`·**FATAL EXCEPTION 0 · ANR 0 · 앱 콘솔 오류 0 · tombstone 0**, 전체페이지 스크린샷에 토요일 표 4행 렌더(육안) ⑤ 사람 체크리스트 **19항목**(자동화 불가 사유 항목별 명시) | **조건부 통과** — Android 완료 / **iOS 실기기(Safari·WebKit·홈화면 추가)는 사람 게이트 미완**(머신에 Xcode·iOS 시뮬레이터 없음) |
| **AC-8** 비용 0·개인정보 0 | 네트워크 감사 `T10-ac8-network-audit.mjs`(헤드리스 CDP Network) + 저장소 점검(`search_files`/`git ls-files`) | 빌드본 로드 요청 **8건 전부 동일 출처(127.0.0.1)** — document·script·css·manifest·icon·favicon·`data/timetable.json` · **제3자/추적/광고 도메인 0건** · 콘솔 오류 0 · `dependencies`=`@capacitor/{android,core}` 뿐이고 **`src/` 의 `@capacitor` import 0건**(웹 번들 무관) · 저장소 시크릿/키 파일(**`.env`·`google-services.json`·keystore 등) 0건**(`git ls-files` 257개) · 저장소 **PUBLIC**(disk 1,615KB) → Actions·Pages 무료 등급 · 로컬 저장 = IndexedDB(계약 JSON·hash·fetchedAt) + localStorage(설치 안내 1회 플래그) | **통과**(부기 §7.1-4) |

### 7.1 주의 · 한계 (정직 기록)

1. **배포본(GitHub Pages)은 stale — T6~T9 미배포.** 최신 배포는 run `37270216029`(2026-10-05 14:59 KST, T5 시점 커밋 `0ab0501`). 배포본 HTTPS 실측: `index.html` 200(`last-modified 06:00:30 GMT`, `index-4S66PK19.js` = 구 빌드), **`sw.js`·`manifest.webmanifest`·`icons/*` 404**, `data/timetable.json` 200(84,846B — 내용 동일). 즉 **오프라인·PWA·접근성(T6~T9)은 아직 사용자가 못 본다**. 로컬 HEAD 빌드는 `index-hbcy5NfT.js`·`index-BET44E-c.css` + sw.js·manifest·icons 포함. → **§4·§7 의 AC-5/6/7 실측은 전부 로컬 빌드(dist) 기준**이며, 배포 시 `main` push 12커밋이 필요하다(사용자 승인 사안 — 배포 트리거).
2. **골든↔스냅샷 커플링.** `tests/scraper/golden.test.ts` 는 `data/raw/*.html` 에서 읽은 값을 고정 기대값으로 갖는다. 따라서 **원본 시간표가 바뀌면 scrape.yml 의 "테스트(골든 포함)" 스텝이 먼저 실패**한다(조용한 커밋 금지 — 의도된 설계). 실 운영 순서 = 사람이 새 스냅샷 **과 골든 기대값**을 같은 PR 에서 갱신 → 워크플로가 파싱·계약검증·테스트 통과 후 내용 변경 시 커밋 1건. 실 Actions 에서 **변경 반영 커밋 경로는 미실행**(무변경 0건만 2회 실측 + 셸 로직 로컬 재현).
3. **iOS 실기기 미검증** — Xcode/iOS 시뮬레이터 부재로 WebKit 실동작·홈 화면 추가·회전·VoiceOver 는 자동화 불가. `scripts/qa/iOS-CHECKLIST.md` 19항목이 사람 게이트(결과 기록란 비어 있음).
4. **AC-8 부기 — 원본 스냅샷의 GA 문자열.** `data/raw/*.html` 에는 원 사이트의 `googletagmanager`/`google-analytics`/`gtag`(`UA-74905764-3`) **문자열이 보존**되어 있다(원본 대조·골든 근거). 앱은 이 HTML 을 **실행하지 않는다**(`src/` 에 `innerHTML`·`eval`·`DOMParser` 0건, 파서도 DOM 라이브러리 미사용)이며 **배포 산출물(dist)에 포함되지 않는다** — 네트워크 요청 0건으로 실측.
5. **의존성 스코프 판정(총괄).** T9 가 제기한 "T8 의 `dependencies` 추가 ↔ 웹 런타임 의존성 0 계약" 충돌은 **충돌 아님**으로 판정: `src/` → `@capacitor` import 0건, 빌드 산출물은 자체 모듈 42개. `@capacitor/{core,android}` 는 **Android 패키징 전용**이며 웹 계약은 유지된다 → 계약 문구를 `docs/01 §2` 에 명시(문서=계약).
6. **미비 항목 → 보완 태스크 발행.** **개인정보처리방침 문서/페이지가 없다**(저장소·앱·docs 어디에도 없음). 스토어 제출(Play/App Store) 요건이므로 **T11 보완 태스크**를 발행했다(담당 `frontendprojectcreator`). 참고: 비공식 고지는 앱 푸터(`unofficialNotice`)·`index.html` description·manifest description 에 문구 정합, PWA 설치 안내는 iOS/Android 분기·한/영·**1회 표시**(standalone 에서는 미표시) 실측 확인.
7. **문서 정정(게이트 중 발견).** `docs/01 §1` 구성도가 (a) 수집을 "하루 2회 cron"으로, (b) 배포 대상을 "`data/timetable.json` · `data/raw/*.html`" 로 적고 있었으나 실제는 **workflow_dispatch(자동 크롤 없음)** 이고 **배포는 `data/timetable.json` 만**이다(원본 스냅샷은 서버에 올리지 않음). 코드에 맞춰 정정했다.

