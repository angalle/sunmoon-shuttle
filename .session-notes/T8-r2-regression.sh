#!/bin/bash
# T8 회귀 확인 (run 15) — 웹 쪽 PASS 유지 검증
set -u
cd /Users/leeheesun/Documents/github/sunmoon-shuttle
NOTES=.session-notes
echo "=== npm run test ==="
npm run test > "$NOTES/T8-r2-npm-test.txt" 2>&1
echo "exit=$?"
tail -6 "$NOTES/T8-r2-npm-test.txt"
echo "=== npm run build ==="
npm run build > "$NOTES/T8-r2-npm-build.txt" 2>&1
echo "exit=$?"
tail -6 "$NOTES/T8-r2-npm-build.txt"
echo "=== npm run lint:boundary ==="
npm run lint:boundary > "$NOTES/T8-r2-lint-boundary.txt" 2>&1
echo "exit=$?"
cat "$NOTES/T8-r2-lint-boundary.txt"
echo "=== src 변경 0 확인 (베이스 대비) ==="
git diff --stat 6300411 -- src/domain src/adapters/in/web
echo "(위 출력이 비어 있으면 수정 0줄)"
echo "=== 현재 워킹트리 ==="
git status --porcelain
echo "### DONE"
