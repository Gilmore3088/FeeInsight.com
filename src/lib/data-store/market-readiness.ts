import { sql } from "./connection";

/**
 * Market readiness: is there enough live fee data in a market for a competitive report?
 *
 * An institution is "rich" when it has at least RICH_MIN_CATEGORIES of the 15 headline
 * fee categories live in published_fee_catalog (or, for a rate, published_fee_rate_catalog). James's report rule: an institution can
 * get a report when it is rich and at least MIN_RICH_COMPETITORS other institutions of its
 * type in its state are rich. A market (one state, one charter type) is ready when a rich
 * institution there passes that rule, i.e. MARKET_READY_MIN_RICH rich institutions.
 * The institution report's quote check applies the same rule (custom-report/quote-check).
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
/** Rich same-state, same-type competitors a report needs, not counting the institution itself. */
export const MIN_RICH_COMPETITORS = 15;
/** Rich institutions a market needs so each of them has MIN_RICH_COMPETITORS rich competitors. */
export const MARKET_READY_MIN_RICH = MIN_RICH_COMPETITORS + 1;

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
  /**
   * In a market that is not ready: rich institutions here whose Fed district has
   * MARKET_READY_MIN_RICH+ rich institutions of the same type, so they pass the report rule
   * on district peers (James, 6 Oct 2026). 0 in a ready market, where the state peers apply.
   */
  richViaDistrict?: number;
}

/** An institution is rich when RICH_MIN_CATEGORIES+ of the headline categories are live. */
export function isInstitutionRich(headlineCategories: number): boolean {
  return headlineCategories >= RICH_MIN_CATEGORIES;
}

export function isMarketReady(rich: number): boolean {
  return rich >= MARKET_READY_MIN_RICH;
}

/**
 * James's report rule for one institution: RICH_MIN_CATEGORIES+ headline categories of its
 * own, and MIN_RICH_COMPETITORS+ rich institutions of its type besides itself: in its state,
 * or, when its state has too few, in its Fed district ("District fallback", James 6 Oct 2026).
 */
export function passesReportRule(ownCategories: number, stateRichCompetitors: number, districtRichCompetitors = 0): boolean {
  return (
    isInstitutionRich(ownCategories) &&
    (stateRichCompetitors >= MIN_RICH_COMPETITORS || districtRichCompetitors >= MIN_RICH_COMPETITORS)
  );
}

/**
 * Institutions passing the report rule across all markets: every rich institution in a ready
 * market, plus, in the other markets, the rich ones whose Fed district has enough peers.
 */
export function countInstitutionsPassingReportRule(
  markets: Pick<MarketReadiness, "rich" | "ready" | "richViaDistrict">[],
): number {
  return markets.reduce((total, market) => total + (market.ready ? market.rich : (market.richViaDistrict ?? 0)), 0);
}

export interface ReportRuleCheck {
  state_code: string | null;
  charter_type: string | null;
  fed_district: number | null;
  ownCategories: number;
  /** Rich institutions of the same type in the peer group the rule used, not counting this one. */
  richCompetitors: number;
  /** "state" while the state has enough rich peers; "district" when the rule fell back to the Fed district. */
  peerScope: "state" | "district";
  /** Rich same-type institutions in the state, not counting this one. */
  stateRichCompetitors: number;
  /** Rich same-type institutions in the Fed district, not counting this one; null without a district. */
  districtRichCompetitors: number | null;
  passes: boolean;
}

/**
 * Which peers the rule uses: the state whenever it has enough; otherwise the district when
 * that has enough; otherwise the state (the rule is not met, and the state is the first ask).
 */
export function reportRulePeers(stateRich: number, districtRich: number | null): { scope: "state" | "district"; count: number } {
  if (stateRich >= MIN_RICH_COMPETITORS) return { scope: "state", count: stateRich };
  if (districtRich !== null && districtRich >= MIN_RICH_COMPETITORS) return { scope: "district", count: districtRich };
  return { scope: "state", count: stateRich };
}

/** James's report rule for one institution, from the same counts getMarketReadiness uses. */
export async function getReportRuleCheck(institutionId: number): Promise<ReportRuleCheck | null> {
  const keys = [...HEADLINE_FEE_KEYS];
  const [row] = await sql<
    {
      state_code: string | null;
      charter_type: string | null;
      fed_district: number | null;
      own: string | null;
      rich_competitors: string;
      district_rich_competitors: string | null;
    }[]
  >`
    WITH coverage AS (${headlineCoverageSql(keys)}),
    subject AS (SELECT id, state_code, charter_type, fed_district FROM institution_sources WHERE id = ${institutionId})
    SELECT subject.state_code, subject.charter_type, subject.fed_district,
           (SELECT categories FROM coverage WHERE coverage.institution_id = subject.id) AS own,
           (SELECT COUNT(*) FROM institution_sources s
              JOIN coverage ON coverage.institution_id = s.id
             WHERE s.id <> subject.id
               AND s.state_code = subject.state_code
               AND s.charter_type = subject.charter_type
               AND coverage.categories >= ${RICH_MIN_CATEGORIES}) AS rich_competitors,
           CASE WHEN subject.fed_district IS NULL THEN NULL ELSE
           (SELECT COUNT(*) FROM institution_sources s
              JOIN coverage ON coverage.institution_id = s.id
             WHERE s.id <> subject.id
               AND s.fed_district = subject.fed_district
               AND s.charter_type = subject.charter_type
               AND coverage.categories >= ${RICH_MIN_CATEGORIES}) END AS district_rich_competitors
    FROM subject`;
  if (!row) return null;
  const ownCategories = Number(row.own ?? 0);
  const stateRichCompetitors = Number(row.rich_competitors);
  const districtRichCompetitors = row.district_rich_competitors === null ? null : Number(row.district_rich_competitors);
  const peers = reportRulePeers(stateRichCompetitors, districtRichCompetitors);
  return {
    state_code: row.state_code,
    charter_type: row.charter_type,
    fed_district: row.fed_district === null ? null : Number(row.fed_district),
    ownCategories,
    richCompetitors: peers.count,
    peerScope: peers.scope,
    stateRichCompetitors,
    districtRichCompetitors,
    passes: passesReportRule(ownCategories, stateRichCompetitors, districtRichCompetitors ?? 0),
  };
}

export function toMarketReadiness(row: {
  state_code: string;
  charter_type: string;
  institutions: string | number;
  rich: string | number;
  rich_via_district?: string | number | null;
}): MarketReadiness {
  const rich = Number(row.rich);
  const ready = isMarketReady(rich);
  return {
    state_code: row.state_code,
    charter_type: row.charter_type,
    institutions: Number(row.institutions),
    rich,
    progress: Math.min(1, rich / MARKET_READY_MIN_RICH),
    ready,
    ...(row.rich_via_district === undefined ? {} : { richViaDistrict: ready ? 0 : Number(row.rich_via_district ?? 0) }),
  };
}

/** Readiness for every state and charter type the index tracks. */
export async function getMarketReadiness(): Promise<MarketReadiness[]> {
  const keys = [...HEADLINE_FEE_KEYS];
  const rows = await sql<
    { state_code: string; charter_type: string; institutions: string; rich: string; rich_via_district: string }[]
  >`
    WITH coverage AS (${headlineCoverageSql(keys)}),
    districts AS (
      SELECT s.fed_district, s.charter_type, COUNT(*) AS rich
      FROM institution_sources s
      JOIN coverage ON coverage.institution_id = s.id
      WHERE s.fed_district IS NOT NULL AND coverage.categories >= ${RICH_MIN_CATEGORIES}
      GROUP BY s.fed_district, s.charter_type
    )
    SELECT s.state_code, s.charter_type,
           COUNT(*) AS institutions,
           COUNT(*) FILTER (WHERE coverage.categories >= ${RICH_MIN_CATEGORIES}) AS rich,
           COUNT(*) FILTER (WHERE coverage.categories >= ${RICH_MIN_CATEGORIES} AND d.rich >= ${MARKET_READY_MIN_RICH}) AS rich_via_district
    FROM institution_sources s
    LEFT JOIN coverage ON coverage.institution_id = s.id
    LEFT JOIN districts d ON d.fed_district = s.fed_district AND d.charter_type = s.charter_type
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
    FROM (
      SELECT institution_id, canonical_fee_key FROM published_fee_catalog
      -- A foreign transaction fee stated as a rate ("1.1%") is that headline fee too.
      UNION ALL
      SELECT institution_id, canonical_fee_key FROM published_fee_rate_catalog
    ) live
    WHERE canonical_fee_key = ANY(${keys})
      ${institutionIds ? sql`AND institution_id = ANY(${institutionIds})` : sql``}
    GROUP BY institution_id`;
}
