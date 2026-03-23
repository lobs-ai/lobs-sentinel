/**
 * Mode registry — maps mode names to their handler factories.
 */
import type { PollHandler } from "../poller.js";
import type { SentinelConfig, SentinelMode } from "../config.js";
import { createReviewer } from "./reviewer.js";
import { createLabeler } from "./labeler.js";
import { createTriager } from "./triage.js";

const MODES: Record<SentinelMode, (config: SentinelConfig) => PollHandler> = {
  reviewer: createReviewer,
  labeler: createLabeler,
  triage: createTriager,
};

export function getHandler(config: SentinelConfig): PollHandler {
  const factory = MODES[config.mode];
  if (!factory) {
    throw new Error(`Unknown mode: ${config.mode}. Available: ${Object.keys(MODES).join(", ")}`);
  }
  return factory(config);
}
