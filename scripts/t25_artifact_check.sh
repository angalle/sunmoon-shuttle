#!/usr/bin/env bash
# T25 — 빌드 산출물(AAB/APK) 안의 네이티브 리소스가 생성기 산출물과 **같은 것인지** 대조한다.
# 소유: InfraProjectCreator · T25. 사용: bash scripts/t25_artifact_check.sh
#
# 왜 필요한가: `cap sync` + Gradle 을 거치면서 리소스가 **조용히 바뀔 수 있다**.
#   - APK(debug)  : aapt2 가 PNG 를 그대로 넣는다 → 바이트 동일해야 한다.
#   - AAB(release): aapt2 가 PNG 를 **크런치**(재압축·비트뎁스 축소)한다 → 바이트는 달라지고 **픽셀은 같아야** 한다.
#   그래서 (1) 바이트 sha256, (2) ffmpeg 로 디코드한 RGBA 픽셀 sha256 을 둘 다 낸다.
#
# 툴체인: JDK17(apksigner/aapt2) · build-tools 36.0.0 · ffmpeg · unzip 이 PATH 에 있어야 한다.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 17)}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/build-tools/36.0.0:$PATH"

APK="android/app/build/outputs/apk/debug/app-debug.apk"
AAB="android/app/build/outputs/bundle/release/app-release.aab"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
check() { # check <라벨> <기대> <실제>
    if [ "$2" = "$3" ]; then printf '  PASS  %-46s %s\n' "$1" "$3"
    else printf '  FAIL  %-46s 기대=%s 실제=%s\n' "$1" "$2" "$3"; fail=1; fi
}

byte_hash() { shasum -a 256 "$1" | cut -d' ' -f1; }
# 픽셀 해시: PNG 를 RGBA 로 디코드한 원시 바이트의 sha256 (컬러타입/압축 차이를 무시하고 픽셀만 본다)
pixel_hash() { ffmpeg -v error -i "$1" -f rawvideo -pix_fmt rgba - 2>/dev/null | shasum -a 256 | cut -d' ' -f1; }

echo "### 0. 산출물"
for f in "$APK" "$AAB"; do
    [ -f "$f" ] || { echo "MISSING $f"; exit 2; }
    printf '  %-58s %10s bytes  sha256 %s\n' "$f" "$(stat -f %z "$f")" "$(byte_hash "$f" | cut -c1-16)"
done

echo "### 1. 서명 (jarsigner -verify 원문)"
for f in "$AAB" "$APK"; do
    verdict="$(jarsigner -verify "$f" 2>/dev/null | grep -m1 'jar verified' || true)"
    signer="$(jarsigner -verify -verbose -certs "$f" 2>/dev/null | grep -m1 'CN=' | sed 's/^ *//' || true)"
    check "$(basename "$f") jar verified" "jar verified." "${verdict:-<없음>}"
    printf '        서명자: %s\n' "${signer:-<없음>}"
done

echo "### 2. 소스 리소스 규격 (file)"
for f in android/app/src/main/res/drawable-mdpi/splash_logo.png \
         android/app/src/main/res/drawable-xxhdpi/splash_logo.png \
         android/app/src/main/res/drawable-xxxhdpi/splash_logo.png \
         android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png \
         android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png \
         android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png; do
    printf '  %-62s %s\n' "${f#android/app/src/main/res/}" "$(file -b "$f")"
done

echo "### 3. APK(debug) — 리소스가 생성물과 **바이트 동일**한가"
for rel in drawable-mdpi/splash_logo.png drawable-xxhdpi/splash_logo.png drawable-xxxhdpi/splash_logo.png \
           mipmap-xxhdpi/ic_launcher.png mipmap-xxhdpi/ic_launcher_round.png mipmap-xxhdpi/ic_launcher_foreground.png; do
    dir="$(dirname "$rel")"; base="$(basename "$rel")"
    entry="res/${dir}-v4/${base}"
    src="android/app/src/main/res/$rel"
    unzip -p "$APK" "$entry" > "$TMP/apk-$base" 2>/dev/null || { echo "  FAIL  APK 에 $entry 없음"; fail=1; continue; }
    check "APK byte  $rel" "$(byte_hash "$src")" "$(byte_hash "$TMP/apk-$base")"
done

echo "### 4. AAB(release) — 픽셀이 생성물과 **동일**한가(크런치 허용)"
for rel in drawable-mdpi/splash_logo.png drawable-xxhdpi/splash_logo.png drawable-xxxhdpi/splash_logo.png \
           mipmap-xxhdpi/ic_launcher.png mipmap-xxhdpi/ic_launcher_round.png mipmap-xxhdpi/ic_launcher_foreground.png; do
    dir="$(dirname "$rel")"; base="$(basename "$rel")"
    entry="base/res/${dir}-v4/${base}"
    src="android/app/src/main/res/$rel"
    unzip -p "$AAB" "$entry" > "$TMP/aab-$base" 2>/dev/null || { echo "  FAIL  AAB 에 $entry 없음"; fail=1; continue; }
    check "AAB pixel $rel" "$(pixel_hash "$src")" "$(pixel_hash "$TMP/aab-$base")"
done

echo "### 5. APK 안의 실행 테마 배경(aapt2 dump xmltree) — layer-list(배경 + gravity=center 로고)"
aapt2 dump xmltree --file res/drawable/splash.xml "$APK" 2>/dev/null | head -12 || { echo "  (aapt2 dump 실패 — 미검증)"; }
echo "### 6. APK resources.arsc — 스플래시/상태바 색·부울·로고 밀도(실제로 들어간 값)"
aapt2 dump resources "$APK" 2>/dev/null | grep -A6 -E "resource 0x[0-9a-f]+ (color/splash_background|color/status_bar_background|bool/light_status_bar_icons|drawable/splash_logo)$" || true
echo "### 7. APK resources.arsc — 실행 테마(style/AppTheme.NoActionBarLaunch) 실제 값"
aapt2 dump resources "$APK" 2>/dev/null | grep -A8 "style/AppTheme.NoActionBarLaunch" || true

echo
if [ "$fail" -eq 0 ]; then echo "T25 ARTIFACT CHECK: PASS"; else echo "T25 ARTIFACT CHECK: FAIL"; fi
exit "$fail"
