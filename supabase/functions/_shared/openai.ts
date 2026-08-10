// Shared OpenAI Responses API caller - retry/timeout/CORS/error-response
// conventions extracted from analyze-workout/index.ts (the original, sole
// caller until Coach Quick Create Phase 1's regenerate-variant function).
// Both callers are Deno edge functions in the SAME repo - no cross-repo
// build-boundary reason to duplicate this (unlike movementCatalog.ts,
// which crosses the Deno/Vite repo boundary and stays deliberately
// separate). Deliberately narrow: only the network/retry/timeout
// mechanics are shared here - each caller keeps its own response-parsing
// and user-facing error strings, since those differ per function (this
// mirrors invite.ts's own "not a general-purpose library" scoping).

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: CORS });
}

export class OpenAiHttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`OpenAI HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

export interface OpenAiCallConfig {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  schemaName: string;
  // deno-lint-ignore no-explicit-any
  jsonSchema: Record<string, any>;
  timeoutMs?: number;
  retryDelayMs?: number;
}

async function callOpenAiOnce(config: OpenAiCallConfig, signal: AbortSignal): Promise<Response> {
  return fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({
      model: config.model,
      reasoning: { effort: "low" },
      store: false,
      input: [
        { role: "developer", content: config.systemPrompt },
        { role: "user", content: config.userContent },
      ],
      text: {
        format: {
          type: "json_schema",
          name: config.schemaName,
          strict: true,
          schema: config.jsonSchema,
        },
      },
    }),
  });
}

// One retry only, and only for transient errors (429/5xx or timeout/
// network) - never for 4xx (an invalid request doesn't get fixed by
// retrying the same request) - matches analyze-workout's own original
// reasoning exactly.
// deno-lint-ignore no-explicit-any
export async function callOpenAiWithRetry(config: OpenAiCallConfig): Promise<any> {
  const timeoutMs = config.timeoutMs ?? 45_000;
  const retryDelayMs = config.retryDelayMs ?? 800;
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await callOpenAiOnce(config, controller.signal);
      if (res.ok) return await res.json();
      const responseBody = await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt === 0) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }
      throw new OpenAiHttpError(res.status, responseBody);
    } catch (err) {
      if (err instanceof OpenAiHttpError) throw err;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
