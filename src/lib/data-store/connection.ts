import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const configuredPoolMax = Number(process.env.DATABASE_POOL_MAX ?? 5);
const DATABASE_POOL_MAX = Number.isInteger(configuredPoolMax) && configuredPoolMax > 0
  ? configuredPoolMax
  : 5;

let _sql: ReturnType<typeof postgres> | null = null;

/**
 * NUMERIC (oid 1700) arrives from postgres.js as a string by default. Fee amounts
 * and percentiles are NUMERIC, and string values silently broke arithmetic (string
 * concatenation inside percentile interpolation). Parse to number at the boundary.
 */
export const NUMERIC_AS_NUMBER = {
  to: 1700,
  from: [1700],
  serialize: (value: unknown) => String(value),
  parse: (value: string) => Number.parseFloat(value),
};

export function getSql() {
  if (!_sql) {
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    _sql = postgres(DATABASE_URL, {
      ssl: "require",
      // Keep serverless instances below the shared Supabase/Supavisor ceiling.
      // Higher fan-out queues locally instead of hanging on connection startup.
      max: DATABASE_POOL_MAX,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,  // Required for Supabase transaction mode pooler (port 6543)
      types: { numeric: NUMERIC_AS_NUMBER },
    });
  }
  return _sql;
}

// Eager init — DATABASE_URL must be set at import time.
// For tests that import modules without DB access, set DATABASE_URL to any value
// or mock this module.
export const sql = DATABASE_URL
  ? getSql()
  : ((() => { throw new Error("DATABASE_URL not set"); }) as unknown as ReturnType<typeof postgres>);

/** Keep transaction callbacks callable despite postgres.js omitting the tag signature from its public transaction type. */
export function withTransaction<T>(callback: (tx: typeof sql) => Promise<T>): Promise<T> {
  return sql.begin((tx) => callback(tx as unknown as typeof sql)) as Promise<T>;
}

export async function hasData(): Promise<boolean> {
  try {
    const [row] = await getSql()`SELECT COUNT(*) as cnt FROM institution_sources`;
    return Number(row.cnt) > 0;
  } catch {
    return false;
  }
}
