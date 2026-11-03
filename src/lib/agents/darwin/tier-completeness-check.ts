import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { namesTier, TIERLESS_CATEGORIES, tierLines, tierOfRead } from "@/lib/tiered-price";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of fees priced in tiers (#1110, #1092, #1026; decision 2026-10-15, "Darwin
 * re-checks every live fee against today's rules"). Knox v183 names each tier of a fee priced by a
 * threshold with its own condition and holds a group it cannot read in full (`tier_incomplete`); Darwin's
 * verify holds a tier read whose name lost its condition (`tier_unscoped`). Fees read before went live
 * one tier short: First National Bank of Moose Lake's (3457) "Overdraft fee per item per presentment"
 * $30 (live 116685) is the tier for an overdraft balance of more than $30.00; its $15 tier for a balance
 * of $30.00 or less was refused (raw 760358) and is not live, so the catalog shows $30 as the bank's only
 * overdraft price, with no condition.
 *
 * Each verify step reads every live fee whose Knox line states a threshold, the lines of the text Knox
 * read around that line (the extraction note's artifact) and the live fees of the same document and
 * category. `findTierGaps` decides with the shared tier reader (`@/lib/tiered-price`): a live fee that
 * is one tier of a group matches when its live name does not state its tier's condition (`unscoped`) or
 * when some tier of the group has no live fee of that document and category at that price naming that
 * tier (`incomplete`). Only `unscoped` is taken down (`TIER_COMPLETENESS_TAKEDOWN_KINDS`): an `incomplete` fee's
 * own name and price are right, so it is counted, report only. Switched on, an unscoped match goes through the shared 12-hour second look (check
 * `darwin.tier_completeness`) and is archived on its second failure: rolled back with
 * `tier_incomplete: <kind>, <live> of <tiers> tiers live`, its verified row rejected with the
 * `tier_incomplete` flag so publish does not bring it back, never deleted, and a
 * `darwin.tier_completeness_takedown` event lists them. A takedown adds no fee: the scoped tiers come from
 * Knox's re-read of the bank's text. In a dry run, or with the switch off (as shipped), it only reports.
 *
 * Dry run, prod read-only, 2026-11-03: see `docs/project/findings/2026-11-03-tiered-price-conditions.md`
 * and `__fixtures__/tier-completeness-live-2026-11-03.json`.
 */
export const TIER_COMPLETENESS_CHECK = "darwin.tier_completeness";
export const TIER_COMPLETENESS_CHECK_VERSION = 1;
/** The switch: on takes matches down after the second look; off (as shipped) only reports. */
export const TIER_COMPLETENESS_TAKEDOWN_LIVE = false;
export const TIER_COMPLETENESS_REASON = "tier_incomplete";
export const TIER_COMPLETENESS_FLAG = "tier_incomplete";
export const TIER_COMPLETENESS_LIMIT = 6_000;
export const TIER_COMPLETENESS_SAMPLES = 20;
/** Characters of Knox's text read on each side of the fee's own line, cut back to whole lines (a tier group sits within a few lines). */
export const TIER_WINDOW_CHARS = 900;

/**
 * The SQL prefilter for a Knox line that states a threshold: a dollar figure with a comparison word,
 * a dollar range, or a count range or "N or more" / "N+". The pure reader decides.
 */
export const TIER_LINE_SQL_PATTERN = String.raw`(\$\s?[0-9.][0-9,.]*\s+(or|and)\s+(less|more|greater|over|under|above|below|up)\y|\y(more|less|greater|fewer)\s+than\s+\$|\y(over|under|above|below|exceeding|up\s+to)\s+\$|\$\s?[0-9.][0-9,.]*\s*(-|–|—|to)\s*\$|\y[0-9]{1,3}\s*(-|–|to)\s*[0-9]{1,3}\s+[a-z]|\y[0-9]{1,3}(st|nd|rd|th)?\s*(\+|or\s+more))`;

export type TierGapKind = "unscoped" | "incomplete";
/**
 * The kinds the switch takes down. An `incomplete` fee is a scoped tier whose name is right; a sibling tier
 * missing from the catalog is Knox's to read, not a reason to archive the one that is right (review of #2981:
 * 18812, 89748, 110375 and 120265 are right as they stand), so it is counted, report only.
 */
export const TIER_COMPLETENESS_TAKEDOWN_KINDS: ReadonlySet<TierGapKind> = new Set(["unscoped"]);

export interface TierCompletenessRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  source_document_id: number | string | null;
  canonical_fee_key: string | null;
  /** The live name, as the catalog shows it. */
  fee_name: string | null;
  amount: number | string | null;
  /** Knox's own line (the extraction note's excerpt). */
  excerpt: string | null;
  /** Knox's text around that line (`TIER_WINDOW_CHARS` on each side), or null when the line is not in it verbatim. */
  window_lines: string | null;
  /** The live fees of the same document and category: `[{ fee_published_id, fee_name, amount }]`. */
  siblings: unknown;
}

export interface TierGapMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  canonicalFeeKey: string | null;
  amount: number;
  kind: TierGapKind;
  tiers: Array<{ condition: string; price: number; live: boolean }>;
  reason: string;
}

export interface TierCompletenessFindings {
  checked: number;
  /** Live fees that are one tier of a tier group. */
  tiered: number;
  matched: number;
  institutions: number;
  byKind: Record<TierGapKind, number>;
  /** Matches of a kind the switch never takes down (`incomplete`): counted only. */
  reportOnly: number;
  samples: TierGapMatch[];
}

export interface TierCompletenessResult extends TierCompletenessFindings {
  live: boolean;
  dryRun: boolean;
  scoped: boolean;
  flagged: number;
  waiting: number;
  takenDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function siblingsOf(value: unknown): Array<{ feeName: string; amount: number | null }> {
  const list = typeof value === "string" ? (() => { try { return JSON.parse(value) as unknown; } catch { return []; } })() : value;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as { fee_name?: unknown; amount?: unknown };
    return [{ feeName: String(row.fee_name ?? ""), amount: num(row.amount as number | string | null) }];
  });
}

/** Pure: the matches among the rows the read selected (see the module note). */
export function findTierGaps(rows: TierCompletenessRow[]): TierCompletenessFindings & { matches: TierGapMatch[] } {
  const matches: TierGapMatch[] = [];
  const seen = new Set<number>();
  let tiered = 0;
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    if (seen.has(feeId)) continue;
    seen.add(feeId);
    const amount = num(row.amount);
    if (amount == null || !row.window_lines || !row.excerpt || TIERLESS_CATEGORIES.has(row.canonical_fee_key ?? "")) continue;
    const found = tierOfRead(tierLines(row.window_lines), row.excerpt, amount);
    if (!found) continue;
    tiered++;
    const name = (row.fee_name ?? "").trim();
    const siblings = siblingsOf(row.siblings);
    const tiers = found.group.tiers.map((tier) => ({
      condition: tier.condition,
      price: tier.price,
      live: siblings.some((sibling) => sibling.amount != null && Math.abs(sibling.amount - tier.price) < 0.005 && namesTier(sibling.feeName, tier)),
    }));
    const kind: TierGapKind | null = !namesTier(name, found.tier) ? "unscoped" : tiers.some((tier) => !tier.live) ? "incomplete" : null;
    if (!kind) continue;
    const liveTiers = tiers.filter((tier) => tier.live).length;
    matches.push({
      feePublishedId: feeId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: name,
      canonicalFeeKey: row.canonical_fee_key,
      amount,
      kind,
      tiers,
      reason: `${TIER_COMPLETENESS_REASON}: ${kind}, ${liveTiers} of ${tiers.length} tiers live`,
    });
  }
  return {
    checked: seen.size,
    tiered,
    matched: matches.length,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    byKind: {
      unscoped: matches.filter((fee) => fee.kind === "unscoped").length,
      incomplete: matches.filter((fee) => fee.kind === "incomplete").length,
    },
    reportOnly: matches.filter((fee) => !TIER_COMPLETENESS_TAKEDOWN_KINDS.has(fee.kind)).length,
    samples: matches.slice(0, TIER_COMPLETENESS_SAMPLES),
    matches,
  };
}

/**
 * Read-only: every live fee whose Knox line states a threshold (`TIER_LINE_SQL_PATTERN`), the lines of
 * the text Knox read around that line, and the live fees of the same document and category.
 */
export function tierCompletenessRowsSql(db: SqlTag, options: { institutionId?: number; limit?: number } = {}) {
  const scoped = options.institutionId != null;
  const limit = Math.max(1, Math.min(options.limit ?? TIER_COMPLETENESS_LIMIT, 20_000));
  return db<TierCompletenessRow[]>`
    WITH candidates AS (
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fr.source_document_id,
             fp.canonical_fee_key, fp.fee_name, fp.amount,
             substring(COALESCE(fr.extraction_note, fr.conditions) FROM 'excerpt="(.*)"') AS excerpt,
             (substring(COALESCE(fr.extraction_note, fr.conditions) FROM 'artifact #([0-9]+)'))::bigint AS text_id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.amount > 0
         AND substring(COALESCE(fr.extraction_note, fr.conditions) FROM 'excerpt="(.*)"') ~* ${TIER_LINE_SQL_PATTERN}
         AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
       ORDER BY fp.fee_published_id
       LIMIT ${limit}::int
    )
    SELECT c.fee_published_id, c.fee_verified_id, c.institution_id, c.source_document_id, c.canonical_fee_key,
           c.fee_name, c.amount, c.excerpt,
           (
             -- Whole lines only: the window opens after the first line break past its start and closes before
             -- the last one, unless it reaches the text's own start or end (review of #2981).
             SELECT CASE WHEN w.at > 0 THEN
                      CASE WHEN w.from_at > 1 THEN regexp_replace(w.before_line, '^[^\n]*\n', '') ELSE w.before_line END
                      || CASE WHEN w.at + length(w.ex) + ${TIER_WINDOW_CHARS}::int <= length(w.body)
                              THEN regexp_replace(w.from_line, '\n[^\n]*$', '') ELSE w.from_line END
                    END
               FROM (
                 SELECT t.body, t.ex, t.at, greatest(1, t.at - ${TIER_WINDOW_CHARS}::int) AS from_at,
                        substring(t.body FROM greatest(1, t.at - ${TIER_WINDOW_CHARS}::int) FOR t.at - greatest(1, t.at - ${TIER_WINDOW_CHARS}::int)) AS before_line,
                        substring(t.body FROM t.at FOR length(t.ex) + ${TIER_WINDOW_CHARS}::int) AS from_line
                   FROM (
                     SELECT adt.normalized_text AS body, btrim(c.excerpt) AS ex, strpos(adt.normalized_text, btrim(c.excerpt)) AS at
                       FROM agent_source_texts adt
                      WHERE adt.id = c.text_id
                   ) t
               ) w
           ) AS window_lines,
           (
             SELECT COALESCE(jsonb_agg(jsonb_build_object('fee_published_id', s.fee_published_id, 'fee_name', s.fee_name, 'amount', s.amount)), '[]'::jsonb)
               FROM published_fee_records s
               JOIN verified_fee_observations sv ON sv.fee_verified_id = s.lineage_ref
               JOIN raw_fee_observations sr ON sr.fee_raw_id = sv.fee_raw_id
              WHERE s.rolled_back_at IS NULL
                AND s.quarantined_at IS NULL
                AND s.institution_id = c.institution_id
                AND s.canonical_fee_key IS NOT DISTINCT FROM c.canonical_fee_key
                AND sr.source_document_id IS NOT DISTINCT FROM c.source_document_id
           ) AS siblings
      FROM candidates c
     ORDER BY c.fee_published_id
  `;
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckTierCompleteness(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<TierCompletenessResult> {
  const live = options.live ?? TIER_COMPLETENESS_TAKEDOWN_LIVE;
  const result: TierCompletenessResult = {
    live, dryRun: options.dryRun, scoped: options.institutionId != null,
    checked: 0, tiered: 0, matched: 0, institutions: 0, byKind: { unscoped: 0, incomplete: 0 }, reportOnly: 0, samples: [], flagged: 0, waiting: 0, takenDown: [],
  };

  let rows: TierCompletenessRow[];
  try {
    rows = await inSavepoint(db, (scope) => tierCompletenessRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] tier completeness check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findTierGaps(rows);
  Object.assign(result, findings);

  const takedown = matches.filter((fee) => TIER_COMPLETENESS_TAKEDOWN_KINDS.has(fee.kind));
  if (live && !options.dryRun && takedown.length > 0) {
    const look = await secondLook(db, {
      check: TIER_COMPLETENESS_CHECK, runId: options.runId, failing: takedown, passing: [], dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    if (look.confirmed.length > 0) {
      result.takenDown = await archive(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  if (!options.dryRun && result.matched > 0) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${TIER_COMPLETENESS_CHECK}, 'completed',
          ${`Read live fees priced in tiers: ${result.matched} of ${result.tiered} live tier fee(s) at ${result.institutions} institution(s) are unscoped (${result.byKind.unscoped}, the switch's) or one tier short (${result.reportOnly}, report only); ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down the unscoped, nothing written"}`},
          ${JSON.stringify(tierCompletenessDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] tier completeness check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: TierGapMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-tier-completeness-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const verified = fees.filter((fee) => ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
      if (verified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? ${TIER_COMPLETENESS_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${TIER_COMPLETENESS_FLAG}::text)
                 END
           WHERE fv.fee_verified_id = ANY(${verified.map((fee) => fee.feeVerifiedId as number)}::bigint[])
             AND fv.review_status IN ('verified', 'approved')
        `;
      }
      return fees.filter((fee) => ids.has(fee.feePublishedId)).map((fee) => fee.feePublishedId);
    });
    if (closed.length > 0) invalidatePublicReadCache();
    return closed;
  } catch (error) {
    console.error("[darwin] tier completeness takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: TierGapMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.tier_completeness_takedown', 'completed',
        ${`Archived ${archived.length} live fee(s) priced in tiers whose names hid their tier, on their second look`},
        ${JSON.stringify({ version: TIER_COMPLETENESS_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] tier completeness takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: TierGapMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    canonical_fee_key: fee.canonicalFeeKey,
    amount: fee.amount,
    kind: fee.kind,
    tiers: fee.tiers,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function tierCompletenessDetail(result: TierCompletenessResult) {
  return {
    check: TIER_COMPLETENESS_CHECK,
    version: TIER_COMPLETENESS_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    checked: result.checked,
    tiered: result.tiered,
    matched: result.matched,
    institutions: result.institutions,
    by_kind: result.byKind,
    report_only: result.reportOnly,
    flagged: result.flagged,
    waiting: result.waiting,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
