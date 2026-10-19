import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { txMock, statements, slow } = vi.hoisted(() => {
  const statements: string[] = [];
  const slow = { waitingMs: 0, fail: false };
  const txMock = Object.assign(
    vi.fn(async (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      statements.push(text);
      if (text.includes("AS magellan")) {
        if (slow.fail) throw new Error("canceling statement due to statement timeout");
        if (slow.waitingMs > 0) await new Promise((resolve) => setTimeout(resolve, slow.waitingMs));
        return [{ magellan: 1, rosetta: 2, knox: 3, darwin: 4, gutenberg: 5, published: 6, total: 7 }];
      }
      return [];
    }),
    { unsafe: vi.fn(async (text: string) => { statements.push(text); return []; }) },
  );
  return { txMock, statements, slow };
});

vi.mock("@/lib/data-store/connection", () => ({
  sql: txMock,
  withTransaction: (callback: (tx: typeof txMock) => unknown) => callback(txMock),
}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));

import { FLOW_STATEMENT_TIMEOUT_MS, FLOW_WAITING_TIMEOUT_MS, getFlowSnapshot, getFlowWaitingWithin } from "./flow";

describe("Live flow reads are bounded (#2016)", () => {
  beforeEach(() => {
    statements.length = 0;
    slow.waitingMs = 0;
    slow.fail = false;
  });
  afterEach(() => vi.useRealTimers());

  it("the snapshot's reads stop after 10 s, set before any of them runs", async () => {
    await getFlowSnapshot();
    expect(FLOW_STATEMENT_TIMEOUT_MS).toBe(10_000);
    expect(statements[0]).toBe("SET LOCAL statement_timeout = 10000");
    expect(statements.length).toBeGreaterThan(1);
  });

  it("the waiting counts stop inside the route's 30 s and carry when they were counted", async () => {
    const counts = await getFlowWaitingWithin(1_000);
    expect(statements[0]).toBe(`SET LOCAL statement_timeout = ${FLOW_WAITING_TIMEOUT_MS}`);
    expect(FLOW_WAITING_TIMEOUT_MS).toBeLessThan(30_000);
    expect(counts).toMatchObject({ magellan: 1, published: 6, total: 7 });
    expect(Number.isFinite(Date.parse(String(counts?.computedAt)))).toBe(true);
  });

  it("answers without the counts when they are not ready in time, or when they fail", async () => {
    vi.useFakeTimers();
    slow.waitingMs = 14_000;
    const pending = getFlowWaitingWithin(3_000);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(pending).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(11_000);
    vi.useRealTimers();
    slow.waitingMs = 0;
    slow.fail = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getFlowWaitingWithin(1_000)).resolves.toBeNull();
    errors.mockRestore();
  });
});
