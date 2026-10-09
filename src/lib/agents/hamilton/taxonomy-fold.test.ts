import { describe, expect, it } from "vitest";

import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { passesDarwinChecks } from "@/lib/agents/knox/layout";
import { RETIRED_CATEGORY_KEYS } from "@/lib/fee-fold";

import { HAND_REFILES, planHandRefiles } from "./taxonomy-fold";

/** The schedule lines each hand re-file was read from (copied data: the banks' own text). */
const PAGE_LINES: Record<number, string> = {
  96164: "Non-Westamerica ATM Withdrawals:\nWestamerica will not impose a Network ATM fee for\nwithdrawals made at any non-Westamerica ATM if the\nbalance requirement to avoid the monthly service charge is\nmet. Otherwise, a fee of $2.50 per posted withdrawal may\nbe imposed at the end of your statement cycle.",
  61848: "The minimum balance to open a Share Account is $5. You must maintain a minimum daily balance of $5 in your account to avoid a minimum balance fee of $2 once during the statement cycle.",
  98747: "Minimum balance to avoid imposition of fees - If your balance falls below $1,000.00 on any day in the monthly statement cycle we will impose a service charge fee of $15.00 once during the statement cycle.",
  40729: "Wire Transfer Domestic Outgoing ........ $22.00\nWire Transfer Domestic Incoming ........ $15.00\nInternational Outgoing/Incoming ........ $38.00\nFRANKFORT | 20181 S. LaGrange",
  46537: "Apple Pay/Samsung Pay/Google PayFREE | Wire Transfer\nDomestic (Incoming) | $15.00\nDEBIT CARDS | Domestic (Outgoing) | $25.00",
  46538: "Apple Pay/Samsung Pay/Google PayFREE | Wire Transfer\nDomestic (Incoming) | $15.00\nDEBIT CARDS | Domestic (Outgoing) | $25.00",
  54418: "Non-Return Fee | (Per Presentment of ACH, Personal Checks, 3rd Party Checks, Bill Payments) | $15.00\nNSF/Returned Item Fee | (Per Presentment of ACH, Personal Checks, 3rd Party Checks, Bill Payments) | $30.00\nOfficial Check | (1 Free Per Month) | $3.00",
  54427: "Official Check | (1 Free Per Month) | $3.00\nPaper Statement | (Monthly Fee. Over 55 Free) | $5.00\nPersonal Check Order | | Varies",
  76451: "Copy of Paid Check | $3.00\n\nBase Share balance below $25.00 (Monthly Fee) | $5.00\n\nCoin Counter over $50.00 | 5% of total",
  92253: "• Copy of historical check clearing, official check or money order, per item\n(max 4 checks, 5+ Account research fee, min 1 hour).......................... $5.00\n• Returned Check or ACH items, per item.............................................$30.00",
  98520: "Statement Copy Fee | $2.00/per statement\nWire Transfer Fee | $20.00\nWire Transfer Fee (International) | $50.00\nIncoming Wire Transfer Fee | $20.00 (one free per month)",
  98696: "Cashier's Check\n(set up in Bill Pay only)\nMember Fee | $10.00 per check | Between Georgia's Own Accounts | FREE\nNon Member Fee | $20.00 per check",
  104858: "and Reconciliation | ($50.00 minimum) | Cashback Checking Plus Account | $10.00 /month3\nCashier’s Check | $1.00 /check | Fresh Start Checking Account | $10.00 /month3",
  56804: "** To avoid a Monthly Service Fee of $5 per paper statement, you must enroll for E-Statements within 30 days of account opening.",
  79217: "deposit, OR branch deposit each statement cycle. Internal account to account | Canadian/Foreign Check Handling Charge | $6.00 per item",
  28554: "purchases, or ATM withdrawals exceed your account’s available | No contents (e.g. check) included in the ATM | $2/envelope",
  37068: "primary account. 8Up to 5 copies, then $25/hr research fee. 9As of July 25, 2025, new safe deposit box agreements will not be accepted.",
  44516: "(if balance falls below minimum daily balance) • Excessive transaction fee is $25/transaction",
  91458: "*unlimited 1st National ATM access / $5.00 monthly maintenance fee",
  95142: "• Stop Payment Fee - $30.00\n• Account Research Fee (minimum 1 hour) - $25.00/hour | • Money Order Research Fee - $10.00/money order\nSHARE & SHARE DRAFT FEES",
  58050: "Foreign Currency Order or Foreign Currency deposited item | $20.00\nInactive Account (no activity for 365 days, balances under $50) - monthly fee | $2.00\nLevy attachment | $50.00",
  59464: "• Stop Payment Fee:\no Customer Checking | $10.00\no Bank Issued (Restricted) | $25.00\no Money Order | $10.00",
  46752: "ATM Transactions (If using a Presto! Or Plus ATM.) | $.50 each\n\nDebit/ATM Card Reissuance | $4.00 each\n\nDebit Card Hot Card Fee | $5.00 each",
  16698: "- Over 10 Roll Penny (DEBIT MEMO) | $0.05 | ATM/Check Card Re-issuance | $10 /each\n\n- Loose Coin Deposit per Roll(DEBIT MEMO) | $0.50",
  53034: "Copies of a canceled draft (check) .................... $2.00 each\nCounter Draft (check) (limit 8per month) …........ $1.00 each\nATM Withdrawal Overdraft …………………………$28.00 each",
  56385: "Wire Research Fee (earnings credit available) | $25.00\nNIGHT DEPOSITORY SERVICE\n Monthly Fee (earnings credit available) | $2.00\n Disposable Bags | varies",
  21141: "Mailed Statement Fee $\u0017.00 per statement Returned Statement Fee $5.00 per statement Check",
  77918: "\u0125page Return Mail Fee (no forwarding) ……………$5.00",
  97560: "Out of Network ATMs \ufffd\ufffd\ufffd $2\ufffd00/Transaction | Non-Sufficient Funds \ufffd\ufffd\ufffd\ufffd$30/item",
  98064: "Copies of a canceled draft (check) .................... $2.00 each | Inactive Account (after \u0101\u0102 monthsof inactivity) \u010b\u010b\u010b$5.00\u0125month",
};

function liveRow(id: number, key: string, amount: string, name = "(misread cell)") {
  return { fee_published_id: id, fee_verified_id: id + 1000, institution_id: 1, source_document_id: 9, canonical_fee_key: key, fee_name: name, amount };
}

describe("hand re-files of misread live fees (retidy v15 review, Oct 9)", () => {
  it("files every one under one of the 50, where the guard and price range accept its new name", () => {
    for (const refile of HAND_REFILES) {
      expect(RETIRED_CATEGORY_KEYS.has(refile.to), `${refile.feePublishedId}`).toBe(false);
      expect(passesDarwinChecks(refile.to, refile.name, refile.amount), `${refile.feePublishedId}`).toBe(true);
    }
  });

  it("names every one as its page does, at its price", () => {
    for (const refile of HAND_REFILES) {
      const traced = checkFeeAgainstSource(PAGE_LINES[refile.feePublishedId], refile.name, refile.amount, ".", refile.to);
      expect(traced.ok, `${refile.feePublishedId}: ${traced.ok ? "" : traced.reason}`).toBe(true);
    }
  });

  it("moves a live fee only while it is still under its old category at its listed price", () => {
    const moves = planHandRefiles([
      liveRow(46537, "early_closure", "15.00", "(closed within 90 days): Domestic (Incoming)"),
      // Already moved, or re-priced since: left alone.
      liveRow(46538, "wire_domestic_outgoing", "25.00"),
      liveRow(98520, "garnishment_levy", "25.00"),
      // Not on the list.
      liveRow(46431, "early_closure", "25.00"),
    ]);
    expect(moves.map((move) => [move.refile.feePublishedId, move.refile.to, move.oldName])).toEqual([
      [46537, "wire_domestic_incoming", "(closed within 90 days): Domestic (Incoming)"],
    ]);
  });

  it("never moves a fee to a category whose guard rejects the new name", () => {
    const refiles = [{ feePublishedId: 1, from: "bill_pay", amount: 15, to: "overdraft", name: "Non-Return Fee", why: "test" }];
    expect(planHandRefiles([liveRow(1, "bill_pay", "15.00")], refiles)).toEqual([]);
  });

  it("fixes a fee another check already moved under its target type while it keeps the bad name (96164)", () => {
    const oldName = "balance requirement to avoid the monthly service charge is met. Otherwise, a fee of";
    const moves = planHandRefiles([liveRow(96164, "atm_non_network", "2.50", oldName)]);
    expect(moves.map((move) => [move.currentKey, move.refile.to, move.refile.name])).toEqual([
      ["atm_non_network", "atm_non_network", "Non-Westamerica ATM withdrawal (balance requirement not met)"],
    ]);
    // Under its target with any other name (a later rename), it is left alone.
    expect(planHandRefiles([liveRow(96164, "atm_non_network", "2.50", "Non-network ATM withdrawal")])).toEqual([]);
    expect(planHandRefiles([liveRow(96164, "atm_non_network", "2.50", "Non-Westamerica ATM withdrawal (balance requirement not met)")])).toEqual([]);
  });

  it("renames a fee in place once, leaving it alone when the live name already reads as listed", () => {
    const moves = planHandRefiles([
      liveRow(97560, "nsf", "30.00", "�00/Transaction: Non-Sufficient Funds ���"),
      liveRow(21141, "account_research", "5.00", "Returned Statement Fee"),
    ]);
    expect(moves.map((move) => [move.refile.feePublishedId, move.refile.to, move.refile.name])).toEqual([
      [97560, "nsf", "Non-Sufficient Funds"],
    ]);
  });
});
