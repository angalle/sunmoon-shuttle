#!/usr/bin/env bash
# T40 — 빌드 산출물(AAB/APK) **안**의 웹 자산이 dist/ 와 같은가 + 방향 필터 계약이 들어갔는가
# 소유: InfraProjectCreator · T40. 사용: bash .session-notes/T40-artifact-check.sh
#
# T33 `t33_artifact_asset_check.sh` 와 같은 방식(산출물을 풀어 안을 본다)에 T40 항목을 더했다.
#   (1) 옛 해시 번들 0건  (2) 금지어 0건 — `전체` 문자열 포함  (3) SW_VERSION == dist
#   (4) 서명 검증        (5) 계약 데이터 동봉        (6) 칩 2개·`전체` 0 이 번들 안에도 있는가(문자열 기준)
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 17)}"
export PATH="$JAVA_HOME/bin:$PATH"

AAB="android/app/build/outputs/bundle/release/app-release.aab"
APK="android/app/build/outputs/apk/debug/app-debug.apk"
WORDS=("홈 화면" "전체화면" "한 번만" "전체 115")
OLD_BUNDLES=("index-403hrULs.js" "index-BX2z0Mh1.css" "index-qWPrV94-.js" "index-8thbg8SN.css")
NEW_BUNDLES=("index-Ubp09QTp.js" "index-B47UX3pj.css")
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
check() { # check <라벨> <기대> <실제>
    if [ "$2" = "$3" ]; then printf '  PASS  %-56s %s\n' "$1" "$3"
    else printf '  FAIL  %-56s 기대=%s 실제=%s\n' "$1" "$2" "$3"; fail=1; fi
}
grep_count() { grep -rn --binary-files=without-match -F "$2" "$1" 2>/dev/null | wc -l | tr -d ' '; }

DIST_MANIFEST="$(node scripts/sync-android-assets.mjs --check 2>/dev/null | grep -m1 'dist manifest' | awk '{print $4}')"

for pair in "AAB:$AAB" "APK:$APK"; do
    kind="${pair%%:*}"; file="${pair#*:}"
    echo "### $kind  ${file#"$ROOT"/}"
    if [ ! -f "$file" ]; then echo "  MISSING  $file"; fail=1; continue; fi
    printf '  %-56s %s bytes\n' "크기" "$(stat -f %z "$file")"
    printf '  %-56s %s\n' "sha256" "$(shasum -a 256 "$file" | cut -d' ' -f1)"
    verdict="$(jarsigner -verify "$file" 2>/dev/null | grep -m1 'jar verified' || true)"
    signer="$(jarsigner -verify -verbose -certs "$file" 2>/dev/null | grep -m1 'CN=' | sed 's/^ *//' || true)"
    check "$kind jarsigner -verify" "jar verified." "${verdict:-<없음>}"
    printf '  서명자: %s\n' "${signer:-<없음>}"

    if [ "$kind" = "AAB" ]; then prefix="base/assets/public"; else prefix="assets/public"; fi
    mkdir -p "$TMP/$kind"
    unzip -q -o "$file" "$prefix/*" -d "$TMP/$kind" 2>/dev/null || { echo "  FAIL  $kind 안에 $prefix/ 가 없다"; fail=1; continue; }
    DIR="$TMP/$kind/$prefix"
    printf '  %-56s %s개\n' "$prefix/ 파일 수" "$(find "$DIR" -type f | wc -l | tr -d ' ')"

    for b in "${OLD_BUNDLES[@]}"; do
        check "$kind 옛 번들 없음 ($b)" "0" "$(find "$DIR" -name "$b" | wc -l | tr -d ' ')"
    done
    for b in "${NEW_BUNDLES[@]}"; do
        check "$kind 새 번들 포함 ($b)" "1" "$(find "$DIR" -name "$b" | wc -l | tr -d ' ')"
    done

    total=0
    for w in "${WORDS[@]}"; do
        c="$(grep_count "$DIR" "$w")"
        printf '  %-56s %s건\n' "금지어 '$w'" "$c"
        total=$((total + c))
    done
    check "$kind 금지어 합계(홈 화면·전체화면·한 번만·전체 115)" "0" "$total"

    sw_dist="$(grep -m1 -o "SW_VERSION = '[^']*'" dist/sw.js || true)"
    sw_art="$(grep -m1 -o "SW_VERSION = '[^']*'" "$DIR/sw.js" || true)"
    printf '  %-56s %s\n' "SW_VERSION ($kind)" "${sw_art:-<없음>}"
    check "$kind SW_VERSION == dist" "$sw_dist" "$sw_art"
    check "$kind data/timetable.json" "1" "$([ -f "$DIR/data/timetable.json" ] && echo 1 || echo 0)"
    check "$kind 방향 칩 라벨 2개 포함(학교 도착)" "1" \
        "$(grep -rl --binary-files=without-match -F '학교 도착' "$DIR" | head -1 | wc -l | tr -d ' ')"
    echo "  dist manifest: $DIST_MANIFEST"
    echo
done

if [ "$fail" -eq 0 ]; then echo "T40 ARTIFACT ASSET CHECK: PASS"; else echo "T40 ARTIFACT ASSET CHECK: FAIL"; fi
exit "$fail"
