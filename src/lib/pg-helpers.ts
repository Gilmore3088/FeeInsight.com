/**
 * Postgres type helpers.
 *
 * postgres.js returns typed values unlike SQLite's string-only returns:
 * - TIMESTAMPTZ → Date object
 * - JSONB → parsed object/array
 * - BIGINT/NUMERIC → string (for precision)
 *
 * These helpers normalize both formats so code works with either backend.
 */

/** Safe JSONB parse — handles both string (SQLite) and parsed object (Postgres) */
export function safeJsonb<T>(val: unknown): T | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return null;
    }
  }
  return val as T;
}

/** Safe date to ISO string — handles Date objects and strings */
export function toISO(val: string | Date | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

/** Format date for display (YYYY-MM-DD) */
export function toDateStr(val: string | Date | null | undefined): string {
  if (!val) return "-";
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return "-";
  return d.toISOString().slice(0, 10);
}
