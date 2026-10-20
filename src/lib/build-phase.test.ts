import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { BUILD_READ_DEADLINE_MS, readOnRequest } from "./build-phase";

/**
 * #1048 / #2507 review: during `next build` a page tries its real read, but only for
 * BUILD_READ_DEADLINE_MS (well under Next's 60-second page limit). A busy database then
 * yields the fallback instead of a failed deploy; a healthy one yields the real page.
 */
const FALLBACK = { live: false };
const LIVE = { live: true };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("readOnRequest during next build", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PHASE", PHASE_PRODUCTION_BUILD);
  });

  it("keeps the deadline well under Next's 60-second page limit", () => {
    expect(BUILD_READ_DEADLINE_MS).toBeLessThanOrEqual(20_000);
    expect(BUILD_READ_DEADLINE_MS).toBeGreaterThan(0);
  });

  it("returns the real data when the read finishes in time", async () => {
    const result = readOnRequest(async () => LIVE, FALLBACK);
    await expect(result).resolves.toBe(LIVE);
  });

  it("returns the fallback once the deadline passes on a read that never resolves", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let settled = false;
    const result = readOnRequest(() => new Promise<typeof LIVE>(() => undefined), FALLBACK).then((value) => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(BUILD_READ_DEADLINE_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(FALLBACK);
  });

  it("returns the fallback when the read throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(readOnRequest<typeof FALLBACK>(async () => Promise.reject(new Error("pool busy")), FALLBACK)).resolves.toBe(FALLBACK);
  });

  it("ignores a read that loses the race and later rejects, without an unhandled rejection", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    let rejectLate: (error: Error) => void = () => undefined;
    const result = readOnRequest(
      () => new Promise<typeof LIVE>((_resolve, reject) => { rejectLate = reject; }),
      FALLBACK,
    );
    await vi.advanceTimersByTimeAsync(BUILD_READ_DEADLINE_MS);
    await expect(result).resolves.toBe(FALLBACK);
    rejectLate(new Error("late"));
    await vi.advanceTimersByTimeAsync(0);
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("leaves no timer behind when the read wins", async () => {
    await readOnRequest(async () => LIVE, FALLBACK);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("readOnRequest on request", () => {
  it("runs the read and lets its error through, as before", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    await expect(readOnRequest(async () => LIVE, FALLBACK)).resolves.toBe(LIVE);
    await expect(readOnRequest<typeof FALLBACK>(async () => Promise.reject(new Error("boom")), FALLBACK)).rejects.toThrow("boom");
    expect(vi.getTimerCount()).toBe(0);
  });
});
