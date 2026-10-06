/**
 * 증거 실행용 **모의 OpenAI 호환 서버**(실 API 호출 0 · 과금 0).
 *
 * 사용:
 *   ./node_modules/.bin/tsx tests/extract/run-mock-api.ts 8791
 *   AI_BASE_URL=http://127.0.0.1:8791/v1 AI_MODEL=mock-model-v1 AI_API_KEY=dummy-not-a-real-key \
 *     npm run extract -- --ai=api
 *
 * 응답은 원본 스냅샷에 **실제로 존재하는 문장**(규칙이 설명하지 않는 문장)을 인용한다 →
 * 검증(인용 부분문자열·스키마)을 통과해 `extractedBy: ai` 항목이 산출물에 들어간다.
 * 인증 헤더 값은 **출력하지 않는다**(존재 여부만 표시) — 키가 로그로 새지 않게.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { harvestCandidates, toSources } from '../../tools/extract/candidates.js';
import { parseSnapshotFileName } from '../../tools/scraper/routeMeta.js';
import { startMockApi } from './mock-ai-server.js';

const port = Number(process.argv[2] ?? '8791');
const rawDir = join(process.cwd(), 'data', 'raw');
const files = readdirSync(rawDir)
  .filter((file) => file.endsWith('.html'))
  .sort();
const inputs = files.map((file) => {
  const ref = parseSnapshotFileName(file);
  return { file, routeId: ref.routeId, dayType: ref.dayType, html: readFileSync(join(rawDir, file), 'utf8') };
});
const { candidates } = harvestCandidates(toSources(inputs));
// T26: 노선 폐지 문장은 AI 대상이 아니다(dateRules 금지) — 규칙이 설명하지 않는 다른 문장을 쓴다.
const target = candidates.find((candidate) => candidate.text.startsWith('*소요시간: 등교시 아산역>캠퍼스'));

const server = await startMockApi((request) => {
  const prompt = String(request.body.messages?.[0]?.content ?? '');
  console.log(
    `[mock] ${request.url} model=${String(request.body.model)} auth=${request.auth === null ? 'none' : 'present'} promptChars=${String(prompt.length)}`,
  );
  const rules =
    target === undefined
      ? []
      : [
          {
            candidateId: target.id,
            sourceQuote: target.text,
            kind: 'route-change',
            note: '경유·소요시간 안내(규칙 밖 문장)',
            confidence: 0.9,
          },
        ];
  return { body: { choices: [{ message: { content: JSON.stringify({ rules }) } }] } };
}, port);

console.log(`[mock] listening ${server.baseUrl} (target=${target?.id ?? 'none'})`);
