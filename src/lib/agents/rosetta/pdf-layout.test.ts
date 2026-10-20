import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { layoutDocumentText, layoutPageText, type PdfTextItem } from "./pdf-layout";
import { extractPdfDocumentText } from "./pdf-document-text";
import { runFreeSpecialists } from "../knox/specialists";

function item(str: string, x: number, y: number, width: number, height = 10): PdfTextItem {
  return { str, transform: [height, 0, 0, height, x, y], width, height };
}

describe("Rosetta read.pdf_layout", () => {
  it("puts a fee name and its amount column on one line", () => {
    // Drawing order is column by column, as many fee schedule PDFs are produced.
    const items = [
      item("Overdraft fee", 72, 700, 60),
      item("Stop payment", 72, 686, 58),
      item("$35.00", 400, 700, 30),
      item("$30.00", 400, 686.5, 30),
    ];

    expect(layoutPageText(items)).toBe("Overdraft fee | $35.00\nStop payment | $30.00");
  });

  it("joins items split inside a word and spaces items split between words", () => {
    const items = [item("Over", 72, 700, 20), item("draft", 92, 700, 25), item("fee", 119.5, 700, 15)];

    expect(layoutPageText(items)).toBe("Overdraft fee");
  });

  it("orders lines top to bottom, skips empty items, and separates pages", () => {
    const pageOne = [item("Second line", 72, 680, 50), item("", 10, 690, 0), item("First line", 72, 700, 45)];
    const pageTwo = [item("Page two", 72, 700, 40)];

    expect(layoutDocumentText([pageOne, pageTwo])).toBe("First line\nSecond line\n\nPage two");
  });

  // A deposit agreement in three columns (Origin Bank): each column's baselines sit a little
  // apart from its neighbours', so a reading across the page interleaves their sentences.
  const prose = (lines: string[], x: number, top: number) =>
    lines.map((line, index) => item(line, x, top - index * 10, line.length * 4, 8));
  const columnOne = [
    "However, we will charge you no more than",
    "five overdraft item charges per day and",
    "will not charge an overdraft item charge",
    "if your checking account is overdrawn $5",
    "or less at the end of each business day.",
    "The $35.00 overdraft item charge applies",
    "to overdrafts created by check, in-person",
    "withdrawal, ATM withdrawal or electronic",
    "means if you opted in to the payment of",
    "ATM and everyday debit card transactions.",
    "Also, we will charge you an overdrawn",
    "account fee of $10.00 on the 5th straight",
  ];
  const columnTwo = [
    "Checking Accounts: If your account is a",
    "checking account, it will be either non",
    "interest bearing or interest bearing as",
    "defined in the Truth in Savings section.",
    "Withdrawals: Deposits will be available",
    "for withdrawal consistent with the terms",
    "of our Disclosures. Withdrawals may be",
    "subject to a service charge as stated in",
    "the fee schedule given to you at opening.",
    "Interest will compound monthly and will",
    "be credited to your account every month.",
    "Rates may change at our sole discretion.",
  ];
  const columnThree = [
    "Additional Deposits During The Term: No",
    "additional deposits will be allowed to",
    "this account during its term unless the",
    "Disclosures describe otherwise for you.",
    "Early Withdrawal Penalty: Unless stated",
    "otherwise in the Disclosures, we impose",
    "a penalty if you withdraw any principal",
    "before the maturity date of the account.",
    "Automatic renewal applies to the account",
    "at maturity unless you tell us otherwise",
    "within the grace period after maturity.",
    "Minimum balance rules are listed below.",
  ];

  it("reads a page set in prose columns column by column", () => {
    const items = [
      item("CONSUMER DEPOSIT ACCOUNT AGREEMENT AND DISCLOSURES FOR ALL PERSONAL ACCOUNTS", 36, 730, 520, 10),
      ...prose(columnOne, 36, 700),
      ...prose(columnTwo, 220, 696),
      ...prose(columnThree, 404, 698),
    ];

    const text = layoutPageText(items);
    expect(text.split("\n")).toEqual([
      "CONSUMER DEPOSIT ACCOUNT AGREEMENT AND DISCLOSURES FOR ALL PERSONAL ACCOUNTS",
      ...columnOne,
      ...columnTwo,
      ...columnThree,
    ]);
    expect(text).not.toContain(" | ");
  });

  it("keeps a fee table, or a fee list set in two columns, read row by row", () => {
    const names = ["Overdraft item fee", "Stop payment", "Returned item", "Wire transfer domestic", "Wire transfer foreign"];
    const table = names.flatMap((name, index) => [
      item(`${name} (per item, each time we pay or return it)`, 36, 700 - index * 12, 230, 9),
      item(`$${30 + index}.00 per item`, 300, 700 - index * 12, 60, 9),
    ]);
    const listed = names.flatMap((name, index) => [
      item(`${name} charged to your account .......... $${20 + index}.00`, 36, 600 - index * 12, 230, 9),
      item(`${name} for business accounts ................ $${40 + index}.00`, 300, 600 - index * 12, 230, 9),
    ]);
    const filler = Array.from({ length: 20 }, (_, index) => item(`Fee note ${index}`, 36, 500 - index * 12, 50, 9));
    const text = layoutPageText([...table, ...listed, ...filler]);

    expect(text).toContain("Overdraft item fee (per item, each time we pay or return it) | $30.00 per item");
    expect(text).toContain("Overdraft item fee charged to your account .......... $20.00 | Overdraft item fee for business accounts ................ $40.00");
  });

  it("finds the gutter of a two-column notice that draws each letter as its own item", async () => {
    // First United's overdraft notice: read across, "we will charge an additional $5.00 per
    // day" came out as a fee named "additional".
    const { getDocumentProxy } = await import("unpdf");
    const bytes = readFileSync(join(__dirname, "test-fixtures", "first-united-opt-in.pdf"));
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const content = await (await pdf.getPage(1)).getTextContent();
    const items: PdfTextItem[] = [];
    for (const entry of content.items) if ("str" in entry) items.push(entry);

    const text = layoutPageText(items);
    expect(text).toContain(
      "• If the account is overdrawn for 4 or more\nconsecutive calendar days, we will charge an\nadditional $5.00 per day.",
    );
    expect(text).toContain("• We will charge you a fee of up to $40 each time\nwe pay an overdraft.");
    expect(text).not.toMatch(/practices\. To learn more, \|/);
    await pdf.destroy?.();
  });
  it("reads a dot-leader fee list beside a table as its own column (layout v4)", async () => {
    // Northern Trust's personal deposit schedule: read across, each list line became the last
    // cell of an account-table row, and the overdraft line's name was spread over three rows.
    const { getDocumentProxy } = await import("unpdf");
    const bytes = readFileSync(join(__dirname, "test-fixtures", "northern-trust-fees.pdf"));
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const pages: PdfTextItem[][] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const content = await (await pdf.getPage(number)).getTextContent();
      const items: PdfTextItem[] = [];
      for (const entry of content.items) if ("str" in entry) items.push(entry);
      pages.push(items);
    }
    const text = layoutDocumentText(pages);
    expect(text).toContain(
      "Overdrafts Paid and Items Paid against Nonsufficient\nFunds (includes but not limited to overdrafts\ncreated by check, in-person withdrawals\nat a teller or recurring electronic\ndebit card payments) ................................... $25.00 per Occurrence",
    );
    expect(text).toContain("\nCashier’s Checks");
    expect(text).toContain("\nDomestic Outgoing (client only)..............................$25.00 per wire");
    // The account table keeps its rows: name, minimum, balance to avoid, fee, cycle.
    expect(text).toMatch(/Non-Interest Checking\s*\| \$25,000 combined minimum initial\s*\| Average collected balance of \$2,000\.00 or\s*\| \$15\.00\s*\| Monthly/);
    // Page 2's leader lines are cells of the business table, not a list column: read across.
    expect(text).toContain("Each debit transaction 9 ....");
    expect(text).toMatch(/Checking \| initial deposit in all non- \| Fee for each debit transaction/);
    await pdf.destroy?.();
  });

  it("keeps a two-column fee table whose names and leaders run to the price row by row", () => {
    const items = [
      item("Overdraft fee ..........", 72, 700, 200),
      item("$35.00", 300, 700, 30),
      item("Stop payment ..........", 72, 686, 200),
      item("$30.00", 300, 686, 30),
    ];
    expect(layoutPageText(items)).toBe("Overdraft fee .......... | $35.00\nStop payment .......... | $30.00");
  });

  it("preserves own prices in two independent stacked fee columns (Oakwood #2219)", async () => {
    // Current source bytes: e8160b6a4c57816399cfe99fe441fb227dac9e0895c56423286feae80daa0bf3.
    // Physical p2: left reconciliation35/hour and card15; right incoming15 and outgoing30.
    const bytes = readFileSync(join(__dirname, "test-fixtures", "oakwood-fees.pdf"));
    const { text } = await extractPdfDocumentText(new Uint8Array(bytes));
    expect(text).toContain("Account Reconciliation\n• $35.00 per hour");
    expect(text).toContain("Wire Transfer Incoming\n• $15.00 per wire");
    expect(text).toContain("Wire Transfer Outgoing\n• $30.00 per wire");
    expect(text).toContain("ATM/Debit Card Replacement\n• $15.00 per card");
    const { candidates } = runFreeSpecialists(text, { institutionName: "Oakwood Bank" });
    const prices = (key: string) => candidates.filter((fee) => fee.canonicalHint === key).map((fee) => fee.amount);
    expect(prices("wire_domestic_incoming")).toContain(15);
    expect(prices("wire_domestic_outgoing")).toContain(30);
    expect(prices("wire_domestic_outgoing")).not.toContain(35);
    expect(prices("card_replacement")).toContain(15);
    expect(prices("card_replacement")).not.toContain(30);
    expect(candidates.some((fee) => fee.feeName === "Account Reconciliation" && fee.amount === 35)).toBe(true);
    expect(candidates.some((fee) => fee.feeName === "Account Reconciliation" && fee.amount === 15)).toBe(false);
  });

  it("keeps a name/amount table with bullet price cells paired by row", () => {
    const items = Array.from({ length: 20 }, (_, i) => [
      item(`Service ${i}`, 36, 700 - i * 12, 140, 9),
      item(`• $${i + 1}.00`, 330, 700 - i * 12, 90, 9),
    ]).flat();
    expect(layoutPageText(items).split("\n")).toEqual(
      Array.from({ length: 20 }, (_, i) => `Service ${i} | • $${i + 1}.00`),
    );
  });

  it("keeps table rows paired when independent stacked lists share the page", () => {
    const table = Array.from({ length: 12 }, (_, i) => [
      item(`Table Service ${i}`, 36, 740 - i * 12, 150, 9),
      item(`• $${i + 1}.00`, 330, 740 - i * 12, 100, 9),
    ]).flat();
    const lists = [36, 330].flatMap((x, column) => Array.from({ length: 4 }, (_, i) => [
      item(`Standalone Service ${column}-${i}`, x, 560 - i * 25, 150, 9),
      item(`• $${40 + column * 10 + i}.00 per item`, x, 548 - i * 25, 145, 9),
    ]).flat());
    const text = layoutPageText([...table, ...lists]);
    for (let i = 0; i < 12; i += 1) expect(text).toContain(`Table Service ${i} | • $${i + 1}.00`);
  });

  it("preserves baseline order when a priced line crosses the stacked lists' gutter", () => {
    const crossing = [
      item("Money Order", 36, 660, 150, 9),
      item("• $3.00 per item, with additional service terms", 36, 648, 270, 9),
      item("Wire Transfer Outgoing", 330, 648, 150, 9),
      item("• $30.00 per wire", 330, 636, 145, 9),
    ];
    const lists = [36, 330].flatMap((x, column) => Array.from({ length: 8 }, (_, i) => [
      item(`Standalone Service ${column}-${i}`, x, 560 - i * 25, 150, 9),
      item(`• $${40 + column * 10 + i}.00 per item`, x, 548 - i * 25, 145, 9),
    ]).flat());
    const text = layoutPageText([...crossing, ...lists]);
    expect(text).toContain("• $3.00 per item, with additional service terms | Wire Transfer Outgoing\n• $30.00 per wire");
    expect(text.indexOf("• $30.00 per wire")).toBeLessThan(text.indexOf("Standalone Service 0-0"));
  });

  it("refuses a stacked split when a waiver clause crosses the gutter without a price", () => {
    const waiver = item("Waived for qualifying students", 36, 648, 270, 9);
    const lists = [36, 330].flatMap((x, column) => Array.from({ length: 8 }, (_, i) => [
      item(`Standalone Service ${column}-${i}`, x, 560 - i * 25, 150, 9),
      item(`• $${40 + column * 10 + i}.00 per item`, x, 548 - i * 25, 145, 9),
    ]).flat());
    const text = layoutPageText([waiver, ...lists]);
    expect(text).toContain("Standalone Service 0-0 | Standalone Service 1-0");
    expect(text).toContain("• $40.00 per item | • $50.00 per item");
  });
});
