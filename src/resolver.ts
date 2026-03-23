/**
 * Repo resolver — expands org names into individual repos.
 * Called at startup and optionally each poll cycle to pick up new repos.
 */
import { listOrgRepos } from "./github.js";
import { log } from "./log.js";
import type { SentinelConfig } from "./config.js";

/**
 * Resolve all repos from config (explicit repos + org repos).
 * Deduplicates by repo full name (owner/name).
 */
export function resolveRepos(config: SentinelConfig): string[] {
  const repoSet = new Set<string>(config.repos);

  for (const org of config.orgs) {
    try {
      const orgRepos = listOrgRepos(org);
      log.info(`Resolved org "${org}" → ${orgRepos.length} repos`);
      for (const r of orgRepos) {
        repoSet.add(r);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Failed to resolve org "${org}": ${msg}`);
    }
  }

  const repos = Array.from(repoSet).sort();
  log.debug(`Total repos to watch: ${repos.length}`, { repos });
  return repos;
}
