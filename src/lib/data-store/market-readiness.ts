import { sql } from "./connection";

/**
 * Market readiness: is there enough live fee data in a market for a competitive report?
 *
 * An institution is "rich" when it has at least RICH_MIN_CATEGORIES of the 15 headline
 * fee categories live in published_fee_catalog. A market (one state, one charter type) is
 * ready when at least MARKET_READY_MIN_RICH of its institutions are rich, so a report can
 * compare a bank with real local peers instead of a national fallback.
 */
export const HEADLINE_FEE_KEYS = [
  "monthly_maintenance",
  "overdraft",
  "nsf",
  "atm_non_network",
  "card_foreign_txn",
  "wire_domestic_outgoing",
  "stop_payment",
  "wire_intl_outgoing",
  "wire_domestic_incoming",
  "cashiers_check",
  "od_protection_transfer",
  "paper_statement",
  "minimum_balance",
  "card_replacement",
  "deposited_item_return",
] as const;

export const RICH_MIN_CATEGORIES = 9;
export const MARKET_READY_MIN_RICH = 15;

export interface MarketReadiness {
  state_code: string;
  charter_type: string;
  /** Institutions of this type the index tracks in the state. */
  institutions: number;
  /** Institutions with RICH_MIN_CATEGORIES+ headline categories live. */
  rich: number;
  /** rich / MARKET_READY_MIN_RICH, capped at 1 — for shading. */
  progress: number;
  ready: boolean;
}

/** An institution is rich when RICH_MIN_CATEGORIES+ of the headline categories are live. */
export function isInstitutionRich(headlineCategories: number): boolean {
  return headlineCategories >= RICH_MIN_CATEGORIES;
}

export function isMarketReady(rich: number): boolean {
  return rich >= MARKET_READY_MIN_RICH;
}

export function toMarketReadiness(row: {
  state_code: string;
  charter_type: string;
  institutions: string | number;
  rich: string | number;
}): MarketReadiness {
  const rich = Number(row.rich);
  return {
    state_code: row.state_code,
    charter_type: row.charter_type,
    institutions: Number(row.institutions),
    rich,
    progress: Math.min(1, rich / MARKET_READY_MIN_RICH),
    ready: isMarketReady(rich),
  };
}

/** Readiness for every state and charter type the index tracks. */
export async function getMarketReadiness(): Promise<MarketReadiness[]> {
  const keys = [...HEADLINE_FEE_KEYS];
  const rows = await sql<
    { state_code: string; charter_type: string; institutions: string; rich: string }[]
  >`
    WITH coverage AS (${headlineCoverageSql(keys)})
    SELECT s.state_code, s.charter_type,
           COUNT(*) AS institutions,
           COUNT(*) FILTER (WHERE coverage.categories >= ${RICH_MIN_CATEGORIES}) AS rich
    FROM institution_sources s
    LEFT JOIN coverage ON coverage.institution_id = s.id
    WHERE s.state_code IS NOT NULL AND s.charter_type IS NOT NULL
    GROUP BY s.state_code, s.charter_type
    ORDER BY s.state_code, s.charter_type`;
  return rows.map(toMarketReadiness);
}

/**
 * Distinct headline categories live per institution, the same count getMarketReadiness
 * uses. Institutions with none are returned as 0, so every requested id has an entry.
 */
export async function getInstitutionHeadlineCoverage(ids: number[]): Promise<Map<number, number>> {
  const wanted = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  const coverage = new Map<number, number>(wanted.map((id) => [id, 0]));
  if (wanted.length === 0) return coverage;
  const keys = [...HEADLINE_FEE_KEYS];
  const rows = await sql<{ institution_id: number; categories: string }[]>`
    WITH coverage AS (${headlineCoverageSql(keys, wanted)})
    SELECT institution_id, categories FROM coverage`;
  for (const row of rows) coverage.set(Number(row.institution_id), Number(row.categories));
  return coverage;
}

function headlineCoverageSql(keys: string[], institutionIds?: number[]) {
  return sql`
    SELECT institution_id, COUNT(DISTINCT canonical_fee_key) AS categories
    FROM published_fee_catalog
    WHERE canonical_fee_key = ANY(${keys})
      ${institutionIds ? sql`AND institution_id = ANY(${institutionIds})` : sql``}
    GROUP BY institution_id`;
}
