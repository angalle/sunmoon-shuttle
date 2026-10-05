/**
 * 테마 유틸 (shared/lib) — CSS 토큰(tokens.css)을 **읽어서** 브라우저 UI 에 반영한다.
 *
 * 왜: `index.html` 의 `<meta name="theme-color">` 는 색을 하드코딩할 수밖에 없는 자리다.
 *     그 값을 코드/토큰 이중으로 관리하지 않으려고 **토큰에서 읽어** 채운다(하드코딩 금지 규율).
 *     라이트/다크 전환(`prefers-color-scheme`)도 브라우저 UI 색에 반영한다.
 *
 * shared 계층 규칙: features/·store·api 를 알지 않는다(순수 DOM/CSS API 만 사용).
 */

/** 루트(:root)에서 CSS 변수 값을 읽는다(없으면 빈 문자열). */
export function readCssToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * `<meta name="theme-color">` 를 현재 테마의 `--color-bg` 로 맞추고,
 * 시스템 테마가 바뀔 때마다 다시 맞춘다. 반환값 = 즉시 재적용 함수.
 */
export function initThemeColor(): () => void {
  const apply = (): void => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta === null) return;
    const background = readCssToken('--color-bg');
    if (background === '') return; // 토큰을 못 읽으면 지금 값을 그대로 둔다(빈 값으로 덮지 않는다).
    meta.setAttribute('content', background);
  };

  apply();
  // 스타일시트가 늦게 적용되는 환경(개발 서버 HMR 등) 대비 — 로드 후 한 번 더.
  window.addEventListener('load', apply, { once: true });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
  return apply;
}
