#!/usr/bin/env bash
# T10 AC-7 (Android) 2차 — WebView DOM 실측 + 전체 페이지 스크린샷.
set -uo pipefail
SDK=/opt/homebrew/share/android-commandlinetools
export ANDROID_HOME="$SDK"; export ANDROID_SDK_ROOT="$SDK"
export PATH="$SDK/platform-tools:$SDK/emulator:$PATH"
PROJ=/Users/leeheesun/Documents/github/sunmoon-shuttle
OUT="$PROJ/.session-notes"
APK="$PROJ/android/app/build/outputs/apk/debug/app-debug.apk"
AVD=meteor-dodge-api35
PKG=com.angalle.sunmoonshuttle

adb kill-server >/dev/null 2>&1; adb start-server >/dev/null 2>&1
nohup "$SDK/emulator/emulator" -avd "$AVD" -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect \
  > "$OUT/T10-android-emulator2.log" 2>&1 &
adb wait-for-device
for i in $(seq 1 150); do
  [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
  sleep 2
done
echo "boot_completed=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
adb install -r -t "$APK" 2>&1 | tail -2
adb shell am force-stop "$PKG" >/dev/null 2>&1
adb logcat -c
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep 12

echo "=== WebView devtools 소켓 탐색 ==="
adb shell cat /proc/net/unix 2>/dev/null | grep -o '@webview_devtools_remote_[0-9]*' | head -3
SOCK=$(adb shell cat /proc/net/unix 2>/dev/null | grep -o 'webview_devtools_remote_[0-9]*' | head -1 | tr -d '\r')
echo "socket=$SOCK"
if [ -z "$SOCK" ]; then echo "FAIL: WebView devtools 미노출(디버그 빌드 아님?)"; adb emu kill >/dev/null 2>&1; exit 1; fi
adb forward tcp:9222 "localabstract:$SOCK"
echo "forward: $(adb forward --list)"

echo "=== DOM 실측 ==="
node "$OUT/T10-android-dom.mjs" 9222 "$OUT" 2>&1 | tee "$OUT/T10-android-dom.txt"

adb logcat -d > "$OUT/T10-android-logcat-dom.txt" 2>&1
echo "FATAL EXCEPTION: $(grep -c 'FATAL EXCEPTION' "$OUT/T10-android-logcat-dom.txt")"
echo "앱 콘솔(chromium) error: $(grep -E 'chromium' "$OUT/T10-android-logcat-dom.txt" | grep -ciE '\[error\]|Uncaught|TypeError')"
adb shell pidof "$PKG" | tr -d '\r'
adb emu kill >/dev/null 2>&1
sleep 5
echo "남은 qemu: $(pgrep -fc 'qemu-system' 2>/dev/null || echo 0)"
echo "dom smoke done"
