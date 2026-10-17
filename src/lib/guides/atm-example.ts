import type { ExtractedFee } from "@/lib/data-store/types";

/**
 * One real out-of-network withdrawal, built from two institutions' own published fees: the
 * card holder's bank charges for using another bank's machine, and the machine's owner charges
 * people who are not its customers. Both amounts are live published fees, each with its source,
 * so the receipt shows two prices from two schedules, never a median.
 *
 * Capital City Bank's fee applies "at non-Capital City Bank ATM", so any other bank's machine
 * draws it; First Federal Bank publishes a surcharge for non-customers at its own machines.
 * Only the cash amount is chosen for the example.
 */
export const ATM_EXAMPLE = { holderId: 323, ownerId: 330, withdrawal: 40 } as const;

export interface AtmFeeLine {
  institutionId: number;
  institutionName: string;
  feeName: string;
  amount: number;
  sourceUrl: string | null;
}

export interface AtmTwoFeeExample {
  withdrawal: number;
  /** The card holder's bank: its fee for another bank's machine, on the statement. */
  holder: AtmFeeLine;
  /** The machine owner: its surcharge for non-customers, shown on screen. */
  owner: AtmFeeLine;
  fees: number;
  total: number;
}

const NON_CUSTOMER = /\bnon[-\s]?customers?\b/i;

function live(fees: ExtractedFee[]): ExtractedFee[] {
  return fees.filter(
    (fee) =>
      fee.review_status === "approved" &&
      fee.fee_category === "atm_non_network" &&
      fee.amount != null &&
      fee.amount > 0,
  );
}

function line(fee: ExtractedFee): AtmFeeLine {
  return {
    institutionId: fee.institution_id,
    institutionName: fee.institution_name,
    feeName: fee.fee_name,
    amount: Number(fee.amount),
    sourceUrl: fee.source_url ?? null,
  };
}

/** The holder bank's own fee for another bank's machine: a withdrawal line first, never a non-customer surcharge. */
export function pickHolderFee(fees: ExtractedFee[]): AtmFeeLine | null {
  const rows = live(fees).filter((fee) => !NON_CUSTOMER.test(fee.fee_name));
  const withdrawal = rows.find((fee) => /withdraw/i.test(fee.fee_name));
  const fee = withdrawal ?? rows[0];
  return fee ? line(fee) : null;
}

/** The machine owner's published surcharge for people who are not its customers. */
export function pickOwnerSurcharge(fees: ExtractedFee[]): AtmFeeLine | null {
  const fee = live(fees).find((row) => NON_CUSTOMER.test(row.fee_name));
  return fee ? line(fee) : null;
}

/** Null unless both live fees exist: a receipt with one real line and one invented one is never shown. */
export function buildAtmTwoFeeExample(
  holderFees: ExtractedFee[],
  ownerFees: ExtractedFee[],
  withdrawal: number = ATM_EXAMPLE.withdrawal,
): AtmTwoFeeExample | null {
  const holder = pickHolderFee(holderFees);
  const owner = pickOwnerSurcharge(ownerFees);
  if (!holder || !owner) return null;
  const fees = Math.round((holder.amount + owner.amount) * 100) / 100;
  return { withdrawal, holder, owner, fees, total: Math.round((withdrawal + fees) * 100) / 100 };
}
