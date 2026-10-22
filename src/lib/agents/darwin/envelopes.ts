/**
 * Plausible dollar ranges per canonical fee key.
 *
 * A flat fee outside its category's range is far more often a misread (a balance
 * requirement read as a fee, a column shifted by one, an annual figure under a monthly
 * name) than a real price, so Darwin sends it to review instead of verifying it and
 * Hamilton will not publish it. The ranges are deliberately wide: they catch misreads,
 * not unusual pricing. Keys without an entry use the default range.
 *
 * $0 is never inside an envelope. A free fee is accepted only when Knox read explicit
 * "free"/"no charge"/$0 language for it (the `knox_review:zero` flag); see
 * `isExplicitZeroFee`.
 *
 * Darwin adds learned ceilings for the categories without an entry
 * (`learned-envelopes.ts`); everything else here (Hamilton, Knox) keeps these ranges.
 */

export interface AmountEnvelope {
  min: number;
  max: number;
}

export const DEFAULT_AMOUNT_ENVELOPE: AmountEnvelope = { min: 0.01, max: 2_500 };

export const CATEGORY_AMOUNT_ENVELOPES: Readonly<Record<string, AmountEnvelope>> = {
  // Live overdraft/NSF rows under $5 were transfer fees, per-day charges and
  // thresholds ("no fee on items under $5"), not per-item prices; a real one goes to review.
  overdraft: { min: 5, max: 60 },
  nsf: { min: 5, max: 60 },
  continuous_od: { min: 1, max: 50 },
  od_protection_transfer: { min: 0.5, max: 40 },
  ach_return: { min: 1, max: 50 },
  deposited_item_return: { min: 1, max: 50 },
  atm_non_network: { min: 0.25, max: 10 },
  atm_international: { min: 0.5, max: 15 },
  card_foreign_txn: { min: 0.25, max: 25 },
  card_replacement: { min: 1, max: 40 },
  rush_card: { min: 5, max: 100 },
  monthly_maintenance: { min: 1, max: 50 },
  minimum_balance: { min: 1, max: 50 },
  stop_payment: { min: 5, max: 50 },
  wire_domestic_outgoing: { min: 5, max: 75 },
  wire_domestic_incoming: { min: 1, max: 40 },
  wire_intl_outgoing: { min: 10, max: 150 },
  wire_intl_incoming: { min: 1, max: 50 },
  cashiers_check: { min: 1, max: 25 },
  money_order: { min: 0.5, max: 15 },
  paper_statement: { min: 0.5, max: 10 },
  estatement_fee: { min: 0.5, max: 10 },
  check_image: { min: 0.5, max: 15 },
  dormant_account: { min: 1, max: 30 },
  // Keep 50 (James, 2026-10-09) pooled returned mail, fax and copy fees here; they run $1 to $4 at
  // most banks (1,380 held rows at 850 institutions were under the old $5 floor).
  account_research: { min: 1, max: 150 },
  // Their own types since Oct 15 (#1398): per-item charges, typically $5; a $25 excess transaction fee (44516) and
  // a $25 returned-statement tracer fee are real, so the ceiling sits with the per-item analogues
  // (ach_return, deposited_item_return, continuous_od).
  excess_withdrawal: { min: 1, max: 50 },
  returned_mail: { min: 1, max: 50 },
  garnishment_levy: { min: 10, max: 250 },
  legal_process: { min: 10, max: 250 },
  safe_deposit_box: { min: 5, max: 1_500 },
};

export const ZERO_FEE_RAW_FLAG = "knox_review:zero";
export const ZERO_FEE_VERIFIED_FLAG = "zero_fee";

/**
 * Escheatment (sending a dormant balance to the state) is filed as a dormant account fee but priced
 * as a one-time processing charge: $40 to $100 in the shadow lab's answer keys (#2536), above the
 * monthly dormant ceiling. Only a fee whose own name says escheat gets this range, so a capped
 * monthly dormant fee read at its cap ("$5.00/$60.00") stays outside.
 */
export const ESCHEAT_NAME = /\bescheat/i;
export const ESCHEAT_ENVELOPE: AmountEnvelope = { min: 1, max: 150 };

/** The hand range for a fee, by its category and, for escheat processing, its own name. */
export function handEnvelopeFor(canonicalFeeKey: string, feeName?: string | null): AmountEnvelope | undefined {
  if (canonicalFeeKey === "dormant_account" && feeName && ESCHEAT_NAME.test(feeName)) return ESCHEAT_ENVELOPE;
  return CATEGORY_AMOUNT_ENVELOPES[canonicalFeeKey];
}

export function amountEnvelopeFor(canonicalFeeKey: string, feeName?: string | null): AmountEnvelope {
  return handEnvelopeFor(canonicalFeeKey, feeName) ?? DEFAULT_AMOUNT_ENVELOPE;
}

/** True when a positive amount sits inside its category's range (inclusive). */
export function withinAmountEnvelope(canonicalFeeKey: string, amount: number, feeName?: string | null): boolean {
  const envelope = amountEnvelopeFor(canonicalFeeKey, feeName);
  return amount >= envelope.min && amount <= envelope.max;
}

/** A $0 row counts as a real free fee only when its flags say the source said so. */
export function isExplicitZeroFee(amount: number | null, flags: string[], flag: string): boolean {
  return amount === 0 && flags.includes(flag);
}
