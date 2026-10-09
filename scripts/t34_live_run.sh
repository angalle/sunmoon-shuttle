#!/usr/bin/env bash
# T34 **실 DeepSeek 1회 실행** 증거(docs/08 §9 AC-AI1-7) — 키 값·응답 원문은 출력하지 않는다.
#
#   run1 : 내용 해시 캐시가 빈 상태 → 표 페이지 10개 + 문장 분류 호출(호출·토큰 기록)
#   run2 : 같은 입력 재실행 → 표 호출 `calls: 0`(해시 캐시) — AC-AI1-3 실측
#   비교 : 발행본(source 제외)이 실행 전 발행본과 동일(규칙 정본 유지) — AC-AI1-7
#
# 산출물: .session-notes/T34-live-run1.txt · T34-live-run2.txt · T34-live-summary.txt
# 사용:   bash scripts/t34_live_run.sh   (키: ~/.hermes/profiles/apiprojectcreator/.env 의 DEEPSEEK_API_KEY)
set -u

cd "$(dirname "$0")/.." || exit 1
NOTES=.session-notes
WORK=tmp/t34-live
ENV_FILE="$HOME/.hermes/profiles/apiprojectcreator/.env"
MODEL=deepseek-v4-flash
BASE_URL=https://api.deepseek.com/v1
NOW=2026-10-09T10:00:00+09:00

mkdir -p "$WORK" "$NOTES"
cp data/timetable.json "$WORK/pre-live-timetable.json"

KEY=$(grep -E '^(export +)?DEEPSEEK_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2-)
KEY=$(printf '%s' "$KEY" | tr -d '"' | tr -d "'" | tr -d '[:space:]')
if [ -z "$KEY" ]; then
  echo "DEEPSEEK_API_KEY 를 $ENV_FILE 에서 찾지 못했다 — 실 실행 불가"
  exit 3
fi
echo "key present (값 미출력) · model=$MODEL"

live() { # tag
  AI_API_KEY="$KEY" AI_BASE_URL="$BASE_URL" AI_MODEL="$MODEL" \
    npm run extract -- --ai=api --local --now "$NOW" \
    --out data/timetable.json --log "$NOTES/T34-live-$1-log.json" \
    --ai-cache "$NOTES/T34-ai-table-cache.json" \
    --ai-draft "$NOTES/T34-ai-table-draft.json" \
    --ai-report "$NOTES/T34-ai-table-report.json" \
    > "$NOTES/T34-live-$1.txt" 2>&1
  echo $?
}

R1=0
R2=0
LIVE_FAILED=0
MODE="${1:-both}"
if [ "$MODE" = "both" ]; then TAGS="run1 run2"; else TAGS="$MODE"; fi
for TAG in $TAGS; do
  R=$(live "$TAG")
  echo "$TAG exit=$R"
  [ "$R" -ne 0 ] && LIVE_FAILED=1
  case "$TAG" in
    run1) R1=$R ;;
    run2) R2=$R ;;
  esac
done

{
  echo "T34 실 DeepSeek 실행 요약 — $(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "  model=$MODEL · --now $NOW · run1 exit=$R1 · run2 exit=$R2 (기대 0/0)"
  echo "  run1 로그: $(grep -E 'AI 표:|AI 표 검증 4종' "$NOTES/T34-live-run1.txt" | tr '\n' ' ')"
  echo "  run2 로그: $(grep -E 'AI 표:|AI 표 검증 4종' "$NOTES/T34-live-run2.txt" | tr '\n' ' ')"
  node -e '
    const fs = require("fs");
    const live = JSON.parse(fs.readFileSync("data/timetable.json", "utf8"));
    const pre = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const core = (body) => { const { source, ...rest } = body; void source; return JSON.stringify(rest); };
    console.log(`  발행본 aiExtract = ${JSON.stringify(live.source.extraction.aiExtract)}`);
    console.log(`  규칙 정본(source 제외) 실행 전후 동일 = ${core(live) === core(pre)}`);
    console.log(`  provider=${live.source.extraction.provider} · model=${live.source.extraction.model}`);
  ' "$WORK/pre-live-timetable.json"
  echo "  ── 검증 리포트(실 API) 페이지별 대조 수치(앞 3건) ──"
  node -e '
    const fs = require("fs");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const page of report.pages.slice(0, 3)) {
      const time = page.checks.find((c) => c.id === "time-set");
      const rows = page.checks.find((c) => c.id === "row-count");
      console.log(`    ${page.page.split("/").pop()} [${page.status}] ${time ? time.detail : ""} | ${rows ? rows.detail : ""}`);
    }
    console.log(`    전체: 통과 ${report.pages.filter((p) => p.status === "ok").length}개 · 폐기 ${report.dropped.length}개 · 치명 ${report.fatal.length}건 · agreedRows=${report.agreedRows} · disagreedRows=${report.disagreedRows} · calls=${report.calls} · tokens=${report.totalTokens}`);
  ' "$NOTES/T34-ai-table-report.json"
} | tee "$NOTES/T34-live-summary.txt"

if [ "$LIVE_FAILED" -ne 0 ]; then
  echo "T34 LIVE DEEPSEEK: FAIL(exit != 0) — 발행물/캐시/리포트를 확인하라"
  exit 1
fi
echo "T34 LIVE DEEPSEEK: PASS"
