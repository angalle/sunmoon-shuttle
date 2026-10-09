#!/usr/bin/env bash
# T33 — 빌드 산출물(AAB/APK) 안의 웹 자산이 dist/ 와 같은가 + 금지어 0건인가
# 소유: InfraProjectCreator · T33. 사용: bash scripts/t33_artifact_asset_check.sh
#
# 왜 필요한가: `cap sync` 가 자산을 넣었다고 **믿는 것**과 AAB 안에 실제로 그 자산이 들어간 것은 다르다.
#   (1) AAB 안에 옛 해시 번들(index-qWPrV94-.js)이 남아 있지 않은가 — 남으면 옛 UI 가 함께 배포된다.
#   (2) 삭제된 설치 안내 문구(홈 화면·전체화면·한 번만)가 산출물 안에 0건인가.
#   (3) sw.js 의 SW_VERSION 이 dist 와 같은 값인가(다르면 설치형 앱이 옛 셸을 계속 쓴다).
#   (4) 서명이 유효한가(jarsigner -verify).
#
# 툴체인: JDK17(jarsigner) · unzip. AAB 경로: base/assets/public/... · APK 경로: assets/public/...
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 17)}"
export PATH="$JAVA_HOME/bin:$PATH"

AAB="android/app/build/outputs/bundle/release/app-release.aab"
APK="android/app/build/outputs/apk/debug/app-debug.apk"
WORDS=("홈 화면" "전체화면" "한 번만")
OLD_BUNDLES=("index-qWPrV94-.js" "index-8thbg8SN.css")
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
check() { # check <라벨> <기대> <실제>
    if [ "$2" = "$3" ]; then printf '  PASS  %-52s %s\n' "$1" "$3"
    else printf '  FAIL  %-52s 기대=%s 실제=%s\n' "$1" "$2" "$3"; fail=1; fi
}
grep_count() { # grep_count <dir> <word> → 일치 줄 수
    grep -rn --binary-files=without-match -F "$2" "$1" 2>/dev/null | wc -l | tr -d ' '
}

DIST_MANIFEST="$(node scripts/sync-android-assets.mjs --check 2>/dev/null | grep -m1 'dist manifest' | awk '{print $4}')"

for pair in "AAB:$AAB" "APK:$APK"; do
    kind="${pair%%:*}"; file="${pair#*:}"
    echo "### $kind  ${file#\"$ROOT\"/}"
    if [ ! -f "$file" ]; then echo "  MISSING  $file"; fail=1; continue; fi
    printf '  %-52s %s bytes\n' "크기" "$(stat -f %z "$file")"
    printf '  %-52s %s\n' "sha256" "$(shasum -a 256 "$file" | cut -d' ' -f1)"
    verdict="$(jarsigner -verify "$file" 2>/dev/null | grep -m1 'jar verified' || true)"
    signer="$(jarsigner -verify -verbose -certs "$file" 2>/dev/null | grep -m1 'CN=' | sed 's/^ *//' || true)"
    check "$kind jarsigner -verify" "jar verified." "${verdict:-<없음>}"
    printf '  서명자: %s\n' "${signer:-<없음>}"

    # 자산 추출 (AAB 는 base/ 접두, APK 는 루트)
    if [ "$kind" = "AAB" ]; then prefix="base/assets/public"; else prefix="assets/public"; fi
    mkdir -p "$TMP/$kind"
    unzip -q -o "$file" "$prefix/*" -d "$TMP/$kind" 2>/dev/null || { echo "  FAIL  $kind 안에 $prefix/ 가 없다"; fail=1; continue; }
    DIR="$TMP/$kind/$prefix"
    n="$(find "$DIR" -type f | wc -l | tr -d ' ')"
    printf '  %-52s %s개\n' "$prefix/ 파일 수" "$n"

    # (1) 옛 해시 번들 0
    for b in "${OLD_BUNDLES[@]}"; do
        hits="$(find "$DIR" -name "$b" | wc -l | tr -d ' ')"
        check "$kind 옛 번들 없음 ($b)" "0" "$hits"
    done
    # 실제로 들어간 번들 이름
    printf '  %-52s %s\n' "들어간 번들" "$(find "$DIR/assets" -name 'index-*' -exec basename {} \; | sort | tr '\n' ' ')"

    # (2) 금지어 0
    total=0
    for w in "${WORDS[@]}"; do
        c="$(grep_count "$DIR" "$w")"
        printf '  %-52s %s건\n' "금지어 '$w'" "$c"
        total=$((total + c))
    done
    check "$kind 금지어 합계(홈 화면·전체화면·한 번만)" "0" "$total"

    # (3) SW_VERSION 이 dist 와 같은가
    sw_dist="$(grep -m1 -o "SW_VERSION = '[^']*'" dist/sw.js || true)"
    sw_art="$(grep -m1 -o "SW_VERSION = '[^']*'" "$DIR/sw.js" || true)"
    printf '  %-52s %s\n' "SW_VERSION ($kind)" "${sw_art:-<없음>}"
    check "$kind SW_VERSION == dist" "$sw_dist" "$sw_art"

    # (4) 계약 데이터 동봉
    check "$kind data/timetable.json" "1" "$([ -f "$DIR/data/timetable.json" ] && echo 1 || echo 0)"
    echo "  dist manifest: $DIST_MANIFEST"
    echo
done

if [ "$fail" -eq 0 ]; then echo "T33 ARTIFACT ASSET CHECK: PASS"; else echo "T33 ARTIFACT ASSET CHECK: FAIL"; fi
exit "$fail"
