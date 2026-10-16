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
  // #1370's two held subordination rows as they read live on prod, read-only, Oct 16.
  { fee_published_id: 116720, lineage_ref: 138129, institution_id: 8459, canonical_fee_key: "other_lending_fee", fee_name: "SUBORDINATION REQUEST & PARTIAL: WIRE TRANSFER", amount: "20.00" },
  { fee_published_id: 134129, lineage_ref: 154983, institution_id: 4815, canonical_fee_key: "other_lending_fee", fee_name: "Subordination Fee: Business", amount: "10.00" },
  // The #1534 review's three loan-payment rows, as they read live, read-only, Oct 16.
  { fee_published_id: 48113, lineage_ref: 53370, institution_id: 7483, canonical_fee_key: "safe_deposit_box", fee_name: "Returned loan payment", amount: "25.00" },
  { fee_published_id: 87307, lineage_ref: 96812, institution_id: 5054, canonical_fee_key: "ach_return", fee_name: "Returned Loan Payment (check or ACH returned unpaid; per item)", amount: "25.00" },
  { fee_published_id: 134962, lineage_ref: 156021, institution_id: 8566, canonical_fee_key: "account_research", fee_name: "Loan Payment with Debit Card - Chargeback", amount: "29.50" },
  // The #1549 follow-ups (Flagstar's older-form overdraft, two Pinnacle transfer lines), as they read live, read-only, Oct 16.
  { fee_published_id: 83125, lineage_ref: 92572, institution_id: 33, canonical_fee_key: "overdraft", fee_name: "Overdraft Charge (each)", amount: "10.00" },
  { fee_published_id: 97335, lineage_ref: 110368, institution_id: 184, canonical_fee_key: "od_protection_transfer", fee_name: "OVERDRAFT TRANSFER", amount: "10.00" },
  { fee_published_id: 97904, lineage_ref: 111117, institution_id: 850, canonical_fee_key: "od_protection_transfer", fee_name: "overdrawn. Features of Overdraft Transfer include", amount: "32.00" },
];
const IDS = [80423, 102440, 83118, 45619, 116720, 134129, 48113, 87307, 134962, 83125, 97335, 97904];

function fakeDb(live: LiveTakedownRow[], failOn?: string) {
  const writes: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (failOn && text.includes(failOn)) throw new Error(`boom: ${failOn}`);
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
      [116720, "source_mismatch: #1370"],
      [134129, "source_mismatch: #1370"],
      [48113, "source_mismatch: #1534"],
      [87307, "source_mismatch: #1534"],
      [134962, "source_mismatch: #1534"],
      [83125, "source_mismatch: #1549"],
      [97335, "source_mismatch: #1549"],
      [97904, "source_mismatch: #1549"],
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
        { feePublishedId: 116720, feeVerifiedId: 138129, reason: "source_mismatch: #1370" },
        { feePublishedId: 134129, feeVerifiedId: 154983, reason: "source_mismatch: #1370" },
        { feePublishedId: 48113, feeVerifiedId: 53370, reason: "source_mismatch: #1534" },
        { feePublishedId: 87307, feeVerifiedId: 96812, reason: "source_mismatch: #1534" },
        { feePublishedId: 134962, feeVerifiedId: 156021, reason: "source_mismatch: #1534" },
        { feePublishedId: 83125, feeVerifiedId: 92572, reason: "source_mismatch: #1549" },
        { feePublishedId: 97335, feeVerifiedId: 110368, reason: "source_mismatch: #1549" },
        { feePublishedId: 97904, feeVerifiedId: 111117, reason: "source_mismatch: #1549" },
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
    expect(planHandTakedowns([]).skipped.map((row) => row.reason)).toEqual(IDS.map(() => "not live"));
    // Another institution or category at the same id, name and price is not the listed row.
    const moved = [{ ...LIVE[4], institution_id: 1 }, { ...LIVE[5], canonical_fee_key: "legal_process" }];
    expect(planHandTakedowns(moved, HAND_TAKEDOWNS.slice(4, 6)).skipped.map((row) => row.reason)).toEqual(["changed since listed", "changed since listed"]);
  });

  it("archives the row, rejects its verified row, records feedback and one run event", async () => {
    const { db, writes } = fakeDb(LIVE);
    const result = await applyHandTakedowns(db as never, { runId: 9, batchId: "agentic-run-9", dryRun: false });
    expect(result.takenDown.map((item) => item.feePublishedId)).toEqual(IDS);
    expect(result.error).toBeNull();
    const takedowns = writes.filter((write) => write.text.includes("UPDATE published_fee_records"));
    expect(takedowns).toHaveLength(IDS.length);
    // The UPDATE repeats every listed field, so a row changed after the read is left alone.
    expect(takedowns[0].text).toContain("AND rolled_back_at IS NULL");
    expect(takedowns[0].text).toContain("AND institution_id = ?");
    expect(takedowns[0].text).toContain("AND canonical_fee_key = ?");
    expect(takedowns[0].text).toContain("AND fee_name = ?");
    expect(takedowns[0].values).toEqual(expect.arrayContaining(["agentic-run-9", "source_mismatch: #1496", 80423, 5433, "document_reproduction", "Fax (Local)", 15]));
    expect(takedowns[5].values).toEqual(expect.arrayContaining(["source_mismatch: #1370", 134129, 4815, "other_lending_fee", "Subordination Fee: Business", 10]));
    // Flagstar's $10 overdraft comes down; its current $30 (83117) is not listed and stays live.
    expect(takedowns[9].values).toEqual(expect.arrayContaining(["source_mismatch: #1549", 83125, 33, "overdraft", "Overdraft Charge (each)", 10]));
    expect(HAND_TAKEDOWNS.some((entry) => entry.feePublishedId === 83117)).toBe(false);
    expect(writes.filter((write) => write.text.includes("UPDATE verified_fee_observations"))).toHaveLength(IDS.length);
    expect(writes.some((write) => write.text.includes("INSERT INTO pipeline_feedback"))).toBe(true);
    expect(writes.filter((write) => write.text.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
    expect(writes.some((write) => /\bDELETE\b/i.test(write.text))).toBe(false);
  });

  it("writes nothing on a dry run, and nothing again once the rows are down", async () => {
    const dry = fakeDb(LIVE);
    const planned = await applyHandTakedowns(dry.db as never, { runId: 1, batchId: "b", dryRun: true });
    expect(planned.takenDown).toHaveLength(IDS.length);
    expect(dry.writes).toHaveLength(0);

    const again = fakeDb([]);
    const result = await applyHandTakedowns(again.db as never, { runId: 2, batchId: "b", dryRun: false });
    expect(result.takenDown).toEqual([]);
    expect(again.writes).toHaveLength(0);
  });

  it("puts a failed read or write in the run ledger instead of failing the publish", async () => {
    const read = fakeDb(LIVE, "SELECT fp.fee_published_id");
    const readResult = await applyHandTakedowns(read.db as never, { runId: 3, stepId: 30, batchId: "b", dryRun: false });
    expect(readResult).toMatchObject({ takenDown: [], error: "boom: SELECT fp.fee_published_id" });
    expect(read.writes).toHaveLength(1);
    expect(read.writes[0].text).toContain("INSERT INTO agent_run_events");
    expect(read.writes[0].values).toEqual(expect.arrayContaining([3, 30, "Hand takedowns read failed, nothing written: boom: SELECT fp.fee_published_id"]));

    const write = fakeDb(LIVE, "UPDATE verified_fee_observations");
    const writeResult = await applyHandTakedowns(write.db as never, { runId: 4, stepId: 40, batchId: "b", dryRun: false });
    expect(writeResult.takenDown).toEqual([]);
    expect(writeResult.error).toBe("boom: UPDATE verified_fee_observations");
    const warning = write.writes.find((entry) => entry.text.includes("'step.warning'"));
    expect(warning?.values).toEqual(expect.arrayContaining([4, 40]));
    expect(String(warning?.values.at(-1))).toContain("hamilton.hand_takedown");
  });
});
