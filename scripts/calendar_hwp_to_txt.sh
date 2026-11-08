#!/usr/bin/env bash
# 학사력(HWP) → 텍스트 정본 변환 (docs/10-academic-calendar.md §4 · T41)
#
#   bash scripts/calendar_hwp_to_txt.sh data/raw/calendar/2026학년도-학사력.hwp
#     → data/raw/calendar/2026학년도-학사력.txt
#
# - HWP 해석은 pyhwp(hwp5html)에 맡긴다. 저장소 런타임 의존성을 늘리지 않으려고 `uvx` 로 **일회성 실행**한다.
# - 출력 txt 는 사람이 읽고 diff 할 수 있는 형태다: 월 머리글 1줄 + 일정 1건당 1줄(`◉ D(요일)[~D(요일)] 일정명`).
#   일정 문구는 원문 그대로이며 공백만 하나로 줄인다(값 변형 없음). 달력 격자(날짜 숫자 표)는 버린다.
# - 같은 입력이면 같은 출력(결정적)이다 — 원본 hwp 와 txt 를 함께 커밋한다.
set -euo pipefail

src="${1:?사용법: bash scripts/calendar_hwp_to_txt.sh <학사력.hwp> [출력.txt]}"
out="${2:-${src%.hwp}.txt}"
command -v uvx >/dev/null || { echo "uvx 가 필요합니다(https://docs.astral.sh/uv/)." >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

uvx --quiet --from pyhwp --with six hwp5html --output "$work/html" "$src" >/dev/null

python3 -I - "$work/html/index.xhtml" "$out" "$(basename "$src")" <<'PY'
import html
import re
import sys

xhtml, out_path, src_name = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(xhtml, encoding="utf-8").read()
# 표 행/셀 경계를 줄·구분자로 바꾼 뒤 태그를 걷어 낸다
text = re.sub(r"<(/?)tr[^>]*>", "\n", text)
text = re.sub(r"</t[dh]>", " | ", text)
text = re.sub(r"<[^>]+>", "", text)
text = html.unescape(text)

lines = [re.sub(r"\s+", " ", line).strip(" |") for line in text.split("\n")]
month_re = re.compile(r"^(?:(\d{4})년 )?(\d{1,2})월 / [A-Z]+$")
title_re = re.compile(r"^\d{4}학년도 학사력$")

result = [f"# 원본: {src_name} (선문대 학사력 · 사람이 내려받아 반입 — docs/10 §4)"]
for line in lines:
    if title_re.match(line) or month_re.match(line):
        result.append(line)
    elif line.startswith("◉"):
        for item in line.split("◉")[1:]:
            item = item.strip(" |")
            if item:
                result.append(f"◉ {item}")

if len(result) < 3:
    sys.exit("학사력 표에서 월 머리글·일정을 찾지 못했습니다 — 원본 형식이 바뀌었는지 확인하세요.")
open(out_path, "w", encoding="utf-8").write("\n".join(result) + "\n")
print(f"{out_path}: {len(result) - 1}줄")
PY
