#!/usr/bin/env bash
# T33 — 에뮬레이터 실측: "삭제된 설치 안내 카드가 Android 앱에서 사라졌는가"
# 소유: InfraProjectCreator · T33. 사용: bash scripts/t33_emulator_smoke.sh [AVD이름]
#
# 재는 것 (카드 수용 기준 AC-U14-3d)
#   1. (가능하면) **이전 설치본**(T25 빌드 = 옛 번들)을 먼저 실행해 **설치 안내가 실제로 보이는 것**을
#      같은 기기에 기록한다 — "이전에는 보였음"의 before 근거. (이미 최신 빌드면 INFO 로 넘어간다)
#   2. 새 debug APK 를 `install -r`(앱 데이터·SW 캐시 유지 = 실제 사용자 업데이트 경로)한 뒤
#      1차 로드 → 2차 로드(서비스워커가 새 셸로 교체) 순으로 **WebView DOM 을 직접 평가**한다
#      (CDP · scripts/t33_webview_dom.mjs). 스크린샷도 함께 남긴다.
#   3. **운행일 시간표 렌더**: 오늘(10-09 한글날)은 운행이 없어 목록이 비는 게 정상이므로,
#      `?now=2026-10-19`(학기 중 월요일)를 주입해 **행이 실제로 그려지는지** 별도로 확인한다.
#   4. 판정: 설치 안내 노드 0 · 금지어 0(innerText·outerHTML) · 새 번들 로드 · 데이터 오류 없음 ·
#      옛 SW 캐시 키 없음 · logcat FATAL/ANR 0.
#
# 산출물(.session-notes/): T33-dom-*.json · T33-1..5-*.png · T33-logcat*.txt · T33-emulator-smoke.txt
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
ADB="$ANDROID_HOME/platform-tools/adb"
EMU="$ANDROID_HOME/emulator/emulator"
AVD="${1:-meteor-dodge-api35}"
PKG="com.angalle.sunmoonshuttle"
ACT="$PKG/.MainActivity"
APK="android/app/build/outputs/apk/debug/app-debug.apk"
OUT=".session-notes"
PORT=9222
DAY_URL="https://localhost/?now=2026-10-19"

fail=0
check() { # check <라벨> <기대> <실제>
    if [ "$2" = "$3" ]; then printf '  PASS  %-58s %s\n' "$1" "$3"
    else printf '  FAIL  %-58s 기대=%s 실제=%s\n' "$1" "$2" "$3"; fail=1; fi
}
info() { printf '  INFO  %-58s %s\n' "$1" "$2"; }
json() { node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const v=eval('d'+process.argv[2]);console.log(v===undefined||v===null?'<null>':String(v))" "$1" "$2"; }
summary() { # summary <json> → 한 줄 요약
    printf '설치안내노드=%s · 금지어=%s(본문)/%s(HTML) · 번들=%s · 행=%s · 빈상태=%s · 오류=%s · 캐시=%s' \
        "$(json "$1" ".installNodes")" "$(json "$1" ".forbiddenTotal")" "$(json "$1" ".forbiddenOuterTotal")" \
        "$(json "$1" ".bundleSrcs")" "$(json "$1" ".rowCount")" "$(json "$1" ".emptyShown")" \
        "$(json "$1" ".dataError")" "$(json "$1" ".cacheKeys")"
}

[ -f "$APK" ] || { echo "APK 없음: $APK — 먼저 'bash android/build-release.sh debug'"; exit 2; }

# ── 에뮬레이터 기동 ─────────────────────────────────────────────────────────────
STARTED=0
if [ "$("$ADB" devices | grep -c 'device$')" = "0" ]; then
    echo "[emu] $AVD 기동 (-no-window -gpu swiftshader_indirect)"
    "$EMU" -avd "$AVD" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -netdelay none -netspeed full \
        > "$OUT/T33-emulator-boot.log" 2>&1 &
    STARTED=1
fi
"$ADB" wait-for-device
for i in $(seq 1 90); do
    BOOT="$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
    [ "$BOOT" = "1" ] && break
    sleep 3
done
echo "[emu] sys.boot_completed=$BOOT (대기 ${i}회) · Android $("$ADB" shell getprop ro.build.version.release | tr -d '\r') (API $("$ADB" shell getprop ro.build.version.sdk | tr -d '\r'))"
[ "$BOOT" = "1" ] || { echo "에뮬레이터 부팅 실패"; exit 2; }
sleep 2

probe() { # probe <출력파일> [--nav <url>]  ← 성공하면 .err 를 지운다
    local out="$1"; shift
    PID="$("$ADB" shell pidof "$PKG" 2>/dev/null | tr -d '\r' | awk '{print $1}')"
    [ -n "$PID" ] || { echo "  앱 프로세스 없음 — CDP 불가"; return 1; }
    "$ADB" forward "tcp:$PORT" "localabstract:webview_devtools_remote_$PID" >/dev/null 2>&1
    if node scripts/t33_webview_dom.mjs "$PORT" "$@" > "$out" 2> "$out.err"; then rm -f "$out.err"; return 0; fi
    cat "$out.err"; return 1
}
shot() { "$ADB" exec-out screencap -p > "$OUT/$1" 2>/dev/null; printf '  (스크린샷 %s · %s bytes)\n' "$1" "$(stat -f %z "$OUT/$1")"; }

# ── 1) before: 이전 설치본(T25 = 옛 번들)에 설치 안내가 실제로 보이는가 ─────────────
echo
echo "### 1. before — 이전 설치본이 있으면 먼저 실행"
if "$ADB" shell pm path "$PKG" 2>/dev/null | grep -q package; then
    echo "  기존 설치본 있음: $("$ADB" shell dumpsys package "$PKG" | grep -m1 versionName | tr -d '\r' | sed 's/^ *//')"
    "$ADB" shell am force-stop "$PKG"; "$ADB" logcat -c
    "$ADB" shell am start -n "$ACT" -W >/dev/null 2>&1; sleep 7
    if probe "$OUT/T33-dom-preinstall.json"; then
        echo "  이전 설치본: $(summary "$OUT/T33-dom-preinstall.json")"
        echo "  설치 안내 노드 예: $(json "$OUT/T33-dom-preinstall.json" ".installNodeSample")"
        case "$(json "$OUT/T33-dom-preinstall.json" ".bundleSrcs")" in
            *index-qWPrV94*) check "이전 설치본(옛 번들)에 설치 안내가 보였다(before)" "1" "$(json "$OUT/T33-dom-preinstall.json" ".installNodes")" ;;
            *) info "이전 설치본이 이미 새 번들 — before 근거는 run1/웹 스모크(T32) 사용" "$(json "$OUT/T33-dom-preinstall.json" ".bundleSrcs")" ;;
        esac
        shot "T33-1-이전설치본-설치안내.png"
    else
        info "이전 설치본 DOM 조회 실패 — before 근거는 웹 스모크(T32)·T25 스크린샷으로 대체" "-"
    fi
else
    info "기존 설치본 없음 — before 는 T32(웹)·T25(에뮬) 스크린샷으로 갈음" "-"
fi

# ── 2) 새 APK 설치 (앱 데이터 유지 = 사용자 업데이트 경로) ────────────────────────
echo
echo "### 2. 새 debug APK 설치 (adb install -r — 앱 데이터·SW 캐시 유지)"
"$ADB" install -r -t "$APK" | sed 's/^/  /'
"$ADB" shell dumpsys package "$PKG" | grep -m1 versionName | tr -d '\r' | sed 's/^ */  설치 후 /'

echo
echo "### 3. 새 빌드 1차 로드"
"$ADB" shell am force-stop "$PKG"; "$ADB" logcat -c
"$ADB" shell am start -n "$ACT" -W 2>&1 | grep -E 'Status|TotalTime|Error' | sed 's/^/  /'
sleep 7
shot "T33-2-새빌드-1차로드.png"
probe "$OUT/T33-dom-load1.json" && echo "  1차: $(summary "$OUT/T33-dom-load1.json")"

echo
echo "### 4. 새 빌드 2차 로드 (서비스워커가 새 셸로 교체된 뒤)"
"$ADB" shell am force-stop "$PKG"
"$ADB" shell am start -n "$ACT" -W >/dev/null 2>&1
sleep 7
DOM2="$OUT/T33-dom-load2.json"
shot "T33-3-새빌드-2차로드.png"
if probe "$DOM2"; then
    echo "  2차: $(summary "$DOM2")"
    printf '  시각=%s · 오프라인안내=%s · 공지=%s · dayType=%s · 행샘플=%s\n' \
        "$(json "$DOM2" ".clock")" "$(json "$DOM2" ".offlineNotice")" "$(json "$DOM2" ".blockNotice")" \
        "$(json "$DOM2" ".dayType")" "$(json "$DOM2" ".rowSample")"
    printf '  요일탭=%s\n' "$(json "$DOM2" ".dayTabLabels")"
else
    echo "  CDP DOM 조회 실패 — 스크린샷·logcat 으로만 판정(미검증으로 기록)"
fi

echo
echo "### 4b. 운행일 주입 ($DAY_URL) — 오늘은 휴일이라 행이 안 그려지므로"
DOMDAY="$OUT/T33-dom-day2026-10-19.json"
if probe "$DOMDAY" --nav "$DAY_URL"; then
    echo "  운행일: $(summary "$DOMDAY")"
    printf '  시각=%s · dayType=%s · 행샘플=%s\n' "$(json "$DOMDAY" ".clock")" "$(json "$DOMDAY" ".dayType")" "$(json "$DOMDAY" ".rowSample")"
    shot "T33-5-운행일-시간표.png"
else
    echo "  운행일 DOM 조회 실패(미검증)"
fi

# ── 5) logcat ──────────────────────────────────────────────────────────────────
echo
echo "### 5. logcat 판정 (누적)"
"$ADB" logcat -d > "$OUT/T33-logcat.txt"
"$ADB" logcat -d -b crash > "$OUT/T33-logcat-crash.txt" 2>/dev/null || true
TOTAL="$(wc -l < "$OUT/T33-logcat.txt" | tr -d ' ')"
FATAL="$(grep -c -E 'FATAL EXCEPTION|AndroidRuntime: FATAL' "$OUT/T33-logcat.txt" || true)"
FATAL_C="$(grep -c -E 'FATAL EXCEPTION' "$OUT/T33-logcat-crash.txt" || true)"
ANR="$(grep -c -E 'ANR in |Reason: Input dispatching timed out' "$OUT/T33-logcat.txt" || true)"
CONSOLE="$(grep -c -E 'Capacitor/Console.*(Error|Uncaught)' "$OUT/T33-logcat.txt" || true)"
DISPLAYED_M="$(grep -m1 -E "Displayed $PKG/.MainActivity" "$OUT/T33-logcat.txt" || true)"
grep -E 'Capacitor/Console' "$OUT/T33-logcat.txt" | head -10 > "$OUT/T33-console.txt" || true
printf '  logcat %s줄 · 앱 콘솔 %s줄 · %s\n' "$TOTAL" "$(wc -l < "$OUT/T33-console.txt" | tr -d ' ')" "${DISPLAYED_M:-Displayed 없음}"
check "logcat FATAL EXCEPTION(main)" "0" "$FATAL"
check "logcat FATAL EXCEPTION(crash 버퍼)" "0" "$FATAL_C"
check "logcat ANR" "0" "$ANR"
check "앱 콘솔 Error/Uncaught" "0" "$CONSOLE"

# ── 6) 판정 (AC-U14-3d) ────────────────────────────────────────────────────────
echo
echo "### 6. 수용 기준 판정 (AC-U14-3d)"
if [ -f "$DOM2" ]; then
    CLOCK="$(json "$DOM2" ".clock")"
    check "설치 안내 노드 0건(2차 로드)" "0" "$(json "$DOM2" ".installNodes")"
    check "설치 안내 testid(install-hint) 0건" "0" "$(json "$DOM2" ".installHintTestidCount")"
    check "금지어 0건(본문 innerText)" "0" "$(json "$DOM2" ".forbiddenTotal")"
    check "금지어 0건(HTML outerHTML)" "0" "$(json "$DOM2" ".forbiddenOuterTotal")"
    case "$(json "$DOM2" ".bundleSrcs")" in
        *index-403hrULs.js*) check "새 번들 로드" "yes" "yes" ;;
        *) check "새 번들 로드" "yes" "no($(json "$DOM2" ".bundleSrcs"))" ;;
    esac
    check "데이터 오류 화면 없음(data-error)" "<null>" "$(json "$DOM2" ".dataError")"
    check "시각 렌더(비어있지 않음)" "yes" "$([ -n "$CLOCK" ] && [ "$CLOCK" != "<null>" ] && echo yes || echo no)"
    check "앱 셸(appbar) 렌더" "true" "$(json "$DOM2" ".appbar")"
    check "요일 탭(day-tabs) 렌더" "true" "$(json "$DOM2" ".dayTabsHost")"
    check "오늘 화면 상태(행 있음 또는 '운행 없음' — 한글날)" "yes" \
        "$(node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(j.rowCount>0||j.emptyShown?'yes':'no')" "$DOM2")"
    case "$(json "$DOM2" ".cacheKeys")" in
        *2026-10-05*) check "옛 SW 캐시 키(2026-10-05) 없음" "no" "yes" ;;
        *) check "옛 SW 캐시 키(2026-10-05) 없음" "no" "no" ;;
    esac
    echo "  (참고) 캐시 키: $(json "$DOM2" ".cacheKeys")"
else
    echo "  CDP 조회 실패 — AC-U14-3d 는 **미검증**(스크린샷·logcat 만)"
    fail=1
fi

if [ -f "$DOMDAY" ]; then
    check "운행일 시간표 행 렌더(2026-10-19 · 평일)" "yes" \
        "$(node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(j.rowCount>0?'yes':'no')" "$DOMDAY")"
    check "운행일에도 설치 안내 0건" "0" "$(json "$DOMDAY" ".installNodes")"
else
    echo "  운행일 DOM 없음 — 시간표 렌더는 **미검증**"
    fail=1
fi

# ── 7) 에뮬레이터 종료 ─────────────────────────────────────────────────────────
if [ "$STARTED" = "1" ]; then
    echo
    echo "[emu] 종료 (adb emu kill)"
    "$ADB" emu kill >/dev/null 2>&1 || true
fi

echo
if [ "$fail" -eq 0 ]; then echo "T33 EMULATOR SMOKE: PASS"; else echo "T33 EMULATOR SMOKE: FAIL"; fi
exit "$fail"
