# 세션 인수인계 — sunmoon-shuttle (2026-10-05 첫 세션)

작성: ProjectCreator(총괄) · 다음 세션은 `docs/` 5종 → 이 문서 순서로 읽는다.

## 1. 이 프로젝트가 무엇인가
선문대학교 **셔틀버스 시간표 앱 재작성**. 기존 `angalle/SM.Univ-Bus-Schedule`(2017, Java Android, 옛 GCM 서버 의존, 커밋된 APK·`google-services.json`)를 **iOS·Android·웹 공용 PWA**로 새로 만든다. **운영비 0원**(서버·DB 없음), **오프라인 우선**.

- 저장소: **https://github.com/angalle/sunmoon-shuttle** (public — Pages 무료 조건)
- 보드: **`sunmoon-shuttle`** (프로젝트 홈 = `~/Documents/github/sunmoon-shuttle`)
- 커밋: `c104735`(계획 5종) · `e9d1184`(원본 스냅샷) · `50e7d28`(결정 확정 기록)

## 2. 이번 세션에 확정한 결정 (사용자 "진행해" = 추천안 채택)
| # | 결정 | 확정 |
|---|---|---|
| D1 | 저장소 | **새 저장소 `sunmoon-shuttle`**(public) + 기존 저장소는 archived·키 폐기(사용자 조치) |
| D2 | 스택 | **Vite + TypeScript + PWA + Capacitor** (RN/Flutter 아님) |
| D3 | iOS | **PWA 먼저**(무료·즉시) · Xcode 설치 시 로컬 빌드 · App Store($99/년)는 후순위 |
| D4 | 수집 범위 | **셔틀버스 5개 노선**(아산KTX 42회차·천안역 34행·천안터미널·온양역/터미널·천안캠퍼스) × 요일 3종 |
| D5 | 갱신 | **수동 스냅샷**(학기 개편 시 1회) — **자동 크롤 없음** |
| D6 | 기존 저장소 | 키 폐기 + archived (아래 §5 사용자 조치) |
| D7 | robots 대응 | 수동 스냅샷 + (여유 시) 학교에 이용 허락 문의 — **자동 크롤 강행 금지** |

## 3. ⚠️ 이 프로젝트의 핵심 제약 (반드시 지킬 것)
`https://lily.sunmoon.ac.kr/robots.txt` → **`Disallow: /Page`** (접두사 규칙이라 **`/Page2/…` 포함 차단**).
→ **정기 자동 수집 금지.** 정본 경로 = **사람이 저장한 HTML 스냅샷을 `data/raw/` 에 커밋 → `npm run scrape -- --local` → JSON → 앱 반영**.
→ 이미 **1회 반입 완료**: `data/raw/2026-2학기-<노선>-요일혼합.html` 5종(621KB) + `data/raw/README.md`(출처·UA·간격). **변조 금지**(파서의 기준).

## 4. 발행한 태스크 (마감 시점 상태)
| 카드 | 담당 | 상태 | 내용 |
|---|---|---|---|
| `t_37cdfc3e` T0 골격 | apiprojectcreator | ● running | Vite+TS+vitest·헥사고날 디렉터리·**경계 검사**(domain 에 fetch/document 0)·npm 스크립트 계약(`dev/build/preview/test/scrape/lint:boundary`) |
| `t_59a0eb90` T1 사이트 매핑 | apiprojectcreator | ● running | 노선 5종 페이지 구조·**요일 전환 방식**·**수동 스냅샷 절차** 확정 |
| `t_5ccc5cf5` T2 파서+골든 | apiprojectcreator | ◻ 게이트(T0) | 스냅샷 → 계약 JSON · 결정성 · **실패경로 자체검증** |
| `t_553d9eee` T4 도메인 규칙 | apiprojectcreator | ◻ 게이트(T0) | 요일·운행여부·**다음 출발 계산** + 경계 테스트 ≥12 |
| `t_68ff2524` T3 배포 파이프라인 | infraprojectcreator | ▶ ready/● | GitHub Pages + **수동 워크플로(`workflow_dispatch`, cron 금지)** + 모니터링·**비용 0 실측** |

**미발행(계획에만 있음)**: T5 UI(frontendprojectcreator) · T6 캐시(SW+IndexedDB) · T7 PWA·접근성 · T8 Android 패키징(infra) · T9 iOS/PWA 검증(**app-qa**) · T10 총괄 AC 판정 — 각각 앞 단계 완료 후 발행.

## 5. 사용자 조치 (다음 세션에서 확인할 것)
1. **기존 저장소 정리**: `angalle/SM.Univ-Bus-Schedule` → **archived** + 노출된 `app/google-services.json`(Firebase 키, 1,097B) **폐기**. (총괄이 archive 는 실행 가능 — 사용자 한마디만)
2. 시간표 개편(다음 학기) 시 **원본 페이지를 브라우저로 저장**해 이 저장소 `data/raw/` 에 반입(또는 총괄에게 전달)
3. (선택) 학교 **학생지원팀 041-530-2152** 에 데이터 이용 허락 문의 — 허락 시 자동 수집으로 전환 가능

## 6. 다음 세션이 할 일
1. T0/T1 완료 검수 → T2/T4 게이트 해제 확인 → T3(Pages URL 200) 검수
2. T2 완료 후 **골든 검증을 `app-qa` 에 배정**(T9 아님, 검증 독립성): 파서 골든·스키마 검증·실패경로 재현을 `app-qa` 도구로 한 번 더 돌린다
3. T5~T7 발행(`frontendprojectcreator`) → T8(infra) → T9(app-qa) → **T10 총괄 AC 8개 판정**(`docs/03 §1` 표)
4. 검수 시 `docs/03 §6` 체크리스트: 커밋 귀속·범위, 테스트 직접 실행, 픽스처가 **원본**인지, 오프라인 스크린샷 육안, 비용·개인정보 실측

## 7. 환경·크루
- 워커: `apiprojectcreator`(파서·도메인) · `infraprojectcreator`(Pages/CI·Android) · `frontendprojectcreator`(UI·캐시·PWA) · **`app-qa`(신규 생성 — 앱 검증 전용, SOUL = `~/.hermes/profiles/app-qa/SOUL.md`)**
- 총괄 SOUL 워커 표에 `frontendprojectcreator`·`app-qa` 행을 **추가 완료**
- 프로젝트는 `meteor-dodge`(출시 단계)와 워커 자원을 공유한다 — **동시 실행 시 우선순위 조정 필요**
