/**
 * Configuration loader — reads YAML config and merges with env/CLI args.
 */
import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";

export interface SentinelConfig {
  repos: string[];
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

export function loadConfig(configPath?: string, cliMode?: string): SentinelConfig {
  const path = configPath ?? process.env.CONFIG_PATH ?? "./config.yaml";
  let fileConfig: Record<string, unknown> = {};

  if (existsSync(path)) {
    const raw = readFileSync(path, "utf-8");
    fileConfig = parseYaml(raw) ?? {};
  } else if (configPath) {
    // Explicitly specified path that doesn't exist — error
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

  // CLI overrides
  if (cliMode) {
    config.mode = cliMode as SentinelMode;
  }

  // Env overrides
  if (process.env.LOG_LEVEL) {
    config.logLevel = process.env.LOG_LEVEL as SentinelConfig["logLevel"];
  }

  // Validation
  if (!config.repos.length) {
    throw new Error("No repos configured. Add repos to config.yaml or pass --repos.");
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required.");
  }

  if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
    throw new Error("GITHUB_TOKEN or GH_TOKEN environment variable is required.");
  }

  return config;
}
