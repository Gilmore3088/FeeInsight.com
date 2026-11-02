import { describe, expect, it } from "vitest";
import { candidateQuotes, locateFeeInText, sourceLocationCitation, sourceLocationLabel } from "./source-location";

const note = (excerpt: string) => `Read by the free reader. excerpt="${excerpt}"`;

/** First Example Bank's schedule, three printed pages with footers. */
const FOOTER_SCHEDULE = [
  "First Example Bank",
  "Schedule of Fees",
  "",
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
  it("names the page and the printed line on it from footer page numbers", () => {
    const found = locateFeeInText({ text: FOOTER_SCHEDULE, amount: 25, feeName: "Outgoing Domestic", extraction_note: note("Outgoing Domestic | $25.00") });
    expect(found.miss).toBeNull();
    expect(found.location).toMatchObject({ page: 2, pageLine: 2, textLine: 7, basis: "excerpt" });
    expect(sourceLocationLabel(found.location)).toBe("page 2, line 2");
    expect(sourceLocationCitation(found.location)).toBe("page 2, line 2 of the stored schedule");
  });

  it("gives code-point offsets that cover the quote", () => {
    const found = locateFeeInText({ text: FOOTER_SCHEDULE, amount: 8, feeName: "Cashier's Check", extraction_note: note("Cashier’s Check ........ $8.00") });
    expect(found.location).not.toBeNull();
    const { charStart, charEnd } = found.location!;
    expect(Array.from(FOOTER_SCHEDULE).slice(charStart, charEnd).join("")).toBe("Cashier's Check ........ $8.00");
    expect(found.location).toMatchObject({ page: 3, pageLine: 3 });
  });

  it("reads header page numbers: a page starts at its number", () => {
    const text = ["Page 1 of 2", "Account Fees", "Monthly Service Fee $10.00", "Page 2 of 2", "Card Fees", "Card Replacement Fee $5.00"].join("\n");
    const found = locateFeeInText({ text, amount: 5, feeName: "Card Replacement Fee", extraction_note: note("Card Replacement Fee $5.00") });
    expect(found.location).toMatchObject({ page: 2, pageLine: 2, textLine: 6 });
  });

  it("takes the page from recorded page starts over printed numbers", () => {
    const pageOne = "First Example Bank\nOverdraft Fee $32.00";
    const text = `${pageOne}\n\nWire Fees\nOutgoing Wire $25.00`;
    const found = locateFeeInText({ text, amount: 25, feeName: "Outgoing Wire", extraction_note: note("Outgoing Wire $25.00"), pageStarts: [0, Array.from(pageOne).length + 2] });
    expect(found.location).toMatchObject({ page: 2, pageLine: 2, textLine: 4 });
    const unusable = locateFeeInText({ text, amount: 25, feeName: "Outgoing Wire", extraction_note: note("Outgoing Wire $25.00"), pageStarts: [5, 2] });
    expect(unusable.location).toMatchObject({ page: null, textLine: 4 });
  });

  it("names only the line when the document prints no page numbers", () => {
    const text = "First Example Bank fees\n\nReturned Item Fee: $35.00\nDormant Account Fee: $5.00 per month";
    const found = locateFeeInText({ text, amount: 5, feeName: "Dormant Account Fee", extraction_note: note("Dormant Account Fee: $5.00 per month") });
    expect(found.location).toMatchObject({ page: null, pageLine: null, textLine: 3 });
    expect(sourceLocationLabel(found.location)).toBe("line 3");
  });

  it("names no page when the printed numbers skip or repeat", () => {
    const text = ["Overdraft Fee $30.00", "Page 1 of 3", "Stop Payment $25.00", "Page 3 of 3"].join("\n");
    const found = locateFeeInText({ text, amount: 25, feeName: "Stop Payment", extraction_note: note("Stop Payment $25.00") });
    expect(found.location).toMatchObject({ page: null, textLine: 3 });
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

  it("names no line when the amount is not printed on it", () => {
    const text = "Stop Payment Fee\nper request, see branch";
    const found = locateFeeInText({ text, amount: 30, feeName: "Stop Payment Fee", extraction_note: note("Stop Payment Fee $30") });
    expect(found).toEqual({ location: null, miss: "amount_not_on_line" });
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
});

describe("candidateQuotes", () => {
  it("drops a cut excerpt's partial last word and very short cells", () => {
    const long = `Overdraft Fee ${"charged for each item paid into overdraft ".repeat(5)}partia`;
    const quotes = candidateQuotes({ extraction_note: note(long), feeName: "OD" });
    expect(quotes[0].quote.endsWith("partia")).toBe(false);
    expect(quotes.map((q) => q.quote)).not.toContain("OD");
  });

  it("splits an excerpt into its cells, longest first", () => {
    const quotes = candidateQuotes({ extraction_note: note("Services | Verification of Deposit | $10"), feeName: null });
    expect(quotes.map((q) => q.basis)).toEqual(["excerpt", "excerpt_cell", "excerpt_cell"]);
    expect(quotes[1].quote).toBe("Verification of Deposit");
  });
});
