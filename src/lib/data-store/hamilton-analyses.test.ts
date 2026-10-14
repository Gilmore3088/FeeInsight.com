import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn(), tx: vi.fn(), transactions: 0 }));
vi.mock("./connection", () => ({
  sql: db.query,
  withTransaction: async (callback: (tx: unknown) => Promise<unknown>) => {
    db.transactions += 1;
    return callback(db.tx);
  },
}));

import { getSavedAnalysisResponse, insertSavedAnalysis } from "./hamilton-analyses";

const legacy = {
  title: "Legacy",
  confidence: { level: "high", basis: ["Old matcher"] },
  hamiltonView: "Synthetic.",
  whatThisMeans: "",
  whyItMatters: [],
  evidence: { metrics: [] },
  exploreFurther: [],
};

beforeEach(() => {
  db.query.mockReset();
  db.tx.mockReset();
  db.transactions = 0;
});

/** The SQL text of a tagged-template call, parameters left out. */
const text = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?").replace(/\s+/g, " ");

describe("saving a Hamilton answer (#979 H04-T07)", () => {
  const input = {
    userId: 7,
    institutionId: "42",
    title: "Overdraft",
    analysisFocus: "Pricing",
    prompt: "What is the overdraft fee?",
    response: legacy as never,
  };

  it("inserts a new row when no save of the same question is recent", async () => {
    db.tx.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "new" }]);
    expect(await insertSavedAnalysis({ ...input, replaceRecentDuplicate: true })).toBe("new");
    const sqls = db.tx.mock.calls.map(text);
    expect(sqls[0]).toContain("pg_advisory_xact_lock");
    expect(sqls[1]).toContain("created_at > NOW() - make_interval");
    expect(sqls[1]).toContain("lower(btrim(regexp_replace(");
    expect(sqls[2]).toContain("INSERT INTO hamilton_saved_analyses");
    // The lock key is this reader and institution.
    expect(db.tx.mock.calls[0][1]).toBe("hamilton_saved_analyses:7:42");
  });

  it("updates the recent row for the same question instead of inserting a second one", async () => {
    db.tx.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "first" }]).mockResolvedValueOnce([{ id: "first" }]);
    expect(await insertSavedAnalysis({ ...input, replaceRecentDuplicate: true })).toBe("first");
    const sqls = db.tx.mock.calls.map(text);
    expect(sqls).toHaveLength(3);
    expect(sqls[2]).toContain("UPDATE hamilton_saved_analyses");
    expect(sqls.some((q) => q.includes("INSERT"))).toBe(false);
    // The newer answer is the one kept.
    expect(db.tx.mock.calls[2]).toContain(JSON.stringify(legacy));
  });

  it("keeps inserting without a transaction when the caller does not ask for duplicate replacement", async () => {
    db.query.mockResolvedValueOnce([{ id: "snap" }]);
    expect(await insertSavedAnalysis(input)).toBe("snap");
    expect(db.transactions).toBe(0);
    expect(text(db.query.mock.calls[0])).toContain("INSERT INTO hamilton_saved_analyses");
  });
});

describe("saved Hamilton analysis compatibility read", () => {
  it("returns null for a missing or inaccessible saved row", async () => {
    db.query.mockResolvedValueOnce([]);
    expect(await getSavedAnalysisResponse(7, "missing", "42")).toBeNull();
  });

  it("downgrades a legacy high rating from a JSON string without rewriting storage", async () => {
    db.query.mockResolvedValueOnce([{ response_json: JSON.stringify(legacy) }]);
    const response = await getSavedAnalysisResponse(7, "legacy", "42");
    expect(response?.confidence.level).toBe("medium");
    expect(response?.confidence.basis.join(" ")).toContain("predates record-bound");
    expect(legacy.confidence.level).toBe("high");
  });

  it("also normalizes already-parsed JSONB objects", async () => {
    db.query.mockResolvedValueOnce([{ response_json: legacy }]);
    expect((await getSavedAnalysisResponse(7, "legacy", "42"))?.confidence.level).toBe("medium");
  });

  it("never treats an attached but empty evidence contract as claim verification", async () => {
    const stored = {
      ...legacy,
      factEvidence: { version: 1, generatedAt: "2026-10-10T00:00:00Z", facts: [], derivations: [], limitations: [] },
    };
    db.query.mockResolvedValueOnce([{ response_json: stored }]);
    const displayed = await getSavedAnalysisResponse(7, "new", "42");
    expect(displayed?.confidence.level).toBe("medium");
    expect(displayed?.confidence.basis.join(" ")).toContain("does not by itself verify every sentence");
    expect(stored.confidence.level).toBe("high");
  });
});
