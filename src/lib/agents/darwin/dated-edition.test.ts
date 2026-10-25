import { describe, expect, it } from "vitest";
import { datedEditionTakesOver, judgeDatedEditions, namesOneProduct, oneSchedule, type DatedEditionRow } from "./dated-edition";
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
});
