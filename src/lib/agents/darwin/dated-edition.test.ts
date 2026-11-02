import { describe, expect, it } from "vitest";
import { datedEditionTakesOver, judgeDatedEditions, namesOneProduct, oneSchedule, scheduleMarket, type DatedEditionRow } from "./dated-edition";
import { readStatedDate } from "@/lib/agents/magellan/stated-date";
import { normalizedFeeName } from "@/lib/agents/hamilton/publish";

// #1945, prod Oct 25 (read-only): Cedar Falls Community CU (7833). Its homepage links the 2026 schedule.
const OLD_URL = "https://cfccu.org/wp-content/uploads/2024/06/PL2404101541-2024-Fee-Schedule_0619.pdf";
const NEW_URL = "https://cfccu.org/wp-content/uploads/2026/03/2026-Fee-Schedule.pdf";
// Stored text 4321 (doc 2671), its head verbatim; the PDF's "ff" ligature splits "Effective".
const OLD_TEXT = "FEE SCHEDULE\nRevised: 4/30/2024\nEff ective: 5/1/2024\nClose Account Fee | $5.00 if account is closed within 1 year of opening\nDormant Account Fee - | $15.00 per year\n";
// Stored text 29778 (doc 31873): no edition heading, the date only at its foot.
const NEW_TEXT = "CFCCU FEE SCHEDULE\nClose Account Fee | $5.00\nNSF Item Held & Paid | $28.00 (Maximum 4 per day)\nRe-Key | $50.00\nCoin Counting Fee - Non-Members | 3% of Total\nRevised 03/2026";

// The fee names of each document's verified rows, as stored.
const OLD_NAMES = [
  "Account Research", "Cashier’s Check to 3rd Party", "Close Account Fee", "Coin Counting for Non-Members",
  "Copy of Debit/Credit Card Charge Slip", "Dormant Account Fee", "Expedited Card Replacement",
  "Fee for ATM transactions in excess of 10 per month", "Foreign Wire--Incoming", "Foreign Wire—Outgoing",
  "Garnishment/Levy Revenue & Finance Levy Fee", "Incoming Domestic Wire Transfer", "NSF Item Held & Paid Daily Cap",
  "NSF Item Held & Paid daily maximum", "NSF Item Returned", "Outgoing Domestic Wire Transfer",
  "Plastic Card Replacement for Lost, Stolen", "Re-Key Box Due to Lost Key", "Safe Deposit Box Drilling Fee",
  "Safe Deposit Box Rental Fee 3 x 10", "Safe Deposit Box Rental Fee 5 x 10", "Stop Payment Order",
  "Stop Payment Order (Online Bill Pay)",
];
const NEW_NAMES = [
  "NSF Item Returned", "Stop Payment Order", "Stop Payment Order (Bill Pay)", "Copy of Cashier's Check",
  "Cashier's Check to 3rd Party", "Fee for Atm transactions in excess of 10 per month", "Express Card Replacement",
  "Incoming Domestic Wire Transfer", "Outgoing Domestic Wire Transfer", "Foreign Wire - Outgoing", "Photocopies",
  "Account research", "Fax fee", "Garnishment/Levy Revenue & Finance Levy Fee", "Safe Deposit Box Rental 3x10",
  "Safe Deposit Box Rental 5x10", "Safe Deposit Box Rental 10x10", "Safe Deposit Box Drilling Fee",
  "Re-Key Box due to Lost Key", "Coin Counting Fee - Non-Members", "Foreign Wire - Incoming",
  "Copy of Debit/Credit Card Charge Slip", "Printed Account Statement",
];

const names = (list: string[]) => new Set(list.map(normalizedFeeName));
const OLD_DOC = { url: OLD_URL, statedDate: "2024-04-30", statedBasis: "printed_date", names: names(OLD_NAMES) };
const NEW_DOC = { url: NEW_URL, statedDate: "2026-03-01", statedBasis: "printed_date", names: names(NEW_NAMES) };

let nextId = 1;
function row(doc: 2671 | 31873, name: string, over: Partial<DatedEditionRow> = {}): DatedEditionRow {
  const id = nextId++;
  return {
    fee_verified_id: 1000 + id, fee_published_id: null, institution_id: 7833, fee_name: name, amount: 20,
    canonical_fee_key: "stop_payment", fee_audience: "consumer", source_document_id: doc,
    document_url: doc === 2671 ? OLD_URL : NEW_URL, stated_date: doc === 2671 ? "2024-04-30" : "2026-03-01",
    stated_date_basis: "printed_date", behind_fee_published_id: null, ...over,
  };
}

/** Each document's verified rows (names only), not live and skipped behind nothing. */
function fill(doc: 2671 | 31873, list: string[]): DatedEditionRow[] {
  return list.map((name) => row(doc, name, { canonical_fee_key: "other" }));
}

describe("dated editions (#1945)", () => {
  it("dates Cedar's two schedules by the dates their own texts print", () => {
    expect(readStatedDate(OLD_TEXT, OLD_URL)).toMatchObject({ date: "2024-04-30", basis: "printed_date" });
    expect(readStatedDate(NEW_TEXT, NEW_URL)).toMatchObject({ date: "2026-03-01", basis: "printed_date" });
  });

  it("takes Cedar's 2026 schedule for a later edition of its 2024 one, in force today", () => {
    expect(oneSchedule(OLD_DOC.names, NEW_DOC.names)).toBe(true);
    expect(datedEditionTakesOver(OLD_DOC, NEW_DOC, "2026-10-25")).toBe(true);
    // Never the other way round, and not before the newer date.
    expect(datedEditionTakesOver(NEW_DOC, OLD_DOC, "2026-10-25")).toBe(false);
    expect(datedEditionTakesOver(OLD_DOC, NEW_DOC, "2026-02-28")).toBe(false);
  });

  it("retires the 2024 line the 2026 schedule restates, live or skipped behind it, and keeps a renamed one", () => {
    const stopOld = row(2671, "Stop Payment Order", { fee_published_id: 31244 });
    const stopNew = row(31873, "Stop Payment Order", { behind_fee_published_id: 31244 });
    // "Stop Payment Order (Bill Pay)" was skipped behind the same line; it is another line of the page.
    const billPay = row(31873, "Stop Payment Order (Bill Pay)", { behind_fee_published_id: 31244 });
    const researchOld = row(2671, "Account Research", { fee_published_id: 31252, canonical_fee_key: "account_research", amount: 15 });
    const researchNew = row(31873, "Account research", { fee_published_id: 990001, canonical_fee_key: "account_research", amount: 15 });
    // Renamed: "Expedited" in 2024, "Express" in 2026. Not proven the same line, so it stays.
    const rushOld = row(2671, "Expedited Card Replacement", { fee_published_id: 31249, canonical_fee_key: "rush_card", amount: 50 });
    const rushNew = row(31873, "Express Card Replacement", { behind_fee_published_id: 31249, canonical_fee_key: "rush_card", amount: 50 });
    // Only the 2024 schedule lists it: a newer date alone never takes a line down.
    const capOld = row(2671, "NSF Item Held & Paid Daily Cap", { fee_published_id: 6112, canonical_fee_key: "od_daily_cap", amount: 112 });
    const rows = [
      stopOld, stopNew, billPay, researchOld, researchNew, rushOld, rushNew, capOld,
      ...fill(2671, OLD_NAMES), ...fill(31873, NEW_NAMES),
    ];
    const found = judgeDatedEditions(rows, "2026-10-25");
    expect(found.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([
      [31244, "older_edition: #31873 dated 2026-03-01"],
      [31252, "older_edition: #31873 dated 2026-03-01"],
    ]);
    // A fee another rule acts on this step is left to it.
    expect(judgeDatedEditions(rows, "2026-10-25", new Set([31244])).map((fee) => fee.feePublishedId)).toEqual([31252]);
  });

  it("pairs a skipped copy whose audience is not known yet, never a business line with a consumer one", () => {
    // Cedar's 2026 copies were verified with audience "unknown"; the 2024 lines live say "consumer".
    const stopOld = row(2671, "Stop Payment Order", { fee_published_id: 31244 });
    const stopNew = row(31873, "Stop Payment Order", { behind_fee_published_id: 31244, fee_audience: "unknown" });
    const docs = [...fill(2671, OLD_NAMES), ...fill(31873, NEW_NAMES)];
    expect(judgeDatedEditions([stopOld, stopNew, ...docs], "2026-10-25").map((fee) => fee.feePublishedId)).toEqual([31244]);
    const business = { ...stopNew, fee_audience: "business" };
    expect(judgeDatedEditions([stopOld, business, ...docs], "2026-10-25")).toEqual([]);
  });

  it("names the latest of three editions, whatever order their copies come in (#2667 review)", () => {
    // Brazos Star (8142) shape: 2021, 2025 and 2026 copies of one schedule; the 2025 one has the lower id.
    const mid = { source_document_id: 2700, document_url: "https://cfccu.org/2025-Fee-Schedule.pdf", stated_date: "2025-01-01" };
    const stopOld = row(2671, "Stop Payment Order", { fee_published_id: 31244 });
    const stopMid = row(31873, "Stop Payment Order", { ...mid, behind_fee_published_id: 31244 });
    const stopNew = row(31873, "Stop Payment Order", { behind_fee_published_id: 31244 });
    const midNames = NEW_NAMES.map((name) => row(31873, name, { ...mid, canonical_fee_key: "other" }));
    const rows = [stopOld, stopMid, stopNew, ...midNames, ...fill(2671, OLD_NAMES), ...fill(31873, NEW_NAMES)];
    expect(judgeDatedEditions(rows, "2026-10-25").map((fee) => fee.reason)).toEqual(["older_edition: #31873 dated 2026-03-01"]);
  });

  it("does not take a copy skipped behind another live line for this one", () => {
    const stopOld = row(2671, "Stop Payment Order", { fee_published_id: 31244 });
    const stopNew = row(31873, "Stop Payment Order", { behind_fee_published_id: 77777 });
    expect(judgeDatedEditions([stopOld, stopNew, ...fill(2671, OLD_NAMES), ...fill(31873, NEW_NAMES)], "2026-10-25")).toEqual([]);
  });

  it("needs a date each document's text states, never one read from its address", () => {
    expect(datedEditionTakesOver(OLD_DOC, { ...NEW_DOC, statedBasis: "url_year" }, "2026-10-25")).toBe(false);
    expect(datedEditionTakesOver({ ...OLD_DOC, statedBasis: "none", statedDate: null }, NEW_DOC, "2026-10-25")).toBe(false);
    // Two copies dated the same day are one edition.
    expect(datedEditionTakesOver(OLD_DOC, { ...NEW_DOC, statedDate: "2024-04-30" }, "2026-10-25")).toBe(false);
  });

  it("never pairs a business schedule with the consumer one", () => {
    expect(datedEditionTakesOver(OLD_DOC, { ...NEW_DOC, url: "https://cfccu.org/wp-content/uploads/2026/03/2026-Business-Fee-Schedule.pdf" }, "2026-10-25")).toBe(false);
  });

  it("never takes one account's schedule for an edition of the bank's (prod Oct 25 dry run near-misses)", () => {
    // KCB's money market and savings disclosures (docs 38741, 38742) beside its fees page (doc 36505).
    expect(namesOneProduct("https://www.kcbks.bank/images/disclosures/KCB%20Money%20Market%20March%2013%202024.pdf")).toBe(true);
    expect(namesOneProduct("https://www.kcbks.bank/images/disclosures/KCB%20Regular%20Savings%20March%2013%202024.pdf")).toBe(true);
    expect(namesOneProduct("https://bank.example/agreements-disclosures/truth-in-savings/personal-hsa-account-fees")).toBe(true);
    expect(namesOneProduct("https://bank.example/agreements-disclosures/truth-in-savings/premium-account-fees")).toBe(true);
    expect(namesOneProduct("https://www.pnc.com/en/personal-banking/banking/checking/simple-checking.html")).toBe(true);
    // The bank's whole schedule, however it is named.
    expect(namesOneProduct(OLD_URL)).toBe(false);
    expect(namesOneProduct(NEW_URL)).toBe(false);
    expect(namesOneProduct("https://www.brazosstarcu.com/wp-content/uploads/2020/10/2021-Rate-and-Fee-Schedule-Effective-January-1-2021.pdf")).toBe(false);
    expect(namesOneProduct("https://www.houstonfcu.org/resources/fee-schedule")).toBe(false);
    const savings = { ...NEW_DOC, url: "https://www.kcbks.bank/images/disclosures/KCB%20Regular%20Savings%20March%2013%202024.pdf" };
    expect(datedEditionTakesOver(OLD_DOC, savings, "2026-10-25")).toBe(false);
  });

  it("needs the two documents to be one schedule, by the fee names they share", () => {
    // A 5-line account services sheet shared 1 of 38 names with the bank's fee page (MCU, docs 36472/38920).
    const sheet = names(["Monthly minimum balance fee", "Check cashing", "Coin counting", "Notary", "Fax"]);
    const page = names(["Monthly minimum balance fee", ...NEW_NAMES]);
    expect(oneSchedule(sheet, page)).toBe(false);
    expect(datedEditionTakesOver({ ...OLD_DOC, names: sheet }, { ...NEW_DOC, names: page }, "2026-10-25")).toBe(false);
    // Two lines in common are not enough, whatever the share.
    expect(oneSchedule(names(["Stop Payment Order", "NSF Item Returned"]), names(["Stop Payment Order", "NSF Item Returned"]))).toBe(false);
  });

  // Nov 2 dry run with Magellan's v2 dates (prod, read-only).
  it("never takes a bank's domestic schedule for an edition of its international one (Amerant, 154)", () => {
    // Stored text heads: "Schedule of Fees Effective November 12th, 2024" (doc 37546, international,
    // Spanish), "...January 1 st, 2026" (doc 21851, international, English) and "...September 1 st,
    // 2026" (doc 33918, domestic). The international ones print "Fees Applicable to International
    // Personal / Business Accounts"; "Otros ATM" is $2 there and $2.50 on the domestic schedule.
    const intSpa = "https://media.amerantbank.com/wp-content/uploads/2023/01/AMTB-MisclFeesINTSPA.pdf";
    const intEng = "https://media.amerantbank.com/wp-content/uploads/2022/12/AMTB-MisclFeesINTENG.pdf";
    const domEng = "https://media.amerantbank.com/wp-content/uploads/2022/12/AMTB-MISC-DOMENG.pdf";
    expect(scheduleMarket(intSpa)).toBe("international");
    expect(scheduleMarket(intEng)).toBe("international");
    expect(scheduleMarket(domEng)).toBe("domestic");
    expect(scheduleMarket("https://www.amerantbank.com/international/personal/international-savings/")).toBe("international");
    // No market word: "interest", "internal" and "Domain" are none.
    expect(scheduleMarket(OLD_URL)).toBeNull();
    expect(scheduleMarket("https://bank.example/interest-checking/internal-transfers/DomainFees.pdf")).toBeNull();
    const amerant = (url: string, statedDate: string) => ({ url, statedDate, statedBasis: "effective_statement", names: names(NEW_NAMES) });
    expect(datedEditionTakesOver(amerant(intSpa, "2024-11-12"), amerant(domEng, "2026-09-01"), "2026-11-02")).toBe(false);
    expect(datedEditionTakesOver(amerant(intEng, "2026-01-01"), amerant(domEng, "2026-09-01"), "2026-11-02")).toBe(false);
    // Two editions of the international schedule still pair.
    expect(datedEditionTakesOver(amerant(intSpa, "2024-11-12"), amerant(intEng, "2026-01-01"), "2026-11-02")).toBe(true);
  });

  it("keeps a line whose price the newer copy still prints on another row of the same name's category (Customers Bank, 90)", () => {
    // Older copy: "Monthly fee" $5 (a $1,000-minimum account). Newer copy: "Monthly fee" $29 (another
    // account) and the same $5 row, read as "...a monthly fee of", not live.
    const fee = { canonical_fee_key: "monthly_maintenance" };
    const old5 = row(2671, "Monthly fee", { ...fee, fee_published_id: 84015, amount: 5 });
    const new29 = row(31873, "Monthly fee", { ...fee, fee_published_id: 107797, amount: 29 });
    const new5 = row(31873, "at all times. If you do not, a monthly fee of", { ...fee, amount: 5 });
    const docs = [...fill(2671, OLD_NAMES), ...fill(31873, NEW_NAMES)];
    expect(judgeDatedEditions([old5, new29, new5, ...docs], "2026-10-25")).toEqual([]);
    // Without the $5 row on the newer copy it is a changed price, and the newer edition takes over.
    expect(judgeDatedEditions([old5, new29, ...docs], "2026-10-25").map((t) => t.feePublishedId)).toEqual([84015]);
  });

  it("leaves two editions both older than the freshness window to the freshness search (G.A.P. FCU, 4660)", () => {
    // Its fee page (doc 37716, read Oct 18) states "EFFECTIVE AUGUST 2020" and a $6.25 VISA late fee;
    // its "January 2021" PDF (doc 31657) prints $10. Neither is shown to be the one in use now.
    const page = { ...OLD_DOC, url: "https://www.gapfcu.org/fee-schedule/", statedDate: "2020-08-01", statedBasis: "effective_statement" };
    const pdf = { ...NEW_DOC, url: "https://www.gapfcu.org/download/20/disclosures/2315/fee-schedule.pdf", statedDate: "2021-01-01" };
    expect(datedEditionTakesOver(page, pdf, "2026-11-02")).toBe(false);
    // A newer edition dated within the window still takes over.
    expect(datedEditionTakesOver(page, { ...pdf, statedDate: "2025-01-01" }, "2026-11-02")).toBe(true);
  });
});
