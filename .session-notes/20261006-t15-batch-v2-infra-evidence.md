# T15 — 배치 v2 인프라: self-hosted 러너(이 맥) + extract.yml 스케줄 2회/일 + 발행·모니터링

작성: infraprojectcreator · 2026-10-06 (KST) · 태스크 `t_1633db9b`

커밋(로컬 `main`, **push 하지 않음 — 사용자 승인 게이트**):
1. `feat(batch): T15 배치 v2 인프라 — self-hosted 러너(이 맥)+extract.yml 스케줄 2회/일+발행·모니터링`
2. `fix(runner): 러너 복구 절차 보강 — launchd 스폰 지연 감지(kickstart/bootout+bootstrap 폴백) + 감시 LaunchAgent(TCC 사본)`

---

## 1. 수용 기준 대조표 (증거 / 미검증을 구분)

| # | 수용 기준 | 상태 | 증거 |
|---|---|---|---|
| 1 | `gh api …/actions/runners` 에 **online** | **통과** | §2 원문 (`status=online busy=false`, 라벨 self-hosted·macOS·ARM64·sunmoon) |
| 2 | extract.yml **수동 dispatch 1회 성공** + `schedule` 2건 등록 | **부분** — schedule 2건은 파일에 등록(§4). **dispatch 실측 불가**: 워크플로가 `main` 에 올라가야 dispatch 가능한데 main push = Pages 배포 → 사용자 승인 게이트(§6) | §4 원문 / §6 |
| 3 | 무변경 → **커밋 0건**, 원본 변경 주입 → **1건** (AC-A1) | **통과(로컬 하네스)** — CI 실측은 #2와 같은 이유로 보류 | §5 표 행 1·2 |
| 4 | 실패 주입 → **발행 중단 + 마지막 정상 JSON 유지 + 알림 1건** | **통과(로컬 하네스)** | §5 표 행 3 (커밋 0건, `cur==prev → True`, alerts 1건 `kind=quote-validation-failed`) |
| 5 | Ollama 중지 → `--no-ai` 폴백으로 **배치 성공** | **통과(로컬 하네스)** | §5 표 행 4 (`--no-ai` 전달, `aiMode=off`, rc=0) |
| 6 | 러너 재기동 절차 1회(중지→기동→online 복귀) 원문 | **통과** | §3 원문 (kickstart 후 `online 복귀 (약 3s)`) |
| 7 | `test`·`build`·`lint:boundary` 회귀 없음 · 비밀값 0건 | **부분** | §5-2: boundary PASS · test **241 passed/0 fail** · `build` 는 **T16 진행 중 파일**(`tools/extract/enrich.ts`)에서 실패(내 변경분 아님) · 토큰 패턴 0건 |

## 2. 러너 등록 실측 (이 맥 · macOS 26.2 arm64)

```
$ curl -sSL -o actions-runner-osx-arm64-2.337.0.tar.gz …/v2.337.0/actions-runner-osx-arm64-2.337.0.tar.gz
$ shasum -a 256 actions-runner-osx-arm64-2.337.0.tar.gz
5a2cd92908a93d7276a194e1de6008099f3e7946f3f8e14aa7a1a7b4a31fdec2   ← 릴리스 본문 SHA256 과 일치(검증 OK)

$ gh api -X POST repos/angalle/sunmoon-shuttle/actions/runners/registration-token --jq .token
registration token 발급 OK (길이 29) — 값은 출력하지 않는다   ← 토큰은 변수→config.sh 인자까지만, 로그/커밋 0건

$ ./config.sh --url https://github.com/angalle/sunmoon-shuttle --name ihuiseon-ui-MacBookPro-sunmoon \
    --labels self-hosted,macos,sunmoon --work …/_work --unattended --replace
√ Connected to GitHub
√ Runner successfully added
√ Settings Saved.

$ gh api repos/angalle/sunmoon-shuttle/actions/runners | jq -c '{total_count, runners:[.runners[]|{name,status,busy,labels:[.labels[].name]}]}'
{"total_count":1,"runners":[{"name":"ihuiseon-ui-MacBookPro-sunmoon","status":"online","busy":false,
  "labels":["self-hosted","macOS","ARM64","sunmoon"]}]}
```

- 설치 위치 `~/actions-runner-sunmoon`(저장소 밖) · 서비스는 launchd LaunchAgent(`…/LaunchAgents/actions.runner.angalle-sunmoon-shuttle.ihuiseon-ui-MacBookPro-sunmoon.plist`).
- ⚠️ **라벨 실측**: 소문자 `macos` 를 넘겨도 GitHub 이 기본 라벨 `macOS` 로 흡수해 **`macos` 라는 별도 라벨은 생기지 않는다**.
  → `extract.yml` 의 `runs-on` 은 실측 그대로 `[self-hosted, macOS, sunmoon]` 로 적었다(대소문자 차이로 잡이 큐에 남는 사고 방지).
- ⚠️ **plist 에 `KeepAlive` 를 추가**했다(기본 생성물엔 없다). 프로세스가 죽으면 launchd 가 즉시 되살린다.
- 러너 `.env`: `PATH=/opt/homebrew/bin:…` (LaunchAgent 는 로그인 셸 PATH 가 없다) + `SUNMOON_STATE_DIR`.
- 보안: 저장소가 **public** 이다 → 트리거를 `schedule`·`workflow_dispatch` 로만 제한(포크 PR 코드가 이 맥에서 실행될 경로 없음). 파일 상단 주석에 유지 규칙으로 명시.

## 3. 재기동 절차 실측 (수용 기준 6)

```
$ bash .github/runner/recover.sh restart-runner
러너 재기동: /Users/leeheesun/actions-runner-sunmoon
stopping actions.runner.angalle-sunmoon-shuttle.ihuiseon-ui-MacBookPro-sunmoon … Stopped
starting … Started: - 0 actions.runner.…            ← launchctl load 는 "Started" 라고만 보고
launchd 스폰 지연 감지 — kickstart 시도
리스너 프로세스 기동 확인
online 복귀 (약 3s)
restart-runner exit=0

$ gh api repos/angalle/sunmoon-shuttle/actions/runners --jq '.runners[0] | "\(.name) status=\(.status) busy=\(.busy)"'
ihuiseon-ui-MacBookPro-sunmoon status=online busy=false
$ pgrep -fl Runner.Listener
50370 …/bin/Runner.Listener run --startuptype service
```

**발견(중요)**: macOS 26.2 에서 `launchctl load -w` 가 "Started" 를 보고해도 실제 스폰이 보류되는 상태가 재현된다
(`launchctl print` → `pended nondemand spawn = speculative`, `runs = 0`). 그래서 `recover.sh restart-runner` 는
**① 프로세스 확인 → ② `kickstart -k` → ③ 그래도 없으면 `bootout`+`bootstrap` 재적재** 로 굳혔다(커밋 2).

**발견(감시 필요)**: 러너의 `broker.actions.githubusercontent.com/message` **long-poll 이 100초 타임아웃** 후
backoff 재시도에 들어가고, 그 사이 GitHub 은 러너를 `offline` 로 본다(diag 원문: `GET request to
https://broker.actions.githubusercontent.com/message?sessionId=…&status=Online&… timed out after 100 seconds`,
이어서 `Back off …`). 즉 **러너는 스스로를 감시할 수 없다** → 감시를 러너 밖(LaunchAgent)에 두었다(§7).

## 4. `extract.yml` — 스케줄·단계(정본 구현)

```
$ grep -n cron .github/workflows/extract.yml
41:    - cron: '10 20 * * *'     # 05:10 KST (전날 20:10 UTC)
42:    - cron: '10 8 * * *'      # 17:10 KST
```

- `runs-on: [self-hosted, macOS, sunmoon]` · `timeout-minutes: 45` · `concurrency.group: data-publish`
- 단계: 체크아웃 → **러너 환경 확인(node≥26·jq·git·gh)** → `npm ci` → **T16 CLI 존재 확인** → 마지막 정상 JSON 백업 →
  **Ollama 준비 확인 + AI 모드 결정** → 직전 배치 신선도 점검 → **추출 실행**(`npm run extract -- --local … --no-ai|--model=…`) →
  계약 JSON 최소 검증 → 테스트 → 발행 요약 → **변경 감지(fetchedAt 제외)** → main 커밋/PR →
  성공 기록(`last-success.json`) → **실패 처리(커밋본 복원 + 알림)** → 아티팩트 업로드(로그·JSON·alerts).
- AI 모델 **고정값**: `SUNMOON_AI_MODEL = lfm2.5:latest` (워크플로 env 한 곳이 정본, 항상 `--model=` 로 전달).
  러너에 설치된 모델: `qwen2.5vl:7b`·`qwen3-vl:4b`·`qwen3-vl:8b`·`minicpm-v`·`lfm2.5`.
- **자동 크롤 없음**: 입력은 커밋된 스냅샷(`data/raw/*.html`)뿐이다(`--local`). robots.txt `Disallow: /Page`(= `/Page2/…` 포함) 준수.
  ※ `docs/01` 부록 A 파이프라인 ①("원본 스냅샷 수집(기존 크롤러)")과 이 결정의 관계 → **총괄 확인 필요**(§6-③).
- 역할 분리: `scrape.yml` 은 **수동 전용 유지**, 두 워크플로가 같은 `concurrency.group: data-publish` 를 공유(발행 직렬화).
- `actionlint` 전 워크플로 **0건**(`.github/actionlint.yaml` 에 커스텀 라벨 `sunmoon` 등록).

## 5. 검증 실측

### 5-1. 스텝 셀 실행 하네스 5시나리오 (extract.yml `run:` **원문**을 샌드박스 git 저장소에서 실행)

하네스: `run_steps.py`(스크래치) — `${{ }}`·`if:` 를 이 워크플로에 나오는 형태만 해석, `npm ci`/``uses:`` 스텝만 대체.
원출력: `harness-{same,change,fail,ollama-down,stale}.txt`.

| 시나리오 | 결과 | 데이터 커밋 | alerts.log | 스텁이 받은 인자 |
|---|---|---|---|---|
| 무변경(`same`) | 성공 | **0건** ✓ | 없음 | `--local data/raw/snapshot.html --model=lfm2.5:latest` |
| 내용 변경(`change`) | 성공 | **1건** ✓ | 없음 | 위와 동일 |
| 추출 실패(`fail`, 반쪽 산출물+exit 1) | 추출 스텝 실패 → 후속(검증·테스트·커밋) 전부 **skip** | **0건** ✓ | **1건** `kind=quote-validation-failed … 발행 중단, 마지막 정상 JSON 유지` | 위와 동일 |
| Ollama 중지(`ollama-down`, 죽은 포트) | 성공 | 0건 | **1건** `kind=ollama-down … --no-ai 폴백` | `--local … --no-ai` ✓ |
| 직전 성공 71.7h 전(`stale`) | 성공 | 0건 | **1건** `kind=stale-batch 직전 배치 성공이 71.7h 전(>24h)` | 위와 동일 |
| 실패 후 복원 | `prev exists=True cur==prev → True` (반쪽 JSON 이 커밋본으로 복원) | — | — | — |

### 5-2. 저장소 회귀 (내 변경분 반영 후)

```
$ npm run lint:boundary
PASS [경계①/domain 순수성] src/domain — 브라우저·네트워크·환경·시계 API 사용 0건
PASS [경계②/application→adapters] src/application — adapters import 0건
BOUNDARY: PASS (위반 0건)

$ npm run test
Test Files  20 passed (20)
     Tests  241 passed (241)

$ npm run build
tools/extract/enrich.ts(66,5): error TS2322: … Property 'extraction' is missing …   ← **T16 진행 중 파일**의 타입 오류
```

`build` 실패 1건은 **T16(`tools/extract/**`) 미완성 코드**에서 발생했다(동시 작업 중). 내 변경은 `tsc`/`vite` 빌드 대상이
아닌 `.github/**` 뿐이므로 **내 변경분의 회귀는 없다**. (T16 완료 후 재확인 필요.)

### 5-3. 비밀값

```
$ git grep -nE "(gho_|ghp_|github_pat_|ghs_|registration-token=.|token=[A-Za-z0-9]{20,})" -- .github
(토큰 패턴 0건)
$ git ls-files .github | grep -E "\.credentials|\.runner$|\.env$"
(자격증명 파일 커밋 0건)
```

## 6. 남은 게이트 / 판단 필요 (총괄·사용자)

1. **`main` push 승인** — `extract.yml` 은 `workflow_dispatch` 로 돌리려면 **main(default branch)에 있어야** 한다.
   그런데 이 저장소의 `main` 은 origin 보다 앞서 있고 push 하면 `deploy.yml` 이 함께 돌아 **누적 커밋(T5~T13) 전체가 Pages 에 배포**된다.
   `docs/04` 는 이 push 를 **사용자 승인 사안**으로 적어 두었다 → **내 판단으로 뒤집지 않았다.** 승인 시 즉시
   `gh workflow run extract.yml` 로 dispatch 실측(#2·#3·#4·#5의 CI 경로)을 마치겠다.
2. **T16 CLI 의존** — `package.json` 에 `extract` 스크립트가 아직 없다(T16 진행 중). 워크플로는 이 경우
   `::error:: extract 스크립트 없음 …` 으로 **즉시 실패**하도록 해 두었다(조용한 통과 금지). T16 이 `npm run extract` 계약
   (`--local`, `--no-ai`, `--model=`, `--dry-run`)을 그대로 내면 워크플로 수정 없이 돈다.
3. **문서 불일치(발견 보고 — `docs/**` 는 0줄 유지)** — `docs/01` 부록 A 파이프라인 ①이 "원본 스냅샷 수집(기존 크롤러)"을
   스케줄 경로에 두는데, 같은 문서 `§8` 실측(robots `Disallow: /Page` → `/Page2` 차단)과 충돌한다. 이 구현은
   **크롤 없이 커밋된 스냅샷만 재파싱**하는 쪽으로 정리했다(학기 개편 시 사람이 스냅샷 1회 커밋 → 다음 스케줄이 반영).
   문서 문구를 맞출지 총괄 판단 필요.
4. **러너 오프라인 플랩** — 위 §3 발견. 감시(30분)가 자동 복구하므로 스케줄 잡은 지연 실행되지만, 근본 원인(long-poll
   타임아웃)이 GitHub 브로커/네트워크 구간이라 이 맥에서 고칠 수단이 없다(관측·자동복구로 완화). 실측상 재기동 후 3초 내 online 복귀.

## 7. 모니터링·복구 구현 (docs/02 부록 A 구현물)

- `recover.sh status|check|watch|restart-runner|restart-ollama|install-watch|uninstall-watch`
- `install-watch` → LaunchAgent `com.user.sunmoon-batch-watch`(StartInterval 1800s, RunAtLoad) 로 **30분마다**
  러너 online · Ollama 응답 · 마지막 배치 성공 24h 를 점검하고, 이상 시 `~/.sunmoon-shuttle-batch/alerts.log` 에 1줄
  (같은 kind 60분 중복 억제) + 데스크톱 알림 + 러너 자동 복구 1회.
- 실측 사고: launchd 는 **`~/Documents` 하위를 읽을 수 없다**(`TCC`: `/bin/bash: …/recover.sh: Operation not permitted`)
  → `install-watch` 가 스크립트 사본을 `~/actions-runner-sunmoon/recover.sh` 로 복사해 그 사본을 실행한다(주석·plist 에 명시).
- 상태 파일(`SUNMOON_STATE_DIR=~/.sunmoon-shuttle-batch`): `last-run.json`(모든 실행) · `last-success.json`(마지막 성공) ·
  `alerts.log`(알림) · `watch.out|err.log`. 워크플로는 같은 내용을 **아티팩트**(`batch-<run_id>`, 30일)로도 올린다.
- 알림 경로: 로컬 `alerts.log`(러너가 죽어도 남음) + GH Actions 실패 알림(저장소 Watch → Actions) + 데스크톱 알림.
  **총괄 DM 경로는 총괄 소관**으로 남긴다(이 워커는 메시징 채널이 없다) — 기록은 남겨 두었다.

## 8. 롤백

- 데이터: `git revert <배치 커밋>` 1회 → `deploy.yml` 이 자동 재배포(앱은 마지막 정상 JSON 유지).
- 워크플로: `extract.yml` 삭제 또는 `schedule` 블록 제거 → dispatch/스케줄 중단.
- 러너 철회: `cd ~/actions-runner-sunmoon && ./svc.sh uninstall` + `bash .github/runner/recover.sh uninstall-watch`
  + `gh api -X DELETE repos/angalle/sunmoon-shuttle/actions/runners/<id>`.

---

## 9. 재시도(run 25) 확인 — CI 경로 게이트 원문 (이 절이 §1 표 2행 표기를 대체한다)

작성: infraprojectcreator · 2026-10-06 (KST) · 재시도 run 25 · 재구현 없이 **커밋 + 수용기준 실증**만 수행

### 9-1. 수용 기준 2~5의 **CI 실측은 push 승인 전까지 실행 자체가 불가** — 실측 원문

```
$ gh workflow run extract.yml
HTTP 404: workflow extract.yml not found on the default branch (https://api.github.com/repos/angalle/sunmoon-shuttle/actions/workflows/extract.yml)

$ gh api -X POST repos/angalle/sunmoon-shuttle/actions/workflows/extract.yml/dispatches -f ref=main
{"message":"Not Found","documentation_url":"https://docs.github.com/rest/actions/workflows#create-a-workflow-dispatch-event","status":"404"}

$ gh workflow list
deploy  active  375029231
scrape  active  375029232          ← extract 는 원격에 없음

$ git rev-list --left-right --count origin/main...HEAD
0	33                             ← 로컬 main 이 origin 보다 33커밋 앞(미push)

$ sed -n '82p' docs/04-tasks.md
- 배포 주의: 최신 배포본은 T5 시점(run 37270216029 …) — … `main` 은 origin 보다 12커밋 앞이며 push(=배포 트리거)는 **사용자 승인 사안**.
```

→ `workflow_dispatch` 는 **default branch(`main`)에 워크플로 파일이 있어야** 동작한다. 그래서 수용 기준 2(수동 dispatch)와
그에 종속된 3·4·5의 **CI 실측**은 `main` push(= Pages 배포) 승인 **이후**에만 가능하다(§6-1). 배포성 push 는 이 워커가 하지 않는다.

### 9-2. 이번 회차 재검증 (원출력)

- 러너 online 재확인:
  `total_count=1 · name=ihuiseon-ui-MacBookPro-sunmoon · status=online · busy=false · version=2.337.0 · labels=['self-hosted','macOS','ARM64','sunmoon']`
  · 리스너 `pgrep -fl Runner.Listener` → pid 50370.
- `extract.yml` sha256 `28b439d4e38c10b86445368402fc54539557b6d68a909bec3e4f09bac68a3551` (커밋본과 동일 — 하네스는 이 파일을 입력으로 실행).
- 하네스 **5시나리오 재실행**(현 `extract.yml` 기준) — 원출력 `scratch/evidence/harness-{same,change,fail,ollama-down,stale}.txt`:

  | 시나리오 | 데이터 커밋 | alerts.log | 핵심 원문 |
  |---|---|---|---|
  | `same` | **0건** | 없음 | `fetchedAt 외 내용 동일 → 데이터 변경 없음 → 커밋 0건` · `prev exists=True cur==prev → True` |
  | `change` | **1건** | 없음 | `[main 04293fd] data: 배치 v2 반영 — 학기미상 · 노선 1 · 평일행 1 · sha256:b38a1242e8f4` |
  | `fail` | **0건** | **1건** `kind=quote-validation-failed … 발행 중단, 마지막 정상 JSON 유지` | 추출 스텝 rc=1 → 후속(검증·테스트·발행·커밋) 전부 skip · `cur==prev → True` |
  | `ollama-down` | 0건 | **1건** `kind=ollama-down … --no-ai 폴백` | `npm run extract -- --local data/raw/snapshot.html --no-ai` · rc=0 · `ai=off` |
  | `stale` | 0건 | **1건** `kind=stale-batch 직전 배치 성공이 71.7h 전(>24h)` | 경고만, 배치 성공 |

- `actionlint .github/workflows/*.yml` → rc=0(경고 0건).
- 비밀값: `git grep` 토큰 패턴 **0건** · 자격증명 파일(`.credentials`/`.runner`/`.env`) 커밋 **0건**.
- `.tmp-probe/` 는 `src/adapters/in/web/…`(T14 UI)를 import 하는 프런트 프로브로 **T14 소관** → 이 워커는 손대지 않았다.

### 9-3. 남은 게이트 = 사람 결정 1건

`main` push 승인 여부. 승인되면 `gh workflow run extract.yml` 1회로 수용 기준 2~5의 CI 실측(스케줄 등록 확인 포함)을 즉시 마치고 회신한다.
(T16 `npm run extract` = `tsx tools/extract/index.ts` 가 이번 회차에 `package.json`·`tools/extract/**` 로 착지 중이며, 커밋되면 워크플로는 수정 없이 그대로 돈다.)
