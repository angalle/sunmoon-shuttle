# T4 — 도메인 규칙(요일 · 운행 여부 · 다음 출발) 작업 기록

작성: APIProjectCreator · 2026-10-05 · 태스크 `t_553d9eee` (부모 T0 `t_37cdfc3e`)

## 만든 것 (모두 `src/domain` + `src/ports`)

| 파일 | 역할 |
|---|---|
| `src/ports/clock.ts` | 시계 포트(인터페이스). 도메인은 `Date.now()` 금지 → 현재 시각은 여기로 주입 |
| `src/domain/entities/Trip.ts` | 회차(순번·출발·도착·특이사항) + `tripDepartureTime()` = `depCampus ?? depStation` |
| `src/domain/entities/Notice.ts` | 안내문 1건(`kind`/`date`/`text`) — `docs/01 §4` 1:1 |
| `src/domain/entities/Route.ts` | 노선(원본 `trips` + 요일별 `byDay`) |
| `src/domain/entities/Schedule.ts` | 시간표 전체 + `findRoute`/`routeIds`/`tripsFor` |
| `src/domain/rules/kst.ts` | KST(+09:00) 고정 오프셋 달력 계산. `getUTC*` 만 사용 → 호스트 TZ 무관·결정적 |
| `src/domain/rules/dayType.ts` | 요일 번호·인스턴트 → `DayType` |
| `src/domain/rules/serviceDay.ts` | 운행 여부 판정 + **문자열 패턴 표**(`NOTICE_RULES`/`TRIP_NOTE_RULES`) |
| `src/domain/rules/nextDeparture.ts` | 다음 출발 N개 + 남은 시간(분/초) + 명확한 상태 반환 |

테스트: `tests/domain/{dayTypeRules,serviceDay,nextDeparture}.test.ts` + 픽스처 `tests/domain/fixtures/timetable.ts`
(픽스처 값은 원본 스냅샷 `data/raw/2026-2학기-asan-ktx-요일혼합.html` 의 실제 문자열을 옮긴 것)

## 판정 규칙(패턴 표 — 코드에 매직 분기 없음)

안내문(`notices[].text`):
- `운행 없음|운행 중단|미운행` → 그 날짜 `serviceOn=false`, 사유=안내문 원문
- `일요일|토요일|평일 시간표로 운행` → `effectiveDayType` 만 교체(운행은 함)

회차 특이사항(`trip.note`):
- `금(X)`(요일+(X)) → 그 요일에만 제외
- `월~화 2대 운행`(요일~요일 N대 운행) → **주석**(운행 여부 불변) — 수용 기준 ⑦ 지시
- 그 밖의 문구(`중간노선 전용`, `0:15`, `5분~10분 소요예상`) → **경고로 수집 + 운행 여부 불변**(추측 금지)
- 빈 값/`Χ`(null 출발) → 안내 대상 아님

## 검증 (직접 실행)

```
npm run build         # tsc --noEmit(strict) + vite build → 성공
npm run test          # 4 files / 38 tests passed / 0 fail
npm run lint:boundary # PASS 경계① src/domain 0건 · 경계② 0건
grep -rnE '...' src/domain --include='*.ts'   # (위반 0건)
```

## 남은 질문 / 다음 태스크 주의

1. **미등록 표기 판정** — 원본에 있는 `0:15`(소요시간), `중간노선 전용`, `5분~10분 소요예상`,
   안내문의 기간 표기(`추석연휴[9.24~9.26]`)를 어떻게 다룰지는 **총괄 확인 대기**.
   현재 구현은 "경고로 수집 + 운행 여부 불변"이다(추측 구현 회피).
2. **T2(파서) 계약** — `notices[].date` 는 KST `YYYY-MM-DD` **하루 단위로 전개**되어야 한다.
   전개되지 않은 표기는 `resolveDayService` 가 경고로 올린다(테스트로 고정:
   "안내문 날짜가 하루(YYYY-MM-DD)로 전개되지 않으면 경고").
3. **천안역 표의 열 수** — 원본 천안역 표는 6열(하이렉스파/용암마을 포함)인데 `docs/01 §4` 의
   `Trip` 은 5필드 고정이다. T2/T10 에서 열 매핑 확정 필요.
4. T5(UI)는 `nextDepartures()` 의 `status`/`warnings`/`dayLabel` 을 그대로 쓰면 된다.
