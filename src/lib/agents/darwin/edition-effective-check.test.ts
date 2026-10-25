import { describe, expect, it } from "vitest";
import { judgeEditions, lateHeadingOnly, NOT_YET_EFFECTIVE_REASON, withDocumentHeads, type EditionRow } from "./edition-effective-check";
import { editionHolds } from "@/lib/agents/hamilton/edition-hold";
import { editionStarts, editionTakesOver, notYetEffective } from "@/lib/agents/hamilton/schedule-edition";

// #1915, prod Oct 20: Avidia Bank's two consumer schedules (stored text heads, verbatim).
const CURRENT = "https://www.avidiabank.com/wp-content/uploads/2024/01/302_ScheduleofFeesPersonal-2024-1.pdf";
const NEXT = "https://www.avidiabank.com/wp-content/uploads/2026/09/Consumer-Fee-Schedule.pdf";
const CURRENT_HEAD = "AVIDIA BANK\nSCHEDULE OF FEES – PERSONAL ACCOUNTS\nEffective March 1, 2024\nATM / DEBIT CARD\nExpedited Card $50.00\n";
const NEXT_HEAD = "AVIDIA BANK\nSCHEDULE OF FEES – CONSUMER ACCOUNTS\nEffective December 1, 2026\nATM / DEBIT CARD\nExpedited Card | $50.00\n";

function row(over: Partial<EditionRow>): EditionRow {
  return {
    fee_published_id: 1, fee_verified_id: 11, institution_id: 450, fee_name: "Paid Overdraft Item (Paid Overdraft Item Fee)",
    amount: 30, canonical_fee_key: "overdraft", fee_audience: "consumer", live: true, verified_ok: true,
    source_document_id: 253, document_url: CURRENT, head: CURRENT_HEAD, first_read: "2026-02-17", ...over,
  };
}

const AVIDIA = [
  row({}),
  row({ fee_published_id: 2, fee_verified_id: 12, amount: 35, source_document_id: 31094, document_url: NEXT, head: NEXT_HEAD, first_read: "2026-10-12" }),
];

describe("schedule edition dates", () => {
  it("reads the edition a heading states", () => {
    expect(editionStarts(NEXT_HEAD)).toBe("2026-12-01");
    expect(editionStarts("Materion Federal Credit Union\nFee Schedule Effective 11/1/2026\nBill Pay $4.00/Mth")).toBe("2026-11-01");
    expect(editionStarts("Stop Payment | $30.00")).toBeNull();
  });

  it("does not take a privacy banner or marked fees for the schedule's edition", () => {
    expect(editionStarts("SSBT has updated its Privacy Policy. The effective date is November 1, 2026.")).toBeNull();
    expect(editionStarts("Fee Schedule\nHighlighted fees will be effective February 1, 2027\nMembership Share | $5.00")).toBeNull();
  });

  it("reads a date far down the page as a line's change, not the edition", () => {
    expect(editionStarts(`${"Stop Payment | $30.00\n".repeat(30)}New fees effective January 1, 2027`)).toBeNull();
  });

  it("holds a schedule until the day it takes effect", () => {
    expect(notYetEffective(NEXT_HEAD, "2026-10-20")).toBe("2026-12-01");
    expect(notYetEffective(NEXT_HEAD, "2026-12-01")).toBeNull();
    expect(notYetEffective(CURRENT_HEAD, "2026-10-20")).toBeNull();
  });

  it("lets an announced edition take over only once it is in effect", () => {
    const pair = { olderUrl: CURRENT, newerUrl: NEXT, olderText: CURRENT_HEAD, newerText: NEXT_HEAD, newerFirstRead: "2026-10-12" };
    expect(editionTakesOver({ ...pair, today: "2026-10-20" })).toBe(false);
    expect(editionTakesOver({ ...pair, today: "2026-12-01" })).toBe(true);
    // Read after it took effect: an older edition left live is #1911's rule, not this one.
    expect(editionTakesOver({ ...pair, newerFirstRead: "2026-12-02", today: "2026-12-05" })).toBe(false);
    // A business schedule never replaces the consumer one.
    expect(editionTakesOver({ ...pair, newerUrl: "https://www.avidiabank.com/business-fee-schedule.pdf", today: "2026-12-01" })).toBe(false);
  });
});

describe("Darwin's edition re-check (#1915)", () => {
  it("takes down Avidia's December schedule today and keeps the current one live", () => {
    const found = judgeEditions(AVIDIA, "2026-10-20");
    expect(found.holds.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([[2, `${NOT_YET_EFFECTIVE_REASON}: 2026-12-01 #31094`]]);
    expect(found.takeovers).toEqual([]);
    expect(found.restores).toEqual([]);
    expect(found.institutions).toEqual([450]);
  });

  it("on December 1 restores the held fee and retires the older edition's line", () => {
    const held = [AVIDIA[0], { ...AVIDIA[1], live: false }];
    const found = judgeEditions(held, "2026-12-01");
    expect(found.restores.map((fee) => fee.feePublishedId)).toEqual([2]);
    expect(found.takeovers.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([[1, "older_edition: #31094 effective 2026-12-01"]]);
    expect(found.holds).toEqual([]);
  });

  it("does not restore a held fee whose verified row was rejected since", () => {
    const found = judgeEditions([{ ...AVIDIA[1], live: false, verified_ok: false }], "2026-12-01");
    expect(found.restores).toEqual([]);
  });

  it("leaves another line of the fee alone", () => {
    const found = judgeEditions([AVIDIA[0], { ...AVIDIA[1], fee_name: "Stop Payment", canonical_fee_key: "stop_payment" }], "2026-12-01");
    expect(found.takeovers).toEqual([]);
  });
});

describe("an edition line past the menu in Darwin's re-check (T1)", () => {
  // Allentown FCU (5481): its fall newsletter (doc 36178) prints next year's schedule under its menu.
  const menu = "About\n\nMembership\n\nBecome a Member\n\nMember Services\n\n".repeat(8);
  const newsletter = `${menu}FEE SCHEDULE\n\nEffective January 1st, 2027\n\nSHARE ACCOUNT FEES\n\nMonthly Service Charge | NONE`;
  const rows = [
    row({ fee_published_id: 149487, fee_verified_id: 181770, institution_id: 5481, fee_name: "Monthly Service Charge", amount: 0,
      canonical_fee_key: "monthly_maintenance", source_document_id: 36178, document_url: "https://www.allentownfcu.com/fall-2026-newsletter/",
      head: newsletter, first_read: "2026-10-20" }),
    // Its second fee row on the same document comes without the text (sent once per document).
    row({ fee_published_id: 149488, fee_verified_id: 181771, institution_id: 5481, fee_name: "NSF Item", amount: 30,
      canonical_fee_key: "nsf", source_document_id: 36178, document_url: "https://www.allentownfcu.com/fall-2026-newsletter/",
      head: null, first_read: "2026-10-20" }),
  ];

  it("copies each document's text onto its rows", () => {
    expect(withDocumentHeads(rows).map((r) => r.head === newsletter)).toEqual([true, true]);
  });

  it("holds nothing on that account while the switch is off, and counts what it would hold", () => {
    const full = withDocumentHeads(rows);
    const found = judgeEditions(full, "2026-10-25");
    expect(found.holds).toEqual([]);
    const shadow = judgeEditions(full, "2026-10-25", true);
    expect(lateHeadingOnly(found, shadow).map((fee) => [fee.feePublishedId, fee.reason])).toEqual([
      [149487, `${NOT_YET_EFFECTIVE_REASON}: 2027-01-01 #36178`],
      [149488, `${NOT_YET_EFFECTIVE_REASON}: 2027-01-01 #36178`],
    ]);
  });

  it("adds nothing for Avidia, whose heading already states its edition", () => {
    expect(lateHeadingOnly(judgeEditions(AVIDIA, "2026-10-20"), judgeEditions(AVIDIA, "2026-10-20", true))).toEqual([]);
  });
});

describe("Hamilton's publish hold (#1915)", () => {
  it("holds rows read from a schedule not in effect yet, by verified id", () => {
    const heads = new Map([["253", CURRENT_HEAD], ["31094", NEXT_HEAD]]);
    const rows = [{ fee_verified_id: 11, source_document_id: 253 }, { fee_verified_id: 12, source_document_id: 31094 }, { fee_verified_id: 13, source_document_id: null }];
    expect([...editionHolds(rows, heads, "2026-10-20")]).toEqual([[12, "2026-12-01"]]);
    expect(editionHolds(rows, heads, "2026-12-01").size).toBe(0);
  });
});
