import { withoutNonAccountWords } from "@/lib/account-name-exclusions";

/**
 * #1100 gap 1 (James, Oct 16, option 1): `monthly_maintenance` is the consumer checking account's
 * monthly fee. A monthly fee of another kind of account (savings, money market, club, business,
 * IRA/HSA/CD) is kept, stored as verified with its account type (`account_type:<type>`), and never
 * published under `monthly_maintenance`. Pure.
 *
 * The type is read from the account the fee belongs to: Knox's lineup product name
 * (`raw_fee_observations.product_name`, the catalog's `account_product_type`) first, then the fee's
 * own name. A name that says checking is a checking account unless it is a business or money
 * market account ("Money Market Checking" is a money market account; "Club Five Checking" is
 * checking). Unknown stays unknown: no type means the fee is read as it is today.
 */
export type AccountType = "business" | "money_market" | "ira_hsa_cd" | "club" | "savings";

export const ACCOUNT_TYPES: readonly AccountType[] = ["business", "money_market", "ira_hsa_cd", "club", "savings"];

/** The verified-row flag a held fee carries. */
export const ACCOUNT_TYPE_FLAG_PREFIX = "account_type:";
export const accountTypeFlag = (type: AccountType) => `${ACCOUNT_TYPE_FLAG_PREFIX}${type}`;

/** Categories whose fee is a consumer checking account's: only these hold a typed fee back. */
export const CHECKING_ONLY_CATEGORIES: ReadonlySet<string> = new Set(["monthly_maintenance"]);

const BUSINESS = /\b(?:business|commercial|small\s*biz|non-?profit|npo|church\w*|ministr\w*|organizations?|public\s+funds?|municipal\w*|government\w*|escrow|iolta|sole\s+prop\w*|corporate|analysis|treasury|(?:business|trust)\s+(?:account|checking))\b/i;
const MONEY_MARKET = /\b(?:money\s*market|mmda|mma)\b/i;
const IRA_HSA_CD = /\b(?:ira|iras|roth|individual\s+retirement|hsa|health\s+savings|certificates?(?:\s+of\s+deposit)?|cds?|time\s+deposits?|term\s+shares?|share\s+certificates?)\b/i;
/**
 * A club savings account (Christmas, holiday, vacation). A bare "Club" is no type: "Century Club",
 * "VIP Club Account" and "Prime Time Club" are checking packages.
 */
const CLUB = /\b(?:christmas|holiday|vacation)\b|\bclub\s+(?:savings|account\s+savings)\b|\bsavings\s+club\b/i;
/**
 * A savings account. A bare "share" is no type (#1566 re-review: "Monthly Service Fee (Share Type
 * 72)" sits under "Share Draft Account", and "Share-to-Share Overdraft Transfer Fee" is a checking
 * account's transfer). A share counts only with a savings word: "share savings", "share account",
 * "regular/primary/membership share", "FAT CAT Share".
 * A kids' club ("Money Tree Kids Club", 643669) is a kids' savings account, unless its name says
 * checking (checked before this).
 */
const SAVINGS =
  /\b(?:savings?|savers?|passbook|statement\s+savings|shares?\s+(?:savings|accounts?|relationship)|(?:regular|primary|prime|basic|base|membership|member|youth|kids?|junior|statement|holiday|fat\s+cat)\s+shares?|kids?'?s?\s+club)\b/i;
const CHECKING = /checking\b|\b(?:share\s*drafts?|draft\s+account)\b/i;

/** The account type one text names, or null for checking or no type. */
export function accountTypeOfText(text: string | null | undefined, institutionName?: string | null): AccountType | null {
  const value = withoutNonAccountWords(text ?? "", institutionName).replace(/\s+/g, " ").trim();
  if (!value) return null;
  if (BUSINESS.test(value)) return "business";
  if (MONEY_MARKET.test(value)) return "money_market";
  if (IRA_HSA_CD.test(value)) return "ira_hsa_cd";
  // "Club Five Checking", "Savings Plus Checking": a checking account under another word.
  if (CHECKING.test(value)) return null;
  if (CLUB.test(value)) return "club";
  if (SAVINGS.test(value)) return "savings";
  return null;
}

/**
 * The non-checking account a monthly fee belongs to, or null. The product decides when it names
 * one; the fee's name decides only when the product names none ("Statement Savings Monthly Fee"
 * with no lineup product).
 */
export function accountTypeOf(
  productName: string | null | undefined,
  feeName: string | null | undefined,
  institutionName?: string | null,
): AccountType | null {
  // A fee whose own name says checking ("Personal Checking Service charge") is that checking
  // account's, whatever the product above it says (#1566 review).
  const fee = withoutNonAccountWords(feeName ?? "", institutionName);
  if (CHECKING.test(fee)) return accountTypeOfText(fee);
  const product = withoutNonAccountWords(productName ?? "", institutionName).trim();
  if (product) {
    const fromProduct = accountTypeOfText(product);
    // A product that is a checking account ("Regular Checking") is checking, whatever the fee's words.
    if (fromProduct || CHECKING.test(product)) return fromProduct;
  }
  return accountTypeOfText(fee);
}

/** The account type a held verified row carries, from its flags, or null. */
export function heldAccountType(flags: readonly string[]): AccountType | null {
  const flag = flags.find((item) => item.startsWith(ACCOUNT_TYPE_FLAG_PREFIX));
  const type = flag?.slice(ACCOUNT_TYPE_FLAG_PREFIX.length) as AccountType | undefined;
  return type && ACCOUNT_TYPES.includes(type) ? type : null;
}
