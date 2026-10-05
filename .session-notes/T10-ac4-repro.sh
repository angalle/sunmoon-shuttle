#!/usr/bin/env bash
# T10 총괄 독립 검증 — AC-4 (자동 반영: 변경 시 1건 / 무변경 0건)
# scrape.yml 의 '변경 감지' 스텝 셸 로직(norm/diff)을 그대로 로컬에서 재현한다.
#   case A 무변경: data/raw 를 재파싱한 JSON ↔ HEAD 커밋본  → changed=false (커밋 0건)
#   case B 변경  : 스냅샷 1개를 스크래치 사본에서 변조 후 재파싱 → changed=true → 반영 커밋 1건
# 실 Actions 이력: 무변경 2회 success(커밋 0건) — gh run 37269211341 · 37269154462
set -uo pipefail
PROJ="/Users/leeheesun/Documents/github/sunmoon-shuttle"
SB="$HOME/.hermes/profiles/projectcreator/cache/scratch/t10-ac4"
cd "$PROJ"
rm -rf "$SB"; mkdir -p "$SB"

norm() { jq -S 'del(.source.fetchedAt)'; }
detect() { # $1 = 후보 JSON 경로 → changed true/false 출력 (워크플로 셸과 동일)
  if ! git cat-file -e "HEAD:data/timetable.json" 2>/dev/null; then echo true; return; fi
  if diff -q <(git show HEAD:data/timetable.json | norm) <(norm < "$1") >/dev/null; then echo false; else echo true; fi
}

echo "=== AC-4 (A) 무변경: 원본 재파싱 ↔ HEAD ==="
npm run scrape -- --local data/raw/*.html --out "$SB/regen.json" --now 2026-10-05T14:39:32+09:00 > "$SB/scrape-regen.log" 2>&1
echo "scrape exit=$? (로그: $SB/scrape-regen.log)"
grep -E "^\[scrape\] 씀|contentHash" "$SB/scrape-regen.log" | tail -2
echo "HEAD contentHash : $(git show HEAD:data/timetable.json | jq -r .source.contentHash)"
echo "regen contentHash: $(jq -r .source.contentHash "$SB/regen.json")"
CHANGED_A=$(detect "$SB/regen.json")
echo "변경 감지 결과(A) = changed=$CHANGED_A  → $( [ "$CHANGED_A" = false ] && echo '커밋 0건' || echo '커밋 발생(예상 밖)')"
DATA_COMMITS_BEFORE=$(git log --oneline -- data/ | wc -l | tr -d ' ')
echo "git log -- data/ 건수(현재) = $DATA_COMMITS_BEFORE"

echo
echo "=== AC-4 (B) 변경: 스냅샷 1개 변조 후 재파싱 ==="
mkdir -p "$SB/raw"
cp data/raw/*.html "$SB/raw/"
TARGET="$SB/raw/2026-2학기-asan-ktx-평일.html"
python3 - "$TARGET" <<'PY'
import re,sys
p=sys.argv[1]; s=open(p,encoding='utf-8',errors='replace').read()
# 첫 번째 데이터 행의 시각 8:05 → 8:06 (내용 변경 1건)
s2,n=re.subn(r'>8:05<','>8:06<',s,count=1)
open(p,'w',encoding='utf-8').write(s2)
print(f'변조 셀 수={n} (8:05→8:06)')
PY
npm run scrape -- --local "$SB"/raw/*.html --out "$SB/changed.json" --now 2026-10-05T14:39:32+09:00 > "$SB/scrape-changed.log" 2>&1
echo "scrape exit=$? (로그: $SB/scrape-changed.log)"
echo "HEAD  contentHash: $(git show HEAD:data/timetable.json | jq -r .source.contentHash)"
echo "변조  contentHash: $(jq -r .source.contentHash "$SB/changed.json")"
echo "asan-ktx 평일 1행: HEAD=$(git show HEAD:data/timetable.json | jq -c '[.routes[]|select(.id=="asan-ktx")][0].byDay.weekday.trips[0]')"
echo "                   변조=$(jq -c '[.routes[]|select(.id=="asan-ktx")][0].byDay.weekday.trips[0]' "$SB/changed.json")"
CHANGED_B=$(detect "$SB/changed.json")
echo "변경 감지 결과(B) = changed=$CHANGED_B → $( [ "$CHANGED_B" = true ] && echo '커밋 1건' || echo '커밋 0건(예상 밖)')"

echo
echo "=== AC-4 (B) 반영 커밋 시뮬레이션 (스크래치 git, 워크플로 '반영 — main 커밋' 블록과 동일 명령) ==="
git clone -q --depth 1 "file://$PROJ" "$SB/repo" 2>/dev/null
cp "$SB/changed.json" "$SB/repo/data/timetable.json"
cd "$SB/repo"
BEFORE=$(git log --oneline -- data/ | wc -l | tr -d ' ')
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add data/timetable.json
git commit -q -m "data: 스냅샷 반영 — asan-ktx 평일 08:05→08:06 (T10 AC-4 변경 반영 재현)"
AFTER=$(git log --oneline -- data/ | wc -l | tr -d ' ')
echo "커밋 전 data/ 커밋수=$BEFORE · 후=$AFTER (증가 $((AFTER-BEFORE))건)"
git log --oneline -1 -- data/
cd "$PROJ"

echo
echo "AC-4 판정: 무변경→커밋 0건(changed=$CHANGED_A) · 변경→커밋 1건(changed=$CHANGED_B) — $( [ "$CHANGED_A" = false ] && [ "$CHANGED_B" = true ] && echo PASS || echo FAIL)"
