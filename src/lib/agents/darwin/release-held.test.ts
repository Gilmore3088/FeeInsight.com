import { describe, expect, it, vi } from "vitest";

import { trainCategoryModel } from "./category-model";
import { DARWIN_REJECT_SECOND_LOOK_HOURS, DARWIN_RELEASE_ACTS, DARWIN_RELEASE_REJECTS_ACT, DARWIN_RELEASE_STRATEGY, releaseVerdict, runDarwinReleaseHeld, type HeldFeeRow } from "./release-held";

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

function dbWith(
  rows: unknown[],
  verified: Array<Record<string, unknown>> = [],
  extraTexts: Array<Record<string, unknown>> = [],
  earlierRejects: Array<Record<string, unknown>> = [],
): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const query = templateText(strings);
    if (query.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
    if (query.includes("to_regclass('public.pipeline_feedback')")) return Promise.resolve([{ ready: true }]);
    if (query.includes("superseded_by_id")) return Promise.resolve([{ ready: true }]);
    if (query.includes("FROM pipeline_feedback")) return Promise.resolve(earlierRejects);
    if (query.includes("FROM agent_source_texts")) {
      return Promise.resolve([{ source_document_id: 55, normalized_text: text }, ...extraTexts]);
    }
    if (query.includes("FROM verified_fee_observations")) return Promise.resolve(verified);
    return Promise.resolve([]);
  }) as DbMock;
  db.unsafe = vi.fn(() => Promise.resolve(rows));
  return db;
}

describe("Darwin held-fee release", () => {
  it("sends a peer hold the schedule states to review, and rejects one it does not", () => {
    expect(releaseVerdict(held(), text)).toMatchObject({ verdict: "review", sourceCheck: "stated" });
    expect(releaseVerdict(held(), text).sourceLine).toContain("Stop Payment $5.00");
    expect(releaseVerdict(held({ amount: "15.00" }), text)).toMatchObject({ verdict: "reject" });
    expect(releaseVerdict(held(), null)).toMatchObject({ verdict: "reject", sourceCheck: "no_source_text" });
  });

  it("keeps a stated fee outside the hand-set range for a person, since Hamilton would not publish it", () => {
    const boxes = "Safe Deposit Box Rental\nSafe Deposit Box Vault Annual $2,000.00";
    const outside = held({ fee_name: "Safe Deposit Box Vault Annual", amount: "2000.00", held_reason: "outside_envelope", held_canonical_fee_key: "safe_deposit_box" });
    expect(releaseVerdict(outside, boxes)).toMatchObject({ verdict: "keep", sourceCheck: "stated" });
    // A range hold whose amount the hand-set range now accepts (a learned ceiling) goes to review.
    const inside = held({ fee_name: "Safe Deposit Box Vault Annual", amount: "2000.00", held_reason: "outside_envelope", held_canonical_fee_key: "notary_fee" });
    expect(releaseVerdict(inside, boxes).verdict).toBe("review");
  });

  it("keeps a fee whose category Darwin's category model disputes", () => {
    const model = trainCategoryModel([
      ...Array.from({ length: 20 }, () => ({ name: "Stop Payment", categoryKey: "stop_payment", count: 1 })),
      ...Array.from({ length: 20 }, () => ({ name: "Bad Address Fee", categoryKey: "account_research", count: 1 })),
    ]);
    const filedWrong = held({ fee_name: "Stop Payment", held_canonical_fee_key: "account_research" });
    expect(releaseVerdict(filedWrong, text, model)).toMatchObject({ verdict: "keep", sourceCheck: "category_disputed" });
    expect(releaseVerdict(held(), text, model).verdict).toBe("review");
  });

  it("takes two looks before a reject: the first only marks the fee, and nothing is published", async () => {
    expect(DARWIN_RELEASE_ACTS).toBe(false);
    expect(DARWIN_RELEASE_REJECTS_ACT).toBe(true);
    const db = dbWith([held(), held({ fee_raw_id: 12, amount: "15.00" })]);

    const result = await runDarwinReleaseHeld({ runId: 9, stepId: 3, stateCode: "VT", db: db as never });

    expect(result).toMatchObject({ selected: 2, acted: true, released: 0, verdicts: { review: 1, reject_pending: 1 } });
    const statements = db.mock.calls.map(([strings]) => templateText(strings));
    expect(statements.some((query) => query.includes("INSERT INTO verified_fee_observations"))).toBe(false);
    expect(statements.some((query) => query.includes("INSERT INTO pipeline_feedback"))).toBe(false);
    const attempts = db.mock.calls.filter(([strings]) => templateText(strings).includes("INSERT INTO pipeline_attempts"));
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(expect.arrayContaining([DARWIN_RELEASE_STRATEGY.strategy, "raw:11", "ok"]));
    expect(attempts[1]).toEqual(expect.arrayContaining(["raw:12", "unchanged"]));
    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("pa.detail->>'decision' = 'needs_review'");
    expect(query).toMatch(/done.detail->>'verdict' = 'reject_pending'[\s\S]*make_interval/);
    expect(params).toEqual(expect.arrayContaining(["VT", DARWIN_RELEASE_STRATEGY.strategy, DARWIN_REJECT_SECOND_LOOK_HOURS]));
  });

  it("rejects on the second look with a note naming both looks", async () => {
    const db = dbWith([held({ fee_raw_id: 12, amount: "15.00", first_look_at: "2026-10-06T00:00:00Z" })]);

    const result = await runDarwinReleaseHeld({ runId: 9, stepId: 3, db: db as never });

    expect(result.verdicts).toEqual({ reject: 1 });
    const notes = db.mock.calls.filter(([strings]) => templateText(strings).includes("INSERT INTO pipeline_feedback"));
    expect(notes).toHaveLength(1);
    const [note] = JSON.parse(String(notes[0][1])) as Array<Record<string, unknown>>;
    expect(note).toMatchObject({ kind: "not_on_schedule", signal: "wrong", check_name: "darwin.release", dedupe_key: "darwin.release:raw:12" });
    expect(JSON.stringify(note)).toContain("2026-10-06T00:00:00.000Z");
    const attempts = db.mock.calls.filter(([strings]) => templateText(strings).includes("INSERT INTO pipeline_attempts"));
    expect(attempts[0]).toEqual(expect.arrayContaining(["raw:12", "rejected"]));
  });

  it("keeps a fee the bank's current copy states on the second look", async () => {
    const db = dbWith(
      [held({ fee_raw_id: 12, amount: "15.00", first_look_at: "2026-10-06T00:00:00Z", current_document_id: 56 })],
      [],
      [{ source_document_id: 56, normalized_text: "Stop Payment $15.00" }],
    );

    const result = await runDarwinReleaseHeld({ runId: 9, db: db as never });

    expect(result.verdicts).toEqual({ review: 1 });
  });

  it("replaces an earlier version's reject note with a restored one when the fee is stated", async () => {
    const db = dbWith([held()], [], [], [{ fee_raw_id: 11 }]);

    await runDarwinReleaseHeld({ runId: 9, db: db as never });

    const notes = db.mock.calls.filter(([strings]) => templateText(strings).includes("INSERT INTO pipeline_feedback"));
    expect(notes).toHaveLength(1);
    expect(JSON.parse(String(notes[0][1]))).toEqual([
      expect.objectContaining({ kind: "stated_on_later_look", signal: "restored", dedupe_key: "darwin.release:raw:11" }),
    ]);
  });

  it("marks a candidate that matches an already verified fee as a duplicate", async () => {
    const db = dbWith([held()], [{ institution_id: 42, canonical_fee_key: "stop_payment", amount: "5.00", source_url: "https://bank.example/fees.pdf" }]);
    const result = await runDarwinReleaseHeld({ runId: 9, db: db as never });
    expect(result.verdicts).toEqual({ duplicate: 1 });
  });

  it("records nothing on a dry-run agent run", async () => {
    const db = dbWith([held()]);
    const result = await runDarwinReleaseHeld({ runId: 9, dryRun: true, db: db as never });
    expect(result.verdicts).toEqual({ review: 1 });
    expect(db.mock.calls.some(([strings]) => templateText(strings).includes("INSERT"))).toBe(false);
  });
});
