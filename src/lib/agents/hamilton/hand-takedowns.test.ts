import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: vi.fn() }));

import {
  applyHandAudienceFixes, applyHandTakedowns, HAND_AUDIENCE_FIXES, HAND_TAKEDOWNS, handAudienceEvidence, planHandAudienceFixes,
  planHandTakedowns, type LiveAudienceRow, type LiveTakedownRow,
} from "./hand-takedowns";

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
  // #1302's two leftovers as they read live on prod, read-only, Oct 16.
  { fee_published_id: 13188, lineage_ref: 5161, institution_id: 44, canonical_fee_key: "gift_card_purchase", fee_name: "Visa Gift Card", amount: "4.25" },
  { fee_published_id: 144352, lineage_ref: 174382, institution_id: 6152, canonical_fee_key: "late_payment", fee_name: "Late payment fees", amount: "35.00" },
  { fee_published_id: 114273, lineage_ref: 101242, institution_id: 6152, canonical_fee_key: "late_payment", fee_name: "Late payment fees", amount: "35.00" },
];
const IDS = [80423, 102440, 83118, 45619, 116720, 134129, 48113, 87307, 134962, 13188, 144352, 114273];

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
      [13188, "duplicate of #103400 (#1302)"],
      [144352, "source_mismatch: #1302"],
      [114273, "source_mismatch: #1302"],
    ]);
    // A wrong read names its issue; a second read of one printed fee names the live copy it repeats too.
    expect(HAND_TAKEDOWNS.every((entry) => entry.evidence.length > 0 && (entry.kind === "duplicate"
      ? /^duplicate of #\d+ \(#\d+\)$/.test(entry.reason) && entry.reason.endsWith(`(#${entry.issue})`)
      : entry.reason === `source_mismatch: #${entry.issue}`))).toBe(true);
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
        { feePublishedId: 13188, feeVerifiedId: 5161, reason: "duplicate of #103400 (#1302)" },
        { feePublishedId: 144352, feeVerifiedId: 174382, reason: "source_mismatch: #1302" },
        { feePublishedId: 114273, feeVerifiedId: 101242, reason: "source_mismatch: #1302" },
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

// 55401 as it reads live on prod with its verified row 45477 joined, read-only, Oct 16.
const AUDIENCE_LIVE: LiveAudienceRow[] = [
  { fee_published_id: 55401, lineage_ref: 45477, institution_id: 8652, canonical_fee_key: "gift_card_purchase", fee_name: "Gift Cards", amount: "5.00", fee_audience: "unknown", audience_evidence: null },
];

function fakeAudienceDb(live: LiveAudienceRow[], failOn?: string) {
  const writes: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (failOn && text.includes(failOn)) throw new Error(`boom: ${failOn}`);
    if (text.includes("SELECT fp.fee_published_id")) return live;
    writes.push({ text, values });
    if (text.includes("UPDATE verified_fee_observations")) return [{ fee_verified_id: 45477 }];
    return [];
  });
  return { db, writes };
}

describe("hand audience fixes (#1302)", () => {
  it("lists 55401 as a business fee, with darwin: evidence the audience trigger keeps", () => {
    expect(HAND_AUDIENCE_FIXES.map((fix) => [fix.feePublishedId, fix.from, fix.to])).toEqual([[55401, "unknown", "business"]]);
    expect(HAND_AUDIENCE_FIXES.every((fix) => handAudienceEvidence(fix).startsWith("darwin:hand_fix: #1302 "))).toBe(true);
    expect(HAND_AUDIENCE_FIXES.length + HAND_TAKEDOWNS.length).toBeLessThanOrEqual(25);
  });

  it("fixes a row only while it still reads as listed, and once", () => {
    expect(planHandAudienceFixes(AUDIENCE_LIVE)).toEqual({
      fixed: [{ feePublishedId: 55401, feeVerifiedId: 45477, from: "unknown", fromEvidence: null, to: "business" }],
      skipped: [],
    });
    expect(planHandAudienceFixes([]).skipped).toEqual([{ feePublishedId: 55401, reason: "not live" }]);
    expect(planHandAudienceFixes([{ ...AUDIENCE_LIVE[0], fee_audience: "business" }]).skipped).toEqual([{ feePublishedId: 55401, reason: "already fixed" }]);
    // Another audience, a newer verified row, or another name or price is not the listed row.
    for (const changed of [{ fee_audience: "consumer" }, { lineage_ref: 99 }, { amount: "4.00" }, { fee_name: "Gift Card" }]) {
      expect(planHandAudienceFixes([{ ...AUDIENCE_LIVE[0], ...changed }]).skipped).toEqual([{ feePublishedId: 55401, reason: "changed since listed" }]);
    }
  });

  it("sets the verified audience, touches the live row, records the old value and one run event", async () => {
    const { db, writes } = fakeAudienceDb(AUDIENCE_LIVE);
    const result = await applyHandAudienceFixes(db as never, { runId: 9, stepId: 90, dryRun: false });
    expect(result).toMatchObject({ fixed: [{ feePublishedId: 55401, to: "business" }], error: null });
    const verified = writes.find((write) => write.text.includes("UPDATE verified_fee_observations"));
    expect(verified?.text).toContain("AND fee_audience = ?");
    expect(verified?.values).toEqual(["business", handAudienceEvidence(HAND_AUDIENCE_FIXES[0]), 45477, "unknown"]);
    const touched = writes.find((write) => write.text.includes("UPDATE published_fee_records"));
    expect(touched?.text).toContain("SET fee_audience = fee_audience");
    expect(touched?.values).toEqual([55401]);
    expect(writes.some((write) => write.text.includes("INSERT INTO pipeline_feedback"))).toBe(true);
    expect(writes.filter((write) => write.text.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
    expect(writes.some((write) => /\bDELETE\b|rolled_back_at = NOW/i.test(write.text))).toBe(false);
  });

  it("writes nothing on a dry run or once fixed, and logs a failed write instead of failing the publish", async () => {
    const dry = fakeAudienceDb(AUDIENCE_LIVE);
    expect((await applyHandAudienceFixes(dry.db as never, { runId: 1, dryRun: true })).fixed).toHaveLength(1);
    expect(dry.writes).toHaveLength(0);
    const done = fakeAudienceDb([{ ...AUDIENCE_LIVE[0], fee_audience: "business" }]);
    expect((await applyHandAudienceFixes(done.db as never, { runId: 2, dryRun: false })).fixed).toEqual([]);
    expect(done.writes).toHaveLength(0);
    const failed = fakeAudienceDb(AUDIENCE_LIVE, "UPDATE verified_fee_observations");
    const result = await applyHandAudienceFixes(failed.db as never, { runId: 4, stepId: 40, dryRun: false });
    expect(result).toMatchObject({ fixed: [], error: "boom: UPDATE verified_fee_observations" });
    expect(String(failed.writes.find((entry) => entry.text.includes("'step.warning'"))?.values.at(-1))).toContain("hamilton.hand_audience_fix");
  });
});
