#!/usr/bin/env bash
# T10 총괄 독립 검증 — AC-7 (Android: 에뮬레이터 스모크).
# AVD meteor-dodge-api35 부팅 → debug APK 설치 → 실행 → 첫 화면/요일 전환/스크롤 →
# FATAL EXCEPTION·crash·앱 콘솔 오류 0 확인 → 스크린샷 3장 → 에뮬레이터 종료.
set -uo pipefail
SDK=/opt/homebrew/share/android-commandlinetools
export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"
export PATH="$SDK/platform-tools:$SDK/emulator:$PATH"
PROJ=/Users/leeheesun/Documents/github/sunmoon-shuttle
OUT="$PROJ/.session-notes"
APK="$PROJ/android/app/build/outputs/apk/debug/app-debug.apk"
AVD=meteor-dodge-api35

echo "adb: $(command -v adb) · emulator: $SDK/emulator/emulator"
adb kill-server >/dev/null 2>&1; adb start-server >/dev/null 2>&1

echo "=== 에뮬레이터 부팅 ($AVD) ==="
nohup "$SDK/emulator/emulator" -avd "$AVD" -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect \
  > "$OUT/T10-android-emulator.log" 2>&1 &
echo "emulator pid=$!"
adb wait-for-device
echo "device 연결됨 — boot_completed 대기"
for i in $(seq 1 150); do
  bc=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
  if [ "$bc" = "1" ]; then break; fi
  sleep 2
done
echo "boot_completed=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r') (대기 ${i}회)"
adb shell input keyevent 82 >/dev/null 2>&1 || true
sleep 3

echo "=== APK 설치 ==="
adb install -r "$APK" 2>&1 | tail -3
PKG=$(adb shell pm list packages 2>/dev/null | grep -i sunmoon | head -1 | cut -d: -f2 | tr -d '\r')
echo "package=$PKG"
adb shell dumpsys package "$PKG" 2>/dev/null | grep -m1 -E "versionName" | sed 's/^ *//'

echo "=== 로그 초기화 + 앱 실행(콜드 스타트) ==="
adb shell am force-stop "$PKG" >/dev/null 2>&1
adb logcat -c
adb shell am start -n "$PKG/.MainActivity" 2>&1 | tail -3
sleep 10

echo "--- 단말 증거: 시각 / pid / resumed activity / focus ---"
adb shell date | tr -d '\r'
adb shell pidof "$PKG" | tr -d '\r'
adb shell dumpsys activity activities 2>/dev/null | grep -m2 -E 'topResumedActivity|ResumedActivity' | sed 's/^ *//'
adb shell dumpsys window 2>/dev/null | grep -m1 -E 'mCurrentFocus|mFocusedApp' | sed 's/^ *//'

adb logcat -d > "$OUT/T10-android-logcat-live.txt" 2>&1
adb exec-out screencap -p > "$OUT/T10-android-1-첫화면.png" 2>/dev/null
echo "스크린샷1 $(stat -f%z "$OUT/T10-android-1-첫화면.png") bytes"

echo "=== 요일 전환(토요일 탭, T8 실측 좌표 540,515) ==="
adb shell input tap 540 515 >/dev/null 2>&1
sleep 4
adb exec-out screencap -p > "$OUT/T10-android-2-요일전환.png" 2>/dev/null
echo "스크린샷2 $(stat -f%z "$OUT/T10-android-2-요일전환.png") bytes"

echo "=== 스크롤(표 아래로) ==="
adb shell input swipe 540 1500 540 500 400 >/dev/null 2>&1
sleep 3
adb exec-out screencap -p > "$OUT/T10-android-3-스크롤.png" 2>/dev/null
echo "스크린샷3 $(stat -f%z "$OUT/T10-android-3-스크롤.png") bytes"

adb logcat -d > "$OUT/T10-android-logcat-after.txt" 2>&1

echo "=== 크래시/오류 판정 (사용 중 로그) ==="
echo "FATAL EXCEPTION      : $(grep -c 'FATAL EXCEPTION' "$OUT/T10-android-logcat-after.txt")"
echo "AndroidRuntime crash : $(grep -cE 'E AndroidRuntime' "$OUT/T10-android-logcat-after.txt")"
echo "ANR                  : $(grep -c 'ANR in' "$OUT/T10-android-logcat-after.txt")"
echo "앱 콘솔(chromium) error: $(grep -E 'chromium' "$OUT/T10-android-logcat-after.txt" | grep -ciE '\[error\]|Uncaught|TypeError')"
echo "--- chromium 'crash detected' 라인(참고: WebView 렌더러 teardown 로그) ---"
grep -E "crash detected|App destroyed|app_crash" "$OUT/T10-android-logcat-after.txt" | tail -5
echo "--- Capacitor 로그 ---"
grep -E "Capacitor" "$OUT/T10-android-logcat-after.txt" | tail -8
echo "프로세스 생존: pidof=$([ -n "$(adb shell pidof "$PKG" 2>/dev/null | tr -d '\r')" ] && echo yes || echo no)"
echo "크래시 리포트 파일: $(adb shell ls /data/tombstones 2>/dev/null | wc -l | tr -d ' ')개"

echo "=== 앱 종료 + 에뮬레이터 종료 ==="
adb shell am force-stop "$PKG" >/dev/null 2>&1
adb emu kill >/dev/null 2>&1
sleep 5
echo "남은 qemu 프로세스: $(pgrep -fc 'qemu-system' 2>/dev/null || echo 0)"
echo "android smoke done"
