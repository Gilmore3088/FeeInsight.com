import { sql } from "@/lib/data-store/connection";
import { STATS_ROW_FILTER, valuePerInstitution } from "@/lib/data-store/fee-stats";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import type { MarketRow } from "./market-spread";

/**
 * Build plan 2.7: a post's low and high end are checked against the institution's own fee
 * schedule before a draft is made. The ends are the figures a reader checks first, and a
 * misread at either end makes the whole post wrong. An institution at an end passes only
 * when every catalog row behind its value states that amount in its stored source text
 * (`checkFeeAgainstSource`, the one shared accuracy check). A spread with an end that
 * fails is passed over for the next one.
 */

type SqlTag = typeof sql;

const cents = (value: number) => Math.round(value * 100) / 100;

/** Institutions whose one value for this metro and fee is the spread's low or high. */
export function endInstitutions(rows: MarketRow[], metro: string, feeCategory: string, low: number, high: number): number[] {
  const values = valuePerInstitution(rows.filter((row) => row.cbsa_name === metro && row.fee_category === feeCategory));
  return [...values].filter(([, value]) => cents(value) === low || cents(value) === high).map(([id]) => id).sort((a, b) => a - b);
}

export interface EndRow {
  institution_id: number | string;
  fee_name: string;
  amount: number | string;
  canonical_fee_key: string | null;
  /** The newest completed text of the row's source document, or null when none is stored. */
  normalized_text: string | null;
}

/**
 * Institutions whose value can't be traced to their own schedule. The rows checked are the
 * ones whose amount is the institution's value (overdraft's highest tier, or the one amount
 * at the middle); when the value is the midpoint of two amounts, every row is checked.
 */
export function failingEnds(rows: EndRow[]): number[] {
  const byInstitution = new Map<number, EndRow[]>();
  for (const row of rows) {
    const id = Number(row.institution_id);
    const list = byInstitution.get(id);
    if (list) list.push(row);
    else byInstitution.set(id, [row]);
  }
  const failing: number[] = [];
  for (const [id, list] of byInstitution) {
    const value = valuePerInstitution(list.map((row) => ({ institution_id: id, amount: row.amount, fee_category: row.canonical_fee_key }))).get(id);
    const atValue = list.filter((row) => value !== undefined && cents(Number(row.amount)) === cents(value));
    const checked = atValue.length > 0 ? atValue : list;
    const traced = checked.every(
      (row) => checkFeeAgainstSource(row.normalized_text, row.fee_name, Number(row.amount), ".", row.canonical_fee_key).ok,
    );
    if (!traced) failing.push(id);
  }
  return failing.sort((a, b) => a - b);
}

export async function loadEndRows(db: SqlTag, feeCategory: string, institutionIds: number[]): Promise<EndRow[]> {
  if (institutionIds.length === 0) return [];
  const rows = await db.unsafe(
    `SELECT ef.institution_id, ef.fee_name, ef.amount, ef.canonical_fee_key, t.normalized_text
       FROM published_fee_catalog ef
       LEFT JOIN LATERAL (
         SELECT ast.normalized_text FROM agent_source_texts ast
          WHERE ast.source_document_id = ef.source_document_id
            AND ast.status = 'completed' AND ast.normalized_text IS NOT NULL
          ORDER BY ast.id DESC LIMIT 1
       ) t ON true
      WHERE ${STATS_ROW_FILTER}
        AND ef.fee_category = $1
        AND ef.institution_id = ANY($2::bigint[])
        AND ef.amount IS NOT NULL AND ef.amount >= 0`,
    [feeCategory, institutionIds],
  );
  return rows as unknown as EndRow[];
}

export interface EndCheck {
  checked: number;
  failing: number[];
}

/** Loads and checks the institutions at a spread's two ends. */
export async function checkSpreadEnds(
  db: SqlTag,
  rows: MarketRow[],
  spread: { metro: string; feeCategory: string; low: number; high: number },
): Promise<EndCheck> {
  const ids = endInstitutions(rows, spread.metro, spread.feeCategory, spread.low, spread.high);
  const endRows = await loadEndRows(db, spread.feeCategory, ids);
  const loaded = new Set(endRows.map((row) => Number(row.institution_id)));
  // An end institution whose rows didn't come back has nothing to trace it to.
  const missing = ids.filter((id) => !loaded.has(id));
  return { checked: ids.length, failing: [...failingEnds(endRows), ...missing].sort((a, b) => a - b) };
}
