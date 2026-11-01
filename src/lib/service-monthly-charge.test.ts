import { describe, expect, it } from "vitest";
import { classifyFeeText } from "@/lib/agents/knox/rules";
import { restoreTarget } from "@/lib/agents/hamilton/category-guard";
import { CATEGORY_GUARD_VERSION, checkFeeCategory, refileCategory } from "@/lib/fee-category-guard";
import { KNOX_RULES_STRATEGY } from "@/lib/agents/knox/specialists";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { serviceMonthlyTarget } from "@/lib/service-monthly-charge";

// #1100: the 17 live monthly maintenance fees at 17 banks whose name is a service's own monthly
// charge (read-only, Nov 1), with the stored line each was read from.
const MOVERS: ReadonlyArray<{ id: number; name: string; amount: number; to: "bill_pay" | "mobile_deposit" | null; line: string }> = [
  { id: 52592, name: "Bill Payer (monthly fee)", amount: 0, to: "bill_pay", line: "Online Banking\nBill Payer (monthly fee) | Free\nStop Payment on Bill Payer | $20.00\neStatements (monthly fee) | Free" },
  { id: 127920, name: "Bill Payer Monthly Fee (Personal Accounts)", amount: 0, to: "bill_pay", line: "Electronic Services\n\nOnline Banking | Free\n\nBill Payer Monthly Fee (Personal Accounts) | Free\n\nMobile Banking & Remote Deposit Capture | Free" },
  { id: 90758, name: "BillPayer Monthly Fee", amount: 0, to: "bill_pay", line: "BillPayer Copy of Check | $3.00 | each\n\nBillPayer Monthly Fee | No Fee | per account\n\nBillPayer Stop Payment | $15.00 | each" },
  { id: 134175, name: "Mobile Check Deposit - Monthly Service", amount: 0, to: "mobile_deposit", line: "Mobile and Text Banking - Monthly Service FREE | Loan coupon book replacement $25\nMobile Check Deposit - Monthly Service FREE\nDigital Banking - Monthly Service FREE" },
  { id: 109997, name: "Coin Orders, per order: Maintenance fee, per month", amount: 3.95, to: null, line: "Bill Pay Transaction Research, each $25.00 | Coin Orders, per order" },
  { id: 14261, name: "Consumer debit card Monthly Service Charge plan", amount: 1, to: null, line: "Consumer debit card Monthly Service Charge plan: $1.00\n\nForeign ATM terminals: $1.50 each" },
  { id: 21100, name: "Initial Visa Check Card and Visa Check Card monthly maintenance", amount: 0, to: null, line: "Debit Check Card\n\nInitial Visa Check Card and Visa Check Card monthly maintenance\n\nFREE" },
  { id: 126293, name: "Manual Bill Paying Monthly Service Fee", amount: 10, to: null, line: "Manual Bill Paying Service Fee – $5.00\nManual Bill Paying Monthly Service Fee – $10.00" },
  { id: 57925, name: "Monthly Fee (Balance Reporting Online)", amount: 0, to: null, line: "Business Online Banking | Scanner Purchase ... At Cost\nMonthly Fee (Balance Reporting Online) .................... | No Fee | Positive Pay" },
  { id: 159894, name: "Monthly fee if enrolled in Text Banking and no text messages sent or received in a calendar month", amount: 2, to: null, line: "Text Banking Fees\n\nMonthly fee if enrolled in Text Banking and no text messages sent or received in a calendar month | $2.00*" },
  { id: 75433, name: "Monthly service charge for Advanced Online Banking", amount: 9.99, to: null, line: "$9.99 monthly service charge for Advanced Online Banking.\n$4.99 monthly service charge for ACH Originations." },
  { id: 139026, name: "OLB Monthly Maintenance", amount: 0, to: null, line: "OLB Additional Users | $0.00\n\nOLB Monthly Maintenance | $0.00\n\nOutgoing Wire – Domestic | $0.00" },
  { id: 140108, name: "Online Banking and Bill PayNo monthly service charge", amount: 0, to: null, line: "Online Banking and Bill PayNo monthly service charge\n\n$0" },
  { id: 90012, name: "Online Banking Monthly Service Fee", amount: 0, to: null, line: "Online Fees\n\nOnline Banking Monthly Service Fee | FREE\n\nOnline Bill Pay Monthly Service Fee | FREE" },
  { id: 142371, name: "Remote Capture Monthly Fee", amount: 50, to: null, line: "Remote Capture Setup Fee - $100.00\n\nRemote Capture Monthly Fee - $50.00" },
  { id: 134058, name: "Telephone Transfer Fee (shown individually as Service Charge, shown as Total Telephone Transfer in Service made 3", amount: 12, to: null, line: "Telephone Transfer Fee | $4 each per Telephone Transfer requested." },
  { id: 61576, name: "VISA/MasterCard Monthly Fee", amount: 7.75, to: null, line: "Merchant Service Fees\n\nVISA/MasterCard Monthly Fee | $7.75\n\nMerchant Application Fee | $50.00" },
];

// Live monthly maintenance fees that name a service only as the account's condition, or name an
// account with a service word, and stay.
const STAYERS = [
  "monthly maintenance fee (Use your debit card 15 or more times per month and we’ll waive the monthly fee.)",
  "monthly service charge if no direct or mobile deposits",
  "Online Checking Account Monthly service charge",
  "Paperless Checking Monthly Service Fee",
  "First Merchants Prosper Checking Monthly Maintenance Fee",
  "TFCU owned ATMs Deluxe Checking Monthly service charge",
  "Monthly Service Charge - waived with online banking and direct deposit",
  "Monthly Maintenance Fee",
];

describe("#1100 a named service's monthly charge is not the account's monthly maintenance fee", () => {
  it.each(MOVERS)("Knox files $id ($name) under its service, or holds it", ({ name, to }) => {
    expect(serviceMonthlyTarget(name)).toBe(to);
    expect(classifyFeeText(name)).toBe(to);
  });

  it.each(MOVERS)("the guard refuses $id as monthly maintenance and Hamilton moves it or takes it down", ({ id, name, amount, to }) => {
    expect(checkFeeCategory("monthly_maintenance", name).ok).toBe(false);
    expect(refileCategory("monthly_maintenance", name)).toBe(to ?? "monthly_maintenance");
    const row = { canonical_fee_key: "monthly_maintenance", fee_name: name, amount, conditions: null, document_nsf_amount: null, fee_published_id: id };
    expect(restoreTarget(row)).toBe(to);
  });

  it.each(MOVERS.filter((mover) => mover.to))("$id traces on its stored line under $to", ({ name, amount, to, line }) => {
    expect(checkFeeAgainstSource(line, name, amount, ".", to)).toMatchObject({ ok: true });
  });

  it.each(STAYERS)("keeps %s as monthly maintenance", (name) => {
    expect(serviceMonthlyTarget(name)).toBeUndefined();
    expect(classifyFeeText(name)).toBe("monthly_maintenance");
    expect(checkFeeCategory("monthly_maintenance", name).ok).toBe(true);
  });
});

describe("#1100 versions", () => {
  it("re-reads old texts and re-checks live fees", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(149);
    expect(CATEGORY_GUARD_VERSION).toBeGreaterThanOrEqual(102);
  });
});
