#!/bin/bash
# T8 스모크 2차: 토요일 탭 전환 후 시간표 카드(회차)까지 스크롤한 스크린샷
set -u
cd /Users/leeheesun/Documents/github/sunmoon-shuttle
ADB=/opt/homebrew/share/android-commandlinetools/platform-tools/adb
NOTES=.session-notes
echo "### 콜드 스타트"
"$ADB" shell am start -n com.angalle.sunmoonshuttle/.MainActivity
sleep 6
echo "### 토요일 탭 선택"
"$ADB" shell input tap 540 515
sleep 2
echo "### 스크롤(아래로 2회)"
"$ADB" shell input swipe 540 1800 540 700
sleep 1
"$ADB" shell input swipe 540 1800 540 700
sleep 2
"$ADB" exec-out screencap -p > "$NOTES/T8-r2-3-토요일-시간표.png"
ls -l "$NOTES/T8-r2-3-토요일-시간표.png"
shasum -a 256 "$NOTES/T8-r2-3-토요일-시간표.png"
"$ADB" shell pidof com.angalle.sunmoonshuttle
echo "### 라이브 로그 재확인(누적)"
"$ADB" logcat -d > "$NOTES/T8-r2-logcat-live2.txt"
wc -l "$NOTES/T8-r2-logcat-live2.txt"
echo "FATAL EXCEPTION: $(grep -c -E 'FATAL EXCEPTION' "$NOTES/T8-r2-logcat-live2.txt" || true)"
echo "crash detected:  $(grep -c -E 'crash detected' "$NOTES/T8-r2-logcat-live2.txt" || true)"
echo "### DONE"
