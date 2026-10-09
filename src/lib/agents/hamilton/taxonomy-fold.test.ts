import { describe, expect, it } from "vitest";

import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { passesDarwinChecks } from "@/lib/agents/knox/layout";
import { RETIRED_CATEGORY_KEYS } from "@/lib/fee-fold";

import { HAND_REFILES, planHandRefiles } from "./taxonomy-fold";

/** The schedule lines each hand re-file was read from (copied data: the banks' own text). */
const PAGE_LINES: Record<number, string> = {
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
});
