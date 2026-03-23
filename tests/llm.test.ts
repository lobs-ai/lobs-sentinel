import { describe, it, expect } from "vitest";
import { parseModelString } from "../src/llm.js";

describe("parseModelString", () => {
  it("parses explicit anthropic prefix", () => {
    expect(parseModelString("anthropic/claude-haiku-4-5")).toEqual({
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
    });
  });

  it("parses explicit openai prefix", () => {
    expect(parseModelString("openai/gpt-4o")).toEqual({
      provider: "openai",
      modelId: "gpt-4o",
    });
  });

  it("auto-detects claude models as anthropic", () => {
    expect(parseModelString("claude-sonnet-4-20250514")).toEqual({
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
    });
    expect(parseModelString("claude-haiku-4-5")).toEqual({
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
    });
  });

  it("auto-detects gpt models as openai", () => {
    expect(parseModelString("gpt-4o")).toEqual({
      provider: "openai",
      modelId: "gpt-4o",
    });
    expect(parseModelString("gpt-4o-mini")).toEqual({
      provider: "openai",
      modelId: "gpt-4o-mini",
    });
  });

  it("auto-detects o-series models as openai", () => {
    expect(parseModelString("o1-mini")).toEqual({
      provider: "openai",
      modelId: "o1-mini",
    });
    expect(parseModelString("o3-mini")).toEqual({
      provider: "openai",
      modelId: "o3-mini",
    });
    expect(parseModelString("o4-mini")).toEqual({
      provider: "openai",
      modelId: "o4-mini",
    });
  });

  it("defaults unknown models to anthropic", () => {
    expect(parseModelString("some-random-model")).toEqual({
      provider: "anthropic",
      modelId: "some-random-model",
    });
  });

  it("treats unknown prefix as openai-compatible", () => {
    expect(parseModelString("lmstudio/qwen-7b")).toEqual({
      provider: "openai",
      modelId: "lmstudio/qwen-7b",
    });
  });
});
