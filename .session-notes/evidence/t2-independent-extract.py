#!/usr/bin/env python3
# T2 독립 추출기 — 파서(tools/scraper)와 **다른 구현**으로 원본 HTML 에서 기대값을 뽑는다.
# 목적: 골든 테스트 기대값을 '손으로 적지' 않고 원본에서 직접 얻었다는 증거.
# 사용: python3 .session-notes/evidence/t2-independent-extract.py
import glob, html, json, re, sys

def clean(x: str) -> str:
    x = re.sub(r'<br\s*/?>', ' ', x)
    x = re.sub(r'<[^>]+>', '', x)
    x = html.unescape(x)
    x = x.replace('\u3000', ' ')
    return re.sub(r'\s+', ' ', x).strip()

def cells(row_html: str):
    return [clean(c) for c in re.findall(r'<t[hd]\b[^>]*>(.*?)</t[hd]>', row_html, re.S)]

def extract(path: str):
    s = open(path, encoding='utf-8', errors='replace').read()
    out = {'file': path}

    # 파일명 규칙: <학기>-<학기번호>-...<노선 slug>...-<요일>.html
    base = path.split('/')[-1][:-5]
    parts = base.split('-')
    out['filename_parts'] = parts
    out['semester_from_name'] = parts[0] + '-' + parts[1]
    out['day_from_name'] = parts[-1]
    out['slug_from_name'] = '-'.join(parts[2:-1])

    # 학기 제목 h4 (시간표 제목)
    for m in re.finditer(r'<h4[^>]*>(.*?)</h4>', s, re.S):
        t = clean(m.group(1))
        if '학기' in t and '시간표' in t:
            out['semester_title'] = t
            mm = re.search(r'\((\d{4})\.(\d{1,2})\.(\d{1,2})\.?\s*\([^)]*\)\s*~\s*(\d{4})\.(\d{1,2})\.(\d{1,2})', t)
            if mm:
                g = mm.groups()
                out['startsOn'] = f'{g[0]}-{int(g[1]):02d}-{int(g[2]):02d}'
                out['endsOn'] = f'{g[3]}-{int(g[4]):02d}-{int(g[5]):02d}'
            break

    # 노선명 (title22)
    m = re.search(r'<h4 class="title22">(.*?)</h4>', s, re.S)
    out['route_title'] = clean(m.group(1)).lstrip('○').strip() if m else None

    # 운행노선
    m = re.search(r'운행노선\s*:?\s*([^<]*)', s)
    out['path_raw'] = html.unescape(m.group(1)).strip() if m else None

    # 시간표 표 — 헤더 첫 칸이 '순' 인 표
    tables = list(re.finditer(r'<table\b[^>]*>(.*?)</table>', s, re.S))
    out['table_count'] = len(tables)
    sched = None
    for idx, m in enumerate(tables):
        rows = re.findall(r'<tr\b[^>]*>(.*?)</tr>', m.group(1), re.S)
        if not rows:
            continue
        hdr = cells(rows[0])
        if hdr and hdr[0] in ('순', '번', '번호'):
            sched = (idx, hdr, rows)
            break
    if sched:
        idx, hdr, rows = sched
        out['sched_table_index'] = idx
        out['columns'] = hdr
        data = [cells(r) for r in rows[1:]]
        out['row_count'] = len(data)
        out['cell_counts'] = sorted({len(r) for r in data})
        out['first_row'] = data[0] if data else None
        out['last_row'] = data[-1] if data else None
        out['seq_min'] = data[0][0] if data else None
        out['seq_max'] = data[-1][0] if data else None
        out['chi_null_cells'] = sum(1 for r in data for c in r if c in ('Χ', 'X', 'χ'))
        out['blank_cells'] = sum(1 for r in data for c in r if c == '')
        # 특이사항(마지막 열) 비어있지 않은 값 분포
        notes = sorted({r[-1] for r in data if r[-1]})
        out['note_values'] = notes
        out['rows_with_note'] = {n: sum(1 for r in data if r[-1] == n) for n in notes}
        # Χ 가 있는 행 목록(앞 3개)
        out['rows_with_chi'] = [r for r in data if any(c in ('Χ', 'X', 'χ') for c in r)][:3]
        # 5번째 행 등 스팟
        out['row_5'] = data[4] if len(data) >= 5 else None
    else:
        out['sched_table_index'] = None
        out['columns'] = None
        out['row_count'] = 0

    # 담당자 연락처
    m = re.search(r'콘텐츠 관리 담당\s*:\s*<strong>(.*?)</strong>', s, re.S)
    out['contact_team'] = clean(m.group(1)) if m else None
    m = re.search(r'Tel\s*:\s*<strong>(.*?)</strong>', s, re.S)
    out['contact_tel'] = clean(m.group(1)) if m else None
    m = re.search(r'최근 업데이트\s*:\s*<strong>(.*?)</strong>', s, re.S)
    out['source_updated_at'] = clean(m.group(1)) if m else None

    # 안내사항 '*' 불릿 + 일반 '-' 불릿
    out['star_notices'] = sorted({clean(x) for x in re.findall(r'<span[^>]*>\s*(\*[^<]{2,120})</span>', s, re.S)})
    out['dash_bullets'] = sorted({clean(x) for x in re.findall(r'-\s*([^<]{4,160})<br>', s, re.S)})

    # 학생회관 승차 안내 표
    m = re.search(r'학생회관 승차 가능 시간[^<]*', s)
    out['hall_note'] = clean(m.group(0)) if m else None

    # 시내버스 참고 줄
    out['bus_lines'] = [clean(x) for x in re.findall(r'-\s*([^<]*(?:970|971|700|777|1200|순환)[^<]*)<br>', s)]
    return out

rows = [extract(p) for p in sorted(glob.glob('data/raw/*.html'))]
print(json.dumps(rows, ensure_ascii=False, indent=1))
