#!/usr/bin/env python3
"""골든 스냅샷을 잘라 '잘린 HTML' 실패 케이스를 만든다(검증용, 커밋 대상 아님)."""
import pathlib

src = pathlib.Path('data/raw/2026-2학기-asan-ktx-평일.html').read_text(encoding='utf-8')
out = pathlib.Path('.session-notes/evidence/tmp/truncated2')
out.mkdir(parents=True, exist_ok=True)
cut = src[: int(len(src) * 0.4)]
(out / '2026-2학기-asan-ktx-평일.html').write_text(cut, encoding='utf-8')
print(f'truncated: {len(src)} -> {len(cut)} bytes')
