import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(), withTransaction: vi.fn() }));

import { completedRunSummary } from "./run-store";

function fakeDb(rows: Array<{ summary: string | null }>) {
  return (async () => rows) as unknown as Parameters<typeof completedRunSummary>[0];
}

describe("completedRunSummary", () => {
  it("reports what the steps did, not stock capability text", async () => {
    const summary = await completedRunSummary(
      fakeDb([{ summary: "Hamilton category guard rolled back 720 of 721 failing live fees." }]),
      1073,
      1,
      1,
    );
    expect(summary).toBe("Completed 1 of 1 step. Hamilton category guard rolled back 720 of 721 failing live fees.");
    expect(summary).not.toContain("remain gated");
  });

  it("caps long multi-step summaries", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ summary: `Step ${i} ${"x".repeat(100)}` }));
    const summary = await completedRunSummary(fakeDb(rows), 1, 50, 50);
    expect(summary.length).toBe(2_000);
    expect(summary.startsWith("Completed 50 of 50 steps.")).toBe(true);
  });
});
