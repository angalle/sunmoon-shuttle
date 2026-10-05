/**
 * 스냅샷 파서 진입점 — **T0 골격 단계의 자리표시자**.
 *
 * T2(`t_5ccc5cf5`)가 여기에 `--local` 모드를 구현한다:
 *   npm run scrape -- --local data/raw/*.html   →  data/timetable.json
 *
 * 구현하지 않는 것: **원격 fetch(자동 크롤)**. 원본 `robots.txt` 가 `Disallow: /Page`
 * (= `/Page2/…` 포함)로 차단하므로 코드에 네트워크 경로를 남기지 않는다(docs/01-architecture.md §8).
 *
 * 이 파일은 T2 구현 전에도 **명확한 미구현 오류(exit≠0)** 를 내야 한다(조용한 성공 금지).
 */
function main(argv: readonly string[]): number {
  console.error('[scrape] 미구현: tools/scraper/index.ts 는 T2(t_5ccc5cf5)에서 구현한다.');
  console.error('[scrape] 구현 후 사용법: npm run scrape -- --local data/raw/*.html');
  console.error(`[scrape] 전달된 인자: ${argv.length === 0 ? '(없음)' : argv.join(' ')}`);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
