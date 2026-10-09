import { sql } from "./connection";

type SqlTag = typeof sql;

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

/** The report-rule count Atlas stores each day in pipeline_scoreboard_snapshots.detail.report_ready. */
export interface ReportReadyCount {
  /** Institutions passing the report rule (countInstitutionsPassingReportRule). */
  institutions: number;
  /** Of those, the ones passing on Fed district peers because their state has too few. */
  viaDistrict: number;
  /** State markets (state + charter type) that are ready on their own. */
  marketsReady: number;
}

export function summarizeReportReady(markets: MarketReadiness[]): ReportReadyCount {
  return {
    institutions: countInstitutionsPassingReportRule(markets),
    viaDistrict: markets.reduce((total, m) => total + (m.ready ? 0 : (m.richViaDistrict ?? 0)), 0),
    marketsReady: markets.filter((m) => m.ready).length,
  };
}

export interface ReportReadyWeek {
  /** Monday (UTC) of the week, YYYY-MM-DD. */
  weekStart: string;
  /** The day of the snapshot used: the newest one recorded that week. */
  snapshotDate: string;
  count: ReportReadyCount;
}

/**
 * One row per week from Atlas's daily snapshots: the newest snapshot of each week that has
 * a report_ready count, newest week first. Weeks before the count was recorded have no row.
 */
export async function listReportReadyWeeks(weeks = 8, db: SqlTag = sql): Promise<ReportReadyWeek[]> {
  const rows = await db<{ week_start: string; snapshot_date: string; report_ready: Record<string, unknown> }[]>`
    SELECT DISTINCT ON (date_trunc('week', snapshot_date))
           date_trunc('week', snapshot_date)::date::text AS week_start,
           snapshot_date::text AS snapshot_date,
           detail->'report_ready' AS report_ready
      FROM pipeline_scoreboard_snapshots
     WHERE detail ? 'report_ready'
       AND snapshot_date >= CURRENT_DATE - ${weeks * 7}::int
     ORDER BY date_trunc('week', snapshot_date) DESC, snapshot_date DESC`;
  return rows.map((row) => ({
    weekStart: String(row.week_start),
    snapshotDate: String(row.snapshot_date),
    count: {
      institutions: Number(row.report_ready?.institutions ?? 0),
      viaDistrict: Number(row.report_ready?.via_district ?? 0),
      marketsReady: Number(row.report_ready?.markets_ready ?? 0),
    },
  }));
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

/** One institution's headline coverage with the fields the report rule groups peers by. */
export type HeadlineCoverageRow = [
  institutionId: number,
  categories: number,
  stateCode: string | null,
  charterType: string | null,
  fedDistrict: number | null,
];

/**
 * Headline coverage for every institution with at least one headline category live. The
 * report rule needs every institution's count to find rich peers, and the count reads the
 * catalog views over all institutions (about a second), so callers that check many
 * institutions load this once and reuse it.
 */
export async function getHeadlineCoverageRows(): Promise<HeadlineCoverageRow[]> {
  const keys = [...HEADLINE_FEE_KEYS];
  const rows = await sql<
    { institution_id: number; categories: string; state_code: string | null; charter_type: string | null; fed_district: number | null }[]
  >`
    WITH coverage AS (${headlineCoverageSql(keys)})
    SELECT coverage.institution_id, coverage.categories, s.state_code, s.charter_type, s.fed_district
    FROM coverage JOIN institution_sources s ON s.id = coverage.institution_id
    ORDER BY coverage.institution_id`;
  return rows.map((row) => [
    Number(row.institution_id),
    Number(row.categories),
    row.state_code,
    row.charter_type,
    row.fed_district === null ? null : Number(row.fed_district),
  ]);
}

/** The report rule for one institution, counted from loaded coverage rows. */
export function reportRuleCheckFromCoverage(
  subject: { id: number; state_code: string | null; charter_type: string | null; fed_district: number | null },
  coverage: HeadlineCoverageRow[],
): ReportRuleCheck {
  let ownCategories = 0;
  let stateRichCompetitors = 0;
  let districtRich = 0;
  for (const [id, categories, state, charter, district] of coverage) {
    if (id === subject.id) {
      ownCategories = categories;
      continue;
    }
    if (categories < RICH_MIN_CATEGORIES || charter === null || charter !== subject.charter_type) continue;
    if (state !== null && state === subject.state_code) stateRichCompetitors += 1;
    if (district !== null && district === subject.fed_district) districtRich += 1;
  }
  const districtRichCompetitors = subject.fed_district === null ? null : districtRich;
  const peers = reportRulePeers(stateRichCompetitors, districtRichCompetitors);
  return {
    state_code: subject.state_code,
    charter_type: subject.charter_type,
    fed_district: subject.fed_district,
    ownCategories,
    richCompetitors: peers.count,
    peerScope: peers.scope,
    stateRichCompetitors,
    districtRichCompetitors,
    passes: passesReportRule(ownCategories, stateRichCompetitors, districtRichCompetitors ?? 0),
  };
}

/**
 * The report rule from loaded coverage rows alone. Null when the institution has no headline
 * category live: it has no row, and with no categories it cannot pass the rule.
 */
export function reportRuleCheckFromRows(institutionId: number, coverage: HeadlineCoverageRow[]): ReportRuleCheck | null {
  const own = coverage.find(([id]) => id === institutionId);
  if (!own) return null;
  const [, , state_code, charter_type, fed_district] = own;
  return reportRuleCheckFromCoverage({ id: institutionId, state_code, charter_type, fed_district }, coverage);
}

/**
 * James's report rule for one institution, from the same counts getMarketReadiness uses.
 * `loadCoverage` lets a caller pass a shared (cached) copy of the coverage rows; by default
 * they are read live.
 */
export async function getReportRuleCheck(
  institutionId: number,
  loadCoverage: () => Promise<HeadlineCoverageRow[]> = getHeadlineCoverageRows,
): Promise<ReportRuleCheck | null> {
  const [subject] = await sql<{ id: number; state_code: string | null; charter_type: string | null; fed_district: number | null }[]>`
    SELECT id, state_code, charter_type, fed_district FROM institution_sources WHERE id = ${institutionId}`;
  if (!subject) return null;
  const coverage = await loadCoverage();
  return reportRuleCheckFromCoverage(
    {
      id: Number(subject.id),
      state_code: subject.state_code,
      charter_type: subject.charter_type,
      fed_district: subject.fed_district === null ? null : Number(subject.fed_district),
    },
    coverage,
  );
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
export async function getMarketReadiness(db: SqlTag = sql): Promise<MarketReadiness[]> {
  const keys = [...HEADLINE_FEE_KEYS];
  const rows = await db<
    { state_code: string; charter_type: string; institutions: string; rich: string; rich_via_district: string }[]
  >`
    WITH coverage AS (${headlineCoverageSql(keys, undefined, db)}),
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

function headlineCoverageSql(keys: string[], institutionIds?: number[], db: SqlTag = sql) {
  return db`
    SELECT institution_id, COUNT(DISTINCT canonical_fee_key) AS categories
    FROM (
      SELECT institution_id, canonical_fee_key FROM published_fee_catalog
      -- A foreign transaction fee stated as a rate ("1.1%") is that headline fee too.
      UNION ALL
      SELECT institution_id, canonical_fee_key FROM published_fee_rate_catalog
    ) live
    WHERE canonical_fee_key = ANY(${keys})
      ${institutionIds ? db`AND institution_id = ANY(${institutionIds})` : db``}
    GROUP BY institution_id`;
}
