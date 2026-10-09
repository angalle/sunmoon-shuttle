/**
 * T34 증거 실행용 모의 **표** AI 서버 — 실 API 호출 0 · 과금 0.
 *
 * 사용:
 *   ./node_modules/.bin/tsx tests/extract/run-mock-table-api.ts <port> <faithful|hallucinate>
 *   AI_BASE_URL=http://127.0.0.1:<port>/v1 AI_MODEL=mock-table-v1 AI_API_KEY=dummy-not-a-real-key \
 *     npm run extract -- --ai=api --ai-cache tmp/… --ai-draft tmp/… --ai-report tmp/…
 *
 * 응답은 **프롬프트에 실린 표를 되읽어** 만든다(`tableFixtures.ts`) → 페이지를 바꿔 끼워도 항상 정합.
 *   - `faithful`    : 원문 토큰 그대로의 정답 초안(검증 4종 통과)
 *   - `hallucinate` : 표에 없는 시각(`23:59`)·행(순번 = 행 수+1)을 주입 → 검증 4종 실패(치명)
 *
 * 인증 헤더 값은 **출력하지 않는다**(존재 여부만) — 키가 로그로 새지 않게.
 */

import { contradictedDraftFromPrompt, hallucinatedDraftFromPrompt, nullMismatchDraftFromPrompt, tableAwareHandler } from './tableFixtures.js';
import type { AiTablePageDraft } from '../../tools/extract/types.js';
import { startMockApi } from './mock-ai-server.js';

type Mode = 'faithful' | 'hallucinate' | 'contradict' | 'nullmiss';

const port = Number(process.argv[2] ?? '8792');
const requested = process.argv[3] ?? 'faithful';
const mode: Mode =
  requested === 'hallucinate' || requested === 'contradict' || requested === 'nullmiss' ? requested : 'faithful';
/** 표에 없는 시각(환각 주입값) — 실측 로그에 그대로 남는다 */
const FAKE_TIME = process.argv[4] ?? '23:59';

let tableRequests = 0;

/** T35 주입 모드: `contradict`(① 값 모순 → 발행 보류) · `nullmiss`(③ null-vs-값 → 경고 후 발행) */
const mutate = (draft: AiTablePageDraft, prompt: string): AiTablePageDraft => {
  if (mode === 'hallucinate') return hallucinatedDraftFromPrompt(prompt, FAKE_TIME) ?? draft;
  if (mode === 'contradict') return contradictedDraftFromPrompt(prompt) ?? draft;
  if (mode === 'nullmiss') return nullMismatchDraftFromPrompt(prompt) ?? draft;
  return draft;
};

const handler = tableAwareHandler(mutate);

const server = await startMockApi((request, index) => {
  const prompt = String(request.body.messages?.[0]?.content ?? '');
  const isTable = prompt.includes('\n표:\n');
  if (isTable) tableRequests += 1;
  console.log(
    `[mock] #${String(index + 1)} table=${isTable ? 'yes' : 'no'} auth=${request.auth === null ? 'none' : 'present'} model=${String(request.body.model)} promptChars=${String(prompt.length)}`,
  );
  return handler(request, index);
}, port);

console.log(`[mock] mode=${mode} fakeTime=${FAKE_TIME} listening ${server.baseUrl} tableRequests=${String(tableRequests)}`);

const shutdown = (): void => {
  console.log(`[mock] shutting down — tableRequests=${String(tableRequests)}`);
  void server.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
