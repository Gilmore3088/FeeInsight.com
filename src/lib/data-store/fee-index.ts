import { sql } from "./connection";
import { getFeeFamily, FEE_FAMILIES } from "@/lib/fee-taxonomy";
import {
  MIN_INSTITUTIONS_FOR_MEDIAN,
  STATS_ROW_FILTER,
  summarizeFeesBy,
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
}

/**
 * Every published row is approved (the catalog view has no other status), so
 * `approvedOnly` changes nothing; statistics follow the contract in fee-stats.ts.
 */
export async function getNationalIndex(approvedOnly = true): Promise<IndexEntry[]> {
  const statusFilter = approvedOnly
    ? "ef.review_status = 'approved'"
    : "ef.review_status != 'rejected'";

  const rows = await sql.unsafe(
    `SELECT ef.fee_category, ef.amount, ef.institution_id,
            ef.review_status, ef.created_at, ct.charter_type
     FROM published_fee_catalog ef
     JOIN institution_sources ct ON ef.institution_id = ct.id
     WHERE ef.fee_category = ANY(ARRAY[${CANONICAL_CATEGORIES.map((c) => `'${c}'`).join(",")}])
       AND ${statusFilter}
       AND ${STATS_ROW_FILTER}`
  ) as {
    fee_category: string;
    amount: number | null;
    institution_id: number;
    review_status: string;
    created_at: string;
    charter_type: string;
  }[];

  return buildIndexEntries(rows);
}

export async function getPeerIndex(
  filters: {
    charter_type?: string;
    asset_tiers?: string[];
    fed_districts?: number[];
    state_code?: string;
  },
  approvedOnly = true
): Promise<IndexEntry[]> {
  const conditions = ["ef.fee_category IS NOT NULL", STATS_ROW_FILTER];
  const params: (string | number)[] = [];
  let paramIdx = 0;

  conditions.push(
    approvedOnly
      ? "ef.review_status = 'approved'"
      : "ef.review_status != 'rejected'"
  );

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

  const where = conditions.join(" AND ");

  const rows = await sql.unsafe(
    `SELECT ef.fee_category, ef.amount, ef.institution_id,
            ef.review_status, ef.created_at, ct.charter_type
     FROM published_fee_catalog ef
     JOIN institution_sources ct ON ef.institution_id = ct.id
     WHERE ${where}`,
    params
  ) as {
    fee_category: string;
    amount: number | null;
    institution_id: number;
    review_status: string;
    created_at: string;
    charter_type: string;
  }[];

  return buildIndexEntries(rows);
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
    `SELECT ef.amount, ct.fed_district, ef.institution_id
     FROM published_fee_catalog ef
     JOIN institution_sources ct ON ef.institution_id = ct.id
     WHERE ${conditions.join(" AND ")}`,
    params
  ) as {
    amount: number | null;
    fed_district: number;
    institution_id: number;
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
    SELECT ef.fee_category, ef.amount, ef.institution_id
    FROM published_fee_catalog ef
    JOIN institution_sources ct ON ef.institution_id = ct.id
    WHERE ct.fed_district = ${district}
      AND ef.review_status = 'approved'
      AND ef.source_document_id IS NOT NULL
      AND ef.fee_category IS NOT NULL
      AND ef.amount IS NOT NULL
  ` as { fee_category: string; amount: number | null; institution_id: number }[];

  return [...summarizeFeesBy(rows, (row) => row.fee_category).entries()]
    .filter(([, stats]) => stats.median_amount !== null && stats.institution_count >= MIN_INSTITUTIONS_FOR_MEDIAN)
    .map(([fee_category, stats]) => ({
      fee_category,
      median_amount: stats.median_amount as number,
      institution_count: stats.institution_count,
    }))
    .sort((a, b) => b.institution_count - a.institution_count);
}

function buildIndexEntries(
  rows: {
    fee_category: string;
    amount: number | null;
    institution_id: number;
    review_status: string;
    created_at: string;
    charter_type: string;
  }[]
): IndexEntry[] {
  const latestByCategory = new Map<string, string>();
  for (const row of rows) {
    const createdAt = (row.created_at as unknown) instanceof Date
      ? (row.created_at as unknown as Date).toISOString()
      : String(row.created_at ?? "");
    if (createdAt > (latestByCategory.get(row.fee_category) ?? "")) {
      latestByCategory.set(row.fee_category, createdAt);
    }
  }

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
    });
  }

  results.sort((a, b) => b.institution_count - a.institution_count);
  return results;
}

/**
 * Read precomputed index from fee_index_cache (materialized by publish-index).
 * Falls back to live computation if the cache is empty or older than NATIONAL_INDEX_CACHE_MAX_AGE_MS.
 */
const NATIONAL_INDEX_CACHE_TTL_MS = 60_000;
/** Rows in fee_index_cache older than this are ignored in favor of a live computation. */
const NATIONAL_INDEX_CACHE_MAX_AGE_MS = 36 * 60 * 60 * 1000;
let nationalIndexCache: {
  expiresAt: number;
  value: IndexEntry[];
} | null = null;
let nationalIndexCachePromise: Promise<IndexEntry[]> | null = null;

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
    }[];

    // The cache is only trustworthy when a publish step rebuilt it recently. A stale
    // cache (e.g. left over from before the agentic pipeline) must never be served.
    const newest = rows.reduce<number>((max, row) => {
      const at = row.computed_at ? new Date(row.computed_at).getTime() : 0;
      return Number.isFinite(at) && at > max ? at : max;
    }, 0);
    if (rows.length === 0 || Date.now() - newest > NATIONAL_INDEX_CACHE_MAX_AGE_MS) {
      return getNationalIndex();
    }

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
