/**
 * T34 ① **AI 표 추출기 단위** — 표 영역(원문 토큰) · 프롬프트(시간표 전용) · 응답 파싱 · 검증 4종 · 일치 카운트.
 *
 * 실 네트워크 0 · 실 API 키 0 — 어댑터/검증기 순수 계약만 본다(모의 서버 통합은 `ai-table-acceptance.test.ts`).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildTablePrompt,
  parseTableDraft,
  tableKeySet,
  tableKeyVocabulary,
  tablePromptTemplate,
  tablePromptTemplateSha256,
} from '../../tools/extract/aiTable.js';
import { countAgreementRows } from '../../tools/extract/aiTableRun.js';
import { validateTableDraft } from '../../tools/extract/aiTableValidate.js';
import { extractTimeTokens, findScheduleTable, type TableRegion } from '../../tools/extract/tableRegion.js';
import { pageText as pageTextOf } from '../../tools/extract/text.js';
import type { AiTablePageDraft } from '../../tools/extract/types.js';
import { findRoute, parseSnapshotFileName } from '../../tools/scraper/routeMeta.js';

const RAW_DIR = join(process.cwd(), 'data', 'raw');

function rawFiles(): string[] {
  return readdirSync(RAW_DIR)
    .filter((file) => file.endsWith('.html'))
    .sort();
}

/** 합성 표 영역 — 검증 4종을 손으로 통제하기 위한 최소 표 */
const SYNTH_HTML = [
  '<table>',
  '<tr><td>순</td><td>아산캠퍼스 출발</td><td>천안아산역 출발</td><td>운행 특이사항</td></tr>',
  '<tr><td>1</td><td>8:05</td><td>8:25</td><td>0:15</td></tr>',
  '<tr><td>2</td><td>Χ</td><td>8:35</td><td></td></tr>',
  '</table>',
].join('');

function synthRegion(): TableRegion {
  const region = findScheduleTable(SYNTH_HTML);
  if (region === null) throw new Error('합성 표를 찾지 못했다');
  return region;
}

function synthDraft(override: Partial<AiTablePageDraft> = {}): AiTablePageDraft {
  return {
    page: 'synth.html',
    columns: [
      { header: '순', key: 'seq' },
      { header: '아산캠퍼스 출발', key: 'depCampus' },
      { header: '천안아산역 출발', key: 'depStation' },
      { header: '운행 특이사항', key: 'note' },
    ],
    rows: [
      { seq: 1, values: { depCampus: '8:05', depStation: '8:25', note: '0:15' } },
      { seq: 2, values: { depCampus: null, depStation: '8:35', note: null } },
    ],
    ...override,
  };
}

const SYNTH_PAGE_TEXT = '순 아산캠퍼스 출발 천안아산역 출발 운행 특이사항 1 8:05 8:25 0:15 2 Χ 8:35';

function validate(draft: AiTablePageDraft) {
  return validateTableDraft(draft, { region: synthRegion(), pageText: SYNTH_PAGE_TEXT });
}

// ─────────────────────────── 표 영역(원문 토큰) ───────────────────────────

describe('T34 표 영역 — 원문 셀 토큰을 그대로 쓴다', () => {
  it('표가 있는 페이지는 헤더·행을 계약(routeMeta)과 같은 열 수로 뽑는다', () => {
    const files = rawFiles();
    let withTable = 0;
    for (const file of files) {
      const region = findScheduleTable(readFileSync(join(RAW_DIR, file), 'utf8'));
      const ref = parseSnapshotFileName(file);
      if (region === null) {
        // 운행 중단 노선(천안캠퍼스)만 표가 없다
        expect(file).toContain('cheonan-campus');
        continue;
      }
      withTable += 1;
      const day = findRoute(ref.routeId).days.find((entry) => entry.dayType === ref.dayType);
      expect(region.header).toEqual(day?.columns.map((column) => column.label));
      expect(region.rowCount).toBeGreaterThan(0);
      expect(region.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(region.text.split('\n')).toHaveLength(region.rowCount + 1);
    }
    expect(withTable).toBe(10);
  });

  it('원문 토큰을 보존한다 — `8:05`(정규화 금지)·`Χ`·`0:15`', () => {
    const region = findScheduleTable(readFileSync(join(RAW_DIR, '2026-2학기-asan-ktx-평일.html'), 'utf8'));
    expect(region?.text.split('\n')[1]).toContain('8:05');
    expect(region?.text).toContain('0:15');
    expect(region?.text).toContain('Χ');
    expect(region?.text).not.toContain('08:05');
  });

  it('시각 집합은 **표 영역** 기준이다 — 안내문 시각(19:30)은 섞이지 않는다', () => {
    const html = readFileSync(join(RAW_DIR, '2026-2학기-asan-ktx-평일.html'), 'utf8');
    const region = findScheduleTable(html);
    const tokens = extractTimeTokens(region?.text ?? '');
    const pageTokens = extractTimeTokens(pageTextOf(html));
    expect(pageTokens.has('19:30')).toBe(true); // 안내문(학생회관 승차 가능 시간)에만 있다
    expect(tokens.has('19:30')).toBe(false);
    expect(tokens.has('08:05')).toBe(true);
    expect(tokens.size).toBe(97);
    expect(pageTokens.size).toBe(98);
  });

  it('표가 0개/2개 이상이면 null(추측하지 않는다)', () => {
    expect(findScheduleTable('<table></table>')).toBeNull();
    const two = `${SYNTH_HTML}${SYNTH_HTML}`;
    expect(findScheduleTable(two)).toBeNull();
  });
});

// ─────────────────────────── 프롬프트(시간표 전용) ───────────────────────────

describe('T34 프롬프트 — 시간표 전용(일반 추출기 아님)', () => {
  it('원문 그대로 복사·`8:05` 예시·JSON 강제·행 수 검증 예고가 들어간다', () => {
    const template = tablePromptTemplate();
    expect(template).toContain('시간표 전용 페이지');
    expect(template).toContain('원문 글자 그대로');
    expect(template).toContain('08:05` 로 고치지 말고 `8:05`');
    expect(template).toContain('즉시 검증 실패');
    expect(template).toContain('행 수와 시각 집합이 원문과 대조된다');
    expect(template).toContain('출력은 JSON 하나만');
    expect(template).toContain('{{TABLE}}');
  });

  it('의미 키 사전은 계약(routeMeta)에서 파생된다 — 15개 키·라벨 예시 포함', () => {
    const vocabulary = tableKeyVocabulary();
    expect(vocabulary.length).toBe(15);
    const dep = vocabulary.find((entry) => entry.key === 'depStation');
    expect(dep?.labels).toContain('천안아산역 출발');
    expect(dep?.labels).toContain('천안아산역');
    expect(tableKeySet().has('note')).toBe(true);
    expect(tableKeySet().has('col1')).toBe(false);
    for (const entry of vocabulary) expect(tablePromptTemplate()).toContain(`${entry.key} :`);
  });

  it('프롬프트 해시는 sha256 이고 같은 템플릿이면 안정적이다', () => {
    expect(tablePromptTemplateSha256()).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(tablePromptTemplateSha256()).toBe(tablePromptTemplateSha256());
    // 문장 분류 프롬프트와 **다른** 템플릿이다(전용 추출기)
    expect(tablePromptTemplateSha256()).not.toContain('rules');
  });

  it('buildTablePrompt 는 파일·노선·요일 문맥과 표 영역을 넣는다', () => {
    const region = synthRegion();
    const prompt = buildTablePrompt({ page: 'data/raw/x.html', routeId: 'asan-ktx', dayType: 'weekday', regionText: region.text, pageText: SYNTH_PAGE_TEXT });
    expect(prompt).toContain('(파일: data/raw/x.html · 노선: asan-ktx · 요일: weekday)');
    expect(prompt).toContain(region.text.split('\n')[1] ?? '');
    expect(prompt.endsWith(region.text)).toBe(true);
  });
});

// ─────────────────────────── 응답 파싱 ───────────────────────────

describe('T34 응답 파싱 — 형식 위반은 폐기(조용한 통과 금지)', () => {
  it('정상 JSON·코드펜스·배열 밖 설명을 관용적으로 받는다', () => {
    const draft = synthDraft();
    expect(parseTableDraft(JSON.stringify(draft), 'p')?.rows).toHaveLength(2);
    expect(parseTableDraft(`\`\`\`json\n${JSON.stringify(draft)}\n\`\`\``, 'p')?.columns).toHaveLength(4);
    expect(parseTableDraft(`설명입니다\n${JSON.stringify(draft)}`, 'p')?.rows).toHaveLength(2);
  });

  it('columns/rows 가 없거나 값 타입이 이상하면 null(초안 폐기)', () => {
    expect(parseTableDraft('설명만 있고 JSON 이 없다', 'p')).toBeNull();
    expect(parseTableDraft('{"columns":[]}', 'p')).toBeNull();
    expect(parseTableDraft('{"columns":[{"header":"순","key":"seq"}],"rows":[]}', 'p')).toBeNull();
    expect(parseTableDraft('{"columns":[{"header":"순"}],"rows":[{"seq":1,"values":{}}]}', 'p')).toBeNull();
    expect(parseTableDraft('{"columns":[{"header":"순","key":"seq"}],"rows":[{"seq":1,"values":{"depCampus":{"a":1}}}]}', 'p')).toBeNull();
  });

  it('숫자 셀·문자열 seq 를 관용적으로 정규화한다', () => {
    const parsed = parseTableDraft('{"columns":[{"header":"순","key":"seq"},{"header":"터미널","key":"depTerminal"}],"rows":[{"seq":"7","values":{"depTerminal":830}}]}', 'p');
    expect(parsed?.rows[0]?.seq).toBe(7);
    expect(parsed?.rows[0]?.values['depTerminal']).toBe('830');
  });
});

// ─────────────────────────── 검증 4종 ───────────────────────────

describe('T34 검증 4종 — 정상 통과', () => {
  it('정답 초안은 4종을 모두 통과한다(수치: 시각 4개·행 2개)', () => {
    const validation = validate(synthDraft());
    expect(validation.ok).toBe(true);
    expect(validation.fatal).toBe(false);
    expect(validation.checks.map((entry) => entry.id)).toEqual(['cell-anchor', 'time-set', 'row-count', 'schema']);
    expect(validation.checks.every((entry) => entry.ok)).toBe(true);
    const timeSet = validation.checks.find((entry) => entry.id === 'time-set');
    expect(timeSet?.detail).toContain('원문 시각 4개 == 추출 시각 4개');
    const rowCount = validation.checks.find((entry) => entry.id === 'row-count');
    expect(rowCount?.detail).toContain('추출 행 2개 == 원문 행 2개');
  });
});

describe('T34 검증 ① 셀 앵커 — 원문에 없는 값은 환각(fatal)', () => {
  it('원문에 없는 셀 값을 만들면 fatal 이다', () => {
    const draft = synthDraft();
    const broken: AiTablePageDraft = {
      ...draft,
      rows: [{ seq: 1, values: { depCampus: '23:59', depStation: '8:25', note: '0:15' } }, ...draft.rows.slice(1)],
    };
    const validation = validate(broken);
    expect(validation.ok).toBe(false);
    expect(validation.fatal).toBe(true);
    const anchor = validation.checks.find((entry) => entry.id === 'cell-anchor');
    expect(anchor?.severity).toBe('fatal');
    expect(anchor?.detail).toContain('depCampus="23:59"');
  });

  it('원문에 없는 머리글도 fatal 이다', () => {
    const validation = validate(synthDraft({ columns: [{ header: '없는 열', key: 'note' }] }));
    expect(validation.fatal).toBe(true);
  });
});

describe('T34 검증 ② 시각 집합 — 초과는 fatal · 누락은 폐기', () => {
  it('표에 없는 시각을 추가하면 fatal(발행 중단 경로)', () => {
    const validation = validate(synthDraft({
      rows: [{ seq: 1, values: { depCampus: '8:05', depStation: '8:25', note: '23:59' } }, { seq: 2, values: { depCampus: null, depStation: '8:35', note: null } }],
    }));
    const timeSet = validation.checks.find((entry) => entry.id === 'time-set');
    expect(timeSet?.ok).toBe(false);
    expect(timeSet?.severity).toBe('fatal');
    expect(timeSet?.detail).toContain('표에 없는 시각 1건');
    expect(validation.fatal).toBe(true);
  });

  it('표의 시각을 빠뜨리면 폐기(drop) — 발행은 규칙 정본으로 계속', () => {
    const validation = validate(synthDraft({ rows: [{ seq: 1, values: { depCampus: '8:05', depStation: null, note: '0:15' } }, { seq: 2, values: { depCampus: null, depStation: null, note: null } }] }));
    const timeSet = validation.checks.find((entry) => entry.id === 'time-set');
    expect(timeSet?.severity).toBe('drop');
    expect(timeSet?.detail).toContain('빠뜨린 시각 2건');
    expect(validation.ok).toBe(false);
    expect(validation.fatal).toBe(false);
  });
});

describe('T34 검증 ③ 행 수 — 초과·순번 조작은 fatal · 누락은 폐기', () => {
  it('원문에 없는 행을 만들면 fatal', () => {
    const rows = [...synthDraft().rows, { seq: 3, values: { depCampus: null, depStation: null, note: null } }];
    const validation = validate(synthDraft({ rows }));
    const rowCount = validation.checks.find((entry) => entry.id === 'row-count');
    expect(rowCount?.severity).toBe('fatal');
    expect(rowCount?.detail).toContain('원문에 없는 행을 만들었다');
    expect(validation.fatal).toBe(true);
  });

  it('순번이 1..N 이 아니면 fatal(원문 순번 조작)', () => {
    const validation = validate(synthDraft({ rows: [{ seq: 1, values: { depCampus: '8:05', depStation: '8:25', note: '0:15' } }, { seq: 99, values: { depCampus: null, depStation: '8:35', note: null } }] }));
    const rowCount = validation.checks.find((entry) => entry.id === 'row-count');
    expect(rowCount?.severity).toBe('fatal');
    expect(rowCount?.detail).toContain('순번 불일치');
  });

  it('행이 모자라면 폐기(drop)', () => {
    const validation = validate(synthDraft({ rows: [{ seq: 1, values: { depCampus: '8:05', depStation: '8:25', note: '0:15' } }] }));
    const rowCount = validation.checks.find((entry) => entry.id === 'row-count');
    expect(rowCount?.severity).toBe('drop');
    expect(rowCount?.detail).toContain('추출 행 1개');
    expect(validation.fatal).toBe(false);
  });
});

describe('T34 검증 ④ 스키마 — 사전 밖 key·열 밖 값은 폐기', () => {
  it('의미 키 사전에 없는 key 는 폐기(drop)', () => {
    const validation = validate(synthDraft({ columns: [{ header: '순', key: 'seq' }, { header: '천안아산역 출발', key: 'depStations' }] }));
    const schema = validation.checks.find((entry) => entry.id === 'schema');
    expect(schema?.ok).toBe(false);
    expect(schema?.severity).toBe('drop');
    expect(schema?.detail).toContain('사전에 없는 key: depStations');
    expect(validation.fatal).toBe(false);
  });

  it('columns 에 없는 key 의 값은 폐기', () => {
    const validation = validate(synthDraft({ rows: [{ seq: 1, values: { depCampus: '8:05', depStation: '8:25', note: '0:15', ghost: 'x' } }, { seq: 2, values: { depCampus: null, depStation: '8:35', note: null } }] }));
    expect(validation.checks.find((entry) => entry.id === 'schema')?.detail).toContain('columns 에 없는 key');
  });

  it('key 가 중복되면 폐기', () => {
    const validation = validate(synthDraft({
      columns: [{ header: '순', key: 'seq' }, { header: '아산캠퍼스 출발', key: 'depStation' }, { header: '천안아산역 출발', key: 'depStation' }],
      rows: [{ seq: 1, values: { depStation: '8:05' } }, { seq: 2, values: { depStation: '8:35' } }],
    }));
    expect(validation.checks.find((entry) => entry.id === 'schema')?.detail).toContain('key 중복');
  });
});

// ─────────────────────────── 규칙↔AI 단순 일치(T34) ───────────────────────────

describe('T34 규칙↔AI 단순 일치 카운트(정식 교차검증은 T35)', () => {
  it('같은 행(시각 표기 정규화 포함)은 일치로 센다', () => {
    const draft: AiTablePageDraft = {
      page: 'p',
      columns: [{ header: '순', key: 'seq' }, { header: '아산캠퍼스 출발', key: 'depCampus' }],
      rows: [
        { seq: 1, values: { depCampus: '8:05' } }, // 규칙은 08:05(정규화) — 표기만 다르다
        { seq: 2, values: { depCampus: null } },
      ],
    };
    const rule = [
      { seq: 1, depCampus: '08:05', note: '0:15' },
      { seq: 2, depCampus: null, note: null },
    ];
    expect(countAgreementRows(draft, rule)).toEqual({ agreed: 2, disagreed: 0 });
  });

  it('값이 다르거나 행이 남으면 불일치로 센다', () => {
    const draft: AiTablePageDraft = {
      page: 'p',
      columns: [{ header: '순', key: 'seq' }, { header: '아산캠퍼스 출발', key: 'depCampus' }],
      rows: [{ seq: 1, values: { depCampus: '8:05' } }],
    };
    expect(countAgreementRows(draft, [{ seq: 1, depCampus: '08:10' }])).toEqual({ agreed: 0, disagreed: 1 });
    expect(countAgreementRows(draft, [{ seq: 1, depCampus: '08:05' }, { seq: 2, depCampus: null }])).toEqual({ agreed: 1, disagreed: 1 });
  });
});
