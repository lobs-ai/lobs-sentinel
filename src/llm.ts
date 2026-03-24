/**
 * Multi-provider LLM client for lobs-sentinel.
 *
 * Supports:
 * - Anthropic (native API — API key or OAuth token)
 * - OpenAI (and any OpenAI-compatible endpoint)
 *
 * Model string format: "provider/model-id" or just "model-id" (auto-detected)
 * Examples:
 *   "anthropic/claude-haiku-4-5"
 *   "openai/gpt-4o"
 *   "claude-haiku-4-5"           → anthropic
 *   "gpt-4o"                     → openai
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY     — Anthropic API key (sk-ant-...)
 *   ANTHROPIC_AUTH_TOKEN  — Anthropic OAuth token (alternative to API key)
 *   OPENAI_API_KEY        — OpenAI API key
 *   OPENAI_BASE_URL       — Custom OpenAI-compatible base URL
 */
import Anthropic from "@anthropic-ai/sdk";
import { log } from "./log.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type Provider = "anthropic" | "openai";

export interface ProviderConfig {
  provider: Provider;
  modelId: string;
}

export interface LlmRequest {
  model: string;
  system: string;
  prompt: string;
  maxTokens?: number;
}

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

// ── Provider Resolution ──────────────────────────────────────────────────────

/**
 * Parse "provider/model-id" into provider + modelId.
 * Falls back to auto-detection from model name prefix.
 */
export function parseModelString(model: string): ProviderConfig {
  const slashIdx = model.indexOf("/");
  if (slashIdx > 0) {
    const prefix = model.slice(0, slashIdx).toLowerCase();
    const modelId = model.slice(slashIdx + 1);

    if (prefix === "anthropic") return { provider: "anthropic", modelId };
    if (prefix === "openai") return { provider: "openai", modelId };

    // Unknown prefix — treat as openai-compatible with full string as model ID
    return { provider: "openai", modelId: model };
  }

  // No prefix — auto-detect
  if (model.startsWith("claude")) return { provider: "anthropic", modelId: model };
  if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4"))
    return { provider: "openai", modelId: model };

  // Default to anthropic
  return { provider: "anthropic", modelId: model };
}

// ── Anthropic Client ─────────────────────────────────────────────────────────

function isOAuthToken(key: string): boolean {
  return key.includes("sk-ant-oat");
}

function createAnthropicClient(): Anthropic {
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (authToken) {
    // OAuth token — needs claude-code and oauth beta headers
    return new Anthropic({
      apiKey: null,
      authToken,
      defaultHeaders: {
        "anthropic-beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14",
      },
    });
  }

  if (apiKey && isOAuthToken(apiKey)) {
    // OAuth token passed as API key (common pattern)
    return new Anthropic({
      apiKey: null,
      authToken: apiKey,
      defaultHeaders: {
        "anthropic-beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14",
      },
    });
  }

  if (apiKey) {
    return new Anthropic({ apiKey });
  }

  throw new Error(
    "No Anthropic credentials. Set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN.",
  );
}

async function askAnthropic(
  modelId: string,
  system: string,
  prompt: string,
  maxTokens: number,
): Promise<LlmResponse> {
  const client = createAnthropicClient();

  const response = await client.messages.create({
    model: modelId,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

// ── OpenAI Client ────────────────────────────────────────────────────────────

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string | null;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

async function askOpenAI(
  modelId: string,
  system: string,
  prompt: string,
  maxTokens: number,
): Promise<LlmResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("No OpenAI credentials. Set OPENAI_API_KEY.");
  }

  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(
    /\/+$/,
    "",
  );

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = (await response.json()) as OpenAIResponse;
  const choice = data.choices?.[0];
  if (!choice) throw new Error("No choices in OpenAI response");

  return {
    text: choice.message.content ?? "",
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

// ── Retry Logic ──────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;

function getHttpStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  const msg = error instanceof Error ? error.message : String(error);
  const match = msg.match(/\b([45]\d{2})\b/);
  return match ? parseInt(match[1], 10) : undefined;
}

function isRetryable(error: unknown): boolean {
  const status = getHttpStatus(error);
  if (!status) return false;
  return status === 429 || status === 529 || (status >= 500 && status < 600);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a prompt to the configured LLM and get a text response.
 * Routes to Anthropic or OpenAI based on the model string.
 * Retries on transient errors (429, 5xx) with exponential backoff.
 */
export async function ask(req: LlmRequest): Promise<LlmResponse> {
  const { provider, modelId } = parseModelString(req.model);
  const maxTokens = req.maxTokens ?? 8192;

  log.debug("LLM request", { provider, model: modelId, promptLen: req.prompt.length });

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      let response: LlmResponse;
      if (provider === "anthropic") {
        response = await askAnthropic(modelId, req.system, req.prompt, maxTokens);
      } else {
        response = await askOpenAI(modelId, req.system, req.prompt, maxTokens);
      }

      log.debug("LLM response", {
        provider,
        tokens: { input: response.inputTokens, output: response.outputTokens },
        textLen: response.text.length,
      });

      return response;
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);

      if (attempt < MAX_RETRIES && isRetryable(error)) {
        const backoffMs = Math.min(5000 * Math.pow(2, attempt - 1), 30_000);
        const jitter = backoffMs * (0.7 + Math.random() * 0.6);
        log.warn(
          `LLM error (attempt ${attempt}/${MAX_RETRIES}), retrying in ${(jitter / 1000).toFixed(1)}s: ${msg.slice(0, 200)}`,
        );
        await sleep(jitter);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}
