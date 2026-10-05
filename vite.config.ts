import { defineConfig } from 'vite';

/**
 * 앱 번들 설정 (docs/01-architecture.md §2)
 * - vanilla TS (프레임워크 없음) · 런타임 의존성 0 → 초기 전송 ≤ 300KB gzip 목표
 * - base './' : GitHub Pages 하위 경로에서도 자산 경로가 깨지지 않게 상대 경로로 출력
 */
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 4096,
    sourcemap: false,
  },
});
