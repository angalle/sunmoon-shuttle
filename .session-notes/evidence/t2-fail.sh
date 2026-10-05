#!/usr/bin/env bash
# T2 실패경로 자체검증 — 각 케이스 exit 코드와 JSON 무변경 여부만 측정.
set -u
cd "$(dirname "$0")/../.."
EV=.session-notes/evidence/tmp
mkdir -p "$EV"

OUT="$EV/fail-out.json"
rm -f "$OUT"

before="$(shasum -a 256 data/timetable.json | cut -d' ' -f1)"
echo "data/timetable.json 사전 해시: ${before:0:16}"
echo

run_case() {
  local title="$1"; shift
  echo "----- ${title} -----"
  "$@" 2>&1 | tail -6
  local code="${PIPESTATUS[0]}"
  echo ">>> exit=${code}"
  echo
}

# ① 없는 파일
run_case "① 없는 파일 (data/raw/nope.html)" \
  npx tsx tools/scraper/index.ts --local data/raw/nope.html --out "$OUT"

# ② 빈 파일
: > "$EV/empty.html"
run_case "② 빈 파일 (0 bytes)" \
  npx tsx tools/scraper/index.ts --local "$EV/empty.html" --out "$OUT"

# ③ 표 구조 변조 (본표 <table> 제거/개조)
python3 - "$EV/mutated" <<'PY'
import sys, pathlib, re
out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
src = pathlib.Path('data/raw/2026-2학기-asan-ktx-평일.html').read_text(encoding='utf-8')
# 본표의 <thead>를 통째로 제거 → 구조 계약 위반
mutated = re.sub(r'<thead.*?</thead>', '', src, count=1, flags=re.S|re.I)
(out / '2026-2학기-asan-ktx-평일.html').write_text(mutated, encoding='utf-8')
print('mutated written:', len(src), '->', len(mutated))
PY
run_case "③ 표 구조 변조(thead 제거)" \
  npx tsx tools/scraper/index.ts --local "$EV/mutated/2026-2학기-asan-ktx-평일.html" --out "$OUT"

# ④ 파일명 규칙 위반(요일 토큰 없음)
cp data/raw/2026-2학기-asan-ktx-평일.html "$EV/2026-2학기-asan-ktx.html"
run_case "④ 파일명 규칙 위반(요일 토큰 없음)" \
  npx tsx tools/scraper/index.ts --local "$EV/2026-2학기-asan-ktx.html" --out "$OUT"

# ⑤ 부분 입력 (11개 중 1개) — 기존 JSON 을 덮어쓰면 안 된다
run_case "⑤ 부분 입력(노선 누락, 1개만)" \
  npx tsx tools/scraper/index.ts --local data/raw/2026-2학기-asan-ktx-평일.html --out "$OUT"

after="$(shasum -a 256 data/timetable.json | cut -d' ' -f1)"
echo "data/timetable.json 사후 해시: ${after:0:16}"
if [ "$before" = "$after" ]; then echo "기존 timetable.json 무변경: OK"; else echo "기존 timetable.json 변경됨: FAIL"; fi
if [ -f "$OUT" ]; then echo "실패 산출물 생성됨: FAIL ($OUT 존재)"; else echo "실패 시 JSON 미생성: OK"; fi
