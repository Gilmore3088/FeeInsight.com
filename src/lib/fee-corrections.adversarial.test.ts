import { beforeEach, describe, expect, it, vi } from "vitest";

// H03-T11 (#978): adversarial cases for the admin correction service, with a statement mock. Each
// case says what reaches the database. fee-corrections.db.test.ts runs the real transaction
// against PostgreSQL; these run in every CI pass.

const indexRefresh = vi.hoisted(() => ({ fn: vi.fn<(...args: unknown[]) => Promise<unknown>>() }));
vi.mock("@/lib/data-store/fee-index", () => ({ refreshFeeIndexCache: (...args: unknown[]) => indexRefresh.fn(...args) }));
const feedback = vi.hoisted(() => ({ fn: vi.fn<(...args: unknown[]) => Promise<number>>(async () => 1) }));
vi.mock("@/lib/agents/learning/feedback", () => ({ recordFeedback: (...args: unknown[]) => feedback.fn(...args) }));

import { correctPublishedFee, resetCorrectionsReadyCache, reverseFeeCorrection } from "./fee-corrections";

type Call = { query: string; values: unknown[] };
type Rows = (query: string, values: unknown[]) => unknown[] | Promise<unknown[]>;

/** A tagged-template mock with a `begin` that, like postgres, rolls back when the callback throws. */
function createDb(rowsFor: Rows) {
  const calls: Call[] = [];
  const committed: Call[] = [];
  const tag = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    calls.push({ query, values });
    return rowsFor(query, values);
  });
  const db = Object.assign(tag, {
    begin: vi.fn(async (callback: (tx: typeof tag) => unknown) => {
      const start = calls.length;
      const result = await callback(tag);
      committed.push(...calls.slice(start));
      return result;
    }),
  });
  return { db: db as never, calls, committed };
}

const admin = { id: 1, name: "James", role: "admin" };
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
const doc = { id: 900, institution_id: 7, document_url: "https://bank.test/fees", document_r2_key: null, normalized_text: "Stop Payment Fee | $35.00" };

/** Rows for a correction that gets all the way to its writes. */
function happyRows(overrides: Partial<Record<"live" | "doc" | "current", unknown[]>> = {}): Rows {
  return (query) => {
    if (query.includes("to_regclass")) return [{ ready: true }];
    if (query.includes("WHERE idempotency_key")) return [];
    if (query.includes("FOR UPDATE OF fp")) return overrides.live ?? [liveRow];
    if (query.includes("status = 'current'") && query.includes("LIMIT 1")) return overrides.current ?? [];
    if (query.includes("FROM source_documents sd")) return overrides.doc ?? [doc];
    if (query.includes("INSERT INTO agent_runs")) return [{ id: 70 }];
    if (query.includes("INSERT INTO agent_run_steps")) return [{ id: 71 }];
    if (query.includes("INSERT INTO published_fee_records")) return [{ fee_published_id: 501 }];
    if (query.includes("UPDATE published_fee_records")) return [{ fee_published_id: 500 }];
    if (query.includes("INSERT INTO published_fee_corrections")) return [{ id: 11 }];
    return [];
  };
}

const WRITE = /INSERT INTO (published_fee_records|published_fee_corrections|agent_runs|agent_run_steps|agent_run_events)|UPDATE (published_fee_records|published_fee_corrections)/;
const wrote = (calls: Call[]) => calls.some((call) => WRITE.test(call.query)) || feedback.fn.mock.calls.length > 0;

beforeEach(() => {
  resetCorrectionsReadyCache();
  feedback.fn.mockClear();
  indexRefresh.fn.mockReset();
  indexRefresh.fn.mockResolvedValue({ refreshed: true, categories: 49 });
});

describe("a correction that passes every check", () => {
  it("should_publish_a_new_version_with_its_audit_row_and_run_in_one_transaction", async () => {
    const { db, committed } = createDb(happyRows());
    const result = await correctPublishedFee(db, input, admin);
    expect(result).toMatchObject({ ok: true, version: 1, feePublishedId: 501, previousFeePublishedId: 500, runId: 70, indexRefreshed: true, replay: false });
    expect(committed.some((c) => c.query.includes("INSERT INTO published_fee_corrections"))).toBe(true);
    expect(feedback.fn).toHaveBeenCalledTimes(1);
  });
});

describe("unauthorized roles", () => {
  for (const role of ["analyst", "viewer", "premium", "", "Admin"]) {
    it(`should_refuse_role_${role || "none"}_before_any_query`, async () => {
      const { db, calls } = createDb(happyRows());
      const actor = { id: 9, name: "Someone", role };
      expect(await correctPublishedFee(db, input, actor)).toMatchObject({ ok: false, code: "forbidden" });
      expect(await reverseFeeCorrection(db, { ...input, reason: "Undo the change" }, actor)).toMatchObject({ ok: false, code: "forbidden" });
      expect(calls).toHaveLength(0);
    });
  }
});

describe("duplicate submissions", () => {
  it("should_replay_a_retry_whose_first_attempt_committed_while_it_waited_on_the_lock", async () => {
    let lookups = 0;
    const { db, calls } = createDb((query) => {
      if (query.includes("to_regclass")) return [{ ready: true }];
      // First look: nothing yet. After the lock: the first click's row is there.
      if (query.includes("WHERE idempotency_key")) {
        lookups += 1;
        return lookups === 1 ? [] : [{ id: 11, version: 1, fee_published_id: 501, previous_fee_published_id: 500, institution_id: 7, agent_run_id: 70 }];
      }
      return [];
    });
    expect(await correctPublishedFee(db, input, admin)).toMatchObject({ ok: true, replay: true, correctionId: 11 });
    expect(wrote(calls)).toBe(false);
  });

  it("should_replay_when_two_clicks_race_past_the_lock_and_the_second_hits_the_unique_key", async () => {
    let lookups = 0;
    const base = happyRows();
    const { db } = createDb((query, values) => {
      if (query.includes("WHERE idempotency_key")) {
        lookups += 1;
        return lookups === 1 ? [] : [{ id: 11, version: 1, fee_published_id: 501, previous_fee_published_id: 500, institution_id: 7, agent_run_id: 70 }];
      }
      if (query.includes("INSERT INTO published_fee_corrections")) throw Object.assign(new Error("duplicate key"), { code: "23505" });
      return base(query, values);
    });
    expect(await correctPublishedFee(db, input, admin)).toMatchObject({ ok: true, replay: true, correctionId: 11 });
  });
});

describe("concurrent editors", () => {
  it("should_refuse_the_second_editor_once_the_first_superseded_the_row", async () => {
    // The first editor's commit took the row out of the live set, so the lock finds nothing.
    const { db, calls } = createDb(happyRows({ live: [] }));
    const second = { ...input, idempotencyKey: "key-0000000002", amount: "30.00" };
    expect(await correctPublishedFee(db, second, admin)).toMatchObject({ ok: false, code: "stale" });
    expect(wrote(calls)).toBe(false);
  });

  it("should_refuse_an_editor_who_opened_the_form_before_a_newer_version", async () => {
    const { db, calls } = createDb(happyRows({ current: [{ id: 3, fee_chain_id: 400, version: 2, fee_published_id: 500, conditions: null }] }));
    expect(await correctPublishedFee(db, { ...input, expectedVersion: 1 }, admin)).toMatchObject({ ok: false, code: "stale" });
    expect(await reverseFeeCorrection(db, { feePublishedId: 500, expectedVersion: 1, idempotencyKey: "key-0000000003", reason: "Undo the change" }, admin)).toMatchObject({ ok: false, code: "stale" });
    expect(wrote(calls)).toBe(false);
  });

  it("should_say_stale_when_two_editors_race_on_the_same_version", async () => {
    const base = happyRows();
    const { db } = createDb((query, values) => {
      if (query.includes("INSERT INTO published_fee_corrections")) throw Object.assign(new Error("duplicate chain version"), { code: "23505" });
      return base(query, values);
    });
    expect(await correctPublishedFee(db, input, admin)).toMatchObject({ ok: false, code: "stale" });
  });
});

describe("missing source or excerpt", () => {
  it("should_refuse_a_form_with_no_document_excerpt_or_location_before_any_query", async () => {
    const { db, calls } = createDb(happyRows());
    const result = await correctPublishedFee(db, { ...input, sourceDocumentId: "", sourceExcerpt: "  ", sourceLocation: "" }, admin);
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    if (!result.ok) expect(Object.keys(result.errors ?? {})).toEqual(expect.arrayContaining(["sourceDocumentId", "sourceExcerpt", "sourceLocation"]));
    expect(calls).toHaveLength(0);
  });

  it("should_refuse_a_document_that_does_not_exist", async () => {
    const { db, calls } = createDb(happyRows({ doc: [] }));
    const result = await correctPublishedFee(db, input, admin);
    expect(result).toMatchObject({ ok: false, code: "evidence" });
    if (!result.ok) expect(result.errors?.sourceDocumentId).toBeDefined();
    expect(wrote(calls)).toBe(false);
  });

  it("should_refuse_a_document_with_no_stored_text", async () => {
    const { db, calls } = createDb(happyRows({ doc: [{ ...doc, normalized_text: null }] }));
    const result = await correctPublishedFee(db, input, admin);
    expect(result).toMatchObject({ ok: false, code: "evidence" });
    if (!result.ok) expect(result.error).toMatch(/no stored text/);
    expect(wrote(calls)).toBe(false);
  });
});

describe("wrong unit", () => {
  for (const amount of ["1.5%", "$35/month", "35.005", "-5", "100000", "thirty five"]) {
    it(`should_refuse_the_amount_${JSON.stringify(amount)}_before_any_query`, async () => {
      const { db, calls } = createDb(happyRows());
      const result = await correctPublishedFee(db, { ...input, amount }, admin);
      expect(result).toMatchObject({ ok: false, code: "invalid" });
      if (!result.ok) expect(result.errors?.amount).toBeDefined();
      expect(calls).toHaveLength(0);
    });
  }

  it("should_refuse_a_frequency_outside_the_catalog", async () => {
    const { db, calls } = createDb(happyRows());
    const result = await correctPublishedFee(db, { ...input, frequency: "per_month" }, admin);
    if (!result.ok) expect(result.errors?.frequency).toBeDefined();
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("should_refuse_to_correct_a_fee_stated_as_a_rate_into_a_dollar_amount", async () => {
    const { db, calls } = createDb(happyRows({ live: [{ ...liveRow, canonical_fee_key: "card_foreign_txn", amount: null, amount_kind: "percent" }] }));
    const result = await correctPublishedFee(db, input, admin);
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    if (!result.ok) expect(result.error).toMatch(/rate/);
    expect(wrote(calls)).toBe(false);
  });

  it("should_refuse_a_dollar_amount_for_a_fee_name_that_states_a_rate", async () => {
    const rateDoc = { ...doc, normalized_text: "Foreign Transaction Fee 3% of each transaction | $3.00" };
    const { db, calls } = createDb(happyRows({ doc: [rateDoc] }));
    const result = await correctPublishedFee(db, {
      ...input,
      canonicalFeeKey: "card_foreign_txn",
      feeName: "Foreign Transaction Fee 3% of each transaction",
      amount: "3.00",
      sourceExcerpt: "Foreign Transaction Fee 3% of each transaction",
    }, admin);
    expect(result).toMatchObject({ ok: false, code: "evidence" });
    if (!result.ok) expect(result.errors?.canonicalFeeKey).toMatch(/rate/);
    expect(wrote(calls)).toBe(false);
  });

  it("should_refuse_a_price_on_a_fee_whose_source_says_no_charge", async () => {
    const { db, calls } = createDb(happyRows({ live: [{ ...liveRow, amount: 0, fee_treatment: "no_charge" }] }));
    const result = await correctPublishedFee(db, input, admin);
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    if (!result.ok) expect(result.errors?.amount).toMatch(/no charge/);
    expect(wrote(calls)).toBe(false);
  });
});

describe("wrong category", () => {
  it("should_refuse_a_category_outside_the_taxonomy_before_any_query", async () => {
    const { db, calls } = createDb(happyRows());
    const result = await correctPublishedFee(db, { ...input, canonicalFeeKey: "stop_payments" }, admin);
    if (!result.ok) expect(result.errors?.canonicalFeeKey).toBeDefined();
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("should_refuse_a_category_the_source_line_does_not_support", async () => {
    // A stop payment line filed as an overdraft: the shared source check or category guard refuses it.
    const { db, calls } = createDb(happyRows());
    const result = await correctPublishedFee(db, { ...input, canonicalFeeKey: "overdraft" }, admin);
    expect(result).toMatchObject({ ok: false, code: "evidence" });
    expect(wrote(calls)).toBe(false);
  });
});

describe("database failure", () => {
  it("should_roll_back_and_throw_when_a_write_fails_mid_transaction", async () => {
    const base = happyRows();
    const { db, committed } = createDb((query, values) => {
      if (query.includes("INSERT INTO published_fee_corrections")) throw Object.assign(new Error("connection reset"), { code: "08006" });
      return base(query, values);
    });
    await expect(correctPublishedFee(db, input, admin)).rejects.toThrow("connection reset");
    // The run, the new row and the superseded mark were all inside the failed transaction.
    expect(committed).toHaveLength(0);
    expect(feedback.fn).not.toHaveBeenCalled();
  });

  it("should_throw_when_the_superseded_row_cannot_be_marked", async () => {
    const base = happyRows();
    const { db, committed } = createDb((query, values) => (query.includes("UPDATE published_fee_records") ? [] : base(query, values)));
    await expect(correctPublishedFee(db, input, admin)).rejects.toThrow(/could not be marked superseded/);
    expect(committed).toHaveLength(0);
  });
});

describe("failed refresh", () => {
  it("should_keep_the_correction_and_record_a_failed_index_rebuild", async () => {
    indexRefresh.fn.mockRejectedValue(new Error("statement timeout"));
    const { db, committed } = createDb(happyRows());
    const result = await correctPublishedFee(db, input, admin);
    expect(result).toMatchObject({ ok: true, indexRefreshed: false, runId: 70 });
    const event = committed.find((c) => c.query.includes("INSERT INTO agent_run_events") && c.values.includes("failed"));
    expect(event).toBeDefined();
    expect(String(event?.values.find((v) => typeof v === "string" && v.includes("not rebuilt")))).toMatch(/statement timeout/);
  });
});
