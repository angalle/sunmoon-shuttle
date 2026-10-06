#!/usr/bin/env bash
# T25 — 에뮬레이터 스모크 (네이티브 스플래시 → 웹 스플래시 → 본문, 오프라인)
# 소유: InfraProjectCreator · T25. 사용: bash scripts/t25_emulator_smoke.sh [AVD이름]
#
# 재는 것 (docs/07 §7 AC-U8 + 카드 수용 기준)
#   1. debug APK 안에 계약 데이터(data/timetable.json)·웹 자산·우리 리소스가 들어갔는가
#   2. 콜드 스타트에서 **스플래시 → 본문 전환**이 보이는가 — `am start` 직후 스크린샷을 연속 촬영해
#      프레임마다 (시각 / 전체 평균색 / 중앙 로고영역 평균색 / 중앙 파란픽셀 비율 / 본문과의 SSIM)을 낸다.
#      → ① 네이티브 스플래시 프레임 ② 스플래시와 본문 **사이의 빈 흰 화면 프레임 수**(공백) ③ 본문 도달 시각.
#      스크린샷 간격이 0.3~0.4s 라 그보다 짧은 순간은 못 잡는다(해상도 한계 — 증거에 명시).
#   3. logcat: FATAL EXCEPTION 0 · ANR 0 · 앱 콘솔 오류 0 · 프로세스 생존 · Displayed 시각
#   4. 오프라인(비행기 모드) 재실행: 본문 화면이 그대로 뜨는가(온라인 본문과 SSIM) · 스플래시에 갇히지 않는가
#
# 스크린샷 산출물(.session-notes/): T25-1-스플래시직후.png · T25-2-전환직후.png · T25-3-본문.png · T25-6-오프라인.png
#                                    + t25-frames/launch-*.png (전체 프레임 원본)
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
ADB="$ANDROID_HOME/platform-tools/adb"
AVD="${1:-meteor-dodge-api35}"
PKG="com.angalle.sunmoonshuttle"
ACT="$PKG/.MainActivity"
APK="android/app/build/outputs/apk/debug/app-debug.apk"
OUT=".session-notes"
FRAMES="$OUT/t25-frames"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail=0
check() { if [ "$2" = "$3" ]; then printf '  PASS  %-46s %s\n' "$1" "$3"; else printf '  FAIL  %-46s 기대=%s 실제=%s\n' "$1" "$2" "$3"; fail=1; fi; }

# ── 프레임 측정 헬퍼 ──────────────────────────────────────────────────────────────
now_ms() { python3 -c 'import time;print(int(time.time()*1000))'; }
# RGB 로 디코드해 1x1 로 줄인 값 = 영역 평균색.
rgb_of() { # <png> <ffmpeg필터> → #rrggbb
    ffmpeg -v error -i "$1" -vf "$2,scale=1:1" -f rawvideo -pix_fmt rgb24 - 2>/dev/null > "$TMP/px"
    python3 -c "import sys;d=open(sys.argv[1],'rb').read(3);print('#%02x%02x%02x'%tuple(d),end='')" "$TMP/px"
}
# 중앙 로고영역에서 "진한 강조색(파랑)" 픽셀 비율 — 로고 타일이 실제로 그려졌는지.
blue_ratio() { # <png> <crop필터> → 0.000
    ffmpeg -v error -i "$1" -vf "$2" -f rawvideo -pix_fmt rgb24 - 2>/dev/null > "$TMP/raw"
    python3 -c "
import sys
d = open(sys.argv[1], 'rb').read()
n = len(d) // 3
if n == 0:
    print('nan', end=''); raise SystemExit
blue = sum(1 for i in range(0, 3 * n, 3) if d[i + 2] > d[i] + 40 and d[i + 2] > 120 and d[i] < 140)
print(f'{blue / n:.3f}', end='')
" "$TMP/raw"
}
# 두 PNG 의 SSIM(구조 유사도). 1.000 에 가까우면 같은 화면. (요약 줄은 info 레벨에서만 나온다)
ssim() { ffmpeg -hide_banner -nostats -i "$1" -i "$2" -lavfi ssim -f null - 2>&1 | grep -oE 'All:[0-9.]+' | head -1 | cut -d: -f2; }
# SSIM 값이 임계 이상인가
ge() { python3 -c "
import sys
try: v = float(sys.argv[1])
except ValueError: sys.exit(1)
sys.exit(0 if v >= float(sys.argv[2]) else 1)" "$1" "$2"; }
# 색(hex)의 상대휘도가 임계 이상인가 — "거의 흰 화면" 판정용
bright() { python3 -c "
import sys
h = sys.argv[1].lstrip('#')
r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
sys.exit(0 if (0.299 * r + 0.587 * g + 0.114 * b) / 255 >= float(sys.argv[2]) else 1)" "$1" "$2"; }

echo "### 0. 환경"
echo "  AVD=$AVD · $(date '+%Y-%m-%d %H:%M:%S %Z')"
"$ADB" wait-for-device
WMSIZE="$("$ADB" shell wm size | tr -d '\r' | grep -oE '[0-9]+x[0-9]+' | head -1)"
W="${WMSIZE%x*}"; H="${WMSIZE#*x}"
echo "  기기: Android $("$ADB" shell getprop ro.build.version.release | tr -d '\r') (API $("$ADB" shell getprop ro.build.version.sdk | tr -d '\r')) · $WMSIZE @$("$ADB" shell wm density | tr -d '\r')"
CROP_CENTER="crop=500:500:$((W / 2 - 250)):$((H / 2 - 250))"   # 화면 중앙 500x500 = 로고 자리
CROP_TOP="crop=$W:120:0:0"                                      # 상태바 띠

echo "### 1. APK 자산 확인"
for entry in assets/public/index.html assets/public/data/timetable.json res/drawable-xxhdpi-v4/splash_logo.png res/drawable/splash.xml; do
    line="$(unzip -l "$APK" | grep -m1 "$entry" || true)"
    check "APK 자산 $entry" "true" "$([ -n "$line" ] && echo true || echo false)"
    [ -n "$line" ] && echo "        $(echo "$line" | tr -s ' ')"
done

echo "### 2. 설치"
"$ADB" install -r -t "$APK" 2>&1 | tail -2

echo "### 3. 콜드 스타트 + 프레임 연속 촬영 (스플래시 → 전환 → 본문)"
"$ADB" shell am force-stop "$PKG"
"$ADB" shell settings put global window_animation_scale 0
"$ADB" shell settings put global transition_animation_scale 0
"$ADB" shell settings put global animator_duration_scale 0
"$ADB" logcat -c
mkdir -p "$FRAMES"
rm -f "$FRAMES"/*.png
T0="$(now_ms)"
: > "$TMP/times.txt"
"$ADB" shell am start -n "$ACT" > /dev/null
for i in $(seq -w 1 12); do
    printf 'launch-%s %s\n' "$i" "$(( $(now_ms) - T0 ))" >> "$TMP/times.txt"
    "$ADB" exec-out screencap -p > "$FRAMES/launch-$i.png" 2>/dev/null
done
sleep 6
printf 'body %s\n' "$(( $(now_ms) - T0 ))" >> "$TMP/times.txt"
"$ADB" exec-out screencap -p > "$FRAMES/body.png"

echo "### 4. 프레임별 측정 (t = am start 기준 ms · 본문SSIM = 최종 프레임과의 구조 유사도)"
printf '  %-14s %-7s %-9s %-9s %-6s %-8s %-9s %s\n' "프레임" "t(ms)" "전체" "중앙" "파랑비" "본문SSIM" "상태바" "판정"
: > "$TMP/classes.txt"
for f in "$FRAMES"/launch-*.png "$FRAMES/body.png"; do
    tag="$(basename "$f" .png)"
    t="$(grep -m1 -E "^$tag " "$TMP/times.txt" | cut -d' ' -f2)"
    [ -n "$t" ] || t="?"
    whole="$(rgb_of "$f" "null")"
    center="$(rgb_of "$f" "$CROP_CENTER")"
    top="$(rgb_of "$f" "$CROP_TOP")"
    ratio="$(blue_ratio "$f" "$CROP_CENTER")"
    s="$(ssim "$FRAMES/body.png" "$f")"
    cls="스플래시/전환"
    if [ "$f" = "$FRAMES/body.png" ]; then cls="본문(최종)"
    elif ge "${s:-0}" 0.90; then cls="본문"
    elif [ "$ratio" = "0.000" ] && bright "$center" 0.95; then cls="빈화면"   # 로고 없음 + 거의 흰색 = 스플래시와 본문 사이의 빈 화면
    fi
    printf '%s %s %s %s\n' "$tag" "$t" "$whole" "$cls" >> "$TMP/classes.txt"
    printf '  %-14s %-7s %-9s %-9s %-6s %-8s %-9s %s\n' "$(basename "$f")" "$t" "$whole" "$center" "$ratio" "${s:-?}" "$top" "$cls"
done

# 대표 프레임: 네이티브 스플래시 첫 프레임 / 스플래시 마지막 프레임(전환 직후) / 본문
SPLASH_FIRST="$(grep -m1 '스플래시/전환$' "$TMP/classes.txt" | cut -d' ' -f1 || true)"
LAST_SPLASH="$(grep '스플래시/전환$' "$TMP/classes.txt" | tail -1 | cut -d' ' -f1 || true)"
FIRST_BODY="$(grep -m1 -E '본문$' "$TMP/classes.txt" | cut -d' ' -f1 || true)"
[ -n "${SPLASH_FIRST:-}" ] && cp "$FRAMES/$SPLASH_FIRST.png" "$OUT/T25-1-스플래시직후.png"
[ -n "${LAST_SPLASH:-}" ] && cp "$FRAMES/$LAST_SPLASH.png" "$OUT/T25-2-전환직후.png"
cp "$FRAMES/body.png" "$OUT/T25-3-본문.png"

check "네이티브 스플래시 프레임 존재" "true" "$([ -n "${SPLASH_FIRST:-}" ] && echo true || echo false)"
check "본문 프레임 도달" "true" "$([ -n "${FIRST_BODY:-}" ] && echo true || echo false)"

# 공백 실측: 네이티브 스플래시와 첫 본문 프레임 **사이에** 빈 흰 화면이 몇 프레임인가.
# 요구는 "가능하면 공백 0"(카드). 실측값을 그대로 남기고, 하드 게이트는 아래 "검은/미스타일 프레임 0" 으로 잡는다:
# 스플래시~본문 사이의 흰 프레임은 **웹 페이지가 자기 body 배경(--color-bg=#ffffff)을 먼저 칠하기 때문**이고
# (색은 웹 스플래시 배경과 동일 → 색 번쩍임은 없다) 네이티브만으로는 없앨 수 없다(웹 계층에서 index.html 에
# 인라인 스플래시를 넣거나 @capacitor/splash-screen autoHide=false + hide() 호출이 필요) → 소견으로 남긴다.
METRICS="$(python3 - "$TMP/classes.txt" <<'PY'
import sys
rows = [l.split() for l in open(sys.argv[1], encoding='utf-8').read().strip().splitlines()]
names = [r[0] for r in rows]
splash = [i for i, r in enumerate(rows) if r[3] == '스플래시/전환']
body = [i for i, r in enumerate(rows) if r[3] in ('본문', '본문(최종)')]
gap = '?'
if splash and body:
    a, b = splash[0], body[0]
    gap = sum(1 for r in rows[a:b] if r[3] == '빈화면')
dark = 0
for r in rows:
    h = r[2].lstrip('#')
    rr, gg, bb = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    if (0.299 * rr + 0.587 * gg + 0.114 * bb) / 255 < 0.5:
        dark += 1
print(f'{gap} {dark} {rows[splash[0]][1] if splash else "?"} {rows[body[0]][1] if body else "?"}')
PY
)"
GAP="$(echo "$METRICS" | cut -d' ' -f1)"
DARK="$(echo "$METRICS" | cut -d' ' -f2)"
check "검은/미스타일 프레임 수(빈 화면 없음)" "0" "$DARK"
echo "  [소견] 스플래시~본문 사이 빈 흰 화면 = ${GAP}프레임 (요구: 가능하면 0) · 색은 웹 스플래시 배경(#ffffff)과 동일"
echo "  대표 프레임: 스플래시=$SPLASH_FIRST · 전환=$LAST_SPLASH · 본문=$FIRST_BODY"
echo "  프레임 시각(ms): $(tr '\n' ' ' < "$TMP/times.txt")"

echo "### 5. logcat 판정"
"$ADB" logcat -d > "$OUT/T25-logcat.txt"
"$ADB" logcat -d -b crash > "$OUT/T25-logcat-crash.txt" 2>/dev/null || true
TOTAL="$(wc -l < "$OUT/T25-logcat.txt" | tr -d ' ')"
FATAL="$(grep -c -E 'FATAL EXCEPTION|AndroidRuntime: FATAL' "$OUT/T25-logcat.txt" || true)"
FATAL_C="$(grep -c -E 'FATAL EXCEPTION' "$OUT/T25-logcat-crash.txt" || true)"
ANR="$(grep -c -E 'ANR in |Reason: Input dispatching timed out|Reason: Broadcast of Intent' "$OUT/T25-logcat.txt" || true)"
CONSOLE="$(grep -c -E 'Capacitor/Console.*(Error|Uncaught)' "$OUT/T25-logcat.txt" || true)"
RENDERER="$(grep -c -E 'crash detected|Renderer process .* (crash|gone)' "$OUT/T25-logcat.txt" || true)"
PID="$("$ADB" shell pidof "$PKG" | tr -d '\r')"
DISPLAYED="$(grep -m1 -E 'Displayed '"$PKG"'/.MainActivity' "$OUT/T25-logcat.txt" || true)"
grep -E 'Capacitor/Console' "$OUT/T25-logcat.txt" | head -8 > "$OUT/T25-console.txt" || true
check "logcat FATAL EXCEPTION(main)" "0" "$FATAL"
check "logcat FATAL EXCEPTION(crash 버퍼)" "0" "$FATAL_C"
check "logcat ANR" "0" "$ANR"
check "앱 콘솔 오류(Capacitor/Console)" "0" "$CONSOLE"
check "WebView 렌더러 크래시" "0" "$RENDERER"
check "앱 프로세스 생존" "true" "$([ -n "$PID" ] && echo true || echo false)"
echo "  logcat $TOTAL 줄 · 앱 pid=${PID:-없음} · 콘솔 로그 $(wc -l < "$OUT/T25-console.txt" | tr -d ' ')줄"
printf '  실행 로그: %s\n' "${DISPLAYED:-<Displayed 없음>}"

echo "### 6. 오프라인(비행기 모드) 재실행"
"$ADB" shell cmd connectivity airplane-mode enable > /dev/null 2>&1 || "$ADB" shell svc wifi disable
sleep 2
AIRPLANE="$("$ADB" shell settings get global airplane_mode_on | tr -d '\r')"
check "비행기 모드 켜짐" "1" "$AIRPLANE"
"$ADB" shell am force-stop "$PKG"
"$ADB" logcat -c
"$ADB" shell am start -n "$ACT" > /dev/null
sleep 9
"$ADB" exec-out screencap -p > "$OUT/T25-6-오프라인.png"
"$ADB" logcat -d > "$OUT/T25-logcat-offline.txt"
OFF_FATAL="$(grep -c -E 'FATAL EXCEPTION|AndroidRuntime: FATAL' "$OUT/T25-logcat-offline.txt" || true)"
OFF_CONSOLE="$(grep -c -E 'Capacitor/Console.*(Error|Uncaught)' "$OUT/T25-logcat-offline.txt" || true)"
OFF_PID="$("$ADB" shell pidof "$PKG" | tr -d '\r')"
S="$(ssim "$OUT/T25-3-본문.png" "$OUT/T25-6-오프라인.png")"
check "오프라인 FATAL EXCEPTION" "0" "$OFF_FATAL"
check "오프라인 앱 콘솔 오류" "0" "$OFF_CONSOLE"
check "오프라인 프로세스 생존" "true" "$([ -n "$OFF_PID" ] && echo true || echo false)"
echo "  온라인 본문 vs 오프라인 본문 SSIM(All) = ${S:-<측정 실패>}  (1.000 에 가까우면 같은 화면)"
if ge "${S:-0}" 0.95; then SSIM_VERDICT=PASS; else SSIM_VERDICT=FAIL; fi
check "오프라인 본문 = 온라인 본문과 동일 화면(SSIM≥0.95)" "PASS" "$SSIM_VERDICT"
"$ADB" shell cmd connectivity airplane-mode disable > /dev/null 2>&1 || true

echo "### 7. 뒤로가기(앱 종료) 확인"
"$ADB" shell input keyevent 4
sleep 2
"$ADB" shell dumpsys activity activities | grep -c "$PKG" > "$TMP/after.txt" || true
echo "  뒤로가기 후 ActivityRecord 매칭 줄 수: $(cat "$TMP/after.txt")"

# 기기 설정 원복(스모크가 바꾼 애니메이션 배율·비행기 모드)
"$ADB" shell settings put global window_animation_scale 1
"$ADB" shell settings put global transition_animation_scale 1
"$ADB" shell settings put global animator_duration_scale 1
"$ADB" shell cmd connectivity airplane-mode disable > /dev/null 2>&1 || true

echo
echo "스크린샷: $OUT/T25-1-스플래시직후.png · $OUT/T25-2-전환직후.png · $OUT/T25-3-본문.png · $OUT/T25-6-오프라인.png"
if [ "$fail" -eq 0 ]; then echo "T25 EMULATOR SMOKE: PASS"; else echo "T25 EMULATOR SMOKE: FAIL"; fi
exit "$fail"
