import { beforeEach, describe, expect, it, vi } from "vitest";

import { correctPublishedFee, dismissCorrectionConflict, resetCorrectionsReadyCache, reverseFeeCorrection } from "./fee-corrections";

// H03 (#978): permission, readiness, stale-version and idempotency paths of the correction service,
// with a statement mock. The real transaction, lineage and publish protection run in
// fee-corrections.db.test.ts against PostgreSQL.

type Call = { query: string; values: unknown[] };

function createDb(rowsFor: (query: string, values: unknown[]) => unknown[]) {
  const calls: Call[] = [];
  const tag = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    calls.push({ query, values });
    return Promise.resolve(rowsFor(query, values));
  });
  const db = Object.assign(tag, { begin: vi.fn((callback: (tx: typeof tag) => unknown) => callback(tag)) });
  return { db: db as never, calls };
}

const admin = { id: 1, name: "James", role: "admin" };
const analyst = { id: 2, name: "Ana", role: "analyst" };
const input = {
  feePublishedId: 500,
  expectedVersion: 0,
  idempotencyKey: "key-0000000001",
  canonicalFeeKey: "stop_payment",
  feeName: "Stop Payment Fee",
  amount: "35.00",
  frequency: "per_item",
  conditions: "",
  sourceDocumentId: 900,
  sourceExcerpt: "Stop Payment Fee | $35.00",
  sourceLocation: "Page 1, row 2",
  reason: "Amount read from the wrong row",
};
const liveRow = {
  fee_published_id: 500, institution_id: 7, canonical_fee_key: "stop_payment", fee_name: "Stop Payment Fee",
  amount: 25, frequency: "per_item", variant_type: null, fee_audience: "unknown", amount_kind: "flat",
  fee_treatment: "unknown", conditions: null, lineage_source_document_id: 900,
};

const wrote = (calls: Call[]) => calls.some((call) => /INSERT INTO (published_fee_records|published_fee_corrections|pipeline_feedback|agent_runs)/.test(call.query) || /UPDATE published_fee_records/.test(call.query));

describe("fee correction service", () => {
  beforeEach(() => resetCorrectionsReadyCache());

  it("should_refuse_an_analyst_before_touching_the_database", async () => {
    const { db, calls } = createDb(() => []);
    const result = await correctPublishedFee(db, input, analyst);
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
    expect(calls).toHaveLength(0);
    expect(await reverseFeeCorrection(db, { ...input, reason: "Undo it" }, analyst)).toMatchObject({ ok: false, code: "forbidden" });
    expect((await dismissCorrectionConflict(db, 1, "Older text", analyst)).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("should_refuse_invalid_fields_server_side", async () => {
    const { db, calls } = createDb(() => []);
    const result = await correctPublishedFee(db, { ...input, sourceExcerpt: "", canonicalFeeKey: "nope" }, admin);
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    if (!result.ok) expect(Object.keys(result.errors ?? {})).toEqual(expect.arrayContaining(["sourceExcerpt", "canonicalFeeKey"]));
    expect(calls).toHaveLength(0);
  });

  it("should_say_corrections_are_off_until_the_migration_is_applied", async () => {
    const { db, calls } = createDb((query) => (query.includes("to_regclass") ? [{ ready: false }] : []));
    expect(await correctPublishedFee(db, input, admin)).toMatchObject({ ok: false, code: "unavailable" });
    expect(wrote(calls)).toBe(false);
  });

  it("should_refuse_a_stale_expected_version_and_write_nothing", async () => {
    const { db, calls } = createDb((query) => {
      if (query.includes("to_regclass")) return [{ ready: true }];
      if (query.includes("FOR UPDATE OF fp")) return [liveRow];
      if (query.includes("WHERE fee_published_id = ?") && query.includes("status = 'current'")) return [{ id: 3, fee_chain_id: 400, version: 1, fee_published_id: 500 }];
      return [];
    });
    const result = await correctPublishedFee(db, { ...input, expectedVersion: 0 }, admin);
    expect(result).toMatchObject({ ok: false, code: "stale" });
    expect(wrote(calls)).toBe(false);
  });

  it("should_refuse_a_fee_that_is_no_longer_live", async () => {
    const { db, calls } = createDb((query) => (query.includes("to_regclass") ? [{ ready: true }] : []));
    expect(await correctPublishedFee(db, input, admin)).toMatchObject({ ok: false, code: "stale" });
    expect(wrote(calls)).toBe(false);
  });

  it("should_return_the_first_result_for_a_retried_submission", async () => {
    const { db, calls } = createDb((query) => {
      if (query.includes("to_regclass")) return [{ ready: true }];
      if (query.includes("WHERE idempotency_key")) return [{ id: 11, version: 1, fee_published_id: 501, previous_fee_published_id: 500, institution_id: 7, agent_run_id: 70 }];
      return [];
    });
    const result = await correctPublishedFee(db, input, admin);
    expect(result).toMatchObject({ ok: true, replay: true, correctionId: 11, feePublishedId: 501 });
    expect(wrote(calls)).toBe(false);
  });

  it("should_refuse_a_reused_key_for_another_fee", async () => {
    const { db } = createDb((query) => {
      if (query.includes("to_regclass")) return [{ ready: true }];
      if (query.includes("WHERE idempotency_key")) return [{ id: 11, version: 1, fee_published_id: 601, previous_fee_published_id: 600, institution_id: 7, agent_run_id: null }];
      return [];
    });
    expect(await correctPublishedFee(db, input, admin)).toMatchObject({ ok: false, code: "invalid" });
  });

  it("should_refuse_an_excerpt_the_document_does_not_contain_and_write_nothing", async () => {
    const { db, calls } = createDb((query) => {
      if (query.includes("to_regclass")) return [{ ready: true }];
      if (query.includes("FOR UPDATE OF fp")) return [liveRow];
      if (query.includes("FROM source_documents sd")) return [{ id: 900, institution_id: 7, document_url: "https://bank.test/fees", document_r2_key: null, normalized_text: "Wire Transfer | $25.00" }];
      return [];
    });
    const result = await correctPublishedFee(db, input, admin);
    expect(result).toMatchObject({ ok: false, code: "evidence" });
    if (!result.ok) expect(result.errors?.sourceExcerpt).toBeDefined();
    expect(wrote(calls)).toBe(false);
  });

  it("should_refuse_a_document_of_another_institution", async () => {
    const { db } = createDb((query) => {
      if (query.includes("to_regclass")) return [{ ready: true }];
      if (query.includes("FOR UPDATE OF fp")) return [liveRow];
      if (query.includes("FROM source_documents sd")) return [{ id: 900, institution_id: 8, document_url: null, document_r2_key: null, normalized_text: "Stop Payment Fee | $35.00" }];
      return [];
    });
    expect(await correctPublishedFee(db, input, admin)).toMatchObject({ ok: false, code: "evidence" });
  });

  it("should_refuse_a_correction_the_shared_source_check_does_not_support", async () => {
    const { db, calls } = createDb((query) => {
      if (query.includes("to_regclass")) return [{ ready: true }];
      if (query.includes("FOR UPDATE OF fp")) return [liveRow];
      // The excerpt is there, but the schedule prices the fee at $30, not the $35 typed.
      if (query.includes("FROM source_documents sd")) return [{ id: 900, institution_id: 7, document_url: null, document_r2_key: null, normalized_text: "Stop Payment Fee | $30.00" }];
      return [];
    });
    const result = await correctPublishedFee(db, { ...input, sourceExcerpt: "Stop Payment Fee" }, admin);
    expect(result).toMatchObject({ ok: false, code: "evidence" });
    if (!result.ok) expect(result.errors?.amount).toBeDefined();
    expect(wrote(calls)).toBe(false);
  });

  it("should_refuse_a_reversal_of_a_fee_never_corrected", async () => {
    const { db, calls } = createDb((query) => {
      if (query.includes("to_regclass")) return [{ ready: true }];
      if (query.includes("FOR UPDATE OF fp")) return [liveRow];
      return [];
    });
    const result = await reverseFeeCorrection(db, { feePublishedId: 500, expectedVersion: 0, idempotencyKey: "key-0000000002", reason: "Undo it" }, admin);
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(wrote(calls)).toBe(false);
  });
});
