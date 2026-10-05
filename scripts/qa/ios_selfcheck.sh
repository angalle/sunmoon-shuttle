#!/usr/bin/env bash
#
# T9 검출력 자체검증 — **위조 입력을 넣으면 FAIL 이 나오는가**(항상 PASS 하는 가짜 검사 금지).
#
# 무엇을 하나
#   1) sandbox 사본(리포 밖 temp)에 **위조 입력을 주입**하고 ios_compat_check.mjs 를 돌려
#      기대한 FAIL id 가 실제로 검출되는지 확인한다. (manifest 필드 삭제 · SW 등록 제거 · 아이콘 크기 위조 ·
#      iOS 미지원 CSS 주입 · dvh 대체 제거 · viewport-fit 제거 · IndexedDB 비가드 사용)
#   2) 카드가 지정한 **실제 파일 주입 1건**(public/manifest.webmanifest 필드 삭제)은 trap 으로 원복한다.
#   3) 원복 후 `git status --short` 가 비어 있고 파일 해시가 주입 전과 같은지 확인한다(리포 오염 0).
#
# 사용: bash scripts/qa/ios_selfcheck.sh
# 종료코드: 0 = 모든 케이스가 기대대로 검출 + 원복 클린 / 1 = 검출 실패 또는 원복 실패
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="$ROOT/scripts/qa/ios_compat_check.mjs"
OUT_DIR="$ROOT/.session-notes"
LOG="$OUT_DIR/T9-selfcheck.txt"
SB="$(mktemp -d "${TMPDIR:-/tmp}/t9-selfcheck.XXXXXX")"
REAL_MANIFEST="$ROOT/public/manifest.webmanifest"
MANIFEST_BACKUP="$SB/real-manifest.backup.json"

mkdir -p "$OUT_DIR"
: > "$LOG"

pass_count=0
fail_count=0

log() { echo "$*" | tee -a "$LOG"; }

sha256() { shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'; }

restore_all() {
  if [ -f "$MANIFEST_BACKUP" ]; then
    cp "$MANIFEST_BACKUP" "$REAL_MANIFEST"
    # 만약을 위한 이중 안전장치: git 이 알고 있는 내용으로 되돌린다(추적 파일이므로).
    (cd "$ROOT" && git checkout -- public/manifest.webmanifest 2>/dev/null) || true
  fi
  rm -rf "$SB"
}
trap restore_all EXIT INT TERM

# ── sandbox 준비: 검사기가 읽는 파일만 복사(리포 원본은 건드리지 않는다) ──────────────────
seed_sandbox() {
  rm -rf "$SB/src" "$SB/public" "$SB/index.html" "$SB/docs"
  mkdir -p "$SB/public" "$SB/docs" \
    "$SB/src/adapters/in/web/shared/ui/styles" \
    "$SB/src/adapters/in/web/app" \
    "$SB/src/adapters/out/storage"
  cp -R "$ROOT/public/." "$SB/public/"
  cp "$ROOT/index.html" "$SB/"
  cp "$ROOT/docs/00-requirements.md" "$SB/docs/"
  cp "$ROOT/src/adapters/in/web/shared/ui/styles/"*.css "$SB/src/adapters/in/web/shared/ui/styles/"
  cp "$ROOT/src/adapters/in/web/app/serviceWorker.ts" "$SB/src/adapters/in/web/app/"
  cp "$ROOT/src/adapters/out/storage/indexedDbTimetableCache.ts" "$SB/src/adapters/out/storage/"
  mkdir -p "$SB/src/adapters/in/web/features/schedule/api"
  cp "$ROOT/src/adapters/in/web/features/schedule/api/installHintApi.ts" "$SB/src/adapters/in/web/features/schedule/api/" 2>/dev/null || true
}

# ── 기대 판정 실행 ────────────────────────────────────────────────────────────────
# expect_pass <케이스> <sandbox-root>
expect_pass() {
  local case_name="$1" root="$2" out exit_code
  out="$(node "$CHECK" --root="$root" --json="$SB/last.json" 2>&1)"
  exit_code=$?
  echo "$out" >> "$LOG"
  if [ "$exit_code" -eq 0 ]; then
    log "  [PASS] $case_name — 기준선: exit 0 (PASS) 기대대로"
    pass_count=$((pass_count + 1))
  else
    log "  [FAIL] $case_name — 기준선인데 exit $exit_code (실패 라인: $(echo "$out" | grep -c '^  FAIL '))"
    fail_count=$((fail_count + 1))
  fi
}

# expect_fail <케이스> <기대 FAIL id> <sandbox-root>
expect_fail() {
  local case_name="$1" expected_id="$2" root="$3" out exit_code hits
  out="$(node "$CHECK" --root="$root" --json="$SB/last.json" 2>&1)"
  exit_code=$?
  echo "$out" >> "$LOG"
  hits="$(echo "$out" | grep -c "FAIL  \[$expected_id\]")"
  if [ "$exit_code" -ne 0 ] && [ "$hits" -ge 1 ]; then
    log "  [PASS] $case_name — FAIL 검출(exit $exit_code, id=$expected_id)"
    pass_count=$((pass_count + 1))
  else
    log "  [FAIL] $case_name — 기대한 FAIL id=$expected_id 를 검출하지 못함 (exit=$exit_code hits=$hits)"
    fail_count=$((fail_count + 1))
  fi
}

log "=== T9 검출력 자체검증 ($(date '+%Y-%m-%d %H:%M:%S %z')) ==="
log "checker: scripts/qa/ios_compat_check.mjs"
log "sandbox: $SB (리포 밖 temp — 리포 파일은 실제 파일 주입 1건 때만 건드린다)"
log ""

hash_index_before="$(sha256 "$ROOT/index.html")"
hash_manifest_before="$(sha256 "$REAL_MANIFEST")"
hash_swjs_before="$(sha256 "$ROOT/public/sw.js")"
log "주입 전 해시 — index.html=${hash_index_before:0:16} manifest=${hash_manifest_before:0:16} sw.js=${hash_swjs_before:0:16}"
log ""

# ── 0. 기준선: 위조 없는 sandbox 는 PASS 여야 한다 ────────────────────────────────────
log "[0] 기준선(sandbox 무주입)"
seed_sandbox
expect_pass "기준선 sandbox" "$SB"
log ""

# ── 1. 실제 파일 주입: public/manifest.webmanifest 필드 삭제 (카드 지시 ④) ──────────────
log "[1] 실제 파일 주입 — public/manifest.webmanifest 에서 display·icons 삭제"
cp "$REAL_MANIFEST" "$MANIFEST_BACKUP"
node -e "const fs=require('fs');const p=process.argv[1];const m=JSON.parse(fs.readFileSync(p,'utf8'));delete m.display;delete m.icons;fs.writeFileSync(p,JSON.stringify(m,null,2)+'\n');" "$REAL_MANIFEST"
log "  주입 후 manifest(앞 6줄): $(head -6 "$REAL_MANIFEST" | tr '\n' ' ')"
out="$(node "$CHECK" --root="$ROOT" --json="$SB/real-inject.json" 2>&1)"
exit_code=$?
echo "$out" >> "$LOG"
hits="$(echo "$out" | grep -cE 'FAIL  \[manifest\.(display|required-fields)\]')"
if [ "$exit_code" -ne 0 ] && [ "$hits" -ge 2 ]; then
  log "  [PASS] 실제 파일 주입 — FAIL 검출(exit $exit_code, manifest.display + manifest.required-fields)"
  pass_count=$((pass_count + 1))
else
  log "  [FAIL] 실제 파일 주입 — 검출 실패(exit=$exit_code hits=$hits)"
  fail_count=$((fail_count + 1))
fi
cp "$MANIFEST_BACKUP" "$REAL_MANIFEST"
hash_manifest_restored="$(sha256 "$REAL_MANIFEST")"
if [ "$hash_manifest_restored" = "$hash_manifest_before" ]; then
  log "  [PASS] 실제 파일 원복 — 해시 동일(${hash_manifest_restored:0:16})"
  pass_count=$((pass_count + 1))
else
  log "  [FAIL] 실제 파일 원복 실패 — $hash_manifest_restored ≠ $hash_manifest_before"
  fail_count=$((fail_count + 1))
fi
log ""

# ── 2~8. sandbox 주입 케이스 ────────────────────────────────────────────────────────
log "[2] sandbox — manifest 아이콘 선언과 다른 실파일(icon-192 ← 180x180 파일)"
seed_sandbox
cp "$SB/public/apple-touch-icon.png" "$SB/public/icons/icon-192.png"
expect_fail "아이콘 IHDR 크기 위조" "manifest.icons-real" "$SB"
log ""

log "[3] sandbox — Service Worker 등록 호출 제거(src/…/serviceWorker.ts)"
seed_sandbox
sed -i '' 's/\.register(scriptPath)/\/\/ register 호출 제거(자체검증 주입)/' "$SB/src/adapters/in/web/app/serviceWorker.ts"
expect_fail "SW 등록 제거" "sw.register-relative" "$SB"
log ""

log "[4] sandbox — 등록 경로를 절대경로(/sw.js)로 변조"
seed_sandbox
sed -i '' "s|'\./sw.js'|'/sw.js'|" "$SB/src/adapters/in/web/app/serviceWorker.ts"
expect_fail "SW 등록 경로 절대화" "sw.register-relative" "$SB"
log ""

log "[5] sandbox — public/sw.js 제거(등록 대상 없음)"
seed_sandbox
rm "$SB/public/sw.js"
expect_fail "sw.js 파일 삭제" "sw.file" "$SB"
log ""

log "[6] sandbox — iOS Safari 16 에 없는 CSS 기능(color-mix) 주입"
seed_sandbox
printf '\n.shuttle-probe { color: color-mix(in srgb, var(--color-text), #ffffff); }\n' >> "$SB/src/adapters/in/web/shared/ui/styles/app.css"
expect_fail "iOS 미지원 CSS(color-mix)" "css.ios-feature-baseline" "$SB"
log ""

log "[7] sandbox — 100vh 의 dvh 대체 제거(주소창 문제 재현)"
seed_sandbox
sed -i '' '/min-height: 100dvh;/d' "$SB/src/adapters/in/web/shared/ui/styles/app.css"
expect_fail "dvh 대체 제거" "css.viewport-unit" "$SB"
log ""

log "[8] sandbox — viewport-fit=cover 제거(안전영역 정합 깨짐)"
seed_sandbox
sed -i '' 's/, viewport-fit=cover//' "$SB/index.html"
expect_fail "viewport-fit 제거" "html.viewport-fit" "$SB"
log ""

log "[9] sandbox — IndexedDB 비가드 전역 사용 주입"
seed_sandbox
printf '\nindexedDB.open("bypass");\n' >> "$SB/src/adapters/out/storage/indexedDbTimetableCache.ts"
expect_fail "IndexedDB 비가드 사용" "idb.no-unguarded-global" "$SB"
log ""

# ── 원복·리포 청결 확인 ─────────────────────────────────────────────────────────────
log "=== 원복 검증 ==="
hash_index_after="$(sha256 "$ROOT/index.html")"
hash_swjs_after="$(sha256 "$ROOT/public/sw.js")"
hash_manifest_after="$(sha256 "$REAL_MANIFEST")"
log "주입 후 해시 — index.html=${hash_index_after:0:16} manifest=${hash_manifest_after:0:16} sw.js=${hash_swjs_after:0:16}"
if [ "$hash_index_after" = "$hash_index_before" ] && [ "$hash_manifest_after" = "$hash_manifest_before" ] && [ "$hash_swjs_after" = "$hash_swjs_before" ]; then
  log "  [PASS] 추적 파일 3종 해시 주입 전 = 주입 후"
  pass_count=$((pass_count + 1))
else
  log "  [FAIL] 해시 불일치 — 원복 실패"
  fail_count=$((fail_count + 1))
fi

status="$(cd "$ROOT" && git status --porcelain -- index.html public/manifest.webmanifest public/sw.js src/adapters/in/web/app/serviceWorker.ts src/adapters/out/storage/indexedDbTimetableCache.ts src/adapters/in/web/shared/ui/styles)"
if [ -z "$status" ]; then
  log "  [PASS] 주입 대상 추적 파일 6경로 — git status 변경 0(원복 클린)"
  pass_count=$((pass_count + 1))
else
  log "  [FAIL] 주입 대상 경로에 변경이 남았다:"
  echo "$status" | tee -a "$LOG"
  fail_count=$((fail_count + 1))
fi
log "  (참고) 리포 전체 git status — 동시에 도는 다른 워커(T8 Android 등)의 변경이 섞여 있다:"
(cd "$ROOT" && git status --short) | sed 's/^/    /' | tee -a "$LOG"

log ""
log "케이스 결과: PASS ${pass_count} · FAIL ${fail_count}"
if [ "$fail_count" -eq 0 ]; then
  log "SELF-CHECK: PASS (위조 주입 9종 전부 검출 · 원복 클린)"
  exit 0
else
  log "SELF-CHECK: FAIL"
  exit 1
fi
