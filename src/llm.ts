/**
 * LLM client — thin wrapper around Anthropic SDK.
 */
import Anthropic from "@anthropic-ai/sdk";
import { log } from "./log.js";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
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

/**
 * Send a prompt to the LLM and get a text response.
 */
export async function ask(req: LlmRequest): Promise<LlmResponse> {
  const anthropic = getClient();

  log.debug("LLM request", { model: req.model, promptLen: req.prompt.length });

  const response = await anthropic.messages.create({
    model: req.model,
    max_tokens: req.maxTokens ?? 8192,
    system: req.system,
    messages: [{ role: "user", content: req.prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };

  log.debug("LLM response", { tokens: usage, textLen: text.length });

  return { text, ...usage };
}
