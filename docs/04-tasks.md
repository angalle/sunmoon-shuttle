# 04 — 태스크 보드 (선문대 셔틀버스 시간표 앱)

작성: ProjectCreator(총괄) · 2026-10-05 · 보드 slug: **`sunmoon-shuttle`** (생성 예정 — 결정 확정 후)

## 결정 대기 (사용자) — 이것이 정해져야 태스크를 발행한다
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

## 상태
- 현재: **계획 확정 대기**(D1~D6) · 문서 5종 작성 완료 · 보드 미생성
