import { sql } from "./connection";
import { readerFeeConditions } from "../fee-conditions";
import { dailyFeeLimitFor, type DailyFeeLimit } from "@/lib/fee-daily-limit";
import { getFeeFamily, FEE_FAMILIES } from "@/lib/fee-taxonomy";
import { frequencyFamily } from "@/lib/fee-frequency";
import { COMPARABILITY_SCREEN } from "@/lib/fee-comparability";
import { BUSINESS_URL_SCREEN, MARKET_AUDIENCES, countsInMarketComparison } from "@/lib/market-eligibility";
import {
  MIN_INSTITUTIONS_FOR_MEDIAN,
  STATS_METHOD_VERSION,
  STATS_ROW_FILTER,
  STATS_SCHEDULE_KEYS,
  countedRepresentatives,
  summarizeFeesBy,
  valuePerInstitution,
} from "./fee-stats";

/** The canonical fee catalog — only these categories appear in indexes and reports */
const CANONICAL_CATEGORIES = Object.values(FEE_FAMILIES).flat();

export interface IndexEntry {
  fee_category: string;
  fee_family: string | null;
  median_amount: number | null;
  p25_amount: number | null;
  p75_amount: number | null;
  min_amount: number | null;
  max_amount: number | null;
  institution_count: number;
  observation_count: number;
  approved_count: number;
  bank_count: number;
  cu_count: number;
  maturity_tier: "strong" | "provisional" | "insufficient";
  last_updated: string | null;
  /**
   * Institutions behind the figures with at least one fee whose audience the schedule does not
   * state (#1132): the asterisk test (`medianHasUnstatedAudience`). Computed live, never cached.
   */
  unstated_audience_institution_count?: number;
}

/**
 * Every published row is approved (the catalog view has no other status), so
 * `approvedOnly` changes nothing; statistics follow the contract in fee-stats.ts.
 */
export async function getNationalIndex(approvedOnly = true): Promise<IndexEntry[]> {
  return buildIndexEntries(await loadNationalRows(sql, approvedOnly));
}

type IndexRow = {
  fee_category: string;
  amount: number | null;
  institution_id: number;
  review_status: string;
  created_at: string;
  charter_type: string;
  schedule_keys?: string[] | null;
  schedule_group?: string | null;
  fee_audience?: string | null;
};

async function loadNationalRows(db: typeof sql, approvedOnly = true): Promise<IndexRow[]> {
  const statusFilter = approvedOnly
    ? "ef.review_status = 'approved'"
    : "ef.review_status != 'rejected'";

  return await db.unsafe(
    `SELECT ef.fee_category, ef.amount, ef.institution_id, ef.fee_audience,
            ef.review_status, ef.created_at, ct.charter_type, ${STATS_SCHEDULE_KEYS}
     FROM published_fee_catalog ef
     JOIN institution_sources ct ON ef.institution_id = ct.id
     WHERE ef.fee_category = ANY(ARRAY[${CANONICAL_CATEGORIES.map((c) => `'${c}'`).join(",")}])
       AND ${statusFilter}
       AND ${STATS_ROW_FILTER}`
  ) as IndexRow[];
}

/**
 * How peers charge a category: the most common charge basis among peer rows that state one
 * (`frequencyFamily`: per item, monthly, annual...) and that basis's share of them.
 */
export interface CategoryChargeBasis {
  fee_category: string;
  family: string;
  share: number;
  stated_rows: number;
}

/**
 * How peers charge each category: the most common stated charge basis (`frequencyFamily`)
 * among rows that count toward statistics, and its share of the rows that state one. Pro
 * compares a selected institution's fee only on that basis (report-evidence.ts). National,
 * cached for an hour: a category's charge basis is a property of the fee, not of a peer set.
 */
const CHARGE_BASIS_CACHE_TTL_MS = 60 * 60 * 1000;
let chargeBasisCache: { expiresAt: number; value: CategoryChargeBasis[] } | null = null;

export async function getCategoryChargeBases(): Promise<CategoryChargeBasis[]> {
  if (chargeBasisCache && chargeBasisCache.expiresAt > Date.now()) return chargeBasisCache.value;
  const rows = await sql.unsafe(
    `SELECT ef.fee_category, ef.frequency, count(*)::int AS n
     FROM published_fee_catalog ef
     WHERE ef.fee_category IS NOT NULL AND ef.frequency IS NOT NULL AND ${STATS_ROW_FILTER}
     GROUP BY 1, 2`
  ) as { fee_category: string; frequency: string; n: number }[];
  const value = chargeBasesFromCounts(rows);
  chargeBasisCache = { expiresAt: Date.now() + CHARGE_BASIS_CACHE_TTL_MS, value };
  return value;
}

/** Fold (category, frequency, count) rows into each category's most common charge basis. */
export function chargeBasesFromCounts(
  rows: { fee_category: string; frequency: string; n: number | string }[],
): CategoryChargeBasis[] {
  const byCategory = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const family = frequencyFamily(row.frequency);
    if (!family) continue;
    const families = byCategory.get(row.fee_category) ?? new Map<string, number>();
    families.set(family, (families.get(family) ?? 0) + Number(row.n));
    byCategory.set(row.fee_category, families);
  }
  return [...byCategory].map(([fee_category, families]) => {
    const stated = [...families.values()].reduce((sum, n) => sum + n, 0);
    const [family, n] = [...families].sort((a, b) => b[1] - a[1])[0];
    return { fee_category, family, share: n / stated, stated_rows: stated };
  });
}

export interface ContractFeeRow {
  institution_id: number;
  fee_category: string;
  amount: number | null;
  institution_name: string;
  state_code: string | null;
  charter_type: string | null;
  asset_size_tier: string | null;
  /** The schedule the row was read from (statistics rule 7); NULL while the switch is off. */
  schedule_keys?: string[] | null;
  schedule_group?: string | null;
}

/** Approved, sourced published rows (the statistics contract's input), optionally filtered. */
export async function getContractFeeRows(filters: { categories?: string[]; charter?: string } = {}): Promise<ContractFeeRow[]> {
  const conditions = ["ef.fee_category IS NOT NULL", "ef.review_status = 'approved'", STATS_ROW_FILTER];
  const params: (string | string[])[] = [];
  if (filters.categories && filters.categories.length > 0) {
    params.push(filters.categories);
    conditions.push(`ef.fee_category = ANY($${params.length}::text[])`);
  }
  if (filters.charter) {
    params.push(filters.charter);
    conditions.push(`ct.charter_type = $${params.length}`);
  }
  return await sql.unsafe(
    `SELECT ef.institution_id, ef.fee_category, ef.amount, ct.institution_name,
            ct.state_code, ct.charter_type, ct.asset_size_tier, ${STATS_SCHEDULE_KEYS}
       FROM published_fee_catalog ef
       JOIN institution_sources ct ON ef.institution_id = ct.id
      WHERE ${conditions.join(" AND ")}`,
    params as never[],
  ) as ContractFeeRow[];
}

export interface SegmentFeeRow extends ContractFeeRow {
  fed_district: number | null;
}

/**
 * Approved, sourced published rows for the given categories with each institution's
 * Fed district and asset tier, for district, state and size-tier breakdowns.
 */
export async function getSegmentFeeRows(categories: string[]): Promise<SegmentFeeRow[]> {
  if (categories.length === 0) return [];
  const rows = await sql.unsafe(
    `SELECT ef.institution_id, ef.fee_category, ef.amount, ct.institution_name,
            ct.state_code, ct.charter_type, ct.asset_size_tier, ct.fed_district, ${STATS_SCHEDULE_KEYS}
       FROM published_fee_catalog ef
       JOIN institution_sources ct ON ef.institution_id = ct.id
      WHERE ef.fee_category = ANY($1::text[])
        AND ef.review_status = 'approved'
        AND ${STATS_ROW_FILTER}`,
    [categories] as never[],
  ) as (ContractFeeRow & { fed_district: number | string | null })[];
  return rows.map((r) => ({ ...r, fed_district: r.fed_district === null ? null : Number(r.fed_district) }));
}

/**
 * One institution's value per category under the statistics contract (the median of its
 * approved, sourced amounts; overdraft's highest tier), so "your fee" is measured the same way as the benchmark.
 */
export interface InstitutionFeeRow {
  id: number;
  feeName: string;
  amount: number | null;
  sourceDocumentId: number | null;
  /** The schedule document the row was read from. */
  documentUrl: string | null;
  /** The page the schedule was found on, when it differs from the document. */
  sourceUrl: string | null;
  publishedAt: string | null;
  /** Unmodified canonical charge basis, audience and source version; unknown stays unknown. */
  frequency: string | null;
  conditions: string | null;
  feeAudience: "consumer" | "business" | "both" | "unknown";
  audienceEvidence: string | null;
  sourceContentHash: string | null;
  sourceCrawledAt: string | null;
  sourceLastCheckedAt: string | null;
  /** The Darwin event that verified the row against its document; null when not recorded. */
  verifiedByEventId: string | null;
}

/**
 * Every live row behind one institution's value for a fee (the same rows its statistics value
 * is built from), highest amount first: the audit trail for "your fee".
 */
export async function getInstitutionFeeRows(institutionId: number, category: string): Promise<InstitutionFeeRow[]> {
  const rows = await sql.unsafe(
    `SELECT ef.id, ef.fee_name, ef.amount, ef.frequency, ef.conditions,
            ef.fee_audience, ef.audience_evidence, ef.source_document_id,
            COALESCE(doc.document_url, ef.document_url) AS document_url, ef.source_url,
            ef.created_at, ef.verified_by_agent_event_id,
            doc.content_hash AS source_content_hash, doc.crawled_at AS source_crawled_at,
            GREATEST(doc.last_checked_at, same_text.checked_at) AS source_last_checked_at
       FROM published_fee_catalog ef
       LEFT JOIN source_documents doc
         ON doc.id = ef.source_document_id AND doc.institution_id = ef.institution_id
       -- A later copy of the bank's page with the same text checks this fee too (#1200): Knox keys
       -- its reads on the text, so the fee keeps the first copy's id when the page has not changed.
       LEFT JOIN LATERAL (
         SELECT MAX(GREATEST(twin.last_checked_at, twin.crawled_at)) AS checked_at
           FROM agent_source_texts own_text
           JOIN agent_source_texts twin_text
             ON twin_text.institution_id = own_text.institution_id
            AND twin_text.text_hash = own_text.text_hash
            AND twin_text.status = 'completed'
           JOIN source_documents twin
             ON twin.id = twin_text.source_document_id
            AND twin.institution_id = ef.institution_id
            AND twin.id <> ef.source_document_id
          WHERE own_text.source_document_id = ef.source_document_id
            AND own_text.status = 'completed'
       ) same_text ON true
      WHERE ef.institution_id = $1
        AND ef.fee_category = $2
        AND ef.review_status = 'approved'
        AND ${STATS_ROW_FILTER}
      ORDER BY ef.amount DESC NULLS LAST, ef.id`,
    [institutionId, category] as never[],
  ) as {
    id: number | string;
    fee_name: string;
    amount: number | string | null;
    source_document_id: number | string | null;
    document_url: string | null;
    source_url: string | null;
    created_at: Date | string | null;
    frequency: string | null;
    conditions: string | null;
    fee_audience: string | null;
    audience_evidence: string | null;
    source_content_hash: string | null;
    source_crawled_at: Date | string | null;
    source_last_checked_at: Date | string | null;
    verified_by_agent_event_id: string | null;
  }[];
  const timestamp = (date: Date | string | null): string | null =>
    date instanceof Date ? date.toISOString() : date ? String(date) : null;
  return rows.map((r) => ({
    id: Number(r.id),
    feeName: r.fee_name,
    amount: r.amount === null ? null : Number(r.amount),
    sourceDocumentId: r.source_document_id === null ? null : Number(r.source_document_id),
    documentUrl: r.document_url,
    sourceUrl: r.source_url,
    publishedAt: timestamp(r.created_at),
    frequency: r.frequency ?? null,
    conditions: readerFeeConditions(r.conditions),
    feeAudience: r.fee_audience === "consumer" || r.fee_audience === "business" || r.fee_audience === "both"
      ? r.fee_audience : "unknown",
    audienceEvidence: r.audience_evidence ?? null,
    sourceContentHash: r.source_content_hash ?? null,
    sourceCrawledAt: timestamp(r.source_crawled_at),
    sourceLastCheckedAt: timestamp(r.source_last_checked_at),
    verifiedByEventId: r.verified_by_agent_event_id ? String(r.verified_by_agent_event_id) : null,
  }));
}

export async function getInstitutionFeeValues(
  institutionId: number,
  categories?: string[],
): Promise<Map<string, number>> {
  const params: (number | string[])[] = [institutionId];
  let categoryFilter = "";
  if (categories && categories.length > 0) {
    params.push(categories);
    categoryFilter = "AND ef.fee_category = ANY($2::text[])";
  }
  const rows = await sql.unsafe(
    `SELECT ef.fee_category, ef.amount
       FROM published_fee_catalog ef
      WHERE ef.institution_id = $1
        AND ef.fee_category IS NOT NULL
        AND ef.review_status = 'approved'
        AND ${STATS_ROW_FILTER}
        ${categoryFilter}`,
    params as never[],
  ) as { fee_category: string; amount: number | string | null }[];

  const byCategory = new Map<string, { institution_id: number; amount: number | string | null; fee_category: string }[]>();
  for (const row of rows) {
    const list = byCategory.get(row.fee_category) ?? [];
    list.push({ institution_id: institutionId, amount: row.amount, fee_category: row.fee_category });
    byCategory.set(row.fee_category, list);
  }
  const values = new Map<string, number>();
  for (const [category, list] of byCategory) {
    const value = valuePerInstitution(list).get(institutionId);
    if (value !== undefined) values.set(category, value);
  }
  return values;
}

/** Distinct institutions with at least one fee that counts toward statistics. */
export async function getSourcedInstitutionCount(): Promise<number> {
  const [row] = await sql.unsafe(
    `SELECT COUNT(DISTINCT ef.institution_id)::int AS count
       FROM published_fee_catalog ef
      WHERE ef.review_status = 'approved'
        AND ${STATS_ROW_FILTER}`
  ) as { count: number }[];
  return Number(row?.count ?? 0);
}

export async function getPeerIndex(
  filters: PeerFilterSet,
  approvedOnly = true
): Promise<IndexEntry[]> {
  const conditions = ["ef.fee_category IS NOT NULL", STATS_ROW_FILTER];
  const params: (string | number | string[] | number[])[] = [];
  let paramIdx = 0;

  conditions.push(
    approvedOnly
      ? "ef.review_status = 'approved'"
      : "ef.review_status != 'rejected'"
  );

  const institutionIds = peerInstitutionIds(filters);
  if (institutionIds) {
    // Hand-picked peers are exactly those institutions; the other filters do not apply.
    paramIdx++;
    conditions.push(`ct.id = ANY($${paramIdx}::int[])`);
    params.push(institutionIds);
  } else {
    if (filters.charter_type) {
      paramIdx++;
      conditions.push(`ct.charter_type = $${paramIdx}`);
      params.push(filters.charter_type);
    }
    if (filters.asset_tiers && filters.asset_tiers.length > 0) {
      const placeholders = filters.asset_tiers.map(() => {
        paramIdx++;
        return `$${paramIdx}`;
      }).join(",");
      conditions.push(`ct.asset_size_tier IN (${placeholders})`);
      params.push(...filters.asset_tiers);
    }
    if (filters.fed_districts && filters.fed_districts.length > 0) {
      const placeholders = filters.fed_districts.map(() => {
        paramIdx++;
        return `$${paramIdx}`;
      }).join(",");
      conditions.push(`ct.fed_district IN (${placeholders})`);
      params.push(...filters.fed_districts);
    }
    if (filters.state_code) {
      paramIdx++;
      conditions.push(`ct.state_code = $${paramIdx}`);
      params.push(filters.state_code);
    }
    if (filters.states && filters.states.length > 0) {
      paramIdx++;
      conditions.push(`ct.state_code = ANY($${paramIdx}::text[])`);
      params.push(filters.states);
    }
  }

  const where = conditions.join(" AND ");

  const rows = await sql.unsafe(
    `SELECT ef.fee_category, ef.amount, ef.institution_id, ef.fee_audience,
            ef.review_status, ef.created_at, ct.charter_type, ${STATS_SCHEDULE_KEYS}
     FROM published_fee_catalog ef
     JOIN institution_sources ct ON ef.institution_id = ct.id
     WHERE ${where}`,
    params as never[]
  ) as IndexRow[];

  return buildIndexEntries(rows);
}

export interface PeerFilterSet {
  charter_type?: string;
  asset_tiers?: string[];
  fed_districts?: number[];
  state_code?: string;
  /** Any of these states (a saved peer group's state filter). */
  states?: string[];
  /** Hand-picked peers. When set, the peers are exactly these institutions and the other filters are ignored. */
  institutionIds?: number[];
}

/** The hand-picked peer ids, or null when the set is filter-based. */
export function peerInstitutionIds(filters: PeerFilterSet): number[] | null {
  const ids = (filters.institutionIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  return ids.length > 0 ? [...new Set(ids)] : null;
}

interface PeerRow extends IndexRow {
  asset_size_tier: string | null;
  fed_district: number | null;
  state_code: string | null;
}

export function matchesPeerFilters(
  row: Pick<PeerRow, "charter_type" | "asset_size_tier" | "fed_district" | "state_code"> & {
    institution_id?: number | string;
  },
  filters: PeerFilterSet,
): boolean {
  const ids = peerInstitutionIds(filters);
  if (ids) return ids.includes(Number(row.institution_id));
  if (filters.states?.length && !filters.states.includes(row.state_code ?? "")) return false;
  if (filters.charter_type && row.charter_type !== filters.charter_type) return false;
  if (filters.state_code && row.state_code !== filters.state_code) return false;
  if (filters.asset_tiers?.length && !filters.asset_tiers.includes(row.asset_size_tier ?? "")) return false;
  if (filters.fed_districts?.length && !filters.fed_districts.includes(Number(row.fed_district))) return false;
  return true;
}

/**
 * The peer index for several filter sets from one query: rows are loaded once for the
 * union of the sets' charters and states, then each set is filtered and summarized in
 * memory. Results are in the same order as `filterSets`.
 */
export async function getPeerIndexes(
  filterSets: PeerFilterSet[],
  approvedOnly = true,
): Promise<IndexEntry[][]> {
  if (filterSets.length === 0) return [];
  const conditions = [
    "ef.fee_category IS NOT NULL",
    STATS_ROW_FILTER,
    approvedOnly ? "ef.review_status = 'approved'" : "ef.review_status != 'rejected'",
  ];
  const params: (string[] | number[])[] = [];
  // Every set anchored on a charter, a state or hand-picked peers lets the query skip everything else.
  if (filterSets.every((f) => f.charter_type || f.state_code || f.states?.length || peerInstitutionIds(f))) {
    const charters = [...new Set(filterSets.map((f) => f.charter_type).filter((v): v is string => !!v))];
    const states = [...new Set(filterSets.flatMap((f) => [f.state_code, ...(f.states ?? [])]).filter((v): v is string => !!v))];
    const ids = [...new Set(filterSets.flatMap((f) => peerInstitutionIds(f) ?? []))];
    params.push(charters, states);
    if (ids.length > 0) {
      params.push(ids);
      conditions.push("(ct.charter_type = ANY($1::text[]) OR ct.state_code = ANY($2::text[]) OR ct.id = ANY($3::int[]))");
    } else {
      conditions.push("(ct.charter_type = ANY($1::text[]) OR ct.state_code = ANY($2::text[]))");
    }
  }
  const rows = await sql.unsafe(
    `SELECT ef.fee_category, ef.amount, ef.institution_id, ef.review_status, ef.created_at, ef.fee_audience,
            ct.charter_type, ct.asset_size_tier, ct.fed_district, ct.state_code, ${STATS_SCHEDULE_KEYS}
       FROM published_fee_catalog ef
       JOIN institution_sources ct ON ef.institution_id = ct.id
      WHERE ${conditions.join(" AND ")}`,
    params as never[],
  ) as PeerRow[];
  return filterSets.map((filters) => buildIndexEntries(rows.filter((row) => matchesPeerFilters(row, filters))));
}

export interface PeerGroupCount {
  /** Active institutions in the group (the asking institution left out). */
  institutions: number;
  /** Of those, how many have at least one live fee that counts toward statistics. */
  publishing: number;
}

/**
 * How many institutions each peer group holds, and how many of them publish live fees,
 * from one read of the registry. Results follow the order of `filterSets`.
 */
export async function getPeerGroupCounts(
  filterSets: PeerFilterSet[],
  excludeInstitutionId?: number | null,
): Promise<PeerGroupCount[]> {
  if (filterSets.length === 0) return [];
  const rows = await sql.unsafe(
    `SELECT ct.id AS institution_id, ct.charter_type, ct.asset_size_tier, ct.fed_district, ct.state_code,
            EXISTS (
              SELECT 1 FROM published_fee_catalog ef
               WHERE ef.institution_id = ct.id
                 AND ef.fee_category IS NOT NULL
                 AND ef.review_status = 'approved'
                 AND ${STATS_ROW_FILTER}
            ) AS publishes
       FROM institution_sources ct
      WHERE COALESCE(ct.regulatory_status, 'active') <> 'inactive'`,
  ) as (Pick<PeerRow, "charter_type" | "asset_size_tier" | "fed_district" | "state_code"> & {
    institution_id: number | string;
    publishes: boolean;
  })[];
  const peers = rows.filter((row) => Number(row.institution_id) !== excludeInstitutionId);
  return filterSets.map((filters) => {
    const members = peers.filter((row) => matchesPeerFilters(row, filters));
    return { institutions: members.length, publishing: members.filter((row) => row.publishes).length };
  });
}

export async function getIndexSnapshot(
  filters?: {
    charter_type?: string;
    asset_tiers?: string[];
    fed_districts?: number[];
  },
  limit = 10
): Promise<IndexEntry[]> {
  const entries = filters
    ? await getPeerIndex(filters)
    : await getNationalIndex();
  return entries.slice(0, limit);
}

export async function getDistrictMedianByCategory(
  category: string,
  filters?: { charter_type?: string; asset_tiers?: string[] }
): Promise<{ district: number; median_amount: number | null; institution_count: number }[]> {
  const conditions = [
    "ef.fee_category = $1",
    "ef.review_status = 'approved'",
    STATS_ROW_FILTER,
    "ct.fed_district IS NOT NULL",
  ];
  const params: (string | number)[] = [category];
  let paramIdx = 1;

  if (filters?.charter_type) {
    paramIdx++;
    conditions.push(`ct.charter_type = $${paramIdx}`);
    params.push(filters.charter_type);
  }
  if (filters?.asset_tiers && filters.asset_tiers.length > 0) {
    const placeholders = filters.asset_tiers.map(() => {
      paramIdx++;
      return `$${paramIdx}`;
    }).join(",");
    conditions.push(`ct.asset_size_tier IN (${placeholders})`);
    params.push(...filters.asset_tiers);
  }

  const rows = await sql.unsafe(
    `SELECT ef.fee_category, ef.amount, ct.fed_district, ef.institution_id, ${STATS_SCHEDULE_KEYS}
     FROM published_fee_catalog ef
     JOIN institution_sources ct ON ef.institution_id = ct.id
     WHERE ${conditions.join(" AND ")}`,
    params
  ) as {
    fee_category: string;
    amount: number | null;
    fed_district: number;
    institution_id: number;
    schedule_keys: string[] | null;
    schedule_group: string | null;
  }[];

  return [...summarizeFeesBy(rows, (row) => String(Number(row.fed_district))).entries()]
    .map(([district, stats]) => ({
      district: Number(district),
      median_amount: stats.median_amount,
      institution_count: stats.institution_count,
    }))
    .sort((a, b) => a.district - b.district);
}

export async function getDistrictFeeMedians(
  district: number
): Promise<{ fee_category: string; median_amount: number; institution_count: number }[]> {
  const rows = await sql`
    SELECT ef.fee_category, ef.amount, ef.institution_id, ${sql.unsafe(STATS_SCHEDULE_KEYS)}
    FROM published_fee_catalog ef
    JOIN institution_sources ct ON ef.institution_id = ct.id
    WHERE ct.fed_district = ${district}
      AND ef.review_status = 'approved'
      AND ef.fee_category IS NOT NULL
      AND ef.amount IS NOT NULL
      AND ef.amount >= 0
      AND ${sql.unsafe(STATS_ROW_FILTER)}
  ` as { fee_category: string; amount: number | null; institution_id: number; schedule_keys: string[] | null; schedule_group: string | null }[];

  return [...summarizeFeesBy(rows, (row) => row.fee_category).entries()]
    .filter(([, stats]) => stats.median_amount !== null && stats.institution_count >= MIN_INSTITUTIONS_FOR_MEDIAN)
    .map(([fee_category, stats]) => ({
      fee_category,
      median_amount: stats.median_amount as number,
      institution_count: stats.institution_count,
    }))
    .sort((a, b) => b.institution_count - a.institution_count);
}

export function buildIndexEntries(rows: IndexRow[]): IndexEntry[] {
  const latestByCategory = new Map<string, string>();
  for (const row of rows) {
    const createdAt = (row.created_at as unknown) instanceof Date
      ? (row.created_at as unknown as Date).toISOString()
      : String(row.created_at ?? "");
    if (createdAt > (latestByCategory.get(row.fee_category) ?? "")) {
      latestByCategory.set(row.fee_category, createdAt);
    }
  }

  const unstated = unstatedAudienceInstitutions(rows);
  const results: IndexEntry[] = [];
  for (const [category, stats] of summarizeFeesBy(rows, (row) => row.fee_category)) {
    results.push({
      fee_category: category,
      fee_family: getFeeFamily(category),
      median_amount: stats.median_amount,
      p25_amount: stats.p25_amount,
      p75_amount: stats.p75_amount,
      min_amount: stats.min_amount,
      max_amount: stats.max_amount,
      institution_count: stats.institution_count,
      observation_count: stats.observation_count,
      approved_count: stats.observation_count,
      bank_count: stats.bank_count,
      cu_count: stats.cu_count,
      maturity_tier: stats.maturity_tier,
      last_updated: latestByCategory.get(category) || null,
      unstated_audience_institution_count: unstated.get(category)?.size ?? 0,
    });
  }

  results.sort((a, b) => b.institution_count - a.institution_count);
  return results;
}

/** Per category, the institutions with a counted amount whose audience is `unknown` (#1132). */
function unstatedAudienceInstitutions(rows: IndexRow[]): Map<string, Set<number>> {
  const byCategory = new Map<string, Set<number>>();
  for (const row of rows) {
    if (row.fee_audience !== "unknown" || row.amount === null || !(Number(row.amount) >= 0)) continue;
    const set = byCategory.get(row.fee_category) ?? new Set<number>();
    set.add(Number(row.institution_id));
    byCategory.set(row.fee_category, set);
  }
  return byCategory;
}

/**
 * The same count for the national index read from fee_index_cache, which has no column for it
 * (adding one needs a migration). It is a grouped scan of the catalog, so only the pages that
 * show it read it (`getNationalUnstatedAudienceCountsCached`), not every cached index read (#1595).
 */
async function loadNationalUnstatedAudienceCounts(): Promise<Map<string, number>> {
  const rows = await sql.unsafe(
    `SELECT ef.fee_category, COUNT(DISTINCT ef.institution_id)::int AS n
       FROM published_fee_catalog ef
      WHERE ef.review_status = 'approved'
        AND ${STATS_ROW_FILTER}
        AND ef.fee_audience = 'unknown'
        AND ef.amount IS NOT NULL AND ef.amount >= 0
      GROUP BY 1`
  ) as { fee_category: string; n: number | string }[];
  return new Map(rows.map((row) => [row.fee_category, Number(row.n)]));
}

/**
 * Read the precomputed index from fee_index_cache (written by refreshFeeIndexCache after
 * each Hamilton publish). Falls back to a live computation when the cache is empty, older
 * than NATIONAL_INDEX_CACHE_MAX_AGE_MS, or was computed under an older statistics method.
 */
const NATIONAL_INDEX_CACHE_TTL_MS = 60_000;
/** Rows in fee_index_cache older than this are ignored in favor of a live computation. */
const NATIONAL_INDEX_CACHE_MAX_AGE_MS = 36 * 60 * 60 * 1000;
let nationalIndexCache: {
  expiresAt: number;
  value: IndexEntry[];
} | null = null;
let nationalIndexCachePromise: Promise<IndexEntry[]> | null = null;
let unstatedCountsCache: { expiresAt: number; value: Map<string, number> } | null = null;

/**
 * The national unstated-audience count per category, memoised like the index. A failed read
 * gives an empty map: the count only marks medians, so it never fails the page that shows it.
 */
export async function getNationalUnstatedAudienceCountsCached(): Promise<Map<string, number>> {
  if (unstatedCountsCache && unstatedCountsCache.expiresAt > Date.now()) return unstatedCountsCache.value;
  const value = await loadNationalUnstatedAudienceCounts().catch((error: unknown) => {
    console.error("[fee-index] unstated-audience count failed; medians shown unmarked", error);
    return null;
  });
  if (!value) return new Map();
  unstatedCountsCache = { value, expiresAt: Date.now() + NATIONAL_INDEX_CACHE_TTL_MS };
  return value;
}

export async function getNationalIndexCached(): Promise<IndexEntry[]> {
  const now = Date.now();
  if (nationalIndexCache && nationalIndexCache.expiresAt > now) {
    return nationalIndexCache.value;
  }
  if (nationalIndexCachePromise) {
    return nationalIndexCachePromise;
  }

  nationalIndexCachePromise = readNationalIndexCached()
    .then((value) => {
      nationalIndexCache = {
        value,
        expiresAt: Date.now() + NATIONAL_INDEX_CACHE_TTL_MS,
      };
      return value;
    })
    .finally(() => {
      nationalIndexCachePromise = null;
    });
  return nationalIndexCachePromise;
}

async function readNationalIndexCached(): Promise<IndexEntry[]> {
  try {
    const rows = await sql`
      SELECT * FROM fee_index_cache ORDER BY institution_count DESC` as {
      fee_category: string;
      fee_family: string | null;
      median_amount: number | null;
      p25_amount: number | null;
      p75_amount: number | null;
      min_amount: number | null;
      max_amount: number | null;
      institution_count: number;
      observation_count: number;
      approved_count: number;
      bank_count: number;
      cu_count: number;
      maturity_tier: string;
      computed_at: string;
      stats_method_version?: number | null;
    }[];

    // The cache is only trustworthy when a publish step rebuilt it recently. A stale
    // cache (e.g. left over from before the agentic pipeline) must never be served.
    const newest = rows.reduce<number>((max, row) => {
      const at = row.computed_at ? new Date(row.computed_at).getTime() : 0;
      return Number.isFinite(at) && at > max ? at : max;
    }, 0);
    const oldMethod = rows.some((row) => Number(row.stats_method_version ?? 0) !== STATS_METHOD_VERSION);
    if (rows.length === 0 || oldMethod || Date.now() - newest > NATIONAL_INDEX_CACHE_MAX_AGE_MS) {
      return getNationalIndex();
    }

    // No unstated-audience count here: callers that show it read
    // `getNationalUnstatedAudienceCountsCached` (#1595).
    return rows.map((row) => ({
      fee_category: row.fee_category,
      fee_family: row.fee_family,
      median_amount: row.median_amount,
      p25_amount: row.p25_amount,
      p75_amount: row.p75_amount,
      min_amount: row.min_amount,
      max_amount: row.max_amount,
      institution_count: row.institution_count,
      observation_count: row.observation_count,
      approved_count: row.approved_count,
      bank_count: row.bank_count,
      cu_count: row.cu_count,
      maturity_tier: row.maturity_tier as IndexEntry["maturity_tier"],
      last_updated: row.computed_at,
    }));
  } catch {
    return getNationalIndex();
  }
}

export interface FeeIndexCacheRefresh {
  refreshed: boolean;
  categories: number;
  reason: string;
}

/** Rebuilt at most this often when nothing new was published. */
const FEE_INDEX_CACHE_REFRESH_MS = 6 * 60 * 60 * 1000;

async function feeIndexCacheWriterReady(db: typeof sql): Promise<boolean> {
  const [row] = await db`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'fee_index_cache' AND column_name = 'stats_method_version'
    ) AS ready
  `;
  return row?.ready === true;
}

/**
 * Recomputes the national index under the statistics contract and replaces
 * fee_index_cache, stamped with the method version and the run that wrote it. Hamilton
 * calls it inside its publish transaction (`force` when it published something), so the
 * cache and the published rows never disagree.
 */
export async function refreshFeeIndexCache(
  db: typeof sql,
  options: { runId: number; force?: boolean },
): Promise<FeeIndexCacheRefresh> {
  if (!(await feeIndexCacheWriterReady(db))) {
    return { refreshed: false, categories: 0, reason: "cache migration not applied" };
  }
  if (!options.force) {
    const [state] = await db`
      SELECT MAX(computed_at) AS newest, MIN(stats_method_version) AS method, COUNT(*)::int AS rows
        FROM fee_index_cache
    `;
    const newest = state?.newest ? new Date(state.newest as string | Date).getTime() : 0;
    const current =
      Number(state?.rows ?? 0) > 0 &&
      Number(state?.method ?? 0) === STATS_METHOD_VERSION &&
      Date.now() - newest < FEE_INDEX_CACHE_REFRESH_MS;
    if (current) return { refreshed: false, categories: Number(state?.rows ?? 0), reason: "cache is current" };
  }

  const entries = buildIndexEntries(await loadNationalRows(db));
  // Inside a transaction, a savepoint keeps a cache failure from rolling back the publish.
  const savepoint = (db as { savepoint?: <T>(fn: (sp: typeof sql) => Promise<T>) => Promise<T> }).savepoint;
  try {
    if (typeof savepoint === "function") await savepoint.call(db, (sp) => writeFeeIndexCache(sp, entries, options.runId));
    else await writeFeeIndexCache(db, entries, options.runId);
  } catch (error) {
    return { refreshed: false, categories: 0, reason: `failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  // The in-process memo may hold the old index for up to a minute; drop it.
  nationalIndexCache = null;
  return { refreshed: true, categories: entries.length, reason: options.force ? "published" : "stale" };
}

async function writeFeeIndexCache(db: typeof sql, entries: IndexEntry[], runId: number): Promise<void> {
  await db`DELETE FROM fee_index_cache`;
  for (const entry of entries) {
    await db`
      INSERT INTO fee_index_cache (
        fee_category, fee_family, median_amount, p25_amount, p75_amount, min_amount, max_amount,
        institution_count, observation_count, approved_count, bank_count, cu_count, maturity_tier,
        stats_method_version, agent_run_id, computed_at
      ) VALUES (
        ${entry.fee_category}, ${entry.fee_family}, ${entry.median_amount}, ${entry.p25_amount},
        ${entry.p75_amount}, ${entry.min_amount}, ${entry.max_amount}, ${entry.institution_count},
        ${entry.observation_count}, ${entry.approved_count}, ${entry.bank_count}, ${entry.cu_count},
        ${entry.maturity_tier}, ${STATS_METHOD_VERSION}, ${runId}, NOW()
      )
    `;
  }
}

export interface StateFeeIndexes {
  /** Every institution in the state. */
  all: IndexEntry[];
  bank: IndexEntry[];
  credit_union: IndexEntry[];
  /** Distinct institutions with at least one fee that counts toward statistics. */
  verified_institutions: number;
  verified_bank_institutions: number;
  verified_cu_institutions: number;
  /** Fee rows that count toward statistics. */
  verified_fees: number;
  /**
   * Each institution's own value per category, by the same rule the medians above use, with
   * its charter ("b" bank, "c" credit union), so a page can draw the state's spread for a fee.
   * Absent on entries cached before it existed.
   */
  institution_values?: Record<string, StateInstitutionValue[]>;
}

export interface StateInstitutionValue {
  v: number;
  c: "b" | "c" | null;
}

/** One value per institution per category, under the statistics contract (valuePerInstitution). */
export function stateInstitutionValues(rows: IndexRow[]): Record<string, StateInstitutionValue[]> {
  const charterOf = new Map<number, StateInstitutionValue["c"]>();
  const byCategory = new Map<string, IndexRow[]>();
  for (const row of rows) {
    const id = Number(row.institution_id);
    if (!charterOf.has(id)) charterOf.set(id, row.charter_type === "bank" ? "b" : row.charter_type === "credit_union" ? "c" : null);
    const group = byCategory.get(row.fee_category);
    if (group) group.push(row);
    else byCategory.set(row.fee_category, [row]);
  }
  const result: Record<string, StateInstitutionValue[]> = {};
  for (const [category, group] of byCategory) {
    result[category] = [...valuePerInstitution(group)]
      .map(([id, v]) => ({ v, c: charterOf.get(id) ?? null }))
      .sort((a, b) => a.v - b.v);
  }
  return result;
}

/** Summarize already-loaded state rows into the all/bank/credit union indexes and counts. */
export function buildStateFeeIndexes(rows: IndexRow[]): StateFeeIndexes {
  const banks = rows.filter((row) => row.charter_type === "bank");
  const cus = rows.filter((row) => row.charter_type === "credit_union");
  const distinct = (list: IndexRow[]) => new Set(list.map((row) => Number(row.institution_id))).size;
  return {
    all: buildIndexEntries(rows),
    bank: buildIndexEntries(banks),
    credit_union: buildIndexEntries(cus),
    verified_institutions: distinct(rows),
    verified_bank_institutions: distinct(banks),
    verified_cu_institutions: distinct(cus),
    verified_fees: rows.length,
    institution_values: stateInstitutionValues(rows),
  };
}

/**
 * A state's index overall and by charter from one state-filtered query, so the state
 * report's bank vs credit union exhibit costs no extra reads.
 */
export async function getStateFeeIndexes(stateCode: string): Promise<StateFeeIndexes> {
  const rows = await sql.unsafe(
    `SELECT ef.fee_category, ef.amount, ef.institution_id, ef.fee_audience,
            ef.review_status, ef.created_at, ct.charter_type, ${STATS_SCHEDULE_KEYS}
       FROM published_fee_catalog ef
       JOIN institution_sources ct ON ef.institution_id = ct.id
      WHERE ct.state_code = $1
        AND ef.fee_category IS NOT NULL
        AND ef.review_status = 'approved'
        AND ${STATS_ROW_FILTER}`,
    [stateCode],
  ) as IndexRow[];
  return buildStateFeeIndexes(rows);
}

/**
 * A Fed district's index overall and by charter, with each institution's own value, from one
 * district-filtered query: the district page's board reads the same shape as the state page's.
 */
export async function getDistrictFeeIndexes(district: number): Promise<StateFeeIndexes> {
  const rows = await sql.unsafe(
    `SELECT ef.fee_category, ef.amount, ef.institution_id,
            ef.review_status, ef.created_at, ct.charter_type
       FROM published_fee_catalog ef
       JOIN institution_sources ct ON ef.institution_id = ct.id
      WHERE ct.fed_district = $1
        AND ef.fee_category IS NOT NULL
        AND ef.review_status = 'approved'
        AND ${STATS_ROW_FILTER}`,
    [district],
  ) as IndexRow[];
  return buildStateFeeIndexes(rows);
}

/** Which market a comparable index covers: the U.S., one state, or one Fed district. */
export type MarketScope = { kind: "us" } | { kind: "state"; code: string } | { kind: "district"; district: number };

/** A catalog row read for a comparable index: the index row plus what the eligibility test reads. */
export interface ComparableMarketRow extends IndexRow {
  source_document_id: number | string | null;
  /** Null unless the address could name a business-only schedule (BUSINESS_URL_SCREEN). */
  source_url: string | null;
  /** Null unless the row's text could trip the comparability rule (COMPARABILITY_SCREEN). */
  fee_name: string | null;
  account_product_type: string | null;
  source_line: string | null;
}

/** The rows of a market that the institution profile's own fees would be compared by (market-eligibility). */
export function comparableMarketRows(rows: ComparableMarketRow[]): ComparableMarketRow[] {
  return rows.filter((row) =>
    countsInMarketComparison({
      category: row.fee_category,
      amount: row.amount == null ? null : Number(row.amount),
      audience: row.fee_audience ?? null,
      sourced: row.source_document_id != null,
      sourceUrl: row.source_url,
      feeName: row.fee_name,
      accountProduct: row.account_product_type,
      sourceLine: row.source_line,
    }),
  );
}

const sqlList = (values: readonly string[]) => values.map((v) => `'${v.replace(/'/g, "''")}'`).join(",");

/**
 * A market's index (U.S., state or Fed district) under exactly the eligibility the institution
 * profile applies to its own fees (James's review, 2026-10-17): `countsInMarketComparison` runs on
 * every row, so business-only fees and a CD/IRA, card inactivity or safe deposit service fee filed
 * under another category drop out of the median as they drop out of the subject's value. The SQL
 * only narrows the read: each WHERE clause is a check the predicate repeats, and the text columns
 * are fetched only for rows the predicate's own screens could flag, so it reads what it needs
 * without loading every fee's schedule line. Read-only.
 */
export async function getComparableMarketIndex(scope: MarketScope): Promise<IndexEntry[]> {
  const where =
    scope.kind === "us"
      ? `ef.fee_category = ANY(ARRAY[${sqlList(CANONICAL_CATEGORIES)}])`
      : scope.kind === "state"
        ? "ct.state_code = $1 AND ef.fee_category IS NOT NULL"
        : "ct.fed_district = $1 AND ef.fee_category IS NOT NULL";
  const params = scope.kind === "us" ? [] : [scope.kind === "state" ? scope.code : scope.district];
  const text = `concat_ws(' ', ef.fee_name, ef.account_product_type, ef.extraction_note) ~* '${COMPARABILITY_SCREEN}'`;
  const rows = (await sql.unsafe(
    `SELECT ef.fee_category, ef.amount, ef.institution_id, ef.fee_audience,
            ef.review_status, ef.created_at, ct.charter_type, ${STATS_SCHEDULE_KEYS},
            ef.source_document_id,
            CASE WHEN ef.source_url ~* '${BUSINESS_URL_SCREEN}' THEN ef.source_url END AS source_url,
            CASE WHEN ${text} THEN ef.fee_name END AS fee_name,
            CASE WHEN ${text} THEN ef.account_product_type END AS account_product_type,
            CASE WHEN ${text} THEN substring(ef.extraction_note from 'excerpt="(.*)"$') END AS source_line
       FROM published_fee_catalog ef
       JOIN institution_sources ct ON ef.institution_id = ct.id
      WHERE ${where}
        AND ef.review_status = 'approved'
        AND ef.amount IS NOT NULL AND ef.amount >= 0
        AND ef.source_document_id IS NOT NULL
        AND COALESCE(ef.fee_audience, 'unknown') IN (${sqlList(MARKET_AUDIENCES)})`,
    params,
  )) as ComparableMarketRow[];
  return buildIndexEntries(comparableMarketRows(rows));
}

export interface PeerFeeValue {
  institution_id: number;
  institution_name: string;
  state_code: string | null;
  amount: number;
  /** The source documents behind this value, so every peer figure can be checked. */
  source_document_ids: number[];
  /** The published fee rows behind this value, so a saved output records them (H03-T09). */
  fee_published_ids?: number[];
  document_urls: string[];
  /** When the newest row behind this value was published (ISO). */
  published_at: string | null;
  /**
   * The published_fee_catalog rows this value is built from (#981, H06-T04), so a peer median can
   * name the records behind it. Absent where a reader does not load them.
   */
  fee_records?: PeerFeeRecord[];
  /**
   * Statistics rule 7 (count once): the sister charter this value counts as, when this charter
   * shares its fee schedule with a lower-id charter of the same holding company among the rows
   * read. Absent when the institution counts as itself (always, while the rule is off).
   */
  counted_as?: number;
}

/** One published_fee_catalog row behind a peer's value. */
export interface PeerFeeRecord {
  id: number;
  amount: number;
  fee_name: string | null;
  frequency: string | null;
  fee_audience: "consumer" | "business" | "both" | "unknown";
  source_document_id: number | null;
  document_url: string | null;
  /** The row's conditions (a waiver, a limit) as a reader sees them; only when asked for (withConditions). */
  conditions?: string | null;
}

/** Options for getPeerFeeValues. */
export interface PeerFeeValueOptions {
  /**
   * Read only these institutions' rows. Every value is still built by the same contract; a
   * caller whose sets are all hand-picked passes their union so the read skips everyone else.
   */
  onlyInstitutionIds?: number[];
  /** Attach each record's conditions (readerFeeConditions), for a page that shows waivers. */
  withConditions?: boolean;
}

function peerFeeRecords(rows: Array<{ id?: number | string | null; amount: number | string | null; fee_name?: string | null; frequency?: string | null; fee_audience?: string | null; source_document_id: number | string | null; document_url: string | null; conditions?: string | null }>, withConditions = false): PeerFeeRecord[] {
  const records: PeerFeeRecord[] = [];
  for (const r of rows) {
    const id = Number(r.id);
    const amount = r.amount === null || r.amount === "" ? NaN : Number(r.amount);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(amount)) continue;
    const doc = Number(r.source_document_id);
    records.push({
      id, amount,
      fee_name: typeof r.fee_name === "string" ? r.fee_name : null,
      frequency: typeof r.frequency === "string" ? r.frequency : null,
      fee_audience: r.fee_audience === "consumer" || r.fee_audience === "business" || r.fee_audience === "both" ? r.fee_audience : "unknown",
      source_document_id: Number.isSafeInteger(doc) && doc > 0 ? doc : null,
      document_url: r.document_url ?? null,
      ...(withConditions ? { conditions: readerFeeConditions(r.conditions) } : {}),
    });
  }
  return records.sort((a, b) => a.id - b.id);
}

/** The distinct published fee row ids among a peer's rows; rows read without the column give none. */
function feeIdsOf(rows: { fee_published_id?: number | string | null }[]): number[] {
  return [...new Set(rows.map((r) => Number(r.fee_published_id)).filter((v) => Number.isSafeInteger(v) && v > 0))];
}

/**
 * Each peer's own value per category under the statistics contract (the same value the
 * medians are built from), so a scenario can count exactly how many peers charge more,
 * the same or less. Rows are loaded once and split per filter set; results follow the
 * order of `filterSets`. The target institution is left out of its own peer group.
 */
export async function getPeerFeeValues(
  filterSets: PeerFilterSet[],
  categories: string[],
  excludeInstitutionId?: number,
  options: PeerFeeValueOptions = {},
): Promise<Map<string, PeerFeeValue[]>[]> {
  if (categories.length === 0 || filterSets.length === 0) return filterSets.map(() => new Map());
  const only = options.onlyInstitutionIds?.filter((id) => Number.isSafeInteger(id) && id > 0);
  if (only && only.length === 0) return filterSets.map(() => new Map());
  const rows = await sql.unsafe(
    `SELECT ef.id, ef.fee_category, ef.amount, ef.institution_id, ct.institution_name,
            ct.charter_type, ct.asset_size_tier, ct.fed_district, ct.state_code,
            ef.source_document_id, ef.document_url, ef.created_at, ef.fee_published_id,
            ef.fee_name, ef.frequency, ef.fee_audience${options.withConditions ? ", ef.conditions" : ""}, ${STATS_SCHEDULE_KEYS}
       FROM published_fee_catalog ef
       JOIN institution_sources ct ON ef.institution_id = ct.id
      WHERE ef.fee_category = ANY($1::text[])${only ? "\n        AND ef.institution_id = ANY($2::bigint[])" : ""}
        AND ef.review_status = 'approved'
        AND ${STATS_ROW_FILTER}`,
    (only ? [categories, only] : [categories]) as never[],
  ) as (PeerRow & {
    id: number | string;
    institution_name: string;
    source_document_id: number | string | null;
    document_url: string | null;
    created_at: Date | string | null;
    fee_published_id?: number | string | null;
    fee_name: string | null;
    frequency: string | null;
    fee_audience: string | null;
    conditions?: string | null;
  })[];
  const peerRows = rows.filter((row) => Number(row.institution_id) !== excludeInstitutionId);
  const meta = new Map(peerRows.map((row) => [Number(row.institution_id), row]));
  return filterSets.map((filters) => {
    const byCategory = new Map<string, typeof peerRows>();
    for (const row of peerRows) {
      if (!matchesPeerFilters(row, filters)) continue;
      const list = byCategory.get(row.fee_category) ?? [];
      list.push(row);
      byCategory.set(row.fee_category, list);
    }
    const result = new Map<string, PeerFeeValue[]>();
    for (const [category, list] of byCategory) {
      const values: PeerFeeValue[] = [];
      const representatives = countedRepresentatives(list);
      for (const [id, amount] of valuePerInstitution(list)) {
        const countedAs = representatives?.get(id);
        const row = meta.get(id);
        const own = list.filter((r) => Number(r.institution_id) === id);
        const docIds = [...new Set(own.map((r) => Number(r.source_document_id)).filter((v) => Number.isFinite(v) && v > 0))];
        const urls = [...new Set(own.map((r) => r.document_url).filter((v): v is string => !!v))];
        const published = own
          .map((r) => ((r.created_at as unknown) instanceof Date ? (r.created_at as unknown as Date).toISOString() : r.created_at ? String(r.created_at) : null))
          .filter((v): v is string => !!v)
          .sort()
          .pop() ?? null;
        values.push({
          institution_id: id,
          institution_name: row?.institution_name ?? `Institution ${id}`,
          state_code: row?.state_code ?? null,
          amount,
          source_document_ids: docIds,
          fee_published_ids: feeIdsOf(own),
          document_urls: urls,
          published_at: published,
          fee_records: peerFeeRecords(own, options.withConditions),
          ...(countedAs !== undefined && countedAs !== id ? { counted_as: countedAs } : {}),
        });
      }
      result.set(category, values.sort((a, b) => a.amount - b.amount));
    }
    return result;
  });
}

export interface SegmentFilter {
  /** Total assets in thousands of dollars. */
  minAssets: number | null;
  maxAssets: number | null;
  charterType: string | null;
  stateCode: string | null;
  /** Keep only the N largest by assets after the other filters. */
  largest: number | null;
}

export interface SegmentFeeValue extends PeerFeeValue {
  total_assets: number | null;
  charter_type: string | null;
}

/**
 * One fee (and its daily cap, when given) across a segment of the registry: how many active
 * institutions fit, and each one's value under the statistics contract with its documents.
 */
export async function getSegmentFeeValues(
  filter: SegmentFilter,
  feeCategory: string,
  capCategory: string | null,
  excludeInstitutionId?: number,
): Promise<{
  institutionsInSegment: number;
  ownInSegment: boolean;
  values: SegmentFeeValue[];
  caps: Map<number, number>;
  limits: Map<number, DailyFeeLimit>;
}> {
  const params = [filter.minAssets, filter.maxAssets, filter.charterType, filter.stateCode, filter.largest ?? null];
  const segmentSql = `
    SELECT ct.id
      FROM institution_sources ct
     WHERE COALESCE(ct.regulatory_status, 'active') <> 'inactive'
       AND ($1::bigint IS NULL OR ct.asset_size >= $1)
       AND ($2::bigint IS NULL OR ct.asset_size < $2)
       AND ($3::text IS NULL OR ct.charter_type = $3)
       AND ($4::text IS NULL OR ct.state_code = $4)
       AND ($5::int IS NULL OR ct.asset_size IS NOT NULL)
     ORDER BY ct.asset_size DESC NULLS LAST, ct.id
     LIMIT COALESCE($5::int, 100000)`;
  // Counted without the asking institution, as the values are.
  const [countRow] = (await sql.unsafe(
    `SELECT COUNT(*) FILTER (WHERE s.id IS DISTINCT FROM $6::int)::int AS n, COALESCE(BOOL_OR(s.id = $6::int), false) AS own
       FROM (${segmentSql}) s`,
    [...params, excludeInstitutionId ?? null] as never[],
  )) as { n: number; own: boolean }[];
  const categories = capCategory ? [feeCategory, capCategory] : [feeCategory];
  const rows = (await sql.unsafe(
    `WITH seg AS (${segmentSql})
     SELECT ef.fee_category, ef.amount, ef.institution_id, ct.institution_name, ct.charter_type,
            ct.state_code, ct.asset_size, ef.source_document_id, ef.document_url, ef.created_at, ef.fee_published_id,
            ${STATS_SCHEDULE_KEYS}
       FROM published_fee_catalog ef
       JOIN institution_sources ct ON ef.institution_id = ct.id
       JOIN seg ON seg.id = ct.id
      WHERE ef.fee_category = ANY($6::text[])
        AND ef.review_status = 'approved'
        AND ${STATS_ROW_FILTER}`,
    [...params, categories] as never[],
  )) as {
    fee_category: string;
    amount: number | string | null;
    institution_id: number | string;
    institution_name: string;
    charter_type: string | null;
    state_code: string | null;
    asset_size: number | string | null;
    source_document_id: number | string | null;
    document_url: string | null;
    created_at: Date | string | null;
    fee_published_id?: number | string | null;
    schedule_keys?: string[] | null;
    schedule_group?: string | null;
  }[];
  const kept = rows.filter((r) => Number(r.institution_id) !== excludeInstitutionId);
  const iso = (v: Date | string | null) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
  const feeRows = kept.filter((r) => r.fee_category === feeCategory);
  const values: SegmentFeeValue[] = [];
  const representatives = countedRepresentatives(feeRows);
  for (const [id, amount] of valuePerInstitution(feeRows.map((r) => ({ ...r, institution_id: Number(r.institution_id) })))) {
    const own = feeRows.filter((r) => Number(r.institution_id) === id);
    const first = own[0];
    const countedAs = representatives?.get(id);
    values.push({
      institution_id: id,
      institution_name: first?.institution_name ?? `Institution ${id}`,
      state_code: first?.state_code ?? null,
      amount,
      source_document_ids: [...new Set(own.map((r) => Number(r.source_document_id)).filter((v) => Number.isFinite(v) && v > 0))],
      fee_published_ids: feeIdsOf(own),
      document_urls: [...new Set(own.map((r) => r.document_url).filter((v): v is string => !!v))],
      published_at: own.map((r) => iso(r.created_at)).filter((v): v is string => !!v).sort().pop() ?? null,
      total_assets: first?.asset_size === null || first?.asset_size === undefined ? null : Number(first.asset_size),
      charter_type: first?.charter_type ?? null,
      ...(countedAs !== undefined && countedAs !== id ? { counted_as: countedAs } : {}),
    });
  }
  const capRows = capCategory ? kept.filter((r) => r.fee_category === capCategory) : [];
  const caps = valuePerInstitution(capRows.map((r) => ({ ...r, institution_id: Number(r.institution_id) })));
  const limits = await getDailyFeeLimits(values, feeCategory);
  return { institutionsInSegment: Number(countRow?.n ?? 0), ownInSegment: Boolean(countRow?.own), values, caps, limits };
}

/**
 * The daily limit on how many overdraft or NSF fees each institution charges ("Maximum 3
 * Overdraft fees per day"), read from the stored text of the documents its live fee came
 * from. Only the lines that mention a day (and the line above each) leave the database.
 */
export async function getDailyFeeLimits(
  values: Pick<PeerFeeValue, "institution_id" | "source_document_ids">[],
  feeCategory: string,
): Promise<Map<number, DailyFeeLimit>> {
  const limits = new Map<number, DailyFeeLimit>();
  if (feeCategory !== "overdraft" && feeCategory !== "nsf") return limits;
  const documentIds = [...new Set(values.flatMap((v) => v.source_document_ids))];
  if (documentIds.length === 0) return limits;
  const rows = (await sql.unsafe(
    `SELECT t.source_document_id,
            (SELECT string_agg(left(l.prev, 300) || E'\\n' || left(l.line, 1200), E'\\n' ORDER BY l.n)
               FROM (SELECT x.line, x.n, lag(x.line, 1, '') OVER (ORDER BY x.n) AS prev
                       FROM unnest(string_to_array(t.normalized_text, E'\\n')) WITH ORDINALITY AS x(line, n)) l
              WHERE l.line ~* '\\mday\\M') AS day_lines
       FROM (SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
               FROM agent_source_texts
              WHERE source_document_id = ANY($1::bigint[])
                AND status = 'completed'
                AND normalized_text IS NOT NULL
              ORDER BY source_document_id, id DESC) t`,
    [documentIds] as never[],
  )) as { source_document_id: number | string; day_lines: string | null }[];
  const byDocument = new Map(rows.map((r) => [Number(r.source_document_id), r.day_lines]));
  for (const value of values) {
    for (const documentId of value.source_document_ids) {
      const limit = dailyFeeLimitFor(byDocument.get(documentId), feeCategory);
      if (limit) {
        limits.set(value.institution_id, limit);
        break;
      }
    }
  }
  return limits;
}

/**
 * Several fees for a list of institutions, one value each under the statistics contract:
 * institution id -> fee category -> amount. An institution or fee with no counted row is absent.
 */
export async function getFeeValuesForInstitutions(
  institutionIds: number[],
  categories: string[],
): Promise<Map<number, Map<string, number>>> {
  const out = new Map<number, Map<string, number>>();
  if (institutionIds.length === 0 || categories.length === 0) return out;
  const rows = (await sql.unsafe(
    `SELECT ef.institution_id, ef.fee_category, ef.amount
       FROM published_fee_catalog ef
      WHERE ef.institution_id = ANY($1::int[])
        AND ef.fee_category = ANY($2::text[])
        AND ef.review_status = 'approved'
        AND ${STATS_ROW_FILTER}`,
    [institutionIds, categories] as never[],
  )) as { institution_id: number | string; fee_category: string; amount: number | string | null }[];
  for (const category of categories) {
    const list = rows.filter((r) => r.fee_category === category).map((r) => ({ ...r, institution_id: Number(r.institution_id) }));
    for (const [id, value] of valuePerInstitution(list)) {
      const own = out.get(id) ?? new Map<string, number>();
      own.set(category, value);
      out.set(id, own);
    }
  }
  return out;
}
