// @vitest-environment node
import { describe, expect, it } from "vitest";
import { gluedHeadingName, reviewReadName, withReviewedNames } from "@/lib/agents/knox/read-name-review";
import { freeNsfLine, runFreeSpecialists, withReturnBesideNsf } from "@/lib/agents/knox/specialists";
import { paperStatementRead, wireServiceMonthlyName } from "@/lib/agents/knox/rules";
import { parallelColumnRows } from "@/lib/agents/knox/table-rows";
import { checkFeeAgainstSource, joinWrappedLeaderNames } from "@/lib/custom-report/source-check";
import { paperStatementPriceOnLine } from "@/lib/paper-statement-price";
import type { ExtractedFeeCandidate } from "@/lib/agents/knox/rules";

/** Knox v184: the live slice dry run's wrong reads and the cross-category scan's five live fees, from their texts' own lines. */
const read = (canonicalHint: string, feeName: string, amount: number, excerpt: string) => ({ canonicalHint, feeName, amount, excerpt });

describe("Knox v184 last name review (read-name-review.ts)", () => {
  it("drops a heading or another column glued in front when the label alone files under the read's category", () => {
    // Fee Insight slice texts 27330, 28158, 33581, 33617.
    expect(gluedHeadingName("LOAN FEES: 3x10 Box", "safe_deposit_box")).toBe("3x10 Box");
    expect(gluedHeadingName("Wire Transfer: Deposit Item Chargeback", "deposited_item_return")).toBe("Deposit Item Chargeback");
    expect(gluedHeadingName("Customer Services: Annual Fee 3x5", "safe_deposit_box")).toBe("Annual Fee 3x5");
    // An account that says whose price it is stays; so does a label that does not file alone.
    expect(gluedHeadingName("Money Market Accounts: ATM/Debit Card reissue", "card_replacement")).toBeNull();
    expect(gluedHeadingName("Cashier's Check: Customer", "cashiers_check")).toBeNull();
    // An account or card in capitals says whose price it is (review of 29ef3de53d2; rb10 text 40788, live #141969).
    expect(gluedHeadingName("VISA CHECK CARD CHARGES: Non Sufficient Funds", "nsf")).toBeNull();
    expect(gluedHeadingName("GOLD CHECKING: Monthly Service Charge", "monthly_maintenance")).toBeNull();
    // A card inside another row's label is no product (slice text 27330: "LOAN/LEASE/CREDIT CARD PAYMENT BY
    // ONLINE/MOBILE USING | SAFE DEPOSIT BOX DRILLING FEE | g$100.00").
    expect(gluedHeadingName("LOAN/LEASE/CREDIT CARD PAYMENT BY ONLINE/MOBILE USING: SAFE DEPOSIT BOX DRILLING FEE", "safe_deposit_box")).toBe("SAFE DEPOSIT BOX DRILLING FEE");
    // A heading not in capitals that ends in "Fees" is still a heading (rb10 text 4803, live #41503: "IRA Share Savings
    // Account Fees | Wire-Outgoing International | $40.00 ea"), and so is "Account Fees" (rb5 text 39789).
    expect(gluedHeadingName("IRA Share Savings Account Fees: Wire-Outgoing International", "wire_intl_outgoing")).toBe("Wire-Outgoing International");
    expect(gluedHeadingName("Account Fees: A low balance service charge", "minimum_balance")).toBe("A low balance service charge");
    expect(gluedHeadingName("CONSUMER ACCOUNTS: Statement Printout", "document_reproduction")).toBeNull();
    // A sentence's clause is no row's label (rb12 text 24830): kept whole.
    expect(gluedHeadingName("For Kasasa Cash, if qualifications are met each monthly qualification cycle: (1) Domestic ATM fees incurred during quali", "atm_non_network")).toBeNull();
  });

  it("drops a font glyph printed against the price and a box size's footnote digit", () => {
    expect(reviewReadName(read("nsf", "NON-SUFFICIENT FUNDS FEE (NSF): g", 35, "NON-SUFFICIENT FUNDS FEE (NSF) | g$35.00"), "")?.read?.feeName)
      .toBe("NON-SUFFICIENT FUNDS FEE (NSF)");
    // Texas Capital Bank text 35692, read from two tables: one box each after the review.
    const boxes = [
      read("safe_deposit_box", "Safe Deposit Box 3x103", 50, "Safe Deposit Box 3x103 | $50 | $50"),
      read("safe_deposit_box", "Safe Deposit Box 3x104", 50, "Safe Deposit Box 3x104 | $50 | $50"),
    ];
    expect(withReviewedNames(boxes, "").map((box) => box.feeName)).toEqual(["Safe Deposit Box 3x10"]);
    // Slice text 27330: the box table's read and the glued row's read are one box once the heading is off.
    const twins = [
      read("safe_deposit_box", "Safe Deposit Box 3x10", 50, "LOAN FEES | 3x10 Box | $50.00/year"),
      read("safe_deposit_box", "LOAN FEES: 3x10 Box", 50, "LOAN FEES | 3x10 Box | $50.00/year"),
    ];
    expect(withReviewedNames(twins, "").map((box) => box.feeName)).toEqual(["Safe Deposit Box 3x10"]);
    // Two accounts' fees at one price stay two fees.
    const accounts = [
      { ...read("monthly_maintenance", "Monthly Service Charge", 10, "Monthly Service Charge | $10"), lineup: { productName: "Gold Checking" } },
      { ...read("monthly_maintenance", "Monthly Service Charge", 10, "Monthly Service Charge | $10"), lineup: { productName: "Platinum Checking" } },
    ];
    expect(withReviewedNames(accounts, "")).toHaveLength(2);
  });

  it("names advice by the title above it, and keeps an advice name with no title as the fee's own words", () => {
    // River City Bank text 22920.
    const text = "Non-MoneyPass© ATM Activity\n\n(Fee shown as Direct S/C – ATM Foreign WD Fee) Avoid these fees by using an ATM that utilizes the MoneyPass© Network. | $2.50 each";
    const advice = read("atm_non_network", "Avoid these fees by using an ATM that utilizes the MoneyPass© Network", 2.5, "(Fee shown as Direct S/C – ATM Foreign WD Fee) Avoid these fees by using an ATM that utilizes the MoneyPass© Network. | $2.50 each");
    expect(reviewReadName(advice, text)?.read?.feeName).toBe("Non-MoneyPass© ATM Activity");
    // Live 135372: a real paper statement fee whose only words are advice.
    const own = read("paper_statement", "To avoid a monthly paper statement fee", 3, "To avoid a monthly paper statement fee of $3.00, the account must be enrolled in electronic statements");
    expect(reviewReadName(own, own.excerpt)).toBeNull();
  });

  it("drops a deposit to join, a capitals cell's price that is the next label's, and keeps another account's deposit further along", () => {
    // America's FCU text 29839, First State Bank and Trust text 22671.
    const deposit = read("monthly_maintenance", "No monthly maintenance fees: Only", 25, "Only a $25");
    expect(reviewReadName(deposit, "No monthly maintenance fees\n\nOnly a $25 membership deposit to get started")).toEqual({ read: null, rule: "opening_deposit" });
    const counter = read("counter_check", "COUNTER CHECKS", 32, "COUNTER CHECKS | PER DEBIT ITEM • $32 | DEPOSIT");
    expect(reviewReadName(counter, counter.excerpt)).toEqual({ read: null, rule: "caps_cell_label" });
    // Lyons FCU (rb text 21993): the $5 deposit to open is the next account's.
    const lyons = "No monthly service charge if average daily balance exceeds $1,000; Lower balance accounts are charged a monthly service charge of $5.00 Super Advantage Checking Maintain a $1,000 average daily balance, and Super Advantage Checking gets you a long list of rewards and pays interest. $1000 Deposit to open Tiered rates - variable interest rate earned. Prestige 50 Checking $5 Deposit to open";
    const lower = read("monthly_maintenance", "Lower balance accounts are charged a monthly service charge of", 5, "Lower balance accounts are charged a monthly service charge of $5.00");
    expect(reviewReadName(lower, lyons)).toBeNull();
    // A monthly fee at the opening deposit's own price is still a fee (review of 29ef3de53d2).
    const savings = "Regular Savings $5 minimum opening deposit; monthly service charge $5";
    expect(reviewReadName(read("monthly_maintenance", "Monthly service charge", 5, savings), savings)).toBeNull();
  });

  it("files a box's late charge as the box's and paper statements offered in a check image's name as the paper statement", () => {
    // Cornerstone Community FCU text 24203 (live 128047).
    expect(reviewReadName(read("late_payment", "Box Late Fee", 20, "Box Late Fee ......................................... $20.00"), "")?.read)
      .toMatchObject({ canonicalHint: "safe_deposit_box", feeName: "Box Late Fee" });
    // Austin Bank text 25416.
    const line = "Statements | Free eStatements (Paper statements without check images are available for a $3 monthly fee) | Free eStatements Paper statements are not available on this account.";
    expect(paperStatementPriceOnLine(line, 3)).toBe("Paper statements without check images are available for a $3");
    const offered = read("check_image", "Free eStatements (Paper statements without check images are available for a", 3, line);
    expect(reviewReadName(offered, line)?.read).toMatchObject({ canonicalHint: "paper_statement", feeName: "Paper statements" });
    // A paper statement priced with its check images stays the image charge (live 154497).
    const images = { canonicalHint: "check_image", feeName: "Paper Statement Fee with check images", amount: 10 } as ExtractedFeeCandidate;
    expect(paperStatementRead(images, "Paper Statement Fee with check images | $10.00").canonicalHint).toBe("check_image");
  });
});

describe("Knox v184 plain returned item beside the NSF fee (withReturnBesideNsf)", () => {
  const fee = (canonicalHint: string, feeName: string, amount: number) => ({ canonicalHint, feeName, amount });

  it("files a return beside a free NSF fee, or beside a deposited return at its own price, as the deposited item return", () => {
    // Live Oak Bank text 6249 (live 99611, 99612).
    const liveOak = "Miscellaneous Fees\nStop Payment Fee $25\nReturned Item Fee $10\nNon-Sufficient Funds (NSF) Fee No charge\nOverdraft Fee No charge";
    expect(freeNsfLine(liveOak)).toBe(true);
    expect(withReturnBesideNsf([fee("nsf", "Returned Item Fee", 10)], [], liveOak)[0].canonicalHint).toBe("deposited_item_return");
    // TXN Bank text 10944 (live 141626): "Return Items | $10.00", "NSF | $30.00", "Charge Backs | $10/Item".
    const txn = [fee("nsf", "Return Items", 10), fee("nsf", "NSF", 30), fee("deposited_item_return", "Charge Backs", 10)];
    expect(withReturnBesideNsf(txn)[0].canonicalHint).toBe("deposited_item_return");
  });

  it("keeps the member's own returned item as NSF", () => {
    // Parthenon FCU text 5186: its own "Deposited Item Return Fee" is $25, so the $30 return is the member's item.
    const parthenon = [fee("nsf", "Returned Item Fee", 30), fee("nsf", "NSF Fee", 33), fee("deposited_item_return", "Deposited Item Return Fee", 25)];
    expect(withReturnBesideNsf(parthenon)[0].canonicalHint).toBe("nsf");
    // The NSF fee at the return's own price: one fee under two names.
    expect(withReturnBesideNsf([fee("nsf", "Returned Item", 30), fee("nsf", "NSF", 30), fee("deposited_item_return", "Deposited Item Return", 30)])[0].canonicalHint).toBe("nsf");
    // A priced NSF line is no free one.
    expect(freeNsfLine("Non-Sufficient Funds (NSF) Fee $30\nReturned Item Fee $10")).toBe(false);
    // A waiver is no free price (review of 29ef3de53d2).
    expect(freeNsfLine("Overdraft/NSF Fee Waived for first item per year\nReturned Item Fee $10")).toBe(false);
  });
});

describe("Knox v184 layout reads", () => {
  it("pairs two label cells over two price cells by column, and leaves a wrapped label alone", () => {
    // Advia CU text 30743, joined as one row.
    expect(parallelColumnRows({ cells: ["Account History Print", "Loan Skip Pay", "$1/page", "$35 where regionally offered"] } as never).map((row) => row.cells))
      .toEqual([["Account History Print", "$1/page"], ["Loan Skip Pay", "$35 where regionally offered"]]);
    const wrapped = { cells: ["ACH Transfer Origination - per", "Daily Overdraft Fee (Overdrawn Account after", "$2.00", "$5.00"] } as never;
    expect(parallelColumnRows(wrapped)).toEqual([wrapped]);
  });

  it("holds a wire service's monthly charge and reads no code after a heading as a price", () => {
    // Ameris Bank text 1338.
    expect(wireServiceMonthlyName("Online Wire Monthly Maintenance Fee")).toBe(true);
    expect(wireServiceMonthlyName("Business Checking with Wire Access Monthly Maintenance Fee")).toBe(false);
    // St. Cloud FCU text 21575: "Wincentive Savings Account (S40)" heads its withdrawals; no gift card reads them.
    const stCloud = "UCC Termination $20.00\nVisa Gift Card\n* Over-the-Counter $3.95\nWincentive Savings Account (S40)\n*First withdrawal $10.00\n*Second withdrawal $25.00";
    expect(runFreeSpecialists(stCloud).candidates.filter((candidate) => candidate.canonicalHint === "gift_card_purchase").map((candidate) => candidate.amount)).toEqual([3.95]);
  });

  it("reads Crow Wing Power CU's wire transfer under no legal heading", () => {
    // Crow Wing text 23340, two columns as printed.
    const text = [
      "SUBORDINATION REQUEST & PARTIAL | RELEASE – $250",
      "PERSONALIZED CHECKS – Fees Vary | RELEASE – $250",
      "Members are responsible for the cost of | Charged when multiple mortgages (at multiple",
      "their personalized checks. Check fees vary | institutions) lien positions are re-ordered.",
      "depending on the style of check selected.",
      "WIRE TRANSFER – $20",
    ].join("\n");
    const reads = runFreeSpecialists(text).candidates.filter((candidate) => candidate.amount === 20);
    expect(reads.every((candidate) => candidate.canonicalHint !== "legal_process")).toBe(true);
  });

  it("ends a wrapped leader name's balance at its own cell, and traces a box size by its footnoted row", () => {
    // Velocity CU text 35462: the other column's open parenthesis is no part of "Temporary Checks".
    const joined = joinWrappedLeaderNames([
      "spending posted and settled (credit card period coverage is from",
      "the 28th of the previous month to the 27th of the current month), | Temporary Checks.......................................................... $.50 each | Statement Print-Out ................................$5.00 each occurrence",
    ]);
    expect(joined.some((line) => /spending posted and settled[^|]*Temporary Checks/.test(line))).toBe(false);
    // Texas Capital Bank text 35692.
    const box = "Safe Deposit Box 3x103 | $50 | $50\nSafe Deposit Box 5x103 | $75 | $75";
    expect(checkFeeAgainstSource(box, "Safe Deposit Box 3x10", 50, "", "safe_deposit_box").ok).toBe(true);
    expect(checkFeeAgainstSource(box, "Safe Deposit Box 3x10", 75, "", "safe_deposit_box").ok).toBe(false);
  });
});
