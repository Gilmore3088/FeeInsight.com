/**
 * The kind of account a product name says (#1100, #1912). A leaf module with no database import:
 * Knox's lineup reads (`lineup.ts`) tell a heading's account from the fee's own with it, and the
 * statistics contract's rule 11 (`fee-product.ts`) keeps a savings, money market, certificate,
 * IRA, HSA or club account's own monthly or minimum-balance fee out of the bank's checking value.
 * `accountKindSql` is the SQL twin; `account-kind.test.ts` holds the two together.
 */

import { namesNoAccount, namesNoAccountSql } from "./account-name-exclusions";

/** Checking, glued to a name too ("eChecking", "MyChecking"), and a credit union's share draft. */
export const CHECKING_WORDS = /checking\b|\bshare\s*drafts?\b/i;

export type AccountKind = "business" | "money_market" | "ira_hsa_cd" | "checking" | "club" | "savings";

/** Ordered as read: the first that matches decides ("Money Market Checking" is money market). */
const KIND_RULES: readonly { kind: AccountKind; ts: RegExp; sql: string }[] = [
  { kind: "business", ts: /\b(?:business|commercial|non-?profit|corporate)\b/i, sql: "\\y(business|commercial|non-?profit|corporate)\\y" },
  { kind: "money_market", ts: /\bmoney\s*market\b|\bmmda\b/i, sql: "\\ymoney\\s*market\\y|\\ymmda\\y" },
  { kind: "ira_hsa_cd", ts: /\b(?:ira|hsa|health savings|certificates?|cds?)\b/i, sql: "\\y(ira|hsa|health savings|certificates?|cds?)\\y" },
  { kind: "checking", ts: CHECKING_WORDS, sql: "checking\\y|\\yshare\\s*drafts?\\y" },
  { kind: "club", ts: /\b(?:christmas|holiday|vacation)\b/i, sql: "\\y(christmas|holiday|vacation)\\y" },
  // A kids' club is a kids' savings account ("Money Tree Kids Club", 643669); checking is checked above.
  { kind: "savings", ts: /\b(?:savings?|savers?|share|passbook)\b|\bkids?'?s?\s+club\b/i, sql: "\\y(savings?|savers?|share|passbook)\\y|\\ykids?'?s?\\s+club\\y" },
];

/** The kind of account a name says; null when it says none. */
export function accountKind(name: string | null | undefined): AccountKind | null {
  if (!name) return null;
  for (const rule of KIND_RULES) if (rule.ts.test(name)) return rule.kind;
  return null;
}

/** Kinds whose own monthly or minimum-balance fee is not a checking account's price (#1912). */
export const NON_CHECKING_ACCOUNT_KINDS: ReadonlySet<AccountKind> = new Set(["money_market", "ira_hsa_cd", "club", "savings"]);

/**
 * Rule 11 reads a name that also says checking ("Money Market Checking", "NOW/MONEYMARKET/DEMAND
 * ACCOUNT CHECKING FEES") or names loans ("Share and Loan Accounts", a credit union's whole
 * schedule) as no savings account: `accountKind`'s money-market-first order is for Knox's heading
 * reads, and setting such a row aside would take a checking price out of the checking value.
 */
const NAMES_CHECKING_OR_LOANS = /checking\b|\bshare\s*drafts?\b|\bdemand\b|\bloans?\b/i;
const NAMES_CHECKING_OR_LOANS_SQL = "checking\\y|\\yshare\\s*drafts?\\y|\\ydemand\\y|\\yloans?\\y";

/**
 * A named savings, money market, certificate, IRA, HSA or club account (by `accountKind`). A stored
 * name that carries a phrase naming no account ("Truth in Savings", "Hotel Savings Network",
 * "Bangor Savings Bank", `namesNoAccount`) is not read as one: what it says is not the account.
 */
export function isNonCheckingAccount(name: string | null | undefined): boolean {
  if (!name || namesNoAccount(name) || NAMES_CHECKING_OR_LOANS.test(name)) return false;
  const kind = accountKind(name);
  return kind !== null && NON_CHECKING_ACCOUNT_KINDS.has(kind);
}

/** Static internal columns only (`alias.column`). */
function checkColumn(column: string): void {
  if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/i.test(column)) throw new Error("Invalid internal account column");
}

/** SQL twin of accountKind over a text column: the kind as text, NULL when it says none. */
export function accountKindSql(column: string): string {
  checkColumn(column);
  const branches = KIND_RULES.map((rule) => `WHEN ${column} ~* '${rule.sql.replace(/'/g, "''")}' THEN '${rule.kind}'`).join(" ");
  return `(CASE ${branches} ELSE NULL END)`;
}

/** SQL twin of isNonCheckingAccount: true or false, never NULL. */
export function nonCheckingAccountSql(column: string): string {
  const kinds = [...NON_CHECKING_ACCOUNT_KINDS].map((kind) => `'${kind}'`).join(", ");
  return `COALESCE(NOT ${namesNoAccountSql(column)} AND ${column} !~* '${NAMES_CHECKING_OR_LOANS_SQL}' AND ${accountKindSql(column)} IN (${kinds}), false)`;
}
