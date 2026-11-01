/**
 * #1100 (Knox v149, guard v102): a named service's own monthly charge is not the account's monthly
 * maintenance fee. Schedules price online banking, bill payer, text banking, mobile check deposit,
 * remote capture, balance reporting, coin orders, telephone transfers and debit or merchant card
 * programs "per month" in their own rows ("Bill Payer (monthly fee) | Free", "OLB Monthly Maintenance |
 * $0.00", "Remote Capture Monthly Fee - $50.00", "VISA/MasterCard Monthly Fee | $7.75" under
 * "Merchant Service Fees"). Their "monthly fee" words matched the generic maintenance pattern, so 17
 * live rows at 17 banks sat in monthly maintenance (Nov 1, read-only), 11 of them at $0, pulling the
 * category's free share and medians.
 *
 * Shared by Knox's classifier (`classifyPatternKey`) and the category guard's monthly maintenance
 * exclusion and re-file rules, so a new read and a live fee are judged by the same words.
 *
 * A service named only inside a waiver ("Use your debit card 15 or more times per month and we'll
 * waive the monthly fee", "monthly service charge waived with online banking") is the account's
 * condition, not the fee's subject, so it does not count; nor do plural "mobile deposits" ("monthly
 * service charge if no direct or mobile deposits"), which read as the account's activity.
 */
export const SERVICE_MONTHLY_CHARGE_NAME =
  /(?<!\bwaiv\w*\b[^|]{0,60})(?<!\buse\s+(?:your\s+|the\s+|a\s+)?)\b(?:bill\s?pay(?:ers?|ing)|on-?line\s+banking|internet\s+banking|olb|text\s+banking|mobile\s+(?:check\s+)?deposit|remote\s+capture|balance\s+reporting|telephone\s+transfers?|coin\s+orders?|visa\s*\/\s*master\s?card|(?:debit|check|atm|visa)\s+cards?)\b/i;

/** "Bill Payer (monthly fee)", "BillPayer Monthly Fee": the bill pay service's monthly fee. */
export const BILL_PAYER_NAME = /\bbill\s?payers?\b/i;

/** "Mobile Check Deposit - Monthly Service": the mobile deposit service's monthly fee. */
export const MOBILE_CHECK_DEPOSIT_NAME = /\bmobile\s+(?:check\s+)?deposit\b/i;

/**
 * Where a monthly charge named for a service belongs: `bill_pay` for a bill payer service,
 * `mobile_deposit` for mobile check deposit, `null` for the other services (no type of the 50 holds
 * online banking, text banking, remote capture, balance reporting, coin orders, telephone transfers
 * or a card program's monthly charge), and `undefined` when the name names no such service.
 */
export function serviceMonthlyTarget(name: string): "bill_pay" | "mobile_deposit" | null | undefined {
  if (!SERVICE_MONTHLY_CHARGE_NAME.test(name)) return undefined;
  if (BILL_PAYER_NAME.test(name)) return "bill_pay";
  if (MOBILE_CHECK_DEPOSIT_NAME.test(name)) return "mobile_deposit";
  return null;
}
