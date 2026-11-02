import { describe, expect, it } from "vitest";
import { candidateQuotes, locateFeeInText, prepareSourceText, sourceLocationCitation, sourceLocationLabel } from "./source-location";

const note = (excerpt: string) => `Read by the free reader. excerpt="${excerpt}"`;

/** First Example Bank's schedule: three PDF pages with footers, joined by a blank line as the reader joins them. */
const FOOTER_SCHEDULE = [
  "First Example Bank",
  "Schedule of Fees",
  "Overdraft Fee ........ $32.00 per item",
  "Stop Payment ........ $30.00",
  "Page 1 of 3",
  "",
  "Wire Transfers",
  "Outgoing Domestic | $25.00",
  "Incoming Domestic | $15.00",
  "Page 2 of 3",
  "",
  "Other Services",
  "Money Order ........ $5.00",
  "Cashier's Check ........ $8.00",
  "Page 3 of 3",
].join("\n");

describe("locateFeeInText", () => {
  it("names the page and the line on it from footer page numbers", () => {
    const found = locateFeeInText({ text: FOOTER_SCHEDULE, amount: 25, feeName: "Outgoing Domestic", extraction_note: note("Outgoing Domestic | $25.00") });
    expect(found.miss).toBeNull();
    expect(found.location).toMatchObject({ page: 2, pageLine: 2, textLine: 8, basis: "excerpt" });
    expect(sourceLocationLabel(found.location)).toBe("page 2, line 2");
    expect(sourceLocationCitation(found.location)).toBe("page 2, line 2 of the bank's fee schedule");
  });

  it("gives code-point offsets that cover the quote, and counts lines as the stored text does", () => {
    const found = locateFeeInText({ text: FOOTER_SCHEDULE, amount: 8, feeName: "Cashier's Check", extraction_note: note("Cashier’s Check ........ $8.00") });
    const { charStart, charEnd } = found.location!;
    expect(Array.from(FOOTER_SCHEDULE).slice(charStart, charEnd).join("")).toBe("Cashier's Check ........ $8.00");
    expect(found.location).toMatchObject({ page: 3, pageLine: 3, textLine: 14 });
    const first = locateFeeInText({ text: FOOTER_SCHEDULE, amount: 32, feeName: "Overdraft Fee", extraction_note: note("Overdraft Fee ........ $32.00 per item") });
    expect(first.location).toMatchObject({ page: 1, pageLine: 3, textLine: 3 });
  });

  it("reads header page numbers: a page starts after its number", () => {
    const text = ["Page 1 of 2", "Account Fees", "Monthly Service Fee $10.00", "", "Page 2 of 2", "Card Fees", "Card Replacement Fee $5.00"].join("\n");
    const found = locateFeeInText({ text, amount: 5, feeName: "Card Replacement Fee", extraction_note: note("Card Replacement Fee $5.00") });
    expect(found.location).toMatchObject({ page: 2, pageLine: 2, textLine: 7 });
    const onFirst = locateFeeInText({ text, amount: 10, feeName: "Monthly Service Fee", extraction_note: note("Monthly Service Fee $10.00") });
    expect(onFirst.location).toMatchObject({ page: 1, pageLine: 2, textLine: 3 });
  });

  it("names no page for headers under a letterhead (review repro: it said page 2)", () => {
    const text = [
      "Example Bank", "123 Main St", "Page 1 of 3", "Money Order Fee $5.00", "Wire Out $25.00",
      "Page 2 of 3", "Stop Payment Charge $30.00", "Returned Item $35.00",
      "Page 3 of 3", "Dormant Account $5.00 per month", "Research $25.00 per hour", "Statement Copy $3.00",
    ].join("\n");
    const found = locateFeeInText({ text, amount: 5, feeName: "Money Order Fee", extraction_note: note("Money Order Fee $5.00") });
    expect(found.location).toMatchObject({ page: null, pageLine: null, textLine: 4 });
  });

  it("names no page for headers under a title that also read as footers (review repro: it said page 2)", () => {
    const text = "Example Bank\nPage 1 of 2\n\nMoney Order Fee $5.00\nWire Out Fee $25.00\n\nPage 2 of 2\n\nStop Payment Charge $30.00";
    const found = locateFeeInText({ text, amount: 5, feeName: "Money Order Fee", extraction_note: note("Money Order Fee $5.00") });
    expect(found.location).toMatchObject({ page: null, pageLine: null, textLine: 4 });
    const last = locateFeeInText({ text, amount: 30, feeName: "Stop Payment Charge", extraction_note: note("Stop Payment Charge $30.00") });
    expect(last.location).toMatchObject({ page: null, textLine: 9 });
    expect(prepareSourceText(text).pages).toBeNull();
  });

  it("still reads footers under a page of fees longer than a title", () => {
    const text = ["First Example Bank", "Schedule of Fees", "Overdraft Fee $32.00", "Page 1 of 2", "", "Wire Out Fee $25.00", "Page 2 of 2", "", "Form 12"].join("\n");
    const found = locateFeeInText({ text, amount: 25, feeName: "Wire Out Fee", extraction_note: note("Wire Out Fee $25.00") });
    expect(found.location).toMatchObject({ page: 2, pageLine: 1, textLine: 6 });
  });

  it("names no page when a title sits above Page 1 and the shape is not certain", () => {
    const text = ["First Example Bank", "Page 1 of 2", "Stop Payment $30.00", "Page 2 of 2", "Wire Out $25.00"].join("\n");
    const found = locateFeeInText({ text, amount: 30, feeName: "Stop Payment", extraction_note: note("Stop Payment $30.00") });
    expect(found.location).toMatchObject({ page: null, textLine: 3 });
  });

  it("names no page when footers stop one page short of the printed total", () => {
    const text = ["Overdraft Fee $30.00", "Page 1 of 3", "", "Stop Payment $25.00", "Page 2 of 3", "", "Wire Out $20.00"].join("\n");
    const found = locateFeeInText({ text, amount: 20, feeName: "Wire Out", extraction_note: note("Wire Out $20.00") });
    expect(found.location).toMatchObject({ page: null, textLine: 7 });
  });

  it("takes the page from recorded page starts over printed numbers", () => {
    const pageOne = "First Example Bank\nOverdraft Fee $32.00";
    const text = `${pageOne}\n\nWire Fees\nOutgoing Wire $25.00`;
    const found = locateFeeInText({ text, amount: 25, feeName: "Outgoing Wire", extraction_note: note("Outgoing Wire $25.00"), pageStarts: [0, Array.from(pageOne).length + 2] });
    expect(found.location).toMatchObject({ page: 2, pageLine: 2, textLine: 5 });
    const unusable = locateFeeInText({ text, amount: 25, feeName: "Outgoing Wire", extraction_note: note("Outgoing Wire $25.00"), pageStarts: [5, 2] });
    expect(unusable.location).toMatchObject({ page: null, textLine: 5 });
  });

  it("names only the line when the document prints no page numbers", () => {
    const text = "First Example Bank fees\n\nReturned Item Fee: $35.00\nDormant Account Fee: $5.00 per month";
    const found = locateFeeInText({ text, amount: 5, feeName: "Dormant Account Fee", extraction_note: note("Dormant Account Fee: $5.00 per month") });
    expect(found.location).toMatchObject({ page: null, pageLine: null, textLine: 4 });
    expect(sourceLocationCitation(found.location)).toBe("line 4 of the bank's fee schedule");
  });

  it("names no page when the printed numbers skip", () => {
    const text = ["Overdraft Fee $30.00", "Page 1 of 3", "", "Stop Payment $25.00", "Page 3 of 3"].join("\n");
    const found = locateFeeInText({ text, amount: 25, feeName: "Stop Payment", extraction_note: note("Stop Payment $25.00") });
    expect(found.location).toMatchObject({ page: null, textLine: 4 });
  });

  it("does not take a page number inside a sentence for a page marker", () => {
    const text = ["See page 3 for wire fees.", "Overdraft Fee $30.00"].join("\n");
    const found = locateFeeInText({ text, amount: 30, feeName: "Overdraft Fee", extraction_note: note("Overdraft Fee $30.00") });
    expect(found.location).toMatchObject({ page: null, textLine: 2 });
  });

  it("finds a table row whose cells the text prints on two lines", () => {
    const text = "Fee | Amount\nReturned Deposited Item\n$5.00 per item\nOfficial Check\n$10.00";
    const found = locateFeeInText({ text, amount: 5, feeName: "Returned Deposited Item", extraction_note: note("Returned Deposited Item | $5.00 per item") });
    expect(found.location).toMatchObject({ textLine: 2, basis: "excerpt_cell" });
  });

  it("never cites another fee's line for a cell printed without the fee's name (review repro)", () => {
    const text = "Overdraft Fee $35.00 each\nOverdraft limit info\nNSF Fee $35.00 per item paid";
    const found = locateFeeInText({ text, amount: 35, feeName: "Overdraft", extraction_note: note("Overdraft | per item paid | $35.00") });
    expect(found.location).toBeNull();
    expect(found.miss).toBe("ambiguous");
  });

  it("never lets a heading vouch for a cell on a line that names another fee (review repro)", () => {
    const text = "Overdraft\nNSF Fee $35.00 per item paid\nOverdraft item $35.00 per item charged";
    const found = locateFeeInText({ text, amount: 35, feeName: "Overdraft", extraction_note: note("Overdraft | per item paid | $35.00") });
    expect(found.location).toBeNull();
  });

  it("lets a heading vouch for a cell on a line that names nothing else", () => {
    const text = "Overdraft\nper item paid $35.00\nReturned Item\nper item returned $30.00";
    const found = locateFeeInText({ text, amount: 35, feeName: "Overdraft", extraction_note: note("Overdraft | per item paid | $35.00") });
    expect(found.location).toMatchObject({ textLine: 2, basis: "excerpt_cell" });
  });

  it("never lets a neighbour that prints its own figure vouch as the fee's name", () => {
    const text = "Overdraft $20.00\nper item paid $35.00";
    const found = locateFeeInText({ text, amount: 35, feeName: "Overdraft $20.00", extraction_note: note("per item paid | $35.00") });
    expect(found.location).toBeNull();
  });

  it("takes a cell whose partner cell is the whole of the next line", () => {
    const text = "Wire Transfers\nOutgoing International Wire\n$45.00 per transfer\nIncoming Wire\n$15.00 per transfer";
    const found = locateFeeInText({ text, amount: 45, feeName: "Intl wire out", extraction_note: note("$45.00 per transfer | Outgoing International Wire") });
    expect(found.location).toMatchObject({ textLine: 2, basis: "excerpt_cell" });
  });

  it("prefers the line Darwin traced over Knox's excerpt", () => {
    const text = "Wire Transfers\nOutgoing Domestic Wire $25.00\nOutgoing International Wire $45.00";
    const found = locateFeeInText({ text, amount: 25, feeName: "Outgoing Domestic", tracedLine: "Outgoing Domestic Wire $25.00", extraction_note: note("Wire Transfers | Outgoing Domestic") });
    expect(found.location).toMatchObject({ textLine: 2, basis: "traced_line" });
  });

  it("names no line for a quote printed in two places", () => {
    const text = "Personal\nStop Payment $30.00\nBusiness\nStop Payment $30.00";
    const found = locateFeeInText({ text, amount: 30, feeName: "Stop Payment", extraction_note: note("Stop Payment $30.00") });
    expect(found).toEqual({ location: null, miss: "ambiguous" });
  });

  it("names no line when the amount is not printed near it", () => {
    const text = "Stop Payment Fee\nper request, see branch";
    const found = locateFeeInText({ text, amount: 30, feeName: "Stop Payment Fee", extraction_note: note("Stop Payment Fee $30") });
    expect(found).toEqual({ location: null, miss: "amount_not_on_line" });
    const paragraph = `Stop Payment Fee applies ${"to every request we accept ".repeat(20)}and costs $30.00.`;
    expect(locateFeeInText({ text: paragraph, amount: 30, feeName: "Stop Payment Fee" }).miss).toBe("amount_not_on_line");
  });

  it("says why when there is nothing to find", () => {
    expect(locateFeeInText({ text: "", amount: 5, feeName: "Money Order" })).toEqual({ location: null, miss: "no_text" });
    expect(locateFeeInText({ text: "Money Order $5", amount: 5, feeName: "ATM" })).toEqual({ location: null, miss: "no_quote" });
    expect(locateFeeInText({ text: "Money Order $5", amount: 5, feeName: "Cashier's Check" })).toEqual({ location: null, miss: "not_found" });
  });

  it("treats a free fee's word as its amount", () => {
    const text = "Online Banking ........ Free\nBill Pay ........ $0.00";
    const found = locateFeeInText({ text, amount: 0, feeName: "Online Banking", extraction_note: note("Online Banking ........ Free") });
    expect(found.location).toMatchObject({ textLine: 1 });
  });

  it("locates many fees in one long text quickly once it is prepared (review repro: 0.9 s per fee)", () => {
    const filler = "Account terms and conditions apply to every deposit account we offer. ".repeat(24_000);
    const rows = Array.from({ length: 100 }, (_, i) => `First Example Bank Service ${i + 1} Fee $${i + 1}.00`).join("\n");
    const text = `${filler}\n${rows}\n${filler}`;
    expect(text.length).toBeGreaterThan(3_000_000);
    const prepared = prepareSourceText(text);
    const started = performance.now();
    let found = 0;
    for (let i = 1; i <= 100; i += 1) {
      const result = locateFeeInText({ text: prepared, amount: i, feeName: `First Example Bank Service ${i} Fee`, extraction_note: note(`First Example Bank Service ${i} Fee $${i}.00`) });
      if (result.location) found += 1;
    }
    expect(found).toBe(100);
    expect(performance.now() - started).toBeLessThan(2_000);
  }, 60_000);
});

describe("candidateQuotes", () => {
  it("drops a cut excerpt's partial last word and very short cells", () => {
    const long = `Overdraft Fee ${"charged for each item paid into overdraft ".repeat(5)}partia`;
    const quotes = candidateQuotes({ extraction_note: note(long), feeName: "OD" });
    expect(quotes[0].quote.endsWith("partia")).toBe(false);
    expect(quotes.map((q) => q.quote)).not.toContain("OD");
  });

  it("splits an excerpt into its cells, longest first, each with the partners it must print with", () => {
    const quotes = candidateQuotes({ extraction_note: note("Services | Verification of Deposit | $10"), feeName: "Verification of Deposit" });
    expect(quotes.map((q) => q.basis)).toEqual(["excerpt", "excerpt_cell", "excerpt_cell"]);
    expect(quotes[1]).toEqual({ quote: "Verification of Deposit", basis: "excerpt_cell", partners: ["Verification of Deposit", "Services"], cells: ["Services", "Verification of Deposit", "$10"] });
    expect(quotes[2].partners).toEqual(["Verification of Deposit", "Verification of Deposit"]);
  });
});
