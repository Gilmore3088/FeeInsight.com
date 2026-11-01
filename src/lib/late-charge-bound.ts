/**
 * #1905: a name that is the bound of a late charge, not a late fee. Shared by Knox (it never emits
 * such a read) and Darwin's live re-check (`darwin/late-charge-bound-check.ts`). Pure: no database
 * and no agent imports.
 *
 * A late charge stated as a percentage carries its bounds in the same sentence: "Late charges |
 * Generally 5% of the principal and interest for conventional loans; maximum late charge of $30 in
 * WV ... minimum late charge of $10 in ID, MD, WY" (Navy Federal, doc 39026), "Loan Late Fee ... 5%
 * of Payment Amount" over "Minimum Late Fee $10" (doc 21032), "Minimum Late Charge | $.50" over
 * "Late Charge | 5% of payment due" (doc 26406). The figure after "maximum late charge" or "minimum
 * late fee" is the cap or floor of that percentage, often for one state only, never the bank's late
 * fee. Read as a flat late_payment fee it sat in the late-fee benchmark at $0.50, $10 and $30.
 *
 * Only a name whose last clause is the bound itself counts: "maximum late charge", "Minimum Late
 * Fee", "Generally a maximum late charge of", "...; maximum late charge of". A name with words of its
 * own after the bound ("Late Fee (maximum $25)") or before it in the same clause ("Loan late fee")
 * is left alone, and so is a daily overdraft cap, which is a fee concept of its own.
 */
const LATE_CHARGE_BOUND =
  /(?:^|[;:,|]\s*|\b(?:generally|a|an|the)\s+)(?:max(?:imum)?|min(?:imum)?)\.?\s+late\s+(?:payment\s+)?(?:fees?|charges?)(?:\s+(?:of|is))?\s*$/i;

/** True when the name is the cap or floor of a late charge, not a late fee (see the module note). */
export function namesLateChargeBound(name: string | null | undefined): boolean {
  return LATE_CHARGE_BOUND.test((name ?? "").replace(/\s+/g, " ").trim());
}

/** The same test as a Postgres regex (`~*`), for the live re-check's read. */
export const LATE_CHARGE_BOUND_SQL = String.raw`(^|[;:,|]\s*|\m(generally|a|an|the)\s+)(max(imum)?|min(imum)?)\.?\s+late\s+(payment\s+)?(fees?|charges?)(\s+(of|is))?\s*$`;

