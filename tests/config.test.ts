import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadConfig } from "../src/config.js";
import * as fs from "fs";

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

const REQUIRED_ENV = {
  ANTHROPIC_API_KEY: "sk-ant-test",
  GITHUB_TOKEN: "ghp_test",
};

describe("loadConfig", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns defaults when no config file and CLI provides repos", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config = loadConfig(undefined, "reviewer", ["owner/repo"], undefined, REQUIRED_ENV);
    expect(config.mode).toBe("reviewer");
    expect(config.repos).toEqual(["owner/repo"]);
    expect(config.orgs).toEqual([]);
    expect(config.polling.interval).toBe(60);
    expect(config.model).toBe("claude-sonnet-4-20250514");
  });

  it("loads and merges YAML config", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
repos:
  - org/repo1
  - org/repo2
orgs:
  - my-org
polling:
  interval: 120
model: claude-haiku-20250101
reviewer:
  style: quick
`);
    const config = loadConfig("config.yaml", undefined, undefined, undefined, REQUIRED_ENV);
    expect(config.repos).toEqual(["org/repo1", "org/repo2"]);
    expect(config.orgs).toEqual(["my-org"]);
    expect(config.polling.interval).toBe(120);
    expect(config.model).toBe("claude-haiku-20250101");
    expect(config.reviewer.style).toBe("quick");
    // Defaults preserved for un-set values
    expect(config.reviewer.ignore_drafts).toBe(true);
    expect(config.reviewer.auto_approve).toBe(false);
  });

  it("CLI mode overrides config file mode", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
repos: [org/repo]
mode: labeler
`);
    const config = loadConfig("config.yaml", "triage", undefined, undefined, REQUIRED_ENV);
    expect(config.mode).toBe("triage");
  });

  it("CLI repos override config file repos", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
repos: [org/old-repo]
`);
    const config = loadConfig("config.yaml", "reviewer", ["org/new-repo"], undefined, REQUIRED_ENV);
    expect(config.repos).toEqual(["org/new-repo"]);
  });

  it("CLI orgs override config file orgs", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`
repos: [org/repo]
orgs: [old-org]
`);
    const config = loadConfig("config.yaml", "reviewer", undefined, ["new-org"], REQUIRED_ENV);
    expect(config.orgs).toEqual(["new-org"]);
  });

  it("accepts orgs without repos", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config = loadConfig(undefined, "reviewer", undefined, ["my-org"], REQUIRED_ENV);
    expect(config.repos).toEqual([]);
    expect(config.orgs).toEqual(["my-org"]);
  });

  it("throws if no repos and no orgs", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(() => loadConfig(undefined, "reviewer", undefined, undefined, REQUIRED_ENV))
      .toThrow("No repos or orgs configured");
  });

  it("throws if ANTHROPIC_API_KEY is missing", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(() => loadConfig(undefined, "reviewer", ["org/repo"], undefined, { GITHUB_TOKEN: "ghp_test" }))
      .toThrow("ANTHROPIC_API_KEY");
  });

  it("throws if GITHUB_TOKEN is missing", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(() => loadConfig(undefined, "reviewer", ["org/repo"], undefined, { ANTHROPIC_API_KEY: "sk-ant-test" }))
      .toThrow("GITHUB_TOKEN or GH_TOKEN");
  });

  it("accepts GH_TOKEN as alternative to GITHUB_TOKEN", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config = loadConfig(undefined, "reviewer", ["org/repo"], undefined, {
      ANTHROPIC_API_KEY: "sk-ant-test",
      GH_TOKEN: "ghp_test",
    });
    expect(config.repos).toEqual(["org/repo"]);
  });

  it("throws if explicit config path doesn't exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(() => loadConfig("/nonexistent/config.yaml", "reviewer", ["org/repo"], undefined, REQUIRED_ENV))
      .toThrow("Config file not found");
  });

  it("env LOG_LEVEL overrides config", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config = loadConfig(undefined, "reviewer", ["org/repo"], undefined, {
      ...REQUIRED_ENV,
      LOG_LEVEL: "debug",
    });
    expect(config.logLevel).toBe("debug");
  });

  it("preserves labeler and triage defaults", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config = loadConfig(undefined, "labeler", ["org/repo"], undefined, REQUIRED_ENV);
    expect(config.labeler.labels).toEqual({});
    expect(config.triage.priorities).toEqual(["critical", "high", "medium", "low"]);
    expect(config.triage.categories).toEqual(["bug", "feature", "question", "docs"]);
  });
});
