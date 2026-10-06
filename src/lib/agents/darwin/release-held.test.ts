import { describe, expect, it, vi } from "vitest";

import { DARWIN_RELEASE_ACTS, DARWIN_RELEASE_STRATEGY, releaseVerdict, runDarwinReleaseHeld, type HeldFeeRow } from "./release-held";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

const text = "Fee Schedule\nStop Payment $5.00\nNon-Sufficient Funds Fee $36.00\nMinimum balance to open $500.00";

const held = (overrides: Record<string, unknown> = {}): HeldFeeRow => ({
  fee_raw_id: 11,
  institution_id: 42,
  source_url: "https://bank.example/fees.pdf",
  document_r2_key: null,
  extraction_confidence: null,
  fee_name: "Stop Payment",
  amount: "5.00",
  frequency: null,
  outlier_flags: ["canonical_hint:stop_payment"],
  conditions: null,
  institution_name: "Example Bank",
  source_document_id: 55,
  state_code: "VT",
  held_reason: "peer_outlier",
  held_canonical_fee_key: "stop_payment",
  ...overrides,
}) as HeldFeeRow;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function dbWith(rows: unknown[], verified: Array<Record<string, unknown>> = []): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const query = templateText(strings);
    if (query.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
    if (query.includes("FROM agent_source_texts")) return Promise.resolve([{ source_document_id: 55, normalized_text: text }]);
    if (query.includes("FROM verified_fee_observations")) return Promise.resolve(verified);
    return Promise.resolve([]);
  }) as DbMock;
  db.unsafe = vi.fn(() => Promise.resolve(rows));
  return db;
}

describe("Darwin held-fee release", () => {
  it("releases a peer hold the schedule states, and rejects one it does not", () => {
    expect(releaseVerdict(held(), text)).toMatchObject({ verdict: "release", sourceCheck: "stated" });
    expect(releaseVerdict(held({ amount: "15.00" }), text)).toMatchObject({ verdict: "reject" });
    expect(releaseVerdict(held(), null)).toMatchObject({ verdict: "reject", sourceCheck: "no_source_text" });
  });

  it("keeps a stated fee outside the hand-set range for a person, since Hamilton would not publish it", () => {
    const boxes = "Safe Deposit Box Rental\nSafe Deposit Box Vault Annual $2,000.00";
    const outside = held({ fee_name: "Safe Deposit Box Vault Annual", amount: "2000.00", held_reason: "outside_envelope", held_canonical_fee_key: "safe_deposit_box" });
    expect(releaseVerdict(outside, boxes)).toMatchObject({ verdict: "keep", sourceCheck: "stated" });
    // A range hold whose amount the hand-set range now accepts (a learned ceiling) is released.
    const inside = held({ fee_name: "Safe Deposit Box Vault Annual", amount: "2000.00", held_reason: "outside_envelope", held_canonical_fee_key: "notary_fee" });
    expect(releaseVerdict(inside, boxes).verdict).toBe("release");
  });

  it("is a dry run at version 1: verdicts in the attempt log, nothing inserted", async () => {
    expect(DARWIN_RELEASE_ACTS).toBe(false);
    const db = dbWith([held(), held({ fee_raw_id: 12, amount: "15.00" })]);

    const result = await runDarwinReleaseHeld({ runId: 9, stepId: 3, stateCode: "VT", db: db as never });

    expect(result).toMatchObject({ selected: 2, acted: false, released: 0, verdicts: { release: 1, reject: 1 } });
    const statements = db.mock.calls.map(([strings]) => templateText(strings));
    expect(statements.some((query) => query.includes("INSERT INTO verified_fee_observations"))).toBe(false);
    const attempts = db.mock.calls.filter(([strings]) => templateText(strings).includes("INSERT INTO pipeline_attempts"));
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(expect.arrayContaining([DARWIN_RELEASE_STRATEGY.strategy, "raw:11", "ok"]));
    expect(attempts[1]).toEqual(expect.arrayContaining(["raw:12", "rejected"]));
    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("pa.detail->>'decision' = 'needs_review'");
    expect(params).toEqual(expect.arrayContaining(["VT", DARWIN_RELEASE_STRATEGY.strategy]));
  });

  it("marks a release that matches an already verified fee as a duplicate", async () => {
    const db = dbWith([held()], [{ institution_id: 42, canonical_fee_key: "stop_payment", amount: "5.00", source_url: "https://bank.example/fees.pdf" }]);
    const result = await runDarwinReleaseHeld({ runId: 9, db: db as never });
    expect(result.verdicts).toEqual({ duplicate: 1 });
  });

  it("records nothing on a dry-run agent run", async () => {
    const db = dbWith([held()]);
    const result = await runDarwinReleaseHeld({ runId: 9, dryRun: true, db: db as never });
    expect(result.verdicts).toEqual({ release: 1 });
    expect(db.mock.calls.some(([strings]) => templateText(strings).includes("INSERT"))).toBe(false);
  });
});
