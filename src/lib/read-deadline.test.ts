import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReadBudget, ReadDeadlineError } from "./read-deadline";

/** A read that never answers: a query queued behind a saturated pooler (#1919). */
const hanging = <T,>() => new Promise<T>(() => undefined);

describe("createReadBudget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns a read that answers inside the budget", async () => {
    const budget = createReadBudget(1_000, "Test page");
    await expect(budget.required(Promise.resolve("row"), "institution")).resolves.toBe("row");
  });

  it("rejects a required read that never answers once the budget runs out", async () => {
    const budget = createReadBudget(1_000, "Test page");
    const read = budget.required(hanging<string>(), "institution");
    const outcome = expect(read).rejects.toBeInstanceOf(ReadDeadlineError);
    await vi.advanceTimersByTimeAsync(1_000);
    await outcome;
    await expect(read).rejects.toThrow("institution read missed its 1000 ms deadline");
  });

  it("passes a required read's own error through unchanged", async () => {
    const budget = createReadBudget(1_000, "Test page");
    await expect(budget.required(Promise.reject(new Error("relation missing")), "institution")).rejects.toThrow(
      "relation missing",
    );
  });

  it("falls back and logs when an optional read never answers", async () => {
    const budget = createReadBudget(1_000, "Test page");
    const read = budget.optional(hanging<string[]>(), "branch footprint", []);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(read).resolves.toEqual([]);
    expect(console.error).toHaveBeenCalledWith("Test page branch footprint failed:", expect.any(ReadDeadlineError));
  });

  it("falls back and logs when an optional read fails", async () => {
    const budget = createReadBudget(1_000, "Test page");
    await expect(budget.optional(Promise.reject(new Error("timeout")), "complaints", null)).resolves.toBeNull();
    expect(console.error).toHaveBeenCalledWith("Test page complaints failed:", expect.any(Error));
  });

  it("reports whether any optional read fell back, so a cached page can expire early", async () => {
    const budget = createReadBudget(1_000, "Test page");
    await budget.optional(Promise.resolve("ok"), "fees", "fallback");
    expect(budget.failed()).toBe(false);
    await budget.optional(Promise.reject(new Error("timeout")), "complaints", null);
    expect(budget.failed()).toBe(true);
  });

  it("shares one deadline across reads started at different times", async () => {
    const budget = createReadBudget(1_000, "Test page");
    await vi.advanceTimersByTimeAsync(700);
    expect(budget.remaining()).toBe(300);
    const late = budget.optional(hanging<string | null>(), "regulator", null);
    await vi.advanceTimersByTimeAsync(300);
    await expect(late).resolves.toBeNull();
    // Once spent, a read gives up at once instead of waiting a fresh full budget.
    await expect(budget.optional(hanging<number>(), "peer medians", 0)).resolves.toBe(0);
  });

  it("does not leave an unhandled rejection when a read fails after the deadline", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const budget = createReadBudget(100, "Test page");
      let fail: (error: Error) => void = () => undefined;
      const read = new Promise<string>((_, reject) => {
        fail = reject;
      });
      const result = budget.optional(read, "fees", "fallback");
      await vi.advanceTimersByTimeAsync(100);
      await expect(result).resolves.toBe("fallback");
      fail(new Error("CONNECT_TIMEOUT"));
      await vi.advanceTimersByTimeAsync(0);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
