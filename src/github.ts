/**
 * GitHub API helpers — uses gh CLI for all interactions.
 * This keeps auth simple (gh handles tokens) and avoids REST API complexity.
 */
import { execFileSync } from "child_process";
import { log } from "./log.js";

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  author: string;
  state: string;
  isDraft: boolean;
  url: string;
  headRef: string;
  baseRef: string;
  repo: string;
  updatedAt: string;
  labels: string[];
}

export interface PullRequestFile {
  path: string;
  status: string; // added, modified, removed, renamed
  additions: number;
  deletions: number;
  patch?: string;
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  author: string;
  state: string;
  url: string;
  repo: string;
  labels: string[];
  createdAt: string;
}

export interface ReviewComment {
  body: string;
  path?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
}

/**
 * Run a gh CLI command with explicit fields and return parsed JSON.
 */
export function ghWithFields<T>(baseArgs: string[], fields: string[], repo?: string): T {
  const fullArgs = [...baseArgs, "--json", fields.join(",")];
  if (repo) {
    fullArgs.push("--repo", repo);
  }

  log.debug(`gh: gh ${fullArgs.join(" ")}`);

  try {
    const result = execFileSync("gh", fullArgs, {
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env },
    });
    return JSON.parse(result) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`gh command failed: gh ${fullArgs.join(" ")}`, { error: msg });
    throw err;
  }
}

/**
 * Run a raw gh command (no --json), return stdout.
 */
export function ghRaw(args: string[]): string {
  log.debug(`gh raw: gh ${args.join(" ")}`);
  try {
    return execFileSync("gh", args, {
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`gh raw command failed: gh ${args.join(" ")}`, { error: msg });
    throw err;
  }
}

// ── Organizations ──────────────────────────────────────────────────────────

interface GhRepoRaw {
  nameWithOwner: string;
  isArchived: boolean;
}

/**
 * List all non-archived repos in a GitHub org.
 */
export function listOrgRepos(org: string): string[] {
  const raw = ghWithFields<GhRepoRaw[]>(
    ["repo", "list", org, "--no-archived", "--limit", "200"],
    ["nameWithOwner", "isArchived"],
  );
  return raw
    .filter((r) => !r.isArchived)
    .map((r) => r.nameWithOwner);
}

// ── Pull Requests ──────────────────────────────────────────────────────────

const PR_FIELDS = [
  "number", "title", "body", "author", "state", "isDraft",
  "url", "headRefName", "baseRefName", "updatedAt", "labels",
];

interface GhPrRaw {
  number: number;
  title: string;
  body: string;
  author: { login: string };
  state: string;
  isDraft: boolean;
  url: string;
  headRefName: string;
  baseRefName: string;
  updatedAt: string;
  labels: Array<{ name: string }>;
}

function normalizePr(raw: GhPrRaw, repo: string): PullRequest {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? "",
    author: raw.author?.login ?? "unknown",
    state: raw.state,
    isDraft: raw.isDraft,
    url: raw.url,
    headRef: raw.headRefName,
    baseRef: raw.baseRefName,
    repo,
    updatedAt: raw.updatedAt,
    labels: raw.labels?.map((l) => l.name) ?? [],
  };
}

/**
 * List open PRs for a repo.
 */
export function listOpenPRs(repo: string): PullRequest[] {
  const raw = ghWithFields<GhPrRaw[]>(
    ["pr", "list", "--state", "open", "--limit", "50"],
    PR_FIELDS,
    repo,
  );
  return raw.map((pr) => normalizePr(pr, repo));
}

/**
 * Get full diff for a PR.
 */
export function getPRDiff(repo: string, prNumber: number): string {
  return ghRaw(["pr", "diff", String(prNumber), "--repo", repo]);
}

/**
 * Get the list of files changed in a PR.
 */
export function getPRFiles(repo: string, prNumber: number): PullRequestFile[] {
  const nameOutput = ghRaw(["pr", "diff", String(prNumber), "--repo", repo, "--name-only"]);
  const paths = nameOutput.trim().split("\n").filter(Boolean);

  return paths.map((p) => ({
    path: p,
    status: "modified",
    additions: 0,
    deletions: 0,
  }));
}

/**
 * Get a specific file's content from a PR's head branch.
 */
export function getFileContent(repo: string, ref: string, path: string): string | null {
  try {
    return ghRaw(["api", `repos/${repo}/contents/${path}?ref=${ref}`, "--jq", ".content"])
      .trim();
  } catch {
    return null;
  }
}

/**
 * Post a review on a PR.
 * Falls back to COMMENT if REQUEST_CHANGES or APPROVE fails
 * (e.g., can't request changes on your own PR).
 */
export function submitReview(
  repo: string,
  prNumber: number,
  body: string,
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT" = "COMMENT",
): void {
  const args = [
    "pr", "review", String(prNumber),
    "--repo", repo,
    "--body", body,
  ];

  switch (event) {
    case "APPROVE":
      args.push("--approve");
      break;
    case "REQUEST_CHANGES":
      args.push("--request-changes");
      break;
    case "COMMENT":
      args.push("--comment");
      break;
  }

  try {
    ghRaw(args);
    log.info(`Submitted ${event} review on ${repo}#${prNumber}`);
  } catch (err) {
    // If we can't approve/request-changes (e.g., reviewing own PR), fall back to comment
    if (event !== "COMMENT") {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Failed to submit ${event} review on ${repo}#${prNumber}, falling back to COMMENT: ${msg}`);
      const fallbackArgs = [
        "pr", "review", String(prNumber),
        "--repo", repo,
        "--body", body,
        "--comment",
      ];
      ghRaw(fallbackArgs);
      log.info(`Submitted COMMENT review on ${repo}#${prNumber} (fallback from ${event})`);
    } else {
      throw err;
    }
  }
}

/**
 * Post a comment on a PR or issue.
 */
export function postComment(repo: string, number: number, body: string): void {
  ghRaw(["pr", "comment", String(number), "--repo", repo, "--body", body]);
  log.info(`Posted comment on ${repo}#${number}`);
}

// ── Issues ─────────────────────────────────────────────────────────────────

const ISSUE_FIELDS = ["number", "title", "body", "author", "state", "url", "labels", "createdAt"];

interface GhIssueRaw {
  number: number;
  title: string;
  body: string;
  author: { login: string };
  state: string;
  url: string;
  labels: Array<{ name: string }>;
  createdAt: string;
}

function normalizeIssue(raw: GhIssueRaw, repo: string): Issue {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? "",
    author: raw.author?.login ?? "unknown",
    state: raw.state,
    url: raw.url,
    repo,
    labels: raw.labels?.map((l) => l.name) ?? [],
    createdAt: raw.createdAt,
  };
}

/**
 * List open issues for a repo.
 */
export function listOpenIssues(repo: string): Issue[] {
  const raw = ghWithFields<GhIssueRaw[]>(
    ["issue", "list", "--state", "open", "--limit", "50"],
    ISSUE_FIELDS,
    repo,
  );
  return raw.map((i) => normalizeIssue(i, repo));
}

/**
 * Add labels to an issue or PR.
 */
export function addLabels(repo: string, number: number, labels: string[]): void {
  ghRaw(["issue", "edit", String(number), "--repo", repo, "--add-label", labels.join(",")]);
  log.info(`Added labels [${labels.join(", ")}] to ${repo}#${number}`);
}

/**
 * Check if the sentinel has already reviewed/commented on this item.
 * Looks for a comment containing our sentinel marker.
 */
export function hasAlreadyProcessed(repo: string, number: number, marker: string): boolean {
  try {
    const comments = ghRaw([
      "api", `repos/${repo}/issues/${number}/comments`,
      "--jq", `.[].body`,
    ]);
    return comments.includes(marker);
  } catch {
    return false;
  }
}

/**
 * Check existing reviews on a PR to see if sentinel already reviewed.
 */
export function hasExistingReview(repo: string, prNumber: number, marker: string): boolean {
  try {
    const reviews = ghRaw([
      "api", `repos/${repo}/pulls/${prNumber}/reviews`,
      "--jq", `.[].body`,
    ]);
    return reviews.includes(marker);
  } catch {
    return false;
  }
}

// ── PR Context (comments, reviews, commits) ───────────────────────────────

export interface PRComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface PRReviewThread {
  author: string;
  body: string;
  state: string; // APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED
  createdAt: string;
  comments: PRReviewComment[];
}

export interface PRReviewComment {
  author: string;
  body: string;
  path: string;
  line: number | null;
  createdAt: string;
}

export interface PRCommit {
  sha: string;
  message: string;
  author: string;
}

/**
 * Get all issue-level comments on a PR (not inline review comments).
 */
export function getPRComments(repo: string, prNumber: number): PRComment[] {
  try {
    const raw = ghRaw([
      "api", `repos/${repo}/issues/${prNumber}/comments`,
      "--jq", `[.[] | {author: .user.login, body: .body, createdAt: .created_at}]`,
    ]);
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "[]") return [];
    return JSON.parse(trimmed) as PRComment[];
  } catch {
    log.debug(`Failed to fetch comments for ${repo}#${prNumber}`);
    return [];
  }
}

/**
 * Get all reviews and their inline comments on a PR.
 */
export function getPRReviews(repo: string, prNumber: number): PRReviewThread[] {
  try {
    // Get reviews (top-level review submissions)
    const reviewsRaw = ghRaw([
      "api", `repos/${repo}/pulls/${prNumber}/reviews`,
      "--jq", `[.[] | {author: .user.login, body: .body, state: .state, createdAt: .submitted_at}]`,
    ]);
    const reviews: PRReviewThread[] = JSON.parse(reviewsRaw.trim() || "[]");

    // Get inline review comments (threaded on specific lines)
    const commentsRaw = ghRaw([
      "api", `repos/${repo}/pulls/${prNumber}/comments`,
      "--jq", `[.[] | {author: .user.login, body: .body, path: .path, line: .line, createdAt: .created_at}]`,
    ]);
    const comments: PRReviewComment[] = JSON.parse(commentsRaw.trim() || "[]");

    // Attach inline comments to the reviews as a flat list
    // (GitHub's API doesn't directly link them without pull_request_review_id,
    //  so we include them all — the LLM will understand the context)
    if (reviews.length > 0) {
      reviews[reviews.length - 1].comments = comments;
    } else if (comments.length > 0) {
      // Orphaned comments (no review submission) — create a synthetic review
      reviews.push({
        author: comments[0].author,
        body: "",
        state: "COMMENTED",
        createdAt: comments[0].createdAt,
        comments,
      });
    }

    // Ensure all reviews have comments array
    for (const r of reviews) {
      if (!r.comments) r.comments = [];
    }

    return reviews;
  } catch {
    log.debug(`Failed to fetch reviews for ${repo}#${prNumber}`);
    return [];
  }
}

/**
 * Get the commit list for a PR.
 */
export function getPRCommits(repo: string, prNumber: number): PRCommit[] {
  try {
    const raw = ghRaw([
      "api", `repos/${repo}/pulls/${prNumber}/commits`,
      "--jq", `[.[] | {sha: .sha[0:8], message: .commit.message, author: .commit.author.name}]`,
    ]);
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "[]") return [];
    return JSON.parse(trimmed) as PRCommit[];
  } catch {
    log.debug(`Failed to fetch commits for ${repo}#${prNumber}`);
    return [];
  }
}
