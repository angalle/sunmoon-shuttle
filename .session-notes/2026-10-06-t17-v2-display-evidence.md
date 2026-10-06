# T17 증거 — 스키마 v2 표시(다가오는 운행 변동 · 방향별 소요시간 · 정차창 · 방학)

작업: 칸반 `t_c3375494` / 2026-10-06 (KST) / 프로젝트 홈 `~/Documents/github/sunmoon-shuttle`
범위: **표시 계층만**. `src/domain/**` 0줄 · `docs/**` 0줄 · `package.json` 무변경 · 신규 의존성 0.

## 0. 데이터 정본 무손상 확인

```
$ sha256sum data/timetable.json
ba399a91712266d012970896ef55edff3d698cdf7f12dbb677e4347995f36855  data/timetable.json
```

T16 핸드오프가 발행한 계약 그대로다(동일 해시). T17 은 이 파일을 **읽기만** 했다.

## 1. 신규 테스트 — `tests/adapters/in/web/v2Display.test.ts` (27건)

```
$ npm run test
 Test Files  25 passed (25)
      Tests  330 passed (330)      # T16 시점 303 + 신규 27
   Duration  643ms
```

수용 기준 1 이 요구한 항목별 대응(모두 실측 PASS):

| 요구 | 테스트 |
|---|---|
| 다가오는 규칙 필터(14일 창) | `오늘 이후 14일 내 규칙만 가까운 순서로 2줄 뽑는다` · `창 밖(10-28)과 지난 규칙(9월)은 넣지 않는다` |
| 창 경계 | `창 경계: 10-27 기준이면 10-28 개교기념일이 1줄로 올라온다` |
| 오늘 규칙 중복 제거 | `오늘이 포함된 규칙은 뺀다 — 상단 배너와 중복해서 말하지 않는다` |
| tripNotes 없을 때 미표시 | `v1 데이터(tripNotes 없음)는 소요시간 문구가 하나도 없다` · `조건부 소요시간만 있는 노선은 표시하지 않는다` |
| stopWindows 없을 때 미표시 | `v1 데이터에는 stopWindows 가 없어 빈 결과다` |
| terms 없을 때 미표시 | `v1 데이터에는 terms 가 없어 방학 배너가 뜨지 않는다` |
| v1 데이터만 있어도 렌더 | 위 3건 + `깨진 v2 항목은 그 항목만 버리고 나머지 v1 렌더는 살린다` |
| 표기 이름은 데이터에서만 | `표기 이름은 원문 인용에서만 뽑는다(하드코딩 없음 · 못 뽑으면 null)` |
| needsReview 비노출 | `needsReview 항목과 표시 대상이 아닌 kind 는 화면 값에 들어가지 않는다` · `needsReview 인 tripNote 는 쓰지 않는다` · `needsReview 정차 창은 노출하지 않는다` |
| 실제 발행물 | `T17 실제 계약 데이터(data/timetable.json v2) 실측` 5건 |

## 2. 실측 스모크 — 실제 DOM (신규 `scripts/v2_smoke.mjs`, 의존성 0 · 헤드리스 Chrome CDP)

```
$ npm run build && node scripts/v2_smoke.mjs
  PASS  ① 평일 2026-10-06 09:00: 다가오는 운행 변동 줄 = ["10월 9일 (금) 한글날 — 운행 없음"]
  PASS  ① …: 정차 창 접힘 1개(원문 표기) — ["학생회관 승강장 (학기 중): 13:30~15:30 · 19:30~막차까지"]
  PASS  ① …: 목록 행에 소요시간 보조 문구(약 N분 소요) — ["학교로 도착 · 09:20 도착 · 약 15분 소요", …]
  PASS  ② 토요일 2026-10-10 09:00: 배너 표시 여부(줄 0건이면 배너 없음) — present=false
  PASS  ③ 일요일 2026-10-11 09:00: 배너 표시 여부(줄 0건이면 배너 없음) — present=false
  PASS  ④ 한글날 2026-10-09 09:00: 오늘 규칙은 상단 배너(resolveDayService)가 담당 — kind=no-service text=오늘 셔틀버스 운행이 없습니다사유: 한글날: 셔틀버스 운행 없음
  PASS  ⑤ 개교기념일 2026-10-28 09:00: 오늘 규칙은 상단 배너(resolveDayService)가 담당 — kind=no-service text=…사유: 개교기념일: 셔틀버스 운행 없음
  PASS  ① ~ ⑤: 방학 배너 없음(기간 미상·needsReview)
  PASS  ① ~ ⑤: T14 계약 유지(원본 0회 · 학교 링크 ≤1) — innerText=0 textContent=0 links=1
  PASS  ⑦ 실제 오늘 상태줄이 실제 KST 날짜와 일치(10월 6일) — 10월 6일 (화) 09:03
  PASS  ⑥ 모든 리소스 요청이 단일 출처(로컬 서버)다 — origins=["http://127.0.0.1:49761"] requests=43
  PASS  ⑥ 학교 도메인 요청 0건 — []
  PASS  ⑥ 콘솔 오류 0

V2 SMOKE: PASS   (PASS 47건 · 실패 0)
```

스크린샷(요구 3·4 — 각 1장, 뷰포트 390×844 라이트 고정):

- `.session-notes/T17-1-평일-다가오는변동.png` (평일 — 규칙 안내 배너가 보이는 날)
- `.session-notes/T17-2-토요일.png`
- `.session-notes/T17-3-일요일.png`
- `.session-notes/T17-4-한글날-오늘규칙.png` (오늘 규칙 → 상단 배너)
- `.session-notes/T17-5-개교기념일-오늘규칙.png` (`?now=` 로 10-28 개교기념일)
- `.session-notes/T17-6-오늘-실측.png` (주입 없음 — 상태줄이 실제 KST 날짜와 일치)

원출력 로그: `.session-notes/t17/v2-smoke.log`

## 3. v1 JSON 하위호환 실측 (요구 2)

`data/timetable.json` 에서 v2 키(`dateRules`·`terms`·`routes[].tripNotes`·`stopWindows`)를 제거하고
`schemaVersion: 1` 로 낮춘 파일을 만들어 **실제로 렌더**했다(원본 파일은 sha256 대조 후 즉시 복원).

```
$ cp .session-notes/t17/timetable-v1.json data/timetable.json && node scripts/v1_smoke.mjs
V1 SMOKE: PASS            # exit 0 — v1 파일로 정상 렌더

$ node scripts/v2_smoke.mjs     # 같은 v1 파일, v2 요소는 전부 조용히 숨김(크래시 0)
  INFO  ① …: clock=10월 6일 (화) 09:00 · upcoming=[] · stop=[] · duration=["학교로 도착 · 09:20 도착", …]
  INFO  ⑦ 실제 오늘: clock=10월 6일 (화) 09:03 · upcoming=[] · notice=null
```

= v1 파일에서는 새 배너·정차창·소요시간이 **아예 그려지지 않고** 기존 화면은 그대로다.
(v2 전용 기대값을 가진 v2_smoke 는 이 입력에서 의도적으로 exit 1 — 그게 하위호환의 증거다.)

## 4. T14 계약 회귀 없음

```
$ node scripts/v1_smoke.mjs
V1 SMOKE: PASS            # ①~⑫ 전부 PASS, 요청 출처 단일 · 학교 도메인 0건 · 콘솔 오류 0
$ node scripts/a11y_smoke.mjs
검사 46건 · 실패 0건      # [light] 대비 미달 0건(텍스트 171개) · 터치 타깃 ≥48×48(14개) · 수평 스크롤 없음
A11Y SMOKE: PASS
$ npm run build
✓ built in 23ms           # tsc --noEmit 통과
$ npm run lint:boundary
PASS [경계①/domain 순수성] … 0건
PASS [경계②/application→adapters] … 0건
BOUNDARY: PASS (위반 0건)
```

`npm run verify:offline` 은 **실패(exit 1, 5건)** 인데 **T17 회귀가 아니다** — T17 변경을 `git stash` 로
되돌린 baseline 에서도 **같은 5건이 동일하게** 실패한다(IndexedDB 캐시 폴백 계열, 표시 계층과 무관):

```
(baseline, T17 stash 후)                          (T17 적용 후)
FAIL 수집 실패: 마지막 정상 데이터 표시 … listStatus=loading   FAIL 수집 실패: 마지막 정상 데이터 표시 … listStatus=loading
FAIL 수집 실패: 캐시 폴백 안내를 문구로 표시 — null            FAIL 수집 실패: 캐시 폴백 안내를 문구로 표시 — null
FAIL 수집 실패: 오류 UI(F8)로 가지 않는다 — 데이터가 있으므로   FAIL 수집 실패: 오류 UI(F8)로 가지 않는다 — 데이터가 있으므로
FAIL 수집 실패: 앱이 낸 콘솔 오류 0 (AC-5) — TimetableDataError: 네트워크 요청 실패   FAIL (동일)
FAIL 만료 캐시도 유지하고 "24시간 초과"를 알린다 — null          FAIL 만료 캐시도 유지하고 "24시간 초과"를 알린다 — null
```

로그: `.session-notes/t17/offline-with-t17.log` (T17 적용 상태)

## 5. 구조 규칙 자기검사(grep 원문)

```
① shared/ → features/ 참조 0건
$ grep -rn "from ['\"].*features/" src/adapters/in/web/shared/ | wc -l
0
② atoms 에 store·api 참조 0건 (남은 1건은 Badge.ts 의 **주석**, 변경 전부터 있던 줄)
$ grep -rnE "store|/api/" src/adapters/in/web/shared/ui/atoms/
src/adapters/in/web/shared/ui/atoms/Badge.ts:3: * 단일 책임 시각 요소 — props 로만 제어하고 도메인 상태·store·api 를 모른다(스킬 §2·§3).
$ git diff --stat -- src/adapters/in/web/shared/ui/atoms/     # (빈 출력 = 무변경)
③ 하드코딩 색상 0건 (tokens.css 제외)
$ grep -rnE "#[0-9a-fA-F]{3,8}\b" src/adapters/in/web --include=*.css | grep -v "styles/tokens.css" | wc -l
0
④ !important 0건
$ grep -rn "!important" src/adapters/in/web | wc -l
0
⑤ src/domain · docs · package.json 변경 0
$ git diff --stat -- src/domain docs package.json package-lock.json     # (빈 출력)
```

## 6. 판단·설계 결정(다르게 구현한 부분과 근거)

1. **오늘 규칙의 우선순위**: 오늘 운행 변동은 기존 상단 배너(`resolveDayService`, 안내문 기반)가 단독으로
   말하고, `dateRules` 기반 "다가오는 변동" 목록은 **오늘이 포함된 규칙을 제외**한다(같은 날 두 번 말하지 않음).
   지시 ② 의 "중복 없이 1줄로 통합"을 이렇게 구현했다(문구 우선순위 = 배너 > dateRules).
2. **표기 이름(`한글날`)** 은 새 필드가 없어 **원문 인용(`sourceQuote`)의 대괄호 앞부분**에서만 뽑는다
   (`dateRuleLabel`, 못 뽑으면 null → 날짜+상태만 표시). 하드코딩·추측 없음.
3. **조건부 소요시간은 표시하지 않는다**: `tripNotes[]` 중 `conditions` 가 있는 것(`교통정체`·`이외 시간`)은
   어느 값이 적용되는지 시각창 해석이 필요해, 앱이 고르지 않는다(판정 로직 신규 작성 금지).
4. **방학 배너 링크와 학교 링크 ≤1**: `terms[].timetableSource` 링크를 그릴 때는 푸터 대표 링크를 접어
   화면의 학교 링크를 1개로 유지한다(`sourceFooter({hideSourceLink})`). T14 계약(3개 스모크가 강제)과
   지시 ⑤(소스 링크)를 동시에 만족시키기 위한 선택이다.
5. **v2 배열은 관용적으로 읽는다**: 키가 없거나 깨진 항목은 그 항목만 버린다(v1 계약은 그대로 엄격).
   표시 보조 데이터 때문에 홈 전체가 죽지 않게 하기 위함(AC-5).

## 7. 남은 한계

- 실제 데이터의 방학 `terms` 는 **기간 미상 + needsReview** 라 방학 배너는 어떤 날짜에도 뜨지 않는다
  (링크/배너 경로는 픽스처 테스트로만 검증됨 — 실측 스모크는 "배너 없음"만 확인).
- `dateRules` 의 `route-change`·`stop-time-window`·`period-meaning` kind 는 이번 화면에 노출하지 않았다
  (지시 ①이 `no-service`·`alternate-schedule` 만 요구).
- `npm run verify:offline` 은 위 4절대로 **T17 이전부터 실패** 상태다(이 태스크 범위 밖).
