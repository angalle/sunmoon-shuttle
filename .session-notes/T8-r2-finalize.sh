#!/bin/bash
# T8 마무리(run 15): 서명 최종 확인 + 에뮬레이터 종료
set -u
cd /Users/leeheesun/Documents/github/sunmoon-shuttle
export JAVA_HOME=/Users/leeheesun/Library/Java/JavaVirtualMachines/jdk-17.0.20.1+1/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/36.0.0:$PATH"
NOTES=.session-notes
AAB=android/app/build/outputs/bundle/release/app-release.aab
APK=android/app/build/outputs/apk/debug/app-debug.apk

{
  echo "### jarsigner -verify app-release.aab"
  jarsigner -verify "$AAB"
  echo
  echo "### apksigner verify --verbose --print-certs app-debug.apk"
  apksigner verify --verbose --print-certs "$APK"
} > "$NOTES/T8-r2-signature.txt" 2>&1
cat "$NOTES/T8-r2-signature.txt"

echo "### HEAD"
git log --oneline -1
git status --porcelain

echo "### 에뮬레이터 종료(카드 지시)"
adb emu kill
sleep 4
echo "--- 남은 qemu 프로세스 ---"
pgrep -fl qemu || echo "(없음)"
echo "--- adb devices ---"
adb devices
echo "### DONE"
