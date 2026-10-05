#!/usr/bin/env bash
# .github/runner/recover.sh — sunmoon-shuttle 배치 v2 러너/배치 복구·감시 (T15 infraprojectcreator)
#
# docs/02-monitoring.md 부록 A 의 "복구 절차"를 실행 가능한 형태로 굳힌 스크립트다.
#   · 러너 재기동(launchd) → GitHub 에 online 복귀까지 확인
#   · Ollama 재기동 → 127.0.0.1:11434 응답 확인
#   · 지표 점검(러너 online · Ollama · 마지막 배치 성공 24h) → 이상 시 alerts.log 1줄(중복 억제)
#   · watch: 점검 + 자동 복구 1회 + macOS 알림 → LaunchAgent(30분 주기)로 상시 감시
#     **러너가 오프라인이면 러너 위에서 도는 워크플로는 스스로를 감시할 수 없다** — 그래서 감시는 러너 밖(이 LaunchAgent)에 둔다.
#
# 사용:
#   bash .github/runner/recover.sh status            # 현황(러너·프로세스·감시·Ollama·마지막 성공·알림 꼬리)
#   bash .github/runner/recover.sh restart-runner    # 중지 → 기동 → online 복귀 확인
#   bash .github/runner/recover.sh restart-ollama    # Ollama 재기동 → 응답 확인
#   bash .github/runner/recover.sh check             # 지표 점검(이상 시 alerts.log 기록, 종료코드 1)
#   bash .github/runner/recover.sh watch             # check + 러너 자동 복구 1회 + 데스크톱 알림
#   bash .github/runner/recover.sh install-watch     # LaunchAgent com.user.sunmoon-batch-watch 등록(30분)
#   bash .github/runner/recover.sh uninstall-watch   # LaunchAgent 해제
#
# 환경(기본값):
#   SUNMOON_RUNNER_HOME(~/actions-runner-sunmoon) · SUNMOON_STATE_DIR(~/.sunmoon-shuttle-batch)
#   SUNMOON_REPO(angalle/sunmoon-shuttle) · OLLAMA_URL(http://127.0.0.1:11434)
#   SUNMOON_ALERT_DEDUPE_MIN(60) — 같은 kind 알림을 이 시간 안에 중복 기록하지 않는다
set -uo pipefail

RUNNER_HOME="${SUNMOON_RUNNER_HOME:-$HOME/actions-runner-sunmoon}"
STATE_DIR="${SUNMOON_STATE_DIR:-$HOME/.sunmoon-shuttle-batch}"
REPO="${SUNMOON_REPO:-angalle/sunmoon-shuttle}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
DEDUPE_MIN="${SUNMOON_ALERT_DEDUPE_MIN:-60}"
WATCH_LABEL="com.user.sunmoon-batch-watch"
WATCH_PLIST="$HOME/Library/LaunchAgents/$WATCH_LABEL.plist"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$STATE_DIR"
ALERTS="$STATE_DIR/alerts.log"
LAST_SUCCESS="$STATE_DIR/last-success.json"

say() { printf '%s\n' "$*"; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# 같은 kind 가 DEDUPE_MIN 분 안에 이미 기록됐으면 건너뛴다(alerts.log 무한 증식 방지). 0 이면 억제하지 않는다.
recent_same_kind() {
  [ -f "$ALERTS" ] || return 1
  [ "$DEDUPE_MIN" -gt 0 ] || return 1
  node -e '
    const fs = require("fs");
    const [path, kind, min] = process.argv.slice(1);
    const cutoff = Date.now() - Number(min) * 60000;
    const lines = fs.readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = /^(\S+) kind=(\S+)/.exec(lines[i]);
      if (!m || m[2] !== kind) continue;
      return Date.parse(m[1]) > cutoff ? 0 : 1;
    }
    process.exit(1);
  ' "$ALERTS" "$1" "$DEDUPE_MIN"
}

alert() {  # $1=kind $2=message  (비밀값 금지 — 상태·경로·건수만)
  if recent_same_kind "$1"; then
    say "alert(중복 억제 ${DEDUPE_MIN}m): kind=$1 $2"
    return 0
  fi
  printf '%s kind=%s %s\n' "$(now)" "$1" "$2" | tee -a "$ALERTS"
}

notify() {  # $1=title $2=message — GUI 세션이 있으면 데스크톱 알림(실패해도 무시)
  command -v osascript >/dev/null 2>&1 || return 0
  osascript -e "display notification \"$(printf '%s' "$2" | tr '"' "'")\" with title \"$(printf '%s' "$1" | tr '"' "'")\"" >/dev/null 2>&1 || true
}

runner_status() {  # GitHub 이 보는 러너 상태(online/offline)
  gh api "repos/$REPO/actions/runners" --jq '.runners[] | "\(.name) \(.status) busy=\(.busy)"' 2>/dev/null
}

runner_online() {
  [ "$(gh api "repos/$REPO/actions/runners" --jq '[.runners[] | select(.status=="online")] | length' 2>/dev/null)" = "1" ]
}

ollama_up() { curl -sf --max-time 3 "$OLLAMA_URL/api/tags" >/dev/null 2>&1; }

stale_hours() {  # 마지막 배치 성공 이후 경과 시간(정수 h). 기록이 없으면 exit 1.
  [ -f "$LAST_SUCCESS" ] || return 1
  node -e '
    const fs = require("fs");
    try {
      const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const t = Date.parse(j.finishedAt || 0);
      if (!t) process.exit(1);
      process.stdout.write(String(Math.round((Date.now() - t) / 3600000)));
    } catch { process.exit(1); }
  ' "$LAST_SUCCESS" 2>/dev/null
}

cmd_status() {
  say "── 러너(launchd) ──"
  say "설치: $RUNNER_HOME"
  if [ -x "$RUNNER_HOME/svc.sh" ]; then (cd "$RUNNER_HOME" && ./svc.sh status); fi
  runner_status || say "(gh api 실패 — 네트워크/인증 확인)"
  say "── 로컬 프로세스 ──"
  pgrep -fl "Runner.Listener" || say "(Runner.Listener 없음)"
  say "── 감시 LaunchAgent ──"
  if [ -f "$WATCH_PLIST" ]; then
    launchctl list 2>/dev/null | grep -F "$WATCH_LABEL" || say "(등록 파일은 있으나 미로드)"
  else
    say "(미설치 — recover.sh install-watch)"
  fi
  say "── Ollama ──"
  if ollama_up; then say "Ollama 응답 OK ($OLLAMA_URL)"; else say "Ollama 무응답 ($OLLAMA_URL)"; fi
  say "── 마지막 배치 성공 ──"
  if [ -f "$LAST_SUCCESS" ]; then cat "$LAST_SUCCESS"; else say "(기록 없음: $LAST_SUCCESS)"; fi
  say "── alerts.log(끝 10줄) ──"
  if [ -f "$ALERTS" ]; then tail -10 "$ALERTS"; else say "(기록 없음: $ALERTS)"; fi
}

cmd_restart_runner() {
  say "러너 재기동: $RUNNER_HOME"
  (cd "$RUNNER_HOME" && ./svc.sh stop) || true
  sleep 2
  (cd "$RUNNER_HOME" && ./svc.sh start) || { alert runner-restart "svc.sh start 실패"; return 1; }
  local i
  for i in $(seq 1 20); do
    sleep 3
    if runner_online; then say "online 복귀 (약 $((i*3))s)"; return 0; fi
  done
  alert runner-offline "재기동 후 online 복귀 실패: $(runner_status)"
  return 1
}

cmd_restart_ollama() {
  say "Ollama 재기동"
  if ollama_up; then say "이미 응답 중 — 재기동 생략"; return 0; fi
  # CLI 설치를 우선 시도하고, 실패하면 앱 재실행으로 폴백
  if command -v ollama >/dev/null 2>&1; then nohup ollama serve >/dev/null 2>&1 & fi
  if [ -d "/Applications/Ollama.app" ]; then open -a Ollama || true; fi
  local i
  for i in $(seq 1 15); do
    sleep 2
    if ollama_up; then say "Ollama 응답 회복 (약 $((i*2))s)"; return 0; fi
  done
  alert ollama-down "재기동 후에도 $OLLAMA_URL 무응답"
  return 1
}

cmd_check() {  # docs/02 부록 A 지표 → 이상 시 alerts.log 1줄
  local rc=0 age
  if ! runner_online; then alert runner-offline "러너가 online 이 아님: $(runner_status)"; rc=1; fi
  if ! ollama_up; then alert ollama-down "$OLLAMA_URL 무응답"; rc=1; fi
  if age="$(stale_hours)"; then
    if [ "${age:-0}" -gt 24 ]; then alert stale-batch "마지막 배치 성공 ${age}h 전 (>24h)"; rc=1; fi
  fi
  [ "$rc" -eq 0 ] && say "check: 정상(러너 online · Ollama 응답 · 배치 신선도 ≤24h)"
  return "$rc"
}

cmd_watch() {
  local before after
  before="$(wc -l < "$ALERTS" 2>/dev/null || printf 0)"
  cmd_check || true
  # 러너 오프라인 → 1회 복구 시도(launchd 재적재 포함). KeepAlive 로 프로세스 사망은 이미 커버된다.
  if ! runner_online; then cmd_restart_runner || true; fi
  if ! ollama_up; then cmd_restart_ollama || true; fi
  after="$(wc -l < "$ALERTS" 2>/dev/null || printf 0)"
  if [ "${after:-0}" -gt "${before:-0}" ]; then
    notify "sunmoon 배치 경고" "$(tail -1 "$ALERTS")"
    say "watch: 알림 기록됨 → $ALERTS"
    return 1
  fi
  say "watch: 이상 없음"
  return 0
}

cmd_install_watch() {
  mkdir -p "$HOME/Library/LaunchAgents"
  mkdir -p "$RUNNER_HOME"
  # ⚠️ macOS TCC: launchd 가 실행하는 프로세스는 ~/Documents 하위(이 저장소)를 읽을 수 없다
  #    (실측: "/bin/bash: …/recover.sh: Operation not permitted"). 그래서 **홈 바로 아래**로 복사해
  #    그 사본을 LaunchAgent 가 실행한다. 저장소의 이 파일이 정본이고, install-watch 가 사본을 최신화한다.
  cp "$SELF_DIR/recover.sh" "$RUNNER_HOME/recover.sh"
  chmod +x "$RUNNER_HOME/recover.sh"
  local watch_script="$RUNNER_HOME/recover.sh"
  cat > "$WATCH_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- 생성: .github/runner/recover.sh install-watch (T15) — 배치 v2 상시 감시(30분 주기)
     실행 대상은 저장소가 아니라 $RUNNER_HOME 아래 사본이다(macOS TCC: launchd 는 ~/Documents 를 읽을 수 없다). -->
<plist version="1.0">
<dict>
  <key>Label</key><string>$WATCH_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$watch_script</string>
    <string>watch</string>
  </array>
  <key>StartInterval</key><integer>1800</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>SUNMOON_STATE_DIR</key><string>$STATE_DIR</string>
    <key>SUNMOON_REPO</key><string>$REPO</string>
  </dict>
  <key>StandardOutPath</key><string>$STATE_DIR/watch.out.log</string>
  <key>StandardErrorPath</key><string>$STATE_DIR/watch.err.log</string>
</dict>
</plist>
PLIST
  plutil -lint "$WATCH_PLIST" || return 1
  launchctl bootout "gui/$UID/$WATCH_LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$UID" "$WATCH_PLIST" || return 1
  say "등록 완료: $WATCH_PLIST (StartInterval=1800s, RunAtLoad)"
}

cmd_uninstall_watch() {
  launchctl bootout "gui/$UID/$WATCH_LABEL" >/dev/null 2>&1 || true
  rm -f "$WATCH_PLIST"
  say "해제: $WATCH_LABEL"
}

case "${1:-status}" in
  status)           cmd_status ;;
  restart-runner)   cmd_restart_runner ;;
  restart-ollama)   cmd_restart_ollama ;;
  check)            cmd_check ;;
  watch)            cmd_watch ;;
  install-watch)    cmd_install_watch ;;
  uninstall-watch)  cmd_uninstall_watch ;;
  *) say "사용: $0 [status|restart-runner|restart-ollama|check|watch|install-watch|uninstall-watch]"; exit 2 ;;
esac
