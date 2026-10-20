import type { DisplayFee } from "./fee-schedule-table";

/** Identical display rows may collapse; distinct fee context must survive. Pure for audit replay. */
export function displayFeeIdentity(fee: Pick<DisplayFee,
  "feeCategory" | "feeName" | "rate" | "amount" | "frequency" | "conditions" | "accountProduct"
  | "feeAudience" | "feeTreatment" | "status" | "sourceUrl"
>): string {
  return JSON.stringify([
    fee.feeCategory,
    fee.feeName.trim().toLowerCase(),
    fee.rate ? [fee.rate.rate, fee.rate.detail] : fee.amount,
    fee.frequency,
    fee.conditions,
    fee.accountProduct ?? null,
    fee.feeAudience ?? "unknown",
    fee.feeTreatment ?? "unknown",
    fee.status,
    fee.sourceUrl,
  ]);
}
