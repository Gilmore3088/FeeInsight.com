import { sql } from "./connection";
import { getFeeFamily, FEE_FAMILIES } from "@/lib/fee-taxonomy";
import { categoryStats, STATS_METHOD_VERSION, type StatsBasis } from "./fee-stats";

/** All 49 canonical fee categories — only these appear in indexes and reports */
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
  /** Institutions whose fee traces to a stored source document. */
  sourced_institution_count: number;
  /** Institutions known only from the legacy backfill. */
  legacy_institution_count: number;
  /** "sourced": computed from sourced institutions only; "blended": includes legacy data. */
  basis: StatsBasis;
  stats_method_version: number;
}

interface IndexRow {
  fee_category: string;
  amount: number | null;
  institution_id: number;
  review_status: string;
  created_at: string;
  charter_type: string;
  source_document_id: number | null;
}

export async function getNationalIndex(approvedOnly = true): Promise<IndexEntry[]> {
  return buildIndexEntries(await loadNationalRows(sql, approvedOnly));
}

async function loadNationalRows(db: typeof sql, approvedOnly = true): Promise<IndexRow[]> {
  const statusFilter = approvedOnly
    ? "ef.review_status = 'approved'"
    : "ef.review_status != 'rejected'";

  return await db.unsafe(
    `SELECT ef.fee_category, ef.amount, ef.institution_id,
            ef.review_status, ef.created_at, ct.charter_type, ef.source_document_id
     FROM published_fee_catalog ef
     JOIN institution_sources ct ON ef.institution_id = ct.id
     WHERE ef.fee_category = ANY(ARRAY[${CANONICAL_CATEGORIES.map((c) => `'${c}'`).join(",")}]) AND ${statusFilter}`
  ) as IndexRow[];
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
  const conditions = ["ef.fee_category IS NOT NULL"];
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
            ef.review_status, ef.created_at, ct.charter_type, ef.source_document_id
     FROM published_fee_catalog ef
     JOIN institution_sources ct ON ef.institution_id = ct.id
     WHERE ${where}`,
    params
  ) as IndexRow[];

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

export async function getDistrictFeeMedians(
  district: number
): Promise<{ fee_category: string; median_amount: number; institution_count: number }[]> {
  const rows = await sql`
    SELECT ef.fee_category, ef.amount, ef.institution_id, ef.source_document_id
    FROM published_fee_catalog ef
    JOIN institution_sources ct ON ef.institution_id = ct.id
    WHERE ct.fed_district = ${district}
      AND ef.review_status = 'approved'
  `;
  const grouped = new Map<string, Array<{ institution_id: number; amount: number | null; sourced: boolean }>>();
  for (const row of rows) {
    const category = String(row.fee_category);
    const list = grouped.get(category) ?? [];
    list.push({ institution_id: Number(row.institution_id), amount: row.amount as number | null, sourced: row.source_document_id != null });
    grouped.set(category, list);
  }
  return [...grouped.entries()]
    .map(([fee_category, groupRows]) => ({ fee_category, stats: categoryStats(groupRows) }))
    .filter((entry) => entry.stats.median != null)
    .map((entry) => ({
      fee_category: entry.fee_category,
      median_amount: entry.stats.median as number,
      institution_count: entry.stats.institution_count,
    }))
    .sort((a, b) => b.institution_count - a.institution_count);
}

/** Index entries under the statistics contract (src/lib/data-store/fee-stats.ts). */
export function buildIndexEntries(rows: IndexRow[]): IndexEntry[] {
  const grouped = new Map<string, { rows: IndexRow[]; approved: number; latest: string }>();
  for (const row of rows) {
    const entry = grouped.get(row.fee_category) ?? { rows: [], approved: 0, latest: "" };
    entry.rows.push(row);
    if (row.review_status === "approved") entry.approved++;
    const createdAt = (row.created_at as unknown) instanceof Date
      ? (row.created_at as unknown as Date).toISOString()
      : String(row.created_at ?? "");
    if (createdAt > entry.latest) entry.latest = createdAt;
    grouped.set(row.fee_category, entry);
  }

  const results: IndexEntry[] = [];
  for (const [category, data] of grouped.entries()) {
    const stats = categoryStats(
      data.rows.map((row) => ({
        institution_id: row.institution_id,
        amount: row.amount,
        sourced: row.source_document_id != null,
        charter_type: row.charter_type,
      })),
    );
    results.push({
      fee_category: category,
      fee_family: getFeeFamily(category),
      median_amount: stats.median,
      p25_amount: stats.p25,
      p75_amount: stats.p75,
      min_amount: stats.min,
      max_amount: stats.max,
      institution_count: stats.institution_count,
      observation_count: data.rows.length,
      approved_count: data.approved,
      bank_count: stats.bank_count,
      cu_count: stats.cu_count,
      maturity_tier: stats.maturity,
      last_updated: data.latest || null,
      sourced_institution_count: stats.sourced_institution_count,
      legacy_institution_count: stats.legacy_institution_count,
      basis: stats.basis,
      stats_method_version: stats.stats_method_version,
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
      sourced_institution_count?: number | null;
      legacy_institution_count?: number | null;
      basis?: string | null;
      stats_method_version?: number | null;
    }[];

    // The cache is only trustworthy when a publish step rebuilt it recently. A stale
    // cache (e.g. left over from before the agentic pipeline) must never be served.
    const newest = rows.reduce<number>((max, row) => {
      const at = row.computed_at ? new Date(row.computed_at).getTime() : 0;
      return Number.isFinite(at) && at > max ? at : max;
    }, 0);
    // Rows computed under an older statistics method are stale too.
    const currentMethod = rows.every((row) => Number(row.stats_method_version ?? 0) === STATS_METHOD_VERSION);
    if (rows.length === 0 || !currentMethod || Date.now() - newest > NATIONAL_INDEX_CACHE_MAX_AGE_MS) {
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
      sourced_institution_count: Number(row.sourced_institution_count ?? 0),
      legacy_institution_count: Number(row.legacy_institution_count ?? 0),
      basis: (row.basis === "sourced" ? "sourced" : "blended") as StatsBasis,
      stats_method_version: Number(row.stats_method_version ?? 0),
    }));
  } catch {
    return getNationalIndex();
  }
}

/** True once the stats-contract migration added the method/basis columns to the cache. */
async function feeIndexCacheContractReady(db: typeof sql): Promise<boolean> {
  const [row] = await db`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'fee_index_cache' AND column_name = 'stats_method_version'
    ) AS ready
  `;
  return row?.ready === true;
}

export interface FeeIndexCacheRefresh {
  refreshed: boolean;
  categories: number;
  sourcedCategories: number;
  reason: string;
}

/**
 * Rebuilds fee_index_cache from published fees under the statistics contract. Hamilton
 * calls it in its publish transaction (so it sees the rows it just published) whenever
 * it published something or the cache is stale or from an older method.
 */
export async function refreshFeeIndexCache(
  db: typeof sql,
  options: { runId: number; force?: boolean },
): Promise<FeeIndexCacheRefresh> {
  if (!(await feeIndexCacheContractReady(db))) {
    return { refreshed: false, categories: 0, sourcedCategories: 0, reason: "cache migration not applied" };
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
      Date.now() - newest < 6 * 60 * 60 * 1000;
    if (current) return { refreshed: false, categories: Number(state?.rows ?? 0), sourcedCategories: 0, reason: "cache is current" };
  }

  const entries = buildIndexEntries(await loadNationalRows(db));
  await db`DELETE FROM fee_index_cache`;
  for (const entry of entries) {
    await db`
      INSERT INTO fee_index_cache (
        fee_category, fee_family, median_amount, p25_amount, p75_amount, min_amount, max_amount,
        institution_count, observation_count, approved_count, bank_count, cu_count, maturity_tier,
        sourced_institution_count, legacy_institution_count, basis, stats_method_version,
        agent_run_id, computed_at
      ) VALUES (
        ${entry.fee_category}, ${entry.fee_family}, ${entry.median_amount}, ${entry.p25_amount},
        ${entry.p75_amount}, ${entry.min_amount}, ${entry.max_amount}, ${entry.institution_count},
        ${entry.observation_count}, ${entry.approved_count}, ${entry.bank_count}, ${entry.cu_count},
        ${entry.maturity_tier}, ${entry.sourced_institution_count}, ${entry.legacy_institution_count},
        ${entry.basis}, ${entry.stats_method_version}, ${options.runId}, NOW()
      )
    `;
  }
  // The in-process memo may hold the old index for up to a minute; drop it.
  nationalIndexCache = null;
  return {
    refreshed: true,
    categories: entries.length,
    sourcedCategories: entries.filter((entry) => entry.basis === "sourced").length,
    reason: options.force ? "forced" : "published or stale",
  };
}
