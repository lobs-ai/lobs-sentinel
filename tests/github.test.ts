import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "child_process";

// Mock child_process
vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

// Must import AFTER mock setup
import {
  listOpenPRs,
  listOpenIssues,
  getPRDiff,
  submitReview,
  postComment,
  addLabels,
  hasExistingReview,
  hasAlreadyProcessed,
  listOrgRepos,
} from "../src/github.js";

describe("listOpenPRs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("parses gh output into PR objects", () => {
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify([
      {
        number: 1,
        title: "Add feature",
        body: "Description",
        author: { login: "dev" },
        state: "OPEN",
        isDraft: false,
        url: "https://github.com/test/repo/pull/1",
        headRefName: "feature",
        baseRefName: "main",
        updatedAt: "2025-01-01T00:00:00Z",
        labels: [{ name: "enhancement" }],
      },
    ]));

    const prs = listOpenPRs("test/repo");
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({
      number: 1,
      title: "Add feature",
      author: "dev",
      isDraft: false,
      repo: "test/repo",
      headRef: "feature",
      baseRef: "main",
      labels: ["enhancement"],
    });
  });

  it("returns empty array when no PRs", () => {
    vi.mocked(execFileSync).mockReturnValue("[]");
    const prs = listOpenPRs("test/repo");
    expect(prs).toEqual([]);
  });

  it("throws on gh CLI error", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("gh: not found");
    });
    expect(() => listOpenPRs("test/repo")).toThrow();
  });
});

describe("listOpenIssues", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("parses gh output into issue objects", () => {
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify([
      {
        number: 10,
        title: "Bug report",
        body: "Steps to reproduce...",
        author: { login: "reporter" },
        state: "OPEN",
        url: "https://github.com/test/repo/issues/10",
        labels: [],
        createdAt: "2025-01-01T00:00:00Z",
      },
    ]));

    const issues = listOpenIssues("test/repo");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      number: 10,
      title: "Bug report",
      author: "reporter",
      repo: "test/repo",
    });
  });
});

describe("getPRDiff", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns diff string", () => {
    vi.mocked(execFileSync).mockReturnValue("diff --git a/file.ts\n+added line");
    const diff = getPRDiff("test/repo", 1);
    expect(diff).toContain("+added line");
  });
});

describe("submitReview", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calls gh pr review with correct args for APPROVE", () => {
    vi.mocked(execFileSync).mockReturnValue("");
    submitReview("test/repo", 1, "LGTM", "APPROVE");
    expect(execFileSync).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["pr", "review", "1", "--approve"]),
      expect.any(Object),
    );
  });

  it("calls gh pr review with --request-changes", () => {
    vi.mocked(execFileSync).mockReturnValue("");
    submitReview("test/repo", 2, "Fix bugs", "REQUEST_CHANGES");
    expect(execFileSync).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["--request-changes"]),
      expect.any(Object),
    );
  });

  it("calls gh pr review with --comment by default", () => {
    vi.mocked(execFileSync).mockReturnValue("");
    submitReview("test/repo", 3, "Comments", "COMMENT");
    expect(execFileSync).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["--comment"]),
      expect.any(Object),
    );
  });
});

describe("postComment", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calls gh pr comment", () => {
    vi.mocked(execFileSync).mockReturnValue("");
    postComment("test/repo", 10, "Hello world");
    expect(execFileSync).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["pr", "comment", "10", "--body", "Hello world"]),
      expect.any(Object),
    );
  });
});

describe("addLabels", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calls gh issue edit with labels", () => {
    vi.mocked(execFileSync).mockReturnValue("");
    addLabels("test/repo", 10, ["bug", "priority:high"]);
    expect(execFileSync).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["issue", "edit", "10", "--add-label", "bug,priority:high"]),
      expect.any(Object),
    );
  });
});

describe("hasExistingReview", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns true when sentinel marker found in review bodies", () => {
    vi.mocked(execFileSync).mockReturnValue(
      "Nice code\n\n<!-- lobs-sentinel:reviewer -->\nRegular review",
    );
    const result = hasExistingReview("test/repo", 1, "<!-- lobs-sentinel:reviewer -->");
    expect(result).toBe(true);
  });

  it("returns false when no sentinel marker", () => {
    vi.mocked(execFileSync).mockReturnValue("Regular review");
    const result = hasExistingReview("test/repo", 1, "<!-- lobs-sentinel:reviewer -->");
    expect(result).toBe(false);
  });

  it("returns false on API error", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("API error");
    });
    const result = hasExistingReview("test/repo", 1, "<!-- lobs-sentinel:reviewer -->");
    expect(result).toBe(false);
  });
});

describe("hasAlreadyProcessed", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns true when sentinel marker in comments", () => {
    vi.mocked(execFileSync).mockReturnValue(
      "Triaged!\n\n<!-- lobs-sentinel:triage -->",
    );
    const result = hasAlreadyProcessed("test/repo", 10, "<!-- lobs-sentinel:triage -->");
    expect(result).toBe(true);
  });

  it("returns false when no sentinel marker", () => {
    vi.mocked(execFileSync).mockReturnValue("Just a regular comment");
    const result = hasAlreadyProcessed("test/repo", 10, "<!-- lobs-sentinel:triage -->");
    expect(result).toBe(false);
  });

  it("returns false on API error", () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("Not found");
    });
    const result = hasAlreadyProcessed("test/repo", 10, "<!-- lobs-sentinel:triage -->");
    expect(result).toBe(false);
  });
});

describe("listOrgRepos", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns list of org repos", () => {
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify([
      { nameWithOwner: "my-org/repo-a", isArchived: false },
      { nameWithOwner: "my-org/repo-b", isArchived: false },
    ]));
    const repos = listOrgRepos("my-org");
    expect(repos).toEqual(["my-org/repo-a", "my-org/repo-b"]);
  });

  it("filters out archived repos", () => {
    vi.mocked(execFileSync).mockReturnValue(JSON.stringify([
      { nameWithOwner: "my-org/active", isArchived: false },
      { nameWithOwner: "my-org/archived", isArchived: true },
    ]));
    const repos = listOrgRepos("my-org");
    expect(repos).toEqual(["my-org/active"]);
  });

  it("returns empty array for empty org", () => {
    vi.mocked(execFileSync).mockReturnValue("[]");
    const repos = listOrgRepos("empty-org");
    expect(repos).toEqual([]);
  });
});
