import { describe, expect, it } from "vitest";
import { frequencyFromLine, ownLinePricesPerItem, settledFrequency } from "@/lib/fee-frequency";
import { verifiedFrequency } from "./verify";
import {
  findMaintenanceFrequencies,
  MAINTENANCE_FREQUENCY_ACTS,
  maintenanceFrequencyFeedbackRow,
  maintenanceFrequencyVerdict,
  type MaintenanceFrequencyRow,
} from "./maintenance-frequency-check";

/** The 17 live monthly maintenance fees stored per item on Oct 30 (prod read-only), with Knox's own excerpt. */
const LIVE: Array<[id: number, name: string, amount: number, frequency: string, excerpt: string]> = [
  [69927, "maintenance fee | Non-Account owner", 16, "per_item", "maintenance fee | • Non-Account owner | $16 each"],
  [70749, "Fees – A service charge", 5, "per_item", "Fees – A service charge of $5.00 will be charged each statement cycle. See Additional Terms section for options to offset"],
  [70750, "Fees – A service charge", 15, "per_item", "Fees – A service charge of $15.00 will be charged each statement cycle."],
  [72530, "Fees and charges: A service charge", 3, "per_item", "Fees and charges: A service charge of $3.00 will be charged each calendar month."],
  [100041, "Monthly service fee", 3, "per_item", "A monthly service fee of $3.00 will be charged on the 1st day of each calendar month."],
  [106618, "Service charge", 15, "per_item", "Minimum Balance Requirements: To open this account, you must make a minimum deposit of $100. There is a $15 service charge each fee period. Avoid the service charge by having a com"],
  [113636, "Service charge", 5, "per_item", "There is a $5.00 service charge if the balance goes below $2,500.00"],
  [124953, "Item Fee Service Charge", 2, "per_item", "3 free withdrawals per month; $2 Item Fee Service Charge for each additional"],
  [125734, "Balance requirements listed above correlate with the monthly maintenance fees directly below them", 35, "per_item", "Balance requirements listed above correlate with the monthly maintenance fees directly below them. / $35 per overdraft"],
  [127148, "low balance service charge plus cents per check", 10, "per_item", "$10.00 low balance service charge plus $0.10 cents per check"],
  [130957, "NOW Account Checking Maintenance fee", 8, "per_item", "A maintenance fee of $8.00 plus .50¢ per check will be imposed every statement cycle unless you maintain either a minimum daily balance of $750.00 or an average daily balance of $1"],
  [134658, "Service charge fee", 10, "per_item", "Additional Information Regarding Your Account: A service charge fee of $10.00 will be charged each calendar quarter"],
  [140755, "Service charge fee", 7.5, "per_item", "Minimum balance to avoid imposition of fees - A service charge fee of $7.50 will | A per item fee of $10.00 will be charged for each debit transaction (withdrawal, check"],
  [143161, "Service charge", 30, "per_item", "Minimum Balance Requirements: To open this account, you must make a minimum deposit of $100. There is a $30 service charge each fee period. Avoid the service charge by having:"],
  [147168, "If the average falls below the requirement, a service charge of", 10, "per_item", "If the average falls below the requirement, a service charge of $10.00 and $.25 per check is assessed.*"],
  [149338, "monthly fee, if balance falls below", 4, "per_item", "(monthly fee, if balance falls below $300.00) ................................. $4.00"],
  [152158, "Minimum opening balance, and a maintenance fee", 1, "per_transaction", "There is a $1.00 minimum opening balance, and a maintenance fee of $1.00 per withdrawal after 6 per statement cycle"],
];

function row([id, name, amount, frequency, excerpt]: (typeof LIVE)[number]): MaintenanceFrequencyRow {
  return {
    fee_published_id: id,
    fee_verified_id: id + 1,
    institution_id: 1,
    source_document_id: 2,
    fee_name: name,
    amount,
    canonical_fee_key: "monthly_maintenance",
    frequency,
    conditions: `Knox deterministic extraction. canonical_hint=monthly_maintenance; excerpt="${excerpt}"`,
  };
}

describe("monthly maintenance never per item (Oct 30)", () => {
  it("reads each calendar month, each statement period and each calendar quarter as periods", () => {
    expect(frequencyFromLine(LIVE[3][4], 3)).toBe("monthly");
    expect(frequencyFromLine(LIVE[11][4], 10)).toBe("quarterly");
    expect(frequencyFromLine("A fee of $5.00 is charged each statement period.", 5)).toBe("monthly");
  });

  it("drops a stated per-item frequency on monthly maintenance, at Knox and at Darwin's verify", () => {
    // Knox passed its own per-item reading in as the stated frequency, and the rule kept it.
    const [, , amount, , excerpt] = LIVE[0];
    expect(frequencyFromLine(excerpt, amount)).toBe("per_item");
    expect(settledFrequency(excerpt, amount, "per_item", "monthly_maintenance")).toBeNull();
    expect(verifiedFrequency(excerpt, amount, "per_item", "monthly_maintenance")).toBeNull();
    expect(settledFrequency(LIVE[4][4], 3, "per_item", "monthly_maintenance")).toBeNull();
    expect(settledFrequency(LIVE[3][4], 3, "per_item", "monthly_maintenance")).toBe("monthly");
    expect(settledFrequency(LIVE[16][4], 1, "per_transaction", "monthly_maintenance")).toBeNull();
  });

  it("leaves other categories' per-item frequency alone", () => {
    expect(settledFrequency("Safe Deposit Box Drilling | $150.00 each", 150, "per_item", "safe_deposit_box")).toBe("per_item");
    expect(settledFrequency("Stop Payment | $30.00 each", 30, "per_item", "stop_payment")).toBe("per_item");
  });

  it("says a line prices the fee per item only when per-item wording follows its own price or names it", () => {
    expect(ownLinePricesPerItem(LIVE[0][4], 16, LIVE[0][1])).toBe(true);
    expect(ownLinePricesPerItem(LIVE[7][4], 2, LIVE[7][1])).toBe(true);
    expect(ownLinePricesPerItem(LIVE[8][4], 35, LIVE[8][1])).toBe(true);
    expect(ownLinePricesPerItem(LIVE[16][4], 1, LIVE[16][1])).toBe(true);
    expect(ownLinePricesPerItem(LIVE[1][4], 5, LIVE[1][1])).toBe(false);
    expect(ownLinePricesPerItem(LIVE[4][4], 3, LIVE[4][1])).toBe(false);
    expect(ownLinePricesPerItem(LIVE[10][4], 8, LIVE[10][1])).toBe(false);
    expect(ownLinePricesPerItem("Monthly maintenance fee: $8.00 Per check: $0.20", 8, "Monthly maintenance fee")).toBe(false);
  });

  it("judges each of the 17 live fees", () => {
    const verdicts = Object.fromEntries(LIVE.map((entry) => {
      const verdict = maintenanceFrequencyVerdict(row(entry))!;
      return [entry[0], verdict.outcome === "refile" ? `refile:${verdict.to}` : verdict.outcome];
    }));
    expect(verdicts).toEqual({
      69927: "hold",
      70749: "refile:monthly",
      70750: "refile:monthly",
      72530: "refile:monthly",
      100041: "refile:monthly",
      106618: "clear",
      113636: "clear",
      124953: "hold",
      125734: "hold",
      127148: "clear",
      130957: "clear",
      134658: "refile:quarterly",
      140755: "clear",
      143161: "clear",
      147168: "clear",
      149338: "refile:monthly",
      152158: "hold",
    });
  });

  it("counts the class and skips rows that are not per item or not maintenance", () => {
    const rows = [...LIVE.map(row), { ...row(LIVE[1]), fee_published_id: 1, frequency: "monthly" }, { ...row(LIVE[0]), fee_published_id: 2, canonical_fee_key: "safe_deposit_box" }];
    const found = findMaintenanceFrequencies(rows);
    expect(found.checked).toBe(19);
    expect(found.outcomes).toEqual({ hold: 4, refile: 6, clear: 7 });
    expect(found.refileTo).toEqual({ monthly: 5, quarterly: 1 });
  });

  it("logs the old frequency for a rollback, and ships switched off", () => {
    const verdict = maintenanceFrequencyVerdict(row(LIVE[3]))!;
    const feedback = maintenanceFrequencyFeedbackRow(verdict, 9);
    expect(feedback.evidence).toMatchObject({ action: "refile", from: "per_item", to: "monthly" });
    expect(feedback.weight).toBe(0);
    expect(MAINTENANCE_FREQUENCY_ACTS).toBe(false);
  });
});
