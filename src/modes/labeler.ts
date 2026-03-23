/**
 * Labeler mode — auto-labels issues and PRs based on content.
 */
import type { PollHandler } from "../poller.js";
import type { SentinelConfig } from "../config.js";
import { listOpenIssues, listOpenPRs, addLabels, hasAlreadyProcessed } from "../github.js";
import { ask } from "../llm.js";
import { log } from "../log.js";

const SENTINEL_MARKER = "<!-- lobs-sentinel:labeler -->";

// Track items we've already labeled this session
const labeled = new Set<string>();

export function createLabeler(config: SentinelConfig): PollHandler {
  const lc = config.labeler;

  return {
    async poll(repos: string[]): Promise<void> {
      for (const repo of repos) {
        try {
          await labelRepo(repo, lc, config.model);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error(`Failed to label ${repo}: ${msg}`);
        }
      }
    },
  };
}

async function labelRepo(
  repo: string,
  lc: SentinelConfig["labeler"],
  model: string,
): Promise<void> {
  // Process issues
  const issues = listOpenIssues(repo);
  for (const issue of issues) {
    const key = `${repo}#${issue.number}`;
    if (labeled.has(key)) continue;
    if (issue.labels.length > 0) {
      // Already has labels — skip
      labeled.add(key);
      continue;
    }
    if (hasAlreadyProcessed(repo, issue.number, SENTINEL_MARKER)) {
      labeled.add(key);
      continue;
    }

    log.info(`Labeling issue ${key}: "${issue.title}"`);
    await labelItem(repo, issue.number, issue.title, issue.body, "issue", lc, model);
    labeled.add(key);
  }

  // Process PRs
  const prs = listOpenPRs(repo);
  for (const pr of prs) {
    const key = `${repo}#${pr.number}`;
    if (labeled.has(key)) continue;
    if (pr.labels.length > 0) {
      labeled.add(key);
      continue;
    }
    if (hasAlreadyProcessed(repo, pr.number, SENTINEL_MARKER)) {
      labeled.add(key);
      continue;
    }

    log.info(`Labeling PR ${key}: "${pr.title}"`);
    await labelItem(repo, pr.number, pr.title, pr.body, "pull_request", lc, model);
    labeled.add(key);
  }
}

async function labelItem(
  repo: string,
  number: number,
  title: string,
  body: string,
  type: "issue" | "pull_request",
  lc: SentinelConfig["labeler"],
  model: string,
): Promise<void> {
  const availableLabels = Object.entries(lc.labels)
    .map(([name, desc]) => `- ${name}: ${desc}`)
    .join("\n");

  const system = `You are a GitHub issue/PR labeler. Given the title and body of a ${type}, select the most appropriate labels from the available set.

Available labels:
${availableLabels || "(no labels configured — use common labels like bug, feature, documentation, enhancement, good-first-issue)"}

${lc.custom_instructions || ""}

Respond with ONLY a JSON array of label strings. Example: ["bug", "high-priority"]
If no labels apply, respond with an empty array: []`;

  const prompt = `## ${type === "issue" ? "Issue" : "Pull Request"}: ${title}\n\n${body || "(no description)"}`;

  const response = await ask({ model, system, prompt, maxTokens: 256 });

  try {
    const labels = JSON.parse(response.text.trim()) as string[];
    if (Array.isArray(labels) && labels.length > 0) {
      addLabels(repo, number, labels);
      log.info(`Labeled ${repo}#${number} with [${labels.join(", ")}]`);
    } else {
      log.debug(`No labels selected for ${repo}#${number}`);
    }
  } catch {
    log.warn(`Failed to parse label response for ${repo}#${number}: ${response.text}`);
  }
}
