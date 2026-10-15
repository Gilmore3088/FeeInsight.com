import { describe, expect, it } from "vitest";

import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { passesDarwinChecks } from "@/lib/agents/knox/layout";
import { RESEARCH_SPLIT_LIVE, RETIRED_CATEGORY_KEYS, researchSplitTarget } from "@/lib/fee-fold";

import { HAND_REFILES, handFixedPassing, planHandRefiles, previewResearchSplit } from "./taxonomy-fold";

/** The schedule lines each hand re-file was read from (copied data: the banks' own text). */
const PAGE_LINES: Record<number, string> = {
  // #1299: cut-cents names renamed in place (docs 8040, 12872, 6817, 13851, 6231, 13904).
  49593: "Wire transfers – outgoing\nSafe Deposit Box drill fee | $200 00\nDomestic – U S dollar | $25 00",
  49594: "Wire transfers – incoming\nSPECIAL SERVICES | Domestic – U S dollar | $25 00\nInternational | $30 00",
  49597: "Collection items | $25 00\n2” x 5” | $47 | 3\" x 5\" | $45 | Inactive accounts (monthly after three months with no activity) $4 00",
  49607: "10” x 15” | $300 | Escheat fee | $75 00\nWire transfers – outgoing\nSafe Deposit Box drill fee | $200 00\nDomestic – U S dollar | $25 00\nLost key fee | $75 00",
  49608: "International – U S dollar | $50 00\nSafe Deposit Box late payment fee | $10 00\nForeign exchange – country currency | $25 00",
  49622: "Note: Select Money Market account balances that fall below the minimum Deposited items returned\nwill not receive interest and a $10 monthly fee will be charged. | Checks written by accountholder | $35 00",
  97433: "Monthly fee | $2 00 Account reconciliation/research, per hour | $25 00",
  97442: "Minimum balance to earn Select Money Market rates | $5,000 00 Returned Item charge | $35 00",
  49603: "3” x 10” | $98 | 7\" x 10\" | $90 | Official check, each | $5 00",
  62577: "and age 50 or better. | Account closing fee | $25 00",
  14289: "Inactive Share Account Fee3\nNo activity fo r 12 months ……………...……… $10. 00/m onth",
  49173: "Early Checking Account Closure Fee 2\nT e rm s f rom 6 to 24 months .........................180 days dividends\nWithin first 6 months .................................................. $25. 00/ea ch | T e rm s g r",
  42051: "Non-Sufficient Funds ............ $29.00",
  29160: "Non-Sufficient Funds | $25 00/item",
  29161: "Courtesy Pay | $25 00/item",
  29162: "Wire Transfer – Outgoing Domestic | $20 00/wire",
  29164: "Wire Transfer – Incoming | $10 00/wire",
  29172: "Stop Payment | $22 00*/draft or ACH item",
  29175: "IRA Closing | $25 00",
  29176: "Levy or Garnishment | $35 00",
  91820: "Counter Checks (per book of 8) | $10 00*",
  91980: "Inactivity Fee after 12 months | $10 00/month",
  91981: "Copy of Draft | $2 00*/draft",
  92004: "Foreign Check Dep – Int’l Collections | $25 00/item",
  24188: "Dormant accounts | $15 00 per month Nonsufficient funds | $35 00",
  24189: "Foreign Check Collection | $35 00 Overdraft protection transfer | $3 00",
  46888: "Dormant accounts | $15 00 per month Nonsufficient funds | $35 00",
  88268: "Research (reconciliation) fee at member’s request | $25 00/hr Wire message (non-domestic) | $25 00",
  88513: "Courtesy Pay (Paid NSF) Check/ACH/Bill Pay Payment | $32.00/item1\nNon-Sufficient Funds (NSF) Check/ACH/ATM Card/Bill Pay Payment | $32.00/item\nStop Payment (Check/ACH/Bill Pay Payment/Money Order)",
  107960: "Lost Card | $10.00\n\nReturn Check Fee | $25.00\n\nMiscellaneous\n\nDormant Fee | $ 3.00\n\nNSF Deposit Fee | $ 30.00",
  108035: "NSF | $25.00 Per Item\nOne-Time Debit Overdraft | $25.00 Per Item\nOverdraft | $25.00 Per Item\nReturned Item | $25.00 Per Item\nStop Payment | $10.00 Per Request",
  108132: "Returned Mail | $10.00 | each occurrence\n\nReturned Check | $30.00 | each\n\nStatement Copy | $1.00 | each page",
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
  92156: "Safe Deposit Boxes\n\nLost Key Replacement - each key | $20.00\n\nDrilling Box | Actual Cost\n\nLate Payment Fee - if payment is not made within 60 days of due date, late fee will apply | $10.00\n\nBox prices vary based on size.",
  // #1196 group 2: each row's stored Knox excerpt (prod, Oct 15).
  99578: "13 Account will default to a mailed statement and a monthly $2 mailed statement service charge will be charged to your account per statement cycle",
  97539: "(12 consecutive months of | Key Replacement | $30.00 each",
  65410: "36 months, 48 months, 60 months | Official Bank Check $5.00 per item",
  65411: "18 Month Variable Rate IRA CD | Money Order Stop Payment $25.00 per item",
  53490: "11 Inactive Account Inactive Account: $5.00",
  68521: "12 posted and settled debit card transactions | • Draft Photocopies.............................$ 3.00 / Check",
  88066: "or less; | 16 Verification of Deposit .................................................................................................. $10.00",
  88067: "; and | 17 Processing Levies, Garnishments, Attachments, and other Legal Liens – Each....... $75.00",
  88068: "18 Starter/Temporary Checks – 2 Pages at No Charge",
  57548: "12 Money Order Fee for First Step Accounts $1.70.",
  108912: "or Less | 31 Days of Interest | Dormant Account (after first 12 months) | $12.00/year",
  131129: "ATM Transactions at DFCU ATM (Local ATM) | 15 free ATM transactions per month and 15 free balance inquiries per month; then $2.00/transaction or",
  70319: "VISA Gift Card – Inactivity Fee after 12 Months of Inactivity $2.95/month",
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

  it("clears the rules re-check's pending takedown only on a hand-fixed fee that traces in its own text (61848, 98747)", () => {
    const texts = new Map([[9, PAGE_LINES[61848]], [10, PAGE_LINES[98747]]]);
    const fixed = { ...liveRow(61848, "minimum_balance", "2.00", "Minimum balance fee (minimum daily balance of $5)"), source_document_id: 9 };
    const other = { ...liveRow(98747, "monthly_maintenance", "15.00", "Service charge (balance falls below $1,000.00)"), source_document_id: 10 };
    expect(handFixedPassing([fixed, other], texts)).toEqual([61848, 98747]);
    // Not renamed yet, re-priced, or without its text: left for the re-check itself.
    expect(handFixedPassing([{ ...fixed, fee_name: "in your account to avoid a minimum balance fee of" }], texts)).toEqual([]);
    expect(handFixedPassing([{ ...fixed, amount: "3.00" }], texts)).toEqual([]);
    expect(handFixedPassing([{ ...fixed, source_document_id: 11 }], texts)).toEqual([]);
    // The name no longer traces in the page: no clear.
    expect(handFixedPassing([fixed], new Map([[9, "Share Account dividends compound monthly."]]))).toEqual([]);
  });

  it("renames a fee in place once, leaving it alone when the live name already reads as listed", () => {
    const moves = planHandRefiles([
      liveRow(97560, "nsf", "30.00", "�00/Transaction: Non-Sufficient Funds ���"),
      liveRow(97433, "account_research", "25.00", "Account reconciliation/research, per hour"),
    ]);
    expect(moves.map((move) => [move.refile.feePublishedId, move.refile.to, move.refile.name])).toEqual([
      [97560, "nsf", "Non-Sufficient Funds"],
    ]);
  });

  it("renames returned mail in place while the research split is off and moves it once on (#1398)", () => {
    const rows = [
      liveRow(21141, "account_research", "5.00", "Mailed Statement Fee $\u0017.00 per statement Returned Statement Fee"),
      liveRow(77918, "account_research", "5.00", "00 Return Mail Fee (no forwarding)"),
      liveRow(44516, "minimum_balance", "25.00"),
    ];
    const returned = researchSplitTarget("returned_mail");
    const excess = researchSplitTarget("excess_withdrawal");
    expect(planHandRefiles(rows).map((move) => [move.refile.feePublishedId, move.currentKey, move.refile.to])).toEqual([
      [21141, "account_research", returned],
      [77918, "account_research", returned],
      [44516, "minimum_balance", excess],
    ]);
    // Off, nothing lands in the new types.
    if (!RESEARCH_SPLIT_LIVE) {
      expect([returned, excess]).toEqual(["account_research", "account_research"]);
      // Already renamed under account research: nothing left to do while off.
      expect(planHandRefiles([liveRow(21141, "account_research", "5.00", "Returned Statement Fee")])).toEqual([]);
    }
    // 28554 ("No contents ... included in the ATM", $2/envelope) is not moved to either new type.
    expect(HAND_REFILES.find((refile) => refile.feePublishedId === 28554)?.to).toBe("account_research");
  });
});

describe("research split dry run (#1398)", () => {
  const row = (id: number | null, verifiedId: number, name: string, amount: string) => ({
    fee_published_id: id, fee_verified_id: verifiedId, institution_id: 1, source_document_id: null,
    canonical_fee_key: "account_research", fee_name: name, amount,
  });

  it("counts what turning the switch on would move, by route, with samples, and what the new type would refuse", () => {
    const preview = previewResearchSplit([
      row(1, 11, "Excess Transaction Fee", "10.00"),
      row(2, 12, "Returned Statement Fee", "5.00"),
      row(3, 13, "Bad address fee", "5.00"),
      row(null, 14, "Return Mail", "3.00"),
      // Outside the $1-$50 range: the new type refuses it, so it would stay research.
      row(5, 15, "Returned mail (per month)", "75.00"),
      // Research stays research; an IRA's excess withdrawal and a copy are other splits, not this one.
      row(6, 16, "Account research, per hour", "25.00"),
      row(7, 17, "Wire research", "15.00"),
      row(8, 18, "IRA Excess Withdrawal Fee", "20.00"),
      row(9, 19, "Copy of returned statement", "5.00"),
    ]);
    expect(preview).toMatchObject({
      scanned: 9,
      wouldMove: 4,
      wouldMoveLive: 3,
      byRoute: { "account_research->excess_withdrawal": 1, "account_research->returned_mail": 3 },
      refused: 1,
      refusedByRoute: { "account_research->returned_mail": 1 },
    });
    expect(preview.sample.map((sample) => [sample.feeVerifiedId, sample.to])).toEqual([
      [11, "excess_withdrawal"],
      [12, "returned_mail"],
      [13, "returned_mail"],
      [14, "returned_mail"],
    ]);
    expect(preview.refusedSample.map((sample) => sample.feePublishedId)).toEqual([5]);
  });
});
