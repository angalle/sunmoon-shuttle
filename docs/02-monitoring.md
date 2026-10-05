# 02 — 장애 모니터링 계획 (선문대 셔틀버스 시간표 앱)

작성: ProjectCreator(총괄) · 2026-10-05
갱신: T3 infraprojectcreator · 2026-10-05 — 배포 파이프라인 실측 반영(§1 M8·M9, §2 알림 경로 구체화, §3 R3·R5 롤백 명령, §5 실제 게이트, **§6 주간 신선도 점검 절차**, **§7 비용 실측**). `docs/01 §5·§6` 도 같은 취지로 갱신.

> 이 앱은 **서버가 없다**(정적 + Actions). 모니터링 대상은 "서버 가용성"이 아니라 **① 수집 파이프라인 건강 ② 데이터 신선도 ③ 앱이 읽는 계약 데이터 무결성** 세 가지다.
>
> ⚠️ **수집 방식 정정(2026-10-05 실측)**: `robots.txt` 가 `Disallow: /Page`(=**`/Page2/…` 포함**)로 시간표 URL 을 차단한다 → **자동 cron 수집을 하지 않는다**. 정본은 **사람이 브라우저로 저장한 HTML 스냅샷을 `data/raw/` 에 커밋 → 파서가 자동 정규화 → 배포**하는 경로다(`docs/01 §8`).
> 따라서 M1(수집 성공률)은 "**스냅샷 반영 성공률**(파서·검증 통과)" 로, M2(데이터 나이)는 "**원본 `sourceUpdatedAt` 과 우리 반영 시각의 차이**" 로 해석한다. 학기 개편 시 반영이 늦으면 M2 경고가 뜨는 것이 정상 동작이다.
>
> 실제 파이프라인 파일: `.github/workflows/deploy.yml`(배포) · `.github/workflows/scrape.yml`(수동 스냅샷 반입) · `.github/scripts/{verify_contract,summarize}.mjs`(반입 경로 검증·요약).

## 1. 핵심 지표 · 임계값 · 알림
| # | 지표 | 측정 방법 | 정상 | 경고 | 심각(알림) |
|---|---|---|---|---|---|
| M1 | **수집 성공률**(최근 7회) | Actions 실행 결과 | 7/7 | 6/7 | **≤ 5/7 → 알림** |
| M2 | **데이터 나이** | `now - data.timetable.json.source.fetchedAt` (배포본 JSON 기준) | ≤ 24h | 24~48h | **> 48h → 알림** |
| M3 | **파서 스키마 검증** | 파서 내 검증(필수 필드·행 수·열 수) + 반입 경로 최소 검증 `.github/scripts/verify_contract.mjs`(schemaVersion·routes·source) | 전부 통과 | — | **1건이라도 실패 → 알림**(원본 개편 의심) |
| M4 | **원본 변경 감지** | `contentHash` 비교 | 하루 0~1회 | — | 7일간 변경 0 + 학기 시작 ±14일 → 경고(수집이 죽었을 수 있음) |
| M5 | **JSON 크기·행 수** | `data/timetable.json` | 크기 ≤ 200KB · 노선 ≥ 원본 노선 수 | ±20% 변동 | **-50% 이상(데이터 유실 의심) → 알림** |
| M6 | **앱 런타임 오류** | 브라우저 검증 하네스(배포 시 스모크) — **아직 미구현(T5·T6 이후)**. 현 배포 게이트는 경계검사+테스트+빌드 | 콘솔 오류 0 | — | 오류 ≥ 1 → 알림(배포 차단) |
| M7 | **과금 리소스 0** | 저장소·Actions·Pages·스토어 목록(§7) | 과금 0건 | — | 과금 리소스 등장 → 알림(즉시 제거) |
| M8 | **배포 결과** | `.github/workflows/deploy.yml` 실행 결론(`main` push·수동) | success | — | **failure → 알림**(사이트는 직전 정상 배포를 계속 서비스) |
| M9 | **Pages 가용성** | `curl -sI https://angalle.github.io/sunmoon-shuttle/` 상태코드 | 200 | 3xx(설정 변경 의심) | **≥400 · 무응답 → 알림** |

## 2. 알림 경로
| 심각도 | 경로 | 내용 형식 | 누가/언제 |
|---|---|---|---|
| 심각 | **GitHub Actions 실패 알림** → 저장소 소유자(angalle) 계정의 알림(이메일·웹) + 실행 URL + 총괄이 프로젝트 채팅에 보고 | 실패 워크플로·스텝명, 오류 원문(로그 링크), 마지막 정상 배포 시각 · 마지막 정상 `fetchedAt` | 워크플로 실패 즉시(자동) |
| 경고 | Actions **경고 스텝**(`::warning`, 실패 아님) + 주 1회 다이제스트(커밋 주석) | 지표 표 + 추세 | 주 1회(사람) |
| 정보 | 커밋 메시지 | `data: 스냅샷 반영 — 2026-2학기 · 노선 5 · 평일행 42 · sha256:xxxxxxxxxxxx (사유)` | 스냅샷 반영 시(자동) |

- **알림 수신 설정(사람이 1회)**: 저장소 `Watch` → `Custom` → **Actions 체크**. 이 설정이 없으면 워크플로가 실패해도 이메일이 가지 않는다(GitHub 기본값은 참여 알림).
- **알림이 조용해도 이상하다고 판단하는 조건**: M4(7일 무변경 + 학기 시작 근처) · M2(48h 초과). 서버가 없으므로 "무소식 = 정상"이 아니다 — **신선도로 판단**한다(§6).
- 미검증: 저장소 소유자 계정의 실제 이메일 수신 여부(계정 설정 접근 필요 — 총괄/사용자 확인 항목). 그때까지 실질 감지는 §6 주간 점검이다.

## 3. 장애 시나리오별 복구 절차 (runbook)
### R1. 파서 실패(원본 HTML 구조 변경)
1. `scrape.yml` 실행 로그에서 **실패 스텝**(스냅샷 파싱 / 계약 검증 / 테스트)과 오류 원문 확인
2. 원본 HTML 을 `data/raw/` 에 수동 저장(스냅샷) → 파서 수정 → **골든 재생성**
3. 로컬에서 동일 명령으로 재현: `npm run scrape -- --local data/raw/*.html` → `npm run test` 0 fail 확인
4. `scrape.yml` 재실행(workflow_dispatch) → 성공 시 커밋 1건 → `deploy.yml` 자동 실행
5. **사용자 영향**: 앱은 마지막 정상 데이터로 계속 동작(F8). 앱의 신선도 표시가 오래된 날짜를 보여준다(정직한 상태)

### R2. 원본 사이트 접속 불가(403/429/점검)
1. **자동 수집이 없으므로 이 시나리오로 파이프라인이 죽지는 않는다** — 반입은 사람이 브라우저로 스냅샷을 저장하는 수동 경로다.
2. 사람이 페이지를 열 수 없으면 반입이 지연된다 → 앱은 마지막 정상 데이터 유지 + M2(신선도) 경고 표시.
3. 접속이 회복되면 §6 절차로 새 스냅샷을 반입한다. 이용 허락 문의(학생지원팀)는 결정 D7 의 여유 경로.

### R3. 데이터 손상(부분 표·빈 배열) — 반입 차단 → 롤백
1. **반입 경로가 막는다**: `verify_contract.mjs`(계약 최소 검증) 또는 테스트 실패 → **커밋되지 않고 워크플로가 실패한다**(조용한 통과 금지). 이 경우 할 일: 원인 분석 → 파서 규칙 추가 → 골든 보강.
2. 이미 `main` 에 들어간 경우(예: 검증 우회) — **롤백**:
   ```bash
   git revert --no-edit <손상_커밋>      # 또는: git checkout <직전_정상_커밋> -- data/timetable.json && git commit -m "revert(data): 직전 정상 스냅샷 복원"
   git push origin main                 # → deploy.yml 이 자동 재실행되어 직전 정상 데이터로 복귀
   ```
3. **복구 확인**(2줄):
   ```bash
   curl -sI https://angalle.github.io/sunmoon-shuttle/ | head -1                     # 200 확인
   curl -s https://angalle.github.io/sunmoon-shuttle/data/timetable.json | jq -r .source.contentHash   # 직전 정상 해시와 일치 확인
   ```
4. 재발 방지: 같은 손상이 골든 테스트에서 먼저 걸리도록 케이스 추가(파서 담당 T2).

### R4. 학기 개편(노선 추가/폐지)
1. 원본에서 노선·요일 목록 재수집 → `routes[]` 변화 확인
2. 반입 경로의 최소 조건(`routes` 비어있지 않음·`id`/`name` 존재)은 자동 통과하므로, **노선 수·행 수 조건을 골든/스키마에 넣는 것은 파서(T2) 소관** — 개편 시 그 조건을 갱신하고 골든 재생성
3. 반영 후 앱 표시: 새 노선이 자동 노출(앱 재배포 불필요 — 데이터만 갱신, 단 Pages 아티팩트는 재업로드된다)

### R5. 배포 실패(GitHub Pages) — 구체 절차
1. 실행 목록 확인: `gh run list --workflow=deploy.yml --limit 5` (또는 Actions UI)
2. **실패한 잡으로 원인 구분**:
   - `build` 잡 실패(경계검사·테스트·빌드) → **깨진 코드/데이터가 배포되지 않았다.** `deploy` 잡은 실행되지 않았고, 직전 배포가 계속 서비스된다.
   - `deploy` 잡 실패(아티팩트는 정상) → Pages 반영 단계 문제. `workflow_dispatch` 로 재실행: `gh workflow run deploy.yml --ref main`
3. 반복 실패 시: Pages 설정(`Settings → Pages → Source: GitHub Actions`)과 권한(`pages: write`·`id-token: write`)을 확인
4. 사용자 캐시 갱신이 필요하면 `sw.js` 버전을 올려 재배포(T6 소관)

### R6. 데이터 신선도 경고(M2·M4) — 정기 점검
§6 의 **1줄 명령**을 주 1회 실행해 판단한다. "원본이 개편됐는데 우리 스냅샷이 낡음"이면 즉시 `scrape.yml` 수동 반입으로 신선도를 회복한다.

## 4. 로그·보존
| 대상 | 보존 | 위치 |
|---|---|---|
| Actions 실행 로그(deploy·scrape) | 90일(무료 기본) | GitHub Actions → 워크플로별 실행 이력 |
| 원본 HTML 스냅샷 | **영구**(git 히스토리) | `data/raw/<날짜>-<요일>.html` |
| 계약 데이터 이력 | 영구(git) | `data/timetable.json` 커밋 히스토리(`data: 스냅샷 반영 — …` 메시지에 노선·행수·해시) |
| 앱 검증 증거 | 영구 | `.session-notes/`(스크린샷·원출력) |
| 개인정보 | **수집·보존 0** | — (로컬 저장만, 기기 밖으로 나가지 않음) |

## 5. 배포 전 스모크(정기)
`main` push 마다 `.github/workflows/deploy.yml` 이 실행하는 **실제 게이트**:
1. `npm ci`(잠금파일 고정) → 2. `npm run lint:boundary`(헥사고날 경계) → 3. `npm run test`(단위·골든) → 4. `npm run build` → 5. 계약 JSON `dist/data/` 동봉(파일이 없으면 경고만) → 6. Pages 아티팩트 업로드 → 7. 배포.
- **2·3 이 실패하면 7(배포)은 실행되지 않는다** — `deploy` 잡이 `needs: build` 로 묶여 있다.
- 아직 파이프라인에 **없는 것**(미구현 명시): 헤드리스 브라우저 스모크(첫 화면 렌더·오프라인 재현·콘솔 오류 0). T5·T6 이후 `npm run verify:offline` 류로 추가한다(`docs/03 §3` 에 명령만 예약돼 있음).

## 6. 주간 신선도 점검 절차 (M2·M4) — 사람이 1분
배포된 계약 JSON 과 `data/timetable.json` 의 **마지막 커밋 시각**을 한 번에 본다. `jq` 필요(이 맥에는 `/usr/bin/jq` 존재).

```bash
curl -sL https://angalle.github.io/sunmoon-shuttle/data/timetable.json | jq -r '"원본 업데이트=\(.source.sourceUpdatedAt)  우리 반영=\(.source.fetchedAt)  해시=\(.source.contentHash)"'; curl -s "https://api.github.com/repos/angalle/sunmoon-shuttle/commits?path=data/timetable.json&per_page=1" | jq -r '"마지막 data 커밋=" + .[0].commit.committer.date'
```

판단 기준(사람이 이 문장대로):
- **원본 업데이트**(원본 페이지의 "최근 업데이트" 값)가 **우리 반영**보다 최신이면 → 원본이 개편됐는데 반영이 안 된 것 → 새 스냅샷을 `data/raw/` 에 넣고 `scrape.yml` 수동 실행.
- **마지막 data 커밋**이 6개월 이상 과거이면서 학기 시작 ±14일 안이면 → M4 경고(수집이 죽었을 수 있음) → 원본 페이지를 사람이 직접 열어 대조(자동 수집 금지).
- 출력이 **비어 있으면** `data/timetable.json` 이 아직 배포되지 않은 상태다(T2 파서 이전) → 그 자체가 "신선도 없음" 신호.
- 원본 페이지의 "최근 업데이트" 는 **사람이 브라우저로 `lily.sunmoon.ac.kr` 를 열어 확인**한다(자동 크롤 금지 — `docs/01 §8`).

## 7. 비용 실측 (AC-8 근거)
**원칙: 운영비 0.** 과금 리소스가 하나라도 생기면 즉시 중단하고 총괄이 사용자에게 보고한다(도입 금지).

| 리소스 | 용도 | 조건·한도 | 과금 | 근거 |
|---|---|---|---|---|
| GitHub 저장소(**public**) | 코드·스냅샷·계약 데이터 보관 | 공개 저장소는 무료 | **0원** | GitHub Free — public 리포지토리 무제한 |
| GitHub Actions(표준 러너 ubuntu-latest) | 경계검사·테스트·빌드·배포 | **공개 저장소는 분 과금 없음** | **0원** | GitHub Docs — GitHub Actions billing: "usage is free … for public repositories that use standard GitHub-hosted runners" (https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| GitHub Actions 아티팩트/캐시 스토리지 | 배포 아티팩트·npm 캐시 | 공개 저장소는 무료(Private 만 용량 과금) | **0원** | 위 문서의 스토리지 청구는 private 리포지토리 대상 |
| GitHub Pages | 정적 호스팅·HTTPS·CDN | 사이트 ≤ 1GB, **소프트** 대역폭 100GB/월, Actions 배포는 "10 builds/hour" 제한 미적용 | **0원** | GitHub Docs — GitHub Pages limits (https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) |
| 도메인 | — | 기본 `*.github.io` 사용(커스텀 도메인 없음) | **0원** | — |
| 서버·DB·CDN | — | **서버 0** 구조(`docs/01 §2`) | **0원** | — |
| Android Play Console(T8, 후속) | 내부 테스트 배포 | **기존 보유 계정 재사용**(신규 결제 없음) | 0원(조건부) | `docs/04` D2·T8 — 계정 상태는 총괄 확인 |
| iOS App Store | 미도입(PWA 로 대체) | $99/년 | **도입 금지** | `docs/04` D3 |
| 외부 API·유료 모델·분석 도구 | — | 사용하지 않음(추적/광고 도메인 0) | **0원** | `docs/01 §2` |

**실측 근거(명령과 관측값)**
- 저장소 공개 여부(= Actions·Pages 무료 조건): `gh api repos/angalle/sunmoon-shuttle --jq '{private,visibility,has_pages}'` → `private=false`, `visibility=public`
- Pages 상태: `gh api repos/angalle/sunmoon-shuttle/pages --jq '{html_url,status,build_type}'` → 배포 후 관측값(§8 기록)
- **미검증**: 결제 계정 청구서 자체(`Settings → Billing`)는 **저장소 소유자 계정 접근이 필요**해 확인하지 못했다. 다만 위 근거(공개 저장소 무료)상 Actions·Pages 는 과금 대상이 아니다. 사람이 1회 Billing 화면에서 "Actions/Pages 사용량 0 또는 무료 한도 내"를 확인하면 확정된다.

## 8. 배포 파이프라인 실측 기록 (T3 · 2026-10-05)
**저장소·Pages**: `angalle/sunmoon-shuttle` (public, default `main`) · Pages `build_type=workflow`, `https_enforced=true`

**Pages URL**: https://angalle.github.io/sunmoon-shuttle/ → `curl -sI` = `HTTP/2 200`, `last-modified: Mon, 05 Oct 2026 05:26:50 GMT`, `content-length: 416`
- 배포본 HTML 이 `./assets/index-CYcdGgtf.js` 를 **상대 경로**로 참조 → 하위 경로 배포 정상(`vite base: './'`).
- `https://angalle.github.io/sunmoon-shuttle/data/timetable.json` → **404**(파서 T2 이전이라 동봉할 JSON 이 없음).

**실행별 실측**(원출력은 `.session-notes/20261005-t3-deploy-pipeline-evidence.md`):

| # | 워크플로 | 트리거 | 결과(스텝 단위) | 실행 URL |
|---|---|---|---|---|
| 1 | deploy | push `449f065` | failure — `Pages 설정` 에서 `Create Pages site failed. Error: Resource not accessible by integration` (GITHUB_TOKEN 은 Pages **사이트 생성** 권한이 없음) → `deploy` 잡 skipped | https://github.com/angalle/sunmoon-shuttle/actions/runs/37257418833 |
| 2 | deploy | push `06c2f85` | success — 관리자 토큰으로 Pages 1회 활성화한 뒤 12스텝 전부 success | https://github.com/angalle/sunmoon-shuttle/actions/runs/37267794703 |
| 3 | deploy | push `360bcfc` | success — 액션 버전 상향(`checkout@v7`·`setup-node@v7`·`configure-pages@v6`·`upload-pages-artifact@v5`·`deploy-pages@v5`) 후 | https://github.com/angalle/sunmoon-shuttle/actions/runs/37267845172 |
| 4 | deploy | workflow_dispatch `t3/verify-fail-gate` | failure — `테스트` 스텝 `AssertionError: expected 1 to be 2` (Tests 1 failed \| 38 passed) → `정적 빌드`·`계약 데이터 동봉`·`Pages 설정`·`아티팩트 업로드` **skipped**, `deploy` 잡 **skipped** | https://github.com/angalle/sunmoon-shuttle/actions/runs/37267897668 |
| 5 | scrape | workflow_dispatch(`mode=commit`) | failure — 스냅샷 **11개 매칭** 후 `[scrape] 미구현: tools/scraper/index.ts 는 T2(t_5ccc5cf5)에서 구현한다.` exit 1 → 계약 검증·테스트·커밋 스텝 **skipped(반영 커밋 0건)** | https://github.com/angalle/sunmoon-shuttle/actions/runs/37267949917 |

- 4번(실패 게이트 시연)은 **임시 브랜치**에서 실행하고 브랜치는 삭제했다 — `main` 이력·배포본에 영향 없음.
- **Pages 최초 활성화 절차**(1회, 재현용): 관리자 권한 계정으로 `gh api -X POST repos/angalle/sunmoon-shuttle/pages -f build_type=workflow` → 이후 `configure-pages` 는 이미 있는 사이트를 그대로 쓴다(멱등).
- **로컬 사전 검증**(워크플로 push 전에 같은 명령을 로컬에서 실행): `actionlint` 2파일 **0건** · `verify_contract.mjs`(정상 fixture exit 0 / 손상 fixture exit 1) · `summarize.mjs` 1줄 출력 · 글롭 로직 실데이터 11개 매칭·미매칭 시 exit 1 · `npm run test` 5 pass · `npm run build`(dist 8.0K) · `bash scripts/boundary.sh` BOUNDARY: PASS.
- **남은 것(다음 단계)**: ① T2 파서 완료 후 `scrape.yml` 재실행 → 성공 케이스로 §8 표 갱신(그때 `data/timetable.json` 이 Pages 에서 200) ② 저장소 `Watch → Actions` 알림 수신 설정(사람 1회 — §2) ③ 헤드리스 브라우저 스모크(T5·T6, §5).
