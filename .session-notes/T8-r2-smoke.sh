#!/bin/bash
# T8 에뮬레이터 스모크 재실행 (run 15) — 기존 산출물만 사용, 재빌드·재sync 없음
# - debug APK 설치 → 콜드 스타트 → 첫 화면/요일 전환 스크린샷 → 라이브 창 크래시 검사
# - 앱 종료(force-stop) 후 logcat 에서 WebView 렌더러 teardown 을 대조
set -u
cd /Users/leeheesun/Documents/github/sunmoon-shuttle
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
ADB="$ANDROID_HOME/platform-tools/adb"
NOTES=".session-notes"
APK="android/app/build/outputs/apk/debug/app-debug.apk"

echo "### HOST DATE"; date "+%Y-%m-%d %H:%M:%S %Z"

echo "### 0. APK 자산(계약 데이터) 포함 확인"
unzip -l "$APK" | grep -E "assets/public/data/timetable.json|assets/public/index.html"

echo "### 1. install"
"$ADB" install -r -t "$APK"

echo "### 2. cold start (force-stop → logcat -c → am start)"
"$ADB" shell am force-stop com.angalle.sunmoonshuttle
"$ADB" logcat -c
"$ADB" shell am start -n com.angalle.sunmoonshuttle/.MainActivity
sleep 8
echo "--- device evidence: pid / resumed activity / display ---"
"$ADB" shell date
"$ADB" shell pidof com.angalle.sunmoonshuttle
"$ADB" shell dumpsys activity activities | grep -m 2 -E "topResumedActivity|ResumedActivity"
"$ADB" shell dumpsys window | grep -m 1 -E "mCurrentFocus|mFocusedApp"

echo "### 3. 스크린샷 1 (첫 화면)"
"$ADB" exec-out screencap -p > "$NOTES/T8-r2-1-첫화면.png"
ls -l "$NOTES/T8-r2-1-첫화면.png"

echo "### 4. 요일 탭(토요일) 전환 + 스크린샷 2"
"$ADB" shell input tap 540 515
sleep 3
"$ADB" exec-out screencap -p > "$NOTES/T8-r2-2-요일토요일전환.png"
ls -l "$NOTES/T8-r2-2-요일토요일전환.png"

echo "### 5. 라이브 창 로그 저장 + 크래시 판정 (앱 살아있는 동안)"
"$ADB" logcat -d > "$NOTES/T8-r2-logcat-live.txt"
wc -l "$NOTES/T8-r2-logcat-live.txt"
echo "FATAL EXCEPTION count:   $(grep -c -E 'FATAL EXCEPTION|AndroidRuntime.*FATAL' "$NOTES/T8-r2-logcat-live.txt" || true)"
echo "chromium crash count:    $(grep -c -E 'crash detected' "$NOTES/T8-r2-logcat-live.txt" || true)"
echo "WebView renderer gone:   $(grep -c -E 'Renderer process .* (crash|gone)|SandboxedProcessService.* died' "$NOTES/T8-r2-logcat-live.txt" || true)"
echo "--- 앱 콘솔 오류(Error/Uncaught) ---"
grep -E "Capacitor/Console.*(Error|Uncaught|404)" "$NOTES/T8-r2-logcat-live.txt" | head -10 || echo "(none)"
echo "--- 앱 프로세스 생존 확인 ---"
"$ADB" shell pidof com.angalle.sunmoonshuttle

echo "### 6. 앱 종료 시점 기록 → 뒤로가기(앱 종료) → teardown 대조"
"$ADB" shell date
"$ADB" shell pidof com.angalle.sunmoonshuttle
"$ADB" shell input keyevent 4
sleep 3
echo "--- 종료 후 상태 ---"
"$ADB" shell date
"$ADB" shell pidof com.angalle.sunmoonshuttle || echo "(프로세스 없음)"
"$ADB" shell dumpsys activity activities | grep -c "com.angalle.sunmoonshuttle" || echo "0 (ActivityRecord 없음)"
"$ADB" logcat -d > "$NOTES/T8-r2-logcat-afterkill.txt"
echo "--- 종료 이후 로그에서 teardown 대조 ---"
grep -n -E "Capacitor.*(App stopped|App destroyed)|crash detected|isolated not needed|exited due to signal" "$NOTES/T8-r2-logcat-afterkill.txt" | tail -12
echo "### DONE"
