# 04 — 태스크 보드 (선문대 셔틀버스 시간표 앱)

작성: ProjectCreator(총괄) · 2026-10-05 · 보드 slug: **`sunmoon-shuttle`** (생성 예정 — 결정 확정 후)

## 결정 확정 (사용자 "선문셔틀은 진행해", 2026-10-05) — 추천안 채택
**실행 기록(총괄)**:
- 새 저장소 **https://github.com/angalle/sunmoon-shuttle** (public — Pages 무료 조건) · 커밋 `c104735`(계획) · `e9d1184`(원본 스냅샷)
- 보드 **`sunmoon-shuttle`** 생성(`--default-workdir` = 프로젝트 홈) · 워커 워크스페이스는 `workspace_kind=dir`
- **원본 스냅샷 1회 반입**: 5개 노선 HTML(`data/raw/2026-2학기-<노선>-요일혼합.html`, 총 621KB) + 출처·절차 `data/raw/README.md` — **자동 크롤 없음**(1회, UA 명시, 간격 2s)
- 크루: `apiprojectcreator`(파서·도메인) · `infraprojectcreator`(Pages/CI·Android 패키징) · `frontendprojectcreator`(UI·캐시·PWA) · **`app-qa` 신규 생성**(앱 검증 전용, 검증 독립성 확보)
- 발행 태스크: **T1 `t_59a0eb90`**(사이트 매핑·수집 계약) · **T0 `t_37cdfc3e`**(골격) · **T2 `t_5ccc5cf5`**(파서+골든, T0 후) · **T4 `t_553d9eee`**(도메인 규칙, T0 후) · **T3 `t_68ff2524`**(Pages+수동 스냅샷 워크플로)
- 앞으로: T5(UI)→T6(캐시)→T7(PWA·접근성)→T8(Android)→T9(iOS/PWA 검증, `app-qa`)→T10(총괄 AC 판정)

다음 표는 **확정된 결정**이다(뒤집으려면 사용자 지시 필요).
| # | 결정 | 선택지 | 총괄 추천 |
|---|---|---|---|
| **D1** | 저장소 | ① **새 저장소 `sunmoon-shuttle`** + 기존 저장소는 archived ② 기존 저장소에 새 코드(히스토리 꼬임) ③ 기존 저장소 강제 교체 | **①** — 기존 Java 히스토리·APK·노출된 키를 새 저장소로 끌고 갈 이유가 없다 |
| **D2** | 스택 | ① **Vite + TS + PWA + Capacitor** ② React Native(Expo) ③ Flutter | **①** — 보유 툴체인 재사용 + iOS를 PWA로 무료 즉시 |
| **D3** | iOS 범위 | ① **PWA 먼저**(무료·즉시) ② + Xcode 설치로 Capacitor iOS 로컬 빌드(무료, ~10GB) ③ + App Store($99/년) | **①지금, ②는 원하실 때** (③은 비용 발생 → 별도 승인) |
| **D4** | 수집 범위 | ① **셔틀버스 5개 노선 전부**(아산KTX·천안역·천안터미널·온양역/터미널·천안캠퍼스) × 요일 3종 ② + 시내버스 참고·공지 링크 ③ + 학사일정 휴일 자동 | **① → 여유 시 ②** (③은 학사일정 별도 수집 필요) |
| **D5** | 갱신 주기 | ① **하루 2회**(06:00·18:00 KST) 자동 ② 1시간마다 ③ **수동 스냅샷**(학기 개편 시 1회 반입) | **③ 수동** — 실측 결과 `robots.txt` 가 `/Page`(=**/Page2 포함**)를 차단 → 자동 크롤은 학교 허락 전 금지(`docs/01 §8`). 파서·배포 자동화는 유지 |
| **D6** | 기존 저장소 정리 | ① **키 폐기 + archived**(추천) ② 그대로 두기 | **①** — `app/google-services.json`(1,097B) 공개 커밋 = Firebase 키 노출, `app-release.apk`(2017)도 정리 대상 |
| **D7** | `robots.txt` 대응 | ① **수동 스냅샷 반입**(학기 1회, 추천) ② 학교에 이용 허락 문의 후 자동 크롤 ③ 자동 크롤 강행 | **①+②(여유 시 문의)** — ③은 하지 않는다(로봇 규칙·약관 위반 소지) |

## 작업 가정 (문서에 명시 — 뒤집히면 문서 먼저 수정)
- A1 스택 = PWA+Capacitor · A2 수집 = GitHub Actions+Pages · A3 요일 3종×노선 전부 · A4 iOS=PWA 우선 · A5 비공식 고지 표시
- (근거·뒤집는 조건은 `README.md` 가정 표 참조)

## 태스크 (발행 예정 — 의존관계 포함)
| id | 태스크 | 담당 | 의존 | 산출물 |
|---|---|---|---|---|
| T1 | **사이트 매핑·수집 계약**: 어떤 URL·탭·노선이 존재하는지 **전수 조사**하고 목록화(요일 3종 매핑, 노선 목록, 안내문 위치, `robots.txt`·이용약관 확인, 수집 예의 규칙) | infra(조사) | — | `docs/01-architecture.md §사이트맵 부록` |
| T2 | **파서 구현 + 골든 픽스처**: 원본 HTML 스냅샷 저장 → 파서(TS) → 정규화 JSON. 평일·토·일 골든 테스트 | game→신규 | T1 | `tools/scraper/**`·`data/raw/*.html`·`tests/scraper/golden/**` |
| T3 | **데이터 스키마·배포 파이프라인**: `data/timetable.json` 스키마 검증 + Actions cron(하루 2회, 변경 시에만 커밋) + Pages 배포 | infra | T2 | `.github/workflows/{scrape,deploy}.yml` |
| T4 | **도메인 규칙**: 다음 출발 계산(요일·공휴일·운행 없음·자정 경계) + 시계 주입 테스트 ≥12 | game→신규 | T2 | `src/domain/**`·`tests/domain/**` |
| T5 | **앱 UI**: 요일 탭 · 노선 표 · **다음 버스 카운트다운** · 신선도 표시 · 출처·비공식 고지 | game→신규 | T2·T4 | `src/adapters/in/web/**` |
| T6 | **캐시 계층**: Service Worker(앱 셸 + 데이터) · IndexedDB · 만료 정책 · **수집 실패 폴백** | game→신규 | T5 | `src/adapters/out/storage/**`·`sw.ts` |
| T7 | **PWA·접근성·다크모드**: manifest·아이콘·전체화면·대비 4.5:1·터치 48px·한/영 | presentation | T5 | `public/manifest.webmanifest`·아이콘·스타일 |
| T8 | **Android 패키징**: Capacitor → `bundleRelease` → 에뮬레이터 스모크 | infra | T6 | `android/**`·스모크 로그 |
| T9 | **iOS 경로 검증**: iOS Safari 실기기/시뮬레이터에서 첫 화면·오프라인·홈화면 추가 동작 | qa | T6 | 스크린샷 3장 |
| T10 | **검수·AC 판정**: AC-1~AC-8 총괄 직접 실행 + 개인정보처리방침·스토어 문구(비공식 고지) | projectcreator | 전부 | `docs/03 §4` 기록 |

## 워커 배정 계획
| 워커 | 담당 |
|---|---|
| `infraprojectcreator` | T1(조사)·T3(Actions/Pages)·T8(Android 패키징) |
| **신규 프로필 `appdev-projectcreator`(가칭)** 또는 `gameprojectcreator` | T2·T4·T5·T6 — *웹/앱 구현*. **신규 크루 창설 여부는 D2 확정 후 판단**(게임 워커 재사용 vs 앱 전용 워커) |
| `gamedev-presentation`(또는 신규 `appdesign`) | T7 — UI·접근성·아이콘 |
| `gamedev-qa`(또는 신규 `app-qa`) | T9·AC 자동 검증 도구 |
| ProjectCreator(총괄) | T10 판정·사용자 보고 |

> **자원 주의**: `meteor-dodge`(출시 단계)와 워커를 공유한다. 동시 진행 시 우선순위를 정해달라 — 추천: **meteor-dodge P4/P5를 먼저 마감**하고 이 프로젝트는 T1(조사)·T2(파서)처럼 **충돌 없는 조사·데이터 작업부터** 착수.

## 발행된 태스크 id (보드 실측 2026-10-05 18:2x, 총괄)
| 단계 | id | 담당 | 상태 |
|---|---|---|---|
| T0 골격 | `t_37cdfc3e` | apiprojectcreator | done |
| T1 사이트 매핑·수집 계약 | `t_59a0eb90` | apiprojectcreator | done |
| T2 파서 + 골든 픽스처 | `t_5ccc5cf5` | apiprojectcreator | done |
| T4 도메인 규칙 | `t_553d9eee` | apiprojectcreator | done |
| T3 배포 파이프라인 | `t_68ff2524` | infraprojectcreator | done |
| T3b scrape.yml 검증 + Pages 데이터 200 | `t_2e071b0c` | infraprojectcreator | done |
| T5 앱 UI | `t_bd643879` | frontendprojectcreator | done |
| **T6 캐시 계층**(SW·IndexedDB·폴백) | `t_3742a01b` | apiprojectcreator | done |
| **T7 PWA·접근성·다크모드** | `t_264692a6` | frontendprojectcreator | done |
| **T8 Android 패키징**(Capacitor·AAB·에뮬 스모크) | `t_3831a022` | infraprojectcreator | done |
| **T9 iOS 경로 검증 도구** + 사람 체크리스트 | `t_8d2ff523` | app-qa | done |
| **T10 P3 게이트 검수**(AC-1~AC-8 총괄 직접 판정) | `t_6c427296` | projectcreator | done — AC-1~AC-6·AC-8 통과 / AC-7 조건부(`docs/03 §7`) |
| **T11 개인정보처리방침 + 스토어 문구**(P3 게이트 미비 보완) | `t_0d8c3f13` | frontendprojectcreator | **done — 총괄 검수 통과**(커밋 `a2c49cb`: 방침 `public/privacy.html` 6,172B + `privacy.css` + `docs/05-store-listing.md` + 테스트 26케이스(총 197) + 푸터 링크 + SW 셸 프리캐시 / a11y 스모크 **46건·실패 0** 총괄 재실행) |

| **T12 간편 UI 재설계(승인 V1)** — 지금 중심 홈 + 오늘 날짜·현재시각 자동 바인딩 | `t_178e58f7` | frontendprojectcreator | **done — 총괄 검수 통과**(커밋 `35fa369`·`8c5fc1a`·`37be52e`·`489acab`) — 시안 정본 `docs/mockups/v1-now-first.html`. 검증: `test` **216 passed** · `v1_smoke` **PASS 35/0**(오늘 실측 대체휴일 배너 · 자정 23:59→00:01 자동 전환) · `a11y` 46/0 · `verify:offline` PASS · domain/docs 0줄 |

| **T13 밝은 톤 + 더 심플한 UI + 결함 정정** | `t_a9b67742` | frontendprojectcreator | **ready(발행)** — 사용자 지시: ① "심플한 UI + 밝은 톤" ② 옵션②(접힌 원본표에서 오늘 요일표 확인·기본 닫힘 유지) ③ 총괄 검증 결함 2건 수정: (A) 운행 없는 날(한글날 10-09)에 `오늘 운행이 끝났습니다` 모순 문구 → 운행없음 문구로 정정 (B) 홈에 노출된 미해석 경고 6줄(`"0:15"` 패턴 미등록·`출발 시각이 없는 회차`) → 소요시간 패턴 등록(도메인 수정 승인) + 홈 1줄·상세는 접힘 |

| **T14 UI 에서 "원본" 노출 제거** — 원본표·원본 링크 8개 삭제·소개문구 정정·외부 요청 0건 강제 | `t_b7bf0e9c` | frontendprojectcreator | **발행(ready/running)** — 사용자 반복 지적("왜 원본을 읽어와?") → 실측: 앱 요청 7건 전부 동일 출처·학교 도메인 0건. UI 잔재(원본표·원본 링크·옛 소개문구) 제거 |
| **T15 배치 v2 인프라** — self-hosted runner(이 맥) + `extract.yml` 하루 2회 + 발행·모니터링 | `t_1633db9b` | infraprojectcreator | **폐기·아카이브(2026-10-06)** — 사용자 결정 변경(self-hosted+로컬 Ollama → 호스티드+외부 API). 러너 스크립트는 대안 문서로 보존 |
| **T16 AI 보강 추출 파이프라인** — 날짜 동적 파라미터 갭 6종 구조화 + 스키마 v2 + 인용검증·폴백 | `t_72e33f3a` | apiprojectcreator | **발행(ready)** — `docs/01` 부록 A 파이프라인/갭표, `docs/00` AC-A1~A4 |
| **T17 스키마 v2 표시** — 다가오는 운행없음/대체 시간표·방향별 소요시간·정차창·방학 안내 | `t_c3375494` | frontendprojectcreator | todo(부모 T16) |

| **T18 🚨 회귀 수정** — 수집 실패 시 캐시 폴백 복구 + 만료 캐시 안내 | `t_74a9348b` | frontendprojectcreator | **완료(done)** — `verify:offline` FAIL 5건(총괄 실측). 수정 후 exit 0 + 회귀 스모크 4종 PASS 필요. **회귀 닫힘**(원인=캐시 스키마 게이트 v1 고정 → 지원목록 v1·v2) — verify:offline PASS·334 tests. **push 대기 중** |

| **T19 AI 계층 API 모드** — OpenAI 호환(`AI_BASE_URL`/`AI_MODEL`/`AI_API_KEY`) + 키 없음·실패 시 규칙 전용 폴백 + 비용 가드·모의서버 테스트 | `t_89869521` | apiprojectcreator | **완료(done)** — API 어댑터+모드 CLI+폴백·비용가드, 363 tests·모의서버 28건(실 과금 0) |
| **T20 extract.yml 호스티드 러너 전환** — `ubuntu-latest` + `secrets.AI_API_KEY` + 변경 시에만 발행 + 아티팩트, self-hosted·Ollama 의존 제거 | `t_8322b6e9` | infraprojectcreator | **완료(done)** — actionlint 0·호스티드 러너·시크릿 env 주입·변경시만 발행·아티팩트. **CI 실측은 push 보류로 미실측** |

| **T21 스키마 v3 (편별 요일 조건 구조화)** — `금(X)` 59행→`excludedDays:["fri"]`·`월~화 2대`→`dayScope`·`0:15`→`durationMinutes`·방학 기간 수집·게이트 목록화 | `t_6e8253fc` | apiprojectcreator | **완료(done)** — v3 발행(금(X) 59/59 매핑·note 잔존 0)·게이트 [1,2,3]·401 tests·스모크 4종 PASS |
| **T22 앱 판정·표시** — `tripStatus`(오늘 운행 편만)·사유 배지·`약 N분 소요`·방학 배너 + 금요일 스크린샷 | `t_88a65081` | frontendprojectcreator | **완료(done)** — 금요일 115→55편(감소 60=미운행 60 일치)·사유 배지·약 N분 소요·450 tests·스모크 PASS |

| **T23 🚨 AI 경로 발행 중단 수정** — 중복 term/dateRules 는 병합·폐기(치명 아님) + 실 DeepSeek 1회 end-to-end 발행 성공 | `t_6801878b` | apiprojectcreator | **발행(ready)** — 총괄이 실 DeepSeek 키로 실행해 발견(중복 term → 치명 → 발행 중단). 환각 폐기·발행중단은 정상 작동 확인 |
| **T24 모바일 앱 셸·스플래시** — 스플래시·하단 탭(지금/전체)·스켈레톤·앱바·safe-area + 화면 분리 | `t_fc242158` | frontendprojectcreator | **완료(done)** — t24_smoke 28/0·479 tests·build 성공(스플래시 412ms·가로 스크롤 0) |
| **T25 네이티브 스플래시·아이콘 정합** — Capacitor 스플래시/상태바/아이콘 + AAB 재빌드·서명검증·에뮬 스모크 | `t_f5832339` | infraprojectcreator | todo(부모 T24) |

| **T26 AI 초안 수용 규칙 강화** — 노선 폐지는 dateRule 금지(routes.status+routeNotes)·전노선 scope 근거 강제·`dayTypes:[]` 금지·기존 표현 중복 폐기·검증기 반영 | `t_68a7bf57` | apiprojectcreator | **완료(done)** — 노선폐지→routeNotes 이관·scope/dayTypes 규칙·발행본 정정(dateRules 9)·496 tests·실DeepSeek exit 0 |

## 상태
- 현재: **T0~T11 완료 + T12(간편 UI) 발행** (2026-10-05) — P3 게이트 AC-1~AC-6·AC-8 통과·AC-7 조건부(iOS 실기기=사람 게이트). T12 는 사용자 지시(원본 미러링 탈피·실시간 바인딩)로 발행.
- **배포 주의**: 최신 배포본은 T5 시점(run `37270216029`, 커밋 `0ab0501`) — T6~T9(오프라인·PWA·접근성)는 **아직 미배포**. `main` 은 origin 보다 **12커밋 앞**이며 push(=배포 트리거)는 **사용자 승인 사안**.
- 워커 배정은 `frontendprojectcreator`(표현 계층)·`app-qa`(자동 검증)·`infraprojectcreator`(배포/Android)·`apiprojectcreator`(앱 코어·캐시) 로 확정(위 표가 정본 — 이전 "가칭 프로필" 계획은 폐기)
- 남은 결정: **① main 14커밋 push(=Pages 배포) 승인 여부 ② Play 스토어 제출 시점**(계정은 기존 것 사용 — 단 현재 서명이 debug 키라 업로드 키 발급 필요). 사람 게이트 = ① **실기기 iOS 확인**(`scripts/qa/iOS-CHECKLIST.md` 19항목) ② Play 업로드 키 발급 — T11(방침)은 총괄 검수 통과로 종료
- 소유: **ProjectCreator(이 프로필) 소관** — `~/.hermes/profiles/projectcreator/PROJECTS.md` 등록부에 `소유=나` 로 기록(2026-10-05 사용자 확인)
