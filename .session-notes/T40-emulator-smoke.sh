#!/usr/bin/env bash
# T40 — 에뮬레이터 실측: 방향 택1(§16-2)이 **Android 앱 번들**에서도 성립하는가
# 소유: InfraProjectCreator · T40. 사용: bash .session-notes/T40-emulator-smoke.sh [AVD이름]
#
# 왜 이 태스크가 필요한가
#   앱 번들은 T33 시점(방향 필터가 `전체/학교/터미널` 3칩)에 멈춰 있었다. T38 이 웹에서 `전체` 를 없애도
#   android/app/src/main/assets/public/ 은 자동으로 갱신되지 않는다(§14-1) → 앱은 옛 UI(전체 칩 + 두 방향 섞인 목록).
#
# 재는 것 (카드 수용 기준 AC-U16-6c · AC-U16-6d)
#   before : 이전 설치본(T33 빌드 = 옛 셸)이 그 기기에 남아 있으면 **`전체` 칩과 섞인 목록이 실제로 보이는 것**을 기록
#   after  : 새 debug APK 를 `install -r`(앱 데이터·SW 캐시 유지 = 사용자 업데이트 경로) 후
#            ① 칩이 정확히 2개(`학교 도착`·`터미널 도착`)이고 `전체` 문자열 0건
#            ② 기본 선택이 정확히 1개(`터미널 도착` = out)
#            ③ 목록에 두 방향 섞임 0건(행 data-direction 이 선택 방향뿐)
#            ④ 설치 안내 흔적 0건(§13 유지)
#            ⑤ logcat FATAL 0 · ANR 0 · 앱 콘솔 Error 0
#            + (추가) `학교 도착` 칩을 실제로 눌러 목록이 in 만으로 바뀌는지 · 운행일(?now=)에 행이 그려지는지
#
# 산출물(.session-notes/): T40-dom-*.json · T40-1..5-*.png · T40-logcat*.txt · T40-emulator-smoke.txt
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
PROBE=".session-notes/T40-webview-dom.mjs"
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
chips() { node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(JSON.stringify(d.chips))" "$1"; }
dirs() { node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const r=d.rowDirections;console.log('all='+d.rowCount+' in='+r.in+' out='+r.out+' 미표기='+r.none+' 기타='+r.other)" "$1"; }
summary() { # summary <json>
    printf '칩=%s(%s) · 눌림=%s(%s) · 행[%s] · 전체문자열=%s(본문)/%s(HTML) · 설치안내=%s · 금지어=%s · 오류=%s · 캐시=%s' \
        "$(json "$1" ".chipCount")" "$(chips "$1")" "$(json "$1" ".chipPressedCount")" "$(json "$1" ".chipPressedDirections")" \
        "$(dirs "$1")" "$(json "$1" ".allWordCount")" "$(json "$1" ".allWordOuterCount")" \
        "$(json "$1" ".installNodes")" "$(json "$1" ".forbiddenTotal")" "$(json "$1" ".dataError")" "$(json "$1" ".cacheKeys")"
}

[ -f "$APK" ] || { echo "APK 없음: $APK — 먼저 안드로이드 빌드"; exit 2; }
[ -f "$PROBE" ] || { echo "프로브 없음: $PROBE"; exit 2; }

# ── 에뮬레이터 기동 ─────────────────────────────────────────────────────────────
STARTED=0
if [ "$("$ADB" devices | grep -c 'device$')" = "0" ]; then
    echo "[emu] $AVD 기동 (-no-window -gpu swiftshader_indirect)"
    "$EMU" -avd "$AVD" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -netdelay none -netspeed full \
        > "$OUT/T40-emulator-boot.log" 2>&1 &
    STARTED=1
fi
"$ADB" wait-for-device
BOOT=""
for i in $(seq 1 90); do
    BOOT="$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
    [ "$BOOT" = "1" ] && break
    sleep 3
done
echo "[emu] sys.boot_completed=${BOOT:-?} (대기 ${i}회) · Android $("$ADB" shell getprop ro.build.version.release | tr -d '\r') (API $("$ADB" shell getprop ro.build.version.sdk | tr -d '\r'))"
[ "$BOOT" = "1" ] || { echo "에뮬레이터 부팅 실패"; exit 2; }
sleep 2

probe() { # probe <출력파일> [추가 인자...]  ← 성공하면 .err 를 지운다
    local out="$1"; shift
    local PID
    PID="$("$ADB" shell pidof "$PKG" 2>/dev/null | tr -d '\r' | awk '{print $1}')"
    [ -n "$PID" ] || { echo "  앱 프로세스 없음 — CDP 불가"; return 1; }
    "$ADB" forward "tcp:$PORT" "localabstract:webview_devtools_remote_$PID" >/dev/null 2>&1
    if node "$PROBE" "$PORT" "$@" > "$out" 2> "$out.err"; then rm -f "$out.err"; return 0; fi
    cat "$out.err"; return 1
}
shot() { "$ADB" exec-out screencap -p > "$OUT/$1" 2>/dev/null; printf '  (스크린샷 %s · %s bytes)\n' "$1" "$(stat -f %z "$OUT/$1")"; }

# ── 1) before: 이전 설치본(T33 빌드)에서 `전체` 칩이 실제로 보이는가 ──────────────
echo
echo "### 1. before — 이전 설치본(T33 빌드 · 옛 셸)"
PRE="$OUT/T40-dom-1-before.json"
if "$ADB" shell pm path "$PKG" 2>/dev/null | grep -q package; then
    echo "  기존 설치본 있음: $("$ADB" shell dumpsys package "$PKG" | grep -m1 versionName | tr -d '\r' | sed 's/^ *//')"
    "$ADB" shell am force-stop "$PKG"; "$ADB" logcat -c
    "$ADB" shell am start -n "$ACT" -W >/dev/null 2>&1; sleep 6
    if probe "$PRE"; then
        echo "  이전 설치본: $(summary "$PRE")"
        shot "T40-1-이전앱-전체칩-섞인목록.png"
        # before 판정은 **옛 셸이 그 기기에 남아 있을 때만** 한다 — 이미 새 앱이 깔린 기기에서 재실행하면
        # '옛 UI 가 보였다'는 근거 자체가 없으므로 FAIL 이 아니라 INFO 로 넘긴다(스크립트 재실행 가능성).
        if [ "$(json "$PRE" ".chipCount")" = "3" ] || [ "$(json "$PRE" ".allWordCount")" != "0" ]; then
            check "before 이전 앱에 '전체' 문자열이 실제로 보인다(옛 UI)" "yes" \
                "$(node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(d.allWordCount>0?'yes':'no')" "$PRE")"
            check "before 이전 앱 칩이 3개(전체·학교 도착·터미널 도착)" "yes" \
                "$(node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(d.chipCount===3?'yes':'no('+d.chipCount+')')" "$PRE")"
        else
            info "이미 새 UI(칩 $(json "$PRE" ".chipCount")개) — before 근거는 T40-1차 실행 기록·T33 증거 사용" "-"
        fi
    else
        info "이전 설치본 DOM 조회 실패 — before 근거는 T33 증거(옛 번들)·웹 T38 before 로 갈음" "-"
    fi
else
    info "기존 설치본 없음 — before 근거는 T33 증거·웹 T38 before 로 갈음" "-"
fi

# ── 2) 새 APK 설치 (앱 데이터 유지 = 실제 사용자 업데이트 경로) ────────────────────
echo
echo "### 2. 새 debug APK 설치 (adb install -r — 앱 데이터·SW 캐시 유지)"
"$ADB" install -r -t "$APK" | sed 's/^/  /'
"$ADB" shell dumpsys package "$PKG" | grep -m1 versionName | tr -d '\r' | sed 's/^ */  설치 후 /'

echo
echo "### 3. 새 빌드 1차 로드 (옛 셸 → SW 교체 준비)"
"$ADB" shell am force-stop "$PKG"; "$ADB" logcat -c
"$ADB" shell am start -n "$ACT" -W 2>&1 | grep -E 'Status|TotalTime|Error' | sed 's/^/  /'
sleep 7
shot "T40-2-새빌드-1차로드.png"
DOM1="$OUT/T40-dom-2-load1.json"
probe "$DOM1" && echo "  1차: $(summary "$DOM1")"

echo
echo "### 4. 새 빌드 2차 로드 (서비스워커가 새 셸로 교체된 뒤) ★ 판정 기준"
"$ADB" shell am force-stop "$PKG"
"$ADB" shell am start -n "$ACT" -W >/dev/null 2>&1
sleep 7
DOM2="$OUT/T40-dom-3-load2.json"
shot "T40-3-새빌드-2차로드-터미널도착.png"
if probe "$DOM2"; then
    echo "  2차: $(summary "$DOM2")"
    printf '  시각=%s · dayType=%s · 요일탭=%s\n' "$(json "$DOM2" ".clock")" "$(json "$DOM2" ".dayType")" "$(json "$DOM2" ".dayTabLabels")"
    printf '  행샘플=%s\n' "$(node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(JSON.stringify(d.rowSample))" "$DOM2")"
else
    echo "  CDP DOM 조회 실패 — AC-U16-6c 는 **미검증**(스크린샷·logcat 만)"
    fail=1
fi

echo
echo "### 4b. 운행일 주입 ($DAY_URL) — 오늘이 휴일이면 행이 안 그려지므로"
DOMDAY="$OUT/T40-dom-4-day2026-10-19.json"
if probe "$DOMDAY" --nav "$DAY_URL"; then
    echo "  운행일: $(summary "$DOMDAY")"
    shot "T40-4-운행일-터미널도착-목록.png"
else
    echo "  운행일 DOM 조회 실패(미검증)"
    fail=1
fi

echo
echo "### 4c. '학교 도착' 칩을 실제로 눌러 전환 (택1 동작 실측)"
DOMIN="$OUT/T40-dom-5-chip-in.json"
if probe "$DOMIN" --click-chip in; then
    echo "  전환 후: $(summary "$DOMIN")"
    shot "T40-5-학교도착-전환-목록.png"
else
    echo "  칩 클릭 실측 실패(미검증)"
    fail=1
fi

# ── 5) logcat ──────────────────────────────────────────────────────────────────
echo
echo "### 5. logcat 판정 (누적)"
"$ADB" logcat -d > "$OUT/T40-logcat.txt"
"$ADB" logcat -d -b crash > "$OUT/T40-logcat-crash.txt" 2>/dev/null || true
TOTAL="$(wc -l < "$OUT/T40-logcat.txt" | tr -d ' ')"
FATAL="$(grep -c -E 'FATAL EXCEPTION|AndroidRuntime: FATAL' "$OUT/T40-logcat.txt" || true)"
FATAL_C="$(grep -c -E 'FATAL EXCEPTION' "$OUT/T40-logcat-crash.txt" || true)"
ANR="$(grep -c -E 'ANR in |Reason: Input dispatching timed out' "$OUT/T40-logcat.txt" || true)"
CONSOLE="$(grep -c -E 'Capacitor/Console.*(Error|Uncaught)' "$OUT/T40-logcat.txt" || true)"
DISPLAYED_M="$(grep -m1 -E "Displayed $PKG/.MainActivity" "$OUT/T40-logcat.txt" || true)"
grep -E 'Capacitor/Console' "$OUT/T40-logcat.txt" | head -10 > "$OUT/T40-console.txt" || true
printf '  logcat %s줄 · 앱 콘솔 %s줄 · %s\n' "$TOTAL" "$(wc -l < "$OUT/T40-console.txt" | tr -d ' ')" "${DISPLAYED_M:-Displayed 없음}"
check "logcat FATAL EXCEPTION(main)" "0" "$FATAL"
check "logcat FATAL EXCEPTION(crash 버퍼)" "0" "$FATAL_C"
check "logcat ANR" "0" "$ANR"
check "앱 콘솔 Error/Uncaught" "0" "$CONSOLE"

# ── 6) 판정 (AC-U16-6c · AC-U16-6d) ────────────────────────────────────────────
echo
echo "### 6. 수용 기준 판정 (AC-U16-6c) — 2차 로드 DOM"
if [ -f "$DOM2" ]; then
    check "① 칩 2개 (학교 도착·터미널 도착)" "2" "$(json "$DOM2" ".chipCount")"
    check "① '전체' 문자열 0건(본문 innerText)" "0" "$(json "$DOM2" ".allWordCount")"
    check "① '전체' 문자열 0건(HTML outerHTML)" "0" "$(json "$DOM2" ".allWordOuterCount")"
    check "① 옛 UI 탭바(app-tabs) 없음" "false" "$(json "$DOM2" ".oldUiTabbar")"
    check "② 기본 선택 정확히 1개" "1" "$(json "$DOM2" ".chipPressedCount")"
    check "② 기본 선택 방향 = out(터미널 도착)" "out" "$(json "$DOM2" ".chipPressedDirections")"
    check "② 칩 라벨 행 전체(학교 도착·터미널 도착)" "true" \
        "$(node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const row=d.chipRowText||'';console.log(row.includes('학교 도착')&&row.includes('터미널 도착')?'true':'false('+row+')')" "$DOM2")"
    check "③ 목록 방향 섞임 0건(in=0 · 미표기0 · 기타0)" "true" \
        "$(node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const r=d.rowDirections;console.log(r.in===0&&r.none===0&&r.other===0?'true':'false('+JSON.stringify(r)+')')" "$DOM2")"
    check "③ 행이 실제로 그려짐(2차 로드 · 오늘)" "true" \
        "$(node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(d.rowCount>0||d.emptyShown||d.emptyFilterShown?'true':'false')" "$DOM2")"
    check "③ 행 문구도 한 방향만(학교로 도착 0건)" "0" "$(json "$DOM2" ".rowTextIn")"
    check "④ 설치 안내 노드 0건" "0" "$(json "$DOM2" ".installNodes")"
    check "④ 설치 안내 testid(install-hint) 0건" "0" "$(json "$DOM2" ".installHintTestidCount")"
    check "④ 금지어(홈 화면·전체화면·한 번만·전체) 0건(본문)" "0" "$(json "$DOM2" ".forbiddenTotal")"
    check "④ 금지어 0건(HTML)" "0" "$(json "$DOM2" ".forbiddenOuterTotal")"
    check "데이터 오류 화면 없음(data-error)" "<null>" "$(json "$DOM2" ".dataError")"
    check "앱 셸(appbar) 렌더" "true" "$(json "$DOM2" ".appbar")"
    check "요일 탭(day-tabs) 렌더" "true" "$(json "$DOM2" ".dayTabsHost")"
    case "$(json "$DOM2" ".cacheKeys")" in
        *2026-10-05*) check "옛 SW 캐시 키(2026-10-05) 없음" "no" "yes" ;;
        *) check "옛 SW 캐시 키(2026-10-05) 없음" "no" "no" ;;
    esac
    echo "  (참고) 캐시 키: $(json "$DOM2" ".cacheKeys")"
    echo "  (참고) 번들: $(json "$DOM2" ".bundleSrcs")"
else
    echo "  2차 로드 DOM 없음 — AC-U16-6c **미검증**"
    fail=1
fi

if [ -f "$DOMDAY" ]; then
    echo
    echo "### 6b. 판정 — 운행일 주입 DOM"
    check "운행일 시간표 행 렌더(2026-10-19)" "true" \
        "$(node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(d.rowCount>0?'true':'false')" "$DOMDAY")"
    check "운행일에도 방향 섞임 0건" "true" \
        "$(node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const r=d.rowDirections;console.log(r.in===0&&r.none===0&&r.other===0?'true':'false('+JSON.stringify(r)+')')" "$DOMDAY")"
    check "운행일에도 '전체' 0건" "0" "$(json "$DOMDAY" ".allWordCount")"
    check "운행일에도 칩 2개·기본 out" "out" "$(json "$DOMDAY" ".chipPressedDirections")"
fi

if [ -f "$DOMIN" ]; then
    echo
    echo "### 6c. 판정 — '학교 도착' 칩 클릭 후 DOM"
    check "클릭 후 선택 방향 = in" "in" "$(json "$DOMIN" ".chipPressedDirections")"
    check "클릭 후 선택 1개 유지" "1" "$(json "$DOMIN" ".chipPressedCount")"
    check "클릭 후 목록은 in 만(out=0 · 미표기0 · 기타0)" "true" \
        "$(node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const r=d.rowDirections;console.log(r.out===0&&r.none===0&&r.other===0&&r.in>0?'true':'false('+JSON.stringify(r)+')')" "$DOMIN")"
    check "클릭 후 '전체' 0건" "0" "$(json "$DOMIN" ".allWordCount")"
fi

# ── 7) 에뮬레이터 종료 ─────────────────────────────────────────────────────────
if [ "$STARTED" = "1" ]; then
    echo
    echo "[emu] 종료 (adb emu kill)"
    "$ADB" emu kill >/dev/null 2>&1 || true
fi

echo
if [ "$fail" -eq 0 ]; then echo "T40 EMULATOR SMOKE: PASS"; else echo "T40 EMULATOR SMOKE: FAIL"; fi
exit "$fail"
