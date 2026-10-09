#!/usr/bin/env bash
# T35 증거 — **실제 발행 경로**(`npx tsx tools/extract/index.ts`)로 드리프트 게이트(docs/08 §7)와
#   교차검증(§5)의 5+1 케이스를 검증한다. AI 네트워크 호출 0: `--no-ai`(규칙 정본 전용) —
#   비교 기준선(`--baseline`)만 인위 주입한다(AC-AI1-6 ①②③④⑤ + 정상 회귀 ⑥).
#
# 사용:  bash scripts/t35_evidence.sh            # 요약 출력
#        bash scripts/t35_evidence.sh > .session-notes/T35-drift-cases.txt
set -uo pipefail
cd "$(dirname "$0")/.."

EV=.session-notes
mkdir -p "$EV"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/t35.XXXXXX")"
REAL=data/timetable.json
REAL_TOTAL="$(jq '[.routes[].byDay[].trips|length]|add' "$REAL")"

echo "T35 드리프트/교차검증 발행 경로 증거"
echo "실 데이터: $REAL · 전체 편수 = $REAL_TOTAL · schemaVersion = $(jq -r '.schemaVersion' "$REAL")"
echo "임시 기준선 디렉터리: $TMP"
echo

# ── 케이스별 기준선(직전 발행본) 구성 ────────────────────────────────────────────
# ① 편수 -14.9% (asin-ktx 평일 26행 증발 = 기준선에만 있음)
jq --argjson extra 26 '(.routes[0].byDay.weekday.trips[0]) as $t |
  .routes[0].byDay.weekday.trips += [range(0;$extra) | $t]' "$REAL" > "$TMP/base-tripcount.json"
# ② 노선 소실(기준선에만 있는 ghost-route)
jq '.routes += [{id:"ghost-route", columns:["순번"], trips:[{seq:1}],
  byDay:{weekday:{columns:["순번"],keys:["seq"],trips:[{seq:1}]}}}]' "$REAL" > "$TMP/base-route-lost.json"
# ③ 특정 노선×요일 편수 >0 → 0 (onyang 토요일에 3편이 있다고 주장)
jq '(.routes[] | select(.id=="onyang") | .byDay.saturday) =
  {columns:["순번"],keys:["seq"],trips:[{seq:1},{seq:2},{seq:3}]}' "$REAL" > "$TMP/base-day-zero.json"
# ④ 열 의미 키 집합 변경(asan-ktx 토요일 keys 에서 2개 제거)
jq '(.routes[] | select(.id=="asan-ktx") | .byDay.saturday.keys) = ["seq","depCampus"]' \
  "$REAL" > "$TMP/base-keys.json"

run_case() { # <name> <baseline> [추가 플래그...]
  local name="$1" baseline="$2"; shift 2
  local out="$TMP/$name.out.json"
  echo "===== CASE $name — baseline=$(basename "$baseline") ${*:-} ====="
  npx tsx tools/extract/index.ts --no-ai --baseline "$baseline" \
    --out "$out" --log "$TMP/$name.log.json" \
    --drift-report "$TMP/$name.drift.json" --drift-table "$TMP/$name.drift.txt" "$@" >"$TMP/$name.stdout" 2>&1
  local rc=$?
  echo "rc=$rc · 발행물 존재=$([ -f "$out" ] && echo YES || echo NO) · 최종 JSON 유지=$([[ -f "$out" ]] && echo NEW || echo 'HEAD(마지막 정상)')"
  grep -E '\[extract\] (드리프트|보류|⚠️)' "$TMP/$name.stdout" | head -8
  if [ -f "$TMP/$name.log.json" ]; then
    jq -c '.drift | {checked, blocked, forced, threshold, totals, reasons}' "$TMP/$name.log.json"
  fi
  if [ -f "$out" ]; then
    echo -n "발행물 기록 aiExtract.drift = "; jq -c '.source.extraction.aiExtract.drift' "$out"
  fi
  echo "--- 비교 표 ---"
  head -22 "$TMP/$name.drift.txt" 2>/dev/null || echo "(비교 표 없음)"
  echo
}

echo "########## AC-AI1-6 ① 편수 -10% 초과 → 발행 보류 ##########"
run_case tripcount "$TMP/base-tripcount.json"
echo "########## AC-AI1-6 ② 노선 소실 → 발행 보류 ##########"
run_case routelost "$TMP/base-route-lost.json"
echo "########## AC-AI1-6 ③ 노선×요일 편수 >0→0 → 발행 보류 ##########"
run_case dayzero "$TMP/base-day-zero.json"
echo "########## AC-AI1-6 ④ 열 의미 키 변경 → 발행 보류 ##########"
run_case keyshift "$TMP/base-keys.json"
echo "########## AC-AI1-6 ⑤ --force-publish → 발행되되 drift.forced=true 기록 ##########"
run_case forced "$TMP/base-tripcount.json" --force-publish
echo "########## 회귀 ⑥ 기준선 그대로(변화 없음) → 보류 없이 발행 ##########"
run_case normal "$REAL"

echo "########## AC-AI1-7 회귀 — 규칙 정본 부분(source 제외)이 기존 발행본과 동일한가 ##########"
if node -e '
  const fs = require("fs");
  const core = (body) => { const { source, ...rest } = body; void source; return JSON.stringify(rest); };
  const out = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const published = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const same = core(out) === core(published);
  process.stdout.write(`규칙 정본(source 제외) 동일 = ${same} · 발행본 source.aiExtract = ${JSON.stringify(out.source.extraction.aiExtract)}\n`);
  process.exit(same ? 0 : 3);
' "$TMP/normal.out.json" "$REAL"; then
  echo "  PASS  AC-AI1-7 — 정상 입력(--no-ai) 발행 결과의 규칙 정본이 기존 발행본과 동일"
else
  echo "  FAIL  AC-AI1-7 — 규칙 정본이 기존 발행본과 다르다"
  FAILED=1
fi

rm -rf "$TMP"
echo "임시 기준선·산출물 정리 완료($TMP) — 재현은 이 스크립트 재실행."
