import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn(), tx: vi.fn(), transactions: 0 }));
vi.mock("./connection", () => ({
  sql: db.query,
  withTransaction: async (callback: (tx: unknown) => Promise<unknown>) => {
    db.transactions += 1;
    return callback(db.tx);
  },
}));

import { getSavedAnalysisResponse, insertSavedAnalysis, mergeRepeatResponse, savedRequestHash } from "./hamilton-analyses";

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
  const repeat = { request: "written\nPricing\nWhat is the overdraft fee?" };

  it("inserts a new row when no save of the same question is recent", async () => {
    db.tx.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "new" }]);
    expect(await insertSavedAnalysis({ ...input, replaceRecentDuplicate: repeat })).toBe("new");
    const sqls = db.tx.mock.calls.map(text);
    expect(sqls[0]).toContain("pg_advisory_xact_lock");
    expect(sqls[1]).toContain("created_at > NOW() - make_interval");
    expect(sqls[1]).toContain("lower(btrim(regexp_replace(");
    // The full request is matched as well as the question (#1274 review note 1).
    expect(sqls[1]).toContain("response_json->>'request_hash' = ?");
    expect(db.tx.mock.calls[1]).toContain(savedRequestHash(repeat.request));
    // The new row carries the hash, so a later repeat can find it.
    expect(JSON.parse(db.tx.mock.calls[2].find((v: unknown) => typeof v === "string" && v.startsWith("{")) as string))
      .toMatchObject({ request_hash: savedRequestHash(repeat.request) });
    expect(sqls[2]).toContain("INSERT INTO hamilton_saved_analyses");
    // The lock key is this reader and institution.
    expect(db.tx.mock.calls[0][1]).toBe("hamilton_saved_analyses:7:42");
  });

  it("updates the recent row for the same question instead of inserting a second one", async () => {
    db.tx.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "first" }]).mockResolvedValueOnce([{ id: "first" }]);
    expect(await insertSavedAnalysis({ ...input, replaceRecentDuplicate: repeat })).toBe("first");
    const sqls = db.tx.mock.calls.map(text);
    expect(sqls).toHaveLength(3);
    expect(sqls[2]).toContain("UPDATE hamilton_saved_analyses");
    expect(sqls.some((q) => q.includes("INSERT"))).toBe(false);
    // The newer answer is the one kept.
    expect(db.tx.mock.calls[2]).toContain(JSON.stringify({ ...legacy, request_hash: savedRequestHash(repeat.request) }));
  });

  it("keeps the memo an earlier request wrote when the repeat brings none (#1274 review note 2)", async () => {
    const memo = { summary: "Memo summary.", board: "Board.", market: "Market.", questions: ["Why?"], model: "m", generatedAt: "2026-10-14T09:00:00Z", figureCheck: { checked: 2, unmatched: [] } };
    const earlier = { ...legacy, hamiltonView: "Memo summary.", memo, request_hash: savedRequestHash(repeat.request) };
    db.tx.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "first", response_json: earlier }]).mockResolvedValueOnce([{ id: "first" }]);
    expect(await insertSavedAnalysis({ ...input, replaceRecentDuplicate: repeat })).toBe("first");
    const written = JSON.parse(db.tx.mock.calls[2].find((v: unknown) => typeof v === "string" && v.startsWith("{")) as string);
    expect(written).toMatchObject({ memo: { summary: "Memo summary." }, hamiltonView: "Memo summary.", whatThisMeans: "Board.\n\nMarket.", exploreFurther: ["Why?"] });
  });

  it("lets a newer memo, or a row without one, win over the earlier row", () => {
    const old = { ...legacy, memo: { summary: "Old.", board: "", market: "", questions: [], model: "m", generatedAt: "", figureCheck: { checked: 0, unmatched: [] } } };
    const next = { ...legacy, memo: { summary: "New." } } as never;
    expect(mergeRepeatResponse(old, next)).toBe(next);
    expect(mergeRepeatResponse({ ...legacy }, legacy as never)).toBe(legacy);
    expect(mergeRepeatResponse("not json", legacy as never)).toBe(legacy);
    expect((mergeRepeatResponse(JSON.stringify(old), legacy as never) as { memo?: { summary: string } }).memo?.summary).toBe("Old.");
  });

  it("hashes the full request: earlier turns count, case and spacing do not (#1274 review note 1)", () => {
    const followUp = "How does that compare to peers?";
    const afterOverdraft = `written\nPricing\n${followUp}\n\nEarlier in this conversation:\n1. What is our overdraft fee?`;
    const afterNsf = `written\nPricing\n${followUp}\n\nEarlier in this conversation:\n1. What is our NSF fee?`;
    expect(savedRequestHash(afterOverdraft)).not.toBe(savedRequestHash(afterNsf));
    expect(savedRequestHash(afterOverdraft)).toBe(savedRequestHash(`  ${afterOverdraft.toUpperCase().replace(/ /g, "   ")} `));
    // A storyline and a written answer to the same words never share a hash (#1274 review note 3).
    expect(savedRequestHash(`storyline\n\n\noverdraft\n${followUp}`)).not.toBe(savedRequestHash(`written\nPricing\n${followUp}`));
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
