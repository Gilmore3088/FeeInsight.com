/**
 * The notice rules that govern changing a fee, cited in the market context (`context.ts`).
 * Pure and client-safe. The plan for a price management chose was built here but never
 * reachable, and was removed (#1083); the Simulate plan uses `hamilton/implementation-plan.ts`.
 *
 * Notice rules cited (the bank's compliance team confirms what applies):
 * - Reg DD, 12 CFR 1030.5(a) (banks) and NCUA Part 707, 12 CFR 707.5(a) (credit unions):
 *   at least 30 days' advance notice of a change that may adversely affect the consumer.
 *   A change that is not adverse (a lower fee) needs no advance notice.
 * - Reg E, 12 CFR 1005.8(a): 21 days' notice of increased fees for electronic fund transfers.
 * - Reg E, 12 CFR 1005.17: the overdraft opt-in notice states the fee for ATM and one-time
 *   debit card overdrafts, so a changed overdraft fee means an updated notice.
 */

import { FEE_FAMILIES } from "@/lib/fee-taxonomy";
import type { SourceRef } from "./types";

export const ADVERSE_CHANGE_NOTICE_DAYS = 30;
export const EFT_FEE_NOTICE_DAYS = 21;

export const REG_DD_BANK: SourceRef = {
  label: "Reg DD, 12 CFR 1030.5(a)",
  url: "https://www.consumerfinance.gov/rules-policy/regulations/1030/5/",
};
export const REG_DD_CU: SourceRef = {
  label: "NCUA Truth in Savings, 12 CFR 707.5(a)",
  url: "https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-707/section-707.5",
};
export const REG_E_FEE_NOTICE: SourceRef = {
  label: "Reg E, 12 CFR 1005.8(a)",
  url: "https://www.consumerfinance.gov/rules-policy/regulations/1005/8/",
};
export const REG_E_OPT_IN: SourceRef = {
  label: "Reg E, 12 CFR 1005.17",
  url: "https://www.consumerfinance.gov/rules-policy/regulations/1005/17/",
};

const EFT_CATEGORIES = new Set<string>(FEE_FAMILIES["ATM & Card"] ?? []);

/** ATM and debit card fees, which Reg E's change-in-terms notice also covers. */
export function isEftFee(feeCategory: string): boolean {
  return EFT_CATEGORIES.has(feeCategory);
}
