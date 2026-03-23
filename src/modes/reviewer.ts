/**
 * PR Reviewer mode — reviews open pull requests.
 *
 * For each open PR that hasn't been reviewed yet:
 * 1. Fetch the diff
 * 2. Send to LLM with review instructions
 * 3. Post the review as a GitHub review (comment/approve/request changes)
 */
import type { PollHandler } from "../poller.js";
import type { SentinelConfig, ReviewerConfig } from "../config.js";
import { listOpenPRs, getPRDiff, submitReview, hasExistingReview, type PullRequest } from "../github.js";
import { ask } from "../llm.js";
import { log } from "../log.js";

const SENTINEL_MARKER = "<!-- lobs-sentinel:reviewer -->";

// Track PRs we've already reviewed this session (updatedAt -> avoid re-reviewing)
const reviewed = new Map<string, string>(); // "repo#number" -> updatedAt

export function createReviewer(config: SentinelConfig): PollHandler {
  const rc = config.reviewer;

  return {
    async poll(repos: string[]): Promise<void> {
      for (const repo of repos) {
        try {
          await reviewRepo(repo, rc, config.model);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error(`Failed to review ${repo}: ${msg}`);
        }
      }
    },
  };
}

async function reviewRepo(repo: string, rc: ReviewerConfig, model: string): Promise<void> {
  const prs = listOpenPRs(repo);
  log.debug(`${repo}: ${prs.length} open PR(s)`);

  for (const pr of prs) {
    if (rc.ignore_drafts && pr.isDraft) {
      log.debug(`Skipping draft PR ${repo}#${pr.number}`);
      continue;
    }

    const key = `${repo}#${pr.number}`;

    // Skip if we reviewed this version already (same updatedAt)
    if (reviewed.get(key) === pr.updatedAt) {
      continue;
    }

    // Skip if we already have a sentinel review on GitHub
    if (hasExistingReview(repo, pr.number, SENTINEL_MARKER)) {
      reviewed.set(key, pr.updatedAt);
      log.debug(`Already reviewed ${key}, skipping`);
      continue;
    }

    log.info(`Reviewing ${key}: "${pr.title}"`);
    await reviewPR(repo, pr, rc, model);
    reviewed.set(key, pr.updatedAt);
  }
}

async function reviewPR(repo: string, pr: PullRequest, rc: ReviewerConfig, model: string): Promise<void> {
  // Get the diff
  let diff: string;
  try {
    diff = getPRDiff(repo, pr.number);
  } catch (err) {
    log.error(`Failed to get diff for ${repo}#${pr.number}`);
    return;
  }

  // Truncate very large diffs
  const MAX_DIFF_CHARS = 100_000;
  const truncated = diff.length > MAX_DIFF_CHARS;
  if (truncated) {
    diff = diff.slice(0, MAX_DIFF_CHARS) + "\n\n... [diff truncated — too large for full review]";
  }

  const system = buildSystemPrompt(rc);
  const prompt = buildReviewPrompt(pr, diff, truncated);

  const response = await ask({ model, system, prompt, maxTokens: 4096 });

  // Parse the LLM response for verdict
  const verdict = parseVerdict(response.text, rc);

  // Build the review body
  const body = `${response.text}\n\n${SENTINEL_MARKER}`;

  submitReview(repo, pr.number, body, verdict);

  log.info(`Review posted on ${repo}#${pr.number}: ${verdict}`, {
    tokens: { input: response.inputTokens, output: response.outputTokens },
  });
}

function buildSystemPrompt(rc: ReviewerConfig): string {
  let style = "";
  switch (rc.style) {
    case "thorough":
      style = `You do thorough code reviews. Check for bugs, logic errors, edge cases, performance issues, security concerns, and code quality. Be specific and reference line numbers from the diff when possible.`;
      break;
    case "quick":
      style = `You do focused code reviews. Concentrate on bugs, security issues, and major design problems. Skip style nits and minor issues.`;
      break;
    case "security-focused":
      style = `You do security-focused code reviews. Prioritize finding security vulnerabilities, injection risks, auth issues, data leaks, and unsafe patterns. Note other serious bugs if you spot them, but security is your primary focus.`;
      break;
  }

  const instructions = rc.custom_instructions ? `\n\nAdditional instructions from the project maintainers:\n${rc.custom_instructions}` : "";

  return `You are a code reviewer. Your job is to review pull requests and provide constructive, actionable feedback.

${style}

Format your review as markdown. Start with a brief summary of what the PR does, then list any issues you found organized by severity (critical → minor). End with an overall assessment.

At the very end of your review, on its own line, output exactly one of these verdicts:
- VERDICT: APPROVE — if the code looks good or only has trivial issues
- VERDICT: COMMENT — if you have suggestions but nothing blocking
- VERDICT: REQUEST_CHANGES — if there are bugs, security issues, or significant problems that should be fixed

Be constructive, not nitpicky. The goal is to catch real problems, not enforce style preferences unless they affect readability significantly.${instructions}`;
}

function buildReviewPrompt(pr: PullRequest, diff: string, truncated: boolean): string {
  const truncNote = truncated ? "\n\n⚠️ Note: The diff was truncated due to size. Review what's visible and note that you couldn't see everything." : "";

  return `Please review this pull request.

## PR: ${pr.title}
**Author:** ${pr.author}
**Branch:** ${pr.headRef} → ${pr.baseRef}
**Labels:** ${pr.labels.join(", ") || "none"}

### Description
${pr.body || "(no description provided)"}

### Diff
\`\`\`diff
${diff}
\`\`\`
${truncNote}`;
}

function parseVerdict(text: string, rc: ReviewerConfig): "APPROVE" | "REQUEST_CHANGES" | "COMMENT" {
  const lower = text.toLowerCase();

  if (lower.includes("verdict: request_changes")) return "REQUEST_CHANGES";
  if (lower.includes("verdict: approve")) {
    return rc.auto_approve ? "APPROVE" : "COMMENT";
  }
  return "COMMENT";
}
