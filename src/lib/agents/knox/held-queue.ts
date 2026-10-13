import type { sql } from "@/lib/data-store/connection";
import { HELD_RECHECK_DEFAULT_LIMIT, HELD_RATE_RECHECK_DEFAULT_LIMIT, HELD_SET_ASIDE_AFTER_VERSIONS, UNTRACED_RECHECK_LIMIT } from "./held-recheck";

type SqlTag = typeof sql;

/**
 * Knox's held lines (#1102, the "show the held pile" step): every line Knox kept without
 * sending it to Darwin, by the shape it was held for (`knox_review:<shape>`), with its count,
 * how many are set aside, how many arrived in the last 7 days, its oldest, one example, and the
 * way out the code gives it today (`held-recheck.ts`). Read-only. A shape with no way out says so.
 */

export interface KnoxHoldGroup {
  shape: string;
  label: string;
  count: number;
  setAside: number;
  newThisWeek: number;
  oldest: string | null;
  example: { feeName: string; amount: number | null } | null;
  wayOut: string;
  hasExit: boolean;
}

const SHAPES: Record<string, { label: string; wayOut: string; hasExit: boolean }> = {
  unclassified: {
    label: "No category Knox could match",
    wayOut: `Re-read ${HELD_RECHECK_DEFAULT_LIMIT} a step when Knox's rules change; set aside after ${HELD_SET_ASIDE_AFTER_VERSIONS} versions, never deleted. Names the store can't settle go to the label queue.`,
    hasExit: true,
  },
  range: {
    label: "A range (\"$5–$10\")",
    wayOut: "Re-read only when the line says a price changed. Publishing a range waits on somewhere to store it (#1060).",
    hasExit: false,
  },
  percentage: {
    label: "A percentage (\"1% of the transaction\")",
    wayOut: `Re-read ${HELD_RATE_RECHECK_DEFAULT_LIMIT} a step: a rate in a category that publishes rates goes to Darwin as a rate fee; the rest wait for the rate rules to change.`,
    hasExit: true,
  },
  untraced: {
    label: "Not found in the source text",
    wayOut: `Re-read ${UNTRACED_RECHECK_LIMIT} a step: promoted when today's rules trace the same name, amount and category.`,
    hasExit: true,
  },
  zero: {
    label: "A $0 line with no category",
    wayOut: "None yet: nothing re-reads it.",
    hasExit: false,
  },
  taken_down: {
    label: "Repeats a fee already taken down",
    wayOut: "Held on purpose, so a confirmed takedown does not come back.",
    hasExit: true,
  },
};

export function shapeInfo(shape: string): { label: string; wayOut: string; hasExit: boolean } {
  return SHAPES[shape] ?? { label: shape, wayOut: "None recorded for this shape.", hasExit: false };
}

export function toKnoxHoldGroup(row: Record<string, unknown>): KnoxHoldGroup {
  const shape = String(row.shape ?? "unknown");
  const info = shapeInfo(shape);
  const amount = row.example_amount == null ? null : Number(row.example_amount);
  return {
    shape,
    label: info.label,
    count: Number(row.count ?? 0),
    setAside: Number(row.set_aside ?? 0),
    newThisWeek: Number(row.new_7d ?? 0),
    oldest: row.oldest ? new Date(row.oldest as string | Date).toISOString() : null,
    example: row.example_name ? { feeName: String(row.example_name), amount: Number.isFinite(amount) ? amount : null } : null,
    wayOut: info.wayOut,
    hasExit: info.hasExit,
  };
}

/** One row per shape, largest first. About 0.5 s on production (2026-10-13, about 40,000 held lines). */
export async function readKnoxHoldGroups(db: SqlTag): Promise<KnoxHoldGroup[]> {
  const rows = await db`
    WITH held AS (
      SELECT substring(f from 'knox_review:(.*)') AS shape, fr.fee_raw_id, fr.fee_name, fr.amount, fr.created_at,
             fr.outlier_flags ? 'knox_set_aside' AS set_aside
        FROM raw_fee_observations fr, jsonb_array_elements_text(fr.outlier_flags) f
       WHERE fr.source = 'knox'
         AND f LIKE 'knox_review:%'
         AND NOT fr.outlier_flags ? 'needs_darwin_verification'
    ), examples AS (
      SELECT DISTINCT ON (shape) shape, fee_name, amount FROM held ORDER BY shape, created_at DESC, fee_raw_id DESC
    )
    SELECT h.shape, COUNT(*)::int AS count,
           COUNT(*) FILTER (WHERE h.set_aside)::int AS set_aside,
           COUNT(*) FILTER (WHERE h.created_at > NOW() - INTERVAL '7 days')::int AS new_7d,
           MIN(h.created_at) AS oldest,
           e.fee_name AS example_name, e.amount AS example_amount
      FROM held h
      LEFT JOIN examples e ON e.shape = h.shape
     GROUP BY h.shape, e.fee_name, e.amount
     ORDER BY COUNT(*) DESC
  `;
  return rows.map((row) => toKnoxHoldGroup(row as Record<string, unknown>));
}
