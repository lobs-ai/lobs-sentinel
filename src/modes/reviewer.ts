/**
 * PR Reviewer mode — reviews open pull requests with full context.
 *
 * For each open PR that hasn't been reviewed yet:
 * 1. Fetch the diff, commits, existing comments, and review threads
 * 2. Build a rich context prompt with all discussion history
 * 3. Send to LLM with expert review instructions
 * 4. Post the review as a GitHub review (comment/approve/request changes)
 */
import type { PollHandler } from "../poller.js";
import type { SentinelConfig, ReviewerConfig } from "../config.js";
import {
  listOpenPRs,
  getPRDiff,
  submitReview,
  hasExistingReview,
  getPRComments,
  getPRReviews,
  getPRCommits,
  type PullRequest,
  type PRComment,
  type PRReviewThread,
  type PRCommit,
} from "../github.js";
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
  // Gather all context in parallel-ish (they're sync gh CLI calls, but semantically parallel)
  let diff: string;
  try {
    diff = getPRDiff(repo, pr.number);
  } catch {
    log.error(`Failed to get diff for ${repo}#${pr.number}`);
    return;
  }

  const comments = getPRComments(repo, pr.number);
  const reviews = getPRReviews(repo, pr.number);
  const commits = getPRCommits(repo, pr.number);

  // Truncate very large diffs
  const MAX_DIFF_CHARS = 100_000;
  const truncated = diff.length > MAX_DIFF_CHARS;
  if (truncated) {
    diff = diff.slice(0, MAX_DIFF_CHARS) + "\n\n... [diff truncated — too large for full review]";
  }

  const system = buildSystemPrompt(rc);
  const prompt = buildReviewPrompt(pr, diff, truncated, comments, reviews, commits);

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

// ── System Prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(rc: ReviewerConfig): string {
  const styleParagraph = {
    thorough: `You perform thorough, senior-engineer-level code reviews. You check for correctness bugs, logic errors, off-by-one mistakes, unhandled edge cases, race conditions, resource leaks, error handling gaps, performance footguns, and security vulnerabilities. You also evaluate code organization, naming clarity, and whether the abstractions make sense. You reference specific lines from the diff when pointing out issues.`,

    quick: `You perform focused code reviews optimized for speed. You concentrate on correctness bugs, security vulnerabilities, and major design problems that would cause real harm if merged. You skip style nits, naming bikesheds, and minor issues — only flag things that matter.`,

    "security-focused": `You perform security-focused code reviews. Your primary goal is finding security vulnerabilities: injection attacks (SQL, XSS, command injection), authentication/authorization bypasses, insecure cryptography, sensitive data exposure, SSRF, path traversal, deserialization issues, and unsafe dependency usage. You also note serious correctness bugs if you spot them, but security is always your first priority.`,
  }[rc.style];

  const instructions = rc.custom_instructions
    ? `\n\nThe project maintainers have provided these additional review instructions — follow them:\n${rc.custom_instructions}`
    : "";

  return `You are an expert code reviewer acting as an automated reviewer on GitHub pull requests. You have been integrated into a CI/review pipeline and your reviews will be posted directly as GitHub PR reviews.

## Your Review Philosophy

You review code the way a thoughtful senior engineer would — someone who's seen production incidents and knows what actually causes them. You care about **correctness above all else**, followed by security, then maintainability. You don't waste the author's time on things that don't matter.

${styleParagraph}

## What You Receive

You'll be given:
- The PR title, description, branch info, and labels
- The full diff of changes
- The commit history (to understand the progression of changes)
- All existing PR comments and review threads (to understand ongoing discussions)

**The existing comments and reviews are critical context.** They tell you:
- What feedback has already been given (don't repeat it)
- What discussions are in progress (build on them, don't restart them)
- What the author has already addressed or pushed back on
- Whether previous reviewers approved, requested changes, or raised concerns

## How to Write Your Review

1. **Summary** — Start with 1-2 sentences about what this PR does and your overall impression. Be direct.

2. **Issues** — List concrete issues you found, organized by severity. For each issue:
   - State clearly what the problem is
   - Reference the specific file and code from the diff
   - Explain *why* it's a problem (what could go wrong)
   - Suggest a fix when you have one
   
   Severity levels:
   - 🔴 **Critical** — Bugs, security holes, data loss risks. Must fix before merge.
   - 🟡 **Warning** — Likely problems, error handling gaps, performance issues. Should fix.
   - 🔵 **Suggestion** — Improvements to clarity, maintainability, or robustness. Nice to have.

3. **Context-Aware Notes** — If other reviewers have already flagged issues:
   - Don't re-raise the same concern unless you have something new to add
   - If the author responded to feedback, acknowledge whether their fix addresses it
   - If you disagree with another reviewer's suggestion, say so respectfully and explain why

4. **Verdict** — End with exactly one of these on its own line:
   - \`VERDICT: APPROVE\` — Code is good to merge, or only has trivial/optional suggestions
   - \`VERDICT: COMMENT\` — You have feedback worth discussing, but nothing strictly blocking
   - \`VERDICT: REQUEST_CHANGES\` — There are bugs, security issues, or significant problems that must be fixed

## Rules

- **Only raise issues you actually believe are issues.** If you investigate something and conclude it's fine, do NOT include it. Never write "this looks like a problem... actually on closer inspection it's fine." That wastes the author's time and makes you look uncertain. Think first, then only write up real problems.
- **Every issue must be actionable.** If your suggestion ends with "but it's fine as-is" or "not critical though," cut it entirely. Either it's worth fixing or it's not worth mentioning.
- **Quality over quantity.** A review with zero issues and an approval is far better than a review with five wishy-washy maybe-issues. Don't pad your review to look thorough.
- Be specific. "This might have issues" is useless. "This SQL query on line 42 interpolates user input without parameterization, enabling SQL injection" is useful.
- Be constructive. You're helping the author ship better code, not proving you're smart.
- Don't nitpick style unless it genuinely hurts readability. Formatting, naming conventions, and import ordering are not your job unless they create confusion.
- If the diff is truncated, note what you could and couldn't review. Don't speculate about code you haven't seen.
- If the PR looks genuinely good, say so briefly and approve. Not every review needs a laundry list. A clean PR deserves a clean approval, not manufactured feedback.
- Never fabricate line numbers or code that isn't in the diff.${instructions}`;
}

// ── Prompt Builder ───────────────────────────────────────────────────────────

function buildReviewPrompt(
  pr: PullRequest,
  diff: string,
  truncated: boolean,
  comments: PRComment[],
  reviews: PRReviewThread[],
  commits: PRCommit[],
): string {
  const sections: string[] = [];

  // PR metadata
  sections.push(`## Pull Request: ${pr.title}
**Author:** ${pr.author}
**Branch:** \`${pr.headRef}\` → \`${pr.baseRef}\`
**Labels:** ${pr.labels.join(", ") || "none"}`);

  // Description
  sections.push(`### Description
${pr.body || "(no description provided)"}`);

  // Commits
  if (commits.length > 0) {
    const commitLines = commits.map((c) => `- \`${c.sha}\` ${c.message.split("\n")[0]} (${c.author})`);
    sections.push(`### Commits (${commits.length})
${commitLines.join("\n")}`);
  }

  // Existing reviews and inline comments
  if (reviews.length > 0) {
    const reviewSections: string[] = [];
    for (const review of reviews) {
      // Skip our own reviews
      if (review.body.includes(SENTINEL_MARKER)) continue;

      const stateLabel = formatReviewState(review.state);
      let reviewText = `**${review.author}** ${stateLabel}`;
      if (review.body) {
        reviewText += `:\n${review.body}`;
      }

      // Inline comments on this review
      if (review.comments.length > 0) {
        const inlineLines = review.comments.map((c) => {
          const location = c.line ? `\`${c.path}:${c.line}\`` : `\`${c.path}\``;
          return `  - ${location} — **${c.author}**: ${c.body}`;
        });
        reviewText += `\n\nInline comments:\n${inlineLines.join("\n")}`;
      }

      reviewSections.push(reviewText);
    }

    if (reviewSections.length > 0) {
      sections.push(`### Existing Reviews
${reviewSections.join("\n\n---\n\n")}`);
    }
  }

  // PR comments (general discussion, not inline)
  const nonSentinelComments = comments.filter((c) => !c.body.includes(SENTINEL_MARKER));
  if (nonSentinelComments.length > 0) {
    const commentLines = nonSentinelComments.map(
      (c) => `**${c.author}** (${formatDate(c.createdAt)}):\n${c.body}`,
    );
    sections.push(`### Discussion
${commentLines.join("\n\n")}`);
  }

  // Diff
  const truncNote = truncated
    ? "\n\n⚠️ The diff was truncated due to size. Review what's visible and note that you couldn't see everything."
    : "";

  sections.push(`### Diff
\`\`\`diff
${diff}
\`\`\`${truncNote}`);

  return sections.join("\n\n");
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatReviewState(state: string): string {
  switch (state) {
    case "APPROVED": return "✅ approved";
    case "CHANGES_REQUESTED": return "❌ requested changes";
    case "COMMENTED": return "💬 commented";
    case "DISMISSED": return "🚫 review dismissed";
    default: return state.toLowerCase();
  }
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function parseVerdict(text: string, rc: ReviewerConfig): "APPROVE" | "REQUEST_CHANGES" | "COMMENT" {
  const lower = text.toLowerCase();

  if (lower.includes("verdict: request_changes")) return "REQUEST_CHANGES";
  if (lower.includes("verdict: approve")) {
    return rc.auto_approve ? "APPROVE" : "COMMENT";
  }
  return "COMMENT";
}
