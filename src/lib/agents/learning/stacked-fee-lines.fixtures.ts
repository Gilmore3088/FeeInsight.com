/**
 * Fee schedules laid out one cell per line (#1094, kind v2): the fee name, a blank line, then the
 * amount, as a web page's two-column fee table reads once its cells are split. Excerpts of stored
 * production texts (2026-11-02), each labeled "other" at kind v1 with live fees on it, with the
 * site navigation cut. Not a model of every page, a regression set.
 */

/** progressivenational.com/account-services (doc 16169): 11 fee labels, each with its amount below. */
export const PROGRESSIVE_ACCOUNT_SERVICES = `Account Services

We offer a variety of Account Services for you to choose from. Contact us if you require any additional information.

FEE

AOD/NSF PAID FEE:

$30.00
Overdraft Fee (Per Check, Draft, or EFT. If previously returned item is represented and paid in the overdraft, and overdraft fee may be charged.)

NSF FEE:

$30.00
(Each time an item is presented and returned; an NSF fee may be charged. An item that is returned NSF may be represented for payment multiple times.)

OVERDRAFT FEE:

$30.00

OVERDRAFT DAILY FEE:

$4.00

CHARGE BACK CHECK FEE:

$12.50

INACTIVE FEE:

per month $5.00
(If balance falls under $200.00 on accounts with no activity for at least 6 months.)

STOP PAYMENTS:

$25.00

ACCT RESEARCH (MIN. 1 HR.):

per hour $20.00

CLOSE ACCT FEE – 6 MO.:

$20.00

PHONE ACCT INQ.:

$1.00

Lost Debit Card Replacement:

$5.00

STATEMENT PRINTOUTS:

$3.00

BILL PAY:

monthly $0.00

NIGHT DEPOSIT BAGS:

each $15.00

SCHEDULE A CALL TODAY`;

/** legacycreditunion.com/banking-fees (doc 26406): section headings with an "Amount" column cell. */
export const LEGACY_BANKING_FEES = `Banking Fees

To make things easy for members, we keep our fees low, simple, and straightforward so that our members never get blind sighted by unwanted fees or charges. That’s why we’ve made our fee schedule available below.

Account Fees

Amount

Account Statement Photocopy (per page)

$1.00

ACH Fees

Amount

ACH Stop Pay

$32.00

ATM Fees

Amount

Non-LCFCU ATM Inquiry/Denial**

$1.00

Checking Account Fees:

Amount

Christmas Club Early Withdrawal

$10.00

Overdraft Protection Transfer

$3.00

NSF/Stop Pay/Courtesy Pay

$32.00

VISA Credit Card Fees:

Amount

NSF/Courtesy Pay

$32.00

Returned check on payment

$25.00

Late Payment Fee

$25.00

Card Replacement Fee

$25.00

Debit Card Fees

Amount

Overdraft Protection Transfer Fee

$3.00

Card Replacement

$10.00

Loan Fees

Amount

Cashier’s Checks/Official Checks

$2.00

Money Orders

$2.00

Minimum Late Charge

$.50

Late Charge

5% of payment due

Share Account Fees

Amount

Wire Transfer

$10.00

Phone Inquiry Fee (per call)

$1.00

Dormancy (monthly charge) – after one year of inactivity

$5.00`;

/** A savings rate table set one cell per line: balance cells under account names, not fees. */
export const STACKED_RATES_PAGE = `Savings Rates

Rates effective November 1, 2026. APY = Annual Percentage Yield.

${["Regular", "Holiday Club", "Vacation Club", "Youth", "Senior", "IRA", "HSA", "Business", "Premier", "Escrow", "Trust", "Christmas Club"]
  .map((account) => `${account} Statement Savings\n\n$100.00\n\nAPY 0.05%`)
  .join("\n\n")}`;

/** A Truth in Savings disclosure whose minimum-balance cells sit under statement-account names. */
export const STACKED_TIS_DISCLOSURE = `TRUTH-IN-SAVINGS DISCLOSURE

ACCOUNT DISCLOSURES

${["Statement Savings", "Statement Club Account", "Statement Money Market", "Statement Youth Savings", "Statement IRA Share", "Statement Holiday Share"]
  .map((account) => `${account}\n\nMinimum to open\n\n$25.00`)
  .join("\n\n")}

Dividends are paid monthly. Fees may reduce earnings.`;

/** A checking account page: each account's monthly fee one cell per line. */
export const STACKED_CHECKING_PAGE = `Explore Our Checking Accounts

${["Freedom Checking", "Secure Checking", "Premier Checking", "Student Checking", "Senior Checking", "Business Checking"]
  .map((account) => `${account}\n\nOpen Account\n\nMonthly Service Fees\n\n$10\n\n$8 with eStatement\n\nOverdraft Fee\n\n$30`)
  .join("\n\n")}`;
