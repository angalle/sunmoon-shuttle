#!/usr/bin/env bash
# T2 실패경로 보강 — 파일명은 유효한데 (a)파일 없음 (b)내용 빈 파일 (c)잘린 HTML.
set -u
cd "$(dirname "$0")/../.."
EV=.session-notes/evidence/tmp
mkdir -p "$EV"

OUT="$EV/fail-out2.json"
rm -f "$OUT"
before="$(shasum -a 256 data/timetable.json | cut -d' ' -f1)"

run_case() {
  local title="$1"; shift
  echo "----- ${title} -----"
  "$@" 2>&1 | tail -4
  local code="${PIPESTATUS[0]}"
  echo ">>> exit=${code}"
  echo
}

# (a) 파일명 유효(onyang 토요일 = 원본에 없는 조합) · 파일 자체도 없음
run_case "(a) 없는 파일(파일명 규칙은 유효)" \
  npx tsx tools/scraper/index.ts --local data/raw/2026-2학기-onyang-토요일.html --out "$OUT"

# (b) 파일명 유효 + 0바이트
mkdir -p "$EV/empty-valid"
: > "$EV/empty-valid/2026-2학기-asan-ktx-평일.html"
run_case "(b) 빈 파일(0 bytes, 파일명 유효)" \
  npx tsx tools/scraper/index.ts --local "$EV/empty-valid/2026-2학기-asan-ktx-평일.html" --out "$OUT"

# (c) 잘린 HTML (앞 40%만 저장, 파일명 유효)
mkdir -p "$EV/truncated2"
./.session-notes/evidence/t2-truncate.py
run_case "(c) 잘린 HTML(앞 40%만)" \
  npx tsx tools/scraper/index.ts --local "$EV/truncated2/2026-2학기-asan-ktx-평일.html" --out "$OUT"

after="$(shasum -a 256 data/timetable.json | cut -d' ' -f1)"
echo "timetable.json 해시 ${before:0:16} -> ${after:0:16}"
[ "$before" = "$after" ] && echo "기존 JSON 무변경: OK" || echo "기존 JSON 변경됨: FAIL"
[ -f "$OUT" ] && echo "실패 산출물 존재: FAIL" || echo "실패 시 JSON 미생성: OK"
