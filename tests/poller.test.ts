import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock resolver so we control what repos come back
vi.mock("../src/resolver.js", () => ({
  resolveRepos: vi.fn(),
}));

import { startPolling, type PollHandler } from "../src/poller.js";
import { resolveRepos } from "../src/resolver.js";
import type { SentinelConfig } from "../src/config.js";

function makeConfig(overrides: Partial<SentinelConfig> = {}): SentinelConfig {
  return {
    repos: ["test/repo"],
    orgs: [],
    polling: { interval: 0.05 }, // 50ms for fast tests
    model: "test-model",
    mode: "reviewer",
    logLevel: "error",
    reviewer: { auto_approve: false, style: "thorough", ignore_drafts: true, custom_instructions: "" },
    labeler: { labels: {}, custom_instructions: "" },
    triage: { priorities: [], categories: [], custom_instructions: "" },
    ...overrides,
  };
}

describe("startPolling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls handler.poll immediately on start", async () => {
    vi.mocked(resolveRepos).mockReturnValue(["test/repo"]);

    const handler: PollHandler = { poll: vi.fn().mockResolvedValue(undefined) };
    const config = makeConfig();

    // Start polling — it will call poll once immediately, then await sleep
    const pollingPromise = startPolling(config, handler);

    // Let microtasks settle (the immediate poll)
    await vi.advanceTimersByTimeAsync(0);

    expect(handler.poll).toHaveBeenCalledTimes(1);
    expect(handler.poll).toHaveBeenCalledWith(["test/repo"]);

    // Don't wait for the promise since it runs forever
  });

  it("calls resolveRepos at startup", async () => {
    vi.mocked(resolveRepos).mockReturnValue(["resolved/repo"]);

    const handler: PollHandler = { poll: vi.fn().mockResolvedValue(undefined) };
    const config = makeConfig();

    startPolling(config, handler);
    await vi.advanceTimersByTimeAsync(0);

    expect(resolveRepos).toHaveBeenCalledWith(config);
    expect(handler.poll).toHaveBeenCalledWith(["resolved/repo"]);
  });

  it("polls again after interval", async () => {
    vi.mocked(resolveRepos).mockReturnValue(["test/repo"]);

    const handler: PollHandler = { poll: vi.fn().mockResolvedValue(undefined) };
    const config = makeConfig({ polling: { interval: 1 } }); // 1 second

    startPolling(config, handler);

    // Initial poll
    await vi.advanceTimersByTimeAsync(0);
    expect(handler.poll).toHaveBeenCalledTimes(1);

    // Advance past interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(handler.poll).toHaveBeenCalledTimes(2);

    // Another interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(handler.poll).toHaveBeenCalledTimes(3);
  });

  it("re-resolves orgs every 10 cycles", async () => {
    vi.mocked(resolveRepos).mockReturnValue(["test/repo"]);

    const handler: PollHandler = { poll: vi.fn().mockResolvedValue(undefined) };
    const config = makeConfig({ orgs: ["my-org"], polling: { interval: 1 } });

    startPolling(config, handler);

    // Initial poll (resolveRepos called once at startup)
    await vi.advanceTimersByTimeAsync(0);
    expect(resolveRepos).toHaveBeenCalledTimes(1);

    // Advance 9 cycles (cycles 1-9) — no re-resolve
    for (let i = 0; i < 9; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(resolveRepos).toHaveBeenCalledTimes(1);

    // Cycle 10 — should re-resolve
    await vi.advanceTimersByTimeAsync(1000);
    expect(resolveRepos).toHaveBeenCalledTimes(2);
  });

  it("continues polling even if handler.poll throws", async () => {
    vi.mocked(resolveRepos).mockReturnValue(["test/repo"]);

    const handler: PollHandler = {
      poll: vi.fn()
        .mockRejectedValueOnce(new Error("oops"))
        .mockResolvedValue(undefined),
    };
    const config = makeConfig({ polling: { interval: 1 } });

    startPolling(config, handler);

    // Initial poll (fails)
    await vi.advanceTimersByTimeAsync(0);
    expect(handler.poll).toHaveBeenCalledTimes(1);

    // Should still poll again
    await vi.advanceTimersByTimeAsync(1000);
    expect(handler.poll).toHaveBeenCalledTimes(2);
  });
});
