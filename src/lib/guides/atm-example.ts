import type { ExtractedFee } from "@/lib/data-store/types";
import { frequencyFamily } from "@/lib/fee-frequency";
import { countsInMarketComparison } from "@/lib/market-eligibility";

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

const NON_CUSTOMER = /\bnon[-\s]?(?:customers?|members?)\b/i;
// A rate or amount-based price cannot be added once to a withdrawal as a flat charge.
const AMOUNT_BASIS = /%|\bper\s*(?:\$|\d|dollars?\b|hundred\b|thousand\b)/i;

function hasSourceUrl(value: string | null | undefined): boolean {
  try {
    return ["https:", "http:"].includes(new URL(value ?? "").protocol);
  } catch {
    return false;
  }
}

function live(fees: ExtractedFee[]): ExtractedFee[] {
  return fees.filter((fee) => {
    const frequency = frequencyFamily(fee.frequency?.trim().toLowerCase());
    return (
      fee.review_status === "approved" &&
      fee.fee_category === "atm_non_network" &&
      fee.amount != null &&
      fee.amount > 0 &&
      frequency === "per_item" &&
      !AMOUNT_BASIS.test(`${fee.fee_name} ${fee.source_line ?? ""}`) &&
      hasSourceUrl(fee.source_url) &&
      countsInMarketComparison({
        category: fee.fee_category,
        amount: fee.amount,
        audience: fee.fee_audience,
        sourced: fee.source_document_id != null,
        sourceUrl: fee.source_url,
        feeName: fee.fee_name,
        accountProduct: fee.account_product_type,
        sourceLine: fee.source_line,
        frequency: fee.frequency,
      })
    );
  });
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

/** The holder's fee must name a withdrawal; an inquiry or generic ATM service is not enough. */
export function pickHolderFee(fees: ExtractedFee[]): AtmFeeLine | null {
  const fee = live(fees).find(
    (row) => !NON_CUSTOMER.test(row.fee_name) && /\bwithdrawals?\b/i.test(row.fee_name),
  );
  return fee ? line(fee) : null;
}

/** The machine owner's published surcharge for people who are not its customers. */
export function pickOwnerSurcharge(fees: ExtractedFee[]): AtmFeeLine | null {
  const fee = live(fees).find((row) => NON_CUSTOMER.test(row.fee_name) && /\bsurcharge\b/i.test(row.fee_name));
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
