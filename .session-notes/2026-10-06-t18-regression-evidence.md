# T18 증거 — 수집 실패 시 캐시 폴백 회귀(AC-5·AC-6) 수정

- 일시: 2026-10-06 (KST) · 워커: frontendprojectcreator · 태스크: t_74a9348b
- 결론: **원인 1곳(캐시 스키마 게이트)** · 수정 2파일(앱 1 · 테스트 1) · `npm run verify:offline` **exit 0 / PASS 29 · FAIL 0** 복구
- 원출력(그대로): `T18-repro-before.txt`(수정 전 FAIL) · `T18-repro-v1data.txt`(v1 데이터로 PASS = 트리거 증명) ·
  `T18-red-old-gate.txt`(옛 게이트로 신규 테스트 RED) · `T18-test-after.txt` · `T18-offline-smoke-after.txt` ·
  `T18-v1-smoke.txt` · `T18-v2-smoke.txt` · `T18-a11y-smoke.txt`

## 1. 원인 커밋 식별 (git bisect 대신 결정적 대조)

앱 코드가 아니라 **발행물 버전 인상 + 앱의 게이트 미동기화**였다.

```
$ git log --oneline -2 -- data/timetable.json
72d2a41 data(extract): timetable.json 스키마 v2 발행(갭 6종 구조화, v1 필드 보존) + 실행 로그
86037f1 data(scrape): 생성물 data/timetable.json + T2 증거·재현 스크립트

$ git show 72d2a41 -- data/timetable.json > /tmp/t18-data-diff.txt; grep -n schemaVersion /tmp/t18-data-diff.txt   (발췌)
-  "schemaVersion": 1,
+  "schemaVersion": 2,

$ git show 72d2a41^:data/timetable.json > /tmp/t18-v1-parent.json
$ node -e "const j=require('/tmp/t18-v1-parent.json'); console.log(j.schemaVersion, j.routes.length)"   → 1 5
$ node -e "console.log(require('./data/timetable.json').schemaVersion)"   → 2

$ git log --oneline -S "SUPPORTED_SCHEMA_VERSION = 1" -- src/adapters/in/web/features/schedule/api/timetableApi.ts
8b3da7b feat(web): IndexedDB 캐시 어댑터 + 캐시 우선 재검증 로더 + Service Worker(SWR·버전 무효화)   ← T6, 훨씬 이전
```

**등가 대조(같은 앱 빌드, 데이터 파일만 교체)** — 회귀 트리거가 v2 발행임을 실측으로 확정:

| 데이터 | 명령 | 결과 |
| --- | --- | --- |
| `data/timetable.json`(v2, 현재) | `npm run verify:offline -- --shots=none` | **EXIT=1 · FAIL 5건** (`T18-repro-before.txt`) |
| 같은 파일을 `72d2a41^`(v1)로 교체 | `npm run verify:offline -- --shots=none` | **EXIT=0 · OFFLINE SMOKE: PASS** (`T18-repro-v1data.txt`) |

교체는 `cp` 백업/복원으로만 했고(`git checkout/reset/stash` 미사용), 종료 후 `git status` 로 원복 확인(`schemaVersion 2`).

## 2. 기계적 원인

`src/adapters/in/web/features/schedule/api/timetableApi.ts`

```
// 저장(write)은 데이터의 실제 버전을 쓴다 → v2 파일이면 2
schemaVersion: model.schemaVersion,
...
// 읽기(read) 게이트는 v1 만 통과 → v2 캐시는 "없음"으로 버려짐
if (cached.schemaVersion !== SUPPORTED_SCHEMA_VERSION) return null;   // SUPPORTED_SCHEMA_VERSION = 1
```

→ 네트워크 실패 시 `cachedModel === null` → 폴백 없음 → `TimetableDataError` → `console.error` + F8 오류 UI.
`listStatus=loading`·`offlineNotice=null`·`errorBanner=true` 라는 스모크 덤프와 정확히 일치한다.

RED 증명(수정한 테스트를 **옛 게이트**에 물려 실행 — `T18-red-old-gate.txt`):

```
FAIL … > v2 원문 캐시(schemaVersion 2)를 파싱해 캐시로 폴백한다
TimetableDataError: ./data/timetable.json: 네트워크 요청 실패: Failed to fetch   ← 스모크와 같은 문구
Tests  3 failed | 1 passed | 9 skipped (13)
```

## 3. 수정 (판정 로직 신규 작성 없음 · 게이트만 목록화)

```
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1, 2];
export const SUPPORTED_SCHEMA_VERSION = 2;              // 지원 목록의 최신
...
if (!SUPPORTED_SCHEMA_VERSIONS.includes(cached.schemaVersion)) return null;
```

- v2 를 넣는 근거는 **파서가 실제로 읽는다**는 사실이다: `normalize.ts` 는 v2 배열(`dateRules[]`·`terms[]`·
  `routes[].tripNotes[]`·`stopWindows[]`)을 **선택**으로 읽는다("키가 없거나 배열이 아니면 `[]`") → v1·v2 모두 파싱 가능.
- 목록 밖(미래) 버전은 그대로 버린다 — `ports/timetable_cache.ts` 계약("마이그레이션 없음") 유지.
- 스모크·기대값은 **한 줄도 완화하지 않았다**(스모크 파일 무수정 — `git diff` 기준 `scripts/` 변경 0).
- 테스트: 신규 4건(v2 원문 캐시 폴백 · 발행→저장→폴백 왕복 · 실제 발행물 `data/timetable.json` v2 폴백 · 목록-v2 동기화),
  기존 "버전 불일치 캐시" 테스트는 **지원 목록 밖**(`max(목록)+1`)으로 재정의(의미 보존, 약화 아님).

## 4. 검증 원문 요약 (전체 원문은 위 txt 파일)

| 검사 | 명령 | 결과 |
| --- | --- | --- |
| 단위·통합 | `npm run test` | **25 files passed · 334 passed** (`T18-test-after.txt`) |
| 오프라인·폴백 | `npm run verify:offline -- --shots=none` | **EXIT=0 · OFFLINE SMOKE: PASS · PASS 29 / FAIL 0** |
| v1 표시 | `node scripts/v1_smoke.mjs` | **EXIT=0 · V1 SMOKE: PASS** |
| v2 표시 | `node scripts/v2_smoke.mjs` | **EXIT=0 · V2 SMOKE: PASS** |
| 접근성·개인정보 | `node scripts/a11y_smoke.mjs` | **EXIT=0 · 검사 46건 · 실패 0건 · A11Y SMOKE: PASS** |
| 빌드·경계 | `npm run build` · `npm run lint:boundary` | PASS (경계 위반 0건) |

고쳐진 5건(수정 후 원문):

```
PASS  수집 실패: 마지막 정상 데이터 표시(보드가 데이터로 그려짐) — listStatus=ready rows=5
PASS  수집 실패: 캐시 폴백 안내를 문구로 표시 — {"source":"cache","text":"오프라인 — 마지막으로 받은 데이터를 표시합니다…"}
PASS  수집 실패: 오류 UI(F8)로 가지 않는다 — 데이터가 있으므로
PASS  수집 실패: 앱이 낸 콘솔 오류 0 (AC-5)
PASS  만료 캐시도 유지하고 "24시간 초과"를 알린다 — {"source":"cache-expired","text":"…마지막으로 받은 시각: 5일 전 (24시간 초과)…"}
```

AC-6(오프라인 새로고침)·T14 계약도 그대로 유지: `원본=0 · schoolLinks=1`,
`v1_smoke` ⑩ `{"sourceDetails":0,"timetable":false}` · 4개 시나리오 모두 `{"sourceDetails":0,"visible":0,"links":1}`.

## 5. 남은 한계·가정

- **가정**: 앞으로 발행물의 `schemaVersion` 을 올릴 때는 `SUPPORTED_SCHEMA_VERSIONS` 도 함께 올려야 한다.
  코드 주석으로 경고를 박아 두었지만, 자동 검증 장치는 `loadTimetable.test.ts` 의 "목록에 2가 있다" 1건뿐이다
  (파서가 못 읽는 v3 를 넣으면 테스트가 알려주지 않는다 — 파서 실능력은 컴파일 타임에 알 수 없다).
- `render_smoke.mjs`(T11 렌더) 는 이번 태스크 지시 목록에 없어 재실행하지 않았다(회귀 범위 밖 — 캐시 게이트 1줄).
- 스모크 재실행이 건드린 추적 산출물(`.session-notes/*.png` · `T7-a11y-report.md`)은 HEAD 내용으로 되돌려
  변경 집합을 코드 2파일 + 신규 증거 txt 로만 유지했다(포트·타임스탬프만 달라지는 재생성물).
- 배포(push)·P3 최종 판정은 하지 않았다(태스크 금지 조항).
