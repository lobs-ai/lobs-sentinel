/**
 * Triage mode — categorizes new issues, assigns priority, asks clarifying questions.
 */
import type { PollHandler } from "../poller.js";
import type { SentinelConfig } from "../config.js";
import { listOpenIssues, postComment, addLabels, hasAlreadyProcessed } from "../github.js";
import { ask } from "../llm.js";
import { log } from "../log.js";

const SENTINEL_MARKER = "<!-- lobs-sentinel:triage -->";

const triaged = new Set<string>();

export function createTriager(config: SentinelConfig): PollHandler {
  const tc = config.triage;

  return {
    async poll(repos: string[]): Promise<void> {
      for (const repo of repos) {
        try {
          await triageRepo(repo, tc, config.model);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error(`Failed to triage ${repo}: ${msg}`);
        }
      }
    },
  };
}

async function triageRepo(
  repo: string,
  tc: SentinelConfig["triage"],
  model: string,
): Promise<void> {
  const issues = listOpenIssues(repo);

  for (const issue of issues) {
    const key = `${repo}#${issue.number}`;
    if (triaged.has(key)) continue;
    if (hasAlreadyProcessed(repo, issue.number, SENTINEL_MARKER)) {
      triaged.add(key);
      continue;
    }

    log.info(`Triaging issue ${key}: "${issue.title}"`);
    await triageIssue(repo, issue.number, issue.title, issue.body, tc, model);
    triaged.add(key);
  }
}

async function triageIssue(
  repo: string,
  number: number,
  title: string,
  body: string,
  tc: SentinelConfig["triage"],
  model: string,
): Promise<void> {
  const system = `You are an issue triage assistant. Your job is to:
1. Categorize the issue into one of: ${tc.categories.join(", ")}
2. Assign a priority: ${tc.priorities.join(", ")}
3. If the issue is unclear or missing information, ask specific clarifying questions
4. Provide a brief summary of what you think the issue is about

${tc.custom_instructions || ""}

Respond in this exact JSON format:
{
  "category": "bug",
  "priority": "medium",
  "summary": "Brief description of the issue",
  "labels": ["bug", "priority:medium"],
  "comment": "Your triage comment in markdown. Include clarifying questions if needed. Be helpful and concise."
}`;

  const prompt = `## Issue: ${title}\n\n${body || "(no description provided)"}`;

  const response = await ask({ model, system, prompt, maxTokens: 1024 });

  try {
    // Extract JSON from response (might be wrapped in ```json blocks)
    let jsonStr = response.text.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const result = JSON.parse(jsonStr) as {
      category: string;
      priority: string;
      summary: string;
      labels: string[];
      comment: string;
    };

    // Post triage comment
    if (result.comment) {
      const commentBody = `${result.comment}\n\n---\n*Priority: **${result.priority}** | Category: **${result.category}***\n\n${SENTINEL_MARKER}`;
      postComment(repo, number, commentBody);
    }

    // Add labels
    if (result.labels && result.labels.length > 0) {
      try {
        addLabels(repo, number, result.labels);
      } catch {
        log.warn(`Failed to add labels to ${repo}#${number} — labels may not exist in repo`);
      }
    }

    log.info(`Triaged ${repo}#${number}: ${result.category} / ${result.priority}`);
  } catch {
    log.warn(`Failed to parse triage response for ${repo}#${number}: ${response.text}`);
  }
}
