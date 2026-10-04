import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const configuredPoolMax = Number(process.env.DATABASE_POOL_MAX ?? 5);
const DATABASE_POOL_MAX = Number.isInteger(configuredPoolMax) && configuredPoolMax > 0
  ? configuredPoolMax
  : 5;

let _sql: AppSql | null = null;

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

/**
 * Postgres text cannot hold NUL (U+0000): any parameter containing one fails the whole
 * statement with `invalid byte sequence for encoding "UTF8": 0x00`, and jsonb rejects
 * the `\u0000` escape. PDFs and some HTML carry stray NULs, so every text and JSON
 * parameter is stripped of them here, at the one place all writes pass through.
 */
export function stripNulChars(value: string): string {
  return value.includes("\u0000") ? value.replace(/\u0000/g, "") : value;
}

function stripNulDeep(_key: string, value: unknown): unknown {
  return typeof value === "string" ? stripNulChars(value) : value;
}

/** text (25), bpchar (1042) and varchar (1043) parameters, NULs stripped. */
export const TEXT_WITHOUT_NUL = {
  to: 25,
  from: [25, 1042, 1043],
  serialize: (value: unknown) => stripNulChars(String(value)),
  parse: (value: string) => value,
};

/**
 * json/jsonb parameters. postgres.js JSON-encodes every json/jsonb parameter, so the
 * common `${JSON.stringify(x)}::jsonb` pattern was stored as a JSON *string*
 * ("[\"a\"]") instead of an array or object. SQL JSON operators then never matched
 * (Darwin's `outlier_flags ? 'needs_darwin_verification'` selected nothing). Text
 * that already is a JSON object or array passes through unchanged; everything
 * else is encoded as before.
 */
export function serializeJsonParam(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        // Re-encode only when a NUL escape is present, so clean text passes through as is.
        return trimmed.includes("\\u0000") ? JSON.stringify(parsed, stripNulDeep) : trimmed;
      } catch {
        // Not JSON text: encode it as a JSON string below.
      }
    }
  }
  return JSON.stringify(value, stripNulDeep);
}

export const JSON_TEXT_PASSTHROUGH = {
  to: 3802,
  from: [114, 3802],
  serialize: serializeJsonParam,
  parse: (value: string) => JSON.parse(value) as unknown,
};

function connect(databaseUrl: string) {
  return postgres(databaseUrl, {
    ssl: "require",
    // Keep serverless instances below the shared Supabase/Supavisor ceiling.
    // Higher fan-out queues locally instead of hanging on connection startup.
    max: DATABASE_POOL_MAX,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,  // Required for Supabase transaction mode pooler (port 6543)
    types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL },
  });
}

/**
 * Declared explicitly (the generic client type every caller already uses) so getSql()
 * never depends on inference through an import cycle.
 */
type AppSql = ReturnType<typeof postgres>;

export function getSql(): AppSql {
  if (!_sql) {
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    _sql = connect(DATABASE_URL);
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

/**
 * How long hasData() waits before treating the database as unavailable. It gates
 * generateStaticParams at build time, and a saturated pool used to leave it hanging
 * until the deploy timed out; giving up just skips prerendering, and the pages
 * render on first request instead.
 */
const HAS_DATA_TIMEOUT_MS = 5_000;

export async function hasData(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), HAS_DATA_TIMEOUT_MS);
    });
    const counted = getSql()`SELECT 1 FROM institution_sources LIMIT 1`.then((rows) => rows.length > 0, () => false);
    return await Promise.race([counted, timedOut]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
