# 데이터 계약 설계 — 셔틀 스케줄 JSON (v3)

> 작성: ProjectCreator(총괄) · 2026-10-06 · 상태: **승인된 설계(구현 대기)**
> 이 문서가 **계약**이다. 배치(추출기)와 앱(UI)은 이 문서를 기준으로 구현한다. 문서와 코드가 어긋나면 **문서를 먼저** 고친다.

## 0. 왜 다시 설계하는가 (문제 정의)

현행 v2 는 "원본 표를 최대한 보존"하는 데 집중했다. 그 결과:

- 편별 조건이 **문자열로 남아 있다** — 실측 64행: `금(X)` **59행**, `월~화 2대 운행` 1행, `월~목 2대 운행` 1행, `중간노선 전용`/`중간노선전용` 각 1행, `0:15` 1행.
- 그래서 앱은 **금요일에 운행하지 않는 편을 금요일에도 보여준다**(판정 불가). "왜 이 편이 안 뜨는지" 설명할 근거도 없다.
- 날짜 기반(공휴일·연휴)은 구조화되어 있으나, **요일 기반 조건은 구조가 없다**.

**설계 원칙(사용자 지시)**: ① 중간 JSON 구조에 **설계**가 있어야 한다 ② **화면에서 무엇을 보여줄지 먼저 정하고**, 그 질문에 답할 필드를 정의한다(표현 우선 설계) ③ 원문은 언제나 `sourceQuote` 로 보존한다.

## 1. 화면이 답해야 하는 질문 (UI 계약 — 이것이 설계의 출발점)

| # | 화면에서 답할 질문 | 화면 위치 | 필요한 데이터 | 현행 v2 |
|---|---|---|---|---|
| Q1 | 지금 탈 수 있는 편이 있나? | 홈 히어로/다음 출발 | **오늘 기준 편별 운행여부** | ❌ (요일 조건 미판정) |
| Q2 | 오늘 운행이 아예 없나? | 상단 배너 | `dateRules(kind=no-service)` | ✅ |
| Q3 | 이 편이 오늘 왜 안 뜨나(왜 다른가)? | 편 배지·보조문구 | **편별 사유 코드 + 라벨** | ❌ |
| Q4 | 이 편은 몇 분 걸리나? | 도착 옆 보조문구 | `durationMinutes` | ⚠️ `"0:15"` 문자열 일부 |
| Q5 | 주말·휴일엔 어떻게 되나? | 안내(접힘) | 주말 버킷 + `period-meaning` | ✅ |
| Q6 | 학기·방학은 언제인가? | 배너 | `terms[]` | ⚠️ 방학 기간 `null` |
| Q7 | 언제 정차 가능한가? | 이용 안내(접힘) | `stopWindows` | ✅ |
| Q8 | 앞으로 운행 변동이 있나? | 다가오는 운행 변동 | `dateRules` 14일 창 | ✅ |

**즉 Q1·Q3·Q4·Q6 이 미달**이고, 이 문서의 목표는 그 4개를 닫는 것이다.

## 2. 판정 규칙 — 단일 책임·우선순위 (앱 도메인이 이 순서로만 판정한다)

```
tripStatus(trip, date) → { runs: boolean, reason: ReasonCode, label: string, sourceQuote: string }

1) 날짜 규칙 (dateRules, start ≤ date ≤ end(없으면 start 당일))
   - no-service            → runs=false, reason=holiday-no-service
   - alternate-schedule    → runs=true,  reason=holiday-alternate, 운행 기준 버킷을 effect.timetable 로 대체
2) 편별 요일 조건 (trip.service)
   - excludedDays 에 date 의 요일 포함 → runs=false, reason=weekday-excluded
   - dayScope 이 있고 요일 미포함        → runs=false, reason=day-scope
   - dayScope 포함                        → runs=true,  reason=day-scope(vehicleCount 라벨)
3) 기본 (byDay[오늘 버킷].trips 포함 여부) → runs=true, reason=normal
```

`ReasonCode`(enum, UI 문구를 코드에서 만든다 — 문자열 하드코딩 금지):
`normal` · `holiday-no-service` · `holiday-alternate` · `weekday-excluded` · `day-scope` · `vacation-timetable` · `unknown-note`(needsReview)

## 3. 스키마 v3 — 변경분만 (나머지 필드는 v2 그대로)

```jsonc
{
  "schemaVersion": 3,

  "dayTypes": ["weekday", "saturday", "sunday"],   // 유지 — 원본 표의 3버킷

  "routes": [{
    "id": "asan-ktx", "name": "아산(KTX)역", "path": "…", "status": "active",
    "byDay": {
      "weekday":  { "trips": [
        { "seq": 2, "depCampus": null, "depStation": "08:35", "arrCampus": "08:50",
          "service": {                       // ★ 신규 — 편별 조건(구조). 원문 note 가 있는 행에만 붙는다
            "excludedDays": ["fri"],         //   "금(X)"  → 매주 금요일 미운행
            "dayScope": null,                //   "월~화 2대 운행" → ["mon","tue"]
            "vehicleCount": null,            //   2 (dayScope 와 함께)
            "label": null,                   //   "중간노선 전용" 등 표기 통일본
            "sourceQuote": "금(X)"           //   ★ 원문 note **그대로**(필수, 표기 변형 금지)
          },
          "durationMinutes": null,           //   "0:15" → 15 (원문 note 가 소요시간이면 여기)
          "note": null,                      //   구조화된 항목은 note 비움(중복 표현 금지)
          "needsReview": false               //   미해석일 때만 true
        }
      ]},
      "saturday": { "trips": [] }, "sunday": { "trips": [] }
    },
    "tripNotes":   [ { "kind": "duration", "minutes": 15, "scope": "...", "sourceQuote": "…" } ],
    "stopWindows": [ { "location": "학생회관 승강장", "term": "학기 중",
                       "windows": [{"start":"13:30","end":"15:30"},{"start":"19:30","end":null}],
                       "limit": "막차까지", "sourceQuote": "…" } ]
  }],

  "dateRules": [ /* v2 그대로 — kind/start/end/dayTypes/scope/effect/sourceQuote/… */ ],

  "terms": [ /* semester 는 기간 포함. vacation 은 periodSearch 로 기간 출처를 남긴다(아래) */
    { "kind": "vacation", "label": "방학", "start": null, "end": null,
      "periodSearch": {                    // ★ 신규 — 기간을 어디서 찾았고 결과가 무엇인가
        "file": "data/raw/terms/2026-2학기-방학.html",   // 스냅샷 파일(기간 문구를 찾은/못 찾은 페이지)
        "result": "not-found",             //   "found" | "not-found" | "not-provided"(스냅샷 미포함)
        "evidenceQuote": "현재는 2026-2학기 시간표로 운행되고 있습니다."  // 판정 근거 문장(원문 부분문자열)
      } }
  ],

  "extraction": {                    // ★ T19 실행 메타 + 스키마 버전
    "provider": "api|ollama|rule-only", "model": "…", "calls": 0,
    "truncated": false, "fallbackReason": null,
    "schemaVersion": 3, "termSources": ["data/raw/terms/2026-2학기-방학.html"]
  }
}
```

**v1/v2 보존 범위(정정)**: v3 는 `routes[].byDay[*].trips[]` 행을 **원문 note 가 있는 행에 한해** 바꾼다
(`note` 비움 + `service`/`durationMinutes`/`unknownNote`/`needsReview` 추가). 시각·순번·열(`columns`)·행 수는
**값까지 그대로**여야 하며, 검증기가 그 불변식을 강제한다(`note`·조건 필드는 비교에서 제외).
원문 note 가 없던 행은 **v1 그대로**다 — `note: null` 을 새로 넣지 않고 키 자체가 없다(빈값 = 키 없음).
`note` 는 **원문 note 가 있던 행에서만** 구조화 결과에 따라 `null`(구조화) 또는 원문 문자열(미해석)이 된다.

**미해석 표기 보존**: 표에 없는 표기는 버리지 않는다 → `service: null`, `note` 유지(원문),
`unknownNote: "원문"`(= note 와 같은 문자열), `needsReview: true`.

**표기 정규화 사전**(추출기가 이 표대로만 변환, 표에 없으면 버리지 않고 `needsReview` + `unknownNote`)
| 원문 표기 | 변환 | 실측 건수(2026-10-06) |
|---|---|---|
| `금(X)` · `금X` · `금요일 없음` | `excludedDays: ["fri"]` | 59 |
| `월~화 2대 운행` | `dayScope: ["mon","tue"]`, `vehicleCount: 2` | 1 |
| `월~목 2대 운행` | `dayScope: ["mon","tue","wed","thu"]`, `vehicleCount: 2` | 1 |
| `0:15` (소요시간 주석) | `durationMinutes: 15` | 1 |
| `중간노선 전용` / `중간노선전용` | `label: "중간노선 전용"`(공백 표기 통일, `sourceQuote` 는 원문) | 2 |
| 그 외 미해석 | `service: null`, `note` 유지 + `unknownNote` + `needsReview: true` | 0 |

**방학 기간 스냅샷**: 원본 방학 시간표 페이지(`About08_04_03_01_01.aspx`)는 `data/raw/terms/*.html` 규약으로
반입한다(파일명이 `<학기>-<노선>-<요일>` 규약 밖이라 `data/raw/` 바로 아래가 아니라 `terms/` 하위에 둔다 —
노선 파서가 잘못 집어가지 않게). 실제로 2026-10-06 에 1회 반입해 확인한 결과 **본문에 기간 문구가 없다**
("현재는 2026-2학기 시간표로 운행되고 있습니다") → `start/end = null` 유지 + `periodSearch.result = "not-found"`
`+ evidenceQuote`(근거 문장) 기록. 추측 금지.

## 4. 버전·호환 전략 (지난 회귀를 반복하지 않기 위한 필수 조건)

지난 사고: T16 이 데이터를 v2 로 올렸는데 **앱 캐시 게이트가 v1 만 통과**시켜 폴백이 전면 붕괴했다. 대책을 계약으로 못 박는다.

- `schemaVersion: 3` · **소비자 게이트는 지원 목록(`[1,2,3]`)** 으로만 판정(단일 상수 금지)
  - 게이트 위치: `src/adapters/in/web/features/schedule/api/timetableApi.ts` 의 `SUPPORTED_SCHEMA_VERSIONS`
  - **RED 실증**: `tests/extract/consumer-gate.test.ts` 가 *발행물*(`data/timetable.json`)의 `schemaVersion` 이
    게이트 목록에 있는지 검사한다 → 스키마를 범프하고 게이트를 안 넓히면 그 테스트가 즉시 RED 다(T16·T18 사고 재발 방지)
- 신규 필드가 없는 데이터(v1/v2)도 **그대로 렌더**되어야 한다(조건 없음 = 기본 동작)
- **미지원 버전 테스트**(스키마 범프 시 RED) 를 테스트에 포함 — 목록 밖 버전 캐시는 버린다
- 데이터 발행 태스크의 수용기준에 **소비자 스모크 재실행**(`verify:offline` · `v1_smoke` · `v2_smoke` · `a11y`) 을 포함

## 5. 화면 표시 규칙 (T22 계약 — 이게 "뭘 보여줄지"의 답)

1. **목록·히어로는 오늘 실제 운행하는 편만** 기본 표시(`tripStatus.runs === true`).
2. **사유 배지**: 운행하지 않는 편/조건이 있는 편에는 문구 배지
   - `금요일 운행 없음`(오늘이 금요일이면 그 편은 목록에서 사라지고, 다른 편에 사유가 있으면 배지로 남긴다)
   - `월·화만 운행` · `2대 운행` · `중간노선 전용`
3. **소요시간**: `약 15분 소요`(값이 있을 때만, 도착 옆 보조문구)
4. **오늘 안내**: `오늘은 운행이 없습니다 · 다음 운행: …`(날짜 규칙) + 대체 시간표 안내(예: 개천절대체휴일 → 일요일 시간표)
5. **방학**: 기간이 채워지면 `방학 기간입니다 (M.D~M.D) — 방학 시간표` 배너. 미채움이면 미표시(추측 금지).
6. **금지**: 화면 텍스트에 `원본` 노출 0회 · 학교 링크 1개 이하 · `needsReview` 내부 플래그는 화면 미노출.

## 6. 수용 기준 (AC — 증거로만 판정)

**배치 측(T21 — 발행물 `data/timetable.json` + `tools/extract`)**

| # | 기준 | 증거 명령/산출 |
|---|---|---|
| **AC-D1** | `금(X)` 59행 → `excludedDays:["fri"]` **100% 매핑**(원문 대조 카운트 일치) · `note` 에 `금(X)` 잔존 0 · 잔여 미해석은 `needsReview` | `npm run test` + `./node_modules/.bin/tsx tools/extract/verify.ts` (파서 카운트 vs 발행물 카운트 표) |
| **AC-D2** | 원문 인용률 100% — 신규 항목(`service.sourceQuote`·`unknownNote`·`periodSearch.evidenceQuote`) 누락 0, 전부 원본 부분문자열 | `verify.ts`(인용 대조 표) + 검증기 fatal 0 |
| **AC-D3** | `npm run test` 0 fail — 신규 ≥15(정규화 사전 각 항목 · 미해석 보존 · v1/v2 하위호환 · 미지원 버전 게이트) | `npm run test` |
| **AC-D4** | **v2·v1 데이터로도 렌더**(스모크 각 1회) + **v3 발행본**으로 `v2_smoke`/`v1_smoke`/`verify:offline`/`a11y` PASS | `node scripts/v1_smoke.mjs` 등 4종 |
| **AC-D5** | `--inject-fabricated` → exit 1 유지 · `--ai=off` 경로 회귀 없음 | 실행 로그 |
| **AC-D6** | `npm run build`·`lint:boundary` PASS · `src/domain` 0줄(변경 없음) · 신규 의존성 0 | 실행 출력 |

**앱 측(T22)**

- **AC-D7** `tripStatus` 단위 테스트: 금요일/월요일/토/일/공휴일(한글날)/대체휴일(개천절) 각 케이스 + `dayScope` 케이스
- **AC-D8** 금요일 조건이 실제 화면에서 사라짐(금요일 주입 스크린샷) + 사유 배지 + `약 N분 소요` 표시

## 7. 태스크 매핑

| 태스크 | 담당 | 내용 |
|---|---|---|
| **T21** | apiprojectcreator | 배치 측: `금(X)`·`월~화`·`0:15`·`중간노선 전용` 구조화 + 방학 기간 수집 + 스키마 v3 + 게이트 목록화 + AC-D1~D6 증거 — **완료(2026-10-06)** |
| **T22** | frontendprojectcreator | 앱 측: `tripStatus` 도메인 판정 + 사유 배지·오늘만 필터·소요시간 + 방학 배너 + AC-D7·D8 증거 (T21 완료 후) |

## 8. 실행 방법 (T21 산출물 재현)

```bash
npm run test                       # 단위·파이프라인·게이트 테스트
npm run build && npm run lint:boundary
# 발행(규칙 전용, AI 호출 0): data/raw/*.html + data/raw/terms/*.html → data/timetable.json
npm run extract -- --ai=off
# 계약 실측 검증(파서 카운트 vs 발행물 카운트 · 인용률 · 방학 기간 결과)
./node_modules/.bin/tsx tools/extract/verify.ts
# 소비자 스모크(v3 데이터로 앱이 렌더되는지)
node scripts/v1_smoke.mjs && node scripts/v2_smoke.mjs && npm run verify:offline && node scripts/a11y_smoke.mjs
```

`--term-page <경로>`(반복 가능)로 방학 시간표 스냅샷을 명시할 수 있다. 생략하면 `data/raw/terms/*.html` 를 자동으로 쓴다.
