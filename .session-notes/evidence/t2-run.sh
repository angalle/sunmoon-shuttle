#!/usr/bin/env bash
# T2 증거 수집 스크립트 — 파서 실행/비교만. 로직 없음.
set -u
cd "$(dirname "$0")/../.."
EV=.session-notes/evidence/tmp
mkdir -p "$EV"
TSV="2026-10-05T12:00:00+09:00"

echo "===== A. DETERMINISM (3 runs, fetchedAt masked) ====="
npx tsx tools/scraper/index.ts --local data/raw/*.html --out "$EV/det1.json" >/dev/null 2>&1
npx tsx tools/scraper/index.ts --local data/raw/*.html --out "$EV/det2.json" >/dev/null 2>&1
npx tsx tools/scraper/index.ts --local data/raw/*.html --out "$EV/det3.json" >/dev/null 2>&1
node .session-notes/evidence/t2-stats.mjs mask "$EV/det1.json" "$EV/det1.masked.json" >/dev/null
node .session-notes/evidence/t2-stats.mjs mask "$EV/det2.json" "$EV/det2.masked.json" >/dev/null
node .session-notes/evidence/t2-stats.mjs mask "$EV/det3.json" "$EV/det3.masked.json" >/dev/null
shasum -a 256 "$EV/det1.masked.json" "$EV/det2.masked.json" "$EV/det3.masked.json"
if diff "$EV/det1.masked.json" "$EV/det2.masked.json" >/dev/null; then
  echo "diff det1-det2: 0 lines (identical)"
else
  echo "diff det1-det2: DIFFERS"
fi

echo
echo "===== B. FIXED --now (byte-identical) ====="
npx tsx tools/scraper/index.ts --local data/raw/*.html --out "$EV/now1.json" --now "$TSV" >/dev/null 2>&1
npx tsx tools/scraper/index.ts --local data/raw/*.html --out "$EV/now2.json" --now "$TSV" >/dev/null 2>&1
if cmp -s "$EV/now1.json" "$EV/now2.json"; then
  echo "byte-identical: YES ($(shasum -a 256 "$EV/now1.json" | cut -c1-16))"
else
  echo "byte-identical: NO"
fi

echo
echo "===== C. JSON STATS (data/timetable.json) ====="
node .session-notes/evidence/t2-stats.mjs data/timetable.json
