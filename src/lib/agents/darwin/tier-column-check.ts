import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { isTierRowLine, tierCellAmount, tierColumnFeesLive, tierFeeCell, tierRowsNamed, tierTableRows, tierTitle, uniformTierCells, type TierRow } from "@/lib/tier-column-table";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of fees read from a relationship-tier table (#1092; DECISIONS 2026-11-04: one
 * fee per tier, named with its tier). Knox v100 split a tier row into one read per distinct price and
 * named each read with the row's name alone, so Schools FCU's (State key 7450) "Courtesy Pay $20 $30 $30
 * $30 $30" under "PLATINUM GOLD SILVER+ SILVER COLLEGE" read "Courtesy Pay" $20: the PLATINUM tier's price,
 * shown as the bank's only overdraft price with no tier (the #2981 error class). Knox v185 names each tier
 * (`TIER_COLUMN_FEES_LIVE`, off), and its re-read writes the scoped fees; this re-check finds the live ones
 * read before.
 *
 * Each verify step reads every live fee of a document whose stored text has a tier header line
 * (`TIER_HEADER_SQL_PATTERN`) and that text's first `TIER_COLUMN_TEXT_CHARS`. `findTierColumnFees`
 * decides with the shared tier table reader (`@/lib/tier-column-table`):
 * - `unscoped`: the live name is a tier row's name with no tier, the row's tiers do not all charge the
 *   same, and one of them charges the live amount. The switch's kind.
 * - `allowance_name`: the live name keeps a free allowance's words ("Debit/Credit Card Replacement 1 Free
 *   →") from a row whose cells are all one allowance. Its price is right, so it is counted, report only;
 *   a re-read under the switch renames it.
 * A fee named with a tier ("Courtesy Pay (Gold)") is never a match: the shared check traces it to its cell.
 *
 * Switched on (`TIER_COLUMN_TAKEDOWN_LIVE`, off as shipped), an unscoped match goes through the shared
 * 12-hour second look (check `darwin.tier_column`) and is archived on its second failure: rolled back with
 * `tier_column_unscoped: <tiers>`, its verified row rejected with the `tier_column_unscoped` flag, never
 * deleted, and a `darwin.tier_column_takedown` event lists them. A takedown adds no fee: the tier fees come
 * from Knox's re-read with `TIER_COLUMN_FEES_LIVE` on, so the takedown acts only while that switch is on too.
 *
 * Dry run: count pending. This session had no database access; `npm run audit:switch-dry-runs` section 12
 * counts the matches on prod (read-only), and James runs it before either switch turns on.
 */
export const TIER_COLUMN_CHECK = "darwin.tier_column";
export const TIER_COLUMN_CHECK_VERSION = 1;
/** The switch: on takes unscoped matches down after the second look; off (as shipped) only reports. */
export const TIER_COLUMN_TAKEDOWN_LIVE = false;
export const TIER_COLUMN_REASON = "tier_column_unscoped";
export const TIER_COLUMN_FLAG = "tier_column_unscoped";
export const TIER_COLUMN_LIMIT = 6_000;
/** The most rows any read returns, whatever limit it asks for (the dry-run audit asks for its row cap). */
export const TIER_COLUMN_MAX_ROWS = 20_000;
export const TIER_COLUMN_SAMPLES = 20;
/** Characters of the stored text read from its start: a tier table and the rows under it. */
export const TIER_COLUMN_TEXT_CHARS = 60_000;

/** The SQL prefilter for a text with a tier header line: two relationship-tier words on one line of capitals. */
export const TIER_HEADER_SQL_PATTERN = String.raw`(^|\n)[A-Z0-9+'& -]*\m(PLATINUM|GOLD|SILVER|BRONZE|COPPER|TITANIUM|DIAMOND|SAPPHIRE|EMERALD|RUBY|PEARL|ONYX|JADE|ELITE|PRESTIGE|PREFERRED|PREMIER)\M[A-Z0-9+'& -]*\m(PLATINUM|GOLD|SILVER|BRONZE|COPPER|TITANIUM|DIAMOND|SAPPHIRE|EMERALD|RUBY|PEARL|ONYX|JADE|ELITE|PRESTIGE|PREFERRED|PREMIER)\M[A-Z0-9+'& -]*(\n|$)`;

export type TierColumnKind = "unscoped" | "allowance_name";
/** The kinds the switch takes down: an allowance name's price is right, so it is counted only. */
export const TIER_COLUMN_TAKEDOWN_KINDS: ReadonlySet<TierColumnKind> = new Set(["unscoped"]);

export interface TierColumnRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  source_document_id: number | string | null;
  canonical_fee_key: string | null;
  /** The live name, as the catalog shows it. */
  fee_name: string | null;
  amount: number | string | null;
  /** Knox's own line (the extraction note's excerpt): only a fee read from the tier row itself is judged. */
  excerpt: string | null;
  /** The stored text Knox read (its first `TIER_COLUMN_TEXT_CHARS`). */
  text: string | null;
}

export interface TierColumnMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  canonicalFeeKey: string | null;
  amount: number;
  kind: TierColumnKind;
  /** The tier row's line, as the stored text prints it. */
  line: string;
  /** The tiers that charge the live amount, in title case. */
  tiers: string[];
  reason: string;
}

export interface TierColumnFindings {
  checked: number;
  /** Live fees whose name is a tier row's name. */
  onTierRows: number;
  matched: number;
  institutions: number;
  byKind: Record<TierColumnKind, number>;
  /** Matches of a kind the switch never takes down (`allowance_name`): counted only. */
  reportOnly: number;
  samples: TierColumnMatch[];
}

export interface TierColumnResult extends TierColumnFindings {
  live: boolean;
  dryRun: boolean;
  scoped: boolean;
  flagged: number;
  waiting: number;
  takenDown: number[];
  /** The read's row cap, and whether the read stopped at it (more live fees may exist past it). */
  rowCap: number;
  capped: boolean;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A free allowance's words left in a name: "1 Free →", "3 Free "". */
const ALLOWANCE_WORDS = /\b\d{1,2}\s+free\b\s*(?:→|->|➔|➜|"|”|“|»)?\s*$/i;

/**
 * The tier row a live fee was read from: the row its name names (the name a v100 read carries), and
 * only when Knox's stored line is that row's own (review of #2993): the page's other rows of the same
 * name and price ("BUSINESS ACCOUNTS" / "Stop Payment $25 per item") are other fees. Null too when two
 * tier rows carry the name with different cells.
 */
function rowOfName(rows: readonly TierRow[], feeName: string, excerpt: string | null, text: string): TierRow | null {
  const { row } = tierRowsNamed(rows, feeName);
  return row && isTierRowLine(row, excerpt, text) ? row : null;
}

/** Pure: the matches among the rows the read selected (see the module note). */
export function findTierColumnFees(rows: TierColumnRow[]): TierColumnFindings & { matches: TierColumnMatch[] } {
  const matches: TierColumnMatch[] = [];
  const seen = new Set<number>();
  const tables = new Map<string, TierRow[]>();
  let onTierRows = 0;
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    if (seen.has(feeId)) continue;
    seen.add(feeId);
    const amount = num(row.amount);
    const name = (row.fee_name ?? "").trim();
    if (amount == null || !row.text || !name) continue;
    const tierRows = tables.get(row.text) ?? tierTableRows(row.text);
    tables.set(row.text, tierRows);
    if (tierRows.length === 0 || tierFeeCell(tierRows, name)) continue;
    const allowance = ALLOWANCE_WORDS.test(name) ? rowOfName(tierRows, name.replace(ALLOWANCE_WORDS, ""), row.excerpt, row.text) : null;
    const tierRow = allowance ?? rowOfName(tierRows, name, row.excerpt, row.text);
    if (!tierRow) continue;
    onTierRows++;
    const charging = tierRow.cells.flatMap((cell, column) => {
      const charged = tierCellAmount(cell);
      return charged != null && Math.abs(charged - amount) < 0.005 ? [tierTitle(tierRow.labels[column])] : [];
    });
    if (charging.length === 0) continue;
    const kind: TierColumnKind | null = allowance
      ? (tierRow.cells.every((cell) => cell.kind === "allowance") && uniformTierCells(tierRow.cells) ? "allowance_name" : "unscoped")
      : uniformTierCells(tierRow.cells) ? null : "unscoped";
    if (!kind) continue;
    matches.push({
      feePublishedId: feeId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: name,
      canonicalFeeKey: row.canonical_fee_key,
      amount,
      kind,
      line: tierRow.line,
      tiers: charging,
      reason: kind === "unscoped" ? `${TIER_COLUMN_REASON}: ${charging.join(", ")} of ${tierRow.labels.length} tiers` : `allowance_name: ${tierRow.line.slice(0, 80)}`,
    });
  }
  return {
    checked: seen.size,
    onTierRows,
    matched: matches.length,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    byKind: {
      unscoped: matches.filter((fee) => fee.kind === "unscoped").length,
      allowance_name: matches.filter((fee) => fee.kind === "allowance_name").length,
    },
    reportOnly: matches.filter((fee) => !TIER_COLUMN_TAKEDOWN_KINDS.has(fee.kind)).length,
    samples: matches.slice(0, TIER_COLUMN_SAMPLES),
    matches,
  };
}

/** The most rows one read returns: the asked-for limit (default `TIER_COLUMN_LIMIT`), never above `TIER_COLUMN_MAX_ROWS`. */
export function tierColumnRowLimit(limit?: number): number {
  return Math.max(1, Math.min(limit ?? TIER_COLUMN_LIMIT, TIER_COLUMN_MAX_ROWS));
}

/**
 * Read-only: every live fee of a document whose stored text (the extraction note's artifact) has a tier
 * header line, with Knox's own line and that text's first `TIER_COLUMN_TEXT_CHARS`.
 */
export function tierColumnRowsSql(db: SqlTag, options: { institutionId?: number; institutionIds?: number[] | null; limit?: number } = {}) {
  const institutions = options.institutionId != null ? [options.institutionId] : options.institutionIds?.length ? options.institutionIds : null;
  const scoped = institutions != null;
  const limit = tierColumnRowLimit(options.limit);
  return db<TierColumnRow[]>`
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
         AND fp.amount IS NOT NULL
         AND (${!scoped} OR fp.institution_id = ANY(${institutions ?? [0]}::bigint[]))
    ),
    -- Each stored text is read once: only texts with a tier header line reach the pure reader.
    tier_texts AS (
      SELECT adt.id, left(adt.normalized_text, ${TIER_COLUMN_TEXT_CHARS}::int) AS text
        FROM agent_source_texts adt
       WHERE adt.id IN (SELECT DISTINCT text_id FROM candidates WHERE text_id IS NOT NULL)
         AND left(adt.normalized_text, ${TIER_COLUMN_TEXT_CHARS}::int) ~ ${TIER_HEADER_SQL_PATTERN}
    )
    SELECT c.fee_published_id, c.fee_verified_id, c.institution_id, c.source_document_id, c.canonical_fee_key,
           c.fee_name, c.amount, c.excerpt, t.text
      FROM candidates c
      JOIN tier_texts t ON t.id = c.text_id
     ORDER BY c.fee_published_id
     LIMIT ${limit}::int
  `;
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckTierColumnFees(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; readLive?: boolean; limit?: number; now?: Date },
): Promise<TierColumnResult> {
  // A takedown adds no fee: it acts only while Knox writes the tier fees that replace it (`TIER_COLUMN_FEES_LIVE`).
  const live = (options.live ?? TIER_COLUMN_TAKEDOWN_LIVE) && (options.readLive ?? tierColumnFeesLive());
  const result: TierColumnResult = {
    live, dryRun: options.dryRun, scoped: options.institutionId != null,
    checked: 0, onTierRows: 0, matched: 0, institutions: 0, byKind: { unscoped: 0, allowance_name: 0 }, reportOnly: 0, samples: [],
    flagged: 0, waiting: 0, takenDown: [], rowCap: tierColumnRowLimit(options.limit), capped: false,
  };

  let rows: TierColumnRow[];
  try {
    rows = await inSavepoint(db, (scope) => tierColumnRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] tier column check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  result.capped = rows.length >= result.rowCap;
  if (result.capped) console.warn(`[darwin] tier column check read stopped at its cap of ${result.rowCap} rows; later live fees were not judged`);
  const { matches, ...findings } = findTierColumnFees(rows);
  Object.assign(result, findings);

  const takedown = matches.filter((fee) => TIER_COLUMN_TAKEDOWN_KINDS.has(fee.kind));
  if (live && !options.dryRun && takedown.length > 0) {
    const look = await secondLook(db, {
      check: TIER_COLUMN_CHECK, runId: options.runId, failing: takedown, passing: [], dryRun: false, now: options.now,
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
          ${options.runId}, ${options.stepId ?? null}, ${TIER_COLUMN_CHECK}, 'completed',
          ${`Read live fees from relationship-tier tables: ${result.matched} of ${result.onTierRows} live fee(s) on a tier row at ${result.institutions} institution(s) are named without their tier (${result.byKind.unscoped}, the switch's) or keep an allowance in their name (${result.reportOnly}, report only); ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down the unscoped, nothing written"}`},
          ${JSON.stringify(tierColumnDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] tier column check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: TierColumnMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-tier-column-${runId}`},
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
                   WHEN fv.outlier_flags ? ${TIER_COLUMN_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${TIER_COLUMN_FLAG}::text)
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
    console.error("[darwin] tier column takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: TierColumnMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.tier_column_takedown', 'completed',
        ${`Archived ${archived.length} live fee(s) from relationship-tier tables named without their tier, on their second look`},
        ${JSON.stringify({ version: TIER_COLUMN_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] tier column takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: TierColumnMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    canonical_fee_key: fee.canonicalFeeKey,
    amount: fee.amount,
    kind: fee.kind,
    line: fee.line,
    tiers: fee.tiers,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function tierColumnDetail(result: TierColumnResult) {
  return {
    check: TIER_COLUMN_CHECK,
    version: TIER_COLUMN_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    checked: result.checked,
    on_tier_rows: result.onTierRows,
    matched: result.matched,
    institutions: result.institutions,
    by_kind: result.byKind,
    report_only: result.reportOnly,
    flagged: result.flagged,
    waiting: result.waiting,
    taken_down: result.takenDown,
    row_cap: result.rowCap,
    capped: result.capped,
    samples: result.samples.map(sampleDetail),
  };
}
