/**
 * lobs-sentinel — persistent single-purpose AI agents for GitHub.
 *
 * Usage:
 *   npx tsx src/main.ts --mode reviewer [--config config.yaml] [--repos owner/repo,...] [--orgs myorg,...]
 *   docker run lobs-sentinel --mode reviewer
 */
import { loadConfig } from "./config.js";
import { setLogLevel, log } from "./log.js";
import { getHandler } from "./modes/index.js";
import { startPolling } from "./poller.js";

export function parseArgs(argv: string[] = process.argv.slice(2)): {
  mode?: string;
  config?: string;
  repos?: string[];
  orgs?: string[];
} {
  const result: { mode?: string; config?: string; repos?: string[]; orgs?: string[] } = {};

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--mode":
      case "-m":
        result.mode = argv[++i];
        break;
      case "--config":
      case "-c":
        result.config = argv[++i];
        break;
      case "--repos":
      case "-r":
        result.repos = argv[++i]?.split(",").map((r) => r.trim());
        break;
      case "--orgs":
      case "-o":
        result.orgs = argv[++i]?.split(",").map((o) => o.trim());
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
lobs-sentinel — persistent AI agents for GitHub

Usage:
  npx tsx src/main.ts --mode <mode> [options]

Modes:
  reviewer    Review pull requests
  labeler     Auto-label issues and PRs
  triage      Triage new issues (categorize, prioritize, ask questions)

Options:
  --mode, -m      Agent mode (required)
  --config, -c    Path to config.yaml (default: ./config.yaml)
  --repos, -r     Comma-separated repos to watch (overrides config)
  --orgs, -o      Comma-separated GitHub orgs (all repos in org are watched)
  --help, -h      Show this help

Environment:
  ANTHROPIC_API_KEY   Required. Anthropic API key.
  GITHUB_TOKEN        Required. GitHub personal access token.
  CONFIG_PATH         Alternative to --config flag.
  LOG_LEVEL           debug, info, warn, error (default: info)

Example:
  ANTHROPIC_API_KEY=sk-ant-... GITHUB_TOKEN=ghp_... \\
    npx tsx src/main.ts --mode reviewer --repos myorg/myrepo

  # Watch all repos in an org:
  npx tsx src/main.ts --mode labeler --orgs my-company
`);
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Load config (merges file + env + CLI)
  const config = loadConfig(args.config, args.mode, args.repos, args.orgs);

  setLogLevel(config.logLevel);

  log.info(`lobs-sentinel starting`, {
    mode: config.mode,
    repos: config.repos,
    orgs: config.orgs,
    model: config.model,
    pollInterval: config.polling.interval,
  });

  // Get the handler for the selected mode
  const handler = getHandler(config);

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    log.info("Received SIGINT, shutting down...");
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    log.info("Received SIGTERM, shutting down...");
    process.exit(0);
  });

  // Start polling — runs forever
  await startPolling(config, handler);
}

// Only auto-run when executed directly (not imported by tests)
const isDirectRun = process.argv[1]?.endsWith("main.ts") || process.argv[1]?.endsWith("main.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
