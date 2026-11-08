# T2b — "시각을 해석하지 못한 회차 5건" 의 정체와 처리 (2026-11-08 KST)

카드: `t_65e90f69` · 워크스페이스: `/Users/leeheesun/Documents/github/sunmoon-shuttle`

## 0. 재현 (라이브 앱 문구)

라이브 `https://angalle.github.io/sunmoon-shuttle/` 의 `ⓘ 이용 안내`:
> 시각을 해석하지 못한 회차 5건은 목록에서 빠져 있을 수 있습니다 — 아래 출처의 학교 안내 페이지에서 확인해 주세요.

## 1. 경고의 출처(코드 경로)

| 단계 | 파일 | 실측 |
|---|---|---|
| 문구 생성 | `src/adapters/in/web/features/schedule/types/texts.ts:220` (`boardWarningsNoticePrefix`) | UI 소유 — 이 카드에서 미수정 |
| 경고 수집 | `src/domain/rules/serviceDay.ts` `resolveTripService()` | `출발 시각이 없는 회차입니다(순번 N) — 안내 대상에서 제외` |
| 개수 집계 | `selectors.ts` `warningsNoticeCount` | 도메인 경고 문자열 중 판단성 경고 |

`npm run scrape -- --local data/raw/*.html` 는 **경고를 한 줄도 출력하지 않는다**(스크래퍼 실패 0). 즉 스크래퍼 경고가 아니라 도메인 `출발 시각 없음` 경고다.

## 2. 정체 — 5행 (원본 `<tr>` 원문 인용)

| # | 노선 | 요일 | 순번 | 원본 출발 열 (`<td>`) | 시각이 있는 셀 | 원본 행 |
|---|---|---|---|---|---|---|
| 1 | 천안역 (`cheonan-station`) | 평일 | 5 | 아산캠퍼스 출발 `Χ` · 천안역 출발 `Χ` | 하이렉스파 건너편 `8:50` | `<td>5</td> <td>Χ</td> <td>Χ</td> <td>8:50</td> <td>2분~5분&nbsp;&nbsp;&nbsp;소요</td> <td>9:05</td> <td>중간노선&nbsp;&nbsp;&nbsp;전용</td>` |
| 2 | 천안터미널 (`cheonan-terminal`) | 평일 | 9 | 아산캠퍼스(출발) `Χ` · 터미널 `Χ` | 두정동 맥도날드 `8:55` | `<td>9</td> <td>Χ</td> <td>Χ</td> <td>8:55</td> <td colspan="2">5~10분 소요예상</td> <td>9:10</td> <td>중간노선전용</td>` |
| 3 | 온양역/터미널 (`onyang`) | 평일 | 1 | 아산캠퍼스(출발) `Χ` | 주은아파트 버스정류장 `8:00` | `<td>1</td> <td colspan="2">Χ</td> <td colspan="2">8:00</td> <td colspan="2">8:10</td> <td colspan="2">8:15</td> <td colspan="2">경유</td> <td>8:40</td> <td> </td>` |
| 4 | 온양역/터미널 (`onyang`) | 평일 | 2 | 아산캠퍼스(출발) `Χ` | 온양온천역 `8:45` | `<td>2</td> <td colspan="2">Χ</td> <td colspan="2">Χ</td> <td colspan="2">8:45</td> <td colspan="2">8:50</td> <td colspan="2">경유</td> <td>9:15</td> <td>금(X)</td>` |
| 5 | 온양역/터미널 (`onyang`) | 평일 | 3 | 아산캠퍼스(출발) `Χ` | 주은아파트 버스정류장 `8:40` | `<td>3</td> <td colspan="2">Χ</td> <td colspan="2">8:40</td> <td colspan="2">8:50</td> <td colspan="2">8:55</td> <td colspan="2">경유</td> <td>9:20</td> <td> </td>` |

원본 파일: `data/raw/2026-2학기-cheonan-station-평일.html` · `data/raw/2026-2학기-cheonan-terminal-평일.html` · `data/raw/2026-2학기-onyang-평일.html`

### 왜 "해석 실패"가 아닌가

- **행 누락 0**: 표 데이터 행 수는 수정 전 = 후 모두 `33 · 38 · 7`(천안역 · 천안터미널 · 온양). 5행은 파싱 결과에 **이미 들어 있다**.
- **시각 해석 실패 0**: 출발 열 원본 값이 문자 그대로 `Χ`(= 해당 없음, `docs/06 §3`)다. 시각 문자열이 있는데 못 읽은 셀이 없다.
- 시각은 **중간 정류장 열**(하이렉스파 / 두정동 / 주은아파트 / 온양온천역)에 있고, 계약상 그 열은 `kind:'text'`(구간 소요시간·`경유` 자리)다 — `tools/scraper/routeMeta.ts` 주석 참조.
- 따라서 목록에서 빠지는 이유는 **해석 실패가 아니라 모델 축의 한계**다: `tripDepartureTime = depCampus ?? depStation`(캠퍼스 출발 / 역·터미널 출발 두 축)에 중간 정류장 출발 회차가 자리가 없다.

## 3. 분류와 처리

| 분류 | 대상 | 처리 |
|---|---|---|
| ⓑ 원본 값이 시각이 아님(`Χ`·빈칸) | 5행 전부(출발 열 기준) | `resolveTripService` — 경고 없이 정상 skip (`reason: 'no-departure-time'` 구조 값은 유지) |
| ⓐ 실제 시각인데 모델 축이 좁음 | 5행의 **중간 정류장 시각**(`8:50`·`8:55`·`8:00`·`8:45`·`8:40`) | 계약 확장 필요(행 단위 `depOrigin{stop,time}`) — `docs/**` 는 총괄 소유 + `validate.ts` 가 "행 키 = 열 키" 를 강제 → **카드 코멘트로 승인 요청**(이 카드에서 미구현) |

경고 조건은 "값은 있는데 형식을 못 읽은 경우"로 좁혔다(유지: `출발 시각 형식을 해석하지 못했습니다` — `src/domain/rules/nextDeparture.ts`).

## 4. 수치 (전 → 후)

| 지표 | 전 | 후 | 근거 |
|---|---|---|---|
| 홈 경고 문구 건수 (`warningsNoticeCount`) | **5** | **0** | 프로브: `2026-11-08/09/14` 세 날짜 모두 `warningsNoticeCount=0`, `warningsNotice=null` |
| 파싱 표 행 수(평일 합) | 120 (42+33+38+7) | 120 | `npm run scrape` 로그 · 골든 테스트 |
| 전체 행 수(평일+토+일) | 148 | 148 | `extract` 드리프트 게이트 `전체 편 수 148 → 148 (+0%) · 신호 0건` |
| 화면 방향 칩 (평일) | 터미널 도착 91 · 학교 도착 24 | 91 · 24 | 변동 없음(ⓐ 미구현 — 승인 시 학교 도착 24 → 29) |
| `data/timetable.json` | 142,320 bytes | 동일 `contentHash` | `--ai=off` 재생성 → `sha256:e0952e99…3b5729` **양쪽 동일** |

## 5. 데이터 재생성 확인 (커밋 대상 없음)

```
$ npm run extract -- --local --ai=off data/raw/*.html --out <scratch>/t2b-regenerated.json --now 2026-11-08T16:30:00+09:00
[extract] 드리프트 게이트(§7): 기준 data/timetable.json · 전체 편 수 148 → 148 (+0%) · 신호 0건 · blocked=false
[extract] 검증 통과(치명 0) · schemaVersion=3 · v1 표(행·시각·열) 보존 확인
[extract] 발행: … (142320 bytes) · schemaVersion=3 · sha256:e0952e99ade9e3800e3b1a0c4ccb386596ee1b98b8990174e90e34caaf3b5729
```

커밋본 `data/timetable.json` 의 `source.contentHash` 와 **동일**. 차이는 `source.fetchedAt`·`source.extraction`(실행 메타)뿐이다 → 데이터 변경 0건이므로 `data/timetable.json` 은 커밋하지 않는다(빈 변경 커밋 금지).

## 6. 검증 명령과 결과

```
$ npx vitest run tests/scraper
Test Files  3 passed (3) / Tests  41 passed (41)

$ npx vitest run tests/domain tests/adapters/in/web/todayBoard.test.ts
Test Files  6 passed (6) / Tests  95 passed (95)

$ npm run test
Test Files  3 failed | 41 passed (44)
     Tests  4 failed | 629 passed (633)
   → 실패 4건은 모두 `tests/web/{a11y_tokens,privacy,pwa}` 색 토큰 단일출처 검사.
     내 변경 **전** 기준선(같은 세션 16:18 실행)도 동일 4건 실패 = 기존 실패.
     원인은 워킹트리의 진행 중 프론트 작업(`src/adapters/in/web/shared/ui/styles/{tokens,app}.css` 수정 중)이며
     이 카드의 파일과 무관하다(카드 경계상 미수정).

$ npm run build
tsc --noEmit && vite build → ✓ built in 40ms

$ bash scripts/boundary.sh
PASS [경계①/domain 순수성] src/domain — 0건
PASS [경계②/application→adapters] src/application — 0건
BOUNDARY: PASS (위반 0건)
```

## 7. 바뀐 파일

- `src/domain/rules/serviceDay.ts` — `resolveTripService`: 출발 시각 null 은 정상 skip(경고 0)
- `tests/scraper/golden.test.ts` — 5행(원본 셀·행 수) 고정 블록 추가
- `tests/domain/nextDeparture.test.ts` — ⑨ 기대값 반전(Χ 경고 없음) + ⑨b(형식 오류는 경고) 추가
- `tests/adapters/in/web/todayBoard.test.ts` — 픽스처를 "형식 오류"로 교체(UI 1줄 계약은 그대로 검증)
