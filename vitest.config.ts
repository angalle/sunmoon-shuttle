import { defineConfig } from 'vitest/config';

/**
 * 테스트 설정 (T0 계약)
 * - 테스트는 tests/ 아래에 계층을 미러링해 둔다: tests/domain, tests/application, tests/scraper
 * - domain/application 은 순수 노드 환경(실 DB·실 네트워크 금지), DOM 이 필요한 어댑터만 개별로 환경을 지정한다.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
