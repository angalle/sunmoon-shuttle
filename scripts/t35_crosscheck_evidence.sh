#!/usr/bin/env bash
# T35 **교차검증(docs/08 §5)** 증거 — 모의 AI 서버 + **실 CLI 프로세스**(`npm run extract`). 실 API 호출 0 · 과금 0.
#
#   ① AC-AI1-4c① 값 모순 주입(행 값 맞바꿈) → **발행 보류**(exit 1 · 발행물 0건 · 보류 리포트에 사유)
#   ② AC-AI1-4a/4b 정답 초안 → ① 값 모순 0건 · ② key-shift 70행(32+38) · `agreedRows` 수치 · **발행 진행**
#   ③ AC-AI1-4c③ null-vs-값 주입 → **경고만** 남기고 규칙 정본으로 **정상 발행**
#
# 사용:  bash scripts/t35_crosscheck_evidence.sh
# 산출물: .session-notes/T35-crosscheck-*.txt (요약은 .session-notes/T35-crosscheck-evidence.txt)
set -u

cd "$(dirname "$0")/.." || exit 1
WORK=tmp/t35-evidence
NOTES=.session-notes
TSX=./node_modules/.bin/tsx
MOCK_PID=""
FAILED=0

rm -rf "$WORK"
mkdir -p "$WORK" "$NOTES"

ok()  { echo "  PASS  $1"; }
bad() { echo "  FAIL  $1"; FAILED=1; }

start_mock() { # mode port log
  "$TSX" tests/extract/run-mock-table-api.ts "$2" "$1" > "$3" 2>&1 &
  MOCK_PID=$!
  for _ in $(seq 1 60); do
    if grep -q "listening" "$3" 2>/dev/null; then return 0; fi
    sleep 0.5
  done
  return 1
}
stop_mock() {
  if [ -n "$MOCK_PID" ]; then kill "$MOCK_PID" 2>/dev/null; wait "$MOCK_PID" 2>/dev/null; MOCK_PID=""; fi
}
field() { # out.json dotted.path
  node -e '
    const fs = require("fs");
    const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    let value = body;
    for (const key of process.argv[2].split(".")) value = value === undefined || value === null ? undefined : value[key];
    process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
  ' "$1" "$2"
}
run_cli() { # tag extra...
  local tag="$1"; shift
  AI_BASE_URL="http://127.0.0.1:$PORT/v1" AI_MODEL=mock-table-v1 AI_API_KEY=dummy-not-a-real-key \
    npm run extract -- --local --ai=api \
    --out "$WORK/$tag-out.json" --log "$WORK/$tag-log.json" \
    --ai-cache "$WORK/$tag-cache.json" --ai-draft "$WORK/$tag-draft.json" --ai-report "$WORK/$tag-report.json" \
    --drift-report "$WORK/$tag-drift.json" --drift-table "$WORK/$tag-drift.txt" "$@" \
    >> "$NOTES/T35-crosscheck-$tag.txt" 2>&1
  echo $?
}

echo "════════ T35 교차검증(§5) 증거 실행 — 모의 서버 + 실 CLI ════════"

# ─────────── ① AC-AI1-4c① 값 모순 주입 → 발행 보류 ───────────
echo ""
echo "① AC-AI1-4c① — 값 모순 주입(정답 초안의 첫 두 행 시각 값 맞바꿈)"
PORT=8801
echo "" > "$NOTES/T35-crosscheck-contradict.txt"
start_mock contradict "$PORT" "$WORK/mock-contradict.log" || { echo "모의 서버 기동 실패"; cat "$WORK/mock-contradict.log"; exit 1; }
RC_C=$(run_cli contradict)
stop_mock
echo "  exit=$RC_C (기대 1)"
[ "$RC_C" -eq 1 ] && ok "값 모순 주입 → exit 1(발행 보류)" || bad "값 모순인데 exit=$RC_C"
[ -e "$WORK/contradict-out.json" ] && bad "발행물이 쓰였다" || ok "발행물 0건(data/timetable.json 미변경)"
grep -E "교차검증 차단|⛔" "$NOTES/T35-crosscheck-contradict.txt" | head -3
[ -e "$WORK/contradict-drift.json" ] && {
  echo "  보류 리포트: holdReason=$(field "$WORK/contradict-drift.json" holdReason) · published=$(field "$WORK/contradict-drift.json" published)"
  echo "  교차검증 합계: $(field "$WORK/contradict-drift.json" crossCheck | node -e 'const s=require("fs").readFileSync(0,"utf8");const c=JSON.parse(s);console.log(`① ${c.contradictedRows} · ② ${c.keyShiftRows} · ③ ${c.nullMismatchRows} · agreed ${c.agreedRows} · raw ${c.rawAgreedRows}/${c.rawDisagreedRows}`)')"
  echo "  차단 페이지 ${#} $(field "$WORK/contradict-drift.json" blockedPages | head -c 200)"
} || bad "보류 리포트가 없다(사유 기록 실패)"

# ─────────── ② AC-AI1-4a/4b 정답 초안 → ① 0건 · ② 70행 · 발행 진행 ───────────
echo ""
echo "② AC-AI1-4a/4b — 정답 초안(규칙 정본과 같은 조건) → 경고만 · 발행 진행"
PORT=8802
echo "" > "$NOTES/T35-crosscheck-faithful.txt"
start_mock faithful "$PORT" "$WORK/mock-faithful.log" || { echo "모의 서버 기동 실패"; cat "$WORK/mock-faithful.log"; exit 1; }
RC_F=$(run_cli faithful)
stop_mock
echo "  exit=$RC_F (기대 0)"
[ "$RC_F" -eq 0 ] && ok "정답 초안 → exit 0(발행 진행)" || bad "정답 초안인데 exit=$RC_F"
[ -e "$WORK/faithful-out.json" ] && ok "발행물 생성됨" || bad "발행물 없음"
if [ -e "$WORK/faithful-out.json" ]; then
  AE="$WORK/faithful-out.json"
  echo "  aiExtract: agreedRows=$(field "$AE" source.extraction.aiExtract.agreedRows) · keyShiftRows=$(field "$AE" source.extraction.aiExtract.keyShiftRows) · nullMismatchRows=$(field "$AE" source.extraction.aiExtract.nullMismatchRows) · contradictedRows=$(field "$AE" source.extraction.aiExtract.contradictedRows) · rowSetMismatchRows=$(field "$AE" source.extraction.aiExtract.rowSetMismatchRows) · raw=$(field "$AE" source.extraction.aiExtract.rawAgreedRows)/$(field "$AE" source.extraction.aiExtract.rawDisagreedRows)"
  echo "  drift: $(field "$AE" source.extraction.aiExtract.drift)"
  [ "$(field "$AE" source.extraction.aiExtract.contradictedRows)" = "0" ] && ok "① 값 모순 0건" || bad "① 값 모순 ≠ 0"
  [ "$(field "$AE" source.extraction.aiExtract.keyShiftRows)" = "70" ] && ok "② key-shift 70행(32+38) — 경고만 · 발행 진행" || bad "② key-shift ≠ 70"
  [ "$(field "$AE" source.extraction.aiExtract.rawDisagreedRows)" = "70" ] && ok "정규화 전 raw 78/70(T34 실측과 동일)" || bad "raw 카운트 불일치"
fi

# ─────────── ③ AC-AI1-4c③ null-vs-값 주입 → 경고만 · 정상 발행 ───────────
echo ""
echo "③ AC-AI1-4c③ — null-vs-값 주입(규칙이 비운 열에 AI 가 값 하나를 넣음)"
PORT=8803
echo "" > "$NOTES/T35-crosscheck-nullmiss.txt"
start_mock nullmiss "$PORT" "$WORK/mock-nullmiss.log" || { echo "모의 서버 기동 실패"; cat "$WORK/mock-nullmiss.log"; exit 1; }
RC_N=$(run_cli nullmiss)
stop_mock
echo "  exit=$RC_N (기대 0)"
[ "$RC_N" -eq 0 ] && ok "null-vs-값 → exit 0(경고만 · 정상 발행)" || bad "null-vs-값인데 exit=$RC_N"
[ -e "$WORK/nullmiss-out.json" ] && ok "발행물 생성됨" || bad "발행물 없음"
if [ -e "$WORK/nullmiss-out.json" ]; then
  NM="$WORK/nullmiss-out.json"
  echo "  aiExtract: ① $(field "$NM" source.extraction.aiExtract.contradictedRows) · ② $(field "$NM" source.extraction.aiExtract.keyShiftRows) · ③ $(field "$NM" source.extraction.aiExtract.nullMismatchRows) · agreed $(field "$NM" source.extraction.aiExtract.agreedRows)"
  N="$(field "$NM" source.extraction.aiExtract.nullMismatchRows)"
  [ "$(field "$NM" source.extraction.aiExtract.contradictedRows)" = "0" ] && ok "① 0건 유지" || bad "① ≠ 0"
  [ "${N:-0}" -ge 1 ] && ok "③ null-vs-값 ${N}행 — 경고 기록 + 발행 진행" || bad "③ null-vs-값이 기록되지 않았다"
fi
grep -E "교차검증 경고" "$NOTES/T35-crosscheck-nullmiss.txt" | head -2

# ─────────── 요약 ───────────
echo ""
{
  echo "T35 교차검증 증거 요약 — $(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "  ① 값 모순 주입: exit=$RC_C(기대 1) · 발행물 $([ -e "$WORK/contradict-out.json" ] && echo 있음 || echo 0건) · 보류 리포트 holdReason=$(field "$WORK/contradict-drift.json" holdReason 2>/dev/null)"
  echo "  ② 정답 초안: exit=$RC_F(기대 0) · ①$(field "$WORK/faithful-out.json" source.extraction.aiExtract.contradictedRows 2>/dev/null) ②$(field "$WORK/faithful-out.json" source.extraction.aiExtract.keyShiftRows 2>/dev/null) ③$(field "$WORK/faithful-out.json" source.extraction.aiExtract.nullMismatchRows 2>/dev/null) · agreed $(field "$WORK/faithful-out.json" source.extraction.aiExtract.agreedRows 2>/dev/null) · raw $(field "$WORK/faithful-out.json" source.extraction.aiExtract.rawAgreedRows 2>/dev/null)/$(field "$WORK/faithful-out.json" source.extraction.aiExtract.rawDisagreedRows 2>/dev/null)"
  echo "  ③ null-vs-값 주입: exit=$RC_N(기대 0) · ③$(field "$WORK/nullmiss-out.json" source.extraction.aiExtract.nullMismatchRows 2>/dev/null)행 · ①$(field "$WORK/nullmiss-out.json" source.extraction.aiExtract.contradictedRows 2>/dev/null)"
  echo "  모의 서버 표 요청: contradict=$(grep -c 'table=yes' "$WORK/mock-contradict.log") · faithful=$(grep -c 'table=yes' "$WORK/mock-faithful.log") · nullmiss=$(grep -c 'table=yes' "$WORK/mock-nullmiss.log")"
  echo "  종합: $([ "$FAILED" -eq 0 ] && echo PASS || echo FAIL)"
} | tee "$NOTES/T35-crosscheck-evidence.txt"

echo ""
[ "$FAILED" -eq 0 ] && echo "T35 CROSSCHECK EVIDENCE: PASS" || echo "T35 CROSSCHECK EVIDENCE: FAIL"
rm -rf "$WORK"
rmdir tmp 2>/dev/null
echo "임시 산출물 정리 완료($WORK) — 재현은 이 스크립트 재실행."
exit "$FAILED"
