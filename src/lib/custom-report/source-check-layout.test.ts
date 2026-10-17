import { describe, expect, it } from "vitest";
import { checkFeeAgainstSource, joinLabeledFeeCards, stripPriceFootnoteMarks } from "./source-check";

describe("checkFeeAgainstSource layouts", () => {
  it("reads a price printed under its fee's name", () => {
    const text = "Overnight Courier Service\n$50.00\n/Item";
    expect(checkFeeAgainstSource(text, "Overnight Courier Service", 50, ".").ok).toBe(true);
  });

  it("reads a price under a name whose note runs onto the next line", () => {
    const text = [
      "Overdraft Fee (per item, both returned or paid created by check, in person withdrawal,",
      "ATM withdrawal, or other electronic means. Maximum of 6 fees per day.)",
      "",
      "$36.00",
    ].join("\n");
    expect(checkFeeAgainstSource(text, "Overdraft Fee", 36, ".", "overdraft").ok).toBe(true);
    // A note that never closes is not a qualifier: the next line may be another fee.
    expect(checkFeeAgainstSource("Overdraft Fee (per item\nStop payment\n$36.00", "Overdraft Fee", 36, ".", "overdraft").ok).toBe(false);
  });

  it("reads a price whose footnote marks were read onto it", () => {
    const text = [
      "Overdraft Fee³ - All Checking and Savings Accounts",
      "$334, 5",
      "(Including Money Markets)",
      "4. Please be aware that an item may be presented multiple times.",
      "5. Maximum of six (6) Overdraft Fees and/or NSF Fees combined may be charged per day.",
    ].join("\n");
    expect(checkFeeAgainstSource(text, "Overdraft Fee - All Checking and Savings Accounts", 33, ".", "overdraft").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "Overdraft Fee - All Checking and Savings Accounts", 334, ".", "overdraft").ok).toBe(false);
    // With no footnotes printed, the figure stays as written.
    expect(stripPriceFootnoteMarks("Overdraft Fee\n$334, 5")).toBe("Overdraft Fee\n$334, 5");
  });

  it("does not give a name the next fee's price", () => {
    const text = "Wire Transfer - Incoming\nWire Transfer - Outgoing\n$25.00";
    expect(checkFeeAgainstSource(text, "Wire Transfer - Incoming", 25, ".").ok).toBe(false);
  });

  it("reads a name split under a heading, past the rows before it", () => {
    const text = "Wire Transfers\nIncoming Domestic\n$14.00\nOutgoing Domestic\n$26.00";
    expect(checkFeeAgainstSource(text, "Wire Transfers Outgoing Domestic", 26, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "Wire Transfers Incoming Domestic", 14, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "Wire Transfers Incoming Domestic", 26, ".").ok).toBe(false);
  });

  it("reads a line under a heading that names most of the fee", () => {
    const text = "CASHIERS CHECK | $5.00 / EACH\n\nWIRE TRANSFERS (OUTGOING)\n\nDOMESTIC WIRE | $35.00\n\nINTERNATIONAL | $55.00";
    expect(checkFeeAgainstSource(text, "WIRE TRANSFERS (OUTGOING): DOMESTIC WIRE", 35, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "WIRE TRANSFERS (OUTGOING): DOMESTIC WIRE", 55, ".").ok).toBe(false);
    const overdraft = "Account Fees\nOverdraft/Non-Sufficient Funds\n...Item Paid $30.00\n...Item Returned $30.00";
    expect(checkFeeAgainstSource(overdraft, "Overdraft/Non-Sufficient Funds: Item Paid", 30, ".").ok).toBe(true);
  });

  it("reads a price printed under its name after a bullet or a tilde", () => {
    expect(checkFeeAgainstSource("Photocopies\n• $1.00 per page", "Photocopies", 1, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("Stop Payment (per request)\n\n~$25\n\nFREE", "Stop Payment (per request)", 25, ".").ok).toBe(true);
  });

  it("takes the row's first figure that is not a limit as the price", () => {
    const text = "Official Teller Check | $4.00 | per check, if not made payable to member, minimum $500";
    expect(checkFeeAgainstSource(text, "Official Teller Check", 4, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "Official Teller Check", 500, ".")).toEqual({ ok: false, reason: "amount_is_a_threshold" });
    const overdraft = "$35 Overdraft Fee for each item we pay that overdraws your account more than $9.99";
    expect(checkFeeAgainstSource(overdraft, "Overdraft Fee for each item we pay", 35, ".").ok).toBe(true);
  });

  it("reads each fee's own price when one line carries several fees", () => {
    const line = "Title Draft $50.00 Incoming Wire Fee (domestic) $18.00";
    expect(checkFeeAgainstSource(line, "Incoming Wire Fee (domestic)", 18, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(line, "Incoming Wire Fee (domestic)", 50, ".").ok).toBe(false);
    expect(checkFeeAgainstSource(line, "Title Draft", 18, ".").ok).toBe(false);
    const paragraph =
      "Overdraft Transfer $3 per occurrence Stop Payment (Valid for six months) $32 per item or series " +
      "Wire Transfers • Outgoing — domestic $33.00 • Incoming6 $15.00 Lost ATM/debit card replacement $5.00";
    expect(checkFeeAgainstSource(paragraph, "Stop Payment (Valid for six months)", 32, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(paragraph, "Lost ATM/debit card replacement", 5, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(paragraph, "Stop Payment (Valid for six months)", 3, ".").ok).toBe(false);
    expect(checkFeeAgainstSource("$1.95 each thereafter) | $1.95 | NSF/Overdraft Fee | $32.00", "NSF/Overdraft Fee", 32, ".").ok).toBe(true);
  });
  it("reads layouts the live dry run of Oct 6 showed it missing", () => {
    // Dot leaders before a bare amount.
    expect(checkFeeAgainstSource("Courtesy Pay .......................30.00", "Courtesy Pay", 30, ".").ok).toBe(true);
    // A minimum charge before the hourly price.
    expect(checkFeeAgainstSource("Account Research/Balancing | $10.00 minimum / $25.00 per hour", "Account Research/Balancing", 25, ".").ok).toBe(true);
    // A range in the name is not the price.
    expect(checkFeeAgainstSource("VISA Gift Cards (load $10-$1000) | $4.00 each", "VISA Gift Cards", 4, ".").ok).toBe(true);
    // A heading over sub-rows that carry their own names and prices.
    const wires = "Wire Transfer\nIncoming | $10.00\nOutgoing | $30.00";
    expect(checkFeeAgainstSource(wires, "Wire Transfer: Outgoing", 30, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(wires, "Wire Transfer: Outgoing", 10, ".").ok).toBe(false);
    expect(checkFeeAgainstSource("Stop Payment Fee:\nPer Item | $25.00", "Stop Payment Fee: Per Item", 25, ".").ok).toBe(true);
    // Box sizes are matched whole, and a price-first list names each box after its price.
    expect(checkFeeAgainstSource("5 x 10 | $60.00\n15 x 10 | $90.00", "5 x 10", 60, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("5 x 10 | $60.00\n15 x 10 | $90.00", "5 x 10", 90, ".").ok).toBe(false);
    const prices = "$25 (3 X 5), $35 (3 X 10), $55 (5 X 10), $80 (10 X 10)";
    expect(checkFeeAgainstSource(prices, "(5 X 10)", 55, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(prices, "(5 X 10)", 80, ".").ok).toBe(false);
  });

  it("pairs a dot-leader name with the price that opens the next line, not the price before it", () => {
    const text = [
      "Wire Transfer (outgoing).........................",
      "$20.00 Wire Transfer Agreement (WPIN) Replacement Fee .....",
      "$10.00 Outgoing International Wire (in foreign currency) ...........",
      "$50.00 Levies ..........",
      "$20.00",
    ].join("\n");
    expect(checkFeeAgainstSource(text, "Wire Transfer (outgoing)", 20, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "Outgoing International Wire (in foreign currency)", 50, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "Outgoing International Wire (in foreign currency)", 10, ".").ok).toBe(false);
    expect(checkFeeAgainstSource(text, "Levies", 20, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "Levies", 50, ".").ok).toBe(false);
  });

  it("reads a price past a line that only qualifies the name", () => {
    const text = "Temporary Checks\nIf checks are not on order (10 maximum)\n$2.00\nMoney order\n(up to $1,000)\n$5";
    expect(checkFeeAgainstSource(text, "Temporary Checks", 2, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "Money order", 5, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "Money order", 1000, ".").ok).toBe(false);
    // Another fee's name between them still ends the row.
    expect(checkFeeAgainstSource("Incoming\nOutgoing\n$25.00", "Incoming", 25, ".").ok).toBe(false);
  });

  it("ties a free word to its name on a schedule flattened to one line", () => {
    const text =
      "Checking Account Monthly Fee NONE Return Check Fee (Per Item) $30.00 Continuous Overdraft Fee (Per Day) NONE " +
      "Wire Transfer - Domestic Outgoing $20.00 Wire Transfer - Domestic Incoming FREE";
    expect(checkFeeAgainstSource(text, "Wire Transfer - Domestic Incoming", 0, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "Checking Account Monthly Fee", 0, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "Wire Transfer - Domestic Outgoing", 0, ".").ok).toBe(false);
    expect(checkFeeAgainstSource(text, "Return Check Fee", 0, ".").ok).toBe(false);
  });

  it("reads a cap stated after the row's per-item price for a fee named as the cap", () => {
    const text = "Paid overdraft item $35 per item, maximum of $175 per day";
    expect(checkFeeAgainstSource(text, "Paid overdraft item daily maximum", 175, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "Paid overdraft item", 175, ".").ok).toBe(false);
  });

  it("reads a price line that carries a lowercase note about the price (Ent Courtesy Pay)", () => {
    const text = "Courtesy Pay\n$30.00 | everyday debit card transactions and ATM withdrawals are not covered unless you opt in";
    expect(checkFeeAgainstSource(text, "Courtesy Pay", 30, ".").ok).toBe(true);
    // A long price line that names another fee is still that fee's row.
    expect(checkFeeAgainstSource("Incoming\n$30.00 | Outgoing domestic wires sent through the branch", "Incoming", 30, ".").ok).toBe(false);
  });

  it("reads a tier named by its own band, never a band standing in for the whole fee", () => {
    const text = "Overdraft Item Fee: based on item amount\n$10.01 - $20.00: $10.00 fee";
    expect(checkFeeAgainstSource(text, "Overdraft Item Fee (items $10.01 - $20.00)", 10, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("Overdraft | Negative $25 or less | $5", "Overdraft", 5, ".")).toEqual({ ok: false, reason: "tiered_fee" });
  });

  it("reads a low-balance price after a balance word that belongs to another figure or names the fee (#1100)", () => {
    // Government Employees FCU 2435: "minimum" closes $500.00; $5.00 is the price.
    const gefcu = "Monthly Service Charge Below $500.00 minimum $5.00 per Month";
    expect(checkFeeAgainstSource(gefcu, "Monthly Service Charge Below minimum", 5, ".", "monthly_maintenance").ok).toBe(true);
    expect(checkFeeAgainstSource(gefcu, "Monthly Service Charge Below minimum", 500, ".", "monthly_maintenance").ok).toBe(false);
    // Buffalo Metropolitan 7114 and Georgia United 60.
    expect(checkFeeAgainstSource("Low balance $ 5.00 per month3", "Low balance", 5, ".", "minimum_balance").ok).toBe(true);
    expect(checkFeeAgainstSource("Savvy Spending - Minimum Balance $4.95/Month if the minimum average daily balance is not met", "Savvy Spending - Minimum Balance", 4.95, ".", "minimum_balance").ok).toBe(true);
    // A balance stays a balance: "minimum balance $500" with no period, "minimum of $25".
    expect(checkFeeAgainstSource("Checking | Minimum Balance $500 | Monthly fee $10", "Checking Monthly fee", 500, ".").ok).toBe(false);
    expect(checkFeeAgainstSource("Overdraft fee | minimum $25 | $35", "Overdraft fee", 25, ".").ok).toBe(false);
  });

  it("keeps a cap, an averaged balance and a large figure after those words a threshold (#1392 review)", () => {
    // A percent fee's cap (docs 2694, 12157, 14459, 15920, 20357, 32424, 34328): $30 is the maximum.
    const late = "Loan Late Charge (1% of payment) | Every type of Loan (RE, Ag, Home Loan, Consumer) | $15.00 Minimum $30.00 Maximum";
    expect(checkFeeAgainstSource(late, "Loan Late Charge", 30, ".", "late_payment")).toEqual({ ok: false, reason: "amount_is_a_threshold" });
    const balance = (text: string, name: string, amount: number) => checkFeeAgainstSource(text, name, amount, ".", "minimum_balance").ok;
    expect(balance("Minimum Balance $100/Month average", "Minimum Balance", 100)).toBe(false);
    expect(balance("Minimum Balance $100 per month average daily balance", "Minimum Balance", 100)).toBe(false);
    expect(balance("Required Minimum Balance $1,500/month avg or $10 fee", "Required Minimum Balance", 1500)).toBe(false);
    expect(balance("Low balance $1,000 fee $5", "Low balance", 1000)).toBe(false);
    expect(balance("Low balance $1,000. Fee $5 per month", "Low balance", 1000)).toBe(false);
    expect(balance("Low balance $1,000 per month", "Low balance", 1000)).toBe(false);
    // A monthly low-balance fee beside a balance word still reads as a price.
    expect(balance("Savvy Spending - Minimum Balance $4.95/Month if the minimum average daily balance is not met", "Savvy Spending - Minimum Balance", 4.95)).toBe(true);
  });
});

describe("checkFeeAgainstSource daily caps", () => {
  it("reads a daily cap from its fee's row", () => {
    const row = "Overdraft/Non-Sufficient Funds ** | $20.00 | Per Item | Maximum of $120.00 per day";
    expect(checkFeeAgainstSource(row, "Overdraft/Non-Sufficient Funds daily maximum", 120, ".", "od_daily_cap").ok).toBe(true);
    const inline = "NSF/Overdraft Fees**\n1st Overdraft Privilege Paid Fee $30.00 (max $180.00 daily)";
    expect(checkFeeAgainstSource(inline, "1st Overdraft Privilege Paid Fee daily maximum", 180, ".", "od_daily_cap").ok).toBe(true);
    expect(checkFeeAgainstSource("Overdraft fee $35 per item, up to $105 per day", "Overdraft Daily Cap", 105, ".", "od_daily_cap").ok).toBe(true);
    // A cap row that names the cap still traces as a price, as before.
    expect(checkFeeAgainstSource("Overdraft Daily Cap | $175", "Overdraft Daily Cap", 175, ".", "od_daily_cap").ok).toBe(true);
  });

  it("does not read a figure without cap wording, or another fee's cap, as the cap", () => {
    expect(checkFeeAgainstSource("Overdraft Fee | $36.00 per item", "Overdraft Daily Cap", 36, ".", "od_daily_cap").ok).toBe(false);
    expect(checkFeeAgainstSource("Wire Transfer | $25.00 | Maximum of $120.00 per day", "Overdraft Daily Cap", 120, ".", "od_daily_cap").ok).toBe(false);
  });

  it("reads a cap only for a cap category or a fee named as a cap", () => {
    const row = "Overdraft/Non-Sufficient Funds ** | $20.00 | Per Item | Maximum of $120.00 per day";
    expect(checkFeeAgainstSource(row, "Overdraft/Non-Sufficient Funds", 20, ".", "overdraft").ok).toBe(true);
    expect(checkFeeAgainstSource(row, "Overdraft/Non-Sufficient Funds daily maximum", 120, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(row, "Overdraft/Non-Sufficient Funds", 120, ".", "overdraft").ok).toBe(false);
    expect(checkFeeAgainstSource(row, "Overdraft/Non-Sufficient Funds", 120, ".", "od_daily_cap").ok).toBe(true);
  });

  it("reads a long description row's price cell under the row's title", () => {
    const row =
      "Overdraft Fee Assessed when the available balance in your account is insufficient to cover an item (check, fee, returned check, " +
      "ATM/POS authorization, Online Banking, other electronic debit, etc.) of $5.00 or greater that is presented for payment. An Overdraft " +
      "Fee is assessed when such items are paid. Overdraft Fee limited to four (4) charges per day. | $36.00";
    expect(checkFeeAgainstSource(row, "Overdraft Fee", 36, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(row, "Overdraft Fee", 5, ".").ok).toBe(false);
  });

  it("reads a labeled fee card's name and price as one row, never another card's price", () => {
    const text = [
      "Fee TypeCheckOK Fee",
      "DescriptionOverdraft protection paid from a linked account.",
      "Ways to avoid fees",
      "Fee$5.00 each day an overdraft occurs.",
      "Fee TypeCourtesy Pay Overdraft Fee",
      "DescriptionOverdraft Service for checks. The monthly maximum overdraft is $250.",
      "Fee$25.00",
    ].join("\n\n");
    expect(checkFeeAgainstSource(text, "Courtesy Pay Overdraft Fee", 25, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "Courtesy Pay Overdraft Fee", 5, ".").ok).toBe(false);
    expect(joinLabeledFeeCards(["Fee TypeRush Order", "DescriptionExpedite a card", "Fee$15.00"])).toEqual([
      "Rush Order | $15.00",
      "DescriptionExpedite a card",
      "",
    ]);
  });

  it("reads a two-column schedule's right-column heading over its bulleted sub-rows", () => {
    const text = [
      "• Business | $5.00 | Overdrafts (OD)",
      "• Personal | $36.00",
      "Debit Card | FREE | when the amount of the item paid in overdraft is $4.99",
      "• Expedited delivery | $40.00 | • Business | $30.00",
    ].join("\n");
    expect(checkFeeAgainstSource(text, "Overdrafts (OD): Personal", 36, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "Overdrafts (OD): Business", 30, ".").ok).toBe(true);
    // A heading at the end of a row names only bulleted lines under it.
    expect(checkFeeAgainstSource("Notary | $5.00 | Counter Checks\nChecks | $10.00", "Counter Checks", 10, ".").ok).toBe(false);
  });

  it("keeps a one-line PDF schedule's dot-leader rows whole", () => {
    const row =
      "SCHEDULE OF FEES AND CHARGES DEPOSIT SERVICES MISCELLANEOUS SERVICES Activity/Statement Printout……………………………. $5.00 " +
      "Cashier’s Checks………………………………………..……. $4.00 Chargeback (Returned Deposited Item)............ No Charge " +
      "Personal Money Order………………………………...…. $2.00 Special Statement Date…………………………………. $5.00 " +
      "Stop Payment………………………………………………… $35.00 Over $300 USD…………………………..……. $40.00 Dormant Account Fee……………………………………. $7.00/Month " +
      "Garnishments, Levies and Liens…..………………… $75.00 Debit Card Replacement……………………………..... $7.00 Notary Service (non-customer)……………………….. $10.00";
    expect(checkFeeAgainstSource(row, "Stop Payment", 35, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(row, "Cashier’s Checks", 4, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(row, "Dormant Account Fee", 7, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(row, "Personal Money Order", 5, ".").ok).toBe(false);
  });

  it("reads a price with a note in parentheses, and a name whose only figure is a limit (takedowns, Oct 7)", () => {
    const nsf = "Item Returned for Non-Sufficient Funds\n\n$29.00/presentment (applies to transactions of $10 or more. Limit of three (3) NSF charges per day)";
    expect(checkFeeAgainstSource(nsf, "Item Returned for Non-Sufficient Funds", 29, ".").ok).toBe(true);
    const card = "Debit Card Replacement\n\n$10.00 per card replacement (normally up to 7 to 10 business days delivery)\n\n$75.00 for rush delivery (normally 2 business days through UPS)";
    expect(checkFeeAgainstSource(card, "Debit Card Replacement", 10, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(card, "Debit Card Replacement", 75, ".").ok).toBe(false);
    const cashing = "Customer Services\nFee\nNon-Customer check cashing (or 1% if check is over $500)\n$5\nPhotocopies (per page)\n$0.10";
    expect(checkFeeAgainstSource(cashing, "Non-Customer check cashing (or 1% if check is over )", 5, ".").ok).toBe(true);
    const gift = "Foreign Item Processing | $25 per item processed\nGift Cards ($25 up to $500 Only) | $5 per card";
    expect(checkFeeAgainstSource(gift, "Gift Cards ($25 up to $500 Only)", 5, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(gift, "Gift Cards ($25 up to $500 Only)", 25, ".").ok).toBe(false);
    // A row whose only figure is in parentheses keeps it as the price.
    expect(checkFeeAgainstSource("Stop Payment ($30.00)", "Stop Payment", 30, ".").ok).toBe(true);
  });

  it("refuses a price charged per $100 of the item as a flat fee (Oct 7 spot check)", () => {
    const rows = "Cashier Check - All Others (per $100.00) $1.00\nMoney Order - All Others (per $100.00) $1.00\nStop Payment $30.00";
    expect(checkFeeAgainstSource(rows, "Cashier Check - All Others (per )", 1, ".")).toEqual({ ok: false, reason: "priced_per_amount" });
    expect(checkFeeAgainstSource(rows, "Money Order - All Others (per )", 1, ".")).toEqual({ ok: false, reason: "priced_per_amount" });
    expect(checkFeeAgainstSource(rows, "Stop Payment", 30, ".").ok).toBe(true);
    const merged = "CHECK CASHING FEE (NOT ON US- PER $100) | 3X5 – $30.00";
    expect(checkFeeAgainstSource(merged, "CHECK CASHING FEE (NOT ON US- PER )", 30, ".").ok).toBe(false);
    // A neighbouring row's basis on the same line does not count against this fee.
    const wire = "Domestic - Incoming Wire | $10.00 | Loose Currency Ordered (per $100) | $0.50";
    expect(checkFeeAgainstSource(wire, "Domestic - Incoming Wire", 10, ".").ok).toBe(true);
  });

  it("keeps real prices the source check took down (Darwin's sample of takedowns, Oct 7)", () => {
    const ok = (text: string, name: string, amount: number) => expect(checkFeeAgainstSource(text, name, amount, ".").ok, `${name} ${amount}`).toBe(true);
    ok("Wire Transfer Outgoing $20.00", "Wire Transfer Outgoing", 20);
    ok("Minimum Balance Fee (if Balance is Below $7,500):\n$15", "Minimum Balance Fee (if Balance is Below )", 15);
    ok("Dormant Account Fee\n$5.00/Mo", "Dormant Account Fee", 5);
    ok("$150.00 Drill Safe Deposit Box", "Drill Safe Deposit Box", 150);
    ok("Deposit return item\n$10.00", "Deposit return item", 10);
    ok("Chargebacks\n$15.00 per item", "Chargebacks", 15);
    // A balance the fee asks you to keep is a condition, not a balance band.
    ok("Monthly Service Fee for failure to maintain $1,000 daily balance | $3.00", "Monthly Service Fee for failure to maintain daily balance", 3);
    // A price with its unit and a qualifier under the name, or labelled "Fee".
    ok("Dormant Account Fee – Checking, Savings, Money Market\n$5.00 per month for each acct., following 18 consecutive months of inactivity", "Dormant Account Fee – Checking, Savings, Money Market", 5);
    ok("Stop Payment\nFee $35.00", "Stop Payment: Fee", 35);
    // "$.50" is a price.
    ok("Coin Counting (Non-Customer)-Mixed Coins---$.50/Per 100 Coins", "Coin Counting (Non-Customer)-Mixed Coins", 0.5);
    ok("Statement copy | $.50 per copy", "Statement copy", 0.5);
    // A name wrapped onto the next line leaves its parenthesis open; the price is not in a note.
    ok("Consulate Letter | $40.00 | Replacement Key (1 key | $25.00\nlost)", "Replacement Key (1 key", 25);
    // Still refused: a $5 charged per $50 of coin is not a flat fee, and a wrapped name does not take the next fee's price.
    expect(checkFeeAgainstSource("Coin Counting for non-customers, per $50 of coin counted | $5.00", "Coin Counting for non-customers, per of coin counted", 5, ".").ok).toBe(false);
    expect(checkFeeAgainstSource("Consulate Letter | $40.00 | Replacement Key (1 key | $25.00", "Replacement Key (1 key", 40, ".").ok).toBe(false);
  });

  it("reads table layouts behind the second sample of takedowns (Oct 7)", () => {
    const ok = (text: string, name: string, amount: number) => expect(checkFeeAgainstSource(text, name, amount, ".").ok, `${name} ${amount}`).toBe(true);
    // A column heading repeated on every row.
    const cms = "Items\n\nFees & Charges\n\nATM withdrawals on non-CU ATMs\n\nFees & Charges\n$2.00\n\nDebit Card Replacement\n\nFees & Charges\nFREE";
    ok(cms, "ATM withdrawals on non-CU ATMs", 2);
    expect(checkFeeAgainstSource(cms, "ATM withdrawals on non-CU ATMs", 0, ".").ok).toBe(false);
    // An Area | Per | Fee table one cell per line: the unit sits between name and price.
    const perTable = "Wire Transfer Fees - Customers Only\n\nArea\n\nPer\n\nFee\n\nWire Fees - Domestic Incoming\n\nWire\n\nFREE\n\nWire Fees - Domestic Outgoing\n\nWire\n\n$20.00\n\nWire Fees - International Outgoing\n\nWire\n\n$50.00";
    ok(perTable, "Wire Fees - Domestic Outgoing: Wire", 20);
    expect(checkFeeAgainstSource(perTable, "Wire Fees - Domestic Outgoing: Wire", 50, ".").ok).toBe(false);
    ok("2 Account Research-Effective 09/09/2022, the Account Reconciliation Fee was combined with the Account Research\nFee @$20 per hour.", "2 Account Research-Effective 09/09/2022, the Account Reconciliation Fee", 20);
    // A free allowance in a note, a "$200+" condition, a plural "(s)".
    ok("ATM Withdrawal (Non-Bank ATM) (first 6 free)\n$1.00\nVISA Debit Card Replacement Fee (lost)", "ATM Withdrawal (Non-Bank ATM) (first 6 free)", 1);
    ok("Monthly Service Fee (with direct deposit(s) of $200+ per month) ...................$10.00", "Monthly Service Fee (with direct deposit(s) of + per month)", 10);
    // Still refused: a minimum is not the hourly price, a threshold is not the fee.
    expect(checkFeeAgainstSource("Account research ($10 minimum) | $25/hr.", "Account research (", 10, ".").ok).toBe(false);
    expect(checkFeeAgainstSource("Escheat Notice* (when balance is $25 or more) . . . $2.00", "Escheat Notice (when balance is", 25, ".").ok).toBe(false);
  });

  it("keeps a flat price whose row follows another price's per-$ basis (prod first look, Oct 7)", () => {
    const text = "Coin deposited | $0.0062 per $1 | Escheat/abandoned account notice | $2\nCoin furnished | $0.13 per roll | (as permitted by law)";
    expect(checkFeeAgainstSource(text, "Escheat/abandoned account notice", 2, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("Cashier Check (per $100.00) $1.00", "Cashier Check", 1, ".")).toEqual({ ok: false, reason: "priced_per_amount" });
  });

  it("reads two-column pages flattened row by row (Oct 7, third sample)", () => {
    const twoColumn = [
      "CASHIER'S CHECKS........................ $5.00 per customer, | A $50.00 fee will be assessed for a payment book if the loan was originally",
      "$10.00 Non-customer | made on a direct debit basis.",
      "CHECK CASHING for non-customer .............15% of check amount | PROCESSING OF LEVIES**",
      "($15.00 Minimum) | IRS or Court-ordered Garnishments ................. $100.00",
      "CHECK ORDER CHARGES* .............. Prices vary based on check design | RETURNED STATEMENT",
      "CHECKING ACCOUNT INACTIVITY FEE ..........$6.00 per month | (Due to undeliverable address) .........$6.00 per statement",
      "after account has been inactive for 6 months | SAFE-DEPOSIT BOXES ...........Prices vary based on box size",
      "COPIES OF MONTHLY STATEMENTS** ..............$6.00 per statement | stated minimum or cost of service, whichever is greater.",
      "EARLY ACCOUNT CLOSING** | Lost Key Fee ..........................$25.00",
    ].join("\n");
    // The right column's name runs onto its next row, which states the price.
    expect(checkFeeAgainstSource(twoColumn, "PROCESSING OF LEVIES IR", 100, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(twoColumn, "Lost Key Fee", 25, ".").ok).toBe(true);
    // A run-on paragraph split at ";" inside a name: the row runs to the next row's first price.
    const runOn = "Free for age 60+ Certified or Cashier's Check $3.00; Free for age 60+ Check Cashing for non-members; on us only $5.00 Bad Address Correction Fee $3.00 Stop Payment for a PEFCU Check Account $20.00 Reconciliation or Research $20.00 per hour Subpoena/Levy/ Garnishment Fee $75.00 Subpoena/Audit Research Fee $30.00 first hour; $20.00 for additional hours";
    expect(checkFeeAgainstSource(runOn, "Check Cashing for non-members; on us only", 5, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(runOn, "Check Cashing for non-members; on us only", 3, ".").ok).toBe(false);
    // Still refused: the left column's next row is not the levy's price, and a priced row keeps its own price.
    expect(checkFeeAgainstSource(twoColumn, "PROCESSING OF LEVIES IR", 15, ".").ok).toBe(false);
    expect(checkFeeAgainstSource(twoColumn, "CHECKING ACCOUNT INACTIVITY FEE", 100, ".").ok).toBe(false);
    expect(checkFeeAgainstSource(twoColumn, "CHECKING ACCOUNT INACTIVITY FEE", 6, ".").ok).toBe(true);
    // A table row's price cell is never split off its name: "(FREE on Virtual Branch) | $2.00 per page" is $2, not free.
    const table = [
      "Paper Statement Fees | $2.00 (waived for members 55+)",
      "Gift Cards | $3.50 per item",
      "Levy/Garnishment Processing Fee | $15.00",
      "Statement Copy (FREE on Virtual Branch) | $2.00 per page",
      "Approved Skip-A-Pay/Extension Agreements | $25.00 per loan",
      "Home Equity Line of Credit Refinance Fee | $250.00",
    ].join("\n");
    expect(checkFeeAgainstSource(table, "Statement Copy (", 0, ".").ok).toBe(false);
    expect(checkFeeAgainstSource(table, "Statement Copy (FREE on Virtual Branch)", 2, ".").ok).toBe(true);
  });

  it("reads real prices from a fresh sample of older takedowns (Oct 7, 05:10)", () => {
    const ok = (text: string, name: string, amount: number) => expect(checkFeeAgainstSource(text, name, amount, ".").ok, `${name} ${amount}`).toBe(true);
    const no = (text: string, name: string, amount: number) => expect(checkFeeAgainstSource(text, name, amount, ".").ok, `${name} ${amount}`).toBe(false);
    // A "Current Fee" column label between the name and its price.
    const labeled = "Paper Statements\n\nCurrent Fee\n\n$2.00 per month\n\nCurrent Fee\n\n$3.00 per month\n\nInactive Account Fee\n\nCurrent Fee\n\n$5.00 per month\n\nCurrent Fee\n\n$6.00 per month\n\nOverdrawn Account Fee\n\nCurrent Fee\n\n$30.00 per transaction";
    ok(labeled, "Paper Statements", 2);
    ok(labeled, "Inactive Account Fee", 5);
    no(labeled, "Inactive Account Fee", 30);
    // A price followed by a sentence about it.
    ok("Dormant Account Fee\n\n$25.00 Per Month. Applicable after 1 year of inactivity.\n\nReturn Statement Fee\n\n$13.00 Per Month", "Dormant Account Fee", 25);
    // An allowance before the price is not a free fee.
    const allowance = "Out of Network ATM Withdrawals ..... 5 Free per month,\n$2.50 each additional\n*Unlimited Free Withdrawals at In-Network ATMs.";
    ok(allowance, "Out of Network ATM Withdrawals 5 Free per month", 2.5);
    no("Out of Network ATM Withdrawals ..... 5 Free per month,\n$2.50 each additional", "Out of Network ATM Withdrawals", 0);
    // A fee named inside another row's note, and a qualifier note that is not the fee.
    const drill = "Cost to drill a Safe Deposit Box: Actual cost from Locksmith plus $25.00. (Lost key replacement $75.00)\nMiscellaneous";
    ok(drill, "(Lost key replacement", 75);
    no(drill, "Safe Deposit Box drilling", 75);
    no("Research Fee (hourly fee; 15 minute minimum charge of $10.00) | $40.00", "Research Fee (hourly fee; 15 minute minimum charge of", 10);
  });

  it("reads a box-size grid and a price wrapped under its name one fee per row (Space Coast, Oct 7)", () => {
    const sccu = [
      "Overdraft Privilege (Per item paid)* | $30 | Stop Payment | $15",
      "Returned Check | Verification of Deposit | $20",
      "$30 | (Business/Quality Assurance/Expedited)",
      "(Payable and drawn on same person)",
      "ATMs | Safe Deposit Boxes",
      "Non-SCCU ATM Fee (transaction fee charged by | $2.50 | 3x5 | 5x5 | 3x10 | 5x10 | 10x10",
      "SCCU for using a non-SCCU ATM) | $60 | $80 | $90 | $110 | $185",
      "Replacement Keys/Lock Drilling | Actual cost",
    ].join("\n");
    const check = (name: string, amount: number) => checkFeeAgainstSource(sccu, name, amount, ".").ok;
    expect(check("Returned Check", 30)).toBe(true);
    expect(check("Verification of Deposit", 20)).toBe(true);
    expect(check("Returned Check", 20)).toBe(false);
    expect(check("Verification of Deposit", 30)).toBe(false);
    expect(check("Safe Deposit Box 3x5", 60)).toBe(true);
    expect(check("Safe Deposit Boxes 5x5", 80)).toBe(true);
    expect(check("Safe Deposit Box 10x10", 185)).toBe(true);
    expect(check("Safe Deposit Box 3x5", 80)).toBe(false);
    expect(check("Non-SCCU ATM Fee", 2.5)).toBe(true);
    expect(check("Non-SCCU ATM Fee", 60)).toBe(false);
    // The same wrap on other live schedules (USC CU, Cabrillo CU).
    const usccu = "Legal Process Fee | ValuePlus Money Market | $10\n$35 | Monthly Service Charge if balance below $10,000";
    expect(checkFeeAgainstSource(usccu, "Legal Process Fee", 35, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(usccu, "Legal Process Fee", 10, ".").ok).toBe(false);
    expect(checkFeeAgainstSource(usccu, "Monthly Service Charge if balance below", 35, ".").ok).toBe(false);
    const cabrillo = "Foreign Wire Transfer | Nonsufficient Funds Paid | $14.00\n$35.00 | ATM/Debit Card Nonsufficient Funds Paid";
    expect(checkFeeAgainstSource(cabrillo, "Foreign Wire Transfer", 35, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(cabrillo, "Foreign Wire Transfer", 14, ".").ok).toBe(false);
  });

  it("reads a price with a dash note under its name and a price after an unclosed note (first looks, Oct 7)", () => {
    const dash = "Cashier's Check Fee*\n\n$5.00 - *Service not available to non-customers\n\nMoney Order Fee*\n\n$2.00 - *Service not available to non-customers";
    expect(checkFeeAgainstSource(dash, "Money Order Fee", 2, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(dash, "Money Order Fee", 5, ".").ok).toBe(false);
    const unclosed = "Check Copy (Front and Back and assisted by CU Employee. $2.00 per copy | 3 X 5 ........ $30.00";
    expect(checkFeeAgainstSource(unclosed, "Check Copy (Front and Back and assisted by CU Employee.", 2, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(unclosed, "Check Copy", 30, ".").ok).toBe(false);
  });

  it("never reads the amount a fee is charged on, or a $0 balance condition, as the fee (Chase, U.S. Bank, Oct 7)", () => {
    const chase = "than $50 on Tuesday and you would have been charged a $34 Overdraft Fee on the check.\ntransaction + $60 gasoline transaction). To avoid the $34 Overdraft Fee on the $60 gasoline transaction from";
    expect(checkFeeAgainstSource(chase, "Overdraft Fee on", 60, ".").ok).toBe(false);
    expect(checkFeeAgainstSource(chase, "Overdraft Fee on", 34, ".").ok).toBe(true);
    const usb = "(excluding the Overdraft Paid Fees and\nincluding immediate and same day deposits), is at least $0 we will waive Overdraft Paid Fee(s) charged.";
    expect(checkFeeAgainstSource(usb, "(excluding the Overdraft Paid Fees and including immediate and same day deposits), is at least", 0, ".").ok).toBe(false);
    expect(checkFeeAgainstSource("Overdraft Fee | $0", "Overdraft Fee", 0, ".").ok).toBe(true);
  });

  it("never reads a per-day charge after an account stays overdrawn as the per-item fee (Oct 8)", () => {
    const text = [
      "Notary Fee ........ $15.00 per signature",
      "Overdraft Fee .......... $5.00 per day after 10 business day",
      "Courtesy Pay Fee | $30.00 per item",
      "Sustained Overdraft | $5.00/day after 7th day",
    ].join("\n");
    expect(checkFeeAgainstSource(text, "Overdraft Fee", 5, ".", "overdraft").ok).toBe(false);
    expect(checkFeeAgainstSource(text, "Courtesy Pay Fee", 30, ".", "overdraft").ok).toBe(true);
    expect(checkFeeAgainstSource("Overdraft | $30.00 per day, per account", "Overdraft", 30, ".", "overdraft").ok).toBe(true);
    // Origin's text breaks its lines right after each $10.00, so the row names the charge before
    // its price or continues on the next line.
    const origin = [
      "a $500 overdraft (negative) balance in your account. Normal bank fees and",
      "charges, including returned item charge/overdraft item charge of $35.00 for",
      "each item will be included in the calculation of this limit.",
      "However, we will charge you no more than five overdraft item charges per",
      "day and will not charge an overdraft item charge if your checking account",
      "is overdrawn $5 or less at the end of each business day. The $35.00",
      "overdraft item charge applies to overdrafts created by check, in-person",
      "withdrawal, ATM withdrawal or other electronic means if you opted in to",
      "the authorization and payment of ATM and everyday debit card transactions",
      "(Regulation E). Also, we will charge you an overdrawn account fee of $10.00",
      "on the 5th consecutive business day your account is overdrawn; if your",
      "account is overdrawn for more than 5 consecutive business days, we will",
      "charge an additional $10.00 per week. You acknowledge that the charging",
      "and collection of these charges and fees are not interest or compensation",
    ].join("\n");
    expect(checkFeeAgainstSource(origin, "overdraft item charge applies to overdrafts created by check, in-person withdrawal, ATM withdrawal or other electronic m", 10, ".", "overdraft").ok).toBe(false);
    expect(checkFeeAgainstSource(origin, "charge you no more than five overdraft item charges per day and will not applies to overdrafts created by check, in-pers", 10, ".", "overdraft").ok).toBe(false);
    expect(checkFeeAgainstSource(origin, "charges, including returned item charge/overdraft item charge", 35, ".", "overdraft").ok).toBe(true);
    // A weekly price on its own may be the item fee too (Oct 8).
    const weekly = "Overdraft Fee | $30.00 each week overdrawn\n\n$30.00 per item paid *\n\nReturn Item Fee | $30.00";
    expect(checkFeeAgainstSource(weekly, "Overdraft Fee", 30, ".", "overdraft").ok).toBe(true);
    // Only the per-item categories: a sustained-overdraft fee keeps its own row.
    expect(checkFeeAgainstSource(text, "Sustained Overdraft", 5, ".", "od_sustained").ok).toBe(true);
  });

  it("never reads a balance \"greater than or equal to $0\" as a $0 fee (Citizens, Oct 7)", () => {
    const citizens = "transactions that post to the account that day. If the available balance,\nexcluding the overdraft fees, is positive (greater than or equal to $0)\nat the end of the following business day, any overdraft fees will be\nreversed.";
    expect(checkFeeAgainstSource(citizens, "excluding the overdraft fees, is positive (greater than or equal to", 0, ".", "overdraft").ok).toBe(false);
  });

  it("reads a fee of up to $X as the fee's maximum, and a band before a price as a band (SmartBank, Oct 7)", () => {
    const smartbank = "What You Need to Know about Overdrafts\n• We will charge you a fee of up to $35.00 each time we pay an overdraft.";
    expect(checkFeeAgainstSource(smartbank, "Overdraft Fee", 35, ".", "overdraft").ok).toBe(true);
    expect(checkFeeAgainstSource("- Late Payment Fee Up to $20.00", "Late Payment Fee", 20, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("Non-member check cashing fee up to $4,999.99 | $5.00", "Non-member check cashing fee", 4999.99, ".").ok).toBe(false);
    expect(checkFeeAgainstSource("• Batch Check Scanner Rental Fee | No fee up to $5,000, then $0.30 per", "Batch Check Scanner Rental Fee", 5000, ".").ok).toBe(false);
    expect(checkFeeAgainstSource("refunds worldwide ATM fees up to $25 monthly when qualifications are met", "ATM fees", 25, ".").ok).toBe(false);
    expect(checkFeeAgainstSource("Overdraft Fee | $35 if overdrawn by more than $5", "Overdraft Fee", 5, ".").ok).toBe(false);
  });

  it("gives a two-name row's one price to the second name (First American Bank, Oct 7)", () => {
    const fab = [
      "ACCOUNT SERVICES | CHECK AND STATEMENT SERVICES",
      "Stop Payment | Monthly Statement – Electronic | Free",
      "Via Customer Service | $35.00",
      "Via Online Banking | $30.00 | Monthly Statement – Paper | $5.50",
      "Audit Confirmation or Verification of | Withdrawals at Allpoint & Presto! ATMs | Free",
      "$20.00",
      "Deposit (VOD)",
    ].join("\n");
    expect(checkFeeAgainstSource(fab, "Stop Payment", 0, ".").ok).toBe(false);
    expect(checkFeeAgainstSource(fab, "Audit Confirmation or Verification", 0, ".").ok).toBe(false);
    expect(checkFeeAgainstSource(fab, "Monthly Statement – Electronic", 0, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(fab, "Withdrawals at Allpoint & Presto! ATMs", 0, ".").ok).toBe(true);
  });

  it("reads an add-on rate as the fee's price only when the row prints no other (Oct 8)", () => {
    const reprints = "Account statement reprints (5 page max/$1 each additional page | $4.00";
    expect(checkFeeAgainstSource(reprints, "Account statement reprints (5 page max", 4, "statement").ok).toBe(true);
    expect(checkFeeAgainstSource(reprints, "Account statement reprints (5 page max", 1, "statement").ok).toBe(false);
    expect(checkFeeAgainstSource("ATM Withdrawals (non-LFCU owned ATMs) | 5 free each month, $2.00 each additional", "ATM Withdrawals", 2, "atm").ok).toBe(true);
    expect(checkFeeAgainstSource("Account Research | $25 first hour/$15 each additional hour", "Account Research", 25, "research").ok).toBe(true);
    expect(checkFeeAgainstSource("Gift Cards (per card) | $3.00 Each additional bag $35.00", "Gift Cards (per card)", 3, "gift").ok).toBe(true);
  });

  it("fails a whole price ending in a footnote mark on a page that glues marks onto prices (Oct 8)", () => {
    const page = [
      "Debit Card Payment Fee … $4.951",
      "Returned Mail Fee … $5",
      "Early Account Closure",
      "(Closed Within 180 Days of Opening) …$251 | 1",
      "Stop Payment Order Fee …$28",
    ].join("\n");
    expect(checkFeeAgainstSource(page, "(Closed Within 180 Days of Opening)", 251, "clos").ok).toBe(false);
    expect(checkFeeAgainstSource(page, "Stop Payment Order Fee", 28, "stop").ok).toBe(true);
    expect(checkFeeAgainstSource("Early Account Closure | $251\nWire Fee | $25.00", "Early Account Closure", 251, "clos").ok).toBe(true);
  });

  it("reads a balance or check-size limit as a threshold, not the fee (Darwin audit, Oct 8)", () => {
    const coosa = "Check Cashing Fee (Non-Use of Account) $500.01 - $1,000.00 | $5.00 Each\n\nCheck Cashing Fee (Non-Use of Account) $1,000.01 + | $10.00 Each\n\nCheck Cashing (Non-Use of Account) $1,000.01-Over | $10.00/Each";
    expect(checkFeeAgainstSource(coosa, "Check Cashing Fee (Non-Use of Account)", 1000.01, ".")).toEqual({ ok: false, reason: "amount_is_a_threshold" });
    const dest = "Check Cashing Fee - NON DCU Member | $500 or under = $5.00 (Per Item) $500.01 up to $2,500.00 = $ 15.00 (Per Item)";
    expect(checkFeeAgainstSource(dest, "Check Cashing Fee - NON DCU Member", 500, ".").ok).toBe(false);
    const metairie = "Check Cashing / Non-Customer / On Us Only &lt;$250\nFree\n\nCheck Cashing / Non-Customer / On Us Only ≥$10.000\n$100";
    expect(checkFeeAgainstSource(metairie, "Check Cashing / Non-Customer / On Us Only &lt", 250, ".").ok).toBe(false);
    expect(checkFeeAgainstSource(metairie, "Check Cashing / Non-Customer / On Us Only ≥$10.000", 100, ".").ok).toBe(true);
    const share = "Check Cashing Service fee *Minimum Share account balance of $250.00. *Minimum average monthly checking account balance $500.00.";
    expect(checkFeeAgainstSource(share, "Check Cashing Service fee Minimum Share account balance of", 250, ".").ok).toBe(false);
    expect(checkFeeAgainstSource("Share Savings Below Minimum Balance of $10 | $5", "Share Savings Below Minimum Balance", 10, ".").ok).toBe(false);
    // A price plus costs, and a price for checks up to a face value, stay the fee.
    expect(checkFeeAgainstSource("International Wire Out / $50.00 +", "International Wire Out", 50, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("Garnishment Fee | $100.00 +", "Garnishment Fee", 100, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("Official Checks | Personal Money Orders: $5.00 up to $500 face value.", "Personal Money Orders", 5, ".").ok).toBe(true);
  });

  it("reads a price whose decimal point the PDF dropped as Knox does, so cut cents never trace (#1334)", () => {
    // Members 1st (7517), doc 13851, Oct 15: live fee 29166 and twin 112658 read "$1 50*" as $1.
    const members = [
      "Teller Check | $5 00/check",
      "Money Orders | $2 00/item",
      "Counter Checks (per book of 8) | $10 00*",
      "Debit/ATM/Credit Card Replacement | $15 00*",
      "ATM Transactions (per item) | $1 50* after 8/mo",
      "Bad Address/Returned Mail | $10 00/month",
    ].join("\n");
    expect(checkFeeAgainstSource(members, "ATM Transactions (per item)", 1, ".", "atm_non_network")).toMatchObject({ ok: false });
    expect(checkFeeAgainstSource(members, "ATM Transactions (per item)", 1.5, ".", "atm_non_network").ok).toBe(true);
    expect(checkFeeAgainstSource(members, "Debit/ATM/Credit Card Replacement", 15, ".").ok).toBe(true);
    // Xplore (6636), doc 12872: live fee 49175 and twin 113133 read "$29. 95/ea ch" as $29.
    const xplore = [
      "IRA Annual Maintenance Fee................................................ $10. 00",
      "Legal Proc es s/ Tax Levy...................................................................... $50. 00",
      "Loan Skip A Pay Fee................................................................... $29. 95/ea ch",
      "Account Recon ciliati on/ Res earch Fee (1hr min) .............. $20. 00/hour | Non-Sufficient Funds ...................................................................................... $29.00",
    ].join("\n");
    expect(checkFeeAgainstSource(xplore, "Loan Skip A Pay Fee", 29, ".", "other_lending_fee")).toMatchObject({ ok: false });
    expect(checkFeeAgainstSource(xplore, "Loan Skip A Pay Fee", 29.95, ".", "other_lending_fee").ok).toBe(true);
    expect(checkFeeAgainstSource(xplore, "Non-Sufficient Funds", 29, ".", "nsf").ok).toBe(true);
    expect(checkFeeAgainstSource(xplore, "IRA Annual Maintenance Fee", 10, ".").ok).toBe(true);
  });

  it("reads a negative balance written with a minus sign or dash as the band, not the price (Capitol FCU)", () => {
    // Capitol FCU (8299), doc 6778 and its current copy 20641, Oct 15: both overdraft prices were
    // taken down as thresholds (26152, 26153) and held as untraced on the current copy.
    const page = [
      "Privilege Pay Program++",
      "",
      "Overdrawn NSF Fee | $34.50/item*",
      "",
      "Overdraft Privilege Fee for paid items up to an Avail Balances of negative - $5.00 | $12.50/Item*",
      "",
      "Overdraft Privilege Fee for paid items greater than Avail Balance of negative -$5.00 | $31.00/Item*",
      "",
      "(Check, ACH, ATM/Debit Card Transactions) ++N/A to Freedom Checking",
    ].join("\n");
    const read = (name: string, amount: number) => checkFeeAgainstSource(page, name, amount, ".", "overdraft");
    // A price for a balance band: Darwin and Hamilton count tiered_fee as stated.
    expect(read("Overdraft Privilege Fee for paid items greater than Avail Balance of negative", 31)).toEqual({ ok: false, reason: "tiered_fee" });
    expect(read("Overdraft Privilege Fee for paid items up to an Avail Balances of negative", 12.5)).toEqual({ ok: false, reason: "tiered_fee" });
    // The balance itself is still not a fee.
    expect(read("Overdraft Privilege Fee for paid items up to an Avail Balances of negative", 5).ok).toBe(false);
    expect(read("Overdraft Privilege Fee for paid items up to an Avail Balances of negative", 5)).not.toEqual({ ok: false, reason: "tiered_fee" });
    // Only after "negative": a dash before a price stays a separator.
    expect(checkFeeAgainstSource("Account Below Minimum - $5.00", "Account Below Minimum", 5, ".").ok).toBe(true);
  });

  it("reads a price under a description that ends on the statement label (River City Bank)", () => {
    // River City Bank (268), current copy doc 28947, Oct 15: the $30 overdraft (36542) was taken
    // down as amount_not_the_fee and the current copy's reads (274671, 535317) held as untraced.
    const page = [
      "Outgoing International Wire Transfer Foreign Exchange Fee sent in Foreign Currency",
      "(Fee shown when charged as Wire FX Fee.) This fee is assessed in addition to the Int’l Wire Fee Out shown immediately above.",
      "$30 per wire",
      "Overdraft",
      "If RCB pays an item when your account does not have enough money in your Available Balance1 to cover a transaction. (Fee shown as Overdraft Fee)",
      "$30 for each check, automatic bill payment, ACH debit or recurring debit or similar transaction presented for payment against your account.",
      "NSF (Non-Sufficient Funds) Returned Item",
      "If RCB returns an item when your account does not have enough money in your Available Balance to cover a transaction. (Fee shown as NSF Returned Item Fee)",
      "Maximum of 5 Overdraft and/or NSF Returned Item Fees may be charged per banking day per account.",
      "Excessive Withdrawal Fee",
      "The Bank limits the number of withdrawals and transfers that may be made each calendar month from Savings and Money Market Accounts. See RCB Deposit Account Agreement for specific information. (Fee shown as Service Charge – Total Excessive WD)",
      "$15 for each excessive item.",
    ].join("\n");
    expect(checkFeeAgainstSource(page, "Overdraft: (Fee", 30, ".", "overdraft")).toMatchObject({ ok: true });
    expect(checkFeeAgainstSource(page, "Excessive Withdrawal Fee", 15, ".")).toMatchObject({ ok: true });
    // The NSF entry prints no price of its own; it never takes the overdraft's.
    expect(checkFeeAgainstSource(page, "NSF (Non-Sufficient Funds) Returned Item", 30, ".", "nsf").ok).toBe(false);
    // Without the statement label, a long "$30 for each ..." sentence under a bare name is not its price.
    const bare = "Overdraft\nIf we pay an item when your account does not have enough money to cover a transaction.\n$30 for each check presented against your account.";
    expect(checkFeeAgainstSource(bare, "Overdraft", 30, ".", "overdraft").ok).toBe(false);
  });
});

// #1646: a name stem matches where a word begins, never inside another word.
describe("name words match whole words", () => {
  // Bay Cities' checking comparison (source document 31579) has no Star Checking; "Star" was found in "started".
  const bayCities = [
    "Express Checking For members who want more financial control | 1st Checking Students just getting started, ages 16-24 | Dividend Checking For Members who maintain higher balances and want to earn interest",
    "",
    "Monthly Service Charge | $0 Monthly Service Charge with e-Statements & Direct Deposit $5 Monthly Service Charge with either e-Statements or Direct Deposit $10 Monthly Service Charge without e-Statements or Direct Deposit",
  ].join("\n");

  it("does not find \"Star\" inside \"started\"", () => {
    expect(checkFeeAgainstSource(bayCities, "Star Checking Monthly Fee", 10, ".", "monthly_maintenance").ok).toBe(false);
    expect(checkFeeAgainstSource("Upstart Checking Monthly Fee | $10.00", "Star Checking Monthly Fee", 10, ".").ok).toBe(false);
  });

  it("still finds the name where it is printed", () => {
    expect(checkFeeAgainstSource("Star Checking Monthly Fee | $10.00", "Star Checking Monthly Fee", 10, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("STAR CHECKING - Monthly Fee | $10.00", "Star Checking Monthly Fee", 10, ".").ok).toBe(true);
  });

  it("keeps matching longer words that begin with the stem", () => {
    // Plurals and suffixes: "Stop Payment" in "Stop Payments", "Overdraft" in "Overdrafts".
    expect(checkFeeAgainstSource("Stop Payments | $30.00", "Stop Payment", 30, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("Overdrafts (per item) | $35.00", "Overdraft Fee", 35, ".").ok).toBe(true);
    // A word after punctuation still begins a word ("Non-Sufficient", "(Outgoing").
    expect(checkFeeAgainstSource("Wire Transfer (Outgoing) | $25.00", "Outgoing Wire", 25, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("NSF/Non-Sufficient Funds | $32.00", "Non-Sufficient Funds Fee", 32, ".").ok).toBe(true);
  });

  it("reads a word against a footnote number or run into a label", () => {
    expect(checkFeeAgainstSource("Safe deposit box fees\nFee type | Fee amount\nLost key13 | $18", "Lost key", 18, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("Product/ServiceStop Payments | Fee $30.00\nProduct/ServiceTemporary Checks | Fee $5.00 per set", "Temporary Checks", 5, ".").ok).toBe(true);
  });

  it("reads the name's own words closed up into one", () => {
    expect(checkFeeAgainstSource("Nonsufficient Funds Fee | $32.00", "Non-Sufficient Funds Fee", 32, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("Overlimit Fee | $25.00", "Over Limit Fee", 25, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("Representment Fee | $30.00", "Re-presentment Fee", 30, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("Prepaid Card Reload | $3.00", "Pre-paid Card Reload", 3, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("Debitcard Replacement | $10.00", "Debit Card Replacement", 10, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("Billpay Monthly | $5.00", "Bill Pay Monthly", 5, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("Nonmember ATM Withdrawal | $2.00", "Non-Member ATM Withdrawal", 2, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("Cardholder Replacement | $10.00", "Card Replacement", 10, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("Returned Mailing | $5.00", "Returned Mail", 5, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("after that it's just $4.95 per month, Electronic Bill Payment. Login To Online Account Access Above To Sign Up", "Online Bill Pay", 4.95, ".").ok).toBe(true);
    // Closed-up words still have to be the name's own: "Unpaid" is not "Paid", "Reprint" is not "Print".
    expect(checkFeeAgainstSource("Unpaid Items | $30.00", "Paid Items", 30, ".").ok).toBe(false);
    expect(checkFeeAgainstSource("Statement Reprint | $5.00", "Statement Print", 5, ".").ok).toBe(false);
  });

  it("reads text printed without its spaces", () => {
    // MassMutual FCU (document 16621) and Northpointe (document 128) as their text reads.
    const glued = [
      "Replacelostdebitcard(each)..............$15",
      "Wiretransfers(domestic,outgoing)$20",
      "Officialchecks$2",
      "Stoppayment...........$15",
      "Earlyclosurefee! $10",
      "Canceledcheckcopy $5",
    ].join("\n");
    expect(checkFeeAgainstSource(glued, "Replace Lost Debit Card", 15, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(glued, "Wire Transfers Domestic Outgoing", 20, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(glued, "Official Checks", 2, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(glued, "Stop Payment", 15, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(glued, "Early closure fee", 10, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(glued, "Canceled check copy", 5, ".").ok).toBe(true);
    // Spaced text keeps the rule: "NSF" is not in "transfers".
    expect(checkFeeAgainstSource("Online transfers | $30.00", "NSF Fee", 30, ".").ok).toBe(false);
  });

  it("reads an abbreviation as its one word, and \"-ment\" only after \"Pay\"", () => {
    expect(checkFeeAgainstSource("Regulation D Transfers** | $15.00 Per Item", "Reg D", 15, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("Register D Transfers | $15.00 Per Item", "Reg D", 15, ".").ok).toBe(false);
    expect(checkFeeAgainstSource("Department Fee | $5.00", "Dep Fee", 5, ".").ok).toBe(false);
    expect(checkFeeAgainstSource("Starment Checking Monthly Fee | $10.00", "Star Checking Monthly Fee", 10, ".").ok).toBe(false);
  });

  it("does not find a word inside a longer compound", () => {
    // "Draft" is not the "Overdraft" fee.
    expect(checkFeeAgainstSource("Overdraft Fee | $35.00", "Draft Fee", 35, ".").ok).toBe(false);
  });

  describe("a price under a count-cap note (Gate City Bank 349, doc 13087)", () => {
    // Gate City's schedule as stored (text 503, prod, read-only, Oct 17).
    const GATE_CITY = [
      "Statement Print Service Fee | $5 per statement",
      "Duplicate statement or specific cycle date requests.",
      "Overdraft Fees",
      "Overdraft fee for items paid resulting in a negative",
      "balance.",
      "Maximum of 4 fees per calendar day.",
      "$32 per item",
      "If your account is charged more than four overdraft",
      "Overdraft /Non-Sufficient Funds (NSF) | fees per day, the additional fees will be refunded",
      "within 48 hours. The date the fee is charged is used",
      "to calculate the number of fees charged per day.",
      "BankOn Checking Account Overdraft Fee for items",
      "$0 per item",
      "paid resulting in a negative balance.",
    ].join("\n");

    it("must pass: the price under the name's wrapped last word and the cap note", () => {
      for (const name of ["Overdraft fee for items paid resulting in a negative balance", "Overdraft Fees", "Overdraft Fee"]) {
        expect(checkFeeAgainstSource(GATE_CITY, name, 32, ".", "overdraft")).toMatchObject({
          ok: true,
          sourceLine: "Overdraft fee for items paid resulting in a negative | $32 per item",
        });
      }
    });

    it("must pass: a price one cap-note line under its name", () => {
      const text = "Overdraft Fee\nMaximum of 4 fees per calendar day.\n$32 per item\nStop Payment | $30";
      expect(checkFeeAgainstSource(text, "Overdraft Fee", 32, ".", "overdraft").ok).toBe(true);
      expect(checkFeeAgainstSource("Paid Item Fee\n(Limit 5 items per day)\n$30.00", "Paid Item Fee", 30, ".", "overdraft").ok).toBe(true);
    });

    it("must fail: the note's own figure", () => {
      expect(checkFeeAgainstSource(GATE_CITY, "Overdraft Fees", 4, ".", "overdraft").ok).toBe(false);
      // A note with a dollar figure is a cap, not a count: the price under it is not read through it.
      const dollarCap = "Overdraft Fee\nMaximum of $128 in fees per day.\n$32 per item";
      expect(checkFeeAgainstSource(dollarCap, "Overdraft Fee", 128, ".", "overdraft").ok).toBe(false);
    });

    it("must fail: a balance band under the note", () => {
      const band = "Overdraft Fee\nMaximum of 4 fees per calendar day.\n$50.01 or more";
      expect(checkFeeAgainstSource(band, "Overdraft Fee", 50.01, ".", "overdraft").ok).toBe(false);
    });

    it("must fail: another fee's row under the note", () => {
      const nextRow = "Overdraft Fee\nMaximum of 4 fees per calendar day.\nReturned Item Fee | $30.00";
      expect(checkFeeAgainstSource(nextRow, "Overdraft Fee", 30, ".", "overdraft").ok).toBe(false);
      const nextName = "Overdraft Fee\nMaximum of 4 fees per calendar day.\nNSF Fee\n$30.00";
      expect(checkFeeAgainstSource(nextName, "Overdraft Fee", 30, ".", "overdraft").ok).toBe(false);
      // A sentence that is not a count cap ("Fees are charged per item.") still ends the row.
      expect(checkFeeAgainstSource("Overdraft Fee\nFees are charged per item paid.\n$32", "Overdraft Fee", 32, ".", "overdraft").ok).toBe(false);
    });
  });
});

describe("checkFeeAgainstSource joined prices (Knox v76)", () => {
  const ok = (text: string, name: string, amount: number) => checkFeeAgainstSource(text, name, amount, ".").ok;

  it("traces each slash variant to its own price, and only that one", () => {
    const row = "Domestic Outbound Wires (Online/Manual) | $35/$60 | $35/$60";
    expect(ok(row, "Domestic Outbound Wires (Online)", 35)).toBe(true);
    expect(ok(row, "Domestic Outbound Wires (Manual)", 60)).toBe(true);
    expect(ok(row, "Domestic Outbound Wires (Manual)", 35)).toBe(false);
    expect(ok(row, "Domestic Outbound Wires (Online)", 60)).toBe(false);
    // A name keeping both variants reads the first price, as before.
    expect(ok(row, "Domestic Outbound Wires (Online/Manual)", 35)).toBe(true);
    expect(ok(row, "Domestic Outbound Wires (Online/Manual)", 60)).toBe(false);
  });

  it("traces the second price of a slash pair to the words after it", () => {
    const row = "Debit Card Replacement Fee | $10.00 / $50 expedited delivery";
    expect(ok(row, "Debit Card Replacement Fee expedited delivery", 50)).toBe(true);
    expect(ok(row, "Debit Card Replacement Fee", 10)).toBe(true);
    expect(ok(row, "Debit Card Replacement Fee", 50)).toBe(false);
  });

  it("traces both column prices of a box size", () => {
    expect(ok("2” x 5” $45.00 $65.00", "2” x 5”", 45)).toBe(true);
    expect(ok("2” x 5” $45.00 $65.00", "2” x 5”", 65)).toBe(true);
    expect(ok("Monthly Fee $5.00 $10.00", "Monthly Fee", 10)).toBe(false);
  });

  it("reads No Cost and No fees as free words", () => {
    expect(ok("Notary Public Services | No Cost to Members", "Notary Public Services", 0)).toBe(true);
  });

  it("reads a waiver sentence's otherwise price as the fee, not a balance tier", () => {
    // Capital City Bank (institution 323), live fee 140267: agent_source_texts for source_document_id 31376.
    const page = [
      "Everyday Checking Content",
      "",
      "Everyday Checking",
      "",
      "Access and convenience with a straightforward account.",
      "",
      "Features and benefits:",
      "",
      "No monthly service charge with either 20 debit card transactions* OR a minimum daily balance of $1,500; otherwise, $8.95 per month",
      "",
      "Free e-statements**",
      "",
      "No per-check charge+",
      "",
      "Only $50 minimum opening deposit",
    ].join("\n");
    const read = (amount: number) =>
      checkFeeAgainstSource(page, "Monthly service charge (Everyday Checking)", amount, ".", "monthly_maintenance");
    expect(read(8.95).ok).toBe(true);
    // The waiving balance is still not the fee.
    expect(read(1500).ok).toBe(false);
    const waived = "Monthly Maintenance Fee | waived with a $500 minimum daily balance, if not $6.00";
    expect(checkFeeAgainstSource(waived, "Monthly Maintenance Fee", 6, ".").ok).toBe(true);
  });

  it("takes a row's category word from its own section heading, not from an earlier section (#1835)", () => {
    // Capital City Bank (institution 323), live fee 69700: agent_source_texts 1418 for source_document_id 13900,
    // each price printed under its fee's name, so "Wire Transfers" sits six lines above the incoming fee.
    const page = [
      "Online Banking Bank-to-Bank (External) Transfers", "Outbound: External Bank-to-Bank Transfer Fee", "$2",
      "Returned Bank-to-Bank Transfer Fee", "$6",
      "Wire Transfers", "Outgoing Domestic Fee", "$35", "Outgoing International Fee", "$75",
      "Incoming Domestic Fee", "$25", "Incoming International Fee", "$25", "Returned Wire Fee", "$25",
      "Wire Transfer Confirmation Fee", "$5",
      "Collection Services", "Incoming Domestic Item Fee", "$20", "Incoming International Item Fee", "$20",
    ].join("\n\n");
    for (const key of [undefined, "wire_domestic_incoming"]) {
      expect(checkFeeAgainstSource(page, "Wire Transfers: Incoming Domestic Fee", 25, "wire", key)).toEqual({
        ok: true,
        sourceLine: "Incoming Domestic Fee | $25",
      });
    }
    // A heading further up belongs to an earlier section: a fax fee filed as an ATM fee stays out.
    const fees = [
      "ATM Service Charge", "First Bank ATMs | No charge", "All other ATMs | $1.50 per withdrawal and/or per inquiry",
      "Check Cashing Fee (Customers) | No charge", "(We do not cash checks for non-customers)",
      "Check Printing | Prices vary", "Faxes – | Outgoing | $4.00 for first page",
    ].join("\n\n");
    expect(checkFeeAgainstSource(fees, "ATM Service Charge: Outgoing", 4, "atm")).toEqual({ ok: false, reason: "category_not_in_text" });
  });

  it("quotes the fee's own row, not an earlier line at the same price for another fee", () => {
    // Hancock Whitney, live fee 66419: agent_source_texts for source_document_id 19615.
    const page = [
      "made at a financial center or ATM do | calendar days, you agree to pay one",
      "not qualify as a direct deposit. | Sustained Overdraft Fee of $36.00. This",
      "fee is separate from and may be charged",
      "in addition to the Overdraft Fee or NSF Fee",
      "which may be charged on each individual",
      "NSF item.",
      "",
      "Other Fees for Commonly Used Services",
      "The following fees may be assessed against your account:",
      "Levies/Garnishments | $75.00",
      "On Us Check Cashing Fee** | $9.00",
      "Overdraft Charge/Overdraft Fee (each item) | $36.00",
      "Nonsufficient Funds Charge (NSF Charge or NSF Fee) each item | $36.00",
      "Returned Deposit Item Fee (Chargeback) | $9.00",
      "Stop Payment Fee | $36.00",
      "Sustained Overdraft Fee | $36.00",
    ].join("\n");
    // Read with no category key (report rules, account-type hold) and with one.
    for (const key of [undefined, "overdraft"]) {
      expect(checkFeeAgainstSource(page, "Overdraft Charge/Overdraft Fee (each item)", 36, ".", key)).toEqual({
        ok: true,
        sourceLine: "Overdraft Charge/Overdraft Fee (each item) | $36.00",
      });
    }
    // The sustained fee itself still quotes a sustained line.
    const sustained = checkFeeAgainstSource(page, "Sustained Overdraft Fee", 36, ".", "continuous_od");
    expect(sustained.ok && /Sustained Overdraft Fee/.test(sustained.sourceLine)).toBe(true);
  });

  it("still reads a price per balance band as tiered", () => {
    const banded = "Monthly Service Charge | Balance under $500 | $15.00";
    expect(checkFeeAgainstSource(banded, "Monthly Service Charge", 15, ".")).toEqual({ ok: false, reason: "tiered_fee" });
    // A band's price followed by "otherwise no charge" is still that band's price.
    const bandThenFree = "Monthly Service Charge balance below $1,500 $8.95; otherwise no charge";
    expect(checkFeeAgainstSource(bandThenFree, "Monthly Service Charge", 8.95, ".")).toEqual({ ok: false, reason: "tiered_fee" });
    // "otherwise" with no waiver before it is a band schedule's last band.
    const lastBand = "Monthly Service Charge | balance of $1,000 or more, otherwise $10.00";
    expect(checkFeeAgainstSource(lastBand, "Monthly Service Charge", 10, ".")).toEqual({ ok: false, reason: "tiered_fee" });
  });
});
