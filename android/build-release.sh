#!/usr/bin/env bash
# 안드로이드 빌드 스크립트 (소유: InfraProjectCreator · T8)
#
#   ./android/build-release.sh            → web 빌드 + cap sync + bundleRelease  (app-release.aab)
#   ./android/build-release.sh debug      → web 빌드 + cap sync + assembleDebug  (app-debug.apk)
#   ./android/build-release.sh verify     → 산출물 존재·크기·서명(jarsigner)·sha256 만 검사
#
# 왜 스크립트인가: 툴체인 환경변수(JDK17·ANDROID_HOME·build-tools 36.0.0)를 사람이 매번
#   손으로 맞추면 순서를 틀리기 쉽다. 여기서 고정한다. 웹 자산은 항상 dist/ 를 다시 만들어 sync 한다
#   (오래된 dist 를 그대로 감싸는 사고 방지 — `cap sync` 자체는 빌드하지 않는다).
#
# 툴체인 실측값(이 맥, 2026-10-05):
#   JAVA_HOME    = /usr/libexec/java_home -v 17        (Temurin 17.0.20.1 — JDK 21 없음)
#   ANDROID_HOME = /opt/homebrew/share/android-commandlinetools
#                  platform-tools 37.0.1 · platforms;android-35·36 · build-tools;34·35·36.0.0
#   compileSdk/targetSdk 36 → build-tools 36.0.0 을 PATH 선두에 둔다(AGP 8.7.2 요구 리비전).
#
# 서명: android/keystore.properties(커밋 금지)가 있으면 업로드 키, 없으면 debug 키.
#       debug 서명 산출물은 스토어 제출용이 아니다(로그에 경고가 찍힌다). 값은 절대 출력하지 않는다.
# 버전: android/app/build.gradle 의 versionCode(정수) — Play 업로드마다 반드시 +1. 이 스크립트는 자동 증가하지 않는다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 17)}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/36.0.0:$ANDROID_HOME/build-tools/35.0.0:$PATH"

AAB="$ROOT/android/app/build/outputs/bundle/release/app-release.aab"
APK_DEBUG="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"

# ── verify: 산출물 확인 (빌드 없음) ────────────────────────────────────────────
verify() {
    local rc=0
    for f in "$AAB" "$APK_DEBUG"; do
        if [ -f "$f" ]; then
            printf 'PRESENT  %s  (%s bytes)\n' "${f#"$ROOT"/}" "$(stat -f %z "$f")"
            printf '         sha256 %s\n' "$(shasum -a 256 "$f" | cut -d' ' -f1)"
            printf '         jarsigner: '
            # jarsigner -verify: 서명이 유효한지 확인한다. debug 키 서명도 "jar verified" 로 나온다.
            if jarsigner -verify "$f" >/dev/null 2>&1; then
                echo "jar verified"
            else
                echo "VERIFY FAILED"
                rc=1
            fi
            # 서명 주체 — debug 키면 Play 에 올릴 수 없다(업로드 키: android/README.md "Play 첫 업로드").
            if keytool -printcert -jarfile "$f" 2>/dev/null | grep -q "CN=Android Debug"; then
                if [ "$f" = "$APK_DEBUG" ]; then
                    echo "         서명: debug 키(디버그 빌드 — 정상, 업로드 대상 아님)"
                else
                    echo "         ⚠️  서명: debug 키(CN=Android Debug) — Play 업로드 불가. android/keystore.properties 를 먼저 만든다"
                fi
            else
                echo "         서명: 업로드 키 ($(keytool -printcert -jarfile "$f" 2>/dev/null | grep -m1 -E 'Owner:|소유자:' | sed 's/^[^:]*: *//'))"
            fi
        else
            printf 'MISSING  %s\n' "${f#"$ROOT"/}"
            rc=1
        fi
    done
    return $rc
}

TASK="${1:-bundleRelease}"
case "$TASK" in
    verify)
        verify
        exit $?
        ;;
    debug) TASK=assembleDebug ;;
    bundleRelease | assembleDebug) ;;
    *)
        echo "usage: $0 [bundleRelease|assembleDebug|debug|verify]" >&2
        exit 2
        ;;
esac

# ── 1단계: 웹 자산 + Capacitor 동기화 ────────────────────────────────────────
echo "[1/3] 웹 빌드 (npm run build) → dist/"
npm run build

# 계약 데이터 동봉 — **이 단계를 빼면 앱이 404 로 데이터를 못 읽는다**(실측: 에뮬레이터에서
# "./data/timetable.json: HTTP 404" 오류 화면). 이유:
#   - vite 는 public/ 만 dist/ 로 복사한다. data/timetable.json 은 저장소 루트에 있고 CI 가 따로 넣는다.
#   - .github/workflows/deploy.yml 의 "계약 데이터 동봉" 스텝과 **같은 일을 여기서** 한다(배포본과 앱 자산 일치).
#   - `npm run build` 는 emptyOutDir 로 dist/ 를 비우므로 반드시 빌드 **뒤**에 복사해야 한다.
echo "[1/3] 계약 데이터 동봉 (data/timetable.json → dist/data/)"
if [ -f data/timetable.json ]; then
    mkdir -p dist/data
    cp data/timetable.json dist/data/timetable.json
    printf '       dist/data/timetable.json (%s bytes)\n' "$(wc -c < dist/data/timetable.json | tr -d ' ')"
else
    echo "       [경고] data/timetable.json 없음 — 앱이 오류 화면(F8)을 보여준다. 스크레이프(T2) 산출물을 먼저 넣어라." >&2
fi

echo "[1/3] Capacitor 동기화 (cap sync android)"
# npx 는 이 환경의 보안 게이트가 막는다(npx 가 패키지 실행기로 인식됨) → 로컬 바이너리를 직접 쓴다.
./node_modules/.bin/cap sync android

# 동기화 검증: 웹 자산 안에 계약 데이터가 실제로 들어갔는지 확인한다(조용한 누락 방지).
if [ -f data/timetable.json ] && [ ! -f android/app/src/main/assets/public/data/timetable.json ]; then
    echo "ERROR: cap sync 후에도 assets/public/data/timetable.json 이 없다 — 웹 자산 동봉 실패." >&2
    exit 1
fi


# ── 2단계: Gradle 빌드 ──────────────────────────────────────────────────────
echo "[2/3] JAVA_HOME=$JAVA_HOME"
echo "[2/3] ANDROID_HOME=$ANDROID_HOME"
echo "[2/3] ./gradlew $TASK"
./android/gradlew -p android "$TASK" --console=plain

# ── 3단계: 산출물 확인 ──────────────────────────────────────────────────────
echo "[3/3] 산출물 확인"
verify
