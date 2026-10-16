import type { sql } from "@/lib/data-store/connection";
import {
  HELD_RECHECK_DEFAULT_LIMIT,
  HELD_RATE_RECHECK_DEFAULT_LIMIT,
  HELD_SET_ASIDE_AFTER_VERSIONS,
  RANGE_BAND_FLAG,
  RANGE_BAND_SET_ASIDE_LIVE,
  UNTRACED_RECHECK_LIMIT,
} from "./held-recheck";

type SqlTag = typeof sql;

/**
 * Knox's held lines (#1102, the "show the held pile" step): every line Knox kept without
 * sending it to Darwin, by the shape it was held for (`knox_review:<shape>`), with its count,
 * how many are set aside, how many arrived in the last 7 days, its oldest, one example, and the
 * way out the code gives it today (`held-recheck.ts`). Read-only. A shape with no way out says so.
 *
 * Each group names its owner: the agent pass or the person that moves its lines on (James asked
 * on Oct 12: "held for review, but who's reviewing it?"). Three groups are split from the shape
 * Knox wrote, so each has one owner:
 * - `superseded`: a newer copy or a re-read retired the line (any shape). Knox's superseded
 *   re-check owns it, not the held pile (all 766 held $0 lines on 16 Oct 2026 were these).
 * - `range_no_category` vs `range`: a range with a fee category is a real fee priced as a range
 *   and waits on range storage (#1060); one with none is mostly a rate or balance band.
 * - `range_band`: a band Knox set aside as not a fee (`setAsideRangeBands`, behind its switch).
 * `rereadThrice` counts lines a versioned re-check has read under `HELD_SET_ASIDE_AFTER_VERSIONS`
 * or more rules versions without moving them: the part of the pile its owner is not shrinking.
 */

export interface KnoxHoldGroup {
  shape: string;
  label: string;
  count: number;
  setAside: number;
  newThisWeek: number;
  oldest: string | null;
  example: { feeName: string; amount: number | null } | null;
  /** Lines read by a versioned re-check under 3+ rules versions that are still held. */
  rereadThrice: number;
  owner: string;
  wayOut: string;
  hasExit: boolean;
}

interface ShapeInfo {
  label: string;
  owner: string;
  wayOut: string;
  hasExit: boolean;
}

const SHAPES: Record<string, ShapeInfo> = {
  unclassified: {
    label: "No category Knox could match",
    owner: "Knox's held re-check and name filing; James labels the weekly name queue (/admin/knox/labels)",
    wayOut: `Re-read ${HELD_RECHECK_DEFAULT_LIMIT} a step when Knox's rules change; set aside after ${HELD_SET_ASIDE_AFTER_VERSIONS} versions, never deleted. A name the live store settles, or a person labels, sends every held line with it to Darwin.`,
    hasExit: true,
  },
  range: {
    label: "A fee priced as a range (\"$20–$70\")",
    owner: "James: a range needs somewhere to live before it can publish (#1060)",
    wayOut: "None until a range can be stored. Re-read only when the line says a price changed.",
    hasExit: false,
  },
  range_no_category: {
    label: "A range with no fee category",
    owner: RANGE_BAND_SET_ASIDE_LIVE
      ? "Knox's range-band pass"
      : "Knox's range-band pass, switched off: James switches it on",
    wayOut: RANGE_BAND_SET_ASIDE_LIVE
      ? "A rate or balance band (\"Tier 3 | $25,000–$49,999 | 0.75%\") is set aside as not a fee, kept and never deleted. The rest stay held."
      : "Switched on, a rate or balance band is set aside as not a fee, kept and never deleted; the extract step counts them meanwhile. The rest stay held.",
    hasExit: RANGE_BAND_SET_ASIDE_LIVE,
  },
  range_band: {
    label: "A rate or balance band, not a fee",
    owner: "Knox's range-band pass",
    wayOut: `Set aside as not a fee: kept, never deleted. Taking off \`${RANGE_BAND_FLAG}\` (and \`knox_set_aside\` where \`knox_set_aside_by:range_band\` says this pass set it) puts it back.`,
    hasExit: true,
  },
  percentage: {
    label: "A percentage (\"1% of the transaction\")",
    owner: "Knox's rate re-check",
    wayOut: `Re-read ${HELD_RATE_RECHECK_DEFAULT_LIMIT} a step: a rate in a category that publishes rates goes to Darwin as a rate fee; the rest wait for the rate rules to change.`,
    hasExit: true,
  },
  untraced: {
    label: "Not found in the source text",
    owner: "Knox's untraced re-check; the lines it keeps failing are Rosetta's next (a possible reading error)",
    wayOut: `Re-read ${UNTRACED_RECHECK_LIMIT} a step: promoted when today's rules trace the same name, amount and category.`,
    hasExit: true,
  },
  zero: {
    label: "A $0 line held without going to Darwin",
    owner: "Knox",
    wayOut: "None: a $0 line with a category goes to Darwin when it is read, so a held one here is unexpected.",
    hasExit: false,
  },
  superseded: {
    label: "Retired: a newer copy or a re-read replaced it",
    owner: "Knox's superseded re-check and re-file",
    wayOut: "Read again with today's rules: back to Darwin when the current text still prints the same fee; otherwise it stays retired, kept.",
    hasExit: true,
  },
  taken_down: {
    label: "Repeats a fee already taken down",
    owner: "Hamilton's confirmed takedown",
    wayOut: "Held on purpose, so a confirmed takedown does not come back.",
    hasExit: true,
  },
};

export function shapeInfo(shape: string): ShapeInfo {
  return SHAPES[shape] ?? { label: shape, owner: "Nobody recorded", wayOut: "None recorded for this shape.", hasExit: false };
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
    rereadThrice: Number(row.reread_thrice ?? 0),
    oldest: row.oldest ? new Date(row.oldest as string | Date).toISOString() : null,
    example: row.example_name ? { feeName: String(row.example_name), amount: Number.isFinite(amount) ? amount : null } : null,
    owner: info.owner,
    wayOut: info.wayOut,
    hasExit: info.hasExit,
  };
}

/** One row per group, largest first. About 0.5 s on production (2026-10-13, about 40,000 held lines). */
export async function readKnoxHoldGroups(db: SqlTag): Promise<KnoxHoldGroup[]> {
  const rows = await db`
    WITH held AS (
      SELECT CASE
               WHEN fr.outlier_flags ?| array['superseded_by_newer_copy', 'superseded_by_reread'] THEN 'superseded'
               WHEN fr.outlier_flags ? ${RANGE_BAND_FLAG} THEN 'range_band'
               WHEN f = 'knox_review:range'
                AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(fr.outlier_flags) h WHERE h LIKE 'canonical_hint:%')
                 THEN 'range_no_category'
               ELSE substring(f from 'knox_review:(.*)')
             END AS shape,
             fr.fee_raw_id, fr.fee_name, fr.amount, fr.created_at,
             fr.outlier_flags ? 'knox_set_aside' AS set_aside,
             (SELECT count(*) FROM jsonb_array_elements_text(fr.outlier_flags) v
               WHERE v LIKE 'knox_recheck:%' OR v LIKE 'knox_untraced_recheck:%') >= ${HELD_SET_ASIDE_AFTER_VERSIONS} AS reread_thrice
        FROM raw_fee_observations fr, jsonb_array_elements_text(fr.outlier_flags) f
       WHERE fr.source = 'knox'
         AND f LIKE 'knox_review:%'
         AND NOT fr.outlier_flags ? 'needs_darwin_verification'
    ), examples AS (
      SELECT DISTINCT ON (shape) shape, fee_name, amount FROM held ORDER BY shape, created_at DESC, fee_raw_id DESC
    )
    SELECT h.shape, COUNT(*)::int AS count,
           COUNT(*) FILTER (WHERE h.set_aside)::int AS set_aside,
           COUNT(*) FILTER (WHERE h.reread_thrice)::int AS reread_thrice,
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
