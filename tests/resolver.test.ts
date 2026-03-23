import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveRepos } from "../src/resolver.js";
import type { SentinelConfig } from "../src/config.js";

// Mock the github module
vi.mock("../src/github.js", () => ({
  listOrgRepos: vi.fn(),
}));

import { listOrgRepos } from "../src/github.js";

function makeConfig(overrides: Partial<SentinelConfig> = {}): SentinelConfig {
  return {
    repos: [],
    orgs: [],
    polling: { interval: 60 },
    model: "test-model",
    mode: "reviewer",
    logLevel: "error",
    reviewer: { auto_approve: false, style: "thorough", ignore_drafts: true, custom_instructions: "" },
    labeler: { labels: {}, custom_instructions: "" },
    triage: { priorities: [], categories: [], custom_instructions: "" },
    ...overrides,
  };
}

describe("resolveRepos", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns explicit repos when no orgs", () => {
    const config = makeConfig({ repos: ["org/repo1", "org/repo2"] });
    const repos = resolveRepos(config);
    expect(repos).toEqual(["org/repo1", "org/repo2"]);
  });

  it("expands orgs into repos", () => {
    vi.mocked(listOrgRepos).mockReturnValue(["my-org/repo-a", "my-org/repo-b"]);
    const config = makeConfig({ orgs: ["my-org"] });
    const repos = resolveRepos(config);
    expect(listOrgRepos).toHaveBeenCalledWith("my-org");
    expect(repos).toEqual(["my-org/repo-a", "my-org/repo-b"]);
  });

  it("merges explicit repos with org repos", () => {
    vi.mocked(listOrgRepos).mockReturnValue(["my-org/repo-a", "my-org/repo-b"]);
    const config = makeConfig({
      repos: ["other/repo-x"],
      orgs: ["my-org"],
    });
    const repos = resolveRepos(config);
    expect(repos).toEqual(["my-org/repo-a", "my-org/repo-b", "other/repo-x"]);
  });

  it("deduplicates repos that appear in both explicit and org", () => {
    vi.mocked(listOrgRepos).mockReturnValue(["my-org/repo-a", "my-org/repo-b"]);
    const config = makeConfig({
      repos: ["my-org/repo-a"],
      orgs: ["my-org"],
    });
    const repos = resolveRepos(config);
    expect(repos).toEqual(["my-org/repo-a", "my-org/repo-b"]);
  });

  it("handles multiple orgs", () => {
    vi.mocked(listOrgRepos).mockImplementation((org: string) => {
      if (org === "org-a") return ["org-a/repo1"];
      if (org === "org-b") return ["org-b/repo2", "org-b/repo3"];
      return [];
    });
    const config = makeConfig({ orgs: ["org-a", "org-b"] });
    const repos = resolveRepos(config);
    expect(repos).toEqual(["org-a/repo1", "org-b/repo2", "org-b/repo3"]);
  });

  it("handles org resolution failure gracefully", () => {
    vi.mocked(listOrgRepos).mockImplementation(() => {
      throw new Error("Not found");
    });
    const config = makeConfig({ repos: ["fallback/repo"], orgs: ["bad-org"] });
    const repos = resolveRepos(config);
    // Should still return the explicit repo
    expect(repos).toEqual(["fallback/repo"]);
  });

  it("returns sorted repos", () => {
    vi.mocked(listOrgRepos).mockReturnValue(["z-org/zzz", "a-org/aaa"]);
    const config = makeConfig({ repos: ["m-org/mmm"], orgs: ["mixed"] });
    const repos = resolveRepos(config);
    expect(repos).toEqual(["a-org/aaa", "m-org/mmm", "z-org/zzz"]);
  });

  it("returns empty array when no repos and org is empty", () => {
    vi.mocked(listOrgRepos).mockReturnValue([]);
    const config = makeConfig({ orgs: ["empty-org"] });
    const repos = resolveRepos(config);
    expect(repos).toEqual([]);
  });
});
