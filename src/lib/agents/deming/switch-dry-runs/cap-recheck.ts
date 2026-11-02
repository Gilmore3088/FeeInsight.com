import { recheckAssessment, type RecheckRow } from "@/lib/agents/darwin/verified-recheck";
import type { DailyCapRow } from "./types";

/**
 * The second live path a daily cap goes through: Darwin's verified recheck (`verified-recheck.ts`,
 * `recheckOf`). It finds the fee's line with the switch-dependent `sourceLineFor`, falling back to
 * Knox's excerpt, and runs `postSourceCheck` and the tier-perk test on that line. With
 * `DAILY_CAP_LINES_LIVE` on, a live cap that newly traces is judged on its new cap line, so a name
 * rule could fire there. A failing check flags the live fee on its first look, and the 12-hour second
 * look takes it down (`DARWIN_RECHECK_SECOND_LOOK_LIVE`). The recheck reads a row again when the row
 * is new or the recheck's version moves. Pure.
 */

export interface CapRecheck {
  /** kept: every check passes; takedown: flagged now, down at the second look if it fails again. */
  outcome: "kept" | "takedown";
  reason: string | null;
  /** The line the recheck judged (the traced line, else Knox's excerpt). */
  line: string | null;
}

/** The raw and verified fields `recheckOf` reads, from a cap row (the recheck reads Knox's own name). */
function recheckRow(row: DailyCapRow): RecheckRow {
  return {
    fee_raw_id: row.fee_raw_id,
    institution_id: row.institution_id,
    source_url: row.source_url,
    document_r2_key: null,
    extraction_confidence: null,
    fee_name: row.raw_name,
    amount: row.raw_amount,
    frequency: null,
    outlier_flags: row.outlier_flags,
    conditions: row.conditions,
    source_document_id: row.source_document_id,
    amount_kind: null,
    rate_percent: null,
    fee_verified_id: row.fee_verified_id ?? 0,
    review_status: row.review_status ?? "verified",
    canonical_fee_key: row.verified_key ?? row.published_key ?? "",
    verified_amount: row.verified_amount,
    fee_published_id: row.fee_published_id,
    selected_verified: "",
    selected_raw: "",
    selected_published: null,
    selected_feedback: null,
  } as RecheckRow;
}

/** How the recheck judges the row against its document's text, with the switch as given. */
export function capRecheck(row: DailyCapRow, text: string, dailyCapLines: boolean): CapRecheck {
  const texts = new Map([[Number(row.source_document_id), text]]);
  const { check, line } = recheckAssessment(recheckRow(row), texts, undefined, { dailyCapLines });
  if (!check) return { outcome: "kept", reason: null, line };
  return { outcome: "takedown", reason: check.rule ? `${check.code}:${check.rule}` : check.code, line };
}
