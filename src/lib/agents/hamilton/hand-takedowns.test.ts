import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: vi.fn() }));

import { applyHandTakedowns, HAND_TAKEDOWNS, planHandTakedowns, type LiveTakedownRow } from "./hand-takedowns";

// The two #1496 rows as they read live on prod, read-only, Oct 16.
const LIVE: LiveTakedownRow[] = [
  { fee_published_id: 80423, lineage_ref: 90425, institution_id: 5433, canonical_fee_key: "document_reproduction", fee_name: "Fax (Local)", amount: "15.00" },
  { fee_published_id: 102440, lineage_ref: 116687, institution_id: 5433, canonical_fee_key: "document_reproduction", fee_name: "Fax (Long Distance) Minimum Balance", amount: "2.00" },
  // #1549 and #1512 rows as they read live, read-only, Oct 16 (lineage refs are test values).
  { fee_published_id: 83118, lineage_ref: 1, institution_id: 33, canonical_fee_key: "overdraft", fee_name: "we may use Overdraft Protection Coverage to pay the remaining", amount: "20.00" },
  { fee_published_id: 45619, lineage_ref: 2, institution_id: 7229, canonical_fee_key: "check_printing", fee_name: "Check printing…………………………………………………......…...…(varies by style) | Domestic", amount: "20.00" },
];

function fakeDb(live: LiveTakedownRow[]) {
  const writes: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("SELECT fp.fee_published_id")) return live;
    writes.push({ text, values });
    if (text.includes("UPDATE published_fee_records")) return [{ fee_published_id: values.find((value) => typeof value === "number") }];
    return [];
  });
  return { db, writes };
}

describe("hand takedowns (James, Oct 16)", () => {
  it("lists each confirmed-wrong fee with its reason and evidence", () => {
    expect(HAND_TAKEDOWNS.map((entry) => [entry.feePublishedId, entry.reason])).toEqual([
      [80423, "source_mismatch: #1496"],
      [102440, "source_mismatch: #1496"],
      [83118, "source_mismatch: #1549"],
      [45619, "source_mismatch: #1512"],
    ]);
    expect(HAND_TAKEDOWNS.every((entry) => entry.evidence.length > 0 && entry.reason === `source_mismatch: #${entry.issue}`)).toBe(true);
    // Up to about 25 rows go this way; more go to James.
    expect(HAND_TAKEDOWNS.length).toBeLessThanOrEqual(25);
  });

  it("takes a row down only while it still reads as listed", () => {
    expect(planHandTakedowns(LIVE)).toEqual({
      takenDown: [
        { feePublishedId: 80423, feeVerifiedId: 90425, reason: "source_mismatch: #1496" },
        { feePublishedId: 102440, feeVerifiedId: 116687, reason: "source_mismatch: #1496" },
        { feePublishedId: 83118, feeVerifiedId: 1, reason: "source_mismatch: #1549" },
        { feePublishedId: 45619, feeVerifiedId: 2, reason: "source_mismatch: #1512" },
      ],
      skipped: [],
    });
    const changed = [{ ...LIVE[0], amount: "5.00" }, { ...LIVE[1], fee_name: "Fax (Long Distance)" }];
    expect(planHandTakedowns(changed, HAND_TAKEDOWNS.slice(0, 2))).toEqual({
      takenDown: [],
      skipped: [
        { feePublishedId: 80423, reason: "changed since listed" },
        { feePublishedId: 102440, reason: "changed since listed" },
      ],
    });
    expect(planHandTakedowns([]).skipped.map((row) => row.reason)).toEqual(["not live", "not live", "not live", "not live"]);
  });

  it("archives the row, rejects its verified row, records feedback and one run event", async () => {
    const { db, writes } = fakeDb(LIVE);
    const result = await applyHandTakedowns(db as never, { runId: 9, batchId: "agentic-run-9", dryRun: false });
    expect(result.takenDown.map((item) => item.feePublishedId)).toEqual([80423, 102440, 83118, 45619]);
    const takedowns = writes.filter((write) => write.text.includes("UPDATE published_fee_records"));
    expect(takedowns).toHaveLength(4);
    expect(takedowns[0].text).toContain("AND rolled_back_at IS NULL");
    expect(takedowns[0].text).toContain("AND fee_name = ?");
    expect(takedowns[0].values).toEqual(expect.arrayContaining(["agentic-run-9", "source_mismatch: #1496", 80423, "Fax (Local)", 15]));
    expect(writes.filter((write) => write.text.includes("UPDATE verified_fee_observations"))).toHaveLength(4);
    expect(writes.some((write) => write.text.includes("INSERT INTO pipeline_feedback"))).toBe(true);
    expect(writes.filter((write) => write.text.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
    expect(writes.some((write) => /\bDELETE\b/i.test(write.text))).toBe(false);
  });

  it("writes nothing on a dry run, and nothing again once the rows are down", async () => {
    const dry = fakeDb(LIVE);
    const planned = await applyHandTakedowns(dry.db as never, { runId: 1, batchId: "b", dryRun: true });
    expect(planned.takenDown).toHaveLength(4);
    expect(dry.writes).toHaveLength(0);

    const again = fakeDb([]);
    const result = await applyHandTakedowns(again.db as never, { runId: 2, batchId: "b", dryRun: false });
    expect(result.takenDown).toEqual([]);
    expect(again.writes).toHaveLength(0);
  });
});
