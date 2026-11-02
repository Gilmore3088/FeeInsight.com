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
 * v2 (Knox v166, guard v106; re-read backlog dry run, Nov 2): mobile banking and hold mail are such
 * services too ("Mobile Banking Monthly Service Charge | No Fee", BAC Community Bank 1265; "Hold Mail –
 * monthly fee (refer to agreement) | No Fee", Intercredit Bank 827). Neither has a type of the 50.
 *
 * Shared by Knox's classifier (`classifyPatternKey`) and the category guard's monthly maintenance
 * exclusion and re-file rules, so a new read and a live fee are judged by the same words.
 *
 * A service named only inside a waiver ("Use your debit card 15 or more times per month and we'll
 * waive the monthly fee", "monthly service charge waived with online banking") is the account's
 * condition, not the fee's subject, so it does not count; nor do plural "mobile deposits" ("monthly
 * service charge if no direct or mobile deposits"), which read as the account's activity.
 */
const SERVICE_WORDS =
  String.raw`bill\s?pay(?:ers?|ing)|on-?line\s+banking|internet\s+banking|mobile\s+banking|hold\s+mail|olb|text\s+banking|mobile\s+(?:check\s+)?deposit|remote\s+capture|balance\s+reporting|telephone\s+transfers?|coin\s+orders?|visa\s*\/\s*master\s?card|(?:debit|check|atm|visa)\s+cards?`;
const BILL_PAYER_WORDS = String.raw`bill\s?payers?`;
const MOBILE_CHECK_DEPOSIT_WORDS = String.raw`mobile\s+(?:check\s+)?deposit`;

/**
 * A service word counts only when it is the row's subject: not when the name names a deposit account
 * ("Checking with Online Banking: $5 monthly fee", "Kasasa Cash Checking ... 12 debit card purchases"),
 * not inside the account's condition ("waived/avoid/eliminated/exempt/discount/not charged/free with/
 * $0 with/no fee if/required ... online
 * banking", "use your/of ... debit card"), and not as activity ("debit card purchases/transactions").
 * Every regex the guard and Hamilton use to move a fee is built the same way, so a service named in a
 * waiver never re-files an account fee to that service (#2855 review).
 */
function serviceName(words: string): RegExp {
  return new RegExp(
    String.raw`^(?![^|]*\b(?:checking|savings|share\s+(?:accounts?|drafts?)|money\s+market)\b)[^|]*?` +
      String.raw`(?<!(?:\b(?:waiv|avoid|requir|eliminat|exempt|discount)\w*|\bnot\s+(?:charged|using)\b|\bfree\s+(?:with|if|for)\b|\$0\s+(?:with|if|for)\b|\bno\s+(?:monthly\s+)?(?:fees?|charges?)\s+(?:with|if|for)\b)[^|]{0,100})` +
      String.raw`(?<!\buse\s+(?:your\s+|the\s+|a\s+|of\s+)?)` +
      String.raw`\b(?:${words})\b(?!\s+(?:purchases?|transactions?|trans?|uses?|users?|usage|swipes?)\b)`,
    "i",
  );
}

export const SERVICE_MONTHLY_CHARGE_NAME = serviceName(SERVICE_WORDS);

/** "Bill Payer (monthly fee)", "BillPayer Monthly Fee": the bill pay service's monthly fee. */
export const BILL_PAYER_NAME = serviceName(BILL_PAYER_WORDS);

/** "Mobile Check Deposit - Monthly Service": the mobile deposit service's monthly fee. */
export const MOBILE_CHECK_DEPOSIT_NAME = serviceName(MOBILE_CHECK_DEPOSIT_WORDS);

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
