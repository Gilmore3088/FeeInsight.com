import { describe, expect, it, vi } from "vitest";

import { insertPublishedFee } from "./publish";

// H03 step 1 (#978): a held fee is not republished under a new id by a re-read of its page.

function createDb(heldRows: unknown[]) {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    calls.push({ query, values });
    if (query.includes("AS verified_state")) return Promise.resolve([{ ...(row as object), selected_verified_state: "unchanged fixture", verified_state: "unchanged fixture" }]);
    if (query.includes("to_jsonb(verified_fee_observations)")) return Promise.resolve([{ fee_verified_id: 5 }]);
    if (query.includes("left(quarantine_reason")) return Promise.resolve(heldRows);
    if (query.includes("INSERT INTO published_fee_records")) return Promise.resolve([{ fee_published_id: 999 }]);
    return Promise.resolve([]);
  });
  Object.assign(db, { savepoint: (work: (scope: typeof db) => Promise<unknown>) => work(db) });
  return { db: db as never, calls };
}

const row = {
  fee_verified_id: 5,
  institution_id: 809,
  canonical_fee_key: "safe_deposit_box",
  fee_name: "Escheat processing fee",
  amount: "50.00",
  frequency: null,
  variant_type: null,
  fee_audience: "business",
  source_url: null,
  document_r2_key: null,
  extraction_confidence: 0.9,
  raw_agent_event_id: null,
  verified_by_agent_event_id: null,
} as never;

describe("publishing respects an admin hold", () => {
  it("should_not_publish_a_new_copy_of_a_held_fee_and_say_why", async () => {
    const { db, calls } = createDb([{ fee_published_id: 117687 }]);
    const onHeld = vi.fn();
    expect(await insertPublishedFee(db, { runId: 1, batchId: "b", row, onHeld })).toBeNull();
    expect(onHeld).toHaveBeenCalledWith(117687);
    expect(calls.some((call) => call.query.includes("INSERT INTO published_fee_records"))).toBe(false);
  });

  it("should_match_the_held_line_by_name_ignoring_punctuation_and_case_and_by_charge_basis", async () => {
    const { db, calls } = createDb([]);
    await insertPublishedFee(db, { runId: 1, batchId: "b", row });
    const check = calls.find((call) => call.query.includes("left(quarantine_reason"));
    expect(check?.query).toContain("regexp_replace(lower(fee_name)");
    expect(check?.query).toContain("amount_kind =");
    expect(check?.query).toContain("COALESCE(variant_type, '')");
    expect(check?.query).toContain("COALESCE(frequency, '')");
    // A closed held row still blocks: the guard does not require rolled_back_at IS NULL.
    expect(check?.query).not.toContain("rolled_back_at");
    // Consumer and business publications of one line are different fees.
    expect(check?.query).toContain("fee_audience IN ('unknown', 'both')");
    expect(check?.values).toContain("business");
  });

  it("should_publish_normally_when_no_matching_fee_is_held", async () => {
    const { db } = createDb([]);
    expect(await insertPublishedFee(db, { runId: 1, batchId: "b", row })).toBe(999);
  });
});
