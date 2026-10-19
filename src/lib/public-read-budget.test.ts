import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const lifecycle = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("next/server", () => ({ after: lifecycle.after }));
import { createPublicReadBudget } from "./public-read-budget";

function pending<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const read = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { read, resolve, reject };
}

describe("public render read retention", () => {
  beforeEach(() => { vi.useFakeTimers(); lifecycle.after.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("retains a shared cached promise once across metadata/layout/page budgets and lets it finish", async () => {
    const task = pending<string>();
    const reads = [createPublicReadBudget(80, "Metadata"), createPublicReadBudget(100, "Layout"), createPublicReadBudget(150, "Page")]
      .map(budget => budget.optional(() => task.read, "institution", "fallback"));
    await vi.advanceTimersByTimeAsync(150);
    expect(await Promise.all(reads)).toEqual(["fallback", "fallback", "fallback"]);
    expect(lifecycle.after).toHaveBeenCalledTimes(1);
    const retained = lifecycle.after.mock.calls[0][0] as () => Promise<void>;
    const finish = retained();
    task.resolve("late institution");
    await finish;
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("abandoned read failed:"), expect.anything());
  });

  it("logs a retained rejection once without an unhandled rejection", async () => {
    const unhandled = vi.fn(); process.on("unhandledRejection", unhandled);
    try {
      const task = pending<string>(), error = new Error("late SQL failure");
      const result = createPublicReadBudget(100, "Page").optional(() => task.read, "fees", "fallback");
      await vi.advanceTimersByTimeAsync(100);
      expect(await result).toBe("fallback");
      expect(lifecycle.after).toHaveBeenCalledTimes(1);
      const finish = (lifecycle.after.mock.calls[0][0] as () => Promise<void>)();
      task.reject(error); await finish; await vi.advanceTimersByTimeAsync(0);
      expect(console.error).toHaveBeenCalledWith("Page fees abandoned read failed:", error);
      expect(unhandled).not.toHaveBeenCalled();
    } finally { process.off("unhandledRejection", unhandled); }
  });

  it("does not retain completed work or start an expired factory", async () => {
    const budget = createPublicReadBudget(100, "Page");
    expect(await budget.required(async () => "ready", "institution")).toBe("ready");
    await vi.advanceTimersByTimeAsync(100);
    const late = vi.fn(async () => "late");
    expect(await budget.optional(late, "footprint", "fallback")).toBe("fallback");
    expect(late).not.toHaveBeenCalled();
    expect(lifecycle.after).not.toHaveBeenCalled();
  });

  it("reports retention unavailable outside a request without changing the fallback", async () => {
    const error = new Error("no request context");
    lifecycle.after.mockImplementation(() => { throw error; });
    const task = pending<string>();
    const result = createPublicReadBudget(100, "Page").optional(() => task.read, "fees", "fallback");
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toBe("fallback");
    expect(lifecycle.after).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("Page fees abandoned read retention unavailable:", error);
    const lateError = new Error("late failure outside request");
    task.reject(lateError);
    await vi.advanceTimersByTimeAsync(0);
    expect(console.error).toHaveBeenCalledWith("Page fees abandoned read failed:", lateError);
  });

  it("can retain a shared promise in a valid request after an earlier unavailable context", async () => {
    lifecycle.after.mockImplementationOnce(() => { throw new Error("no request context"); });
    const task = pending<string>();
    const first = createPublicReadBudget(100, "Outside").optional(() => task.read, "fees", "fallback");
    await vi.advanceTimersByTimeAsync(100);
    expect(await first).toBe("fallback");
    const second = createPublicReadBudget(100, "Inside").optional(() => task.read, "fees", "fallback");
    await vi.advanceTimersByTimeAsync(100);
    expect(await second).toBe("fallback");
    expect(lifecycle.after).toHaveBeenCalledTimes(2);
    const finish = (lifecycle.after.mock.calls[1][0] as () => Promise<void>)();
    task.resolve("ready"); await finish;
  });
});
