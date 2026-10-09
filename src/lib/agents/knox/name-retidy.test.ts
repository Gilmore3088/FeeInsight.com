import { describe, expect, it } from "vitest";

import type { LiveFeeRow } from "@/lib/agents/hamilton/source-check";
import { capitalisedName, junkStrippedName, pageCompletedName, publishCutName, thresholdFromPage, cellName, dropsCondition, restoredName, restoreOnPage, fontDecodedName, fontMapVerified, headName, isMessyName, spacedControlName, planRetidy, sharedNameFeeIds, accountHeading, neighbourCellName, conditionOnlyName, unligatedName, restoreStrippedAmount, retidiedFeeName, withoutWaiverAdvice } from "@/lib/agents/knox/name-retidy";

const fee = (overrides: Partial<LiveFeeRow>): LiveFeeRow => ({
  fee_published_id: 1,
  lineage_ref: 1,
  fee_raw_id: 1,
  institution_id: 7,
  source: "knox",
  source_document_id: 70,
  canonical_fee_key: "stop_payment",
  fee_name: "Stop Payment | Item",
  amount: 35,
  ...overrides,
});

describe("retidiedFeeName", () => {
  it("drops the unit cell after the name", () => {
    expect(retidiedFeeName("Stop Payment | Item", "stop_payment")).toBe("Stop Payment");
    expect(retidiedFeeName("Non-Sufficient Funds Fee | each presentment", "nsf")).toBe("Non-Sufficient Funds Fee");
    expect(retidiedFeeName("Temporary Checks | 4 checks", "counter_check")).toBe("Temporary Checks");
  });

  it("takes the fee cell when the previous row's text ran in", () => {
    expect(retidiedFeeName("/mo. | Dormant Fee (no member activity for 24 months)", "dormant_account")).toBe(
      "Dormant Fee (no member activity for 24 months)",
    );
    expect(retidiedFeeName("Bank of America | Monthly maintenance fee", "monthly_maintenance")).toBe("Monthly maintenance fee");
  });

  it("drops the words that led into the price", () => {
    expect(retidiedFeeName("An overdraft fee of", "overdraft")).toBe("Overdraft fee");
    expect(retidiedFeeName("Monthly Service Charge is", "monthly_maintenance")).toBe("Monthly Service Charge");
  });

  it("keeps a name that is a condition or a sentence", () => {
    expect(retidiedFeeName("maintenance fee | None with e-Statement enrollment, otherwise", "estatement_fee")).toBeNull();
    expect(retidiedFeeName("To avoid a Quarterly Maintenance Service Charge of", "monthly_maintenance")).toBeNull();
    expect(retidiedFeeName("I must maintain a minimum balance of", "minimum_balance")).toBeNull();
    expect(retidiedFeeName("Dormant accounts will incur", "dormant_account")).toBeNull();
  });

  it("drops a footnote number glued to the name (v2)", () => {
    expect(retidiedFeeName("Check Cashing Fee1", "check_cashing")).toBe("Check Cashing Fee");
    expect(retidiedFeeName("Overdraft Fee5 (per paid item)", "overdraft")).toBe("Overdraft Fee (per paid item)");
    expect(retidiedFeeName("Insufficient Funds (for items $100.00 or more)1,2,3", "nsf")).toBe(
      "Insufficient Funds (for items $100.00 or more)",
    );
    expect(retidiedFeeName("Overdraft – paid per day per account11", "overdraft")).toBe("Overdraft – paid per day per account");
  });

  it("drops the footnote number from a long name the full tidy leaves alone (v3)", () => {
    expect(
      retidiedFeeName(
        "Overdraft Protection Transfer Fee4 (from Line of Credit Advance in Increments of $100.00)",
        "od_protection_transfer",
      ),
    ).toBe("Overdraft Protection Transfer Fee (from Line of Credit Advance in Increments of $100.00)");
  });

  it("repairs a cut-off parenthesis and a doubled word (v4)", () => {
    expect(retidiedFeeName("Account Research Research", "account_research")).toBe("Account Research");
    expect(retidiedFeeName("Consumer, Inactivity Fee (Notification sent at 10", "dormant_account")).toBe(
      "Consumer, Inactivity Fee",
    );
    expect(retidiedFeeName(" Overdraft Protection Sweep Fee (per sweep)", "od_protection_transfer")).toBe(
      "Overdraft Protection Sweep Fee (per sweep)",
    );
  });

  it("drops a price's unit left on the front of the name and a ')' cut from its '(' (v5, 115 live names)", () => {
    expect(retidiedFeeName("/month service charge", "monthly_maintenance")).toBe("service charge");
    expect(retidiedFeeName("/ per item Photocopies", "document_reproduction")).toBe("Photocopies");
    expect(retidiedFeeName("/Money Order", "money_order")).toBe("Money Order");
    expect(retidiedFeeName("/item Stop Payment - Draft, ACH, NSF Draft", "stop_payment")).toBe("Stop Payment - Draft, ACH, NSF Draft");
    expect(retidiedFeeName("Bill Payment Service)", "bill_pay")).toBe("Bill Payment Service");
    // A condition or a cut tail is not a name; it stays as it is for Knox to re-read.
    expect(retidiedFeeName("/ ea.; Active if Bill Pay or Zelle are used monthly)", "bill_pay")).toBeNull();
    expect(retidiedFeeName("/Inactive for 1 year)", "dormant_account")).toBeNull();
    expect(isMessyName("/month service charge")).toBe(true);
    expect(isMessyName("Bill Payment Service)")).toBe(true);
  });

  it("repairs the cut-off shapes (v6: 292 of 1,125 live cut-off names on 2026-10-09)", () => {
    // Accuracy's two and Ambler's (in the public sample report): a sentence ending at its own price.
    expect(retidiedFeeName("Inactive fee: This account may be subject to an Inactive fee of", "dormant_account")).toBe("Inactive fee");
    expect(retidiedFeeName("to open the account. A Maintenance Service Charge of", "monthly_maintenance")).toBe("Maintenance Service Charge");
    expect(retidiedFeeName("Our overdraft fee of", "overdraft")).toBe("Overdraft fee");
    expect(retidiedFeeName("AFTER SUCH TIME YOU WILL BE CHARGE A MONTHLY FEE OF", "monthly_maintenance")).toBe("Monthly Fee");
    expect(retidiedFeeName("1Accounts will be charged the standard Overdraft fee of", "overdraft")).toBe("Overdraft fee");
    // The sample report's three (Customers Bank 84015, Wells Fargo 68707, UEFCU 55904).
    expect(retidiedFeeName("at all times. If you do not, a monthly fee of", "monthly_maintenance")).toBe("Monthly fee");
    expect(retidiedFeeName("Our overdraft fee for Consumer checking accounts is", "overdraft")).toBe("Overdraft fee");
    expect(retidiedFeeName("minimum daily balance is required to avoid a monthly minimum balance fee of", "minimum_balance")).toBe("Monthly minimum balance fee");
    expect(retidiedFeeName("Per hour for assistance with statement reconciliation – with a minimum charge of", "account_research")).toBeNull();
    // A column header glued on either end, and a condition in parentheses.
    expect(
      retidiedFeeName("Charge Return Statement or Dormant Account Monthly Fee (Dormant Account Fee assessed after 12 months of inactivity.) | F", "dormant_account"),
    ).toBe("Return Statement or Dormant Account Monthly Fee");
    expect(retidiedFeeName("Fee Wire Transfer In", "wire_domestic_incoming")).toBe("Wire Transfer In");
    expect(retidiedFeeName("Charge Stop Payment Fee", "stop_payment")).toBe("Stop Payment Fee");
    // A condition clause, a dangling range or unit, a list bullet, a sentence cell.
    expect(retidiedFeeName("service charge per month if balance drops below", "monthly_maintenance")).toBe("Service charge");
    expect(retidiedFeeName("Service Charge Charged If Minimum Balance Is Not Met", "monthly_maintenance")).toBe("Service Charge");
    expect(retidiedFeeName("paper statement fee is waived if enrolled in eStatements", "paper_statement")).toBe("Paper statement fee");
    expect(retidiedFeeName("Late Fee | Up to", "late_payment")).toBe("Late Fee");
    expect(retidiedFeeName("NSF fee (ACH, ATM, or check) - per", "nsf")).toBe("NSF fee (ACH, ATM, or check)");
    expect(retidiedFeeName("+Returned Item Fee – per item returned", "deposited_item_return")).toBe("Returned Item Fee – per item returned");
    expect(retidiedFeeName("Stop Payment CU Check | Charged when the CU places a stop payment on a CU issued check prior to 10 business days from is", "stop_payment")).toBe(
      "Stop Payment CU Check",
    );
    expect(retidiedFeeName("Closing of an account | If an account is closed within 6 months of the opening date, a service charge of", "early_closure")).toBe(
      "Closing of an account",
    );
  });

  it("keeps a cut-off name that no rule can turn into a fee's name (v6)", () => {
    expect(retidiedFeeName("Charge Back Fee", "deposited_item_return")).toBeNull();
    expect(retidiedFeeName("Charge Backs (Deposited Items Returned)", "deposited_item_return")).toBeNull();
    expect(retidiedFeeName("Fee Amount", "late_payment")).toBeNull();
    expect(retidiedFeeName("GUASFCU charges a", "check_image")).toBeNull();
    expect(retidiedFeeName("If your card is lost/stolen, you may receive a replacement card for a fee of", "card_replacement")).toBeNull();
    expect(retidiedFeeName("Dormant Account: Checking accounts are considered dormant when inactive for a period of one (1) year.", "dormant_account")).toBeNull();
    expect(retidiedFeeName("+ Inactive for 1 year", "dormant_account")).toBeNull();
    expect(retidiedFeeName("Fee if acct. closed within 3 months opening", "early_closure")).toBeNull();
  });

  it("leaves a tidy name alone", () => {
    expect(retidiedFeeName("Stop Payment", "stop_payment")).toBeNull();
    expect(retidiedFeeName("Overdraft – paid per day per account", "overdraft")).toBeNull();
  });
});

describe("isMessyName", () => {
  it("matches the v6 cut-off shapes", () => {
    for (const name of [
      "+ drilling cost",
      "Fee Wire Transfer In",
      "Our overdraft fee of",
      "Service Charge if balance falls below",
      "Late Fee | Up to",
      "You will be charged a monthly service fee of",
    ]) {
      expect(isMessyName(name), name).toBe(true);
    }
    expect(isMessyName("Charge Back Fee")).toBe(false);
  });

  it("matches joined cells, a dangling lead-in and a run-on", () => {
    expect(isMessyName("Stop Payment | Item")).toBe(true);
    expect(isMessyName("Replacement card fee of")).toBe(true);
    expect(isMessyName("x".repeat(81))).toBe(true);
    expect(isMessyName("Stop Payment")).toBe(false);
    expect(isMessyName("Paid NSF Item1")).toBe(true);
    expect(isMessyName("Account Research Research")).toBe(true);
    expect(isMessyName("Early Account Closure (by Extraco – no")).toBe(true);
    expect(isMessyName(" Overdraft Protection Sweep Fee (per sweep)")).toBe(true);
    expect(isMessyName("Early Account Closure (by customer)")).toBe(false);
    expect(isMessyName("Safe deposit box 10x10")).toBe(false);
    expect(isMessyName("W2 copy")).toBe(false);
  });
});

describe("planRetidy", () => {
  const text = { source_document_id: 70, normalized_text: "Stop Payment $35.00 per item\nOverdraft fee $30.00" };

  it("renames when the new name still traces in the fee's own schedule", () => {
    const plan = planRetidy([fee({})], [text]);
    expect(plan.renames).toEqual([
      expect.objectContaining({ feePublishedId: 1, oldName: "Stop Payment | Item", newName: "Stop Payment" }),
    ]);
  });

  it("renames a footnoted name that the schedule prints with its footnote", () => {
    const own = { source_document_id: 70, normalized_text: "Check Cashing Fee1. . . . . . . . $5.00 per item" };
    const plan = planRetidy([fee({ fee_name: "Check Cashing Fee1", canonical_fee_key: "check_cashing", amount: 5 })], [own]);
    expect(plan.renames.map((rename) => rename.newName)).toEqual(["Check Cashing Fee"]);
  });

  it("never makes a traced fee untraceable", () => {
    const own = { source_document_id: 70, normalized_text: "Courtesy Pay Fee | Check Copy $3.00" };
    const plan = planRetidy([fee({ fee_name: "Courtesy Pay Fee | Check Copy", canonical_fee_key: "check_image", amount: 3 })], [own]);
    expect(plan.renames.map((rename) => rename.newName)).toEqual(["Check Copy"]);
    expect(plan.skipped.would_not_trace).toBe(0);
  });

  it("never gives two live fees of a bank the same name, price and category", () => {
    const twin = fee({ fee_published_id: 2, fee_name: "Stop Payment" });
    const plan = planRetidy([fee({})], [text], [fee({}), twin]);
    expect(plan.renames).toHaveLength(0);
    expect(plan.skipped.same_name_live).toBe(1);
  });
});

describe("v7: stored names Knox v57/v60 would read differently", () => {
  const text = (normalized_text: string) => [{ source_document_id: 70, normalized_text }];

  it("puts a cut threshold figure back from the fee's own text (101115, 102568)", () => {
    expect(restoreStrippedAmount("Cashier's Checks ( and Over)", ["Cashier's Checks ($10,000.01 and Over) | $10.00"])).toBe(
      "Cashier's Checks ($10,000.01 and Over)",
    );
    expect(
      restoreStrippedAmount("Inactive and Low Balance Account (Inactive for 12 months and balances of less than )", [
        "Inactive and Low Balance Account (Inactive for 12 months and balances of less than $500.00) $5.00",
      ]),
    ).toBe("Inactive and Low Balance Account (Inactive for 12 months and balances of less than $500.00)");
    expect(restoreStrippedAmount("Classic Money Market Account (balance below", ["Classic Money Market Account (balance below $1,000) | $5.00"])).toBe(
      "Classic Money Market Account (balance below $1,000)",
    );
    expect(restoreStrippedAmount("Cashier's Checks ( and Over)", ["Cashier's Checks and Over $10.00"])).toBeNull();
    expect(restoreStrippedAmount("Stop Payment", ["Stop Payment $30"])).toBeNull();
  });

  it("renames a stored name with its threshold back, and only while it traces", () => {
    const row = fee({ canonical_fee_key: "cashiers_check", fee_name: "Cashier's Checks ( and Over)", amount: 10 });
    expect(isMessyName(row.fee_name)).toBe(true);
    expect(planRetidy([row], text("Cashier's Checks ($10,000.01 and Over) | $10.00")).renames.map((rename) => rename.newName)).toEqual([
      "Cashier's Checks ($10,000.01 and Over)",
    ]);
  });

  it("drops a \"Name\" column label (Maple FCU)", () => {
    const rows = ["Stop Payment", "NSF", "Tax Levy"].map((name, index) =>
      fee({ fee_published_id: index + 1, canonical_fee_key: "stop_payment", fee_name: `Name ${name}`, amount: 25 + index }),
    );
    const page = text("Name Stop Payment | Fee $25.00\nName NSF | Fee $26.00\nName Tax Levy | Fee $27.00");
    expect(planRetidy([rows[0]], page, rows).renames[0]?.newName).toBe("Stop Payment");
    expect(isMessyName("Name Change Fee")).toBe(false);
  });

  it("drops a \"Name\" label before an address fee (Maple 102394)", () => {
    const row = fee({ canonical_fee_key: "account_research", fee_name: "Name Bad Address", amount: 5 });
    const page = text("Name Bad Address | Fee $5.00");
    expect(planRetidy([row], page).renames[0]?.newName).toBe("Bad Address");
  });

  it("drops a leading \"Otherwise,\" only when what is left is a name", () => {
    const page = text("Otherwise, a monthly service fee of $6.95.\nOtherwise, the monthly service charge is only $15.00.");
    const named = fee({ canonical_fee_key: "monthly_maintenance", fee_name: "Otherwise, a monthly service fee", amount: 6.95 });
    const sentence = fee({ fee_published_id: 2, canonical_fee_key: "monthly_maintenance", fee_name: "Otherwise, the monthly service charge is only", amount: 15 });
    expect(planRetidy([named, sentence], page).renames.map((rename) => [rename.feePublishedId, rename.newName])).toEqual([[1, "Monthly service fee"]]);
  });

  it("drops a dot leader left on a stored name (Wildfire 14754)", () => {
    expect(isMessyName("ATM Adjustment ......................................................")).toBe(true);
    expect(isMessyName("Stop Payment…………..……….")).toBe(true);
    expect(isMessyName("ATM Adjustment")).toBe(false);
    const atm = fee({ canonical_fee_key: "atm_non_network", fee_name: "ATM Adjustment ......................................................", amount: 5 });
    const leader = fee({ fee_published_id: 2, canonical_fee_key: "stop_payment", fee_name: "Stop Payment…………..……….", amount: 30 });
    const page = text("ATM Adjustment ...................................................... $5.00\nStop Payment…………..………. $30.00");
    expect(planRetidy([atm, leader], page).renames.map((rename) => rename.newName)).toEqual(["ATM Adjustment", "Stop Payment"]);
  });

  it("drops an account heading read onto another fee's name, but never a business one", () => {
    const skip = fee({ canonical_fee_key: "skip_a_pay", fee_name: "PERSONAL CHECKING ACCOUNT FEES | Skip-a-Pay", amount: 35 });
    const box = fee({
      fee_published_id: 2,
      canonical_fee_key: "safe_deposit_box",
      fee_name: "Freedom Checking: Pinnacle Checking: Safe Deposit Box Rental begins at",
      amount: 12,
    });
    const page = text("LOAN FEES\nSkip-a-Pay | $35.00\nSafe Deposit Box Rental begins at $12.00");
    const renames = planRetidy([skip, box], page).renames.map((rename) => rename.newName);
    expect(renames[0]).toBe("Skip-a-Pay");
    expect(renames[1]).toMatch(/^Safe Deposit Box Rental/);
    // Hamilton's business_schedule check reads a leading "Business" on a name with no "|" or ":":
    // a rename keeps it there, and a heading glued on with "|" still goes (Dirigo 45029).
    const glued = fee({ fee_published_id: 3, canonical_fee_key: "skip_a_pay", fee_name: "BUSINESS CHECKING ACCOUNT FEES | Skip-a-Pay", amount: 35 });
    expect(planRetidy([glued], text("Skip-a-Pay | $35.00")).renames.map((rename) => rename.newName)).toEqual(["Skip-a-Pay"]);
    const business = fee({ fee_published_id: 4, canonical_fee_key: "minimum_balance", fee_name: "Business Checking (per month if average daily balance falls below $500)", amount: 10 });
    expect(planRetidy([business], text("Business Checking (per month if average daily balance falls below $500) $10.00")).renames).toEqual([]);
    // A monthly fee's account heading is its name.
    const monthly = fee({ canonical_fee_key: "monthly_maintenance", fee_name: "Gold Checking: Monthly Fee", amount: 10 });
    expect(planRetidy([monthly], text("Gold Checking: Monthly Fee $10.00")).renames).toEqual([]);
  });
});

describe("v8: advice on how to avoid a fee comes off its name", () => {
  const text = (normalized_text: string) => [{ source_document_id: 70, normalized_text }];
  it("cuts the advice after the fee's name (Chief Wilmington 41372/41373, 44018, 88589, 82125)", () => {
    expect(withoutWaiverAdvice("Stop Payment (Check/ACH) Submit request through Online Banking to avoid this charge")).toBe("Stop Payment (Check/ACH)");
    expect(withoutWaiverAdvice("Card Rush Order Save your card to your mobile wallet for use to avoid the replacement card charge.")).toBe("Card Rush Order");
    expect(withoutWaiverAdvice("Bad Address/Return Mail Fee PLEASE NOTIFY US OF ANY ADDRESS CHANGES TO AVOID THIS FEE")).toBe("Bad Address/Return Mail Fee");
    expect(withoutWaiverAdvice("Dormant Fee of 12 months (excludes minors) In order to avoid this fee, you must complete a transaction")).toBe("Dormant Fee of 12 months (excludes minors)");
    expect(withoutWaiverAdvice("monthly service charge (with many options to avoid fees)[3](#disclaimer)")).toBe("monthly service charge");
    expect(withoutWaiverAdvice("required monthly to avoid closure | International ATM Withdrawal Fee")).toBe("International ATM Withdrawal Fee");
  });

  it("leaves a name that is the requirement itself, or a sentence once cut", () => {
    expect(withoutWaiverAdvice("Minimum Balance Required to avoid service charge")).toBeNull();
    expect(withoutWaiverAdvice("Preauthorized Automatic Transfer to avoid Overdraft Charges")).toBeNull();
    expect(
      withoutWaiverAdvice("MONTHLY FEE: The Primary Account Owner Must Meet One of the Following Monthly Statement Cycle Requirements to Avoid a"),
    ).toBeNull();
    expect(withoutWaiverAdvice("Stop Payment Fee")).toBeNull();
  });

  it("names a fragment by the fee Knox reads today at the same amount, and never tidies around advice", () => {
    const fragment = fee({ canonical_fee_key: "monthly_maintenance", fee_name: "To avoid a Quarterly Maintenance Service Charge of", amount: 5 });
    const label = fee({ fee_published_id: 2, canonical_fee_key: "monthly_maintenance", fee_name: "Minimum balance required to avoid service charge -", amount: 50 });
    const page = text("Minimum opening deposit – $50.00\n\nQuarterly Maintenance Service Charge – $5.00\n\nMinimum balance required to avoid service charge - $50.00");
    expect(planRetidy([fragment, label], page).renames.map((rename) => [rename.feePublishedId, rename.newName])).toEqual([
      [1, "Quarterly Maintenance Service Charge"],
    ]);
    expect(isMessyName("Stop Payment (Check/ACH) Submit request through Online Banking to avoid this charge")).toBe(true);
  });
});

describe("v9: a threshold publish cut off comes back from Knox's own read", () => {
  it("restores 102976 from its raw name when the page words differ from the name", () => {
    const row = {
      ...fee({ canonical_fee_key: "minimum_balance", fee_name: "Service charge (daily balance falls below", amount: 5 }),
      raw_fee_name: "Service charge (daily balance falls below $500)",
    };
    const page = [{ source_document_id: 70, normalized_text: "Monthly Service Fee | $5 per month if daily balance falls below $500 at any time during the month" }];
    expect(planRetidy([row], page).renames.map((rename) => rename.newName)).toEqual(["Service charge (daily balance falls below $500)"]);
    expect(planRetidy([{ ...row, raw_fee_name: null }], page).renames).toEqual([]);
  });
});

describe("v10: a fee's own table cell replaces glued heading cells or a cut word", () => {
  const page = [
    "Minimum and average daily balance requirements are based on ledger | Paper Statement Fee ......................................................................... $3.00",
    "Products | Monthly Maintenance Fee ................................................................ $15.00",
    "We require by contractual agreement a restriction on the number of | Excess Transaction Fee, per each transaction over the limit ........... $10.00",
    "Term of the Certificate of Penalty for funds withdrawn | ATM/Visa Check Card Replacement Fee......................................... $10.00",
    "Deposit | prior to the maturity date: | ATM/Visa Check Card Expedited 2 Day Delivery Fee ..................... $67.00",
    "7 days | 7 days simple interest earned | ATM/Visa Check Card Expedited 3 Day Delivery Fee …………..… $37.00",
    "Platinum Checking | Monthly Maintenance Fee ..... $25.00",
    "Business Checking | Wire Transfer Fee ..... $30.00",
  ].join("\n");

  it("renames City National Bank of Florida's six glued names (100136-100145)", () => {
    const rows: Array<[number, string, string, number]> = [
      [100136, "Minimum and average daily balance requirements are based on ledger: Paper Statement Fee", "paper_statement", 3],
      [100137, "Products: Monthly Maintenance Fee", "monthly_maintenance", 15],
      [100138, "Excess Transaction Fee, per each transaction over t", "account_research", 10],
      [100143, "Term of the Certificate of Penalty for funds withdrawn: ATM/Visa Check Card Replacement Fee", "card_replacement", 10],
      [100144, "Deposit: prior to the maturity date: ATM/Visa Check Card Expedited 2 Day Delivery Fee", "rush_card", 67],
      [100145, "7 days: 7 days simple interest earned: ATM/Visa Check Card Expedited 3 Day Delivery Fee", "rush_card", 37],
    ];
    const fees = rows.map(([id, name, key, amount]) => fee({ fee_published_id: id, institution_id: 76, canonical_fee_key: key, fee_name: name, amount }));
    for (const row of fees) expect(isMessyName(row.fee_name)).toBe(true);
    expect(planRetidy(fees, [{ source_document_id: 70, normalized_text: page }]).renames.map((rename) => [rename.feePublishedId, rename.newName])).toEqual([
      [100136, "Paper Statement Fee"],
      [100137, "Monthly Maintenance Fee"],
      [100138, "Excess Transaction Fee, per each transaction over the limit"],
      [100143, "ATM/Visa Check Card Replacement Fee"],
      [100144, "ATM/Visa Check Card Expedited 2 Day Delivery Fee"],
      [100145, "ATM/Visa Check Card Expedited 3 Day Delivery Fee"],
    ]);
  });

  it("keeps an account's name, a business heading, and a name whose cell is at another price", () => {
    expect(cellName({ fee_name: "Platinum Checking: Monthly Maintenance Fee", canonical_fee_key: "monthly_maintenance", amount: 25 }, [page])).toBeNull();
    expect(cellName({ fee_name: "Business Checking: Wire Transfer Fee", canonical_fee_key: "wire_domestic_outgoing", amount: 30 }, [page])).toBeNull();
    expect(cellName({ fee_name: "Products: Monthly Maintenance Fee", canonical_fee_key: "monthly_maintenance", amount: 5 }, [page])).toBeNull();
  });
});

describe("v11: a sentence name gives way to the short name it opens with", () => {
  const named = (fee_name: string, canonical_fee_key: string) => headName({ fee_name, canonical_fee_key });
  const text = (normalized_text: string) => [{ source_document_id: 70, normalized_text }];

  it("keeps the opening name when the rest describes the fee", () => {
    expect(named("Stop payment order (all items) - Customer must sign and return the stop payment agreement within 14 days", "stop_payment")).toBe(
      "Stop payment order",
    );
    expect(named("Dormant Account Fee: Assessed after two years of no activity on a transaction account", "dormant_account")).toBe("Dormant Account Fee");
    expect(named("Insufficient funds fee (NSF) — returned item fee charged for insufficient or uncollected funds", "nsf")).toBe("Insufficient funds fee");
  });

  it("leaves names whose cut words are part of the name", () => {
    expect(named("Overdraft Item (OD) Charge will apply to each item we pay when your end-of-day overdraft balance", "overdraft")).toBeNull();
    expect(named("Safe Deposit Box Yearly Rental (3x4) Only available at our County St. New Bedford Branch", "safe_deposit_box")).toBeNull();
    expect(named("Safe Deposit Box (no new box rentals after Jan. 1, 2023): Annual Fee: 3\" x 5\" box", "safe_deposit_box")).toBeNull();
    expect(named("Inactive account fee for Demand Deposit (Checking) Accounts, NOW Accounts, Super NOW Accounts, Rewards Checking", "dormant_account")).toBeNull();
    expect(named("Stop Payment – Your Checks (Continuous range)", "stop_payment")).toBeNull();
  });

  it("leaves heads that are not names, dated, or lose a business qualifier", () => {
    expect(named("All items returned for non-sufficient funds (NSF) will be charged a fee per item presented", "nsf")).toBeNull();
    expect(named("PAPER STATEMENT FEE EFFECTIVE JULY 1, 2016: a fee will be charged for each paper statement mailed", "paper_statement")).toBeNull();
    expect(named("Excess Transactions - per item over six per month on business savings and money market accounts", "account_research")).toBeNull();
    expect(named("Texans ATM – an ATM that prominently displays Transaction in US, ATM Withdrawal Service the Texans Credit Union", "atm_non_network")).toBeNull();
  });

  it("leaves a head when the rest is another fee glued on", () => {
    expect(
      named("Wire Transfer- Foreign (1) Accounts with no owner-initiated debits or credits for 11 months will be charged a Fee equal", "wire_intl_outgoing"),
    ).toBeNull();
  });

  it("renames only when no other live fee at the institution opens with the same words", () => {
    const page = text(
      "Monthly Maintenance Fee (Use your debit card 15 or more times per month and we'll waive the monthly fee.) $5.95\nMonthly Maintenance Fee (for Premier Checking, waived when you keep a balance of $1,500) $10.00",
    );
    const basic = fee({
      canonical_fee_key: "monthly_maintenance",
      fee_name: "Monthly Maintenance Fee (Use your debit card 15 or more times per month and we'll waive the monthly fee.)",
      amount: 5.95,
    });
    const premier = fee({
      fee_published_id: 2,
      canonical_fee_key: "monthly_maintenance",
      fee_name: "Monthly Maintenance Fee (for Premier Checking, waived when you keep a balance of $1,500)",
      amount: 10,
    });
    expect(planRetidy([basic], page, [basic]).renames.map((rename) => rename.newName)).toEqual(["Monthly Maintenance Fee"]);
    expect(planRetidy([basic], page, [basic, premier]).renames).toEqual([]);
  });
});

describe("v12: a PDF font's U+0003 space becomes a space", () => {
  const S = "\u0003";
  const text = (normalized_text: string) => [{ source_document_id: 70, normalized_text }];

  it("renames the name with spaces and still traces it", () => {
    const row = fee({ canonical_fee_key: "check_image", fee_name: `Copy${S}of${S}Check`, amount: 2 });
    const page = text(`Copy${S}of${S}Check | $2.00`);
    const plan = planRetidy([row], page);
    expect(plan.renames.map((rename) => [rename.oldName, rename.newName])).toEqual([[`Copy${S}of${S}Check`, "Copy of Check"]]);
    expect(isMessyName(`Dormant${S}Account`)).toBe(true);
  });

  it("tidies the spaced name like any other", () => {
    const row = fee({ canonical_fee_key: "card_replacement", fee_name: `Card Replacement Fee:${S}`, amount: 10 });
    expect(planRetidy([row], text(`Card Replacement Fee:${S} $10.00`)).renames[0]?.newName).toBe("Card Replacement Fee");
    expect(spacedControlName(`Non\u0332Sufficient${S}Funds${S}(NSF)${S}Return`)).toBe("Non-Sufficient Funds (NSF) Return");
  });

  it("never guesses a figure from the font's other control characters", () => {
    expect(spacedControlName("Minimum Balance (under $\u0014\u001300)")).toBeNull();
    expect(spacedControlName(`Returned Check $\u0015\u0018.00${S}per item`)).toBeNull();
    expect(spacedControlName("Copy of Check")).toBeNull();
  });
});

describe("v13: a shifted font's digits, read back when the document proves its map", () => {
  const S = "\u0003";
  // Meridia CU (doc 6826): shifted words next to the same words in clear.
  const meridia = [
    "ATM & Standard Debit Card Fees / If you have any | Balance Inquiry (Non-Meridia ATMs) | $1.00",
    `Non-Sufficient Funds | New Card Fee | $5.00 / HDFK${S}SUHVHQWPHQW | $34.99${S}HD | Other Service Fees`,
    `Club Savings Account Fees | $FFRXQW${S},QTXLU\\${S} RWKHU${S}WKDQ${S}EDODQFH | $1.00`,
    "Money Market Account Fees | Certified Check, Official Check or Money Order | $1.00",
    "Minimum Balance (under $\u0014\u001300) | $7.50/mo | Clearing Check Unacceptable for Processing | $20.00",
    `Withdrawal Fee | Clearing &DQDGLDQ${S}&KHFN | $\u00180.00 ea`,
    `(ACH & Share Draft)${S} HDFK${S}SUHVHQWPHQW | Legal Process | $100.00`,
  ].join("\n");
  // LFCU (doc 13444): shifted digits, but no shifted word to prove the map.
  const lfcu = "Courtesy Pay Service | $\u0015\u001c.00\nReturned Deposited Check | $\u0015\u0018.00/item\nStop Payment Order - Check, ACH (per item) | $30.00";

  it("trusts a map only when shifted words read as words printed in clear", () => {
    expect(fontMapVerified(meridia)).toBe(true);
    expect(fontMapVerified(lfcu)).toBe(false);
    expect(fontMapVerified("Stop Payment | $30.00")).toBe(false);
    expect(fontDecodedName("Minimum Balance (under $\u0014\u001300)")).toBe("Minimum Balance (under $1000)");
  });

  it("reads 96207's threshold back, and 41496 takes its own cell, under a proven map", () => {
    const page = [{ source_document_id: 70, normalized_text: meridia }];
    const minimum = fee({ fee_published_id: 96207, canonical_fee_key: "minimum_balance", fee_name: "Minimum Balance (under $\u0014\u001300)", amount: 7.5 });
    const legal = fee({ fee_published_id: 41496, canonical_fee_key: "legal_process", fee_name: `(ACH & Share Draft)${S} HDFK${S}SUHVHQWPHQW: Legal Process`, amount: 100 });
    expect(planRetidy([minimum, legal], page).renames.map((rename) => [rename.feePublishedId, rename.newName])).toEqual([
      [96207, "Minimum Balance (under $1000)"],
      [41496, "Legal Process"],
    ]);
  });

  it("leaves a name in place when the document cannot prove the map", () => {
    const page = [{ source_document_id: 70, normalized_text: lfcu }];
    const returned = fee({
      fee_published_id: 19932,
      canonical_fee_key: "deposited_item_return",
      fee_name: "Returned Deposited Check $\u0015\u0018.00/item Stop Payment Order - Check, ACH (per item)",
      amount: 30,
    });
    expect(planRetidy([returned], page).renames).toEqual([]);
  });
});

describe("v13: a font's ligature letters read back as their pairs", () => {
  // MSCU (doc 17227) and Members Source (doc 16925) as stored.
  const mscu = [
    "ATM TransacƟon (@non-MSCU ATM) . . . . . . . . . . . . . . . . . . . . . $1.00 Temporary Check Fee . . . . . . . $1.00 for a sheet of 4",
    "Lost Key Replacement (per key) . . . . . . . . $15.00 | Outgoing Wire – DomesƟc . . . . . . . . . . . . $25.00",
    "Stop Payment . . . . . . . . . $35.00 Loan Refinance OriginaƟon . . . . . . . . . . . . . . . .$25.00",
    "DraŌ/Check Copy . . . . . . . . . . . . . . . . $5.00",
  ].join("\n");
  const page = [{ source_document_id: 70, normalized_text: mscu }];

  it("renames each ligature name and still traces it", () => {
    const rows = [
      fee({ fee_published_id: 56918, canonical_fee_key: "atm_non_network", fee_name: "ATM TransacƟon (@non-MSCU ATM)", amount: 1 }),
      fee({ fee_published_id: 56921, canonical_fee_key: "wire_domestic_outgoing", fee_name: "Outgoing Wire – DomesƟc", amount: 25 }),
      fee({ fee_published_id: 89910, canonical_fee_key: "other_lending_fee", fee_name: "Loan Refinance OriginaƟon", amount: 25 }),
      fee({ fee_published_id: 56927, canonical_fee_key: "check_image", fee_name: "DraŌ/Check Copy", amount: 5 }),
    ];
    expect(planRetidy(rows, page).renames.map((rename) => [rename.feePublishedId, rename.newName])).toEqual([
      [56918, "ATM Transaction (@non-MSCU ATM)"],
      [56921, "Outgoing Wire – Domestic"],
      [89910, "Loan Refinance Origination"],
      [56927, "Draft/Check Copy"],
    ]);
    expect(isMessyName("Account research/reconciliaƟon")).toBe(true);
    expect(unligatedName("Outgoing Wire")).toBeNull();
  });
});

describe("v14: a monthly fee's bare name shared at different prices takes its account's name", () => {
  // Security Federal (722, doc 23994) as stored.
  const page = [
    {
      source_document_id: 70,
      normalized_text: [
        "Personal Checking Accounts That Give You More!",
        "Premium Checking",
        "",
        "Qualify2 to earn 4.00% APY4 on the portion of the daily balance under $10,000.",
        "Account Information",
        "Earn Interest",
        "$2,500 Minimum Deposit to Open",
        "",
        "$15 waivable monthly fee",
        "Maintain a $2,500 daily minimum balance, and we'll waive the monthly fee.",
        "Open Now",
        "High Yield Checking",
        "Qualify2 to earn 4.00% APY4 on the portion of the daily balance under $10,000.",
        "Account Information",
        "Earn Interest",
        "$1,000 Minimum Deposit to Open",
        "$12 waivable monthly fee",
        "Maintain a $1,000 daily minimum balance and we'll waive the monthly fee.",
        "Freedom Checking",
        "$5 monthly fee",
      ].join("\n"),
    },
  ];
  const premium = fee({ fee_published_id: 105086, canonical_fee_key: "monthly_maintenance", fee_name: "waivable monthly fee", amount: 15 });
  const highYield = fee({ fee_published_id: 105087, canonical_fee_key: "monthly_maintenance", fee_name: "waivable monthly fee", amount: 12 });
  const freedom = fee({ fee_published_id: 105088, canonical_fee_key: "monthly_maintenance", fee_name: "Freedom Checking Monthly fee", amount: 5 });

  it("names each shared fee after the account heading above its own price", () => {
    const live = [premium, highYield, freedom];
    expect([...sharedNameFeeIds(live)]).toEqual([105086, 105087]);
    expect(planRetidy([premium, highYield], page, live).renames.map((rename) => [rename.feePublishedId, rename.newName])).toEqual([
      [105086, "Premium Checking waivable monthly fee"],
      [105087, "High Yield Checking waivable monthly fee"],
    ]);
  });

  it("renames none of them when one can't find a heading of its own", () => {
    const twin = { ...page[0], normalized_text: page[0].normalized_text.replace("High Yield Checking", "Qualify for more") };
    // v16: neither takes a heading; each only takes a capital.
    expect(planRetidy([premium, highYield], [twin], [premium, highYield]).renames.map((rename) => rename.newName)).toEqual([
      "Waivable monthly fee",
      "Waivable monthly fee",
    ]);
    expect(accountHeading("monthly fee", 5, ["Compare Checking Accounts\n$5 monthly fee"])).toBeNull();
    expect(accountHeading("monthly fee", 5, ["Freedom Checking\n$50 monthly fee"])).toBeNull();
  });
});

describe("v15: a name that is another line's cell, or only its line's condition", () => {
  const text = (normalized_text: string) => [{ source_document_id: 70, normalized_text }];

  it("drops another line's leading cell and a box size's footnote number", () => {
    const glued = fee({ canonical_fee_key: "safe_deposit_box", fee_name: "(after two years of no activity): Safe Deposit Box Lost Key", amount: 25 });
    const page = text("Dormant Fee (per month) | $ 10.00 | (after 30 days past due)\n(after two years of no activity) | Safe Deposit Box Lost Key | $ 25.00");
    expect(planRetidy([glued], page).renames[0]?.newName).toBe("Safe Deposit Box Lost Key");
    expect(neighbourCellName({ fee_name: "3x10” 8", canonical_fee_key: "safe_deposit_box" })).toBe("3x10”");
    // A glued name whose rest names another fee stays (a wire fee filed as a legal-process fee).
    expect(neighbourCellName({ fee_name: "(tax levies, garnishment, restraining notices): Wire Transfer Fee", canonical_fee_key: "garnishment_levy" })).toBeNull();
    expect(isMessyName("(if closed within 45 days of opening)")).toBe(true);
  });

  it("names a condition-only fee from the cell before it or the line above", () => {
    const closure = fee({ canonical_fee_key: "early_closure", fee_name: "(if closed within 45 days of opening)", amount: 25 });
    const dormant = fee({ canonical_fee_key: "dormant_account", fee_name: "(inactive 12 months)", amount: 15 });
    const page = text("Account Closure Fee\n\n(if closed within 45 days of opening) | $25\n\nIRA Account Closure or Transfer | $25\nDormant Account under $300 (inactive 12 months) | $15.00 per month");
    expect(planRetidy([closure, dormant], page).renames.map((rename) => rename.newName)).toEqual([
      "Account Closure Fee (if closed within 45 days of opening)",
      "Dormant Account under $300 (inactive 12 months)",
    ]);
    expect(conditionOnlyName(fee({ canonical_fee_key: "safe_deposit_box", fee_name: "(Key Replacement)", amount: 70 }), ["Safe Deposit Box Drilling Fee Varies\n(Key Replacement) $70.00"])).toBe("Key Replacement");
  });

  it("leaves a condition-only fee whose page names another fee, for a person", () => {
    const paper = fee({ canonical_fee_key: "monthly_maintenance", fee_name: "(Monthly Fee. Over 55 Free)", amount: 5 });
    expect(planRetidy([paper], text("Paper Statement | (Monthly Fee. Over 55 Free) | $5.00")).renames).toEqual([]);
    const order = fee({ canonical_fee_key: "money_order", fee_name: "(per money order)", amount: 5 });
    expect(planRetidy([order], text("Money Order Fee\nCustomer | $5.00 (per money order)")).renames).toEqual([]);
  });
});

describe("v15: a rename never drops a condition, and v14's trims get theirs back", () => {
  it("finds the conditions UAT saw v14 cut", () => {
    expect(dropsCondition("SAVINGS ACCOUNT: Money Orders (each) & counter checks (after 1st one)", "SAVINGS ACCOUNT: Money Orders (each) & counter checks")).toBe(true);
    expect(dropsCondition("ATM Fee - Cash withdrawal at ATMs we do not own or operate", "ATM Fee")).toBe(true);
    expect(dropsCondition("Dormant Account (if no customer initiated activity for 24 months on checking and savings accounts) per cycle if balance", "Dormant Account")).toBe(true);
    expect(dropsCondition("Returned Item Fee (Savings Account) - A return item may be created by check", "Returned Item Fee")).toBe(true);
    expect(dropsCondition("Dormant account - savings account - per quarter (excludes Student Savings and Christmas Club)", "Dormant account")).toBe(true);
  });

  it("lets a description, a footnote or a full stop go", () => {
    expect(dropsCondition("Overdraft Item Fee (Imposed on overdrafts created by checks, in-person withdrawals, or other electronic means)", "Overdraft Item Fee")).toBe(false);
    expect(dropsCondition("Check Cashing Fee (1)", "Check Cashing Fee")).toBe(false);
    expect(dropsCondition("Check Cashing Fee1", "Check Cashing Fee")).toBe(false);
    expect(dropsCondition("service charge.", "service charge")).toBe(false);
    expect(dropsCondition("Maintenance Fee", "Loyalty Checking Maintenance Fee")).toBe(false);
  });

  it("puts the old name back, cut to its last whole clause when publish cut it off", () => {
    expect(restoredName("SAVINGS ACCOUNT: Money Orders (each) & counter checks (after 1st one)", "SAVINGS ACCOUNT: Money Orders (each) & counter checks")).toBe(
      "SAVINGS ACCOUNT: Money Orders (each) & counter checks (after 1st one)",
    );
    expect(
      restoredName(
        "Dormant Account Fee - No customer activity for 1 year - This monthly fee will be imposed after your first dormancy notic",
        "Dormant Account Fee",
      ),
    ).toBe("Dormant Account Fee - No customer activity for 1 year");
    expect(
      restoredName("Dormant Account (if no customer initiated activity for 24 months on checking and savings accounts) per cycle if balance", "Dormant Account"),
    ).toBe("Dormant Account (if no customer initiated activity for 24 months on checking and savings accounts)");
    expect(restoredName("Dormant Account Fee - Checking Accounts. A Checking account is dormant if for one", "Dormant Account Fee")).toBe(
      "Dormant Account Fee - Checking Accounts",
    );
    // A removed fee, an optional add-on the guard takes down, or a condition cut before its end stays off.
    expect(restoredName("Mobile Deposit - per check deposited fee has been removed (Data Charges May Apply)", "Mobile Deposit")).toBeNull();
    expect(restoredName("Accidental Death Insurance (Monthly fee", "Accidental Death Insurance")).toBeNull();
    expect(restoredName("ID TheftSmart Fee (monthly fee, per person enrolled - customer can choose to pay a", "ID TheftSmart Fee")).toBeNull();
    expect(restoredName("Counter Checks : 1st 6 are free then", "Counter Checks")).toBeNull();
    expect(restoredName("Overdraft Item Fee (Imposed on overdrafts created by checks, in-person withdrawals, or other electronic means)", "Overdraft Item Fee")).toBeNull();
    expect(restoredName("Mobile Deposit: ability to deposit checks 24/7 via your smart phone", "Mobile Deposit")).toBeNull();
    // An account heading on an account-bound fee names the account it applies to.
    expect(restoredName("Performance Interest Checking: Inactive fee (per month)", "Inactive fee (per month)", "dormant_account")).toBe(
      "Performance Interest Checking: Inactive fee (per month)",
    );
    expect(restoredName("PERSONAL CHECKING ACCOUNT FEES | Skip-a-Pay", "Skip-a-Pay", "skip_a_pay")).toBeNull();
    // Another row's cell, a sentence the name was cut from, or a figure publish cut out stays off.
    expect(restoredName("per item | Stop payment ACH", "Stop payment ACH", "stop_payment")).toBeNull();
    expect(restoredName("Please note that after 180 days of inactivity, you will be charged a monthly inactivity fee", "Monthly inactivity fee")).toBeNull();
    expect(restoredName("service charge if minimum balance is or less", "Service charge", "monthly_maintenance")).toBeNull();
    expect(restoredName("Monthly fee if account balance falls", "Monthly fee", "monthly_maintenance")).toBeNull();
    expect(restoredName("Service Charge if average balance <", "Service Charge", "monthly_maintenance")).toBeNull();
    expect(restoredName("Monthly Service Charge If Minimum", "Monthly Service Charge", "monthly_maintenance")).toBeNull();
    expect(restoredName("Escheat Fee (Per Member) | Escheat Fee", "Escheat Fee", "escheat_fee")).toBeNull();
    expect(restoredName("Check Cashing Otherwise – Per Check", "Check Cashing", "check_cashing")).toBeNull();
    expect(restoredName("Premier Checking: Printed Statements", "Printed Statements", "paper_statement")).toBe("Premier Checking: Printed Statements");
  });

  it("restores a logged v14 trim, and does not trim a condition off again", () => {
    const atm = fee({ fee_published_id: 47474, canonical_fee_key: "atm_non_network", fee_name: "ATM Fee", amount: 2 });
    const logged = new Map([[47474, { oldName: "ATM Fee - Cash withdrawal at ATMs we do not own or operate", newName: "ATM Fee" }]]);
    const plan = planRetidy([atm], [], [atm], logged);
    expect(plan.renames.map((rename) => [rename.oldName, rename.newName])).toEqual([["ATM Fee", "ATM Fee - Cash withdrawal at ATMs we do not own or operate"]]);
    const restored = { ...atm, fee_name: "ATM Fee - Cash withdrawal at ATMs we do not own or operate" };
    const again = planRetidy([restored], [], [restored], new Map([[47474, { oldName: "ATM Fee", newName: restored.fee_name }]]));
    expect(again.renames).toEqual([]);
  });

  it("an older window's name must print whole on the fee's own page", () => {
    const page = "Inactive Account (After 1 year of no activity) $5.00\nPriority Rush Card Fee (up to 3 business days) $35.00";
    expect(restoreOnPage("Inactive Account (After 1 year of no activity)", [page])).toBe(true);
    expect(restoreOnPage("Priority Rush Card Fee (up to 3 business)", [page])).toBe(false);
    expect(restoreOnPage("Priority Rush Card Fee (up to 3", [page])).toBe(false);
    const inactive = fee({ fee_published_id: 82276, canonical_fee_key: "dormant_account", fee_name: "Inactive Account", amount: 5 });
    const logged = new Map([[82276, { oldName: "Inactive Account (After 1 year of no activity)", newName: "Inactive Account", pageCheck: true }]]);
    expect(planRetidy([inactive], [], [inactive], logged).renames).toEqual([]);
    expect(planRetidy([inactive], [{ source_document_id: 70, normalized_text: page }], [inactive], logged).renames.map((rename) => rename.newName)).toEqual([
      "Inactive Account (After 1 year of no activity)",
    ]);
  });

  it("leaves a condition on a run-on name rather than trimming it", () => {
    const dormant = fee({
      fee_published_id: 92155,
      canonical_fee_key: "dormant_account",
      fee_name: "Dormant Account Fee - No customer activity for 1 year - This monthly fee will be imposed after your first dormancy notice",
      amount: 5,
    });
    const plan = planRetidy([dormant], [], [dormant]);
    expect(plan.renames.map((rename) => rename.newName)).not.toContain("Dormant Account Fee");
  });

  it("reads U+0372 between letters as the font's hyphen", () => {
    expect(spacedControlName("Non\u0372Sufficient\u0003Funds\u0003(NSF)\u0003Return")).toBe("Non-Sufficient Funds (NSF) Return");
  });
});

describe("v16: a name that opens in lower case", () => {
  it("takes a capital, without a list marker, an article or the row above's unit", () => {
    expect(capitalisedName("monthly service charge")).toBe("Monthly service charge");
    expect(capitalisedName("a monthly maintenance fee")).toBe("Monthly maintenance fee");
    expect(capitalisedName("f. Returned Mail Fee")).toBe("Returned Mail Fee");
    expect(capitalisedName("ii. Stop Payment Charge")).toBe("Stop Payment Charge");
    expect(capitalisedName("o A Minimum Balance Fee")).toBe("Minimum Balance Fee");
    expect(capitalisedName("per item Incoming Wire Transfer")).toBe("Incoming Wire Transfer");
    expect(capitalisedName("ea Return Statement Charge (wrong address)")).toBe("Return Statement Charge (wrong address)");
    expect(capitalisedName("monthly service fee (Basic Checking)")).toBe("Monthly service fee (Basic Checking)");
    expect(isMessyName("monthly service charge")).toBe(true);
    expect(capitalisedName("H. The standard overdraft fee")).toBe("Standard overdraft fee");
    expect(capitalisedName("A Minimum Balance fee")).toBe("Minimum Balance fee");
    expect(capitalisedName("The Overdraft Transfer Service Fee")).toBe("Overdraft Transfer Service Fee");
    expect(isMessyName("H. The standard overdraft fee")).toBe(true);
    expect(capitalisedName("A La Carte Services - Bill Pay")).toBeNull();
    expect(capitalisedName("A low monthly service charge of only")).toBeNull();
    expect(capitalisedName("A monthly service fee applies")).toBeNull();
    expect(capitalisedName("A Late Payment Fee in an amount equal to")).toBeNull();
  });

  it("leaves a lower-case brand, a condition, a sentence or another row's cell", () => {
    for (const name of [
      "eCorp Outgoing Wires",
      "i-Pay Bill Payment",
      "of all items presented that day would result in an overdraft of",
      "per month after 6 months of inactivity",
      "monthly service charge; waived with average daily balance",
      "monthly service fee reduced",
      "annually Lost key/box drilling",
      "monthly Levy",
      "other fees lAte fee",
      "ach returned nsf",
      "check/draft/ACH, ACH origination withdrawals, Bill Payment, Audio",
      "if below minimum balance",
      "Monthly service charge",
    ]) {
      expect(capitalisedName(name), name).toBeNull();
    }
  });

  it("renames the live fee even though only its capital changes", () => {
    const plain = fee({ canonical_fee_key: "monthly_maintenance", fee_name: "monthly service charge", amount: 10 });
    expect(planRetidy([plain], []).renames.map((rename) => rename.newName)).toEqual(["Monthly service charge"]);
  });
});

describe("v16: a condition publish cut off Knox's name", () => {
  const cut = { ...fee({ fee_published_id: 107240, canonical_fee_key: "minimum_balance", fee_name: "Minimum Balance Fee", amount: 15 }), raw_fee_name: "Minimum Balance Fee (if Balance is Below $7,500)", retidied: false };
  const page = [{ source_document_id: Number(cut.source_document_id), normalized_text: "Business Checking Plus | Current Fee\n\nMinimum Balance Fee (if Balance is Below $7,500): | $15\n" }];

  it("comes back where the fee's own page prints it whole", () => {
    expect(publishCutName(cut)).toEqual({ oldName: "Minimum Balance Fee (if Balance is Below $7,500)", newName: "Minimum Balance Fee", pageCheck: true });
    expect(planRetidy([cut], page).renames.map((rename) => rename.newName)).toEqual(["Minimum Balance Fee (if Balance is Below $7,500)"]);
    expect(planRetidy([cut], [{ ...page[0], normalized_text: "Minimum Balance Fee | $15" }]).renames).toEqual([]);
  });

  it("leaves a fee retidy renamed, a footnote, a price range or the next line's fee", () => {
    expect(publishCutName({ ...cut, retidied: true })).toBeNull();
    expect(publishCutName({ ...cut, retidied: undefined })).toBeNull();
    expect(restoredName("Overdraft Fee7,8", "Overdraft Fee", "overdraft")).toBeNull();
    expect(restoredName("Cashier’s Check $500.00-$1,000.00", "Cashier’s Check", "cashiers_check")).toBeNull();
    expect(restoredName("(balance falls below $1,000) $15.00 Copy of Check $3.00 (in house)", "(balance falls below $1,000)", "check_image")).toBeNull();
    expect(restoredName("Fax Service: If members need to send or receive a fax, we can help", "Fax Service", "document_reproduction")).toBeNull();
  });
});

describe("v16: UAT's 933 misses", () => {
  it("puts back a threshold cut off the end from the fee's own line", () => {
    const page = [
      "Capitol Plus Money Market Account\n\nAverage Daily Balance above $2,500 | N/A\n\nAverage Daily Balance below $2,500 | $10.00/month\n\nCapitol Business Plus Checking Account\n\nAverage Daily Balance below $2,500 | $25.00/month",
    ];
    expect(thresholdFromPage("Capitol Plus Money Market Account Average Daily Balance below", 10, page)).toBe(
      "Capitol Plus Money Market Account Average Daily Balance below $2,500",
    );
    expect(thresholdFromPage("Capitol Plus Money Market Account Average Daily Balance below", 12, page)).toBeNull();
    expect(isMessyName("Capitol Plus Money Market Account Average Daily Balance below")).toBe(true);
  });

  it("finishes a word Knox cut at its length limit, to the end of its clause", () => {
    const name = "Inactivity Fee - Charged monthly to each savings, checking, and money market account if no activity on any Citadel accou";
    const page = ["$5.00 Inactivity Fee - Charged monthly to each savings, checking, and money market account if no activity on any Citadel account for one year. Waived if one of the following criteria is met:"];
    expect(pageCompletedName(name, page)).toBe(`${name}nt for one year`);
    expect(pageCompletedName(name, ["something else"])).toBeNull();
  });

  it("reads a font's hyphen left after an earlier pass", () => {
    expect(spacedControlName("Non\u0372Sufficient Funds (NSF) Return")).toBe("Non-Sufficient Funds (NSF) Return");
    expect(isMessyName("Non\u0372Sufficient Funds (NSF) Return")).toBe(true);
  });
});

describe("v17 junk glyphs", () => {
  it("cuts a font's leader dots, a dot leader of U+FFFD and a footnote bullet off the end", () => {
    expect(junkStrippedName("Notary Service for members ċċ")).toBe("Notary Service for members");
    expect(junkStrippedName("Skip-a-payment .. ċċċ .ċċċ")).toBe("Skip-a-payment");
    expect(junkStrippedName("Night Depository ċċ.")).toBe("Night Depository");
    expect(junkStrippedName("Copy of statement �����")).toBe("Copy of statement");
    expect(junkStrippedName("Replacement Visa Debit Card ●")).toBe("Replacement Visa Debit Card");
  });

  it("cuts a drawn or symbol-font bullet off the front and drops zero-width spaces", () => {
    expect(junkStrippedName("♦ Paid Overdraft")).toBe("Paid Overdraft");
    expect(junkStrippedName(" Stop Payment Charges")).toBe("Stop Payment Charges");
    expect(junkStrippedName("\u0095 Account Reconciliation")).toBe("Account Reconciliation");
    expect(junkStrippedName("​Dormant Account Fee")).toBe("Dormant Account Fee");
    expect(junkStrippedName("Levies​​​")).toBe("Levies");
    expect(junkStrippedName("● 5 x 10 Box Rent")).toBe("5 x 10 Box Rent");
  });

  it("leaves a glyph inside a name, which stands for a letter, a figure or a cell break", () => {
    expect(junkStrippedName("Paid Check/Dra� Photocopy")).toBeNull();
    expect(junkStrippedName("Outgoing Wire – Domesc including Western Union")).toBeNull();
    expect(junkStrippedName("ACH Wire Transfers � Foreign")).toBeNull();
    expect(junkStrippedName("Outgoing Wire Fee:  Foreign")).toBeNull();
    expect(junkStrippedName("Lost Debit Rewards Card Replacement ��� 1st Free")).toBeNull();
    expect(junkStrippedName("/year ● Late Payment Fee")).toBeNull();
    // A U+FFFD before a name may be a "$"; the same font writes its digits as U+0100-U+0109.
    expect(junkStrippedName("�00/Transaction: Non-Sufficient Funds ���")).toBeNull();
    expect(junkStrippedName("Inactive Account (after āĂ monthsof inactivity) ċċċ")).toBeNull();
    expect(junkStrippedName("\u200b4 ATM Transaction (each)")).toBeNull();
    expect(junkStrippedName("Overdraft Fee")).toBeNull();
  });

  it("renames a junk-glyph name in the plan, and the name is messy", () => {
    expect(isMessyName("Notary Service for members ċċ")).toBe(true);
    const plan = planRetidy(
      [fee({ canonical_fee_key: "notary_fee", fee_name: "Notary Service for members ċċ", amount: 0 })],
      [{ source_document_id: 70, normalized_text: "Notary Service for members ċċ $0.00" }],
    );
    expect(plan.renames.map((rename) => rename.newName)).toEqual(["Notary Service for members"]);
  });
});

describe("condition restores, batches 2 and 3", () => {
  it("keeps the live name's casing and drops a dash left on the end", () => {
    expect(restoredName("monthly fee if requirements are not met", "Monthly fee", "monthly_maintenance")).toBe(
      "Monthly fee if requirements are not met",
    );
  });

  it("leaves markup, a glued list item and a sentence off", () => {
    expect(restoredName("Early closing fee if account closed &lt; 90 days after opening –", "Early closing fee", "early_closure")).toBeNull();
    expect(
      restoredName(
        "Overdraft Protection -From Savings/Checking (per transfer) -From Kwik-Cash ($100 automatic loan draw)",
        "Overdraft Protection -From Savings/Checking",
        "od_protection_transfer",
      ),
    ).toBeNull();
    expect(
      restoredName(
        "Copy of Check If you need a copy of a cleared check that was written from your personal checkbook",
        "Copy of Check",
        "check_image",
      ),
    ).toBeNull();
    expect(restoredName("Return Check (due to if due to your error)", "Return Check", "nsf")).toBeNull();
    expect(restoredName("Inactive Account (after \u0101\u0102 monthsof inactivity) \u010b\u010b\u010b", "Inactive Account", "dormant_account")).toBeNull();
  });
});
