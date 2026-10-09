#!/usr/bin/env bash
# T34 AI 표 추출기 — **증거 실행**(모의 서버 · 실 API 호출 0 · 과금 0).
#
# 실측하는 것(docs/08 §4·§6·§9):
#   ① AC-AI1-1 환각 주입  → 실 CLI 프로세스 exit 1 · 발행물/초안/리포트 0건 + 실패 사유 로그
#   ② AC-AI1-2 정상 응답  → 검증 리포트의 **수치**(원문 시각 집합 = 추출 시각 집합 · 행 수 일치)
#   ③ AC-AI1-3 해시 캐시  → 같은 내용 재실행 `calls: 0` · 바뀐 1개 페이지만 호출(그 외 9개 캐시 적중)
#   ④ AC-AI1-7 회귀       → `--no-ai` 폴백 exit 0 · 발행물 '규칙 정본' 부분이 기존 발행본과 동일
#
# 산출물: .session-notes/T34-ac-*.txt(원문 로그) · .session-notes/T34-evidence-summary.txt(요약)
# 사용:   bash scripts/t34_ai_table_evidence.sh
set -u

cd "$(dirname "$0")/.." || exit 1
WORK=tmp/t34-evidence
NOTES=.session-notes
TSX=./node_modules/.bin/tsx
MOCK_PID=""
FAILED=0

rm -rf "$WORK"
mkdir -p "$WORK" "$NOTES"

ok()   { echo "  PASS  $1"; }
bad()  { echo "  FAIL  $1"; FAILED=1; }

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
  if [ -n "$MOCK_PID" ]; then
    kill "$MOCK_PID" 2>/dev/null
    wait "$MOCK_PID" 2>/dev/null
    MOCK_PID=""
  fi
}

field() { # out.json key-path(점 표기) — 발행물에서 값만 뽑는다
  node -e '
    const fs = require("fs");
    const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const path = process.argv[2].split(".");
    let value = body;
    for (const key of path) value = value === undefined || value === null ? undefined : value[key];
    process.stdout.write(JSON.stringify(value));
  ' "$1" "$2"
}

echo "════════ T34 AI 표 추출기 증거 실행(모의 서버) ════════"

# ─────────────── ① AC-AI1-1 환각 주입 → 발행 중단 ───────────────
echo ""
echo "① AC-AI1-1 — 표에 없는 시각(23:59)·행(순번=행수+1) 주입"
start_mock hallucinate 8792 "$WORK/mock-hallucinate.log" || { echo "모의 서버 기동 실패"; cat "$WORK/mock-hallucinate.log"; exit 1; }
AI_BASE_URL=http://127.0.0.1:8792/v1 AI_MODEL=mock-table-v1 AI_API_KEY=dummy-not-a-real-key \
  npm run extract -- --local --ai=api \
  --out "$WORK/ac1-out.json" --log "$WORK/ac1-log.json" \
  --ai-cache "$WORK/ac1-cache.json" --ai-draft "$WORK/ac1-draft.json" --ai-report "$WORK/ac1-report.json" \
  > "$NOTES/T34-ac-ai1-1-stdout.txt" 2> "$NOTES/T34-ac-ai1-1-stderr.txt"
AC1=$?
stop_mock
echo "  exit=$AC1 (기대 1)"
[ "$AC1" -eq 1 ] && ok "환각 주입 → exit 1" || bad "환각 주입인데 exit=$AC1"
for name in ac1-out.json ac1-draft.json ac1-report.json; do
  if [ -e "$WORK/$name" ]; then bad "산출물이 남았다: $name"; else ok "산출물 0건 확인: $name 없음"; fi
done
if [ -e "$WORK/ac1-log.json" ]; then
  echo "  실행 로그: output=$(field "$WORK/ac1-log.json" output) · fatalIssues=$(node -e 'const j=require(process.argv[1]);console.log(j.fatalIssues.length)' "$WORK/ac1-log.json")건"
  echo "  캐시 항목 수=$(node -e 'const j=require(process.argv[1]);console.log(Object.keys(j.entries).length)' "$WORK/ac1-cache.json") (검증 실패 초안은 캐시에 남기지 않는다)"
  grep -E "AI 표 검증 실패|발행하지 않는다" "$NOTES/T34-ac-ai1-1-stderr.txt" | head -4
else
  bad "실행 로그가 없다(사유 기록 없음)"
fi
echo "  모의 서버 표 요청 수=$(grep -c 'table=yes' "$WORK/mock-hallucinate.log")"

# ─────────────── ②③ AC-AI1-2 · AC-AI1-3 정상 응답 · 해시 캐시 ───────────────
echo ""
echo "②③ AC-AI1-2(수치) · AC-AI1-3(해시 캐시) — 같은 원본 사본에 대해 3회 실행"
mkdir -p "$WORK/raw"
cp data/raw/*.html "$WORK/raw/"
FILES=$(ls "$WORK/raw"/*.html)
start_mock faithful 8793 "$WORK/mock-faithful.log" || { echo "모의 서버 기동 실패"; cat "$WORK/mock-faithful.log"; exit 1; }
export AI_BASE_URL=http://127.0.0.1:8793/v1 AI_MODEL=mock-table-v1 AI_API_KEY=dummy-not-a-real-key

run() { # tag
  npm run extract -- --local --ai=api $FILES \
    --out "$WORK/ac2-out-$1.json" --log "$WORK/ac2-log-$1.json" \
    --ai-cache "$WORK/ac2-cache.json" --ai-draft "$WORK/ac2-draft-$1.json" --ai-report "$WORK/ac2-report-$1.json" \
    >> "$NOTES/T34-ac-ai1-2-3.txt" 2>&1
  echo $?
}

echo "" > "$NOTES/T34-ac-ai1-2-3.txt"
R1=$(run run1)
R2=$(run run2)
echo "  run1 exit=$R1 · run2 exit=$R2 (기대 0/0)"
[ "$R1" -eq 0 ] && ok "첫 실행 exit 0" || bad "첫 실행 exit=$R1"
[ "$R2" -eq 0 ] && ok "재실행 exit 0" || bad "재실행 exit=$R2"

# AC-AI1-2 수치 — 검증 리포트의 검증 4종 상세(시각 집합·행 수)
echo "  ── AC-AI1-2 검증 리포트 수치(run1 · 페이지 3건 예시) ──"
node -e '
  const fs = require("fs");
  const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  for (const page of report.pages.slice(0, 3)) {
    const time = page.checks.find((c) => c.id === "time-set");
    const rows = page.checks.find((c) => c.id === "row-count");
    console.log(`    ${page.page.split("/").pop()} [${page.status}] 시각:${time.detail} | 행:${rows.detail}`);
  }
  console.log(`    전체: 통과 ${report.pages.filter((p) => p.status === "ok").length}개 · agreedRows=${report.agreedRows} · disagreedRows=${report.disagreedRows} · fatal=${report.fatal.length}건`);
  console.log(`    검증 4종 전부 ok = ${report.pages.every((p) => p.checks.length === 4 && p.checks.every((c) => c.ok))}`);
' "$WORK/ac2-report-run1.json"

# AC-AI1-3 호출 수 — 내용 동일 재실행은 호출 0, 1개 페이지만 바꾸면 그 페이지만 호출
TARGET="$WORK/raw/2026-2학기-asan-ktx-평일.html"
node -e '
  const fs = require("fs");
  const file = process.argv[1];
  const before = fs.readFileSync(file, "utf8");
  const after = before.replace("8:05", "8:06");
  if (after === before) { console.error("치환 실패"); process.exit(2); }
  fs.writeFileSync(file, after);
' "$TARGET" || bad "페이지 1개 내용 변경 실패"
echo "  ── 페이지 1개($(basename "$TARGET")) 시각 8:05→8:06 변경 후 run3 ──"
R3=$(run run3)
[ "$R3" -eq 0 ] && ok "바뀐 페이지만 호출한 재실행 exit 0" || bad "run3 exit=$R3"
stop_mock

echo "  run1  aiExtract=$(field "$WORK/ac2-out-run1.json" source.extraction.aiExtract)"
echo "  run2  aiExtract=$(field "$WORK/ac2-out-run2.json" source.extraction.aiExtract)"
echo "  run3  aiExtract=$(field "$WORK/ac2-out-run3.json" source.extraction.aiExtract)"
[ "$(field "$WORK/ac2-out-run2.json" source.extraction.aiExtract.calls)" = "0" ] \
  && ok "AC-AI1-3 같은 내용 재실행 calls=0(실측)" || bad "재실행인데 calls≠0"
[ "$(field "$WORK/ac2-out-run3.json" source.extraction.aiExtract.calls)" = "1" ] \
  && ok "AC-AI1-3 바뀐 1개 페이지만 호출(calls=1)" || bad "바뀐 페이지 호출 수가 1이 아니다"
[ "$(field "$WORK/ac2-out-run3.json" source.extraction.aiExtract.pagesSkippedByHash)" = "9" ] \
  && ok "AC-AI1-3 나머지 9개는 해시 캐시 적중" || bad "캐시 적중 수가 9가 아니다"

# ─────────────── ④ AC-AI1-7 회귀(--no-ai 폴백 · 규칙 정본 유지) ───────────────
echo ""
echo "④ AC-AI1-7 — --no-ai 폴백 · 규칙 정본 부분 비교"
unset AI_BASE_URL AI_MODEL AI_API_KEY
npm run extract -- --no-ai --local --out "$WORK/noai-out.json" --log "$WORK/noai-log.json" \
  > "$NOTES/T34-ac-ai1-7-noai.txt" 2>&1
NOAI=$?
[ "$NOAI" -eq 0 ] && ok "--no-ai exit 0(AI 호출 0)" || bad "--no-ai exit=$NOAI"
node -e '
  const fs = require("fs");
  const core = (body) => { const { source, ...rest } = body; void source; return JSON.stringify(rest); };
  const noai = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const published = JSON.parse(fs.readFileSync("data/timetable.json", "utf8"));
  const same = core(noai) === core(published);
  console.log(`  규칙 정본(source 제외) 동일 = ${same}`);
  console.log(`  aiExtract(--no-ai) = ${JSON.stringify(noai.source.extraction.aiExtract)}`);
  if (!same) process.exit(3);
' "$WORK/noai-out.json" && ok "--no-ai 산출물의 규칙 정본 부분이 기존 발행본과 동일" || bad "--no-ai 규칙 정본이 기존 발행본과 다르다"
[ -e "$WORK/ac2-draft-run1.json" ] && [ ! -e "$WORK/noai-draft.json" ] && ok "--no-ai 는 AI 표 초안 산출물을 만들지 않는다" || bad "--no-ai 산출물 점검 실패"

# ─────────────── 요약 ───────────────
{
  echo "T34 AI 표 추출기 증거 요약 — $(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "  AC-AI1-1 exit=$AC1 (기대 1) · 발행물/초안/리포트 0건 · 사유 로그 T34-ac-ai1-1-stderr.txt"
  echo "  AC-AI1-2 run1 리포트: $(node -e 'const r=require(process.argv[1]);console.log(`통과 ${r.pages.filter((p)=>p.status==="ok").length}개 · agreedRows=${r.agreedRows} · disagreedRows=${r.disagreedRows}`)' "$WORK/ac2-report-run1.json")"
  echo "  AC-AI1-3 run1 calls=$(field "$WORK/ac2-out-run1.json" source.extraction.aiExtract.calls) → run2 calls=$(field "$WORK/ac2-out-run2.json" source.extraction.aiExtract.calls) → run3 calls=$(field "$WORK/ac2-out-run3.json" source.extraction.aiExtract.calls)(바뀐 1개 페이지)"
  echo "  AC-AI1-7 --no-ai exit=$NOAI · 규칙 정본 비교는 위 PASS/FAIL 참조"
  echo "  모의 서버 표 요청 수: hallucinate=$(grep -c 'table=yes' "$WORK/mock-hallucinate.log") · faithful=$(grep -c 'table=yes' "$WORK/mock-faithful.log")"
  echo "  종합: $([ "$FAILED" -eq 0 ] && echo PASS || echo FAIL)"
} | tee "$NOTES/T34-evidence-summary.txt"

echo ""
[ "$FAILED" -eq 0 ] && echo "T34 AI TABLE EVIDENCE: PASS" || echo "T34 AI TABLE EVIDENCE: FAIL"
exit "$FAILED"
