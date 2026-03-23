/**
 * Polling loop — periodically checks GitHub for new items to process.
 */
import { log } from "./log.js";
import type { SentinelConfig } from "./config.js";
import { resolveRepos } from "./resolver.js";

export interface PollHandler {
  /** Called each poll cycle with the list of repos. */
  poll(repos: string[]): Promise<void>;
}

/**
 * Start the polling loop. Runs forever until the process is killed.
 */
export async function startPolling(config: SentinelConfig, handler: PollHandler): Promise<never> {
  const { polling } = config;

  // Resolve repos (expand orgs) at startup
  let repos = resolveRepos(config);
  log.info(`Polling ${repos.length} repo(s) every ${polling.interval}s`, { repos });

  // Run immediately on start
  await runPollCycle(repos, handler);

  // Then loop
  let cycleCount = 0;
  while (true) {
    await sleep(polling.interval * 1000);
    cycleCount++;

    // Re-resolve orgs every 10 cycles to pick up new repos
    if (config.orgs.length > 0 && cycleCount % 10 === 0) {
      repos = resolveRepos(config);
    }

    await runPollCycle(repos, handler);
  }
}

async function runPollCycle(repos: string[], handler: PollHandler): Promise<void> {
  const start = Date.now();
  try {
    await handler.poll(repos);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log.debug(`Poll cycle completed in ${elapsed}s`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Poll cycle failed: ${msg}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
