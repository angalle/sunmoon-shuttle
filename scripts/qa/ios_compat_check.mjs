#!/usr/bin/env node
/**
 * iOS Safari 호환 **정적 검사** (T9 · docs/03 AC-7) — 의존성 0 (node 내장 모듈만).
 *
 * 목적: 실기기 없이도 **기계적으로 판정 가능한** iOS/PWA 호환 계약을 검사한다.
 *       실기기에서만 확인 가능한 항목(홈 화면 추가·아이콘 모양 등)은 scripts/qa/iOS-CHECKLIST.md 로 넘긴다.
 *
 * 검사 항목 (카드 지시 ①)
 *   [html.*]     index.html: viewport-fit=cover · apple-touch-icon(파일·크기) · apple-mobile-web-app-*(capable/status-bar/title)
 *                · manifest 링크(파일 존재) · theme-color/color-scheme · 절대경로 링크 0
 *   [manifest.*] public/manifest.webmanifest: JSON 파싱 · 필수 필드 · display · 아이콘 192/512(+maskable) 실파일 크기 일치
 *                · start_url/scope 상대경로(하위 배포 안전)
 *   [css.*]      CSS 기능 사용 목록을 **iOS Safari 기준선**(docs/00 §4 에서 파생)과 대조 — 기준선보다 높은 버전이 필요한 기능은 FAIL
 *                · 100vh 에 dvh 대체 없음(주소창 문제) · safe-area: viewport-fit↔env()↔var() 3자 정합 · -webkit-text-size-adjust
 *   [sw.*]       Service Worker: 등록 대상 파일 존재 · 등록 경로가 **상대경로**(하위 배포) · 기능 감지 가드 · 하위경로 스코프 · 버전 상수
 *   [idb.*]      IndexedDB 가용성 폴백: globalThis 가드 존재 · 비가드 전역 사용 0 (런타임 실측은 scripts/qa/ios_pwa_smoke.mjs)
 *
 * 기준선(baseline)은 손으로 적지 않고 **계약 문서(docs/00-requirements.md "호환")에서 파생**한다.
 * feature 표의 minIOS 출처: MDN "Browser compatibility" / caniuse (Safari 열) — 표에 적어 둔다.
 *
 * 사용:
 *   node scripts/qa/ios_compat_check.mjs
 *   node scripts/qa/ios_compat_check.mjs --root=/tmp/sandbox --json=/tmp/out.json   # 위조 주입 검증용 sandbox
 * 종료코드: 검사 하나라도 실패하면 1.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/+$/, '');

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, '').split('=');
    return [key, rest.join('=')];
  }),
);
const ROOT = args.get('root') === undefined || args.get('root') === '' ? REPO_ROOT : args.get('root');
const JSON_OUT = args.get('json') ?? null;

const results = [];
const info = [];
const started = Date.now();

function check(id, label, ok, detail = '') {
  results.push({ id, label, ok, detail });
}
function note(text) {
  info.push(text);
}

const readText = (relPath) => {
  const file = join(ROOT, relPath);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};
const sha256 = (relPath) => {
  const file = join(ROOT, relPath);
  return existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null;
};

/** PNG IHDR 에서 실제 픽셀 크기를 읽는다(선언값과 대조하기 위해). */
function pngSize(relPath) {
  const file = join(ROOT, relPath);
  if (!existsSync(file)) return null;
  const buf = readFileSync(file);
  if (buf.length < 24 || buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
}

/* ═════════════════════ 0. 기준선 파생 (docs/00-requirements.md) ═════════════════════ */

const POLICY_DOC = 'docs/00-requirements.md';
let baseline = { major: 16, minor: 0, source: '내장 기본값(문서 미발견)' };
{
  const text = readText(POLICY_DOC);
  if (text !== null) {
    const lineIndex = text.split('\n').findIndex((line) => /iOS Safari/.test(line));
    const match = /iOS Safari\s+(\d+)(?:\.(\d+))?\+/.exec(text);
    if (match !== null) {
      baseline = { major: Number(match[1]), minor: Number(match[2] ?? 0), source: `${POLICY_DOC}:${String(lineIndex + 1)}` };
    }
  }
}
const baselineNumber = baseline.major + baseline.minor / 10;
const baselineLabel = `${String(baseline.major)}.${String(baseline.minor)}`;

/* ═════════════════════ 1. index.html ═════════════════════ */

const html = readText('index.html');
const metaContent = (name) => {
  if (html === null) return null;
  const tag = new RegExp(`<meta[^>]*name=["']${name}["'][^>]*>`, 'i').exec(html);
  if (tag === null) return null;
  const value = /content=["']([^"']*)["']/.exec(tag[0]);
  return value === null ? '' : value[1];
};
const linkHref = (relPattern) => {
  if (html === null) return null;
  const tag = new RegExp(`<link[^>]*rel=["']${relPattern}["'][^>]*>`, 'i').exec(html);
  if (tag === null) return null;
  const href = /href=["']([^"']*)["']/.exec(tag[0]);
  return href === null ? '' : href[1];
};
/** ./foo · foo · /foo → repo 루트 기준 상대경로로 정규화(HTML 은 번들 루트 기준 상대경로를 쓴다). */
const toPublicPath = (href) => String(href ?? '').replace(/^\.\//, '').replace(/^\/+/, '');
/** 배포 산출물(dist 루트) 자산 경로 → 소스 트리 경로. public/ 이 dist 루트로 복사되므로 public/ 을 먼저 본다. */
const resolveAsset = (href) => {
  const rel = toPublicPath(href);
  if (rel === '') return null;
  if (existsSync(join(ROOT, 'public', rel))) return join('public', rel);
  if (existsSync(join(ROOT, rel))) return rel;
  return null;
};
const assetExists = (href) => resolveAsset(href) !== null;
const assetPngSize = (href) => {
  const rel = resolveAsset(href);
  return rel === null ? null : pngSize(rel);
};

check('html.exists', 'index.html 존재', html !== null);

const viewport = metaContent('viewport');
check(
  'html.viewport-fit',
  'viewport 에 viewport-fit=cover (노치 영역까지 쓰고 safe-area 로 보정)',
  viewport !== null && /viewport-fit\s*=\s*cover/.test(viewport),
  `viewport="${String(viewport)}"`,
);
check('html.viewport-width', 'viewport 에 width=device-width', viewport !== null && /width\s*=\s*device-width/.test(viewport), `viewport="${String(viewport)}"`);

const appleTouchHref = linkHref('apple-touch-icon');
const appleTouchPng = assetPngSize(appleTouchHref);
check(
  'html.apple-touch-icon',
  'apple-touch-icon 링크 + PNG 실파일 존재',
  appleTouchHref !== null && appleTouchHref !== '' && appleTouchPng !== null,
  `href="${String(appleTouchHref)}" size=${appleTouchPng === null ? '없음/PNG 아님' : `${String(appleTouchPng.width)}x${String(appleTouchPng.height)}`}`,
);
check(
  'html.apple-touch-icon-size',
  'apple-touch-icon 이 정사각 · iOS 권장 180x180 이상',
  appleTouchPng !== null && appleTouchPng.width === appleTouchPng.height && appleTouchPng.width >= 180,
  appleTouchPng === null ? '파일 없음' : `${String(appleTouchPng.width)}x${String(appleTouchPng.height)}`,
);

const capable = metaContent('apple-mobile-web-app-capable');
check('html.apple-capable', 'apple-mobile-web-app-capable=yes (홈 화면 실행 시 전체화면)', capable === 'yes', `content="${String(capable)}"`);
const statusBarStyle = metaContent('apple-mobile-web-app-status-bar-style');
check(
  'html.apple-status-bar',
  'apple-mobile-web-app-status-bar-style 이 유효값',
  statusBarStyle !== null && ['default', 'black', 'black-translucent'].includes(statusBarStyle),
  `content="${String(statusBarStyle)}"`,
);
const appleTitle = metaContent('apple-mobile-web-app-title');
check('html.apple-title', 'apple-mobile-web-app-title 존재(홈 화면 아이콘 이름)', appleTitle !== null && appleTitle.trim() !== '', `content="${String(appleTitle)}"`);
check('html.mobile-web-app-capable', 'mobile-web-app-capable=yes (표준안)', metaContent('mobile-web-app-capable') === 'yes', `content="${String(metaContent('mobile-web-app-capable'))}"`);

const manifestHref = linkHref('manifest');
check(
  'html.manifest-link',
  'manifest 링크 존재 + 대상 파일 존재',
  manifestHref !== null && manifestHref !== '' && assetExists(manifestHref),
  `href="${String(manifestHref)}"`,
);
const linkTargets = [appleTouchHref, manifestHref, linkHref('icon'), linkHref('alternate icon')];
check(
  'html.relative-links',
  '자원 링크가 절대경로(/)가 아님 — 하위 경로 배포 안전',
  linkTargets.every((href) => href === null || href === '' || !String(href).startsWith('/')),
  linkTargets.map((href) => `"${String(href)}"`).join(' '),
);
// 소스 index.html 의 `/src/main.ts` 는 Vite 개발 엔트리다(빌드가 상대경로로 재작성) → 배포 형태인 dist/index.html 을 따로 본다.
check(
  'html.no-absolute-assets',
  'index.html 의 링크가 절대경로(/…)가 아님(개발 엔트리 /src/* 제외)',
  html !== null && !/(?:href|src)=["']\/(?!\/)(?!src\/)[^"']*["']/.test(html),
  html === null ? 'index.html 없음' : '검사 완료',
);
const distHtml = readText('dist/index.html');
if (distHtml === null) note('dist/index.html 없음 — 배포 산출물 절대경로 검사는 npm run build 후 실행해야 한다.');
else {
  const absolute = [...distHtml.matchAll(/(?:href|src)=["'](\/[^"']*)["']/g)].map((m) => m[1]);
  check('dist.no-absolute-assets', '배포 산출물(dist/index.html)에 절대경로 자산 0건', absolute.length === 0, absolute.join(', '));
}
check('html.theme-color-meta', 'theme-color 메타 존재(값은 shared/lib/theme.ts 가 토큰에서 채운다)', metaContent('theme-color') !== null, `content="${String(metaContent('theme-color'))}"`);
check(
  'html.color-scheme',
  'color-scheme 메타(라이트/다크)',
  metaContent('color-scheme') !== null && /light/.test(String(metaContent('color-scheme'))),
  `content="${String(metaContent('color-scheme'))}"`,
);

/* ═════════════════════ 2. manifest.webmanifest ═════════════════════ */

const manifestText = readText('public/manifest.webmanifest');
let manifest = null;
let manifestError = null;
if (manifestText === null) manifestError = '파일 없음';
else {
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    manifestError = error instanceof Error ? error.message : String(error);
  }
}
check('manifest.parse', 'manifest JSON 파싱 성공', manifest !== null, manifestError ?? '');

if (manifest !== null) {
  const required = ['name', 'short_name', 'start_url', 'display', 'icons', 'theme_color', 'background_color', 'lang'];
  const missing = required.filter((key) => manifest[key] === undefined || manifest[key] === null || manifest[key] === '');
  check('manifest.required-fields', `필수 필드 ${String(required.length)}개 존재`, missing.length === 0, missing.length === 0 ? '' : `누락: ${missing.join(', ')}`);
  check('manifest.display', 'display=standalone|fullscreen (홈 화면 전체화면)', ['standalone', 'fullscreen'].includes(manifest.display), `display="${String(manifest.display)}"`);
  check(
    'manifest.short-name',
    'short_name 길이 ≤ 12 (홈 화면 라벨 잘림 방지)',
    typeof manifest.short_name === 'string' && manifest.short_name.length > 0 && manifest.short_name.length <= 12,
    `short_name="${String(manifest.short_name)}" (${String(String(manifest.short_name ?? '').length)}자)`,
  );
  check('manifest.lang', 'lang=ko', typeof manifest.lang === 'string' && manifest.lang.toLowerCase().startsWith('ko'), `lang="${String(manifest.lang)}"`);
  const relativeFields = ['start_url', 'scope', 'id'].filter((key) => typeof manifest[key] === 'string');
  const absoluteFields = relativeFields.filter((key) => String(manifest[key]).startsWith('/'));
  check(
    'manifest.relative-start',
    'start_url/scope/id 가 상대경로(하위 배포 안전)',
    absoluteFields.length === 0,
    absoluteFields.length === 0 ? `검사: ${relativeFields.join(', ')}` : `절대경로: ${absoluteFields.join(', ')}`,
  );
  check(
    'manifest.colors',
    'theme_color/background_color 가 #rrggbb 형식',
    /^#[0-9a-f]{6}$/i.test(String(manifest.theme_color)) && /^#[0-9a-f]{6}$/i.test(String(manifest.background_color)),
    `theme=${String(manifest.theme_color)} bg=${String(manifest.background_color)}`,
  );

  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  const sizes = icons.map((icon) => String(icon?.sizes ?? ''));
  const purposes = new Set(icons.flatMap((icon) => String(icon?.purpose ?? 'any').split(/\s+/)));
  check('manifest.icon-192', '아이콘 192x192 선언', sizes.some((size) => size.includes('192x192')), `sizes=[${sizes.join(', ')}]`);
  check('manifest.icon-512', '아이콘 512x512 선언', sizes.some((size) => size.includes('512x512')), `sizes=[${sizes.join(', ')}]`);
  check('manifest.icon-maskable', 'maskable 아이콘 선언(Android 적응형)', purposes.has('maskable'), `purpose=[${[...purposes].join(', ')}]`);

  const iconProblems = [];
  for (const icon of icons) {
    const src = typeof icon?.src === 'string' ? icon.src : null;
    if (src === null) {
      iconProblems.push('src 없음');
      continue;
    }
    const png = assetPngSize(src);
    if (png === null) {
      iconProblems.push(`${src}: 파일 없음/PNG 아님`);
      continue;
    }
    const declared = /^(\d+)x(\d+)$/.exec(String(icon.sizes ?? ''));
    if (declared === null) {
      iconProblems.push(`${src}: sizes 형식 오류("${String(icon.sizes)}")`);
      continue;
    }
    if (Number(declared[1]) !== png.width || Number(declared[2]) !== png.height) {
      iconProblems.push(`${src}: 선언 ${declared[1]}x${declared[2]} ≠ 실파일 ${String(png.width)}x${String(png.height)}`);
    }
  }
  check(
    'manifest.icons-real',
    `아이콘 ${String(icons.length)}개 실파일 존재 + 선언 크기 = 실제 IHDR 크기`,
    icons.length > 0 && iconProblems.length === 0,
    iconProblems.length === 0 ? '' : iconProblems.join(' | '),
  );
  note(`manifest: name="${String(manifest.name)}" display="${String(manifest.display)}" icons=${String(icons.length)}개 theme=${String(manifest.theme_color)} bg=${String(manifest.background_color)}`);
}

/* ═════════════════════ 3. CSS — iOS Safari 기능 기준선 대조 ═════════════════════ */

/**
 * CSS 기능 표 (regex → 최소 iOS Safari 버전).
 * minIOS 는 **MDN BCD / caniuse Safari 열** 기준(2026-10 확인). 기준선보다 높으면 그 iOS 버전에서는 무효다.
 */
const CSS_FEATURES = [
  { id: 'nesting', label: 'CSS 중첩(&)', re: /^[ \t]*&[\s:{.[#>]/m, minIOS: 16.5 },
  { id: 'has', label: ':has()', re: /:has\(/, minIOS: 15.4 },
  { id: 'is-where', label: ':is()/:where()', re: /:(?:is|where)\(/, minIOS: 14.0 },
  { id: 'focus-visible', label: ':focus-visible', re: /:focus-visible/, minIOS: 15.4 },
  { id: 'container-query', label: '@container', re: /@container/, minIOS: 16.0 },
  { id: 'layer', label: '@layer', re: /@layer/, minIOS: 15.4 },
  { id: 'color-mix', label: 'color-mix()', re: /color-mix\(/, minIOS: 16.2 },
  { id: 'oklch', label: 'oklch()/oklab()/lab()/lch()', re: /(?:oklch|oklab|\blab|\blch)\(/, minIOS: 15.4 },
  { id: 'text-wrap', label: 'text-wrap: balance|pretty', re: /text-wrap:\s*(?:balance|pretty)/, minIOS: 17.5 },
  { id: 'subgrid', label: 'grid subgrid', re: /subgrid/, minIOS: 16.0 },
  { id: 'starting-style', label: '@starting-style', re: /@starting-style/, minIOS: 17.5 },
  { id: 'light-dark', label: 'light-dark()', re: /light-dark\(/, minIOS: 17.5 },
  { id: 'scope', label: '@scope', re: /@scope/, minIOS: 17.4 },
  { id: 'field-sizing', label: 'field-sizing', re: /field-sizing/, minIOS: 17.4 },
  { id: 'animation-timeline', label: 'scroll/animation-timeline', re: /animation-timeline|scroll-timeline/, minIOS: 26.0 },
  { id: 'view-transition', label: 'view transitions', re: /view-transition-name|@view-transition/, minIOS: 18.0 },
  { id: 'user-valid', label: ':user-valid()/:user-invalid()', re: /:user-(?:valid|invalid)/, minIOS: 16.5 },
  { id: 'anchor-position', label: 'anchor positioning', re: /position-anchor|anchor\(/, minIOS: 26.0 },
  { id: 'property-atrule', label: '@property', re: /@property\s/, minIOS: 16.4 },
  { id: 'backdrop-filter', label: 'backdrop-filter(비접두)', re: /(?<!-webkit-)backdrop-filter\s*:/, minIOS: 18.0 },
  { id: 'inset', label: 'inset 단축', re: /(?:^|[;{\s])inset\s*:/m, minIOS: 14.5 },
  { id: 'dvh', label: 'dvh/svh/lvh 단위', re: /\d(?:dvh|svh|lvh)/, minIOS: 15.4 },
  { id: 'env', label: 'env(safe-area-inset-*)', re: /env\(\s*safe-area-inset/, minIOS: 11.1 },
  { id: 'aspect-ratio', label: 'aspect-ratio', re: /aspect-ratio\s*:/, minIOS: 15.0 },
];

function listCssFiles(dir, acc = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return acc;
  for (const entry of readdirSync(abs)) {
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) listCssFiles(rel, acc);
    else if (entry.endsWith('.css')) acc.push(rel);
  }
  return acc;
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const cssFiles = [...listCssFiles('src'), ...listCssFiles('dist/assets').filter((file) => file.endsWith('.css'))];
check('css.files', 'CSS 파일 발견(src·dist)', cssFiles.length > 0, cssFiles.join(', '));

const cssByFile = new Map();
for (const file of cssFiles) cssByFile.set(file, stripComments(readText(file) ?? ''));

const usedFeatures = [];
const overBaseline = [];
for (const feature of CSS_FEATURES) {
  const hits = cssFiles.filter((file) => feature.re.test(cssByFile.get(file) ?? ''));
  if (hits.length === 0) continue;
  usedFeatures.push({ ...feature, files: hits });
  if (feature.minIOS > baselineNumber) overBaseline.push({ ...feature, files: hits });
}
check(
  'css.ios-feature-baseline',
  `쓰인 CSS 기능 전부 iOS Safari ${baselineLabel}+ 에서 지원(기준선 출처: ${baseline.source})`,
  overBaseline.length === 0,
  overBaseline.length === 0
    ? `사용 기능: ${usedFeatures.map((f) => `${f.label}(iOS ${String(f.minIOS)}+)`).join(', ') || '없음'}`
    : overBaseline.map((f) => `${f.label} → iOS ${String(f.minIOS)}+ 필요`).join(' | '),
);

// 100vh 문제: 높이 계열에 vh 를 쓰면서 같은 선언 블록에 dvh 대체가 없으면 iOS 주소창 변동에서 잘린다.
const vhProblems = [];
for (const [file, css] of cssByFile) {
  const bodyRe = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = bodyRe.exec(css)) !== null) {
    const body = match[2];
    if (body === undefined) continue;
    const declarations = [...body.matchAll(/([a-z-]+)\s*:\s*([^;]+);?/gi)].map((m) => ({ prop: (m[1] ?? '').trim(), value: (m[2] ?? '').trim() }));
    for (const declaration of declarations) {
      if (!/^(min-|max-)?height$/i.test(declaration.prop)) continue;
      if (!/\b\d+(?:\.\d+)?vh\b/.test(declaration.value)) continue;
      const hasDvhFallback = declarations.some((other) => other.prop === declaration.prop && /\b\d+(?:\.\d+)?(?:dvh|svh|lvh)\b/.test(other.value));
      if (!hasDvhFallback) vhProblems.push(`${file} → ${declaration.prop}: ${declaration.value} (dvh 대체 없음)`);
    }
  }
}
check('css.viewport-unit', '멀티뷰포트 높이(vh)에 dvh 대체가 같은 블록에 있다', vhProblems.length === 0, vhProblems.join(' | '));

const usesSafeAreaEnv = /env\(\s*safe-area-inset/.test([...cssByFile.values()].join('\n'));
const usesSafeAreaVar = /var\(\s*--safe-area-(?:top|right|bottom|left)/.test([...cssByFile.values()].join('\n'));
const viewportFitCover = viewport !== null && /viewport-fit\s*=\s*cover/.test(viewport);
check(
  'css.safe-area-wiring',
  'safe-area 3자 정합: viewport-fit=cover ↔ env(safe-area-inset-*) ↔ 레이아웃의 var(--safe-area-*)',
  viewportFitCover && usesSafeAreaEnv && usesSafeAreaVar,
  `viewport-fit=${String(viewportFitCover)} env()=${String(usesSafeAreaEnv)} var()=${String(usesSafeAreaVar)}`,
);
check(
  'css.text-size-adjust',
  '-webkit-text-size-adjust: 100% (iOS 가로모드 글자 자동 확대 방지)',
  cssFiles.some((file) => /-webkit-text-size-adjust\s*:\s*100%/.test(cssByFile.get(file) ?? '')),
  '',
);

/* ═════════════════════ 4. Service Worker ═════════════════════ */

const swFile = readText('public/sw.js');
check('sw.file', 'public/sw.js 존재(등록 대상)', swFile !== null);
if (swFile !== null) {
  check('sw.version', 'SW_VERSION 상수(캐시 무효화 정본)', /SW_VERSION\s*=\s*['"][^'"]+['"]/.test(swFile), '');
  check('sw.scope-relative', 'self.registration.scope 기준 상대경로 사용(하위 배포)', /self\.registration\.scope/.test(swFile), '');
  const shellBlock = /SHELL_ASSETS\s*=\s*\[([\s\S]*?)\]/.exec(swFile);
  const shellEntries = shellBlock === null ? [] : [...(shellBlock[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const badShell = shellEntries.filter((entry) => !String(entry).startsWith('./'));
  check('sw.shell-relative', '프리캐시 자산 경로가 전부 상대경로(./…)', shellEntries.length > 0 && badShell.length === 0, badShell.length === 0 ? `${String(shellEntries.length)}개: ${shellEntries.join(', ')}` : `절대/비상대: ${badShell.join(', ')}`);
  check('sw.skip-waiting', 'skipWaiting + clients.claim (배포 직후 이전 버전 방지)', /skipWaiting/.test(swFile) && /clients\.claim/.test(swFile), '');
  check('sw.no-crossorigin', '교차 출처 요청을 다루지 않는다(자동 크롤 금지 계약)', !/https?:\/\/(?!127\.0\.0\.1|localhost|lily\.sunmoon)[a-z0-9.-]+/i.test(stripComments(swFile).replace(/self\.registration\.scope/g, '')), '');
}

const swSource = readText('src/adapters/in/web/app/serviceWorker.ts');
check('sw.source-file', 'SW 등록 모듈 존재(app/serviceWorker.ts)', swSource !== null);
if (swSource !== null) {
  const registerArg = /\.register\(\s*([^)]*)\)/.exec(swSource);
  const argText = (registerArg?.[1] ?? '').trim();
  const literal = /^(['"])([^'"]+)\1/.exec(argText);
  let scriptPath = literal?.[2] ?? null;
  let pathOrigin = '리터럴 인자';
  if (scriptPath === null && registerArg !== null) {
    // `const path = options.x ?? './sw.js'` 처럼 기본값을 식별자로 받는 경우, 그 기본값 리터럴을 따라간다.
    const fallback = new RegExp(`${argText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=[^;]*?\\?\\?\\s*(['"])([^'"]+)\\1`).exec(swSource);
    if (fallback !== null) {
      scriptPath = fallback[2] ?? null;
      pathOrigin = `${argText} 기본값`;
    }
  }
  check(
    'sw.register-relative',
    "SW 등록 호출(.register)이 있고 경로가 상대경로('./sw.js') — Pages 하위 경로에서 scope 가 그 하위로 잡힌다",
    registerArg !== null && scriptPath !== null && scriptPath.startsWith('./'),
    registerArg === null
      ? 'navigator.serviceWorker.register(...) 호출을 찾지 못했습니다(등록 경로 없음)'
      : `register(${argText}) → ${scriptPath === null ? '경로를 정적으로 확정 못 함' : `"${scriptPath}" (${pathOrigin})`}`,
  );
  check('sw.feature-detection', "'serviceWorker' in navigator 기능 감지 가드", /['"]serviceWorker['"]\s+in\s+navigator/.test(swSource), '');
  check('sw.warn-not-error', 'SW 실패를 console.warn 으로 남긴다(AC-5 콘솔 오류 0)', /console\.(warn|error)/.test(swSource) && !/console\.error/.test(swSource), '');
}

/* ═════════════════════ 5. IndexedDB 가용성 폴백 (정적) ═════════════════════ */

const idbFile = readText('src/adapters/out/storage/indexedDbTimetableCache.ts');
check('idb.file', 'IndexedDB 캐시 어댑터 존재', idbFile !== null);
if (idbFile !== null) {
  const guarded = /globalThis\s+as\s+\{[^}]*indexedDB/.test(idbFile) || /typeof\s+globalThis[^;]*indexedDB/.test(idbFile);
  const unguarded = [...idbFile.matchAll(/(?<![.\w$])indexedDB\s*\./g)].length;
  check('idb.availability-guard', 'indexedDB 가용성 가드(globalThis 경유) 존재 — 없으면 no-op', guarded, guarded ? '' : 'globalThis 가드 미발견');
  check(
    'idb.no-unguarded-global',
    '비가드 전역 indexedDB.<method> 직접 사용 0건(구형/프라이빗에서 예외 금지)',
    unguarded === 0,
    `비가드 사용 ${String(unguarded)}건`,
  );
  note('IndexedDB 실제 폴백 동작(런타임)은 scripts/qa/ios_pwa_smoke.mjs 의 "IndexedDB 없음" 단계가 실측한다.');
}

/* ═════════════════════ 출력 ═════════════════════ */

const elapsedMs = Date.now() - started;
const failed = results.filter((result) => !result.ok);
const passed = results.length - failed.length;

console.log(`\niOS 호환 정적 검사 — root=${ROOT}`);
console.log(`기준선: iOS Safari ${baselineLabel}+ (출처: ${baseline.source})`);
console.log('');
for (const result of results) {
  const head = `  ${result.ok ? 'PASS' : 'FAIL'}  [${result.id}] ${result.label}`;
  console.log(result.detail === '' ? head : `${head}\n         → ${result.detail}`);
}
if (info.length > 0) {
  console.log('\n참고:');
  for (const line of info) console.log(`  INFO  ${line}`);
}
console.log(`\n검사 ${String(results.length)}건 · PASS ${String(passed)} · FAIL ${String(failed.length)} · 소요 ${(elapsedMs / 1000).toFixed(2)}s`);

if (JSON_OUT !== null) {
  writeFileSync(
    JSON_OUT,
    `${JSON.stringify(
      {
        root: ROOT,
        baseline: { label: baselineLabel, source: baseline.source },
        results,
        info,
        passed,
        failed: failed.length,
        elapsedMs,
        hashes: {
          'index.html': sha256('index.html'),
          'public/manifest.webmanifest': sha256('public/manifest.webmanifest'),
          'public/sw.js': sha256('public/sw.js'),
          'src/adapters/in/web/app/serviceWorker.ts': sha256('src/adapters/in/web/app/serviceWorker.ts'),
        },
      },
      null,
      2,
    )}\n`,
  );
  console.log(`JSON: ${JSON_OUT}`);
}

if (failed.length > 0) {
  console.log('\n실패:');
  for (const result of failed) console.log(`  FAIL  [${result.id}] ${result.label} — ${result.detail}`);
  process.exitCode = 1;
} else {
  console.log('\nIOS COMPAT CHECK: PASS');
}
