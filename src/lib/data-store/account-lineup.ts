import { getSql } from "./connection";
import { STATS_ROW_FILTER } from "./fee-stats";
import { AMOUNT_PATTERN, BALANCE_BELOW_CLAUSE } from "@/lib/agents/knox/rules";

/**
 * Account lineup: each checking or savings account a bank publishes, with its monthly fee,
 * the balance that avoids the fee, and how else the fee is waived.
 *
 * Knox stores these as lineup fields (account_product_type, min_balance_to_avoid,
 * waiver_text) on few rows so far. Where a field is empty, it is read from the row's own
 * schedule line (`excerpt="..."` in conditions) and fee name, and marked `derived` so a
 * reader can tell it apart from what Knox stored. Nothing here writes to the database.
 */

export interface LineupCatalogRow {
  institution_id: number;
  fee_name: string;
  amount: number | string | null;
  conditions: string | null;
  account_product_type: string | null;
  min_balance_to_avoid: number | string | null;
  min_opening_deposit: number | string | null;
  waiver_text: string | null;
}

export type LineupFieldSource = "stored" | "derived" | null;

export interface LineupAccount {
  institutionId: number;
  productName: string | null;
  productNameSource: LineupFieldSource;
  monthlyFee: number;
  minBalanceToAvoid: number | null;
  minBalanceSource: LineupFieldSource;
  minOpeningDeposit: number | null;
  waiverText: string | null;
  waiverSource: LineupFieldSource;
  feeName: string;
}

export interface LineupSummary {
  institutions: number;
  accounts: number;
  lowestMonthlyFee: number | null;
  medianMonthlyFee: number | null;
  /** Share of institutions with at least one account that has no monthly fee. */
  shareWithFreeAccount: number | null;
  medianMinBalanceToAvoid: number | null;
  /** Share of fee-charging accounts that say how the fee is avoided (a balance or waiver). */
  shareWithWayToAvoid: number | null;
}

export interface LineupComparison {
  subject: LineupSummary & { accountsList: LineupAccount[] };
  peers: LineupSummary;
}

const toNumber = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};

/** The schedule line Knox read the row from, if its conditions kept one. */
export function catalogExcerpt(conditions: string | null): string | null {
  const match = conditions?.match(/excerpt="((?:[^"\\]|\\.)*)"/);
  return match ? match[1].replace(/\\"/g, "\"").trim() || null : null;
}

/** Fee words at the end of a fee name; what is left in front of them may be the account. */
const FEE_NAME_TAIL =
  /\s*[-–:]?\s*(?:low balance\s+)?(?:monthly\s+)?(?:maintenance\s+|service\s+|account\s+)*(?:fee|charge|service charge|maintenance)s?\s*$/i;
const GENERIC_PRODUCT_WORDS =
  /^(?:monthly|maintenance|service|account|accounts|fee|fees|charge|low|balance|minimum|min\.?|the|a|an|for|per|month|regular|standard|basic|all|each|if|of|and|or)$/i;

/** "Freedom Start-Up Monthly Fee" -> "Freedom Start-Up"; generic or sentence-like names give null. */
export function productNameFromFeeName(feeName: string): string | null {
  const prefix = feeName.replace(FEE_NAME_TAIL, "").replace(/[\s\-–:|]+$/, "").trim();
  if (!prefix || prefix === feeName.trim()) return null;
  if (!/^[A-Z0-9]/.test(prefix) || /[$\d]{2,}|[.;,]/.test(prefix)) return null;
  const words = prefix.split(/\s+/);
  if (words.length > 6 || words.every((word) => GENERIC_PRODUCT_WORDS.test(word))) return null;
  return prefix.slice(0, 80);
}

/** "if balance falls below $1,000" -> 1000. Also "minimum daily balance of $20,000 ... to avoid". */
export function minBalanceFromExcerpt(excerpt: string): number | null {
  const clause =
    excerpt.match(BALANCE_BELOW_CLAUSE)?.[0] ??
    excerpt.match(/\bminimum\s+(?:(?:daily|average|monthly|collected|ledger)\s+){0,3}balance\s+of\s+\$\s?[\d,]+(?:\.\d{2})?(?=[^|]{0,60}\bavoid)/i)?.[0];
  if (!clause) return null;
  const figure = [...clause.matchAll(AMOUNT_PATTERN)].at(-1)?.[1];
  const value = figure ? Number(figure.replace(/,/g, "")) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

const WAIVER_START = /\b(?:waived?|avoid(?:ed)?|unless|none with|no (?:monthly )?(?:fee|charge) (?:with|if|when))\b/i;

/** The words in the row's own cell that say how the fee is waived ("waived if a Direct Deposit ..."). */
export function waiverFromExcerpt(excerpt: string): string | null {
  const start = excerpt.search(WAIVER_START);
  if (start < 0) return null;
  const text = excerpt.slice(start).split("|")[0].replace(/[\s.;,)]+$/, "").trim();
  return text.length >= 8 ? text.slice(0, 160) : null;
}

/** One catalog row as a lineup account, stored fields first, derived fields where empty. */
export function lineupAccountFromRow(row: LineupCatalogRow): LineupAccount | null {
  const monthlyFee = toNumber(row.amount);
  if (monthlyFee === null || monthlyFee < 0) return null;
  const excerpt = catalogExcerpt(row.conditions) ?? "";

  const storedName = row.account_product_type?.trim() || null;
  const derivedName = storedName ? null : productNameFromFeeName(row.fee_name);
  const storedBalance = toNumber(row.min_balance_to_avoid);
  const derivedBalance = storedBalance === null && excerpt ? minBalanceFromExcerpt(excerpt) : null;
  const storedWaiver = row.waiver_text?.trim() || null;
  const derivedWaiver = storedWaiver || !excerpt ? null : waiverFromExcerpt(excerpt);

  return {
    institutionId: Number(row.institution_id),
    productName: storedName ?? derivedName,
    productNameSource: storedName ? "stored" : derivedName ? "derived" : null,
    monthlyFee,
    minBalanceToAvoid: storedBalance ?? derivedBalance,
    minBalanceSource: storedBalance !== null ? "stored" : derivedBalance !== null ? "derived" : null,
    minOpeningDeposit: toNumber(row.min_opening_deposit),
    waiverText: storedWaiver ?? derivedWaiver,
    waiverSource: storedWaiver ? "stored" : derivedWaiver ? "derived" : null,
    feeName: row.fee_name,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Totals for a set of accounts; shares are null when there is nothing to divide by. */
export function summarizeLineup(accounts: LineupAccount[]): LineupSummary {
  const institutions = new Set(accounts.map((account) => account.institutionId));
  const withFree = new Set(accounts.filter((account) => account.monthlyFee === 0).map((account) => account.institutionId));
  const charging = accounts.filter((account) => account.monthlyFee > 0);
  const avoidable = charging.filter((account) => account.minBalanceToAvoid !== null || account.waiverText !== null);
  const fees = accounts.map((account) => account.monthlyFee);
  return {
    institutions: institutions.size,
    accounts: accounts.length,
    lowestMonthlyFee: fees.length ? Math.min(...fees) : null,
    medianMonthlyFee: median(fees),
    shareWithFreeAccount: institutions.size ? withFree.size / institutions.size : null,
    medianMinBalanceToAvoid: median(
      accounts.map((account) => account.minBalanceToAvoid).filter((value): value is number => value !== null),
    ),
    shareWithWayToAvoid: charging.length ? avoidable.length / charging.length : null,
  };
}

/** One bank's lineup against its peers (peer rows for the subject itself are ignored). */
export function compareAccountLineups(subjectId: number, accounts: LineupAccount[]): LineupComparison {
  const subjectAccounts = accounts.filter((account) => account.institutionId === subjectId);
  const peerAccounts = accounts.filter((account) => account.institutionId !== subjectId);
  return {
    subject: { ...summarizeLineup(subjectAccounts), accountsList: subjectAccounts },
    peers: summarizeLineup(peerAccounts),
  };
}

/** Live monthly maintenance rows for these institutions, as lineup accounts. */
export async function getAccountLineups(institutionIds: number[]): Promise<LineupAccount[]> {
  const ids = [...new Set(institutionIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return [];
  const sql = getSql();
  const rows = (await sql.unsafe(
    `SELECT ef.institution_id, ef.fee_name, ef.amount, ef.conditions, ef.account_product_type,
            ef.min_balance_to_avoid, ef.min_opening_deposit, ef.waiver_text
       FROM published_fee_catalog ef
      WHERE ef.canonical_fee_key = 'monthly_maintenance'
        AND ef.review_status = 'approved'
        AND ${STATS_ROW_FILTER}
        AND ef.institution_id = ANY($1::int[])
      ORDER BY ef.institution_id, ef.amount, ef.fee_name`,
    [ids] as never[],
  )) as unknown as LineupCatalogRow[];
  return rows.map(lineupAccountFromRow).filter((account): account is LineupAccount => account !== null);
}
