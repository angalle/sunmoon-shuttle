/**
 * T11 — 개인정보처리방침 페이지·앱 링크 검증 (P3 게이트 미비 보완)
 *
 * 검증하는 것(카드 지시 4번)
 *  ① `public/privacy.html` 실존 + 정적 페이지로서 최소 요건(lang=ko·제목·h1·자체 CSS 링크)
 *  ② 필수 문구 5종 포함 — 수집 없음 · 제3자 없음 · 광고 없음 · 비공식 · 시행일
 *     (+ 로컬 저장(IndexedDB/localStorage) · 문의처 · 외부 링크 정책 안내)
 *  ③ 앱 푸터(`SourceFooter`)에 방침 링크가 있고 `./privacy.html` 로 향한다
 *  ④ 하드코딩 색 0건 — 색 리터럴은 `privacy.css` 의 토큰 정의 블록에만 있고, 그 값은
 *     `tokens.css` 와 **정확히 같다**(색 단일출처)
 *  ⑤ 대비 기준선(본문 4.5:1 · 비텍스트 3:1)을 실제 계산으로 확인 — `scripts/a11y_smoke.mjs`
 *     가 쓰는 임계값과 같은 값인지 함께 고정한다
 *
 * 실패 메시지에 계산값이 그대로 나온다 → `.session-notes/T11-증거.md` 의 근거가 된다.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UI_TEXT } from '../../src/adapters/in/web/features/schedule/types/texts';
import { contrastRatio, formatRatio, parseTokens, readTokensFromDisk } from './tokens';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const PRIVACY_HTML_PATH = join(PUBLIC_DIR, 'privacy.html');
const PRIVACY_CSS_PATH = join(PUBLIC_DIR, 'privacy.css');
const TOKENS_PATH = join(ROOT, 'src/adapters/in/web/shared/ui/styles/tokens.css');
const FOOTER_PATH = join(ROOT, 'src/adapters/in/web/features/schedule/components/organisms/SourceFooter.ts');
const A11Y_SMOKE_PATH = join(ROOT, 'scripts/a11y_smoke.mjs');

const html = readFileSync(PRIVACY_HTML_PATH, 'utf8');
const css = readFileSync(PRIVACY_CSS_PATH, 'utf8');
const footerSource = readFileSync(FOOTER_PATH, 'utf8');
const a11ySmokeSource = readFileSync(A11Y_SMOKE_PATH, 'utf8');

const tokens = readTokensFromDisk(TOKENS_PATH);
const privacyTokens = parseTokens(css);

/** 공식 페이지와 앱 푸터가 함께 쓰는 비공식 고지 핵심 문장(문구 정합의 기준). */
const UNOFFICIAL_CORE = '이 앱은 학교 공식 앱이 아닙니다(비공식). 시간표 저작권은 학교에';

describe('① privacy.html — 실존·정적 페이지 최소 요건', () => {
  it('public/privacy.html 이 존재하고 비어 있지 않다', () => {
    expect(existsSync(PRIVACY_HTML_PATH)).toBe(true);
    expect(html.length).toBeGreaterThan(1000);
  });

  it('독립 정적 HTML 이다(lang=ko · viewport · 제목 · h1 · 자체 CSS 링크)', () => {
    expect(html).toContain('<html lang="ko">');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toMatch(/<link rel="stylesheet" href="\.\/privacy\.css"/);
    expect(html).toMatch(/<title>[^<]*개인정보처리방침[^<]*<\/title>/);
    expect(html).toMatch(/<h1[^>]*>[^<]*개인정보처리방침[^<]*<\/h1>/);
    // 빌드 도구를 거치지 않는 단일 문서 → 외부 스크립트·CDN 의존 0
    expect(html).not.toMatch(/<script\b/);
    expect(html).not.toContain('http://');
  });

  it('앱으로 돌아가는 링크가 있다(하위 경로 배포에서 동작하는 상대경로)', () => {
    expect(html).toMatch(/<a class="privacy-back" href="\.\/">/);
  });

  it('privacy.css 가 실존한다(스타일 분리 — 색 리터럴을 여기에만 둔다)', () => {
    expect(existsSync(PRIVACY_CSS_PATH)).toBe(true);
    expect(css).toContain('.privacy-page');
  });
});

describe('② 필수 문구 — 카드 지시 6항목', () => {
  it('필수 문구 5종이 모두 있다(수집 없음·제3자 없음·광고 없음·비공식·시행일)', () => {
    const required: readonly (readonly [string, string])[] = [
      ['수집 없음', '수집하지 않습니다'],
      ['제3자 제공 없음', '제3자에게 제공하지 않습니다'],
      ['광고 없음', '광고를 게재하지 않으며'],
      ['비공식 고지', '비공식'],
      ['시행일·개정 이력', '시행일'],
    ];
    const missing = required.filter(([, phrase]) => !html.includes(phrase)).map(([label]) => label);
    expect(missing, `누락 문구: ${missing.join(', ')}`).toEqual([]);
  });

  it('수집하지 않는 항목을 구체적으로 밝힌다(계정·위치·기기식별자·광고 ID)', () => {
    for (const phrase of ['계정', '위치 정보(GPS)', '기기 식별자·광고 ID']) {
      expect(html, `누락: ${phrase}`).toContain(phrase);
    }
  });

  it('로컬 저장만 한다는 사실과 저장 항목을 밝힌다(IndexedDB·contentHash·fetchedAt·localStorage)', () => {
    for (const phrase of ['IndexedDB', 'contentHash', 'fetchedAt', 'localStorage', '화면 설정']) {
      expect(html, `누락: ${phrase}`).toContain(phrase);
    }
  });

  it('없어진 설치 안내 플래그 설명이 남아 있지 않다(docs/07 §14 · T31 로 기능 삭제)', () => {
    // “설치 안내를 한 번만 보여주기 위한 localStorage 플래그”는 T31(docs/07 §13-2)로 **사라진 기능**이다.
    // 방침이 없는 기능을 설명하지 않도록 문구를 지웠고, 이 검사가 그 삭제를 고정한다(AC-U14-4).
    for (const phrase of ['설치 안내', '홈 화면에 추가', '플래그(값: yes)']) {
      expect(html, `잔존 문구: ${phrase}`).not.toContain(phrase);
    }
  });

  it('외부 링크 이동 시 해당 사이트 정책이 적용된다는 안내가 있다', () => {
    expect(html).toContain('그 사이트의 개인정보 정책이 적용');
  });

  it('문의처가 있다(원본 안내문의 학생지원팀 041-530-2152 + 앱 문의 경로)', () => {
    expect(html).toContain('학생지원팀');
    expect(html).toContain('041-530-2152');
    expect(html).toContain('0415302152'); // tel: 링크
    expect(html).toContain('https://github.com/angalle/sunmoon-shuttle/issues');
  });

  it('문구가 앱 푸터의 비공식 고지와 모순되지 않는다(핵심 문장 공유)', () => {
    expect(html).toContain(UNOFFICIAL_CORE);
    expect(UI_TEXT.unofficialNotice).toContain(UNOFFICIAL_CORE);
  });
});

describe('③ 앱 푸터 — 개인정보처리방침 링크', () => {
  it('문구가 texts.ts 상수로 있다(하드코딩 문구 0)', () => {
    expect(UI_TEXT.privacyLinkLabel).toBe('개인정보처리방침');
  });

  it('SourceFooter 가 그 문구로 ./privacy.html 을 링크한다', () => {
    expect(footerSource).toContain("href: './privacy.html'");
    expect(footerSource).toContain('text: UI_TEXT.privacyLinkLabel');
    // 내부 링크이므로 새 창·noopener 를 붙이지 않는다.
    expect(footerSource).not.toContain('privacy.html", target');
  });

  it('푸터 링크 대상 파일이 존재하고 상대경로(./)로 적혀 있다(하위 경로 배포 안전)', () => {
    expect(existsSync(join(PUBLIC_DIR, 'privacy.html'))).toBe(true);
    expect(footerSource).toContain("'./privacy.html'");
  });

  it('오프라인에서도 방침이 열리도록 셸 프리캐시 목록에 들어 있다', () => {
    const shell = readFileSync(join(PUBLIC_DIR, 'sw.js'), 'utf8');
    expect(shell).toContain("'./privacy.html'");
    expect(shell).toContain("'./privacy.css'");
  });
});

describe('④ 하드코딩 색 0건 — 색 단일출처(tokens.css)', () => {
  it('privacy.html 에 색 리터럴이 하나도 없다(색은 privacy.css 토큰만)', () => {
    const hits = [...html.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
    expect(hits, `privacy.html 색 하드코딩: ${hits.join(', ')}`).toEqual([]);
    expect(html).not.toContain('!important');
  });

  it('privacy.css 의 색 리터럴이 토큰 정의 블록(:root) 밖에 없다', () => {
    const withoutTokenBlocks = css.replace(/:root\s*\{[^}]*\}/g, '');
    const hits = [...withoutTokenBlocks.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
    expect(hits, `규칙 본문 색 하드코딩: ${hits.join(', ')}`).toEqual([]);
    expect(css).not.toContain('!important');
  });

  it('미러링한 토큰 값이 tokens.css 와 정확히 같다(라이트/다크)', () => {
    const mismatches: string[] = [];
    for (const theme of ['light', 'dark'] as const) {
      for (const [name, value] of Object.entries(privacyTokens[theme])) {
        const source = tokens[theme][name];
        if (source !== value) mismatches.push(`[${theme}] --${name}: privacy=${value} tokens=${String(source)}`);
      }
    }
    expect(mismatches, `토큰 불일치: ${mismatches.join(' | ')}`).toEqual([]);
    // 검사가 실제로 값을 읽었는지(빈 루프 방지)
    expect(Object.keys(privacyTokens.light).length).toBeGreaterThan(10);
    expect(Object.keys(privacyTokens.dark).length).toBeGreaterThan(3);
  });

  it('스타일 규칙은 토큰 변수(var)만 참조한다', () => {
    const rules = css.slice(css.indexOf('*,')); // 토큰 정의 블록 이후 = 규칙 본문
    expect(rules).toContain('var(--color-text)');
    expect(rules).toContain('var(--color-accent)');
    expect(rules).not.toMatch(/:\s*(rgb|rgba|hsl)\(/);
  });
});

describe('⑤ 대비 기준선 — 본문 4.5:1 (a11y 스모크와 같은 임계값)', () => {
  /** [라벨, 전경 토큰, 배경 토큰, 최소 대비] — 본문 4.5 · 비텍스트(포커스 링) 3.0 */
  const PAIRS: readonly (readonly [string, string, string, number])[] = [
    ['본문/배경', 'color-text', 'color-bg', 4.5],
    ['보조글자(푸터)/배경', 'color-text-muted', 'color-bg', 4.5],
    ['링크/배경', 'color-accent', 'color-bg', 4.5],
    ['포커스 링/배경', 'focus-ring-color', 'color-bg', 3.0],
  ];

  for (const theme of ['light', 'dark'] as const) {
    it(`${theme} — ${String(PAIRS.length)}개 조합이 기준 대비를 넘는다`, () => {
      const set = privacyTokens[theme];
      const lines: string[] = [];
      for (const [label, fg, bg, min] of PAIRS) {
        const fgValue = set[fg] ?? '';
        const bgValue = set[bg] ?? '';
        expect(fgValue, `privacy.css 에 --${fg} 없음`).not.toBe('');
        expect(bgValue, `privacy.css 에 --${bg} 없음`).not.toBe('');
        const ratio = contrastRatio(fgValue, bgValue);
        lines.push(`  [${theme}] ${label} ${fgValue} on ${bgValue} = ${formatRatio(ratio)} (≥${min.toFixed(1)})`);
        expect(ratio, `${theme} ${label} = ${formatRatio(ratio)} < ${min.toFixed(1)}`).toBeGreaterThanOrEqual(min);
      }
      console.log(lines.join('\n'));
    });
  }

  it('임계값이 a11y 스모크(scripts/a11y_smoke.mjs)와 같다 — 본문 4.5 · 큰글씨 3', () => {
    expect(a11ySmokeSource).toContain('threshold: large ? 3 : 4.5');
    expect(a11ySmokeSource).toContain('privacy.html');
  });
});

describe('⑥ 스토어 등록 문구(docs/05-store-listing.md) — 길이 제한·필수 항목', () => {
  const storeDoc = readFileSync(join(ROOT, 'docs/05-store-listing.md'), 'utf8');

  /** `<!-- store:이름 -->` ~ `<!-- /store:이름 -->` 사이 본문(붙여넣기 대상). */
  const block = (name: string): string => {
    const match = new RegExp(`<!-- store:${name} -->\\n([\\s\\S]*?)\\n<!-- /store:${name} -->`).exec(storeDoc);
    expect(match, `docs/05 에 store:${name} 블록이 없습니다`).not.toBeNull();
    return (match?.[1] ?? '').trim();
  };

  it('짧은 설명(한/영)이 80자 이하다(Play 제한)', () => {
    for (const lang of ['ko', 'en'] as const) {
      const text = block(`short:${lang}`);
      const length = [...text].length;
      console.log(`  [store short:${lang}] ${String(length)}자 — ${text}`);
      expect(length, `short:${lang} ${String(length)}자`).toBeLessThanOrEqual(80);
      expect(length).toBeGreaterThan(10);
    }
  });

  it('전체 설명(한/영)이 4000자 이하다(Play 제한)', () => {
    for (const lang of ['ko', 'en'] as const) {
      const text = block(`full:${lang}`);
      const length = [...text].length;
      console.log(`  [store full:${lang}] ${String(length)}자`);
      expect(length, `full:${lang} ${String(length)}자`).toBeLessThanOrEqual(4000);
      expect(length).toBeGreaterThan(200);
    }
  });

  it('개인정보처리방침 URL 기입란과 비공식 고지가 있다', () => {
    expect(storeDoc).toContain('https://angalle.github.io/sunmoon-shuttle/privacy.html');
    expect(storeDoc).toContain('이 앱은 학교 공식 앱이 아닙니다(비공식). 시간표 저작권은 학교에 있으며, 원본 페이지를 출처로 표시합니다.');
  });

  it('Data safety 응답 초안이 "수집/공유 없음" 을 담는다', () => {
    expect(storeDoc).toContain('Data safety');
    expect(storeDoc).toContain('수집·공유하는 데이터 유형이 없습니다');
    expect(storeDoc).toContain('HTTPS');
  });

  it('전체 설명(한/영)이 개인정보·비공식 고지를 포함한다(스토어 심사 요건)', () => {
    for (const lang of ['ko', 'en'] as const) {
      const text = block(`full:${lang}`);
      expect(text, `full:${lang}`).toContain('privacy.html');
      expect(text, `full:${lang}`).toContain(lang === 'ko' ? '비공식' : 'unofficial');
    }
  });
});
