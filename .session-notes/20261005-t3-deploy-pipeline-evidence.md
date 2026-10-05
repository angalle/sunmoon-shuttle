# T3 배포 파이프라인 — 실행 증거 (infraprojectcreator, 2026-10-05)

이 파일은 T3(`t_68ff2524`)의 **원출력·실행 URL** 기록이다. 요약 해석은 `docs/02-monitoring.md §8`.

## 0. 산출물(파일)
- `.github/workflows/deploy.yml` — `main` push → `npm ci` → `npm run lint:boundary` → `npm run test` → `npm run build` → Pages 공식 Actions 배포. 테스트/경계 실패 시 `deploy` 잡은 `needs: build` 로 **skipped**.
- `.github/workflows/scrape.yml` — **`workflow_dispatch` 전용**(`schedule:` 없음). 스냅샷 파싱(`--local`) → 계약 JSON 최소 검증 → 테스트 → 변경 시에만 커밋(무변경 0건) / `mode=pr` 시 PR.
- `.github/scripts/verify_contract.mjs` — 계약 JSON 최소 검증(반입 경로 마지막 방어선).
- `.github/scripts/summarize.mjs` — 커밋 메시지용 1줄 요약(학기·노선·평일행·sha256 앞 12자).
- `docs/02-monitoring.md` — M8·M9 신설, §2 알림 경로 구체화, R3·R5 롤백 명령, §5 실제 게이트, **§6 주간 신선도 점검 1줄 명령**, **§7 비용 실측**, §8 실측 기록.
- `docs/01-architecture.md §5·§6` — 캐싱·배포 파트 갱신(cron → 수동 스냅샷, 배포 게이트, Pages URL).

## 1. 로컬 사전 검증(워크플로 push 전)
```
$ actionlint .github/workflows/deploy.yml .github/workflows/scrape.yml
actionlint exit=0                       # shellcheck·스키마 지적 0건

$ node .github/scripts/verify_contract.mjs <정상 fixture>
계약 검증 OK — schemaVersion=1 노선=1 평일행=3     (exit 0)

$ node .github/scripts/verify_contract.mjs <손상 fixture>
::error title=계약 검증 실패::schemaVersion 이 1 이상의 정수가 아니다
::error title=계약 검증 실패::route.id 누락
::error title=계약 검증 실패::source 누락 (sourceUpdatedAt·contentHash 의 근거)   (exit 1)

$ node .github/scripts/summarize.mjs <정상 fixture>
2026-2학기 · 노선 1 · 평일행 3 · sha256:a3254e2fe6e0        (exit 0)

$ bash <글롭 로직 시뮬레이션>            # scrape.yml 의 compgen+while 로직 그대로
glob=[data/raw/*.html] 매칭=5개 ... (총 5개)                  (exit 0)
glob=[data/raw/*.nomatch] 매칭=0개 -> ::error(스냅샷 없음) 경로로 exit 1

$ npm run test
Test Files 1 passed (1) / Tests 5 passed (5)

$ npm run build
dist/index.html 0.41 kB · dist/assets/index-CYcdGgtf.js 0.87 kB · built in 21ms   (dist 8.0K)

$ bash scripts/boundary.sh
PASS [경계①/domain 순수성] … 0건 / PASS [경계②/application→adapters] … 0건 / BOUNDARY: PASS
```

## 2. GitHub Actions 실행 이력(실측)
| # | 워크플로 | 트리거 | sha | 결론 | URL |
|---|---|---|---|---|---|
| 1 | deploy | push | 449f065 | failure | https://github.com/angalle/sunmoon-shuttle/actions/runs/37257418833 |
| 2 | deploy | push | 06c2f85 | success | https://github.com/angalle/sunmoon-shuttle/actions/runs/37267794703 |
| 3 | deploy | push | 360bcfc | success | https://github.com/angalle/sunmoon-shuttle/actions/runs/37267845172 |
| 4 | deploy | workflow_dispatch(`t3/verify-fail-gate`) | 83be981 | failure(시연) | https://github.com/angalle/sunmoon-shuttle/actions/runs/37267897668 |
| 5 | scrape | workflow_dispatch | 360bcfc | failure(T2 미구현) | https://github.com/angalle/sunmoon-shuttle/actions/runs/37267949917 |

### 1번 실패 원인(최초 실행) — Pages 미활성화
```
##[warning]Get Pages site failed. Error: Not Found - .../pages#get-a-apiname-pages-site
##[error]Create Pages site failed. Error: Resource not accessible by integration - .../pages#create-a-apiname-pages-site
```
→ `GITHUB_TOKEN` 은 Pages **사이트 생성** 권한이 없다. 관리자 계정으로 1회 활성화:
```
$ gh api -X POST repos/angalle/sunmoon-shuttle/pages -f build_type=workflow
{"html_url":"https://angalle.github.io/sunmoon-shuttle/","build_type":"workflow","https_enforced":true,...}
```

### 3번(main push, success) 스텝 결론
```
JOB build (경계 → test → build) => success
   - [success] 체크아웃 / Node 설정 / 의존성 설치 / 헥사고날 경계 검사 / 테스트 / 정적 빌드
   - [success] 계약 데이터 동봉 (data/timetable.json, 있으면)
   - [success] Pages 설정 (사이트가 이미 있으면 그대로 사용)
   - [success] 배포 아티팩트 업로드
JOB deploy (github-pages) => success
   - [success] Pages 배포
```

### 4번(실패 게이트 시연) — 테스트 실패 → 배포 중단
임시 브랜치 `t3/verify-fail-gate` 에 일부러 실패하는 테스트를 커밋하고 `deploy.yml` 을 `workflow_dispatch` 로 실행.
```
JOB build (경계 → test → build) => failure
   - [success] … 경계 검사
   - [failure] 테스트 (단위·골든)
   - [skipped] 정적 빌드
   - [skipped] 계약 데이터 동봉 (data/timetable.json, 있으면)
   - [skipped] Pages 설정 (사이트가 이미 있으면 그대로 사용)
   - [skipped] 배포 아티팩트 업로드
JOB deploy (github-pages) => skipped

 FAIL  tests/domain/__t3_gate_fail.test.ts > T3 배포 게이트 시연(일부러 실패) > …
 AssertionError: expected 1 to be 2 // Object.is equality
 Test Files  1 failed | 4 passed (5)      Tests  1 failed | 38 passed (39)
##[error]Process completed with exit code 1.
```
시연 후 브랜치 삭제(`gh api -X DELETE repos/angalle/sunmoon-shuttle/git/refs/heads/t3/verify-fail-gate`). `main` 이력 무영향.

### 5번(scrape 수동 트리거) — T2 미구현이라 실패가 정상
```
매칭된 스냅샷: 11개
> tsx tools/scraper/index.ts --local data/raw/2026-2학기-cheonan-terminal-일요일.html … (11개 경로)
[scrape] 미구현: tools/scraper/index.ts 는 T2(t_5ccc5cf5)에서 구현한다.
##[error]Process completed with exit code 1.
   - [failure] 스냅샷 파싱 (--local)
   - [skipped] 계약 JSON 최소 검증 / 테스트 / 변경 감지 / 반영 — main 커밋 / 반영 — 검토용 PR
```
→ **커밋 0건**(반영 스텝 skipped). T2 완료 후 재실행하면 성공 케이스로 갱신한다.

## 3. Pages 관측
```
$ curl -sI https://angalle.github.io/sunmoon-shuttle/
HTTP/2 200
last-modified: Mon, 05 Oct 2026 05:26:50 GMT
cache-control: max-age=600
content-length: 416
$ curl -s https://angalle.github.io/sunmoon-shuttle/ | grep -o 'src="[^"]*"'
src="./assets/index-CYcdGgtf.js"
$ curl -s -o /dev/null -w "timetable.json HTTP %{http_code}\n" https://angalle.github.io/sunmoon-shuttle/data/timetable.json
timetable.json HTTP 404        # 파서 T2 이전이라 동봉할 JSON 없음
```

## 4. 비용 실측(관측)
```
$ gh api repos/angalle/sunmoon-shuttle --jq '{private,visibility}'
{"private":false,"visibility":"public"}      # 공개 저장소 → Actions 표준 러너·Pages 무료 조건 충족
$ gh api repos/angalle/sunmoon-shuttle/pages --jq '{html_url,build_type,https_enforced}'
{"html_url":"https://angalle.github.io/sunmoon-shuttle/","build_type":"workflow","https_enforced":true}
```
- 미검증: 결제 계정 Billing 화면(저장소 소유자 접근 필요). 근거 링크는 `docs/02 §7`.
