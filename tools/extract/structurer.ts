/**
 * AI 어댑터 **조립**(composition) — 순수 함수라 테스트에서 그대로 부를 수 있다.
 *
 * `index.ts`(실행 진입점)는 여기에 `process.env` 값을 넘기기만 한다.
 * 이 분리가 "환경변수 → 어댑터" 배선을 테스트 가능하게 만든다(모의 서버 = `AI_BASE_URL`).
 *
 * 우선순위: `--model`(CLI) > `AI_MODEL`(env) > 어댑터 기본값(ollama 만 `lfm2.5:latest`).
 * **api 모드에는 벤더 기본 도메인이 없다** — `AI_BASE_URL` 이 없으면 호출하지 않고 규칙 전용으로 폴백한다.
 * 시크릿(`AI_API_KEY`)은 인자로만 전달하며 어디에도 기록하지 않는다.
 */

import { createApiStructurer, createDisabledStructurer, createOllamaStructurer, DEFAULT_MODEL } from './ai.js';
import type { AiMode } from './cli.js';
import type { AiStructurer } from './types.js';

/** 환경변수 값(없으면 빈 문자열/undefined) — 이름은 `AI_*` 세 개뿐이다 */
export interface StructurerEnv {
  readonly AI_BASE_URL?: string | undefined;
  readonly AI_MODEL?: string | undefined;
  readonly AI_API_KEY?: string | undefined;
}

export interface StructurerOptions {
  /** CLI `--model` 값(빈 문자열 = 미지정) */
  readonly model: string;
  readonly env: StructurerEnv;
  readonly log?: ((line: string) => void) | undefined;
  /** 테스트·비용 실험용 입력 상한(기본은 `ai.ts` 의 `MAX_PROMPT_CHARS`) */
  readonly maxPromptChars?: number | undefined;
  /** 한 요청에 담을 후보 수(기본은 `ai.ts` 의 `MAX_CANDIDATES_PER_CALL` = 24) */
  readonly maxCandidatesPerCall?: number | undefined;
}

export function createStructurerFor(mode: AiMode, options: StructurerOptions): AiStructurer {
  const log = options.log ?? ((): void => {});
  const cliModel = options.model.trim();

  if (mode === 'off') return createDisabledStructurer(cliModel === '' ? DEFAULT_MODEL : cliModel);
  if (mode === 'ollama') {
    return createOllamaStructurer({ model: cliModel === '' ? DEFAULT_MODEL : cliModel, log });
  }
  return createApiStructurer({
    model: cliModel !== '' ? cliModel : (options.env.AI_MODEL ?? '').trim(),
    baseUrl: (options.env.AI_BASE_URL ?? '').trim(),
    apiKey: (options.env.AI_API_KEY ?? '').trim(),
    log,
    ...(options.maxPromptChars === undefined ? {} : { maxPromptChars: options.maxPromptChars }),
    ...(options.maxCandidatesPerCall === undefined ? {} : { maxCandidatesPerCall: options.maxCandidatesPerCall }),
  });
}
