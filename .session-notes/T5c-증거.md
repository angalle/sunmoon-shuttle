# T5c — 이용 안내에서 천안캠퍼스 잔여 문구 제거(완전 제거 마무리)

작성 2026-11-08 · frontendprojectcreator · 커밋 기준 HEAD `812d334` + 이 문서 커밋

## 무엇을 바꿨나

| 파일 | 구분 | 내용 |
|---|---|---|
| `src/adapters/in/web/features/schedule/data/normalize.ts` | 수정 | `status='suspended'` 노선의 `name`·`suspendedReason` 을 표지로 삼아, 그 노선을 가리키는 **원문 안내문 줄**(`notices[].text`/`raw`)과 **출처 페이지 항목**(`source.pages[]`)을 뷰모델에서 걷어낸다. 데이터(`data/**`)는 원본 보존 — 화면으로 나가는 유일한 경계에서만 제거. |
| `tests/adapters/in/web/suspendedRouteRemoval.test.ts` | 신규 | 6개 단정(아래 실측) |
| `scripts/render_smoke.mjs` | 수정 | `ⓘ` 패널 검사 9건 + 스크린샷 `T5c-정보패널.png` |
| `.session-notes/T5c-정보패널.png` | 신규 | `ⓘ` 연 상태 캡처 |

문자열 하드코딩이 아니라 데이터(`routes[].status`)에서 지운다 — 중단 노선이 늘거나 사유 문구가 바뀌어도 같은 규칙이 적용된다.

## 원인(라이브 → 소스 역추적)

`data/timetable.json` 의 `notices[14]`:

```
kind=notice  text="천안캠퍼스: 2024-2학기 부터 천안캠퍼스 노선은 운행하지 않습니다."
             raw ="[원문 제목] 천안캠퍼스(2024-2학기 부터 천안캠퍼스 노선은 운행하지 않습니다.)"
```

`noticeGroups()` 가 `kind='notice'` 를 그대로 패널 3번째 섹션(`이용 안내`)에 넘겨서 그 줄이 화면에 남았다.
`source.pages[]` 에도 `routeId='cheonan-campus'` 항목 1개가 남아 있었다(11 → 10).

## 실측 (원출력)

### `npm run build`
```
sw.js SW_VERSION 자동 주입: 20261108-161712-711-812d334
✓ 48 modules transformed.
dist/assets/index-C3zYX-Pf.js  67.42 kB │ gzip: 22.06 kB
✓ built in 41ms
```

### `npm run test` — 628 pass (클린 워크트리 = 내 커밋만)
```
git worktree add /tmp/t5c-wt 812d334 && npx vitest run
Test Files  44 passed (44)
     Tests  628 passed (628)
```
⚠️ 작업 디렉터리(=`main`)에서는 `tests/web/{a11y_tokens,privacy,pwa}.test.ts` 4건이 실패한다 — 원인은
**다른 카드가 커밋하지 않고 남긴 `src/adapters/in/web/shared/ui/styles/tokens.css` 수정(v2 시안 토큰)** 이고
내 변경과 무관하다(내 커밋만 있는 워크트리에서는 628/628 통과로 확인). 이 파일은 내 경계 밖이라 손대지 않았다.

### `bash scripts/boundary.sh`
```
PASS [경계①/domain 순수성] src/domain — 브라우저·네트워크·환경·시계 API 사용 0건
PASS [경계②/application→adapters] src/application — adapters import 0건
BOUNDARY: PASS (위반 0건)
```

### `node scripts/render_smoke.mjs` — PASS
```
PASS  ⓘ 이용 안내 열기
PASS  ⓘ 시트가 열린다 — open=true panelChars=1260
PASS  T5c 패널 안 `천안캠퍼스`·`운행 중단` 0건 — count=0
PASS  T5c 화면 전체(본문+패널) `천안캠퍼스`·`운행 중단` 0건 — count=0
PASS  T5c 스크린리더 텍스트(접근성 트리) `천안캠퍼스`·`운행 중단` 0건 — count=0 nodes=458
PASS  T5c 유지: 패널에 신선도 문구 `데이터 갱신`
PASS  T5c 유지: 패널에 비공식 고지
PASS  T5c 유지: 개인정보처리방침·문의처 2건(학교·운수사) — privacy=true contacts=true
PASS  T5c 유지: 운행 없는 날·대체 시간표 안내 — noService=true alternate=true
PASS  T5c 유지: 요금·안전 안내·승강장(시내버스 참고) — tariff=true safety=true stopArea=true
INFO  패널 안내문 16줄 · 출처 줄 1개 · 패널 텍스트 1260자
PASS  ⓘ 이용 안내 닫기
PASS  T5c 콘솔 오류 0(ⓘ 열기·닫기 포함)
...
RENDER SMOKE: PASS
```

### 단위 테스트 6건(`suspendedRouteRemoval.test.ts`)
```
✓ 실제 데이터: 패널에 그려지는 안내문에 `천안캠퍼스`·`운행 중단` 0건
✓ 실제 데이터: 다른 안내는 그대로 남는다(운행 없는 날·대체·요금/승강장/안전/문의처)
✓ 과잉 필터 금지 — 중단 노선을 언급하지 않는 원본 안내문은 한 줄도 잃지 않는다
✓ 실제 데이터: 중단 노선 출처 페이지 항목도 뷰모델에서 사라진다(11 → 10)
✓ 중단 노선 자체는 뷰모델에 보존된다(데이터 계층 무손실)
✓ 중단 노선을 언급하지 않는 안내문은 필터를 통과한다(픽스처 단위 검증)
```

### 구조 규칙 자기검사
```
① shared/ → features·store·api 참조: 0건
② atoms 의 store/features/api import: 0건 (남은 grep hit 2건은 "store·api 를 모른다" 주석)
③ 내 변경 파일 하드코딩 색상(#hex/rgb/rgba): 0건
```

## 스크린샷 눈 확인
`.session-notes/T5c-정보패널.png` — `ⓘ` 연 상태. `천안캠퍼스`·`운행 중단` 문구 없음,
`운행 없는 날 안내`·`대체 시간표 안내`·`이용 안내`·`시내버스 참고`·`최신 데이터(데이터 갱신: 2026-11-08 16:15 (KST))`·
`출처·고지(비공식)` 모두 그대로.

## 남은 가정·한계
- 데이터 계층(`data/timetable.json`)에는 중단 노선·원문 안내문이 **그대로 남아 있다**(원본 보존 — F2b 계약).
  화면 제거는 뷰모델 경계(`normalize.ts`)에서만 한다.
- `stopWindows` 는 현재 발행물에 값이 없어 패널에 `정차 시간 안내` 접힘이 뜨지 않는다(데이터 상태이지 제거 아님).
  스모크는 대신 `승강장`·`시내버스 참고` 로 승강장 안내 유지를 확인한다.
- `nextBusSuspendedTitle`·`routeStatusSuspended` 같은 중단 노선용 UI 문자열 상수는 남아 있으나,
  중단 노선이 목록·표·안내 어디에도 오르지 않아 화면에는 0건(스모크 실측). 상수 삭제는 별도 카드 범위.
