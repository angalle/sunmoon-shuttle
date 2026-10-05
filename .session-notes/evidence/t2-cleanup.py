#!/usr/bin/env python3
"""T2 정리 — 이번 태스크에서 만든 임시물만 제거한다(원본 스냅샷·증거 스크립트는 보존).

제거 대상(재생성 가능):
  - .session-notes/evidence/tmp/            (결정성·실패경로 실행 산출물; t2-run.sh / t2-fail*.sh 로 재생성)
  - .session-notes/evidence/_t2-debug.ts    (디버그 출력용 임시 스크립트)
  - .session-notes/evidence/_t2-diff.ts     (결정성 확인용 임시 스크립트 — t2-run.sh + t2-stats.mjs 로 대체)

보존 대상: t2-logical-rows.py · t2-independent-extract.py (골든 기대값 출처) ·
          t2-make-fixtures.py · t2-run.sh · t2-fail.sh · t2-fail2.sh · t2-stats.mjs · t2-truncate.py
"""
import os
import shutil

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EVID = os.path.join(BASE, '.session-notes', 'evidence')

targets = [
    os.path.join(EVID, 'tmp'),
    os.path.join(EVID, '_t2-debug.ts'),
    os.path.join(EVID, '_t2-diff.ts'),
]

for path in targets:
    if os.path.isdir(path):
        shutil.rmtree(path)
        print('rmtree', os.path.relpath(path, BASE))
    elif os.path.exists(path):
        os.remove(path)
        print('rm    ', os.path.relpath(path, BASE))
    else:
        print('skip  ', os.path.relpath(path, BASE), '(없음)')

print('남은 evidence 항목:')
for name in sorted(os.listdir(EVID)):
    print('  -', name)
