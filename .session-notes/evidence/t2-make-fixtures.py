#!/usr/bin/env python3
# T2 검증 보조 — CLI 결정성(바이트 동일) 확인 + 실패 경로 픽스처 생성.
# (원본 data/raw/*.html 은 손대지 않고 .session-notes/evidence/tmp/ 아래에만 만든다)
import glob
import hashlib
import os

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(BASE)
TMP = '.session-notes/evidence/tmp'
for d in ('truncated', 'mutated', 'nobuses'):
    os.makedirs(os.path.join(TMP, d), exist_ok=True)

r1 = open(os.path.join(TMP, 'run1.json'), 'rb').read()
r2 = open(os.path.join(TMP, 'run2.json'), 'rb').read()
print('[결정성] run1 bytes=%d sha=%s' % (len(r1), hashlib.sha256(r1).hexdigest()))
print('[결정성] run2 bytes=%d sha=%s' % (len(r2), hashlib.sha256(r2).hexdigest()))
print('[결정성] 바이트 동일 =', r1 == r2)

src = 'data/raw/2026-2학기-asan-ktx-평일.html'
s = open(src, encoding='utf-8', errors='replace').read()
i = s.index('시간표시작')
open(os.path.join(TMP, 'truncated', '2026-2학기-asan-ktx-평일.html'), 'w', encoding='utf-8').write(s[:i + 1500])
open(os.path.join(TMP, 'mutated', '2026-2학기-asan-ktx-평일.html'), 'w', encoding='utf-8').write(
    s.replace('<th>운행 특이사항</th>', '<th>비고</th>'))
for p in sorted(glob.glob('data/raw/*.html')):
    t = open(p, encoding='utf-8', errors='replace').read().replace('노선별 시내버스 참고', '노선별 시내버스')
    open(os.path.join(TMP, 'nobuses', os.path.basename(p)), 'w', encoding='utf-8').write(t)
print('[픽스처] truncated/mutated/nobuses 준비 완료 (nobuses %d개)' % len(os.listdir(os.path.join(TMP, 'nobuses'))))
