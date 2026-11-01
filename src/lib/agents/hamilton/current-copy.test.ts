import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { columnTableWitness, countCurrentCopyPairs, currentCopyAttemptOutcome, currentCopyVerdict, feeChangeNoticeKind, interleavedPriceWitness, isFeeChangeNotice, judgeAgainstCurrentCopy, linkYear, listsFewerFees, priceFollowsName, readableCurrentText, restatesOlderRows, retiredCopiesSql, retiredCopyIsNewer, sameCopyText, secondLookFeesNotOnCurrentCopy, withLabelBreaksJoined, withoutInchMarks, wrappedRowWitness, type CurrentCopyFeeRow } from "./current-copy";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const OLDER = "Fee Schedule\nOverdraft Fee $35.00\nStop Payment $30.00\nWire Transfer Outgoing $25.00\nPaper Statement $3.00";
// The bank's current page: same schedule, a new stop payment price, no paper statement line.
const CURRENT = "Fee Schedule\nOverdraft Fee $35.00\nStop Payment $35.00\nWire Transfer Outgoing $25.00";

function fee(id: number, name: string, amount: string, extra: Partial<CurrentCopyFeeRow> = {}): CurrentCopyFeeRow {
  return {
    fee_published_id: id,
    fee_verified_id: id + 100,
    institution_id: 7,
    older_document_id: 40,
    current_document_id: 41,
    canonical_fee_key: "fee",
    fee_name: name,
    amount,
    restated_row: false,
    ...extra,
  };
}

const fees = [
  fee(1, "Overdraft Fee", "35.00"),
  fee(2, "Stop Payment", "30.00"),
  fee(3, "Wire Transfer Outgoing", "25.00", { restated_row: true }),
  fee(4, "Paper Statement", "3.00"),
];

describe("judgeAgainstCurrentCopy", () => {
  it("passes fees the current copy restates and suspects ones it names at another price or dropped", () => {
    const doc = judgeAgainstCurrentCopy(fees, CURRENT, OLDER);
    expect(doc.recognized).toBe(true);
    expect(doc.stated).toBe(2);
    expect(doc.passing).toEqual([1]);
    expect(doc.failing.map((candidate) => [candidate.feePublishedId, candidate.verdict, candidate.reason])).toEqual([
      [2, "still_named", "not_on_current_copy:#41"],
      [4, "dropped", "not_on_current_copy:#41"],
    ]);
  });

  it("suspects nothing when the current copy is not recognizably the same schedule", () => {
    const doc = judgeAgainstCurrentCopy(fees.map((row) => ({ ...row, restated_row: false })), "Page not found", OLDER);
    expect(doc.recognized).toBe(false);
    expect(doc.failing).toEqual([]);
  });

  it("never suspects a fee the older copy's own text does not state", () => {
    const doc = judgeAgainstCurrentCopy([...fees, fee(5, "Coin Counting", "9.00")], CURRENT, OLDER);
    expect(doc.unproven).toBe(1);
    expect(doc.failing.map((candidate) => candidate.feePublishedId)).not.toContain(5);
  });
});

function createDb(pendingFlag: { flag_run_id: number; flagged_at: string } | null, rows: CurrentCopyFeeRow[] = fees) {
  const query = (strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("WITH live AS MATERIALIZED")) return Promise.resolve(rows);
    if (text.includes("FROM agent_source_texts")) {
      return Promise.resolve([
        { source_document_id: 40, normalized_text: OLDER },
        { source_document_id: 41, normalized_text: CURRENT },
      ]);
    }
    if (text.includes("FROM pipeline_feedback")) {
      return Promise.resolve(
        pendingFlag
          ? [2, 4].map((id) => ({ fee_published_id: id, kind: "takedown_pending", evidence: { ...pendingFlag, reason: "not_on_current_copy:#41" } }))
          : [],
      );
    }
    if (text.includes("SET rolled_back_at = NOW()")) return Promise.resolve([{ fee_published_id: 2 }, { fee_published_id: 4 }]);
    return Promise.resolve([]);
  };
  return Object.assign(vi.fn(query),{unsafe:(text:string)=>text}) as unknown as Parameters<typeof secondLookFeesNotOnCurrentCopy>[0] & ReturnType<typeof vi.fn>;
}
const writes = (db: ReturnType<typeof createDb>) => db.mock.calls.map((call) => templateText(call[0]));
const options = { runId: 9, batchId: "agentic-run-9", dryRun: false };
const due = { flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() };

describe("secondLookFeesNotOnCurrentCopy", () => {
  it("only flags fees the current copy does not restate the first time, keeping them live", async () => {
    const db = createDb(null);
    const result = await secondLookFeesNotOnCurrentCopy(db, { ...options, confirmLive: true });
    expect(result).toMatchObject({ documentsChecked: 1, stated: 2, failing: 2, flagged: 2, takenDown: [] });
    expect(writes(db).some((text) => text.includes("SET rolled_back_at = NOW()"))).toBe(false);
    expect(JSON.stringify(db.mock.calls)).toContain("takedown_pending");
    expect(writes(db).some((text) => text.includes("hamilton.current_copy_check"))).toBe(true);
    // UAT reads which fees passed and which copies were judged, even when nothing fails.
    expect(result.statedFeeIds).toEqual([1]);
    expect(result.copies).toEqual([{ older: 40, current: 41, recognized: true, retired: false, outcome: "ok" }]);
    expect(JSON.stringify(db.mock.calls)).toContain("stated_fee_ids");
  });

  it("confirms nothing while confirmations are off, even when the second look is due", async () => {
    const db = createDb(due);
    const result = await secondLookFeesNotOnCurrentCopy(db, { ...options, confirmLive: false });
    expect(result).toMatchObject({ failing: 2, waiting: 2, takenDown: [] });
    expect(writes(db).some((text) => text.includes("SET rolled_back_at = NOW()"))).toBe(false);
  });

  it("archives on the second look once confirmations are on, with the verified row rejected", async () => {
    const db = createDb(due);
    const result = await secondLookFeesNotOnCurrentCopy(db, { ...options, confirmLive: true });
    expect(result.takenDown.map((candidate) => [candidate.feePublishedId, candidate.reason])).toEqual([
      [2, "not_on_current_copy:#41"],
      [4, "not_on_current_copy:#41"],
    ]);
    expect(writes(db).some((text) => text.includes("SET review_status = 'rejected'"))).toBe(true);
    expect(writes(db).some((text) => text.includes("DELETE"))).toBe(false);
  });

  it("changes nothing in a dry run", async () => {
    const db = createDb(due);
    const result = await secondLookFeesNotOnCurrentCopy(db, { ...options, dryRun: true, confirmLive: true });
    expect(result.takenDown).toHaveLength(2);
    expect(writes(db).some((text) => /UPDATE|INSERT/.test(text))).toBe(false);
  });
});

describe("currentCopyVerdict (first hand check, 7 Oct)", () => {
  // Current-page lines that still state first-look fees (prod, 7 Oct 19:00 UTC).
  const cases: Array<[string, string, string, string]> = [
    ["wire_domestic_outgoing", "Wire transfer fee - domestic", "15.00", "Wire transfer fee\n$15.00 domestic$35.00 international\n"],
    ["wire_intl_outgoing", "Wire Transfer (Outgoing): International", "50.00", "Wire Transfer (Outgoing) | Domestic - $20.00/Transfer, International - $50.00/Transfer\n"],
    ["wire_domestic_incoming", "Domestic wire: Incoming", "10.00", "Domestic wire | Outgoing = $20 Incoming = $10\n"],
    ["stop_payment", "Stop Payment (each item, whether check or ACH)", "30.00", "Stop Payment\n(each item, whether check or ACH)\n$30 each\n"],
    ["wire_intl_outgoing", "Outgoing Business Foreign Wire Transfer fee", "50.00", "Outgoing Business Domestic Wire Transfer fee $15.00 Outgoing Business Foreign Wire Transfer fee $50.00 Outgoing Consumer Foreign\n"],
  ];
  // The older copy stated each on a row of its own; the current page lays it out differently.
  it.each(cases)("still states %s on the current page", (key, name, amount, text) => {
    const verdict = currentCopyVerdict(fee(1, name, amount, { canonical_fee_key: key }), text, `Fee Schedule\n${name} $${amount}`);
    expect(verdict).toBe("still_stated");
  });

  it("never judges a $0 row", () => {
    expect(currentCopyVerdict(fee(1, "Notary (customers only)", "0.00"), "Notary\n(customers only)\nFREE", "Notary $0.00")).toBe("unproven");
  });

  it("still suspects a fee the current page prices differently", () => {
    expect(currentCopyVerdict(fee(2, "Stop Payment", "30.00", { canonical_fee_key: "stop_payment" }), CURRENT, OLDER)).toBe("still_named");
  });
});

describe("currentCopyVerdict (second hand check, 9 Oct)", () => {
  // Tampa Bay FCU's current service-fees page (prod, document 14095).
  const TAMPA = "Checking Accounts\nFresh Start Checking\n$9.95/month\nRewards Checking      (Waived with $1,500 combined savings and checking balance or $15,000 loan balances)\n$5.95/month\nDocuments &amp; Research\n";
  const older = "Checking Accounts\nFresh Start Checking | $9.95/month\nRewards Checking (Waived with $1,500 combined savings and checking balance or $15,000 loan balances) | $5.95/month\n";

  it("reads a name Hamilton gave its account heading without the fee words", () => {
    const verdict = currentCopyVerdict(fee(1, "Fresh Start Checking Monthly Maintenance Fee", "9.95", { canonical_fee_key: "monthly_maintenance" }), TAMPA, older);
    expect(verdict).toBe("still_stated");
  });

  it("reads past a waiver condition in parentheses", () => {
    const verdict = currentCopyVerdict(fee(2, "Rewards Checking Monthly Maintenance Fee", "5.95", { canonical_fee_key: "monthly_maintenance" }), TAMPA, older);
    expect(verdict).toBe("still_stated");
  });

  it("still suspects the account fee at a new price", () => {
    const raised = TAMPA.replace("$9.95/month", "$12.95/month");
    const verdict = currentCopyVerdict(fee(1, "Fresh Start Checking Monthly Maintenance Fee", "9.95", { canonical_fee_key: "monthly_maintenance" }), raised, older);
    expect(verdict).not.toBe("still_stated");
  });
});

describe("retired documents (no longer a source, Oct 19)", () => {
  it("selects retired documents beside superseded ones, paired with the current link's newest read copy", async () => {
    const db = createDb(null);
    await secondLookFeesNotOnCurrentCopy(db, { ...options, confirmLive: true });
    const select = writes(db).find((text) => text.includes("WITH live AS MATERIALIZED")) ?? "";
    expect(select).toContain("retired AS MATERIALIZED");
    expect(select).toContain("live.superseded_by_id IS NULL AND retired.current_document_id IS NOT NULL");
    void retiredCopiesSql(db);
    const retired = templateText(db.mock.calls.at(-1)?.[0]);
    // Not a source: not the fee link, not a companion, not a non-rejected additional source; the pair needs a read copy.
    expect(retired).toContain("l.companion_source_id IS NULL");
    expect(retired).toContain("ias.status <> 'rejected'");
    expect(retired).toContain("d.doc_key <> d.link_key");
    // #1200: the current copy is read at the plain fetch's target (remembered address, else saved link).
    expect(retired).toContain("d.doc_key <> d.fetch_key");
    expect(retired).toContain("COALESCE(NULLIF(btrim(profile.canonical_source_url), ''), l.fee_schedule_url, '')");
    expect(retired).toContain("IN (d.fetch_key, d.link_key)");
    // Newest read copy at either address wins; a copy with no address never pairs.
    expect(retired).toContain("ORDER BY c.id DESC");
    expect(retired).toContain("btrim(COALESCE(c.document_url, '')) <> ''");
    expect(retired).toContain("t.status = 'completed'");
    expect(retired).toContain("LEFT JOIN institution_source_profiles profile");
    expect(retired).toContain("c.status = 'success'");
    // #1200: a copy last seen before the retired document was fetched never judges it.
    expect(retired).toContain("GREATEST(c.crawled_at, c.last_checked_at) < older.crawled_at");
  });

  it("judges a retired document's fees like a superseded copy's and reports them apart", async () => {
    const db = createDb(null, fees.map((row) => ({ ...row, retired: true, older_url: "https://bank.example/fees-2023.pdf", current_url: "https://bank.example/fees-2026.pdf" })));
    const result = await secondLookFeesNotOnCurrentCopy(db, { ...options, confirmLive: false });
    expect(result).toMatchObject({ documentsChecked: 1, retiredChecked: 1, failing: 2, retiredFailing: 2, takenDown: [] });
    expect(result.copies).toEqual([{ older: 40, current: 41, recognized: true, retired: true, outcome: "ok" }]);
    expect(JSON.stringify(db.mock.calls)).toContain("retired_failing");
  });

  it("counts retired pairs in Bayes's manifest with the same selection", async () => {
    const db = createDb(null);
    await countCurrentCopyPairs(db);
    const count = writes(db).find((text) => text.includes("SELECT COUNT(*) AS pairs")) ?? "";
    expect(count).toContain("retired AS MATERIALIZED");
  });

  it("judges a retired document only against the same page or a newer dated edition (dry run, Oct 19)", () => {
    const dated = (date: string, body: string) => `Fee Schedule Effective ${date}\n${body}`;
    // Billerica Municipal Employees FCU: the link's file is dated 2020, the live fees came from 2023.
    expect(retiredCopyIsNewer({
      older_url: "https://www.billericamecu.com/wp-content/uploads/2023/09/Schedule-of-Fees-2023Aug.pdf",
      current_url: "https://www.billericamecu.com/wp-content/uploads/2020/12/Schedule-of-Fees-2020-Nov.pdf",
    }, CURRENT, OLDER)).toBe(false);
    // Citizens Bank of Rogersville: the same file name, dated 2023 then 2026.
    expect(retiredCopyIsNewer({
      older_url: "https://cbofr.com/wp-content/uploads/2023/03/Service-Charge-Fee-Schedule-02012023.pdf",
      current_url: "https://www.cbofr.com/wp-content/uploads/2026/09/Service-Charge-Fee-Schedule-09302026.pdf",
    }, CURRENT, OLDER)).toBe(true);
    // Two pages: only a later effective date makes the current one newer.
    const pages = { older_url: "https://www.accessfcu.org/home/rates-fees/fees", current_url: "https://www.accessfcu.org/docs/Fee%20Schedule.pdf" };
    expect(retiredCopyIsNewer(pages, dated("January 1, 2025", CURRENT), dated("October 31, 2023", OLDER))).toBe(true);
    expect(retiredCopyIsNewer(pages, dated("October 31, 2023", CURRENT), dated("January 1, 2025", OLDER))).toBe(false);
    expect(retiredCopyIsNewer(pages, CURRENT, OLDER)).toBe(false);
  });

  it("recognizes no retired document whose current copy is not newer", () => {
    const stale = fees.map((row) => ({ ...row, retired: true, older_url: "https://bank.example/a/fees", current_url: "https://bank.example/b/fees" }));
    const doc = judgeAgainstCurrentCopy(stale, CURRENT, OLDER);
    expect(doc).toMatchObject({ retired: true, recognized: false, failing: [] });
  });

  it("reads the latest year a link names", () => {
    expect(linkYear("https://x.org/uploads/2024/08/NHFCU.Fee_.Schedule.Oct_.1.2024.pdf")).toBe(2024);
    // The upload folder dates the upload, not the schedule.
    expect(linkYear("https://x.org/wp-content/uploads/2024/01/Schedule-of-Fees-2020-Nov.pdf")).toBe(2020);
    expect(linkYear("https://x.org/wp-content/uploads/2024/01/fees.pdf")).toBeNull();
    expect(linkYear("https://x.org/2021-Fee-Schedule-102021.pdf")).toBe(2021);
    expect(linkYear("https://x.org/fees/12345.pdf")).toBeNull();
    expect(linkYear(null)).toBeNull();
  });
});

describe("currentCopyVerdict (third hand check, #2072, Oct 27: 11 of 20 first looks stale)", () => {
  // Each case is one sampled first look: the live fee, its older copy's line and the current
  // copy's line, copied from the bank's stored text (triage/switches-2072-samples.md, section 3).
  // Where the sample copied no fee name, the name is the line's own label.
  type Case = { id: number; name: string; amount: string; older: string; current: string; key?: string };
  const filler = "Fee Schedule\nOverdraft Fee | $30.00\nStatement Copy | $3.00\n";
  const judge = (c: Case) => currentCopyVerdict(fee(c.id, c.name, c.amount, { canonical_fee_key: c.key ?? "fee" }), `${filler}${c.current}\n`, `${filler}${c.older}\n`);

  // The 11 the hand check found really stale: still judged stale.
  const stale: Case[] = [
    { id: 6082, name: "Special Order", amount: "5.00",
      older: "Coin and Currency Requests\nStanding Order $3.00\nSpecial Order $5.00",
      current: "Service Fees Effective October 9th, 2026\nWire Transfer Outgoing | $25.00" },
    { id: 19946, name: "Bill Payment", amount: "5.00", older: "Bill Payment / $5.00 each", current: "bill payment | $29.00 each" },
    { id: 24913, name: "ATM/Debit Replacement Cards", amount: "10.00", older: "ATM/Debit Replacement Cards | $10.00 per card",
      current: "ATM/Debit Replacement Cards | $25.00 per card, expedited cards $50.00", key: "card_replacement" },
    { id: 49180, name: "Mortgage Loan Application", amount: "200.00",
      older: "Loan Refinance Fee $20.00 per loan\nMortgage Loan Application $200.00 per application\nMortgage Loan Origination Fee | 1%",
      current: "Loan Refinance Fee | $20.00 per loan Mortgage Loan Origination Fee | 1%" },
    { id: 61439, name: "Automated Overdraft Transfer Fee From Savings", amount: "5.00", older: "Automated Overdraft Transfer Fee From Savings | $5.00",
      current: "Automated Overdraft Transfer Fee From Savings (per transfer) | No Charge", key: "od_protection_transfer" },
    { id: 67070, name: "Returned Deposit", amount: "8.00", older: "Returned Deposit | $8.00",
      current: "Returned Deposit Your deposited/cashed check was returned to us unpaid. | No Fee", key: "deposited_item_return" },
    { id: 81970, name: "Returned Deposit Item Fee", amount: "15.00", older: "Returned Deposit Item Fee ...... $15.00",
      current: "Pricing Schedule Effective Sept 9, 2026\nWire Transfer Outgoing | $25.00", key: "deposited_item_return" },
    { id: 81978, name: "Check-for-Less Monthly Fee", amount: "10.00", older: "Check-for-Less Pricing Information: Monthly Fee ...... $10.00",
      current: "Pricing Schedule Effective Sept 9, 2026\nWire Transfer Outgoing | $25.00" },
    { id: 93933, name: "Incorrect Address/Returned Mail per Item Fee", amount: "5.00", older: "Incorrect Address/Returned Mail per Item Fee ---$5.00",
      current: "Paper Statements Monthly | $3.00\nWire Transfer Outgoing | $25.00" },
    { id: 97804, name: "Debit Card - lost or stolen card", amount: "10.00", older: "Debit Card - lost or stolen card | $10.00",
      current: "Debit Card - lost or stolen card | $5.00", key: "card_replacement" },
    { id: 115075, name: "Returned Deposited Items - Charge Back", amount: "15.00", older: "Returned Deposited Items - Charge Back | $15.00",
      current: "Returned Deposited Items - Charge Back | $25.00", key: "deposited_item_return" },
  ];
  it.each(stale)("still judges fee $id stale", (c) => {
    expect(["still_named", "dropped"]).toContain(judge(c));
  });

  // The 9 the hand check found wrong: no longer judged stale.
  it.each<Case>([
    // Two-column PDF, Access FCU (doc 33871): the labels and prices of two columns interleave.
    { id: 27733, name: "Bill Payment Insufficient Funds Surcharge (each item)", amount: "15.00", older: "Bill Payment Insufficient Funds Surcharge (each item) | $15.00",
      current: "ACH Revoke ................. $10.00$10.00 Bill Payment Insufficient Funds Surcharge ........ (each item) ........ $ 5.00$15.00" },
    { id: 63730, name: "Research & Reconcilement (per hour)", amount: "25.00", older: "Research & Reconcilement (per hour) | $25.00", key: "account_research",
      current: "Courtesy Pay Fee (per transaction) ..........Research & Reconcilement (per hour)........ $10.00$25.00" },
    { id: 128075, name: "Card Replacement", amount: "10.00", older: "Card Replacement | $10.00", key: "card_replacement",
      current: "Card Replacement ..........Share Draft Protest .......... $20.00$10.00" },
    // The label on one line, the glued prices on the next.
    { id: 128076, name: "Card Replacement", amount: "10.00", older: "Card Replacement | $10.00", key: "card_replacement",
      current: "Card Replacement ..........Share Draft Protest\n.......... $20.00$10.00" },
  ])("does not prove fee $id stale from interleaved columns", (c) => {
    expect(judge(c)).toBe("unproven");
  });

  it.each<Case>([
    // A point spaced off its cents (doc 12872).
    { id: 42058, name: "Stop Payment-Standard (180 days)", amount: "29.00", older: "Stop Payment-Standard (180 days) | $29.00", key: "stop_payment",
      current: "Stop Payment-Standard (180 days) .......... $29. 00/eac h" },
    // A line break kept as markup, the price before its name (doc 40020).
    { id: 101033, name: "Card Replacement Fee", amount: "10.00", older: "Card Replacement Fee | $10.00", key: "card_replacement",
      current: "Debit Card*** | No Annual Fee<br>$10.00 Card Replacement Fee" },
    // The price before its name and unit (doc 36629).
    { id: 138008, name: "Account Research", amount: "25.00", older: "Account Research | $25.00 per hour", key: "account_research",
      current: "$25.00 per hour / 1-hour Account Research fee minimum" },
  ])("reads fee $id as still stated", (c) => {
    expect(judge(c)).toBe("still_stated");
  });

  it("reads markup breaks as lines and a spaced point as a price", () => {
    expect(readableCurrentText("No Annual Fee<br>$10.00 Card Replacement Fee<br />x")).toBe("No Annual Fee\n$10.00 Card Replacement Fee\nx");
    expect(readableCurrentText("Stop Payment .... $29. 00/eac h")).toBe("Stop Payment .... $29.00/eac h");
  });

  // Jeanne D'Arc CU (doc 21764), the notice the hand check found taken as the current copy. The
  // sampled fees (64213 $5, 64221 $5, 93814 $10) are not on it; their names here are illustrative.
  const NOTICE = [
    "General Fee Changes:",
    "The fees highlighted below have been adjusted and will be effective on August 1, 2026.",
    "Consumer and Business Account Fees | Fee through | Fee as of",
    "July 31,2026 | August 1, 2026",
    "Money Orders | $2.00 | $5.00",
    "Same Day ACH Service Charge | $10.00 | $10.00",
    "Account Research | $35.00 per hour | $50.00 per hour",
  ].join("\n");
  // The full schedule the notice amends: many more priced lines than the notice.
  const JDCU_OLDER = [
    "Schedule of Fees",
    "Money Orders | $2.00",
    "Same Day ACH Service Charge | $10.00",
    "Coin Counting (non-members) | $5.00",
    "Statement Reprint | $5.00",
    "Wire Transfer Incoming | $10.00",
    "Wire Transfer Outgoing | $25.00",
    "Stop Payment | $30.00",
    "Overdraft Fee | $30.00",
    "Dormant Account | $5.00",
    "Account Research | $35.00 per hour",
  ].join("\n");

  it.each([
    [64213, "Coin Counting (non-members)", "5.00"],
    [64221, "Statement Reprint", "5.00"],
    [93814, "Wire Transfer Incoming", "10.00"],
  ])("never proves fee %s stale from a fee-change notice that does not list it", (id, name, amount) => {
    expect(isFeeChangeNotice(NOTICE)).toBe(true);
    expect(currentCopyVerdict(fee(id, name, amount), NOTICE, JDCU_OLDER)).toBe("unproven");
  });

  it("still reads a fee a notice restates at its price, and one it reprices", () => {
    expect(currentCopyVerdict(fee(1, "Same Day ACH Service Charge", "10.00"), NOTICE, JDCU_OLDER)).toBe("still_stated");
    expect(currentCopyVerdict(fee(1, "Money Orders", "5.00"), NOTICE, JDCU_OLDER)).toBe("still_stated");
    // The newest column prices Money Orders at $5: a live $2 is stale, not stated by the old column.
    expect(currentCopyVerdict(fee(1, "Money Orders", "2.00"), NOTICE, JDCU_OLDER)).toBe("still_named");
  });

  it("knows a notice from a schedule", () => {
    expect(isFeeChangeNotice("NOTICE OF CHANGE IN TERMS\nEffective December 1, 2026 the following fees will change:")).toBe(true);
    expect(isFeeChangeNotice("Effective January 1 the following fees have been increased:\nOverdraft Fee | $35.00")).toBe(true);
    // A bare heading or a schedule's ordinary words are not a notice (review of 3d9f46ef9).
    expect(isFeeChangeNotice("Important Fee Changes\nOverdraft Fee | $30.00")).toBe(false);
    expect(isFeeChangeNotice("Schedule of Fees\nThe fees listed below are subject to change without notice.\nOverdraft Fee | $30.00")).toBe(false);
    expect(isFeeChangeNotice("Schedule of Fees\nPrices listed below are updated annually.\nOverdraft Fee | $30.00")).toBe(false);
    expect(isFeeChangeNotice("Schedule of Fees\nFee Changes\nWe may change our fees at any time; we will notify you 30 days before a change.\nOverdraft Fee | $30.00")).toBe(false);
    expect(isFeeChangeNotice("Schedule of Fees\nNotice of change in terms: see your account agreement.\nOverdraft Fee | $30.00")).toBe(false);
    expect(isFeeChangeNotice(OLDER)).toBe(false);
    expect(isFeeChangeNotice(CURRENT)).toBe(false);
    expect(isFeeChangeNotice("Service Fees Effective October 9th, 2026\nOverdraft Fee | $30.00\nWe may change these fees with notice.")).toBe(false);
    // Only the opening is read: a schedule's closing note about changes is not a notice.
    expect(isFeeChangeNotice(`${"Overdraft Fee | $30.00\n".repeat(80)}The following fees will change:\n`)).toBe(false);
  });

  it("still drops a fee a full schedule leaves out, whatever its opening says", () => {
    // A full schedule that opens with notice-like words, or reprints every fee in a change table,
    // lists as many fees as the older copy: its silence still drops a fee.
    const schedule = [
      "Schedule of Fees",
      "The fees listed below are subject to change without notice.",
      ...JDCU_OLDER.split("\n").slice(1).filter((line) => !line.startsWith("Statement Reprint")),
    ].join("\n");
    expect(currentCopyVerdict(fee(1, "Statement Reprint", "5.00"), schedule, JDCU_OLDER)).toBe("dropped");
    // Known only by its change table, a copy reprinting nearly every fee is a schedule.
    const reprinted = [
      "Fees | Fee through | Fee as of",
      ...JDCU_OLDER.split("\n").slice(1).filter((line) => !line.startsWith("Statement Reprint")).map((line) => `${line} | ${line.split("| ")[1]}`),
    ].join("\n");
    expect(feeChangeNoticeKind(reprinted)).toBe("table");
    expect(listsFewerFees(reprinted, JDCU_OLDER, "table")).toBe(false);
    expect(currentCopyVerdict(fee(1, "Statement Reprint", "5.00"), reprinted, JDCU_OLDER)).toBe("dropped");
  });

  it("needs only fewer fees than the older copy when the notice says outright that fees changed (re-review)", () => {
    const older = "Schedule of Fees\nMoney Orders | $2.00\nStop Payment | $30.00\nStatement Reprint | $5.00\nWire Transfer Outgoing | $25.00";
    const notice = "General Fee Changes:\nThe fees highlighted below have been adjusted.\nMoney Orders | $5.00\nStop Payment | $35.00";
    expect(feeChangeNoticeKind(notice)).toBe("stated");
    expect(listsFewerFees(notice, older, "stated")).toBe(true);
    expect(listsFewerFees(notice, older, "table")).toBe(false);
    expect(currentCopyVerdict(fee(1, "Statement Reprint", "5.00"), notice, older)).toBe("unproven");
    expect(currentCopyVerdict(fee(2, "Wire Transfer Outgoing", "25.00"), notice, older)).toBe("unproven");
    // A row the notice reprices is still stale.
    expect(currentCopyVerdict(fee(3, "Stop Payment", "30.00", { canonical_fee_key: "stop_payment" }), notice, older)).toBe("still_named");
    // As many priced lines as the older copy: a schedule, whatever it says.
    const full = `${notice}\nStatement Reprint | $5.00\nWire Transfer Incoming | $10.00`;
    expect(listsFewerFees(full, older, "stated")).toBe(false);
  });

  it.each([
    ["Overdraft Fee: Per Occurrence"],
    ["Overdraft - Per Transaction"],
  ])("never anchors %s on its per-unit words (re-review)", (name) => {
    const current = `${filler}Courtesy Pay $35.00\nStop Payment per occurrence..........Research per transaction.......... $30.00$29.00\n`;
    expect(interleavedPriceWitness(name, 29, current)).toBe(false);
    expect(currentCopyVerdict(fee(1, name, "29.00", { canonical_fee_key: "overdraft" }), current, `${filler}${name} | $29.00\n`)).not.toBe("unproven");
  });

  it("keeps a fee stale when the priced line above the glued prices is its own (review of 3d9f46ef9)", () => {
    const current = `${filler}Card Replacement Fee $20.00\nShare Draft Protest..........Statement Copy.......... $10.00$5.00\n`;
    expect(interleavedPriceWitness("Card Replacement Fee", 10, current)).toBe(false);
    expect(currentCopyVerdict(fee(1, "Card Replacement Fee", "10.00", { canonical_fee_key: "card_replacement" }), current, `${filler}Card Replacement Fee | $10.00\n`)).toBe("still_named");
  });

  it("never anchors on generic fee words, and judges a fee priced on a line of its own there", () => {
    const current = `${filler}NSF Fee $35.00\nStop Payment (per item)..........Research.......... $30.00$25.00\n`;
    expect(interleavedPriceWitness("NSF Fee - Per Item", 25, current)).toBe(false);
    expect(currentCopyVerdict(fee(1, "NSF Fee - Per Item", "25.00", { canonical_fee_key: "nsf" }), current, `${filler}NSF Fee - Per Item | $25.00\n`)).toBe("still_named");
    // Generic words alone never anchor, even on the glued line itself.
    expect(interleavedPriceWitness("Per Item Fee", 25, "Stop Payment (per item)..........Research.......... $30.00$25.00")).toBe(false);
  });

  it("finds a glued price only beside the fee's own label", () => {
    const line = "Card Replacement ..........Share Draft Protest .......... $20.00$10.00";
    expect(interleavedPriceWitness("Card Replacement", 10, line)).toBe(true);
    expect(interleavedPriceWitness("Card Replacement", 15, line)).toBe(false);
    expect(interleavedPriceWitness("Wire Transfer", 10, line)).toBe(false);
    expect(interleavedPriceWitness("Card Replacement", 10, "Card Replacement | $20.00 | $10.00")).toBe(false);
  });

  it("clears a first look on a fee it can no longer prove stale", () => {
    const rows = [
      fee(1, "Money Orders", "2.00"),
      fee(2, "Same Day ACH Service Charge", "10.00"),
      fee(3, "Coin Counting (non-members)", "5.00"),
    ];
    const doc = judgeAgainstCurrentCopy(rows, NOTICE, JDCU_OLDER);
    // One fee stated is too few to recognize the notice as the schedule: nothing fails, and the
    // fees it could not prove stale clear any first look they carry.
    expect(doc.recognized).toBe(false);
    expect(doc.failing).toEqual([]);
    expect(doc.notProven).toEqual(expect.arrayContaining([1, 3]));
    expect(doc.notProven).not.toContain(2);
  });
});

describe("currentCopyVerdict v4 (#2072 resample, Oct 30: 8 of 20 v3 first looks stale)", () => {
  // Each case is a sampled first look, built from the stored text of the bank's older and current
  // copies (triage/switches-2072-resample.md, section B). The 12 wrong flags are no longer flagged;
  // the stale ones still are.
  const judge = (id: number, name: string, amount: string, current: string, older: string, key = "fee") =>
    currentCopyVerdict(fee(id, name, amount, { canonical_fee_key: key }), current, older);

  // Oregon State CU, docs 22947 -> 39738: footnote 2 glued onto the price.
  const OSCU_OLDER = [
    "Domestic Outgoing ........................................ $30 2",
    "Stop payment of personal check ............................ $25 2",
    "Incoming wire ............................................. $15 2",
    "Check copy ................................................ $5 per check 2",
    "Rewards Checking ............ $7 per month | Stop payment for cashier’s check ............ $30 2",
  ].join("\n");
  const OSCU_CURRENT = [
    "Outgoing ..................................................................................... $302",
    "U.S. and foreign funds ................................................................. $35 + third-party fees5",
    "Incoming wire ................................................................................ $152",
    "More than 6 transactions per month .......................................... $1.50 per transaction2",
    "Other machines ............................................................................. $1.50 per transaction2",
    "Temporary checks ............................................................. $2 per page2",
    "Cashier’s check ............................................................................... $5 per check2",
    "Stop payment for cashier’s check .................................................. $302",
  ].join("\n");

  it("does not judge a price whose footnote mark the page glued on (Oregon State CU 99821, 149010)", () => {
    expect(judge(99821, "Incoming wire", "15.00", OSCU_CURRENT, OSCU_OLDER)).toBe("unproven");
    expect(judge(149010, "Stop payment for cashier’s check", "30.00", OSCU_CURRENT, OSCU_OLDER)).toBe("unproven");
    // Without marks glued to words elsewhere, "$152" is read as written: a live $15 is still suspect.
    const unmarked = OSCU_CURRENT.replace(/(per (?:transaction|page|check)|fees)\d/g, "$1");
    expect(judge(99821, "Incoming wire", "15.00", unmarked, OSCU_OLDER)).toBe("still_named");
  });

  // Cross Valley FCU, docs 2600 -> 40694: box sizes with inch marks.
  const CVFCU_OLDER = "Safe Deposit Boxes\n10x10=$100 per year\n5x10=$75 per year\neMobile Texts (over 16) | $.05/text | 5x5=$50 per year\n3x10=$35 per year\n$10.00 | 3x5=$25 per year\nCheck Copies $2.00\nCheck Copies (after 1 year) $5.00";
  const CVFCU_CURRENT = "Check Copies | $2.00\nSafe Deposit Boxes (Wilkes-Barre + Mocanaqua)\n10″x10″ Box | $100/year\n5″x10″ Box | $75/year\n4″x10″ Box | $55/year\n3″x10″ Box | $35/year\n5″x5″ Box | $50/year\n3″x5″ Box | $25/year";

  it("reads a box size printed with inch marks as the stored size (Cross Valley FCU 61519, 51100)", () => {
    expect(withoutInchMarks("5″x5″ Box | 3\" x 5\" | 3′×10′")).toBe("5x5 Box | 3x5 | 3×10");
    expect(judge(61519, "5x5", "50.00", CVFCU_CURRENT, CVFCU_OLDER, "safe_deposit_box")).toBe("still_stated");
    expect(judge(51100, "3x5", "25.00", CVFCU_CURRENT, CVFCU_OLDER, "safe_deposit_box")).toBe("still_stated");
    // Stale in the same sample: the current page keeps only "Check Copies | $2.00".
    expect(judge(51084, "Check Copies (after 1 year)", "5.00", CVFCU_CURRENT, CVFCU_OLDER, "check_image")).toBe("still_named");
  });

  // Rivermark CU, docs 6390 -> 13266: a wrapped table row.
  const RIVERMARK_OLDER = "Membership Services Research & Reconciliation $25 per hour For complex requests. Inactive Account $5 per month For memberships with no loan or deposit account activity in 12 months and an aggregate deposit balance of less than $500. Cashier's Check $5 One free check per day. Checking & Savings Services NSF Item Paid* NSF=Non-Sufficient Funds) $20 Charged when a check, Visa debit, or ACH debit is paid but overdraws the account. NSF Item Returned* NSF=Non-Sufficient Funds) $5 Charged when a check is returned unpaid.";
  const RIVERMARK_CURRENT = [
    "For memberships with no loan or deposit account activity in 12 months and",
    "$5 per | an aggregate deposit balance of less than $500. Fee(s) may result in",
    "Inactive Account",
    "month | reducing the balance to zero and closure of membership. Waived if member",
    "is under age 19 and for Access Checking accounts.",
    "Cashier's Check | One free check per day, a fee is assessed for each Cashier's Check issued",
    "$5 | thereafter.",
    "NSF Item Paid* | Charged when a check, Visa debit, or ACH debit is paid but overdraws the",
    "NSF=Non-Sufficient | $20",
    "account because of insufficient funds in the account to cover the transaction.",
    "Funds)",
    "NSF Item Returned*",
    "NSF=Non-Sufficient | $5 | Charged when a check, Visa debit, or ACH debit is returned unpaid because",
  ].join("\n");

  it("does not judge a row whose name and price a wrapped table put on neighbouring lines (Rivermark 119506, 119519)", () => {
    expect(judge(119506, "Inactive Account", "5.00", RIVERMARK_CURRENT, RIVERMARK_OLDER, "dormant_account")).toBe("unproven");
    expect(judge(119519, "Checking & Savings Services NSF Item Paid NSF=Non-Sufficient Funds", "20.00", RIVERMARK_CURRENT, RIVERMARK_OLDER, "overdraft")).toBe("unproven");
    // A table that prints each name over its own price never lends the price above (OCFCU 50040, stale).
    const nameOverPrice = "Replace Visa Debit Card\n$10.00\nOvernight Delivery - Visa Debit Card or PIN, each\n$40.00\nCheck Printing\nVaries";
    expect(wrappedRowWitness("Overnight Delivery - Visa Debit Card or PIN", 10, nameOverPrice)).toBe(false);
    expect(judge(50040, "Overnight Delivery - Visa Debit Card or PIN", "30.00", nameOverPrice,
      "Replace Visa Debit Card | $10.00\nOvernight Delivery - Visa Debit Card or PIN, each | $30.00\nCheck Printing | Varies", "rush_card")).toBe("still_named");
  });

  it("reads a name wrapped at its slash as one name (ECU 38415)", () => {
    const older = "Account Closed Early Fee\n\n$15.00\n\nPer Account\n\nAccount Research/Reconciliation Fee\n\n$25.00\n\nPer Hour (1 Hour Minimum)\n\nBad Address Fee\n\n$5.00";
    const current = "Account Closed Early Fee\n\n$15.00\n\nPer Account\n\nAccount Research\n/Reconciliation Fee\n\n$25.00\n\nPer Hour (1 Hour Minimum)\n\nBad Address Fee\n\n$5.00";
    expect(priceFollowsName("Account Research/Reconciliation Fee", 25, current)).toBe(true);
    expect(judge(38415, "Account Research/Reconciliation Fee", "25.00", current, older, "account_research")).toBe("still_stated");
    expect(judge(38415, "Account Research/Reconciliation Fee", "25.00", current.replace("$25.00", "$35.00"), older, "account_research")).toBe("still_named");
  });

  it("does not judge a fee whose name a two-column PDF glued to the next column's (Access FCU 27733)", () => {
    const older = "Bill Payment Insufficient Funds Surcharge (each item) | $15.00\n\nCopy of Prior Month's Statement (per page) | $1.00\n\nDormant Account Fee (annual) | $5.00";
    const current = [
      "ACH Revoke .....................................................ACH Revoke............................................................ $10.00$10.00",
      "Bill Payment Insufficient Funds SurchargeCopy of Prior Month’s Statement (per page) ......... | $ 1.00",
      "Dormant Account Fee (annual) .............................. | $ 5.00",
      "Inactive Share Fee (monthly) ...........................(each item) …………………………………. ... $ 5.00$15.00",
      "Copy of Prior Month’s Statement (per page) ....Insufficient Funds (each item)................................. $25.00$ 1.00",
    ].join("\n");
    expect(judge(27733, "Bill Payment Insufficient Funds Surcharge (each item)", "15.00", current, older, "nsf")).toBe("unproven");
    // The same name priced on a line of its own, not glued to another column, judges the fee.
    const own = current.replace("SurchargeCopy of Prior Month’s Statement (per page) ......... | $ 1.00", "Surcharge (each item) .... | $ 20.00");
    expect(judge(27733, "Bill Payment Insufficient Funds Surcharge (each item)", "15.00", own, older, "nsf")).toBe("still_named");
  });

  it("does not judge a fee in a comparison table flattened cell by cell (Flagstar 91549)", () => {
    const older = "Interest bearing | No | Yes\nMonthly fee | $25 | $25\nFees offset with | Earnings credit | Earnings credit";
    const current = "Monthly fee waived with\n\nMonthly fee\n\nBusiness Solutions\nAnalysis Checking3\n\nBusinesses with high\ntransaction volume, high\n\n200\ntransactions at no charge\n\nNo\n\nN/A\n\n$0\n\nUnlimited\n\nNo\n\n$25\n\nEarnings credit\n\n$15\nif balance is $0 - $999.99";
    expect(columnTableWitness("Monthly fee", 25, current)).toBe(true);
    expect(judge(91549, "Monthly fee", "25.00", current, older, "monthly_maintenance")).toBe("unproven");
    // A copy that prices the label on a line (Regions, "Monthly Fee | $18") is judged as usual.
    expect(columnTableWitness("Monthly fee", 25, `${current}\nMonthly Fee | $18`)).toBe(false);
  });

  // Jeanne D'Arc CU, docs 12122 -> 21764: a notice printing its change table once per account group.
  const JD_OLDER = [
    "Fee Schedule", "Money Orders | $5.00 ea.", "Treasurer’s Checks | $5.00 ea.", "Replacement ATM or Debit Card | $10.00 ea.",
    "Rush Replacement ATM or Debit Card | $60.00 ea.", "Stop Payment Fee | $30.00 ea.", "Deposited Items Returned | $7.00 ea.",
    "Overdraft Savings Transfer | $5.00 per day", "Checking Account Inactivity (After 18 Months) | $5.00 per month",
    "Foreign Check Collection | $20.00 ea.", "IRA Transfer Fee | $50.00 ea.", "Signature Guarantee Fee | $25.00 ea.",
    "Same Day ACH Service Charge | $10.00 ea.", "Account Research | $50.00 per hour", "Non-Member Check Cashing | $5.00 ea.",
    "Non-Member Notary | $10.00 ea.",
  ].join("\n");
  const JD_TABLE = [
    "Money Orders | $2.00 | $5.00", "Rush Replacement ATM or Debit Card | $20.00 | $60.00", "Same Day ACH Service Charge | $10.00 | $10.00",
    "Stop Payment | $25.00 | $30.00", "IRA Transfer | $15.00 | $50.00", "Signature Guarantee | $0.00 | $25.00",
    "Account Research | $35.00 per hour | $50.00 per hour", "Treasurer Checks | $0.00 | $5.00",
  ];
  const JD_NOTICE = [
    "General Fee Changes:",
    "The fees highlighted below have been adjusted and will be effective on August 1, 2026. These apply to",
    "Consumer and Business Account Fees | Fee through | Fee as of",
    ...JD_TABLE,
    "The fees highlighted below have been adjusted on our 18/65 accounts and will be effective on August 1,",
    "18/65 Account Fees | Fee through | Fee as of",
    ...JD_TABLE,
    "Debit Card or ATM Card Replacement | $0.00 | $10.00",
    "Incoming Wire Fee (Domestic & International) | $0.00 | $10.00",
  ].join("\n");

  it("counts a notice's fees by their distinct rows, so a table printed twice is still a notice (JDCU 64213, 64211, 93814)", () => {
    const pricedLines = (text: string) => text.split("\n").filter((line) => /\$\d/.test(line)).length;
    expect(pricedLines(JD_NOTICE)).toBeGreaterThan(pricedLines(JD_OLDER));
    expect(listsFewerFees(JD_NOTICE, JD_OLDER, "stated")).toBe(true);
    expect(judge(64213, "Checking Account Inactivity (After 18 Months)", "5.00", JD_NOTICE, JD_OLDER, "dormant_account")).toBe("unproven");
    expect(judge(64211, "Deposited Items Returned", "7.00", JD_NOTICE, JD_OLDER, "deposited_item_return")).toBe("unproven");
    expect(judge(93814, "Non-Member Notary", "10.00", JD_NOTICE, JD_OLDER, "notary_fee")).toBe("unproven");
  });

  it("keeps a stale flag when refresh-copy left too few live fees to recognize the schedule by (Gala Bank 97804, Tampa Bay FCU 6082)", () => {
    const rows = ["Account closing (90 days from opening date) | $25.00", "IRA Closing Fee | $25.00", "Dormant account (per month) | $15.00",
      "Paper statements (per month) | $5.00", "Return deposit item | $10.00", "Stop Payment | $30.00", "Debit Card - Non Presto network | $3.00",
      "Wire transfer (incoming domestic) | $15.00"];
    const galaOlder = ["Account Name | Fee Amount", ...rows, "Debit Card - lost or stolen card | $10.00"].join("\n\n");
    const galaCurrent = ["Account Name | Fee Amount", ...rows, "Debit Card - lost or stolen card | $5.00"].join("\n\n");
    const gala = judgeAgainstCurrentCopy([fee(97804, "Debit Card - lost or stolen card", "10.00", { canonical_fee_key: "card_replacement" })], galaCurrent, galaOlder);
    expect(gala.recognized).toBe(true);
    expect(gala.failing.map((candidate) => candidate.feePublishedId)).toEqual([97804]);

    // Tampa Bay FCU: the older copy prints each name over its price, the current one as a table row.
    const tampaOlder = "Prime Time (new members-one time)\n$5.00\nLoan Modification\n$15.00\nCheck Photocopy (each)\n$2.00\nReturned Mail (each)\n$5.00\nStatement Copy (each)\n$3.00\nCoin and Currency Requests\nStanding Order\n$3.00\nSpecial Order\n$5.00\nPer Roll\n$0.15";
    const tampaCurrent = "Prime Time (new members-one time) | $5.00\nLoan Modification | $15.00\nCheck Photocopy (each) | $2.00\nReturned Mail (each) | $5.00\nStatement Copy (each) | $3.00\nServices\nCoin Machine (member- ) | 6% of coin amount over $100";
    expect(restatesOlderRows(tampaCurrent, tampaOlder)).toBe(true);
    const tampa = judgeAgainstCurrentCopy(
      [fee(6082, "Coin and Currency Special Order", "5.00", { canonical_fee_key: "coin_counting" }), fee(69931, "Check Photocopy (each)", "2.00")],
      tampaCurrent, tampaOlder,
    );
    expect(tampa.recognized).toBe(true);
    expect(tampa.failing.map((candidate) => candidate.feePublishedId)).toEqual([6082]);
    // An error page restates none of the older rows: nothing is judged.
    expect(restatesOlderRows("Page not found\nHome | Contact", tampaOlder)).toBe(false);
  });

  it("still flags the stale fees of the same sample", () => {
    // 50033: "Returned deposited item or loan payment, each / $35.00" against a live $25.
    expect(judge(50033, "Return Deposit item", "25.00", "Returned deposited item or loan payment, each\n$35.00\nDraft or ACH Stop Payment, each\n$20.00",
      "Return Deposit item, each | $25.00\nDraft or ACH Stop Payment, each | $20.00", "deposited_item_return")).toBe("still_named");
    // 115075: the same row at a new price.
    expect(judge(115075, "Returned Deposited Items - Charge Back", "15.00", "Returned Deposited Items - Charge Back | $25.00\nAccount Reconciliation (per hour) | $20.00",
      "Returned Deposited Items - Charge Back | $15.00\nAccount Reconciliation (per hour) | $20.00", "deposited_item_return")).toBe("still_named");
  });

  describe("an ordinary name-over-price page keeps its price rises stale (review of 37760d2c)", () => {
    const NAME_OVER_PRICE = "Fee Schedule\nOverdraft Fee\n$30.00\nStop Payment\n$30.00\nWire Transfer Outgoing\n$25.00\nPaper Statement\n$3.00";

    it("A: another row's bare price at the fee's old amount is not the fee's", () => {
      const current = NAME_OVER_PRICE.replace("Overdraft Fee\n$30.00", "Overdraft Fee\n$35.00");
      expect(judge(1, "Overdraft Fee", "30.00", current, NAME_OVER_PRICE)).toBe("still_named");
      expect(columnTableWitness("Overdraft Fee", 30, current)).toBe(false);
      expect(wrappedRowWitness("Overdraft Fee", 30, current)).toBe(false);
      const doc = judgeAgainstCurrentCopy([fee(1, "Overdraft Fee", "30.00"), fee(2, "Stop Payment", "30.00"), fee(3, "Wire Transfer Outgoing", "25.00")], current, NAME_OVER_PRICE);
      expect(doc.failing.map((candidate) => candidate.feePublishedId)).toEqual([1]);
    });

    it("B: a unit line between the name and its new price", () => {
      const current = "Fee Schedule\nOverdraft Fee\n$30.00\nStop Payment\nper item\n$35.00\nWire Transfer Outgoing\n$25.00";
      expect(columnTableWitness("Stop Payment", 30, current)).toBe(false);
      expect(wrappedRowWitness("Stop Payment", 30, current)).toBe(false);
      expect(judge(2, "Stop Payment", "30.00", current, NAME_OVER_PRICE)).not.toBe("unproven");
    });

    it("C: a fee now free", () => {
      const current = NAME_OVER_PRICE.replace("Stop Payment\n$30.00", "Stop Payment\nFree");
      expect(columnTableWitness("Stop Payment", 30, current)).toBe(false);
      expect(wrappedRowWitness("Stop Payment", 30, current)).toBe(false);
      expect(judge(2, "Stop Payment", "30.00", current, NAME_OVER_PRICE)).not.toBe("unproven");
    });

    it("D: a raise to another row's price", () => {
      const older = NAME_OVER_PRICE.replace("Stop Payment\n$30.00", "Stop Payment\n$25.00");
      const current = older.replace("Wire Transfer Outgoing\n$25.00", "Wire Transfer Outgoing\n$30.00");
      expect(columnTableWitness("Wire Transfer Outgoing", 25, current)).toBe(false);
      expect(wrappedRowWitness("Wire Transfer Outgoing", 25, current)).toBe(false);
      expect(judge(3, "Wire Transfer Outgoing", "25.00", current, older)).toBe("still_named");
    });

    it("counts a name-over-price copy's rows one per name, so a full schedule is no notice", () => {
      const older = ["Overdraft Fee | $30.00", "Stop Payment | $30.00", "Wire Transfer Outgoing | $25.00", "Paper Statement | $3.00",
        "Money Order | $5.00", "Cashier's Check | $8.00", "Account Research | $25.00", "ATM Fee | $2.00"].join("\n");
      const current = ["The following fees will change effective Jan 1.", "Overdraft Fee", "$35.00", "Stop Payment", "$30.00", "Wire Transfer Outgoing", "$25.00",
        "Paper Statement", "$3.00", "Money Order", "$5.00", "Cashier's Check", "$8.00", "Account Research", "$25.00", "Returned Item", "$30.00", "Dormant Account", "$5.00"].join("\n");
      expect(listsFewerFees(current, older, "stated")).toBe(false);
      expect(judge(8, "ATM Fee", "2.00", current, older)).toBe("dropped");
    });

    it("counts a name over a price with its unit as one row (review of ba03814fa)", () => {
      const older = ["Overdraft Fee | $30.00", "Stop Payment | $30.00", "Wire Transfer Outgoing | $25.00", "Paper Statement | $3.00",
        "Money Order | $5.00", "Cashier's Check | $8.00", "Account Research | $25.00", "ATM Fee | $2.00"].join("\n");
      const current = ["The following fees will change effective Jan 1.", "Overdraft Fee", "$35.00 per item", "Stop Payment", "$35.00 per item",
        "Wire Transfer Outgoing", "$25.00 each", "Paper Statement", "$3.00 per statement", "Money Order", "$5.00 per item", "Cashier's Check", "$8.00 per check",
        "Account Research", "$25.00 per hour", "Returned Item", "$30.00 per item", "Dormant Account", "$5.00 per month"].join("\n");
      expect(listsFewerFees(current, older, "stated")).toBe(false);
      expect(judge(8, "ATM Fee", "2.00", current, older)).toBe("dropped");
    });

    it("never reads the price above a wrapped name as the name's when it is another row's priced unit line", () => {
      const current = "Overdraft Fee\n$30.00 per item\nStop Payment\nPlaced by phone or online\nmay take one business day\n$35.00 per item";
      expect(wrappedRowWitness("Stop Payment", 30, current)).toBe(false);
    });

    it("reads \"No fee\" as the fee's own cell", () => {
      const current = "Overdraft Fee\n$30.00 per item\nStop Payment\nNo fee\nWire\n$25.00";
      expect(wrappedRowWitness("Stop Payment", 30, current)).toBe(false);
    });

    it("reads a description run onto a name as no column glue", () => {
      const current = "Overdraft FeeCharged when an item is paid into a negative balance | $35.00\nStop Payment ........ $10.00$30.00";
      expect(interleavedPriceWitness("Overdraft Fee", 30, current)).toBe(false);
    });
  });
});

describe("current-copy check v5 (v4 resample, Oct 30: 3 wrong wrong_document labels, 1 false flag)", () => {
  // 1776 Bank (institution 351), https://www.1776bank.com/fee-schedule/: the fee table of older copy
  // 22862 and current copy 40058, as stored on prod (agent_source_texts.normalized_text). The current
  // copy keeps the page's <br> inside each row's label cell.
  const OLDER_1776 = readFileSync(join(__dirname, "__fixtures__", "1776-bank-22862-older.txt"), "utf8");
  const CURRENT_1776 = readFileSync(join(__dirname, "__fixtures__", "1776-bank-40058-current.txt"), "utf8");
  // The live fees on 22862 that 40058 holds no verified row for (prod, read-only, Oct 30).
  const live1776 = ([
    [99341, "Returned Mail per mail item returned to the Bank - after 1st item", "5.00", "account_research"],
    [99347, "Dormant Account Fee", "5.00", "dormant_account"],
    [99349, "Nonsufficient Funds (NSF)", "35.00", "nsf"],
    [99350, "Overdraft This fee is imposed per item presented, that is PAID which overdrafts the checking account", "35.00", "overdraft"],
    [99364, "### Wire Transfer Fees: Foreign", "20.00", "wire_intl_outgoing"],
    [151683, "Incoming Wire Transfer: Foreign", "20.00", "wire_intl_incoming"],
  ] as const).map(([id, name, amount, key]) =>
    fee(id, name, amount, { institution_id: 351, older_document_id: 22862, current_document_id: 40058, canonical_fee_key: key }));

  describe("a break in a table row's label cell (1776 Bank NSF $35, fee 99349)", () => {
    it("reads the NSF row as still stating $35, so nothing on the copy is suspected", () => {
      const nsf = live1776.find((row) => row.fee_published_id === 99349)!;
      expect(currentCopyVerdict(nsf, CURRENT_1776, OLDER_1776)).toBe("still_stated");
      const doc = judgeAgainstCurrentCopy(live1776, CURRENT_1776, OLDER_1776);
      expect(doc.outcome).toBe("ok");
      expect(doc.failing).toEqual([]);
      expect(doc.passing).toContain(99349);
    });

    it("still suspects the NSF fee when the row's own price cell changes", () => {
      const raised = CURRENT_1776.replace("previously rejected. | $35.00 |", "previously rejected. | $38.00 |");
      expect(raised).not.toBe(CURRENT_1776);
      const doc = judgeAgainstCurrentCopy(live1776, raised, OLDER_1776);
      expect(doc.failing.map((candidate) => [candidate.feePublishedId, candidate.verdict])).toEqual([[99349, "still_named"]]);
    });

    it("joins breaks in a row's label cell only, leaving other cells and other lines as lines", () => {
      expect(withLabelBreaksJoined("| Nonsufficient Funds (NSF)<br>This fee is imposed per item. | $35.00 |"))
        .toBe("| Nonsufficient Funds (NSF) This fee is imposed per item. | $35.00 |");
      // Doc 40020: two values in one price cell stay two lines.
      expect(readableCurrentText("| ***Debit Card*** | No Annual Fee<br>$10.00 Card Replacement Fee |"))
        .toBe("| ***Debit Card*** | No Annual Fee\n$10.00 Card Replacement Fee |");
      expect(readableCurrentText("No Annual Fee<br>$10.00 Card Replacement Fee")).toBe("No Annual Fee\n$10.00 Card Replacement Fee");
    });
  });

  describe("a copy with no fee judged is not judged, not wrong_document", () => {
    const other = "Fee Schedule\nOverdraft Fee $35.00\nStop Payment $30.00\nOnline Bill Pay FREE";
    it("records a copy whose only live fee is $0 as not judged (institution 8400)", () => {
      const doc = judgeAgainstCurrentCopy([fee(1, "Free Bill Payer", "0.00")], other, `${other}\nFree Bill Payer $0.00`);
      expect(doc).toMatchObject({ outcome: "not_judged", recognized: false, failing: [] });
      expect(currentCopyAttemptOutcome(doc.outcome)).toBe("no_candidates");
    });

    it("records a copy whose only live fee has no amount as not judged (institution 8392)", () => {
      const rate = "Visa Currency Conversion | 1% of total purchase(s)";
      const doc = judgeAgainstCurrentCopy([fee(1, "Visa Currency Conversion", "0", { amount: null })], `${other}\n${rate}`, `${OLDER}\n${rate}`);
      expect(doc).toMatchObject({ outcome: "not_judged", failing: [] });
    });

    it("keeps wrong_document for a copy with fees judged that is another page", () => {
      const doc = judgeAgainstCurrentCopy(fees.map((row) => ({ ...row, restated_row: false })), "Page not found", OLDER);
      expect(doc.outcome).toBe("wrong_document");
      expect(currentCopyAttemptOutcome(doc.outcome)).toBe("wrong_document");
    });
  });

  describe("a current copy with the older copy's text is the same schedule (institution 608)", () => {
    // The live $8 is not on either copy (the page prices Gold Checking at $3), so it is unproven.
    const page = "Gold Checking | $3.00 a month\nStop Payment $30.00";
    it("is ok, suspecting nothing, even with no fee judged", () => {
      const doc = judgeAgainstCurrentCopy([fee(1, "Gold Checking Monthly service fee", "8.00")], page, `${page}\n`);
      expect(sameCopyText(page, `${page}\n`)).toBe(true);
      expect(doc).toMatchObject({ outcome: "ok", sameText: true, recognized: true, failing: [] });
      expect(doc.notProven).toEqual([1]);
    });

    it("never treats two empty texts as the same copy", () => {
      expect(sameCopyText("", " \n")).toBe(false);
    });
  });

  it("records a not-judged copy as no_candidates with detail.not_judged, and counts it apart from wrong_document", async () => {
    const db = createDb(null, [fee(1, "Free Bill Payer", "0.00")]);
    const result = await secondLookFeesNotOnCurrentCopy(db, { ...options, confirmLive: false });
    expect(result).toMatchObject({ documentsChecked: 1, unrecognized: 0, notJudged: 1, failing: 0 });
    expect(result.copies).toEqual([{ older: 40, current: 41, recognized: false, retired: false, outcome: "not_judged" }]);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("no_candidates");
    expect(calls).toContain("not_judged");
    expect(calls).not.toContain("wrong_document");
  });
});
