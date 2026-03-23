/**
 * Simple structured logger.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel: Level = "info";

export function setLogLevel(level: Level): void {
  currentLevel = level;
}

function shouldLog(level: Level): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function fmt(level: Level, msg: string, data?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const prefix = `${ts} [${level.toUpperCase().padEnd(5)}]`;
  if (data && Object.keys(data).length > 0) {
    return `${prefix} ${msg} ${JSON.stringify(data)}`;
  }
  return `${prefix} ${msg}`;
}

export const log = {
  debug(msg: string, data?: Record<string, unknown>): void {
    if (shouldLog("debug")) console.log(fmt("debug", msg, data));
  },
  info(msg: string, data?: Record<string, unknown>): void {
    if (shouldLog("info")) console.log(fmt("info", msg, data));
  },
  warn(msg: string, data?: Record<string, unknown>): void {
    if (shouldLog("warn")) console.warn(fmt("warn", msg, data));
  },
  error(msg: string, data?: Record<string, unknown>): void {
    if (shouldLog("error")) console.error(fmt("error", msg, data));
  },
};
