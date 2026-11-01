// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  cardProgramHeading,
  cardProgramHeadingSql,
  cardProgramSectionFee,
  cardProgramSectionRows,
  sectionNamePattern,
  sectionRow,
  withoutCardProgramSections,
  wrappedCardRow,
} from "./card-program-section";

// #1905: Navy Federal (institution 4956), /membership/fees-and-charges.html, stored text 37160 (doc
// 39026), lines as stored. "Lost/Stolen Card" $5 (card_replacement) and the Visa/PLUS ATM row $1
// (atm_non_network) were published as the account's fees on every re-read.
const navy = [
  "Navy Federal-related document | No charge",
  "Non-Navy Federal-related document | First 2 per week: no charge; each additional: $5.00 per document not to exceed the local jurisdiction fee maximum",
  "Notary Public Service is generally available in all jurisdictions except California and Louisiana.",
  "Prepaid and Gift Cards",
  "Visa® Gift Cards",
  "Fee | Amount",
  "Card Purchase Charge | $0",
  "Inactivity Fee (After 12 consecutive months of no activity, the card will be charged $5.00 per month until the balance is depleted or you make a purchase.) | $5.00",
  "Lost/Stolen Card | $5.00",
  "Overnight Delivery | Weekday delivery $12.00 Saturday delivery $20.00",
  "GO Prepaid Cards",
  "Fee | Amount",
  "Visa/PLUS Network ATM domestic and foreign cash withdrawal and balance inquiry (The terminal owner may charge additional fees and “surcharges” for ATM transactions.) | $1.00 per transaction",
  "Lost/Stolen Card | $5.00",
  "Overnight Delivery | Weekday delivery $12.00 Saturday delivery $20.00",
  "Visa Money Transfer | $0",
].join("\n\n");

// Navy's own ATM table, above: the account's rows, never the card's.
const navyAtm = [
  "ATM Fees",
  "Transaction | Navy Federal ATM | CO-OP Network ATM | Non-Navy Federal/Non-CO-OP Network ATM",
  "Share withdrawal $1,000 maximum per 24 hours† | None | None | $1.00",
  "Transfer | None | None | $1.00",
].join("\n");

// GLCU (doc 6455): a gift card's inactivity fee filed as dormant_account (live 63387).
const glcu = [
  "Wire Transactions",
  "Domestic Outgoing Money Wire Transfer | $25.00 per item",
  "Gift Cards",
  "Gift Card | $3.50 per card",
  "Refund Fee | $10.00 per card",
  "Replacement Gift Card | $10.00 per card",
  "Inactivity Fee (12 months) | $5.00 per card",
].join("\n");

// Southern FCU (doc 30907): a reloadable card's own fees after the account's rows (live 139329-139331).
const southern = [
  "Collection Fee/Foreign Check Presentment | $30",
  "VISA® Gift Card | $3.00 per card",
  "VISA® Prepaid Reloadable Card Account Fees and Charges",
  "Personalized Card Fee | $5.95 per card",
  "Reload Fee | $1.00 per reload",
  "Monthly Maintenance Fee | $3.95 per month",
  "Domestic ATM Transaction Fee | $2.00 per transaction",
].join("\n");

describe("a fee printed in a prepaid, payroll, gift or travel card section is the card's (#1908, #1905)", () => {
  it("reads Navy Federal's gift and GO Prepaid card rows as the card program's", () => {
    expect(cardProgramSectionFee(navy, "Lost/Stolen Card", 5)).toBe(true);
    expect(cardProgramSectionFee(navy, "Visa/PLUS Network ATM domestic and foreign cash withdrawal and balance inquiry", 1)).toBe(true);
    expect(cardProgramSectionFee(navy, "Inactivity Fee", 5)).toBe(true);
    // The account's own ATM table is no card section.
    expect(cardProgramSectionFee(`${navyAtm}\n${navy}`, "Transfer", 1)).toBe(false);
    expect(cardProgramSectionFee(`${navyAtm}\n${navy}`, "Share withdrawal $1,000 maximum per 24 hours", 1)).toBe(false);
  });

  it("reads card sections after the account's rows, and leaves the account's rows alone", () => {
    expect(cardProgramSectionFee(glcu, "Inactivity Fee (12 months)", 5)).toBe(true);
    expect(cardProgramSectionFee(glcu, "Domestic Outgoing Money Wire Transfer", 25)).toBe(false);
    expect(cardProgramSectionFee(southern, "Monthly Maintenance Fee", 3.95)).toBe(true);
    expect(cardProgramSectionFee(southern, "Domestic ATM Transaction Fee", 2)).toBe(true);
    expect(cardProgramSectionFee(southern, "Collection Fee/Foreign Check Presentment", 30)).toBe(false);
  });

  it("needs every priced line of the fee in a card section", () => {
    const both = ["Debit Card Fees", "Lost/Stolen Card | $5.00", navy].join("\n");
    expect(cardProgramSectionFee(both, "Lost/Stolen Card", 5)).toBe(false);
    // Only lines at the fee's own price decide.
    const otherPrice = ["Debit Card Fees", "Lost/Stolen Card | $10.00", navy].join("\n");
    expect(cardProgramSectionFee(otherPrice, "Lost/Stolen Card", 5)).toBe(true);
    expect(cardProgramSectionFee(navy, "Lost/Stolen Card", 7)).toBe(false);
    expect(cardProgramSectionFee(navy, null, 5)).toBe(false);
    expect(cardProgramSectionFee(null, "Lost/Stolen Card", 5)).toBe(false);
    expect(cardProgramSectionFee(navy, "Lost/Stolen Card", null)).toBe(false);
  });

  it("ends the section at the next heading, prose line or unpriced row", () => {
    const next = ["Gift Cards", "Gift Card | $3.00", "Stop Payments", "Single item | $30.00"].join("\n");
    expect(cardProgramSectionFee(next, "Single item", 30)).toBe(false);
    const prose = ["Gift Cards", "Gift Card | $3.00", "Fees are subject to change without notice.", "Statement copy | $5.00"].join("\n");
    expect(cardProgramSectionFee(prose, "Statement copy", 5)).toBe(false);
    const far = ["Gift Cards", ...Array.from({ length: 21 }, (_, i) => `Row ${i} | $${i + 1}.00`)].join("\n");
    expect(cardProgramSectionFee(far, "Row 18", 19)).toBe(true);
    expect(cardProgramSectionFee(far, "Row 20", 21)).toBe(false);
  });

  it("does not take a row's label, a combined product or a bulleted line for a card heading (prod dry run, Oct 25)", () => {
    // USSFCU (doc 2124): "Reloadable cards Separate schedule Varies" is a Services row.
    const ussfcu = ["Services", "Pay by Debit Card Payment using a non-USSFCU card $15.00", "Reloadable cards Separate schedule Varies", "Research Per hour or fraction $30.00", "Statement Reprint Request Per statement $5.00"].join("\n");
    expect(cardProgramSectionFee(ussfcu, "Statement Reprint Request Per statement", 5)).toBe(false);
    // Evolve FCU (doc 17490): "Pre-Paid Services Charges" heads a cashier's check price.
    expect(cardProgramSectionFee(["Pre-Paid Services Charges", "Cashier’s Check | N/C | N/C | $3.00/each | $3.00/each"].join("\n"), "Cashier’s Check", 3)).toBe(false);
    // Bronco FCU (doc 16532): a bulleted card line from another column.
    expect(cardProgramSectionFee(["• Travel Card", "Account Reconciliation $20.00/Hour | Replacement Fee"].join("\n"), "Account Reconciliation", 20)).toBe(false);
    // UCCU (doc 21624): "Visa Gift Card Fee" is a wrapped row's label.
    const uccu = ["For members: $2.50 per card", "Visa Gift Card Fee", "For nonmembers: $3.00 per card", "Domestic Wire Deposit Fee: $10.00 per transfer"].join("\n");
    expect(cardProgramSectionFee(uccu, "Domestic Wire Deposit Fee", 10)).toBe(false);
    // Bank Pinnacle (doc 28345) and ELGA (doc 20767): the account's rows interleaved from another column.
    expect(cardProgramSectionFee(["Prepaid Cards", "Dormant Account Fee - Per Month After 12 Months Inactive | $ 5.00 | Gift Card Activation Fee | $ | 4.00"].join("\n"), "Dormant Account Fee - Per Month After 12 Months Inactive", 5)).toBe(false);
    expect(cardProgramSectionFee(["Prepaid Cards:", "Collection Item Processing (All Other Currency) ................... $95.00"].join("\n"), "Collection Item Processing (All Other Currency)", 95)).toBe(false);
    // A debit card heading, a credit card heading and a business heading are no card program's.
    for (const heading of ["Debit and Gift Cards", "Visa Credit and Gift Cards", "Business Prepaid Cards"]) {
      expect(cardProgramHeading(heading)).toBe(false);
    }
    // A loan's prepaid finance charge is not a card.
    expect(cardProgramHeading("Prepaid Finance Charges")).toBe(false);
    for (const heading of ["Prepaid and Gift Cards", "GO Prepaid Cards", "Visa® Gift Cards", "GIFT CARD FEES AND EXPIRATION", "Payroll Card", "CUMoney Everyday Spend Prepaid Card*", "Credit Union Gift Cards"]) {
      expect(cardProgramHeading(heading)).toBe(true);
    }
  });

  it("reads a label over its own price as a row, not a heading", () => {
    // Stacked layouts print each label over its price: "Gift Cards" / "$3.50" is one row.
    const stacked = ["Dormant Account Fee", "Gift Cards", "$3.50", "Wire fee", "$25.00"].join("\n");
    expect(cardProgramSectionRows(stacked)).toEqual(new Set());
    expect(withoutCardProgramSections(stacked)).toBe(stacked);
  });

  it("keeps a purchase price by audience or unit, a perk line, a wrapped card row and deposit words (#1908 review)", () => {
    // Audience or unit labels under a gift card heading are the card's purchase price.
    expect(cardProgramSectionRows(["Gift Cards", "Members | $2.50", "Non-members | $4.50", "— NON-Member | $5", "Per card $2.50", "Customer | $5", "Member | $2.50/card"].join("\n"))).toEqual(new Set());
    expect(cardProgramSectionRows(["Reloadable Prepaid Cards", "Initial: $12.00", "Subsequent: $3.50", "New Card | $10.00", "* Over-the-Counter $3.95"].join("\n"))).toEqual(new Set());
    // "No Purchase Fee ... Gift Cards" is a perk, not a heading.
    expect(cardProgramHeading("No Purchase Fee VISA Travel Money Cards & Gift Cards")).toBe(false);
    // A card word wrapped off a priced row is not a heading.
    const wrapped = ["Debit Card Replacement/ Visa Gift Card/Reloadable Card/ Visa $5.00", "Travel Card", "Lost card | $5.00"].join("\n");
    expect(wrappedCardRow("Debit Card Replacement/ Visa Gift Card/Reloadable Card/ Visa $5.00")).toBe(true);
    expect(wrappedCardRow("Gift Card | $3.00")).toBe(false);
    expect(wrappedCardRow("Wire fee $25.00")).toBe(false);
    expect(cardProgramSectionRows(wrapped)).toEqual(new Set());
    // Share, draft, dormancy, payment, package, perks and loan rows are the account's.
    for (const row of ["Inactivity Fee on any share | $5.00", "Dormancy Fee | $5.00", "External Payment Online | $8", "Commercial Business Package $30 monthly", "ELGA Perks .... $6.95/month", "Loan payoff letter | $10.00"]) {
      expect(cardProgramSectionFee(["Prepaid Cards", "Lost card | $5.00", row].join("\n"), row.split(/[|$.]/)[0].trim(), Number(row.match(/\$([0-9.]+)/)?.[1]))).toBe(false);
    }
    // A tab or a no-break space around a heading is trimmed as JS trims it.
    expect(cardProgramHeading(" Gift Cards\t")).toBe(true);
  });

  it("keeps a row that names a deposit product", () => {
    const text = ["Gift Cards", "Checking account replacement card | $5.00", "Lost card | $5.00"].join("\n");
    expect(cardProgramSectionFee(text, "Checking account replacement card", 5)).toBe(false);
    expect(cardProgramSectionFee(text, "Lost card", 5)).toBe(true);
  });

  it("tells rows from headings", () => {
    expect(sectionRow("Fee | Amount")).toBe(true);
    expect(sectionRow("Document Type | Fee")).toBe(true);
    expect(sectionRow("Currency conversion 0.2%")).toBe(true);
    expect(sectionRow("Wire Transfers |")).toBe(false);
    expect(sectionRow("Purchase | Not applicable | Not applicable")).toBe(false);
    expect(sectionNamePattern("Lost/Stolen Card")).toBe("(?<![a-z0-9])lost[^a-z0-9]+stolen[^a-z0-9]+card(?![a-z0-9])");
    expect(sectionNamePattern("—")).toBeNull();
  });
});

describe("Knox leaves card section rows out of the text (v116)", () => {
  it("drops the card's rows and keeps its purchase price and every other line", () => {
    const out = withoutCardProgramSections(`${navyAtm}\n${navy}`);
    expect(out).toContain("Card Purchase Charge | $0");
    expect(out).toContain("Transfer | None | None | $1.00");
    expect(out).toContain("GO Prepaid Cards");
    expect(out).not.toContain("Lost/Stolen Card | $5.00");
    expect(out).not.toContain("Visa/PLUS Network ATM");
    expect(withoutCardProgramSections(glcu)).toContain("Gift Card | $3.50 per card");
    expect(withoutCardProgramSections(glcu)).not.toContain("Inactivity Fee (12 months)");
    expect(withoutCardProgramSections(navyAtm)).toBe(navyAtm);
    expect(cardProgramSectionRows("")).toEqual(new Set());
  });

  it("writes the heading test for Postgres from the same patterns", () => {
    const sql = cardProgramHeadingSql("hl.line");
    expect(sql).toContain("char_length(btrim(hl.line, E' \\t\\n\\r");
    expect(sql).toContain("<= 80");
    expect(sql).toContain("\\u00a0");
    expect(sql).toContain("strpos(hl.line, '|') = 0");
    expect(sql).toContain("gift ?cards?");
    expect(sql).toContain("(?:fee|charge|price|cost) $");
  });
});
