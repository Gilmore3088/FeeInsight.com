import { describe, expect, it, vi } from "vitest";
import { FRESH_AUDIT_MIN_SCORABLE, FRESH_AUDIT_SAMPLE, freshAuditDetail, nameQuality, runFreshAudit, scoreFreshAudit, summarizeFreshAudit, type FreshAuditFee } from "./fresh-audit";
import { poolFreshAudits } from "./accuracy-measure";

function fee(id: number, overrides: Partial<FreshAuditFee> = {}): FreshAuditFee {
  return {
    fee_id: id,
    fee_published_id: id,
    lineage_ref: id,
    fee_raw_id: id,
    institution_id: 1,
    source: "knox",
    source_document_id: 10,
    canonical_fee_key: "overdraft",
    fee_name: "Overdraft Fee",
    amount: 35,
    amount_kind: null,
    rate_percent: null,
    ...overrides,
  };
}

const schedule = new Map([[1, [{ source_document_id: 10, normalized_text: "Fee Schedule\nOverdraft Fee $35.00 per item\nStop Payment $30.00" }]]]);

describe("scoreFreshAudit", () => {
  it("counts a fee the bank's schedule states as right", () => {
    const score = scoreFreshAudit([fee(1)], schedule);
    expect(score).toMatchObject({ sampled: 1, scorable: 1, right: 1, amountMiss: 0, noText: 0 });
  });

  it("counts an amount the schedule does not state as a graded miss", () => {
    const score = scoreFreshAudit([fee(2, { amount: 99 })], schedule);
    expect(score.amountMiss).toBe(1);
    expect(score.right).toBe(0);
    expect(score.misses[0]).toMatchObject({ feeId: 2, check: "hamilton.source_check" });
    expect(["critical", "major"]).toContain(score.misses[0].severity);
  });

  it("puts a fee with no stored text in the unknown bucket, never right or wrong", () => {
    const score = scoreFreshAudit([fee(3, { institution_id: 2, source_document_id: 20 })], schedule);
    expect(score).toMatchObject({ noText: 1, scorable: 0, right: 0, amountMiss: 0, categoryMiss: 0 });
  });

  it("counts a stated fee from another bank's document as a critical evidence miss, pending when a second look is open", () => {
    const evidence = { otherBank: new Set([4]), unconfirmedHost: new Set([5]), pending: new Set([5]), productPageConflict: new Set<number>() };
    const score = scoreFreshAudit([fee(4), fee(5), fee(6)], schedule, evidence);
    expect(score).toMatchObject({ scorable: 3, right: 1, evidenceMiss: 2, amountMiss: 0 });
    expect(score.misses.map((m) => [m.feeId, m.check, m.severity, m.pending])).toEqual([
      [4, "hamilton.other_bank_document", "critical", false],
      [5, "hamilton.unconfirmed_document_host", "critical", true],
    ]);
  });

  it("fails a fee read from an article or product page even when the amount is stated", () => {
    const score = scoreFreshAudit(
      [fee(7, { document_url: "https://bank.com/blog/what-is-overdraft" }), fee(8, { document_url: "https://bank.com/disclosures/fee-schedule.pdf" })],
      schedule,
    );
    expect(score).toMatchObject({ right: 1, evidenceMiss: 1 });
    expect(score.misses[0]).toMatchObject({ feeId: 7, check: "hamilton.article_page", severity: "critical" });
  });

  it("counts a product-page fee as right unless the bank's schedule prices the same fee differently (v4, James 2026-10-13)", () => {
    const productPage = { document_url: "https://bank.com/personal/checking" };
    const evidence = { otherBank: new Set<number>(), unconfirmedHost: new Set<number>(), pending: new Set<number>(), productPageConflict: new Set([10]) };
    const score = scoreFreshAudit([fee(9, productPage), fee(10, productPage)], schedule, evidence);
    expect(score).toMatchObject({ right: 1, evidenceMiss: 1 });
    expect(score.misses[0]).toMatchObject({ feeId: 10, check: "hamilton.product_page_conflict", severity: "major" });
  });

  // UAT, Oct 9: two of ten "right" rows were not right on the whole record (77845, 88402).
  it("fails a name with glyph junk or a cut sentence, and a free perk with no zero price on its line", () => {
    const text = new Map([
      [1, [{ source_document_id: 10, normalized_text: "Notary Service for members $5.00\nAccount perks: Free Checks, Online Banking\nCashier's Check No charge" }]],
    ]);
    const score = scoreFreshAudit(
      [
        fee(11, { canonical_fee_key: "notary_fee", fee_name: "Notary Service for members \u010b\u010b", amount: 5 }),
        fee(12, { canonical_fee_key: "check_printing", fee_name: "Free Checks", amount: 0 }),
        fee(13, { canonical_fee_key: "cashiers_check", fee_name: "Cashier's Check", amount: 0 }),
      ],
      text,
    );
    expect(score.misses.map((m) => [m.feeId, m.check, m.reason])).toEqual([
      [11, "deming.name_quality", "junk_glyphs"],
      [12, "deming.not_a_fee_line", "perk_not_a_price"],
    ]);
    expect(score).toMatchObject({ right: 1, nameMiss: 1, notAFee: 1, sampleIds: [11, 12, 13] });
  });

  it("reports no percentage below the scorable floor", () => {
    expect(scoreFreshAudit([fee(1)], schedule).accuracy).toBeNull();
    const many = Array.from({ length: FRESH_AUDIT_MIN_SCORABLE }, (_, i) => fee(i + 1));
    expect(scoreFreshAudit(many, schedule).accuracy).toBe(1);
  });

  it("keeps every sample outcome in the durable receipt, including unknowns and misses", async () => {
    const db = Object.assign(vi.fn(async (parts: TemplateStringsArray) => {
      const query = parts.join("?");
      if (query.includes("FROM published_fee_catalog")) return [fee(1), fee(2, { amount: 99 }), fee(3, { institution_id: 2 })];
      if (query.includes("FROM agent_source_texts")) return [{ institution_id: 1, ...schedule.get(1)![0] }];
      return [];
    }), { unsafe: vi.fn(async () => []) });
    const result = await runFreshAudit({ db: db as never, now: new Date("2026-10-18T01:00:00Z") });
    const detail = freshAuditDetail(result);
    expect(detail).toMatchObject({ sample_requested: FRESH_AUDIT_SAMPLE, observations: [[1, "right"], [2, "amount"], [3, "unknown"]] });
    expect(poolFreshAudits([{ at: "2026-10-18T01:00:00Z", detail }])).toMatchObject({ right: 1, scorable: 2, unknown: 1, sampled: 3, series: expect.any(String) });
  });
});

describe("summarizeFreshAudit", () => {
  const base = { readable: true, seed: "2026-10-09", categoryGuardVersion: 60, sourceCheckVersion: 16 };

  it("says accuracy is unknown when the fees cannot be read", () => {
    expect(summarizeFreshAudit({ ...base, ...scoreFreshAudit([], new Map()), readable: false })).toMatch(/unknown today/);
  });

  it("shows the unknown count beside the percentage", () => {
    const fees = [...Array.from({ length: FRESH_AUDIT_MIN_SCORABLE }, (_, i) => fee(i + 1)), fee(99, { institution_id: 2 })];
    expect(summarizeFreshAudit({ ...base, ...scoreFreshAudit(fees, schedule) })).toBe(
      "Deming audited 31 live fees (seed 2026-10-09): 30 of 30 right on amount, category, source, fee line and name (100.0%); 0 amount not supported, 0 category not supported, 0 not from the bank's own schedule, 0 not a fee line, 0 bad name; 1 with no stored text (unknown). Critical misses: 0.",
    );
  });
});

describe("name quality v4: a name that keeps its condition is a fee's name", () => {
  // Deming's Oct 10-12 name misses, read by hand.
  it.each([
    "Bill Pay Inactivity Fee (applies after 60 days of inactivity)",
    "Stop Payments (includes billpay)",
    "Dormant account fee (when balance is less than $50)",
    "Cashier’s Checks: If taken in person",
    "Legal Processing (Includes levy, writ, garnishment, subpoena and requests for information from law enforcement agencies)",
    "Legal order to turn over your funds or property",
  ])("keeps %s", (name) => {
    expect(nameQuality(name)).toBeNull();
  });

  it.each([
    "b A cash advance fee",
    "Foreign ATM & Non-CO-OP Network ATM A fee of",
    "ea. Notary service",
    "available in your account, our payment of this transaction will result in an overdraft transaction. Because the transact",
    "If your scheduled payment is not made within Ten (10) Days of your due date you will be assessed a 25.00 late charge.",
    "thereafter",
  ])("still fails %s", (name) => {
    expect(nameQuality(name)).toBe("name_fragment");
  });
});

describe("name quality v5: cut cents or a row number in front of the name (#1196)", () => {
  it.each(["00 per month Nonsufficient funds", "00 Monthly fee", "14 | INSUFFICIENT FUNDS"])("fails %s", (name) => {
    expect(nameQuality(name)).toBe("name_fragment");
  });

  it.each(["30 Day Late Charge", "12 Months of Inactivity", "03 x 05"])("keeps %s", (name) => {
    expect(nameQuality(name)).toBeNull();
  });
});

