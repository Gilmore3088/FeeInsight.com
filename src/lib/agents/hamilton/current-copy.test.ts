import { describe, expect, it, vi } from "vitest";

import { countCurrentCopyPairs, currentCopyVerdict, interleavedPriceWitness, isFeeChangeNotice, judgeAgainstCurrentCopy, linkYear, listsFewerFees, readableCurrentText, retiredCopiesSql, retiredCopyIsNewer, secondLookFeesNotOnCurrentCopy, type CurrentCopyFeeRow } from "./current-copy";

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
    expect(result.copies).toEqual([{ older: 40, current: 41, recognized: true, retired: false }]);
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
    expect(result.copies).toEqual([{ older: 40, current: 41, recognized: true, retired: true }]);
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
    const reprinted = [
      "The fees highlighted below have been adjusted and will be effective on August 1, 2026.",
      "Fees | Fee through | Fee as of",
      ...JDCU_OLDER.split("\n").slice(1).filter((line) => !line.startsWith("Statement Reprint")).map((line) => `${line} | ${line.split("| ")[1]}`),
    ].join("\n");
    expect(isFeeChangeNotice(reprinted)).toBe(true);
    expect(listsFewerFees(reprinted, JDCU_OLDER)).toBe(false);
    expect(currentCopyVerdict(fee(1, "Statement Reprint", "5.00"), reprinted, JDCU_OLDER)).toBe("dropped");
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
