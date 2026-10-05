# T16 증거 — AI 보강 추출 파이프라인 (스키마 v2)

작성: apiprojectcreator · 2026-10-06
정본: `docs/01-architecture.md` 부록 A · `docs/00-requirements.md` 부록 A(AC-A1~A4) · `docs/02-monitoring.md` 부록 A

## 0. 산출물

| 경로 | 내용 |
|---|---|
| `tools/extract/**` | 추출기(AI 보강) — 후보 수집 · 규칙 구조화 · AI 병합 · 검증 · CLI |
| `tests/extract/**` | 신규 테스트 61건(4파일) |
| `data/timetable.json` | 스키마 v2 발행(갭 6종 구조화, v1 필드 보존) |
| `.session-notes/T16-extract-run.json` | 실행 로그(모델명·프롬프트 해시·소요시간·needsReview) |
| `package.json` | `npm run extract` 스크립트 1줄 추가(런타임 의존성 0) |

금지 영역 준수: `src/domain/**` 0줄 · `docs/**` 0줄 · 런타임 의존성 0 추가(HTTP 는 Node 내장 `fetch`) ·
외부 AI API 호출 0(로컬 Ollama `http://127.0.0.1:11434` 만).

## 1. `npm run test` — 0 fail

```
$ npm run test
 Test Files  24 passed (24)
      Tests  303 passed (303)
```

신규 추출 테스트(≥15 요구) — 실제 61건:
- `tests/extract/units.test.ts` 15
- `tests/extract/merge-validate.test.ts` 20
- `tests/extract/pipeline.test.ts` 13
- `tests/extract/cli.test.ts` 13
- (+`support.ts` 픽스처)

## 2. 갭 6종 구조화 + `sourceQuote` 원문 인용

```
$ npm run extract -- --no-ai --now 2026-10-06T09:00:00+09:00 --out <scratch>/final.noai.json
[extract] 갭 1 시점 조건부 운행 변경: 2건 — dateRules[kind=route-change]
[extract] 갭 2 방향별 소요시간: 8건 — routes[].tripNotes[]
[extract] 갭 3 시간창 조건부 정차: 5건 — dateRules[kind=stop-time-window] + routes[].stopWindows[]
[extract] 갭 4 방학/학기 시간표 구분: 2건 — terms[]
[extract] 갭 5 기간의 의미 연결: 1건 — dateRules[kind=period-meaning]
[extract] 갭 6 중복 공지 제거 + 연도 추론: 7건 — notices 중복 제거 + dateRules[yearInferred]
[extract] dateRules 9건 · terms 2건 · notices 중복 제거 1건
EXIT=0
```

인용 검증(**파이프라인 코드와 별개로** 구현한 독립 검사 — 엔티티 해석 후 정확한 부분문자열):

```
QUOTE CHECK (entity-decoded pageText): ok=33 bad=0   (dateRules·terms·tripNotes·stopWindows 전 항목)
date format violations: []
```

실제 발췌(스키마 v2):

```json
{ "schemaVersion": 2,
  "dateRules": [ ... ],
  "terms": [ ... ],
  "routes": [ { "id": "asan-ktx", ...,
    "tripNotes": [{ "direction": "inbound", "minutes": 15, "segment": "아산역>캠퍼스",
      "sourceQuote": "*소요시간: 등교시 아산역>캠퍼스 15분 소요 / 하교시 캠퍼스>탕정역 경유>아산역 20분 소요",
      "extractedBy": "rule", "confidence": 1, "needsReview": false }],
    "stopWindows": [ ... ] } ] }
```

`sourceQuote` 예(원문 그대로):
- 갭① `"* 2026-2학기부터 학교출발->천안아산역 하교버스는 전체 차량 모두 탕정역 경유"`
- 갭③ `"- 학기 중 평일 학생회관 승강장 정차시간 13:30~15:30 / 19:30~ 막차까지 이용가능"`
- 갭④ `"2026-2학기 셔틀버스 휴일 운행기간 : 2026.9.5.(토) ~ 12.13.(일)"`
- 갭⑤ `period-meaning 2026-09-05~2026-12-13`
- 갭⑥ 연도 추론: `개천절연휴 2026-10-03~2026-10-04`(원문엔 `10.3.~10.4.`), `한글날 2026-10-09`

## 3. 위조 주입 → 검증 FAIL(exit 1) · 원복 후 클린

```
$ npm run extract -- --no-ai --inject-fabricated --out <scratch>/inj.json
[extract] ⚠️ --inject-fabricated: 원본에 없는 문장을 주입했다(검증 FAIL 이어야 정상)
[extract] 검증 실패(치명) — 2건. **JSON 을 쓰지 않는다**
[extract]   dateRules[9](no-service): 인용 검증 실패 — 원본 스냅샷 어디에도 없는 문장이다: "원본에 없는 위조 문장: 셔틀버스 운행 없음"
INJECT EXIT=1
$ ls <scratch>/inj.json   →  No such file or directory   (발행 중단 = 정상)
$ git status --short      →  (추적 대상 변경 없음)
```

## 4. 폴백 `--no-ai` PASS

```
$ npm run extract -- --no-ai --now ... → EXIT=0, 100783 bytes 발행 (schemaVersion=2)
```

Ollama 무응답/미설치 시에도 규칙 전용으로 발행된다(위 실행이 그 경로).

## 5. 결정성 + `extractedBy: ai` 구분

같은 입력·같은 `--now` 로 2회 실행 → **바이트 동일**:

```
$ shasum -a 256 fdA.json fdB.json
ba399a91712266d012970896ef55edff3d698cdf7f12dbb677e4347995f36855  fdA.json
ba399a91712266d012970896ef55edff3d698cdf7f12dbb677e4347995f36855  fdB.json
BYTE-IDENTICAL: YES
```

AI 모드(로컬 Ollama `lfm2.5:latest`, 90.8초):

```
[extract] AI: status=ok model=lfm2.5:latest 초안=24 채택=5 버림=9 인용복구=1 충돌=10
extractedBy: {"ai": 5, "rule": 9}
duplicate keys: 0
```

## 6. v1 필드 보존(하위호환 — 앱 무중단)

v2 발행물의 **v1 투영**(dateRules/terms/routes[].tripNotes/stopWindows/extraction 제거, 타임스탬프 마스킹)을
기존 계약 파일과 대조 — 차이는 의도된 것뿐:

```
v2-only top keys: dateRules, terms
v2-only route keys: tripNotes, stopWindows
routes 5종 id 불변: asan-ktx, cheonan-station, cheonan-terminal, onyang, cheonan-campus
v1 keys intact: true (semester·holidayPeriod·dayTypes·routes·notices·busRefs·contacts·source)
notices 17→16  ← 갭⑥ 중복 공지 제거(개천절[10.3~10.4] ≡ 개천절연휴[10.3~10.4]) — 정보 손실 없음
```

v2 발행 후 `npm run test` 303 pass · `npm run build` 성공(앱 계약 테스트 `normalize.test.ts` 포함).

## 7. 실행 로그(관측성 — docs/02 부록 A)

`.session-notes/T16-extract-run.json`:

```json
{ "generatedAt": "...", "model": "lfm2.5:latest",
  "promptTemplateSha256": "sha256:e86a2f83c952acff25e7ea60fbd38fe22a90059c750a98c660a6918f58a44a27",
  "aiStatus": "disabled", "durationMs": 48, "candidates": 25, "ruleEntries": 11,
  "needsReview": 1, "dedupedNotices": 1, "fatalIssues": 0, "dryRun": true, "noAi": true }
```

## 8. 검증 중 발견·수정한 결함 1건

`merge.ts` 의 "규칙이 이미 설명한 문장" 집합이 각 규칙의 **정본 인용만** 담고, 중복 통합으로 흡수된
인용(`mergedQuotes`)은 담지 않았다. 그 결과 AI 모드에서 `개천절`(흡수된 문장)을 다시 구조화해
`개천절연휴`와 **같은 기간 dateRule 이 2건** 생겼다(중복 제거 위반).

수정: `ruleQuotes` 에 `rule.mergedQuotes` 를 포함(`rules.ts` 의 `explained` 집합과 동일 기준).
회귀 테스트 추가 → `dateRules 15→14`, `conflicts 9→10`, `duplicate keys 0`, `extractedBy {"ai":5,"rule":9}` 유지.

## 9. 알려진 한계

- AI 모드 산출물은 로컬 모델에 따라 run-to-run 달라질 수 있다(요구사항 5 — `extractedBy: ai` 로 구분 표기).
  발행 파일의 결정성은 규칙 산출물에서만 보장된다.
- `--local` 은 원격 수집을 하지 않는다(`data/raw/*.html` 스냅샷만 — robots.txt `Disallow: /Page`).
- 스케줄 배치·커밋·푸시는 T15(self-hosted runner) 담당 — 이 태스크는 파이프라인 자체까지.
