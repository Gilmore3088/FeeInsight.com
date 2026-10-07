import { describe, expect, it } from "vitest";
import { checkFeeAgainstSource, joinLabeledFeeCards } from "./source-check";

describe("checkFeeAgainstSource layouts", () => {
  it("reads a price printed under its fee's name", () => {
    const text = "Overnight Courier Service\n$50.00\n/Item";
    expect(checkFeeAgainstSource(text, "Overnight Courier Service", 50, ".").ok).toBe(true);
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
});
