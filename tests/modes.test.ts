import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SentinelConfig } from "../src/config.js";

// Mock github and llm modules
vi.mock("../src/github.js", () => ({
  listOpenPRs: vi.fn(),
  listOpenIssues: vi.fn(),
  getPRDiff: vi.fn(),
  submitReview: vi.fn(),
  postComment: vi.fn(),
  addLabels: vi.fn(),
  hasExistingReview: vi.fn(),
  hasAlreadyProcessed: vi.fn(),
  listOrgRepos: vi.fn(),
  ghWithFields: vi.fn(),
  ghRaw: vi.fn(),
  getPRFiles: vi.fn(),
  getFileContent: vi.fn(),
}));

vi.mock("../src/llm.js", () => ({
  ask: vi.fn(),
}));

import {
  listOpenPRs,
  listOpenIssues,
  getPRDiff,
  submitReview,
  postComment,
  addLabels,
  hasExistingReview,
  hasAlreadyProcessed,
} from "../src/github.js";
import { ask } from "../src/llm.js";
import { createReviewer } from "../src/modes/reviewer.js";
import { createLabeler } from "../src/modes/labeler.js";
import { createTriager } from "../src/modes/triage.js";
import { getHandler } from "../src/modes/index.js";

function makeConfig(overrides: Partial<SentinelConfig> = {}): SentinelConfig {
  return {
    repos: ["test/repo"],
    orgs: [],
    polling: { interval: 60 },
    model: "test-model",
    mode: "reviewer",
    logLevel: "error",
    reviewer: { auto_approve: false, style: "thorough", ignore_drafts: true, custom_instructions: "" },
    labeler: {
      labels: { bug: "Something broken", feature: "New feature" },
      custom_instructions: "",
    },
    triage: {
      priorities: ["critical", "high", "medium", "low"],
      categories: ["bug", "feature", "question"],
      custom_instructions: "",
    },
    ...overrides,
  };
}

describe("getHandler", () => {
  it("returns reviewer handler", () => {
    const handler = getHandler(makeConfig({ mode: "reviewer" }));
    expect(handler).toHaveProperty("poll");
  });

  it("returns labeler handler", () => {
    const handler = getHandler(makeConfig({ mode: "labeler" }));
    expect(handler).toHaveProperty("poll");
  });

  it("returns triage handler", () => {
    const handler = getHandler(makeConfig({ mode: "triage" }));
    expect(handler).toHaveProperty("poll");
  });

  it("throws for unknown mode", () => {
    expect(() => getHandler(makeConfig({ mode: "bogus" as any })))
      .toThrow("Unknown mode: bogus");
  });
});

describe("reviewer mode", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reviews open PRs that haven't been reviewed", async () => {
    vi.mocked(listOpenPRs).mockReturnValue([{
      number: 1,
      title: "Add feature X",
      body: "This adds feature X",
      author: "testuser",
      state: "OPEN",
      isDraft: false,
      url: "https://github.com/test/repo/pull/1",
      headRef: "feature-x",
      baseRef: "main",
      repo: "test/repo",
      updatedAt: "2025-01-01T00:00:00Z",
      labels: [],
    }]);
    vi.mocked(hasExistingReview).mockReturnValue(false);
    vi.mocked(getPRDiff).mockReturnValue("diff --git a/file.ts\n+console.log('hello')");
    vi.mocked(ask).mockResolvedValue({
      text: "Looks good!\n\nVERDICT: APPROVE",
      inputTokens: 100,
      outputTokens: 50,
    });

    const handler = createReviewer(makeConfig());
    await handler.poll(["test/repo"]);

    expect(listOpenPRs).toHaveBeenCalledWith("test/repo");
    expect(getPRDiff).toHaveBeenCalledWith("test/repo", 1);
    expect(ask).toHaveBeenCalledOnce();
    expect(submitReview).toHaveBeenCalledWith(
      "test/repo", 1,
      expect.stringContaining("Looks good!"),
      "COMMENT", // auto_approve is false, so APPROVE becomes COMMENT
    );
  });

  it("skips draft PRs when ignore_drafts is true", async () => {
    vi.mocked(listOpenPRs).mockReturnValue([{
      number: 1,
      title: "WIP",
      body: "",
      author: "testuser",
      state: "OPEN",
      isDraft: true,
      url: "https://github.com/test/repo/pull/1",
      headRef: "wip",
      baseRef: "main",
      repo: "test/repo",
      updatedAt: "2025-01-01T00:00:00Z",
      labels: [],
    }]);

    const handler = createReviewer(makeConfig());
    await handler.poll(["test/repo"]);

    expect(ask).not.toHaveBeenCalled();
    expect(submitReview).not.toHaveBeenCalled();
  });

  it("skips already-reviewed PRs", async () => {
    vi.mocked(listOpenPRs).mockReturnValue([{
      number: 1,
      title: "Already reviewed",
      body: "",
      author: "testuser",
      state: "OPEN",
      isDraft: false,
      url: "https://github.com/test/repo/pull/1",
      headRef: "reviewed",
      baseRef: "main",
      repo: "test/repo",
      updatedAt: "2025-01-01T00:00:00Z",
      labels: [],
    }]);
    vi.mocked(hasExistingReview).mockReturnValue(true);

    const handler = createReviewer(makeConfig());
    await handler.poll(["test/repo"]);

    expect(ask).not.toHaveBeenCalled();
  });

  it("posts REQUEST_CHANGES when LLM says so", async () => {
    vi.mocked(listOpenPRs).mockReturnValue([{
      number: 2,
      title: "Bad PR",
      body: "",
      author: "testuser",
      state: "OPEN",
      isDraft: false,
      url: "https://github.com/test/repo/pull/2",
      headRef: "bad",
      baseRef: "main",
      repo: "test/repo",
      updatedAt: "2025-01-01T00:00:00Z",
      labels: [],
    }]);
    vi.mocked(hasExistingReview).mockReturnValue(false);
    vi.mocked(getPRDiff).mockReturnValue("diff");
    vi.mocked(ask).mockResolvedValue({
      text: "This has bugs.\n\nVERDICT: REQUEST_CHANGES",
      inputTokens: 100,
      outputTokens: 50,
    });

    const handler = createReviewer(makeConfig());
    await handler.poll(["test/repo"]);

    expect(submitReview).toHaveBeenCalledWith(
      "test/repo", 2,
      expect.any(String),
      "REQUEST_CHANGES",
    );
  });

  it("actually approves when auto_approve is true", async () => {
    vi.mocked(listOpenPRs).mockReturnValue([{
      number: 3,
      title: "Good PR",
      body: "",
      author: "testuser",
      state: "OPEN",
      isDraft: false,
      url: "https://github.com/test/repo/pull/3",
      headRef: "good",
      baseRef: "main",
      repo: "test/repo",
      updatedAt: "2025-01-01T00:00:00Z",
      labels: [],
    }]);
    vi.mocked(hasExistingReview).mockReturnValue(false);
    vi.mocked(getPRDiff).mockReturnValue("diff");
    vi.mocked(ask).mockResolvedValue({
      text: "LGTM!\n\nVERDICT: APPROVE",
      inputTokens: 100,
      outputTokens: 50,
    });

    const config = makeConfig();
    config.reviewer.auto_approve = true;
    const handler = createReviewer(config);
    await handler.poll(["test/repo"]);

    expect(submitReview).toHaveBeenCalledWith(
      "test/repo", 3,
      expect.any(String),
      "APPROVE",
    );
  });

  it("polls multiple repos", async () => {
    vi.mocked(listOpenPRs).mockReturnValue([]);

    const handler = createReviewer(makeConfig());
    await handler.poll(["org/repo1", "org/repo2", "org/repo3"]);

    expect(listOpenPRs).toHaveBeenCalledTimes(3);
    expect(listOpenPRs).toHaveBeenCalledWith("org/repo1");
    expect(listOpenPRs).toHaveBeenCalledWith("org/repo2");
    expect(listOpenPRs).toHaveBeenCalledWith("org/repo3");
  });

  it("continues processing other repos if one fails", async () => {
    vi.mocked(listOpenPRs)
      .mockImplementationOnce(() => { throw new Error("network error"); })
      .mockReturnValueOnce([]);

    const handler = createReviewer(makeConfig());
    await handler.poll(["bad/repo", "good/repo"]);
    expect(listOpenPRs).toHaveBeenCalledTimes(2);
  });
});

describe("labeler mode", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("labels unlabeled issues", async () => {
    vi.mocked(listOpenIssues).mockReturnValue([{
      number: 10,
      title: "App crashes on startup",
      body: "Stack trace here",
      author: "reporter",
      state: "OPEN",
      url: "https://github.com/test/repo/issues/10",
      repo: "test/repo",
      labels: [],
      createdAt: "2025-01-01T00:00:00Z",
    }]);
    vi.mocked(listOpenPRs).mockReturnValue([]);
    vi.mocked(hasAlreadyProcessed).mockReturnValue(false);
    vi.mocked(ask).mockResolvedValue({
      text: '["bug"]',
      inputTokens: 50,
      outputTokens: 10,
    });

    const handler = createLabeler(makeConfig());
    await handler.poll(["test/repo"]);

    expect(ask).toHaveBeenCalledOnce();
    expect(addLabels).toHaveBeenCalledWith("test/repo", 10, ["bug"]);
  });

  it("skips issues that already have labels", async () => {
    vi.mocked(listOpenIssues).mockReturnValue([{
      number: 10,
      title: "Already labeled",
      body: "",
      author: "reporter",
      state: "OPEN",
      url: "https://github.com/test/repo/issues/10",
      repo: "test/repo",
      labels: ["bug"],
      createdAt: "2025-01-01T00:00:00Z",
    }]);
    vi.mocked(listOpenPRs).mockReturnValue([]);

    const handler = createLabeler(makeConfig());
    await handler.poll(["test/repo"]);

    expect(ask).not.toHaveBeenCalled();
    expect(addLabels).not.toHaveBeenCalled();
  });

  it("skips already-processed issues", async () => {
    vi.mocked(listOpenIssues).mockReturnValue([{
      number: 10,
      title: "Processed before",
      body: "",
      author: "reporter",
      state: "OPEN",
      url: "https://github.com/test/repo/issues/10",
      repo: "test/repo",
      labels: [],
      createdAt: "2025-01-01T00:00:00Z",
    }]);
    vi.mocked(listOpenPRs).mockReturnValue([]);
    vi.mocked(hasAlreadyProcessed).mockReturnValue(true);

    const handler = createLabeler(makeConfig());
    await handler.poll(["test/repo"]);

    expect(ask).not.toHaveBeenCalled();
  });

  it("handles LLM returning empty array", async () => {
    vi.mocked(listOpenIssues).mockReturnValue([{
      number: 10,
      title: "Uncategorizable",
      body: "",
      author: "reporter",
      state: "OPEN",
      url: "https://github.com/test/repo/issues/10",
      repo: "test/repo",
      labels: [],
      createdAt: "2025-01-01T00:00:00Z",
    }]);
    vi.mocked(listOpenPRs).mockReturnValue([]);
    vi.mocked(hasAlreadyProcessed).mockReturnValue(false);
    vi.mocked(ask).mockResolvedValue({
      text: "[]",
      inputTokens: 50,
      outputTokens: 5,
    });

    const handler = createLabeler(makeConfig());
    await handler.poll(["test/repo"]);

    expect(addLabels).not.toHaveBeenCalled();
  });

  it("handles malformed LLM response gracefully", async () => {
    vi.mocked(listOpenIssues).mockReturnValue([{
      number: 10,
      title: "Test",
      body: "",
      author: "reporter",
      state: "OPEN",
      url: "https://github.com/test/repo/issues/10",
      repo: "test/repo",
      labels: [],
      createdAt: "2025-01-01T00:00:00Z",
    }]);
    vi.mocked(listOpenPRs).mockReturnValue([]);
    vi.mocked(hasAlreadyProcessed).mockReturnValue(false);
    vi.mocked(ask).mockResolvedValue({
      text: "I think this is a bug",
      inputTokens: 50,
      outputTokens: 10,
    });

    const handler = createLabeler(makeConfig());
    // Should not throw
    await handler.poll(["test/repo"]);
    expect(addLabels).not.toHaveBeenCalled();
  });

  it("also labels unlabeled PRs", async () => {
    vi.mocked(listOpenIssues).mockReturnValue([]);
    vi.mocked(listOpenPRs).mockReturnValue([{
      number: 5,
      title: "Add docs",
      body: "Documentation update",
      author: "dev",
      state: "OPEN",
      isDraft: false,
      url: "https://github.com/test/repo/pull/5",
      headRef: "docs",
      baseRef: "main",
      repo: "test/repo",
      updatedAt: "2025-01-01T00:00:00Z",
      labels: [],
    }]);
    vi.mocked(hasAlreadyProcessed).mockReturnValue(false);
    vi.mocked(ask).mockResolvedValue({
      text: '["documentation"]',
      inputTokens: 50,
      outputTokens: 10,
    });

    const handler = createLabeler(makeConfig());
    await handler.poll(["test/repo"]);

    expect(addLabels).toHaveBeenCalledWith("test/repo", 5, ["documentation"]);
  });
});

describe("triage mode", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("triages new issues with comment and labels", async () => {
    vi.mocked(listOpenIssues).mockReturnValue([{
      number: 20,
      title: "Login broken",
      body: "Can't login since yesterday",
      author: "user",
      state: "OPEN",
      url: "https://github.com/test/repo/issues/20",
      repo: "test/repo",
      labels: [],
      createdAt: "2025-01-01T00:00:00Z",
    }]);
    vi.mocked(hasAlreadyProcessed).mockReturnValue(false);
    vi.mocked(ask).mockResolvedValue({
      text: JSON.stringify({
        category: "bug",
        priority: "high",
        summary: "Login is broken",
        labels: ["bug", "priority:high"],
        comment: "This seems like a critical auth issue. Can you share browser console errors?",
      }),
      inputTokens: 100,
      outputTokens: 80,
    });

    const handler = createTriager(makeConfig());
    await handler.poll(["test/repo"]);

    expect(postComment).toHaveBeenCalledWith(
      "test/repo", 20,
      expect.stringContaining("critical auth issue"),
    );
    expect(addLabels).toHaveBeenCalledWith("test/repo", 20, ["bug", "priority:high"]);
  });

  it("skips already-triaged issues", async () => {
    vi.mocked(listOpenIssues).mockReturnValue([{
      number: 20,
      title: "Already triaged",
      body: "",
      author: "user",
      state: "OPEN",
      url: "https://github.com/test/repo/issues/20",
      repo: "test/repo",
      labels: [],
      createdAt: "2025-01-01T00:00:00Z",
    }]);
    vi.mocked(hasAlreadyProcessed).mockReturnValue(true);

    const handler = createTriager(makeConfig());
    await handler.poll(["test/repo"]);

    expect(ask).not.toHaveBeenCalled();
    expect(postComment).not.toHaveBeenCalled();
  });

  it("handles LLM response wrapped in code block", async () => {
    vi.mocked(listOpenIssues).mockReturnValue([{
      number: 21,
      title: "Feature request",
      body: "Would be nice to have X",
      author: "user",
      state: "OPEN",
      url: "https://github.com/test/repo/issues/21",
      repo: "test/repo",
      labels: [],
      createdAt: "2025-01-01T00:00:00Z",
    }]);
    vi.mocked(hasAlreadyProcessed).mockReturnValue(false);
    vi.mocked(ask).mockResolvedValue({
      text: '```json\n{"category":"feature","priority":"medium","summary":"Feature X","labels":["feature"],"comment":"Noted."}\n```',
      inputTokens: 100,
      outputTokens: 50,
    });

    const handler = createTriager(makeConfig());
    await handler.poll(["test/repo"]);

    expect(postComment).toHaveBeenCalledWith(
      "test/repo", 21,
      expect.stringContaining("Noted."),
    );
    expect(addLabels).toHaveBeenCalledWith("test/repo", 21, ["feature"]);
  });

  it("handles malformed triage response gracefully", async () => {
    vi.mocked(listOpenIssues).mockReturnValue([{
      number: 22,
      title: "Confusing issue",
      body: "",
      author: "user",
      state: "OPEN",
      url: "https://github.com/test/repo/issues/22",
      repo: "test/repo",
      labels: [],
      createdAt: "2025-01-01T00:00:00Z",
    }]);
    vi.mocked(hasAlreadyProcessed).mockReturnValue(false);
    vi.mocked(ask).mockResolvedValue({
      text: "I'm not sure how to categorize this",
      inputTokens: 50,
      outputTokens: 20,
    });

    const handler = createTriager(makeConfig());
    // Should not throw
    await handler.poll(["test/repo"]);
    expect(postComment).not.toHaveBeenCalled();
  });

  it("posts comment even if label addition fails", async () => {
    vi.mocked(listOpenIssues).mockReturnValue([{
      number: 23,
      title: "Bug",
      body: "Broken",
      author: "user",
      state: "OPEN",
      url: "https://github.com/test/repo/issues/23",
      repo: "test/repo",
      labels: [],
      createdAt: "2025-01-01T00:00:00Z",
    }]);
    vi.mocked(hasAlreadyProcessed).mockReturnValue(false);
    vi.mocked(ask).mockResolvedValue({
      text: JSON.stringify({
        category: "bug",
        priority: "low",
        summary: "A bug",
        labels: ["nonexistent-label"],
        comment: "Triaged.",
      }),
      inputTokens: 50,
      outputTokens: 30,
    });
    vi.mocked(addLabels).mockImplementation(() => {
      throw new Error("Label not found");
    });

    const handler = createTriager(makeConfig());
    // Should not throw
    await handler.poll(["test/repo"]);
    // Comment should still be posted even if labels fail (comment is posted first in the code)
    expect(postComment).toHaveBeenCalled();
  });
});
