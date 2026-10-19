import { describe, expect, it, vi } from "vitest";

import {
  BROKERAGE_DOCUMENT_TAKEDOWN_LIVE,
  CARD_PROGRAM_TAKEDOWN_LIVE,
  NON_DEPOSIT_BATCH,
  NON_DEPOSIT_CHECK,
  NON_DEPOSIT_DOCUMENT_TAKEDOWN_LIVE,
  NON_DEPOSIT_CHECK_VERSION,
  findNonDepositFees,
  hasLendingWording,
  hasRatePageLendingWording,
  isLendingCategory,
  nonDepositTakedownReason,
  nonDepositVerdict,
  nonDepositCountSql,
  nonDepositDetail,
  nonDepositFeeVerdictsSql,
  nonDepositSamplesSql,
  recheckNonDepositDocuments,
} from "./non-deposit-document-check";
import { NON_DEPOSIT_FEE_FIXTURES } from "./non-deposit-document-check.fixtures";

const ROWS = [
  { fee_published_id: "101", fee_verified_id: "9001", institution_id: "5", fee_name: "Appraisal", amount: "400", canonical_fee_key: "appraisal_fee", source_document_id: "71", document_url: "https://www.bankofgreene.com/current-rates/" },
  { fee_published_id: "102", fee_verified_id: "9002", institution_id: "6", fee_name: "Research", amount: "20", canonical_fee_key: "account_research", source_document_id: "72", document_url: "https://www.usbank.com/investing/self-directed-investing/pricing.html" },
  { fee_published_id: "103", fee_verified_id: "9003", institution_id: "5", fee_name: "Loan Payment by Phone", amount: "5", canonical_fee_key: "other", source_document_id: "73", document_url: "https://www.example.com/fees/loan-payment-fee" },
  { fee_published_id: "104", fee_verified_id: "9004", institution_id: "6", fee_name: "Overdraft", amount: "35", canonical_fee_key: "overdraft", source_document_id: "74", document_url: "https://www.example.com/personal/Schedule-of-Fees-Personal-Checking.pdf" },
  { fee_published_id: "105", fee_verified_id: "9005", institution_id: "7", fee_name: "Wire", amount: "25", canonical_fee_key: "wire_domestic_outgoing", source_document_id: "75", document_url: "https://www.example.com/business/loans/rates" },
  { fee_published_id: "106", fee_verified_id: null, institution_id: "7", fee_name: "Stop Payment", amount: "30", canonical_fee_key: "stop_payment", source_document_id: null, document_url: null },
  { fee_published_id: "107", fee_verified_id: "9007", institution_id: "6", fee_name: "Margin Loan Late Fee", amount: "15", canonical_fee_key: "late_payment", source_document_id: "72", document_url: "https://www.usbank.com/investing/self-directed-investing/pricing.html" },
  { fee_published_id: "108", fee_verified_id: "9008", institution_id: "5", fee_name: "Stop Payment", amount: "30", canonical_fee_key: "stop_payment", source_document_id: "71", document_url: "https://www.bankofgreene.com/current-rates/" },
];

type DbMock = ReturnType<typeof vi.fn>;
function dbFor(rows: Array<Record<string, unknown>>, options: { cursor?: string | null; flags?: Array<Record<string, unknown>> } = {}): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("FROM agent_run_events")) return Promise.resolve(options.cursor == null ? [] : [{ next_after_id: options.cursor }]);
    if (text.includes("information_schema") || text.includes("to_regclass")) return Promise.resolve([{ ready: true, exists: true, present: true }]);
    if (text.includes("FROM pipeline_feedback")) return Promise.resolve(options.flags ?? []);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: "101" }]);
    if (text.includes("FROM published_fee_records")) return Promise.resolve(rows);
    return Promise.resolve([]);
  });
}
const asDb = (db: DbMock) => db as unknown as Parameters<typeof recheckNonDepositDocuments>[0];
const texts = (db: DbMock) => db.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join("?"));

describe("Darwin live non-deposit document re-check (#1442)", () => {
  it("ships with all three switches on (James, 2026-10-16; card programs 2026-10-18)", () => {
    expect(NON_DEPOSIT_DOCUMENT_TAKEDOWN_LIVE).toBe(true);
    expect(BROKERAGE_DOCUMENT_TAKEDOWN_LIVE).toBe(true);
    expect(NON_DEPOSIT_CHECK_VERSION).toBe(3);
    expect(CARD_PROGRAM_TAKEDOWN_LIVE).toBe(true);
    expect(NON_DEPOSIT_BATCH).toBe(2_000);
  });

  it("counts by kind and rule and leaves deposit documents, business documents, undocumented fees and plain deposit-category fees alone", () => {
    const found = findNonDepositFees(ROWS);
    expect(found).toMatchObject({
      checked: 8, withDocument: 7, onMatchedDocument: 4, keptDepositCategory: 1, keptGenericOnRatePage: 0, matched: 2, brokerageDocument: 1,
      byKind: { loan: 1, brokerage: 1, card_program: 0 }, byRule: { lending_category: 2, lending_wording_on_loan_document: 0, brokerage_document: 1, card_program_document: 0 }, documents: 2, institutions: 2,
    });
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.kind, fee.reason])).toEqual([
      [101, "loan", "non_deposit_document: loan #71"],
      [107, "brokerage", "non_deposit_document: brokerage #72"],
    ]);
    // U.S. Bank's "Research" (account research) on a brokerage page is the brokerage_document rule,
    // counted on its own; a rate page's stop payment stays live and clears any pending flag.
    expect(found.brokerageMatches.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([[102, "brokerage_document: brokerage #72"]]);
    expect(found.keptSamples.map((fee) => fee.feePublishedId)).toEqual([108]);
    expect(found.passing).toEqual([103, 104, 105, 108]);
  });

  it("takes down only lending categories (Knox's list)", () => {
    expect(["late_payment", "loan_origination", "appraisal_fee", "vehicle_title", "other_lending_fee", "cash_advance"].every(isLendingCategory)).toBe(true);
    expect(["stop_payment", "wire_domestic_outgoing", "nsf", "overdraft", "account_research", null].some(isLendingCategory)).toBe(false);
  });

  it("in shadow, reports and moves the cursor but writes no fee and logs no flag", async () => {
    const db = dbFor(ROWS, { cursor: "100" });
    const result = await recheckNonDepositDocuments(asDb(db), { runId: 7, stepId: 70, dryRun: false, live: false });
    expect(result).toMatchObject({ live: false, matched: 2, afterId: 100, nextAfterId: 0, flagged: 0, takenDown: [] });
    const sent = texts(db);
    expect(sent.some((text) => text.includes("UPDATE"))).toBe(false);
    expect(sent.some((text) => text.includes("pipeline_feedback"))).toBe(false);
    const report = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("INSERT INTO agent_run_events"));
    expect(report?.[3]).toBe(NON_DEPOSIT_CHECK);
    expect(String(report?.[4])).toContain("switch off, would take down, nothing written");
    expect(JSON.parse(String(report?.[5]))).toMatchObject({ next_after_id: 0, would_take_down: 2, by_kind: { loan: 1, brokerage: 1 }, switch_live: false });
  });

  it("reads the live fee's document through the document-owner join", async () => {
    const db = dbFor(ROWS);
    await recheckNonDepositDocuments(asDb(db), { runId: 7, dryRun: true });
    const read = texts(db).find((text) => text.includes("FROM published_fee_records")) ?? "";
    expect(read).toContain("fv.fee_verified_id = fp.lineage_ref");
    expect(read).toContain("fr.fee_raw_id = fv.fee_raw_id");
    expect(read).toContain("sd.id = fr.source_document_id");
    expect(read).toContain("fp.rolled_back_at IS NULL");
    expect(read).toContain("fp.quarantined_at IS NULL");
  });

  it("carries the cursor on when the batch is full", async () => {
    const result = await recheckNonDepositDocuments(asDb(dbFor(ROWS.slice(0, 2))), { runId: 7, dryRun: false, limit: 2 });
    expect(result.afterId).toBe(0);
    expect(result.nextAfterId).toBe(102);
  });

  it("a dry run writes nothing at all, even switched on", async () => {
    const db = dbFor(ROWS);
    await recheckNonDepositDocuments(asDb(db), { runId: 7, dryRun: true, live: true });
    expect(texts(db).some((text) => text.includes("UPDATE") || text.includes("INSERT"))).toBe(false);
  });

  it("switched on, a fee whose first look is older than 12 hours from another run is archived and logged", async () => {
    const now = new Date("2026-10-16T12:00:00Z");
    const db = dbFor(ROWS, {
      flags: [{ fee_published_id: "101", kind: "takedown_pending", evidence: { flag_run_id: 3, flagged_at: "2026-10-15T00:00:00Z", reason: "non_deposit_document: loan #71" } }],
    });
    const result = await recheckNonDepositDocuments(asDb(db), { runId: 7, stepId: 70, dryRun: false, live: true, now });
    expect(result.takenDown).toEqual([101]);
    const update = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("UPDATE published_fee_records"));
    expect(update?.[1]).toBe("darwin-non-deposit-7");
    expect(update?.[2]).toEqual([101]);
    expect(update?.[3]).toEqual(["non_deposit_document: loan #71"]);
    const sent = texts(db);
    expect(sent.some((text) => text.includes("UPDATE verified_fee_observations"))).toBe(true);
    expect(JSON.stringify(db.mock.calls)).toContain("darwin.non_deposit_document_takedown");
  });

  it("an institution-scoped run leaves the cursor alone", async () => {
    const db = dbFor(ROWS, { cursor: "100" });
    const result = await recheckNonDepositDocuments(asDb(db), { runId: 7, dryRun: false, institutionId: 5 });
    expect(result.afterId).toBeNull();
    expect(result.nextAfterId).toBeNull();
    expect(texts(db).some((text) => text.includes("FROM agent_run_events"))).toBe(false);
  });

  it("gives step detail with the switch state and samples", () => {
    const detail = nonDepositDetail({
      ...findNonDepositFees(ROWS), live: false, brokerageLive: false, cardProgramLive: false, dryRun: false, afterId: 0, nextAfterId: 0, flagged: 0, waiting: 0, cleared: 0, takenDown: [],
    });
    expect(detail).toMatchObject({
      check: "darwin.non_deposit_document", version: 3, switch_live: false, brokerage_switch_live: false, would_take_down: 2, brokerage_document: 1,
      kept_deposit_category: 1, kept_generic_on_rate_page: 0, on_matched_document: 4, taken_down: 0,
      by_rule: { lending_category: 2, lending_wording_on_loan_document: 0, brokerage_document: 1, card_program_document: 0 },
    });
    expect(detail.samples_brokerage_document[0]).toMatchObject({ fee_published_id: 102, rule: "brokerage_document" });
    expect(detail.samples[0]).toMatchObject({ fee_published_id: 101, kind: "loan", document_url: "https://www.bankofgreene.com/current-rates/" });
  });
});

const FEE_ROWS = NON_DEPOSIT_FEE_FIXTURES.map((fee, index) => ({
  fee_published_id: String(1_000 + index), fee_verified_id: String(5_000 + index), institution_id: String(10 + index), fee_name: fee.name,
  amount: String(fee.amount), canonical_fee_key: fee.key, source_document_id: String(100 + index), document_url: fee.url,
}));

describe("v2 rules: lending wording on loan documents, brokerage documents, generic fees on rate pages (#1518)", () => {
  const found = findNonDepositFees(FEE_ROWS);
  // One row at a time, since kept samples are capped at NON_DEPOSIT_SAMPLES.
  const verdicts = new Map(FEE_ROWS.flatMap((row) => {
    const one = findNonDepositFees([row]);
    return [...one.matches, ...one.brokerageMatches, ...one.keptSamples].map((fee) => [fee.feePublishedId, fee.verdict] as const);
  }));

  it.each(NON_DEPOSIT_FEE_FIXTURES.map((fee, index) => ({ ...fee, id: 1_000 + index })))("$name [$key] on $url -> $verdict ($why)", ({ id, verdict }) => {
    expect(verdicts.get(id) ?? null).toBe(verdict);
  });

  it("keeps Siouxland's safe deposit \"Late Fee\" $5 (doc 25773, late_payment) live on its rate page", () => {
    const rows = [{ fee_published_id: "1", fee_verified_id: "2", institution_id: "3", fee_name: "Late Fee", amount: "5", canonical_fee_key: "late_payment", source_document_id: "25773", document_url: "https://www.siouxlandfederalcu.org/current-rates" }];
    const result = findNonDepositFees(rows);
    expect(result.matched).toBe(0);
    expect(result.keptGenericOnRatePage).toBe(1);
    expect(result.passing).toEqual([1]);
  });

  it("counts each rule on its own, and only the main rules in matched", () => {
    expect(found.byRule).toEqual({ lending_category: 8, lending_wording_on_loan_document: 11, brokerage_document: 7, card_program_document: 0 });
    expect(found.matched).toBe(19);
    expect(found.brokerageDocument).toBe(7);
    expect(found.keptGenericOnRatePage).toBe(2);
    expect(found.keptDepositCategory).toBe(24);
    expect(found.lendingWordingSamples.map((fee) => fee.reason)).toContain("lending_wording_on_loan_document: loan #108");
    expect(found.brokerageMatches.every((fee) => fee.reason.startsWith("brokerage_document: brokerage #"))).toBe(true);
    // The brokerage_document fees are neither failing nor passing until the caller decides.
    expect(found.passing.some((id) => found.brokerageMatches.some((fee) => fee.feePublishedId === id))).toBe(false);
  });

  it("reads lending wording from a closed allowlist, and deposit-side wording keeps the fee", () => {
    expect(["Mortgage processing and research fee", "Late Payment — Return Check", "Cash Advance ATM", "Subordination Fee", "HELOC annual fee", "Home Equity Draw",
      "Pay-off quote", "Closing Costs", "Mortgage Origination", "Escrow analysis", "Appraisal", "Loan Late Charge", "Loan Application Fee"].every(hasLendingWording)).toBe(true);
    expect(["Loan Payment by Phone", "Transfer to pay a loan", "Late Fee", "Late Charge", "Safe Deposit Box Late Payment", "Mortgage Payment by Phone",
      "Overdraft Transfer", "Loan Coupon Book", "Research", "Mortgagee", "Prepayment", "Origination", "ACH Origination", "Wire origination",
      "Share certificate early payoff", "SDB Late Payment", "Debit Card Cash Advance", "Coin appraisal", "Club account late payment",
      "Mortgage payment at teller", "Mortgage payment (ACH)", "Application fee", "Credit Report fee", "Standard processing fee", "", null].some(hasLendingWording)).toBe(false);
    expect(["Application fee", "Credit Report fee", "Standard processing fee", "Appraisal"].every(hasRatePageLendingWording)).toBe(true);
    expect(["Late Fee", "Late Charge", "SDB application", "Box rent late payment"].some(hasRatePageLendingWording)).toBe(false);
  });

  const feeDb = (pending: number[]) => vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("FROM agent_run_events")) return Promise.resolve([]);
    if (text.includes("information_schema") || text.includes("to_regclass")) return Promise.resolve([{ ready: true, exists: true, present: true }]);
    if (text.includes("FROM pipeline_feedback")) {
      return Promise.resolve(pending.map((id) => ({ fee_published_id: String(id), kind: "takedown_pending", evidence: { flag_run_id: 3, flagged_at: "2026-10-15T00:00:00Z", reason: "x" } })));
    }
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve((values[1] as number[]).map((id) => ({ fee_published_id: String(id) })));
    if (text.includes("FROM published_fee_records")) return Promise.resolve(FEE_ROWS);
    return Promise.resolve([]);
  });
  const now = new Date("2026-10-16T12:00:00Z");
  const archivedIds = (db: DbMock) => {
    const update = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("UPDATE published_fee_records"));
    return (update?.[2] as number[] | undefined) ?? [];
  };

  it("switched on, takes down lending wording on a loan page but not a brokerage_document fee while its sub-switch is off", async () => {
    // 1000: brokerage Wire; 1008: yourgcu mortgage processing; 1025: Siouxland Late Fee.
    const db = feeDb([1000, 1008, 1025]);
    const result = await recheckNonDepositDocuments(asDb(db), { runId: 7, dryRun: false, live: true, brokerageLive: false, now });
    expect(result.brokerageLive).toBe(false);
    expect(result.takenDown).toEqual([1008]);
    expect(archivedIds(db)).toEqual([1008]);
    const update = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("UPDATE published_fee_records"));
    expect(update?.[3]).toEqual(["lending_wording_on_loan_document: loan #108"]);
  });

  it("with the brokerage sub-switch on as well, a brokerage_document fee comes down under its own reason", async () => {
    const db = feeDb([1000, 1008]);
    const result = await recheckNonDepositDocuments(asDb(db), { runId: 7, dryRun: false, now });
    expect(result).toMatchObject({ live: true, brokerageLive: true });
    expect(result.takenDown).toEqual([1000, 1008]);
    const update = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("UPDATE published_fee_records"));
    expect(update?.[3]).toEqual(["brokerage_document: brokerage #100", "lending_wording_on_loan_document: loan #108"]);
  });

  it("the brokerage sub-switch alone writes nothing", async () => {
    const db = feeDb([1000]);
    const result = await recheckNonDepositDocuments(asDb(db), { runId: 7, dryRun: false, live: false, brokerageLive: true, now });
    expect(result.takenDown).toEqual([]);
    expect(texts(db).some((text) => text.includes("UPDATE") || text.includes("pipeline_feedback"))).toBe(false);
  });
});

describe("read-only non-deposit document SQL", () => {
  it("counts live fees by kind with the shared classifier's Postgres patterns", () => {
    const text = nonDepositCountSql();
    expect(text).not.toMatch(/\\[bsdw]/);
    expect(text).toContain("[ /](?:business|commercial|corporate|treasury");
    expect(text).toContain("[ /](?:checking|savings|share drafts?|money market|deposits?|truth in savings");
    expect(text).toContain("(?:current|todays|today s|our) rates");
    expect(text).toContain("helocs?");
    expect(text).toContain("wealth management|wealth advisory|private wealth|investment management|self directed");
    expect(text).toContain("'([a-z])([A-Z])', '\\1 \\2', 'g'");
    expect(text).toContain("THEN 'brokerage'");
    expect(text).toContain("THEN 'loan'");
    expect(text).toContain("fv.fee_verified_id = fp.lineage_ref");
    expect(text).toContain("fp.rolled_back_at IS NULL AND fp.quarantined_at IS NULL");
    expect(text).toContain("GROUP BY ROLLUP (v.kind)");
    expect(text).toContain("COALESCE(l.canonical_fee_key IN ('appraisal_fee', 'cash_advance', 'late_payment', 'loan_origination', 'other_lending_fee', 'vehicle_title'), false)");
    expect(text).toContain("AS kept_deposit_category");
    expect(text).toContain("AS kept_generic_on_rate_page");
    expect(text).toContain("AS lending_wording_on_loan_document");
    expect(text).toContain("AS brokerage_document");
    expect(text).toContain(" (?:mortgages?|helocs?|home equity|cash advances?|late payments?|");
    expect(text).toContain(" (?:safe deposit|box(?:es)?|sdb|checking|savings|shares?|certificates?|cds?|club|coin|debit|ach|wires?|");
    expect(text).toContain("regexp_replace(COALESCE(l.fee_name, ''), '[^A-Za-z0-9]+', ' ', 'g')");
    expect(text).toContain(" (?:applications?|credit reports?|processing) ");
    expect(text).toContain("documents AS MATERIALIZED (");
    expect(text).toContain("judged AS MATERIALIZED (");
    expect(text).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/);
  });

  it("samples the matched documents, most live fees first", () => {
    const text = nonDepositSamplesSql();
    expect(text).toContain("WHERE kind IS NOT NULL");
    expect(text).toContain("ORDER BY 6 DESC, count(*) DESC");
    expect(text).toContain("AS sample_kept");
    expect(text).toContain("AS sample_brokerage_document");
    expect(text).toContain("LIMIT 60;");
    expect(text).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/);
  });
});

describe("per-fee verdict SQL", () => {
  it("lists one row per fee with its verdict, filtered and capped per verdict", () => {
    const text = nonDepositFeeVerdictsSql({ verdicts: ["lending_wording_on_loan_document", "brokerage_document"], perVerdict: 40 });
    expect(text).toContain("WHERE v.verdict IN ('lending_wording_on_loan_document', 'brokerage_document')");
    expect(text).toContain("WHERE n <= 40");
    expect(text).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/);
    expect(text).not.toMatch(/\\[bsdwy]/);
  });
});

describe("v3 rule: fees on prepaid, payroll and gift card documents (#1908)", () => {
  const PAYROLL = "https://www.schoolsfirstfcu.org/disclosures/payroll-card-statement-of-fees-disclosure/";
  const GIFT = "https://csb.bank/gift-cards.html";
  const CARD_ROWS = [
    { fee_published_id: "201", fee_verified_id: "9201", institution_id: "6741", fee_name: "Monthly Fee", amount: "0", canonical_fee_key: "monthly_maintenance", source_document_id: "81", document_url: PAYROLL },
    { fee_published_id: "202", fee_verified_id: "9202", institution_id: "6741", fee_name: "Rush Payroll Card replacement (per card)", amount: "20", canonical_fee_key: "rush_card", source_document_id: "81", document_url: PAYROLL },
    { fee_published_id: "203", fee_verified_id: "9203", institution_id: "1530", fee_name: "Inactivity fee", amount: "2.95", canonical_fee_key: "dormant_account", source_document_id: "82", document_url: GIFT },
    { fee_published_id: "204", fee_verified_id: "9204", institution_id: "1530", fee_name: "Gift card purchase", amount: "4", canonical_fee_key: "gift_card_purchase", source_document_id: "82", document_url: GIFT },
    { fee_published_id: "205", fee_verified_id: "9205", institution_id: "6741", fee_name: "Overdraft", amount: "22", canonical_fee_key: "overdraft", source_document_id: "83", document_url: "https://www.schoolsfirstfcu.org/globalassets/pdf/disclosures/mk360-fees.pdf" },
  ];

  it("takes every fee on a card program document except the card's purchase and reload price", () => {
    expect(nonDepositVerdict("card_program", false, "monthly_maintenance", "Monthly Fee")).toBe("card_program_document");
    expect(nonDepositVerdict("card_program", false, "late_payment", "Late fee")).toBe("card_program_document");
    expect(nonDepositVerdict("card_program", false, "gift_card_purchase", "Purchase")).toBe("kept_card_purchase");
    expect(nonDepositVerdict("card_program", false, "prepaid_card_reload", "Reload Fee")).toBe("kept_card_purchase");
  });

  it("counts them on their own, outside matched, with their documents and institutions", () => {
    const found = findNonDepositFees(CARD_ROWS);
    expect(found.matched).toBe(0);
    expect(found.byKind.card_program).toBe(0);
    expect(found.byRule.card_program_document).toBe(3);
    expect(found.cardProgramDocument).toBe(3);
    expect(found.cardProgramDocuments).toBe(2);
    expect(found.cardProgramInstitutions).toBe(2);
    expect(found.keptCardPurchase).toBe(1);
    expect(found.onMatchedDocument).toBe(4);
    expect(found.cardProgramMatches.map((fee) => fee.reason)).toEqual(["card_program_document: card_program #81", "card_program_document: card_program #81", "card_program_document: card_program #82"]);
    expect(found.passing).toEqual([204, 205]);
  });

  it("leaves them live while the sub-switch is off, at publish and on the re-check", async () => {
    const fee = { documentUrl: PAYROLL, sourceDocumentId: 81, canonicalFeeKey: "monthly_maintenance", feeName: "Monthly Fee" };
    expect(nonDepositTakedownReason(fee, { live: true, cardProgramLive: false })).toBeNull();
    expect(nonDepositTakedownReason(fee, { live: false, cardProgramLive: true })).toBeNull();
    expect(nonDepositTakedownReason(fee, { live: true, cardProgramLive: true })).toBe("card_program_document: card_program #81");
    expect(nonDepositTakedownReason({ ...fee, canonicalFeeKey: "gift_card_purchase" }, { live: true, cardProgramLive: true })).toBeNull();

    const db = dbFor(CARD_ROWS);
    const result = await recheckNonDepositDocuments(asDb(db), { runId: 7, dryRun: false, live: true, brokerageLive: true, cardProgramLive: false, institutionId: 6741 });
    expect(result.cardProgramDocument).toBe(3);
    expect(result.takenDown).toEqual([]);
    expect(texts(db).some((text) => text.includes("UPDATE published_fee_records"))).toBe(false);
    expect(nonDepositDetail(result)).toMatchObject({ card_program_switch_live: false, card_program_document: 3, kept_card_purchase: 1 });
  });

  it("puts them in the count SQL as their own verdict", () => {
    const sql = nonDepositCountSql();
    expect(sql).toContain("WHEN j.kind = 'card_program' AND COALESCE(l.canonical_fee_key IN ('gift_card_purchase', 'prepaid_card_reload'), false) THEN 'kept_card_purchase'");
    expect(sql).toContain("AS card_program_document,");
    expect(nonDepositFeeVerdictsSql({ verdicts: ["card_program_document"] })).toContain("WHERE v.verdict IN ('card_program_document')");
  });
});
