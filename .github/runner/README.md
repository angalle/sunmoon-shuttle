# .github/runner/ — 폐기된 "이 맥 러너 + 로컬 모델" 방식의 보존 문서 (T15)

> ## ⚠️ 현재 미사용 — 배치 파이프라인은 **GitHub 호스티드 러너**를 쓴다 (T20, 2026-10-06)
> `extract.yml` 은 `runs-on: ubuntu-latest` 로 돌고, AI 보강은 **외부 OpenAI 호환 API**
> (`AI_BASE_URL`·`AI_MODEL` + `secrets.AI_API_KEY`)로 한다. 이 디렉터리의 스크립트는 **더 이상 실행 경로에 없다.**
> 결정 근거: `docs/01-architecture.md` 부록 A-2 · `docs/00-requirements.md` 부록 A-2 · `docs/02-monitoring.md` 부록 A-2
> ("이 맥이 꺼져 있어도 배치가 돌아야 한다"가 우선 — 로컬 모델은 이 맥 상시 가동을 전제로 한다).
>
> 이 디렉터리는 **대안 경로를 재도입할 때를 위한 문서**로만 남긴다. 여기의 러너는 아직 등록·가동 중이므로
> 아래 "정리 절차"는 **총괄 승인 후에만** 실행한다(에이전트가 임의로 제거하지 않는다).

## 1. 무엇이 들어 있나

| 파일 | 역할 | 지금 상태 |
|---|---|---|
| `install-runner.sh` | 이 맥에 GitHub Actions 러너를 설치·등록(라벨 `macOS`,`sunmoon`), launchd `KeepAlive` 등록 | **미사용** — T15 산출물, 재도입 시 사용 |
| `recover.sh` | 러너/배치 복구·감시(`status`·`restart-runner`·`check`·`watch`·`install-watch`) | **미사용** — T15 산출물, 재도입 시 사용 |
| `runner.env.example` | 러너 `.env` 예시(`SUNMOON_STATE_DIR`·`PATH`) | 참고용 |
| 이 README | 대안 방식 설명 + **러너 정리(제거) 절차** | — |

## 2. 실측 상태 (2026-10-06 09:40 KST · T20 작업 시점)

```
$ gh api repos/angalle/sunmoon-shuttle/actions/runners --jq '.total_count'
1
$ gh api repos/angalle/sunmoon-shuttle/actions/runners --jq '.runners[] | "\(.name) status=\(.status) busy=\(.busy) labels=\([.labels[].name]|join(","))"'
ihuiseon-ui-MacBookPro-sunmoon status=online busy=false labels=self-hosted,macOS,ARM64,sunmoon

$ launchctl list | grep -E 'sunmoon|caffeinate'
50366   0   actions.runner.angalle-sunmoon-shuttle.ihuiseon-ui-MacBookPro-sunmoon   ← 러너 서비스(가동 중)
-       1   com.user.sunmoon-batch-watch                                            ← 감시 LaunchAgent(가동 중)
3275    0   com.user.caffeinate-forever                                              ← (무관: 24/7 정책)
```

즉 **등록은 남아 있고 online 이다.** 워크플로가 더 이상 이 러너를 요구하지 않으므로
(라벨 `sunmoon` 을 쓰는 워크플로 0건) 그대로 둬도 배치 동작에는 영향이 없다 —
다만 자원·감시 로그가 계속 도는 만큼, 사용자가 원하면 아래 절차로 정리한다.

## 3. 정리(제거) 절차 — **실행 금지 · 총괄 승인 필요**

> 이 절차는 문서화만 한다(T20 지시). 에이전트/워커는 실행하지 않는다.

```bash
REPO=angalle/sunmoon-shuttle
RUNNER_HOME="$HOME/actions-runner-sunmoon"
LABEL="actions.runner.angalle-sunmoon-shuttle.ihuiseon-ui-MacBookPro-sunmoon"

# 1) 감시 LaunchAgent 해제(먼저 — 감시가 러너를 되살리지 않게)
launchctl bootout "gui/$UID/com.user.sunmoon-batch-watch"
rm -f "$HOME/Library/LaunchAgents/com.user.sunmoon-batch-watch.plist"

# 2) 러너 서비스 중지·해제(launchd 등록 제거)
cd "$RUNNER_HOME"
./svc.sh stop
./svc.sh uninstall

# 3) GitHub 등록 해제 — removal token 은 **일회용·비밀값**이다.
#    값을 화면에 찍거나 셸 히스토리/파일/커밋에 남기지 않는다(아래처럼 변수로만 넘긴다).
TOKEN="$(gh api -X POST "repos/$REPO/actions/runners/remove-token" --jq .token)"
./config.sh remove --token "$TOKEN"
unset TOKEN

# 4) 확인 — 0 이어야 한다
gh api "repos/$REPO/actions/runners" --jq '.total_count'

# 5) (선택) 남은 설치 산출물 정리 — 되돌리려면 다시 설치해야 한다
#    rm -rf "$RUNNER_HOME"                     # 러너 바이너리·_work
#    rm -rf "$HOME/.sunmoon-shuttle-batch"     # T15 배치 상태(실행 로그·알림) — 감사 기록이므로 지우기 전 확인
```

**건드리면 안 되는 것(이 프로젝트와 무관):**
- `com.ollama.keepalive` — 로컬 모델 상시 가동용 사용자 LaunchAgent(다른 프로젝트도 쓴다)
- `com.user.caffeinate-forever` — 맥 24/7 유지 정책(사용자 명시 사항)

## 4. 되돌리기(재도입) — 호스티드 러너 방식을 폐기할 경우

```bash
# 1) 러너 재설치·등록(라벨: macOS · sunmoon) — registration token 값을 출력하지 않는다
bash .github/runner/install-runner.sh --repo angalle/sunmoon-shuttle

# 2) 감시 LaunchAgent 재등록(30분 주기)
bash .github/runner/recover.sh install-watch

# 3) extract.yml 을 다시 로컬 러너용으로 바꿔야 한다:
#    - runs-on 을 [self-hosted, macOS, sunmoon] 로 되돌리고
#    - AI 보강을 외부 API 대신 로컬 모델 경로로 바꾼다(AI_BASE_URL 을 로컬 엔드포인트로)
#    - `.github/actionlint.yaml` 의 self-hosted-runner 라벨 설정을 복원한다(현재 주석 처리 상태)
#    T20 이전 파일은 git 이력에서 볼 수 있다: `git show de24e05:.github/workflows/extract.yml`
```

이 되돌리기는 **비용·가용성 트레이드오프가 반대**다(외부 API 과금 0 ↔ 이 맥 상시 가동 필요).
결정 주체는 총괄·사용자다.
