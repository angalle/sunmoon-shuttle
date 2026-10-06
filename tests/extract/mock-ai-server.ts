/**
 * 모의 OpenAI 호환 API 서버 — **테스트·증거 전용**(실 API 호출 0 · 과금 0).
 *
 * `POST /chat/completions`(그리고 `AI_BASE_URL` 접두사가 붙은 경로)만 처리하고,
 * 들어온 요청 본문·인증 헤더를 기록한다. 실 서버처럼 응답 코드·본문을 시나리오별로 바꿀 수 있다.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockApiRequest {
  readonly url: string;
  readonly auth: string | null;
  readonly body: {
    readonly model?: unknown;
    readonly messages?: readonly { readonly content?: unknown }[];
    readonly temperature?: unknown;
    readonly response_format?: unknown;
    readonly stream?: unknown;
  };
}

export interface MockApiResponse {
  readonly status?: number;
  readonly body?: unknown;
}

export interface MockApi {
  /** `AI_BASE_URL` 로 그대로 넣는 주소(경로 접두사 `/v1` 포함 — 실제 벤더 형태) */
  readonly baseUrl: string;
  readonly requests: MockApiRequest[];
  close(): Promise<void>;
}

export type MockApiHandler = (request: MockApiRequest, index: number) => MockApiResponse | Promise<MockApiResponse>;

export const EMPTY_COMPLETION_BODY = { choices: [{ message: { content: '{"rules":[]}' } }] } as const;

/** `{"rules":[…]}` 를 담은 정상 chat completion 본문 */
export function completionBody(rules: readonly unknown[]): unknown {
  return { choices: [{ message: { content: JSON.stringify({ rules }) } }] };
}

export async function startMockApi(handler: MockApiHandler = () => ({}), port = 0): Promise<MockApi> {
  const requests: MockApiRequest[] = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    request.on('end', () => {
      let body: MockApiRequest['body'] = {};
      try {
        body = raw === '' ? {} : (JSON.parse(raw) as MockApiRequest['body']);
      } catch {
        body = {};
      }
      const captured: MockApiRequest = { url: request.url ?? '', auth: request.headers.authorization ?? null, body };
      requests.push(captured);
      void Promise.resolve(handler(captured, requests.length - 1))
        .then((result) => {
          response.writeHead(result.status ?? 200, { 'content-type': 'application/json' });
          response.end(JSON.stringify(result.body ?? EMPTY_COMPLETION_BODY));
        })
        .catch(() => {
          response.writeHead(500, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'mock handler failure' }));
        });
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
