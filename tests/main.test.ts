import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/main.js";

describe("parseArgs", () => {
  it("parses --mode flag", () => {
    const args = parseArgs(["--mode", "reviewer"]);
    expect(args.mode).toBe("reviewer");
  });

  it("parses -m short flag", () => {
    const args = parseArgs(["-m", "labeler"]);
    expect(args.mode).toBe("labeler");
  });

  it("parses --config flag", () => {
    const args = parseArgs(["--config", "/path/to/config.yaml"]);
    expect(args.config).toBe("/path/to/config.yaml");
  });

  it("parses -c short flag", () => {
    const args = parseArgs(["-c", "my-config.yaml"]);
    expect(args.config).toBe("my-config.yaml");
  });

  it("parses --repos as comma-separated list", () => {
    const args = parseArgs(["--repos", "org/repo1,org/repo2"]);
    expect(args.repos).toEqual(["org/repo1", "org/repo2"]);
  });

  it("trims whitespace from repos", () => {
    const args = parseArgs(["--repos", "org/repo1 , org/repo2 "]);
    expect(args.repos).toEqual(["org/repo1", "org/repo2"]);
  });

  it("parses --orgs as comma-separated list", () => {
    const args = parseArgs(["--orgs", "my-org,other-org"]);
    expect(args.orgs).toEqual(["my-org", "other-org"]);
  });

  it("parses -o short flag for orgs", () => {
    const args = parseArgs(["-o", "my-org"]);
    expect(args.orgs).toEqual(["my-org"]);
  });

  it("trims whitespace from orgs", () => {
    const args = parseArgs(["--orgs", " my-org , other-org "]);
    expect(args.orgs).toEqual(["my-org", "other-org"]);
  });

  it("parses all flags together", () => {
    const args = parseArgs([
      "--mode", "triage",
      "--config", "custom.yaml",
      "--repos", "org/repo1",
      "--orgs", "my-org",
    ]);
    expect(args.mode).toBe("triage");
    expect(args.config).toBe("custom.yaml");
    expect(args.repos).toEqual(["org/repo1"]);
    expect(args.orgs).toEqual(["my-org"]);
  });

  it("returns empty object for no args", () => {
    const args = parseArgs([]);
    expect(args.mode).toBeUndefined();
    expect(args.config).toBeUndefined();
    expect(args.repos).toBeUndefined();
    expect(args.orgs).toBeUndefined();
  });

  it("ignores unknown flags", () => {
    const args = parseArgs(["--unknown", "value", "--mode", "reviewer"]);
    expect(args.mode).toBe("reviewer");
  });
});
