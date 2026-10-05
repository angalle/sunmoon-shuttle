#!/usr/bin/env python3
# T2 독립 추출기(2) — colspan 을 확장해 **논리 열** 단위로 표를 뽑는다.
# 파서(tools/scraper/parse.ts)와 다른 구현으로, 골든 기대값의 근거를 만든다.
import glob, html, json, re
from typing import Any

META = {
    'asan-ktx': ['seq', 'depCampus', 'depStation', 'arrCampus', 'note'],
    'cheonan-station': ['seq', 'depCampus', 'depStation', 'viaHairexpa', 'viaYongam', 'arrCampus', 'note'],
    'cheonan-terminal': ['seq', 'depCampus', 'depTerminal', 'viaDujeong', 'viaHomeMart', 'viaSeoulJeong', 'arrCampus', 'note'],
    'onyang': ['seq', 'depCampus', 'viaJueun', 'viaOnyangStation', 'viaAsanTerminal', 'viaGweongok', 'arrCampus', 'note'],
}

def clean(x: str) -> str:
    x = re.sub(r'<br\s*/?>', ' ', x)
    x = re.sub(r'<[^>]+>', '', x)
    x = html.unescape(x).replace('\u3000', ' ')
    return re.sub(r'\s+', ' ', x).strip()

def raw_cells(row: str):
    out = []
    for m in re.finditer(r'<t([hd])\b([^>]*)>(.*?)</t\1>', row, re.S):
        span_m = re.search(r'colspan\s*=\s*"(\d+)"', m.group(2))
        span = int(span_m.group(1)) if span_m else 1
        out.append((clean(m.group(3)), span))
    return out

def logical(cells_pairs, ncol_headers):
    """body 셀들을 헤더 슬롯에 매핑한다(헤더 셀 경계를 넘으면 예외)."""
    vals: list[Any] = [None] * len(ncol_headers)
    slot = 0
    for text, span in cells_pairs:
        covered = [i for i, (s, e) in enumerate(ncol_headers) if not (e <= slot or s >= slot + span)]
        # 완전히 덮는 헤더 셀만 허용
        ok = all(ncol_headers[i][0] <= slot and ncol_headers[i][1] >= slot + span for i in covered)
        if not ok or not covered:
            raise SystemExit(f'정렬 실패 slot={slot} span={span} text={text!r}')
        v: Any = text
        if v in ('Χ', 'X', 'χ') or v == '':
            v = None
        vals[covered[0]] = v
        for i in covered[1:]:
            vals[i] = v
        slot += span
    if slot != ncol_headers[-1][1]:
        raise SystemExit(f'슬롯 합 불일치 {slot} != {ncol_headers[-1][1]}')
    return vals

rows_out = []
for path in sorted(glob.glob('data/raw/*.html')):
    base = path.split('/')[-1][:-5]
    parts = base.split('-')
    slug = '-'.join(parts[2:-1])
    rec: dict[str, Any] = {'file': path, 'slug': slug}
    if slug not in META:
        rec['note'] = 'META 없음(운행 중단 노선 후보)'
        s = open(path, encoding='utf-8', errors='replace').read()
        m = re.search(r'<h4 class="title22[^"]*"[^>]*>(.*?)</h4>', s, re.S)
        rec['h4'] = clean(m.group(1)) if m else None
        rows_out.append(rec)
        continue
    s = open(path, encoding='utf-8', errors='replace').read()
    tables = list(re.finditer(r'<table\b[^>]*>(.*?)</table>', s, re.S))
    thead = tbody = None
    for m in tables:
        if re.search(r'<thead\b', m.group(1)):
            th = re.search(r'<thead[^>]*>(.*?)</thead>', m.group(1), re.S)
            tb = re.search(r'<tbody[^>]*>(.*?)</tbody>', m.group(1), re.S)
            if th and tb:
                thead, tbody = th.group(1), tb.group(1)
                break
    hdr = raw_cells(re.search(r'<tr\b[^>]*>(.*?)</tr>', thead, re.S).group(1))
    # 헤더 슬롯 범위
    hdr_slots = []
    slot = 0
    for text, span in hdr:
        hdr_slots.append((slot, slot + span, text))
        slot += span
    rec['header_labels'] = [h[2] for h in hdr_slots]
    rec['header_slot_count'] = slot
    trs = re.findall(r'<tr\b[^>]*>(.*?)</tr>', tbody, re.S)
    keys = META[slug]
    rec['keys'] = keys
    rec['row_count'] = len(trs)
    data = []
    for tr in trs:
        vals = logical(raw_cells(tr), hdr_slots)
        data.append(dict(zip(keys, vals)))
    rec['rows'] = data
    rec['chi_or_null_cells'] = sum(1 for r in data for k, v in r.items() if v is None)
    rec['note_values'] = sorted({str(r['note']) for r in data if r.get('note') is not None})
    rows_out.append(rec)

print(json.dumps(rows_out, ensure_ascii=False, indent=1))
