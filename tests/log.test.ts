import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log, setLogLevel } from "../src/log.js";

describe("log", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setLogLevel("debug"); // enable all levels
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setLogLevel("info"); // reset
  });

  it("logs debug messages when level is debug", () => {
    log.debug("test debug");
    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleSpy.mock.calls[0][0]).toContain("[DEBUG]");
    expect(consoleSpy.mock.calls[0][0]).toContain("test debug");
  });

  it("logs info messages", () => {
    log.info("test info");
    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleSpy.mock.calls[0][0]).toContain("[INFO ]");
  });

  it("logs warn messages", () => {
    log.warn("test warn");
    expect(consoleWarnSpy).toHaveBeenCalledOnce();
    expect(consoleWarnSpy.mock.calls[0][0]).toContain("[WARN ]");
  });

  it("logs error messages", () => {
    log.error("test error");
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("[ERROR]");
  });

  it("includes structured data in output", () => {
    log.info("message", { key: "value", count: 42 });
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('"key":"value"');
    expect(output).toContain('"count":42');
  });

  it("respects log level — debug hidden at info level", () => {
    setLogLevel("info");
    log.debug("hidden");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("respects log level — info hidden at warn level", () => {
    setLogLevel("warn");
    log.info("hidden");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("respects log level — warn hidden at error level", () => {
    setLogLevel("error");
    log.warn("hidden");
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it("error always shows at any level", () => {
    setLogLevel("error");
    log.error("always visible");
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });

  it("includes ISO timestamp", () => {
    log.info("timestamped");
    const output = consoleSpy.mock.calls[0][0] as string;
    // ISO format: 2025-01-01T00:00:00.000Z
    expect(output).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
