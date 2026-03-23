/**
 * Configuration loader — reads YAML config and merges with env/CLI args.
 */
import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";

export interface SentinelConfig {
  repos: string[];
  orgs: string[];
  polling: {
    interval: number; // seconds
  };
  model: string;
  mode: SentinelMode;
  logLevel: "debug" | "info" | "warn" | "error";

  // Mode-specific config
  reviewer: ReviewerConfig;
  labeler: LabelerConfig;
  triage: TriageConfig;
}

export type SentinelMode = "reviewer" | "labeler" | "triage";

export interface ReviewerConfig {
  auto_approve: boolean;
  style: "thorough" | "quick" | "security-focused";
  ignore_drafts: boolean;
  custom_instructions: string;
}

export interface LabelerConfig {
  labels: Record<string, string>; // label -> description for the LLM
  custom_instructions: string;
}

export interface TriageConfig {
  priorities: string[];
  categories: string[];
  custom_instructions: string;
}

const DEFAULTS: SentinelConfig = {
  repos: [],
  orgs: [],
  polling: { interval: 60 },
  model: "claude-sonnet-4-20250514",
  mode: "reviewer",
  logLevel: "info",
  reviewer: {
    auto_approve: false,
    style: "thorough",
    ignore_drafts: true,
    custom_instructions: "",
  },
  labeler: {
    labels: {},
    custom_instructions: "",
  },
  triage: {
    priorities: ["critical", "high", "medium", "low"],
    categories: ["bug", "feature", "question", "docs"],
    custom_instructions: "",
  },
};

export function loadConfig(
  configPath?: string,
  cliMode?: string,
  cliRepos?: string[],
  cliOrgs?: string[],
  env: Record<string, string | undefined> = process.env,
): SentinelConfig {
  const path = configPath ?? env.CONFIG_PATH ?? "./config.yaml";
  let fileConfig: Record<string, unknown> = {};

  if (existsSync(path)) {
    const raw = readFileSync(path, "utf-8");
    fileConfig = parseYaml(raw) ?? {};
  } else if (configPath) {
    throw new Error(`Config file not found: ${path}`);
  }

  // Deep merge defaults with file config
  const config: SentinelConfig = {
    ...DEFAULTS,
    ...fileConfig,
    polling: { ...DEFAULTS.polling, ...(fileConfig.polling as Record<string, unknown> ?? {}) },
    reviewer: { ...DEFAULTS.reviewer, ...(fileConfig.reviewer as Record<string, unknown> ?? {}) },
    labeler: { ...DEFAULTS.labeler, ...(fileConfig.labeler as Record<string, unknown> ?? {}) },
    triage: { ...DEFAULTS.triage, ...(fileConfig.triage as Record<string, unknown> ?? {}) },
  } as SentinelConfig;

  // Ensure orgs is always an array
  if (!Array.isArray(config.orgs)) {
    config.orgs = [];
  }

  // CLI overrides
  if (cliMode) {
    config.mode = cliMode as SentinelMode;
  }
  if (cliRepos && cliRepos.length > 0) {
    config.repos = cliRepos;
  }
  if (cliOrgs && cliOrgs.length > 0) {
    config.orgs = cliOrgs;
  }

  // Env overrides
  if (env.LOG_LEVEL) {
    config.logLevel = env.LOG_LEVEL as SentinelConfig["logLevel"];
  }

  // Validation
  if (!config.repos.length && !config.orgs.length) {
    throw new Error("No repos or orgs configured. Add repos/orgs to config.yaml or pass --repos/--orgs.");
  }

  // Check for LLM credentials based on model provider
  const modelLower = config.model.toLowerCase();
  const isOpenAI = modelLower.startsWith("openai/") || modelLower.startsWith("gpt-") || modelLower.startsWith("o1") || modelLower.startsWith("o3") || modelLower.startsWith("o4");
  if (isOpenAI) {
    if (!env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is required for OpenAI models.");
    }
  } else {
    if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) {
      throw new Error("ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN environment variable is required.");
    }
  }

  if (!env.GITHUB_TOKEN && !env.GH_TOKEN) {
    throw new Error("GITHUB_TOKEN or GH_TOKEN environment variable is required.");
  }

  return config;
}
