import { sql } from "./connection";
import { getFeeFamily, FEE_FAMILIES } from "@/lib/fee-taxonomy";
import {
  MIN_INSTITUTIONS_FOR_MEDIAN,
  STATS_METHOD_VERSION,
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
  return buildIndexEntries(await loadNationalRows(sql, approvedOnly));
}

type IndexRow = {
  fee_category: string;
  amount: number | null;
  institution_id: number;
  review_status: string;
  created_at: string;
  charter_type: string;
};

async function loadNationalRows(db: typeof sql, approvedOnly = true): Promise<IndexRow[]> {
  const statusFilter = approvedOnly
    ? "ef.review_status = 'approved'"
    : "ef.review_status != 'rejected'";

  return await db.unsafe(
    `SELECT ef.fee_category, ef.amount, ef.institution_id,
            ef.review_status, ef.created_at, ct.charter_type
     FROM published_fee_catalog ef
     JOIN institution_sources ct ON ef.institution_id = ct.id
     WHERE ef.fee_category = ANY(ARRAY[${CANONICAL_CATEGORIES.map((c) => `'${c}'`).join(",")}])
       AND ${statusFilter}
       AND ${STATS_ROW_FILTER}`
  ) as IndexRow[];
}

export interface ContractFeeRow {
  institution_id: number;
  fee_category: string;
  amount: number | null;
  institution_name: string;
  state_code: string | null;
  charter_type: string | null;
  asset_size_tier: string | null;
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
            ct.state_code, ct.charter_type, ct.asset_size_tier
       FROM published_fee_catalog ef
       JOIN institution_sources ct ON ef.institution_id = ct.id
      WHERE ${conditions.join(" AND ")}`,
    params as never[],
  ) as ContractFeeRow[];
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
