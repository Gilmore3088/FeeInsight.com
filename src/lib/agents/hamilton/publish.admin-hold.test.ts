import { describe, expect, it, vi } from "vitest";

import { insertPublishedFee } from "./publish";

// H03 step 1 (#978): a held fee is not republished under a new id by a re-read of its page.

function createDb(heldRows: unknown[]) {
  const queries: string[] = [];
  const db = vi.fn((strings: TemplateStringsArray) => {
    const query = strings.join("?");
    queries.push(query);
    if (query.includes("quarantine_reason LIKE")) return Promise.resolve(heldRows);
    if (query.includes("INSERT INTO published_fee_records")) return Promise.resolve([{ fee_published_id: 999 }]);
    return Promise.resolve([]);
  });
  return { db: db as never, queries };
}

const row = {
  fee_verified_id: 5,
  institution_id: 809,
  canonical_fee_key: "safe_deposit_box",
  fee_name: "Escheat processing fee",
  amount: "50.00",
  frequency: null,
  variant_type: null,
  source_url: null,
  document_r2_key: null,
  extraction_confidence: 0.9,
  raw_agent_event_id: null,
  verified_by_agent_event_id: null,
} as never;

describe("publishing respects an admin hold", () => {
  it("should_not_publish_a_new_copy_of_a_held_fee", async () => {
    const { db, queries } = createDb([{ fee_published_id: 117687 }]);
    expect(await insertPublishedFee(db, { runId: 1, batchId: "b", row })).toBeNull();
    expect(queries.some((query) => query.includes("INSERT INTO published_fee_records"))).toBe(false);
  });

  it("should_publish_normally_when_no_matching_fee_is_held", async () => {
    const { db } = createDb([]);
    expect(await insertPublishedFee(db, { runId: 1, batchId: "b", row })).toBe(999);
  });
});
