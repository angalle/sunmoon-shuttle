/**
 * T35 §5 **규칙 ↔ AI 교차검증** 단위 테스트 — 정규화 비교 + 3등급(①모순 차단 · ②key-shift 경고 · ③null-vs-값 경고).
 *
 * 실측 근거(AC-AI1-4b): T34 실 DeepSeek 초안과 **같은 규칙**으로 만든 정답 초안(`faithfulDraftFromPrompt`)을
 * 병합 셀 페이지에 넣으면 ① 0건 · ② 32/38건(경고) 로 분류되고 **발행이 멈추지 않아야** 한다.
 * (T34 실측: agreed 78 / disagreed 70 = 병합 셀 2페이지 집중 — 이 테스트가 그 수치를 재현한다.)
 *
 * Stage B(§5): 규칙 0건 페이지에서만 AI 초안을 채택하고, 채택분은 계약 검증(v1)을 통과해야 한다.
 */

import { describe, expect, it } from 'vitest';

import { adoptable, canonicalCellValue, crossCheckPage, rawAgreementRows, sumCrossCheck } from '../../tools/extract/aiCrossCheck.js';
import { adoptAiRows, canAdopt } from '../../tools/extract/aiAdopt.js';
import { buildTablePrompt } from '../../tools/extract/aiTable.js';
import { validateTableDraft } from '../../tools/extract/aiTableValidate.js';
import { findScheduleTable } from '../../tools/extract/tableRegion.js';
import type { AiTablePageDraft } from '../../tools/extract/types.js';
import { validateTimetable } from '../../tools/scraper/validate.js';
import { pageText } from '../../tools/extract/text.js';
import { faithfulDraftFromPrompt } from './tableFixtures.js';
import { loadFixture } from './support.js';

// ─────────────────────────── 정규화(양쪽 동일 함수) ───────────────────────────

describe('T35 정규화 — 공백·null/""·시각 표기', () => {
  it('공백·전각/반각·\\u00a0 를 접고, null 과 "" 를 같은 것으로 본다', () => {
    expect(canonicalCellValue('  5분~20분  소요예상 ')).toBe('5분~20분 소요예상');
    expect(canonicalCellValue('5분~20분\u00a0소요예상')).toBe('5분~20분 소요예상');
    expect(canonicalCellValue('5분~20분\u3000소요예상')).toBe('5분~20분 소요예상');
    expect(canonicalCellValue(null)).toBeNull();
    expect(canonicalCellValue(undefined)).toBeNull();
    expect(canonicalCellValue('')).toBeNull();
    expect(canonicalCellValue('   ')).toBeNull();
  });

  it('시각은 **시(hour) 0패딩만** — 분 자리는 변형하지 않는다', () => {
    expect(canonicalCellValue('8:05')).toBe('08:05');
    expect(canonicalCellValue('08:05')).toBe('08:05');
    expect(canonicalCellValue('0:15')).toBe('00:15');
    expect(canonicalCellValue('8:5')).toBe('8:5'); // 불완전 토큰은 만들지 않는다(원문 토큰만)
    expect(canonicalCellValue('금(X)')).toBe('금(X)');
  });
});

// ─────────────────────────── 3등급 판정 ───────────────────────────

const COLUMNS = [
  { header: '순', key: 'seq' },
  { header: '출발', key: 'depCampus' },
  { header: '도착', key: 'arrCampus' },
];

function check(draft: AiTablePageDraft, ruleRows: readonly Record<string, string | number | null>[]) {
  return crossCheckPage({ page: 'p', routeId: 'asan-ktx', dayType: 'weekday', draft, ruleRows });
}

describe('T35 3등급 — ① 값 모순만 차단한다', () => {
  it('정규화 후 같으면 일치(공백·null/""·시 0패딩 차이는 불일치가 아니다)', () => {
    const result = check(
      { page: 'p', columns: COLUMNS, rows: [{ seq: 1, values: { depCampus: '8:05', arrCampus: null } }] },
      [{ seq: 1, depCampus: '08:05', arrCampus: '' }],
    );
    expect(result.agreedRows).toBe(1);
    expect(result.blocked).toBe(false);
  });

  it('② key-shift — 같은 행에 값이 있지만 다른 의미 키로 배정된 경우는 **경고**(차단 아님)', () => {
    const result = check(
      { page: 'p', columns: COLUMNS, rows: [{ seq: 1, values: { depCampus: '08:50', arrCampus: null } }] },
      [{ seq: 1, depCampus: '5분~20분 소요예상', arrCampus: '08:50' }],
    );
    expect(result.keyShiftRows).toBe(1);
    expect(result.contradictedRows).toBe(0);
    expect(result.blocked).toBe(false);
    expect(result.details.join(' ')).toContain('다른 열로 배정됨');
  });

  it('③ null-vs-값 — 한쪽만 값이면 **경고**(차단 아님)', () => {
    const result = check(
      { page: 'p', columns: COLUMNS, rows: [{ seq: 1, values: { depCampus: '08:05', arrCampus: '금(X)' } }] },
      [{ seq: 1, depCampus: '08:05', arrCampus: null }],
    );
    expect(result.nullMismatchRows).toBe(1);
    expect(result.contradictedRows).toBe(0);
    expect(result.blocked).toBe(false);
  });

  it('① 값 모순 — 양쪽 다 값이 있는데 다르고 그 값이 다른 키에도 없으면 **차단**', () => {
    const result = check(
      { page: 'p', columns: COLUMNS, rows: [{ seq: 1, values: { depCampus: '07:40', arrCampus: '08:45' } }] },
      [{ seq: 1, depCampus: '08:05', arrCampus: '08:45' }],
    );
    expect(result.contradictedRows).toBe(1);
    expect(result.blocked).toBe(true);
    expect(result.details.join(' ')).toContain('depCampus');
  });

  it('행 집합 불일치(한쪽에만 있는 행)는 **차단**', () => {
    const result = check(
      {
        page: 'p',
        columns: COLUMNS,
        rows: [
          { seq: 1, values: { depCampus: '08:05', arrCampus: null } },
          { seq: 2, values: { depCampus: null, arrCampus: '09:00' } },
        ],
      },
      [{ seq: 1, depCampus: '08:05', arrCampus: null }],
    );
    expect(result.rowSetMismatchRows).toBe(1);
    expect(result.blocked).toBe(true);
  });

  it('정규화 전(T34 정의) 카운트를 함께 남긴다 — `rawAgreedRows`/`rawDisagreedRows`', () => {
    const draft: AiTablePageDraft = { page: 'p', columns: COLUMNS, rows: [{ seq: 1, values: { depCampus: '8:45', arrCampus: null } }] };
    const rule = [{ seq: 1, depCampus: '08:05', arrCampus: '08:45' }];
    expect(rawAgreementRows(draft, rule)).toEqual({ agreed: 0, disagreed: 1 });
    const result = check(draft, rule);
    expect(result.rawAgreedRows).toBe(0);
    expect(result.rawDisagreedRows).toBe(1);
    expect(result.keyShiftRows).toBe(1); // 값은 있는데 열이 밀렸다(②) — T34 실측의 그 형태
    expect(result.blocked).toBe(false);
  });
});

// ─────────────────────────── 실측 재현(AC-AI1-4b) ───────────────────────────

interface FaithfulPage {
  readonly page: string;
  readonly routeId: string;
  readonly dayType: 'weekday' | 'saturday' | 'sunday';
  readonly draft: AiTablePageDraft;
  readonly ruleRows: readonly Record<string, never>[];
}

/** 원본 스냅샷 → (표 영역 + 정답 초안 + 규칙 행) — 파이프라인과 같은 재료를 쓴다(AI 호출 0) */
function faithfulPage(file: string, fixture = loadFixture()): FaithfulPage {
  const bare = file.replace('data/raw/', '');
  const source = fixture.sources.find((entry) => entry.file === bare);
  if (source === undefined) throw new Error(`스냅샷 없음: ${file}`);
  const region = findScheduleTable(source.html);
  if (region === null) throw new Error(`표 없음: ${file}`);
  const page = `data/raw/${bare}`; // CLI 와 같은 경로 표기(프롬프트·기록의 키)
  const draft = faithfulDraftFromPrompt(
    buildTablePrompt({ page, routeId: source.routeId, dayType: source.dayType, regionText: region.text, pageText: source.text }),
  );
  if (draft === null) throw new Error(`초안 생성 실패: ${file}`);
  const route = fixture.base.routes.find((entry) => entry.id === source.routeId);
  return {
    page,
    routeId: source.routeId,
    dayType: source.dayType,
    draft,
    ruleRows: (route?.byDay[source.dayType].trips ?? []) as unknown as readonly Record<string, never>[],
  };
}

describe('T35 AC-AI1-4b — 병합 셀 2페이지가 ① 0건으로 분류되고 발행이 멈추지 않는다', () => {
  it('정답 초안 10페이지: ① 0 · ② 70(32 + 38) · 정규화 전 78/70 (T34 실측과 같은 수치)', () => {
    const fixture = loadFixture();
    const tablePages = fixture.sources.filter((source) => findScheduleTable(source.html) !== null);
    const results = tablePages.map((source) => {
      const prepared = faithfulPage(source.file.replace('data/raw/', ''), fixture);
      return crossCheckPage({
        page: prepared.page,
        routeId: prepared.routeId,
        dayType: prepared.dayType,
        draft: prepared.draft,
        ruleRows: prepared.ruleRows,
      });
    });

    expect(results).toHaveLength(10);
    const totals = sumCrossCheck(results);
    expect(totals.contradictedRows).toBe(0); // ① 값 모순 0 → 차단 없음
    expect(totals.keyShiftRows).toBe(70); // ② 경고(병합 셀 2페이지 집중)
    expect(totals.agreedRows).toBe(78); // 정규화 후 일치
    expect(totals.rawAgreedRows).toBe(78); // 정규화 전(T34) 78
    expect(totals.rawDisagreedRows).toBe(70); // 정규화 전(T34) 70
    expect(totals.rowSetMismatchRows).toBe(0);

    const station = results.find((result) => result.page.endsWith('cheonan-station-평일.html'));
    const terminal = results.find((result) => result.page.endsWith('cheonan-terminal-평일.html'));
    expect(station?.keyShiftRows).toBe(32);
    expect(station?.contradictedRows).toBe(0);
    expect(terminal?.keyShiftRows).toBe(38);
    expect(terminal?.contradictedRows).toBe(0);
    expect(results.every((result) => !result.blocked)).toBe(true); // 발행이 멈추지 않는다
  });
});

// ─────────────────────────── Stage B(§5) ───────────────────────────

describe('T35 Stage B — 규칙 0건 페이지에서만 AI 초안을 채택한다', () => {
  const FILE = '2026-2학기-asan-ktx-토요일.html';

  function emptiedBase() {
    const fixture = loadFixture();
    const routes = fixture.base.routes.map((route) =>
      route.id !== 'asan-ktx'
        ? route
        : { ...route, byDay: { ...route.byDay, saturday: { ...route.byDay.saturday, trips: [] } } },
    );
    return { ...fixture.base, routes };
  }

  it('규칙 0건 → 교차검증 차단 없음(비교 대상 없음) · 계약 열 일치 → 채택 + extractedBy/needsReview', () => {
    const prepared = faithfulPage(FILE);
    const crossCheck = crossCheckPage({ page: prepared.page, routeId: 'asan-ktx', dayType: 'saturday', draft: prepared.draft, ruleRows: [] });
    expect(crossCheck.blocked).toBe(false);
    expect(adoptable(crossCheck)).toBe(true);
    expect(canAdopt(prepared.draft, 'asan-ktx', 'saturday').ok).toBe(true);

    const adopted = adoptAiRows(emptiedBase(), [
      { page: prepared.page, routeId: 'asan-ktx', dayType: 'saturday', draft: prepared.draft, evidence: '검증 4종 통과 · ①0 ②0' },
    ]);
    expect(adopted.adopted).toHaveLength(1);
    expect(adopted.adopted[0]).toMatchObject({ routeId: 'asan-ktx', dayType: 'saturday', extractedBy: 'ai', needsReview: true });
    const table = adopted.timetable.routes.find((route) => route.id === 'asan-ktx')?.byDay.saturday;
    expect(table?.trips).toHaveLength(prepared.draft.rows.length);
    expect((table as unknown as Record<string, unknown>)['extractedBy']).toBe('ai');
    expect((table as unknown as Record<string, unknown>)['needsReview']).toBe(true);
    // 채택분은 v1 계약 검증을 통과한다(0건이던 표가 채워져 발행 가능)
    expect(validateTimetable(adopted.timetable)).toEqual([]);
  });

  it('채택 조건 미충족(계약 열 불일치) → 채택 0건 · v1 기준선 검증 실패(= 발행 보류)', () => {
    const prepared = faithfulPage(FILE);
    const wrongKeys: AiTablePageDraft = {
      ...prepared.draft,
      columns: [
        { header: '순', key: 'seq' },
        { header: '출발', key: 'depStation' },
      ],
    };
    expect(canAdopt(wrongKeys, 'asan-ktx', 'saturday').ok).toBe(false);
    const notAdopted = adoptAiRows(emptiedBase(), [
      { page: prepared.page, routeId: 'asan-ktx', dayType: 'saturday', draft: wrongKeys, evidence: '열 불일치' },
    ]);
    expect(notAdopted.adopted).toHaveLength(0);
    expect(validateTimetable(notAdopted.timetable).length).toBeGreaterThan(0);
  });

  it('검증 4종을 못 넘는 초안(환각)은 Stage B 에서도 채택되지 않는다', () => {
    const prepared = faithfulPage(FILE);
    const fixture = loadFixture();
    const source = fixture.sources.find((entry) => entry.file === FILE);
    const region = source === undefined ? null : findScheduleTable(source.html);
    if (source === undefined || region === null) throw new Error('픽스처 없음');
    const hallucinated: AiTablePageDraft = {
      ...prepared.draft,
      rows: prepared.draft.rows.map((row, index) => (index === 0 ? { ...row, values: { ...row.values, depCampus: '23:59' } } : row)),
    };
    const validation = validateTableDraft(hallucinated, { region, pageText: pageText(source.html) });
    expect(validation.ok).toBe(false);
    expect(validation.fatal).toBe(true); // 원문에 없는 시각 = 치명 → 채택 경로로 가지 않는다
  });

  it('AC-AI1-4d — ② key-shift ≥1 이면 Stage B 채택 게이트(`adoptable`)가 거짓', () => {
    // ① 0 이지만 ② 1 → 채택 금지(AI 출력을 **실제로 쓰는** 경로에서만 열 배정까지 요구 — 총괄 계약 #60)
    const shifted = crossCheckPage({
      page: 'p',
      routeId: 'asan-ktx',
      dayType: 'weekday',
      draft: { page: 'p', columns: COLUMNS, rows: [{ seq: 1, values: { depCampus: '08:50', arrCampus: null } }] },
      ruleRows: [{ seq: 1, depCampus: '5분~20분 소요예상', arrCampus: '08:50' }],
    });
    expect(shifted.keyShiftRows).toBe(1);
    expect(shifted.contradictedRows).toBe(0);
    expect(shifted.blocked).toBe(false); // 발행 자체는 막지 않는다(Stage A 원칙)
    expect(adoptable(shifted)).toBe(false); // 그러나 채택은 금지

    const clean = crossCheckPage({
      page: 'p',
      routeId: 'asan-ktx',
      dayType: 'weekday',
      draft: { page: 'p', columns: COLUMNS, rows: [{ seq: 1, values: { depCampus: '08:05', arrCampus: '08:45' } }] },
      ruleRows: [{ seq: 1, depCampus: '08:05', arrCampus: '08:45' }],
    });
    expect(adoptable(clean)).toBe(true);
  });

  it('AC-AI1-4d — 규칙 0건 페이지는 비교 대상이 없어 ①/②가 구조적으로 0 → 실제 게이트는 검증 4종 + 계약 열', () => {
    const prepared = faithfulPage(FILE);
    const crossCheck = crossCheckPage({ page: prepared.page, routeId: 'asan-ktx', dayType: 'saturday', draft: prepared.draft, ruleRows: [] });
    expect(crossCheck.comparedRows).toBe(0);
    expect(crossCheck.contradictedRows).toBe(0);
    expect(crossCheck.keyShiftRows).toBe(0);
    expect(crossCheck.details.join(' ')).toContain('규칙 0건');
    // 규칙이 행을 만들지 않은 페이지에서 AI 값을 쓰는 유일한 경로 = 계약 열 집합 일치(canAdopt) + 검증 4종 통과
    expect(canAdopt(prepared.draft, 'asan-ktx', 'saturday').ok).toBe(true);
    expect(canAdopt({ ...prepared.draft, columns: [{ header: '순', key: 'seq' }] }, 'asan-ktx', 'saturday').ok).toBe(false);
  });
});
