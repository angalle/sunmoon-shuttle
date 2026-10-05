#!/usr/bin/env bash
# .github/runner/install-runner.sh — sunmoon-shuttle self-hosted 러너 설치·등록 (T15 infraprojectcreator)
#
# 이 맥(ihuiseon-ui-MacBookPro, macOS 26.2 arm64)에 GitHub Actions self-hosted 러너를 설치하고
# launchd 로 상시 실행되게 등록한다. 재현 가능하게 스크립트로 굳혀 둔 것이고, 아래 순서를 그대로 밟는다.
#
#   1) 릴리스 tarball 다운로드 → **SHA256 검증**(릴리스 본문의 osx-arm64 해시)
#   2) registration token 발급(`gh api …/registration-token`) — **출력·로그에 남기지 않는다**(길이만 확인)
#   3) ./config.sh 로 등록(라벨: self-hosted,macos,sunmoon · work: _work)
#   4) 러너 .env 작성(PATH — LaunchAgent 는 로그인 셸 PATH 가 없다)
#   5) ./svc.sh install → launchd LaunchAgent 생성 + 시작
#   6) plist 에 **KeepAlive** 추가(프로세스가 죽으면 launchd 가 즉시 되살린다) + 재적재
#   7) `gh api …/actions/runners` 로 online 확인
#
# 전제: gh 로그인(저장소 관리자 권한) · 인터넷. 실행 후 등록 상태는 `recover.sh status` 로 본다.
# 주의: registration/removal token 은 **일회용·단명(1시간)** 이며 비밀값이다. 이 스크립트는 토큰을
#       stdout/파일로 절대 내보내지 않는다(변수 → config.sh 인자까지만). 문서·커밋에도 남기지 않는다.
#
# 사용: bash .github/runner/install-runner.sh [--repo owner/name] [--dir ~/actions-runner-sunmoon] [--name <러너이름>]
set -euo pipefail

REPO="${SUNMOON_REPO:-angalle/sunmoon-shuttle}"
RUNNER_HOME="${SUNMOON_RUNNER_HOME:-$HOME/actions-runner-sunmoon}"
RUNNER_NAME="${SUNMOON_RUNNER_NAME:-$(scutil --get LocalHostName)-sunmoon}"
LABELS="self-hosted,macos,sunmoon"
STATE_DIR="${SUNMOON_STATE_DIR:-$HOME/.sunmoon-shuttle-batch}"

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --dir)  RUNNER_HOME="$2"; shift 2 ;;
    --name) RUNNER_NAME="$2"; shift 2 ;;
    *) echo "알 수 없는 인자: $1"; exit 2 ;;
  esac
done

command -v gh >/dev/null || { echo "gh 가 필요하다"; exit 1; }
command -v jq >/dev/null || { echo "jq 가 필요하다"; exit 1; }

# ── 1) 릴리스 확인 + tarball 다운로드 + SHA256 검증 ───────────────────────────
TAG="$(gh api repos/actions/runner/releases/latest --jq .tag_name)"
ASSET="actions-runner-osx-arm64-${TAG#v}.tar.gz"
URL="https://github.com/actions/runner/releases/download/${TAG}/${ASSET}"
EXPECTED="$(gh api repos/actions/runner/releases/latest --jq .body \
  | grep -o "BEGIN SHA osx-arm64 -->[0-9a-f]\{64\}" | grep -o '[0-9a-f]\{64\}' | head -1)"
[ -n "$EXPECTED" ] || { echo "릴리스 본문에서 osx-arm64 SHA256 를 찾지 못했다"; exit 1; }

mkdir -p "$RUNNER_HOME"
cd "$RUNNER_HOME"
if [ ! -f "$ASSET" ]; then
  echo "다운로드: $URL"
  curl -sSL -o "$ASSET" "$URL"
fi
ACTUAL="$(shasum -a 256 "$ASSET" | awk '{print $1}')"
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "SHA256 불일치 — 중단한다."
  echo "  expected=$EXPECTED"
  echo "  actual  =$ACTUAL"
  exit 1
fi
echo "SHA256 검증 OK ($ASSET · ${ACTUAL:0:12}…)"

if [ ! -x ./config.sh ]; then
  tar xzf "$ASSET"
fi

# ── 2) registration token (값은 출력하지 않는다) ──────────────────────────────
TOKEN="$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)"
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then echo "registration token 발급 실패"; exit 1; fi
echo "registration token 발급 OK (길이 ${#TOKEN}) — 값은 출력하지 않는다"

# ── 3) 등록 ──────────────────────────────────────────────────────────────────
set +e
./config.sh --url "https://github.com/$REPO" --token "$TOKEN" \
  --name "$RUNNER_NAME" --labels "$LABELS" \
  --work "$RUNNER_HOME/_work" --unattended --replace > config.out 2>&1
rc=$?
set -e
sed -i '' "s|$TOKEN|****REDACTED****|g" config.out
unset TOKEN
[ "$rc" -eq 0 ] || { echo "config.sh 실패(exit $rc)"; cat config.out; exit "$rc"; }
echo "등록 완료: name=$RUNNER_NAME labels=$LABELS"
grep -E "Runner successfully added|Settings Saved" config.out || true

# ── 4) 러너 .env (모든 step 에 주입) ─────────────────────────────────────────
printf 'SUNMOON_STATE_DIR=%s\nPATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin\n' \
  "$STATE_DIR" > .env
mkdir -p "$STATE_DIR"
echo "러너 .env 작성: $RUNNER_HOME/.env (PATH·SUNMOON_STATE_DIR)"

# ── 5) launchd 서비스 설치·시작 ───────────────────────────────────────────────
./svc.sh install
./svc.sh start

# ── 6) KeepAlive 추가 ────────────────────────────────────────────────────────
PLIST="$HOME/Library/LaunchAgents/actions.runner.${REPO//\//-}.${RUNNER_NAME}.plist"
if [ -f "$PLIST" ] && ! grep -q "<key>KeepAlive</key>" "$PLIST"; then
  /usr/libexec/PlistBuddy -c "Add :KeepAlive bool true" "$PLIST"
  echo "KeepAlive 추가: $PLIST"
  (cd "$RUNNER_HOME" && ./svc.sh stop && ./svc.sh start) || true
fi

# ── 7) online 확인 ───────────────────────────────────────────────────────────
for i in $(seq 1 20); do
  sleep 3
  if [ "$(gh api "repos/$REPO/actions/runners" --jq '[.runners[] | select(.status=="online")] | length')" = "1" ]; then
    echo "online 확인 (약 $((i*3))s)"
    gh api "repos/$REPO/actions/runners" --jq '.runners[] | "  \(.name) status=\(.status) labels=\([.labels[].name] | join(","))"'
    exit 0
  fi
done
echo "online 복귀 실패 — .github/runner/recover.sh status 로 진단"
exit 1
