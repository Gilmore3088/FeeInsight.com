import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { layoutDocumentText, layoutPageText, type PdfTextItem } from "./pdf-layout";

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
});
