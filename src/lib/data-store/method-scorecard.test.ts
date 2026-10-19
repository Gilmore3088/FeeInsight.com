import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import { groupMethods, methodOutcomeGroup, type MethodRow } from "./method-scorecard";

function method(row: Partial<MethodRow>): MethodRow {
  return { stage: "extract", strategy: "extract.rules", version: 1, attempts: 0, ok: 0, nothing: 0, held: 0, nextStep: 0, failed: 0, outcomes: {}, costUsd: 0, score: null, ...row };
}

describe("groupMethods", () => {
  it("keeps the newest version as current and orders strategies by use", () => {
    const groups = groupMethods([
      method({ strategy: "extract.rules", version: 11, attempts: 1962, ok: 1119 }),
      method({ strategy: "extract.rules", version: 12, attempts: 206, ok: 83 }),
      method({ strategy: "extract.table", version: 2, attempts: 4470, ok: 1323 }),
      method({ stage: "read", strategy: "read.pdf_text", version: 1, attempts: 419, ok: 382 }),
    ]);
    const extract = groups.get("extract")!;
    expect(extract.map((group) => group.strategy)).toEqual(["extract.table", "extract.rules"]);
    const rules = extract.find((group) => group.strategy === "extract.rules")!;
    expect(rules.current.version).toBe(12);
    expect(rules.older.map((row) => row.version)).toEqual([11]);
    expect(groups.get("read")).toHaveLength(1);
  });
});

describe("getMethodScorecard", () => {
  it("preserves exact outcomes and separates holds and handoffs from execution errors", async () => {
    const { sql } = await import("./connection");
    const calls: { text: string; values: unknown[] }[] = [];
    (sql as unknown as ReturnType<typeof vi.fn>).mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join("?"), values });
      return Promise.resolve([
        ["ok_partial", 3], ["low_yield", 2], ["no_candidates", 4], ["rejected", 5],
        ["evidence_mismatch", 6], ["scanned_pdf", 7], ["http_404", 8],
      ].map(([outcome, attempts]) => ({ stage: "extract", strategy: "extract.rules", strategy_version: 4, outcome, attempts, cost: 1 })));
    });
    const { getMethodScorecard } = await import("./method-scorecard");
    const card = await getMethodScorecard(7);
    expect(card.rows[0]).toMatchObject({ attempts: 35, ok: 5, nothing: 4, held: 11, nextStep: 7, failed: 8,
      outcomes: { ok_partial: 3, low_yield: 2, no_candidates: 4, rejected: 5, evidence_mismatch: 6, scanned_pdf: 7, http_404: 8 }, score: null });
    expect(card.rows[0].costUsd).toBeCloseTo(0.000007);
    expect(calls[0].text).toContain("GROUP BY 1, 2, 3, 4");
    expect(calls[0].values).toEqual([7]);
  });

  it("adds correct and decided verdicts across batches and keeps the 95% batch bar separate", async () => {
    const { sql } = await import("./connection");
    (sql as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { stage: "verify", strategy: "verify.verdict_score", strategy_version: 1, outcome: "ok", attempts: 1, cost: 0,
        scored_right: "20", scored_decided: "20", holdout_right: "18", holdout_wrong: "2" },
      { stage: "verify", strategy: "verify.verdict_score", strategy_version: 1, outcome: "evidence_mismatch", attempts: 2, cost: 0,
        scored_right: "19", scored_decided: "30", holdout_right: "7", holdout_wrong: "3" },
    ]);
    const { getMethodScorecard } = await import("./method-scorecard");
    const { rows } = await getMethodScorecard();
    expect(rows[0].score).toBeNull();
    expect(rows[0].referenceState).toBe("legacy_unbound_no_measurement");
    expect(rows[0].legacyScore).toEqual({ correct: 39, decided: 50, holdoutCorrect: 25, holdoutDecided: 30, chunks: 3, passedChunks: 1 });
    expect(rows[0]).toMatchObject({ attempts: 3, ok: 1, held: 2, failed: 0 });
  });
});

describe("methodOutcomeGroup", () => {
  it("counts safety decisions and unfinished inputs apart from real errors without calling them successes", () => {
    for (const outcome of ["rejected", "evidence_mismatch", "wrong_document"]) expect(methodOutcomeGroup(outcome)).toBe("held");
    for (const outcome of ["scanned_pdf", "js_required", "unsupported_format", "budget_blocked"]) expect(methodOutcomeGroup(outcome)).toBe("nextStep");
    for (const outcome of ["timeout", "network_error", "http_429", "http_5xx", "parse_error", "unknown_future_outcome"]) expect(methodOutcomeGroup(outcome)).toBe("failed");
    expect(methodOutcomeGroup("unchanged")).toBe("nothing");
    expect(methodOutcomeGroup("low_yield")).toBe("worked");
  });
});
