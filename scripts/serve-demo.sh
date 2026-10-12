#!/usr/bin/env bash
#
# serve-demo.sh — 데모 실행 한 방에 (T36 · infraprojectcreator)
#
# 왜 필요한가 (재현된 장애)
#   `npm run build`(vite · build.emptyOutDir: true)는 **dist/ 를 통째로 비우고** 다시 만든다.
#   그런데 앱이 읽는 계약 데이터(`data/timetable.json`)는 vite 번들이 아니라 저장소 루트에 있어서
#   빌드 산출물에 자동으로 들어가지 않는다 → 데모 서버가 `dist/data/timetable.json` 을 잃고
#   `/data/timetable.json` 이 404 → 앱이 "데이터 로드 실패" 폴백으로 떨어진다(총괄 실측 2회).
#   그래서 "빌드 → 데이터 동봉 → 서빙"을 **한 스크립트로 묶는다**(같은 순서가 deploy.yml 에도 있다:
#   `.github/workflows/deploy.yml` 의 "계약 데이터 동봉" 스텝 — 로컬 데모만 그 순서가 빠져 있었다).
#
# 하는 일 (순서 고정)
#   ① (기본) `npm run build`   — tsc --noEmit + vite build → dist/
#   ② `data/timetable.json` → `dist/data/timetable.json` 복사(멱등 · 매번 덮어씀)
#   ③ `python3 -m http.server <port> --directory dist` 기동(백그라운드 · 로그는 .session-notes/demo-server.log)
#   ④ 기동 직후 자체 점검: `/` 200 · `/data/timetable.json` 200 · `/sw.js` 버전 자동 주입 여부
#      (public/sw.js 는 자리표시자, dist/sw.js 는 빌드가 주입한 실제 버전 — 서빙본이 dist 와 다르거나
#       dist 에 자리표시자가 남아 있으면 FAIL. T39 §16-3 로 수동 범프가 사라져 비교 기준이 바뀌었다)
#
# 안전 규칙
#   · 포트가 이미 점유돼 있으면 **기존 프로세스를 죽이지 않고** 안내만 하고 끝낸다(중복 리스너 방지).
#     → `npm run demo` 를 두 번 실행해도 리스너는 늘지 않는다(두 번째는 no-op).
#   · 정지는 `--stop` — 이 스크립트가 띄운 서버(pid 파일로 식별)만 정지한다. 남의 프로세스는 절대 건드리지 않는다.
#   · 빌드 실패·데이터 없음·자체 점검 실패는 조용히 넘어가지 않고 **즉시 실패(exit 1)** 한다
#     (404/빈 화면을 "성공"으로 보고하지 않는다).
#
# 사용법
#   npm run demo                     # 기본 포트 4190 · 빌드부터
#   npm run demo -- --port=4191      # 포트 변경 (또는 `PORT=4191 npm run demo`)
#   npm run demo -- --skip-build     # 빌드 생략(직전 dist 재사용)
#   npm run demo -- --bind=127.0.0.1 # 로컬 전용 바인드(기본은 모든 인터페이스 — 기존 데모와 동일)
#   npm run demo -- --stop           # 이 스크립트가 띄운 데모 서버 정지
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-4190}"
BIND="${BIND:-0.0.0.0}"
SKIP_BUILD=0
DO_STOP=0
PYTHON="${PYTHON:-python3}"

# 상태 파일: dist/ 는 .gitignore 대상이라 커밋되지 않는다(저장소에 지저분한 파일을 남기지 않는다).
PIDFILE="$ROOT/dist/.demo-server.pid"
LOGFILE="$ROOT/.session-notes/demo-server.log"   # .gitignore: .session-notes/*.log

say() { printf '[demo] %s\n' "$*"; }
die() { printf '[demo] 오류: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
serve-demo.sh — 데모 실행 한 방에 (빌드 → 계약 데이터 동봉 → 정적 서버 → 자체 점검)

  npm run demo                     # 기본 포트 4190 · 빌드부터
  npm run demo -- --port=4191      # 포트 변경 (또는 `PORT=4191 npm run demo`)
  npm run demo -- --skip-build     # 빌드 생략(직전 dist 재사용)
  npm run demo -- --bind=127.0.0.1 # 로컬 전용 바인드(기본 0.0.0.0 = 기존 데모와 동일)
  npm run demo -- --stop           # 이 스크립트가 띄운 데모 서버만 정지

포트가 이미 점유돼 있으면 기존 프로세스를 죽이지 않고 안내만 하고 끝난다(중복 리스너 방지).
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --port=*)  PORT="${1#*=}" ;;
    --port)    shift; PORT="${1:-}" ;;
    --bind=*)  BIND="${1#*=}" ;;
    --bind)    shift; BIND="${1:-}" ;;
    --skip-build) SKIP_BUILD=1 ;;
    --stop)    DO_STOP=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf '[demo] 알 수 없는 인자: %s\n\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

case "$PORT" in
  ''|*[!0-9]*) die "포트는 숫자여야 합니다: '$PORT' (예: --port=4190)" ;;
esac

# 포트를 점유한 프로세스 pid 목록(없으면 빈 문자열). macOS 기본 lsof · 실패해도 스크립트를 죽이지 않는다.
port_pids() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true; }
listeners() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true; }

# ── `--stop`: 이 스크립트가 띄운 서버만 정지 ────────────────────────────────────────
if [ "$DO_STOP" -eq 1 ]; then
  pid=""
  [ -f "$PIDFILE" ] && pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && port_pids | grep -qx "$pid"; then
    kill "$pid"
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    rm -f "$PIDFILE"
    if kill -0 "$pid" 2>/dev/null; then die "pid $pid 가 아직 살아 있습니다 — 수동 확인: lsof -nP -iTCP:$PORT -sTCP:LISTEN"; fi
    say "정지 완료: pid $pid (포트 $PORT)"
    exit 0
  fi
  say "이 스크립트가 띄운 데모 서버를 찾지 못했습니다(pid 파일: ${PIDFILE#$ROOT/})."
  if [ -n "$(port_pids)" ]; then
    say "포트 $PORT 은 아직 점유 중이지만 이 스크립트가 띄운 프로세스가 아닙니다 — 남의 프로세스는 죽이지 않습니다:"
    listeners
    exit 1
  fi
  say "포트 $PORT 에 리스너가 없습니다 → 이미 정지 상태입니다."
  exit 0
fi

# ── ⓪ 중복 리스너 방지: 이미 떠 있으면 아무것도 하지 않는다(기존 프로세스 보존) ──────
if [ -n "$(port_pids)" ]; then
  say "포트 $PORT 은 이미 사용 중입니다 — 기존 프로세스를 죽이지 않고 종료합니다(중복 리스너 방지)."
  listeners
  if [ -f "$PIDFILE" ] && [ "$(cat "$PIDFILE" 2>/dev/null || true)" = "$(port_pids | tr '\n' ' ' | sed 's/ $//')" ]; then
    say "이 스크립트가 띄운 데모가 그대로 떠 있습니다 → 정지: npm run demo -- --stop"
  else
    say "위 프로세스는 이 스크립트가 띄운 것이 아닙니다(직접 띄운 데모). 정지 여부는 직접 판단하세요."
    say "새 포트로 띄우려면: npm run demo -- --port=4191"
  fi
  exit 0
fi

# ── ① 빌드 ──────────────────────────────────────────────────────────────────────
if [ "$SKIP_BUILD" -eq 1 ]; then
  say "① 빌드 생략(--skip-build) — dist/ 재사용"
  [ -f "$ROOT/dist/index.html" ] || die "dist/index.html 이 없습니다 — --skip-build 없이 실행하세요."
else
  say "① 빌드: npm run build (tsc --noEmit + vite build → dist/)"
  npm run build
fi

# ── ② 계약 데이터 동봉 (이 스텝이 빠지면 /data/timetable.json 404) ────────────────
say "② 계약 데이터 동봉: data/timetable.json → dist/data/"
[ -f "$ROOT/data/timetable.json" ] || die "data/timetable.json 이 없습니다 — 먼저 'npm run scrape' 로 발행물을 만드세요(404 상태로 데모를 띄우지 않습니다)."
mkdir -p "$ROOT/dist/data"
cp -f "$ROOT/data/timetable.json" "$ROOT/dist/data/timetable.json"
say "   dist/data/timetable.json $(wc -c < "$ROOT/dist/data/timetable.json" | tr -d ' ') bytes · sha256 $(shasum -a 256 "$ROOT/dist/data/timetable.json" | cut -c1-16)"

# ── ③ 정적 서버 기동 ────────────────────────────────────────────────────────────
command -v "$PYTHON" >/dev/null 2>&1 || die "$PYTHON 를 찾을 수 없습니다(PYTHON 환경변수로 지정 가능)."
mkdir -p "$(dirname "$LOGFILE")"
say "③ 정적 서버 기동: $PYTHON -m http.server $PORT --bind $BIND --directory dist"
nohup "$PYTHON" -m http.server "$PORT" --bind "$BIND" --directory "$ROOT/dist" >>"$LOGFILE" 2>&1 &
pid=$!
echo "$pid" > "$PIDFILE"

ready=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if curl -fs -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then ready=1; break; fi
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.5
done
if [ "$ready" -ne 1 ]; then
  kill "$pid" 2>/dev/null || true
  rm -f "$PIDFILE"
  die "서버가 포트 $PORT 에서 응답하지 않습니다 — 로그: ${LOGFILE#$ROOT/}"
fi
port_pids | grep -qx "$pid" || say "   주의: pid $pid 가 $PORT 리스너 목록에 없습니다(다른 프로세스가 응답 중일 수 있음)."

# ── ④ 자체 점검 (AC: / 200 · /data/timetable.json 200 · sw.js 버전 자동 주입·서빙 일치) ────
#    T39 §16-3 — SW_VERSION 은 빌드가 주입한다. 그래서 판정 기준은
#    ① public/sw.js = 자리표시자(주입 지점이 살아 있다) ② dist/sw.js = 주입된 실제 값 ③ 서빙본 = dist.
sw_version_of() { sed -n "s/^const SW_VERSION = '\([^']*\)';.*/\1/p" "$1" | head -1; }
SW_PLACEHOLDER='__SW_VERSION__'

code_index=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")
code_data=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/data/timetable.json")
sw_public="$(sw_version_of "$ROOT/public/sw.js")"
sw_dist="$(sw_version_of "$ROOT/dist/sw.js")"
sw_served="$(curl -sS "http://127.0.0.1:$PORT/sw.js" | sed -n "s/^const SW_VERSION = '\([^']*\)';.*/\1/p" | head -1)"
head_sha="$(git -C "$ROOT" rev-parse --short=7 HEAD 2>/dev/null || echo nogit)"
hash_src="$(shasum -a 256 "$ROOT/data/timetable.json" | cut -d' ' -f1)"
hash_dist="$(shasum -a 256 "$ROOT/dist/data/timetable.json" | cut -d' ' -f1)"

fail=0
say "④ 자체 점검(curl -o /dev/null -w)"
report() { # $1=항목 $2=실측 $3=기대 $4=판정대상(0=정상)
  if [ "$4" -eq 0 ]; then say "   PASS  $1 = $2"; else say "   FAIL  $1 = $2 (기대: $3)"; fi
}
[ "$code_index" = "200" ] || fail=1; report "/ HTTP 코드" "$code_index" "200" "$([ "$code_index" = "200" ] && echo 0 || echo 1)"
[ "$code_data" = "200" ]  || fail=1; report "/data/timetable.json HTTP 코드" "$code_data" "200" "$([ "$code_data" = "200" ] && echo 0 || echo 1)"
sw_injected=0
[ -n "$sw_dist" ] && [ "$sw_dist" != "$SW_PLACEHOLDER" ] || sw_injected=1
[ "$sw_injected" -eq 0 ] || fail=1
report "dist/sw.js SW_VERSION(빌드가 자동 주입)" "$sw_dist" "자리표시자 아님(주입됨)" "$sw_injected"
sw_served_ok=0
[ -n "$sw_dist" ] && [ "$sw_dist" = "$sw_served" ] || sw_served_ok=1
[ "$sw_served_ok" -eq 0 ] || fail=1
report "/sw.js 서빙본(서버가 내려준 값)" "$sw_served" "dist 와 동일" "$sw_served_ok"
sw_point_ok=0
[ "$sw_public" = "$SW_PLACEHOLDER" ] || sw_point_ok=1
[ "$sw_point_ok" -eq 0 ] || fail=1
report "public/sw.js 주입 지점(자리표시자)" "$sw_public" "$SW_PLACEHOLDER" "$sw_point_ok"
say "   INFO  dist 버전의 빌드 커밋=${sw_dist##*-} · 현재 HEAD=$head_sha (다르면 dist 는 옛 커밋 빌드 — 판정에는 쓰지 않음)"
[ "$hash_src" = "$hash_dist" ] || fail=1
report "동봉 데이터 sha256 원본=서빙본" "일치" "일치" "$([ "$hash_src" = "$hash_dist" ] && echo 0 || echo 1)"

if [ "$fail" -ne 0 ]; then
  say "자체 점검 실패 — 서빙은 계속하지만(진단용 로그 ${LOGFILE#$ROOT/}) 이 상태는 FAIL 입니다."
  exit 1
fi

say "데모 준비 완료 → http://127.0.0.1:$PORT/  (pid $pid · 로그 ${LOGFILE#$ROOT/})"
[ "$BIND" = "0.0.0.0" ] && say "   같은 네트워크의 다른 기기에서도 접속 가능(모든 인터페이스 바인드). 로컬 전용이면 --bind=127.0.0.1"
say "   정지: npm run demo -- --stop"
