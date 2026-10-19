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

  it("never starts a lazy read after the shared deadline", async () => {
    const retain = vi.fn(), start = vi.fn(async () => "late");
    const budget = createReadBudget(100, "Test page", Date.now, retain);
    await vi.advanceTimersByTimeAsync(100);
    await expect(budget.required(start, "institution")).rejects.toBeInstanceOf(ReadDeadlineError);
    await expect(budget.optional(start, "footprint", "fallback")).resolves.toBe("fallback");
    expect(start).not.toHaveBeenCalled();
    expect(retain).not.toHaveBeenCalled();
    expect(budget.failed()).toBe(true);
  });

  it("passes synchronous factory errors through and preserves optional fallback", async () => {
    const error = new Error("read could not start"), retain = vi.fn();
    const budget = createReadBudget(100, "Test page", Date.now, retain);
    const start = () => { throw error; };
    await expect(budget.required(start, "institution")).rejects.toBe(error);
    await expect(budget.optional(start, "footprint", null)).resolves.toBeNull();
    expect(retain).not.toHaveBeenCalled();
  });

  it("retains one shared pending task once while preserving both read outcomes", async () => {
    const retain = vi.fn(), pending = hanging<string>();
    const budget = createReadBudget(100, "Test page", Date.now, retain);
    const required = budget.required(() => pending, "institution");
    const requiredOutcome = expect(required).rejects.toBeInstanceOf(ReadDeadlineError);
    const optional = budget.optional(pending, "footprint", "fallback");
    await vi.advanceTimersByTimeAsync(100);
    await requiredOutcome;
    await expect(optional).resolves.toBe("fallback");
    expect(retain).toHaveBeenCalledExactlyOnceWith(pending, "institution");
  });

  it("does not retain settled successes or failures", async () => {
    const retain = vi.fn(), budget = createReadBudget(100, "Test page", Date.now, retain);
    await expect(budget.required(() => Promise.resolve("ok"), "institution")).resolves.toBe("ok");
    await expect(budget.optional(() => Promise.reject(new Error("failed")), "footprint", null)).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    expect(retain).not.toHaveBeenCalled();
  });

  it("preserves the deadline when a retention adapter throws", async () => {
    const retain = vi.fn(() => { throw new Error("outside request"); });
    const budget = createReadBudget(100, "Test page", Date.now, retain);
    const read = budget.optional(hanging<string>(), "footprint", "fallback");
    await vi.advanceTimersByTimeAsync(100);
    await expect(read).resolves.toBe("fallback");
    expect(retain).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("Test page footprint abandoned read retention failed:", expect.any(Error));
  });

  it("retains only unresolved started siblings before propagating a required error", async () => {
    const error = new Error("required SQL failed");
    const retain = vi.fn();
    const pending = hanging<string>();
    const budget = createReadBudget(1_000, "Test page", Date.now, retain);
    const sibling = budget.optional(pending, "financial context", "fallback");
    await budget.required(Promise.resolve("ready"), "settled read");

    await expect(budget.required(Promise.reject(error), "fees")).rejects.toBe(error);

    expect(retain).toHaveBeenCalledExactlyOnceWith(pending, "financial context");
    expect(budget.remaining()).toBe(1_000);
    expect(budget.failed()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await sibling).toBe("fallback");
    expect(retain).toHaveBeenCalledTimes(1);
  });

  it("retains a sibling started after a synchronous required throw in the same array", async () => {
    const error = new Error("factory could not start");
    const retain = vi.fn();
    const pending = hanging<string>();
    const budget = createReadBudget(100, "Test page", Date.now, retain);
    const result = Promise.all([
      budget.required(() => { throw error; }, "institution"),
      budget.optional(() => pending, "financial context", "fallback"),
    ]);

    await expect(result).rejects.toBe(error);

    expect(retain).toHaveBeenCalledExactlyOnceWith(pending, "financial context");
    await vi.advanceTimersByTimeAsync(100);
    expect(retain).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("does not abandon siblings for an optional failure (synchronous %s)", async (synchronous) => {
    const error = new Error("optional failed");
    const retain = vi.fn();
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((yes) => { resolve = yes; });
    const budget = createReadBudget(100, "Test page", Date.now, retain);
    const sibling = budget.required(() => pending, "fees");
    const failed = () => {
      if (synchronous) throw error;
      return Promise.reject(error);
    };

    expect(await budget.optional(failed, "complaints", null)).toBeNull();
    expect(retain).not.toHaveBeenCalled();
    expect(budget.failed()).toBe(true);
    expect(budget.remaining()).toBe(100);
    const later = vi.fn(async () => "later data");
    expect(await budget.required(later, "later section")).toBe("later data");
    expect(later).toHaveBeenCalledTimes(1);
    resolve("own fees");
    expect(await sibling).toBe("own fees");
    expect(retain).not.toHaveBeenCalled();
  });

  it.each([false, true])("allows catch-and-continue after a required error (retention %s)", async (withRetention) => {
    const retain = withRetention ? vi.fn() : undefined;
    const budget = createReadBudget(100, "Test page", Date.now, retain);
    const error = new Error("first read failed");
    await expect(budget.required(() => Promise.reject(error), "first")).rejects.toBe(error);

    const later = vi.fn(async () => "ready");
    expect(await budget.required(later, "later")).toBe("ready");
    expect(later).toHaveBeenCalledTimes(1);
    expect(budget.remaining()).toBe(100);
    expect(budget.failed()).toBe(false);
    if (retain) expect(retain).not.toHaveBeenCalled();
  });

  it("deduplicates a pending shared promise when two required reads fail early", async () => {
    const retain = vi.fn();
    const pending = hanging<string>();
    const budget = createReadBudget(100, "Test page", Date.now, retain);
    const sibling = Promise.all([
      budget.optional(pending, "first shared read", "fallback"),
      budget.optional(pending, "second shared read", "fallback"),
    ]);

    await Promise.all([
      expect(budget.required(Promise.reject(new Error("first failure")), "first required")).rejects.toThrow("first failure"),
      expect(budget.required(Promise.reject(new Error("second failure")), "second required")).rejects.toThrow("second failure"),
    ]);
    expect(retain).toHaveBeenCalledExactlyOnceWith(pending, "first shared read");
    await vi.advanceTimersByTimeAsync(100);
    expect(await sibling).toEqual(["fallback", "fallback"]);
    expect(retain).toHaveBeenCalledTimes(1);
  });

  it("handles a retained sibling's late rejection without an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      let reject!: (error: Error) => void;
      const pending = new Promise<string>((_yes, no) => { reject = no; });
      const retain = vi.fn();
      const budget = createReadBudget(100, "Test page", Date.now, retain);
      const result = Promise.all([
        budget.required(pending, "fees"),
        budget.required(Promise.reject(new Error("immediate failure")), "institution"),
      ]);
      await expect(result).rejects.toThrow("immediate failure");
      expect(retain).toHaveBeenCalledExactlyOnceWith(pending, "fees");

      reject(new Error("late native error"));
      await vi.advanceTimersByTimeAsync(0);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
