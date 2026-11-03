import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { FREE_LIST_HEADING_SQL, freeListItemRead } from "@/lib/free-list-item";
import { sourceLineFor } from "./verify";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of priced fees whose name is an item of a "free services" list but whose
 * price was taken from another line (#1092, James's Nov 2 review; decision 2026-10-15, "Darwin
 * re-checks every live fee against today's rules"). Knox v169 holds such a read untraced and Darwin's
 * verify refuses it (`free_list_item`), both through `@/lib/free-list-item`; the ones read before stay
 * live. Mountain Star FCU's "Fax Service" $5 (published 159428, text 36365) is one: the page lists Fax
 * Service among "Other Free Services", and the $5.00 under its line is the left column's money market
 * excess check price.
 *
 * Each verify step reads every live flat priced fee whose stored line (Knox's `excerpt="..."`) joins a
 * name line to a price line (" / " with no price before it, the SQL pre-filter) and whose text (the
 * artifact its note names) prints a list heading (`FREE_LIST_HEADING_SQL`). `freeListItemRead` decides on
 * the line `checkFeeAgainstSource` traces the fee to (`sourceLineFor`, Darwin's own trace), the test
 * verify applies. A fee whose text is gone is not judged. An admin-corrected fee is never read. An
 * institution-scoped run reads that institution's only. Switched on (`FREE_LIST_ITEM_TAKEDOWN_LIVE`), a
 * match goes through the shared 12-hour second look (check `darwin.free_list_item`) and is archived on
 * its second failure: rolled back with `free_list_item: "<item>" under "<heading>"`, its verified row
 * rejected with the `free_list_item` flag so publish does not bring it back, never deleted, and a
 * `darwin.free_list_item_takedown` event lists them. In a dry run, or with the switch off (the default),
 * it only reports.
 *
 * Dry run, prod read-only, 2026-11-02: see docs/project/findings/2026-11-02-knox-amount-not-in-names-cell.md.
 */
export const FREE_LIST_ITEM_CHECK = "darwin.free_list_item";
export const FREE_LIST_ITEM_CHECK_VERSION = 1;
/** The switch: off, the step only reports; on, matches come down after the second look. */
export const FREE_LIST_ITEM_TAKEDOWN_LIVE = false;
export const FREE_LIST_ITEM_REASON = "free_list_item";
export const FREE_LIST_ITEM_FLAG = "free_list_item";
export const FREE_LIST_ITEM_LIMIT = 5_000;
export const FREE_LIST_ITEM_SAMPLES = 20;
/** The most rows one read returns. */
export const FREE_LIST_ITEM_MAX_ROWS = 10_000;
/** Texts read per query, so one read never holds every candidate's text at once. */
const TEXT_CHUNK = 50;

/** Postgres pre-filter on Knox's stored line: a name line, then " / " and the line with the price. */
export const FREE_LIST_ITEM_PREFILTER = String.raw`excerpt="[^"$]* / `;

export interface FreeListItemLiveRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  /** Knox's extraction note, whose excerpt is the stored line. */
  source_line: string | null;
  /** The artifact the note names: the text Knox read. */
  artifact_id: number | string | null;
}

export interface FreeListItemMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number;
  canonicalFeeKey: string | null;
  item: string;
  heading: string;
  tracedLine: string;
  reason: string;
}

export interface FreeListItemFindings {
  checked: number;
  /** Candidates whose text is gone: not judged. */
  noText: number;
  matched: number;
  institutions: number;
  samples: FreeListItemMatch[];
}

export interface FreeListItemResult extends FreeListItemFindings {
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

/**
 * Pure: the matches among the rows the read selected, each judged on its own text (`texts`, by artifact
 * id) the way verify judges a new read: on the line the shared check traces it to.
 */
export function findFreeListItems(
  rows: readonly FreeListItemLiveRow[],
  texts: ReadonlyMap<number, string>,
): FreeListItemFindings & { matches: FreeListItemMatch[] } {
  const matches: FreeListItemMatch[] = [];
  const seen = new Set<number>();
  let noText = 0;
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    if (seen.has(feeId)) continue;
    seen.add(feeId);
    const artifactId = num(row.artifact_id);
    const text = artifactId == null ? undefined : texts.get(artifactId);
    if (!text) {
      noText += 1;
      continue;
    }
    const amount = num(row.amount);
    if (amount == null || amount <= 0) continue;
    const name = (row.fee_name ?? "").trim();
    const tracedLine = sourceLineFor(
      { fee_name: name, amount, source_document_id: artifactId, amount_kind: "flat", rate_percent: null },
      new Map([[artifactId as number, text]]),
      row.canonical_fee_key,
    );
    const found = freeListItemRead({ feeName: name, amount, tracedLine, documentText: text });
    if (!found || !tracedLine) continue;
    matches.push({
      feePublishedId: feeId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: name,
      amount,
      canonicalFeeKey: row.canonical_fee_key,
      item: found.item.slice(0, 160),
      heading: found.heading.slice(0, 160),
      tracedLine: tracedLine.slice(0, 300),
      reason: `${FREE_LIST_ITEM_REASON}: "${found.item.slice(0, 80)}" under "${found.heading.slice(0, 80)}"`,
    });
  }
  return {
    checked: seen.size,
    noText,
    matched: matches.length,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, FREE_LIST_ITEM_SAMPLES),
    matches,
  };
}

/**
 * Read-only: every live flat priced fee whose stored line passes the pre-filter and whose text prints a
 * list heading, with the artifact Knox read. `institutionId` (the verify step's scope) or
 * `institutionIds` (a dry-run audit's) narrow it.
 */
export function freeListItemRowsSql(db: SqlTag, options: { institutionId?: number; institutionIds?: readonly number[] | null; limit?: number } = {}) {
  const ids = options.institutionId != null ? [options.institutionId] : options.institutionIds?.length ? [...options.institutionIds] : null;
  const scoped = ids != null;
  const limit = Math.max(1, Math.min(options.limit ?? FREE_LIST_ITEM_LIMIT, FREE_LIST_ITEM_MAX_ROWS));
  return db<FreeListItemLiveRow[]>`
    WITH candidates AS (
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fr.fee_name, fp.amount,
             fp.canonical_fee_key, fr.extraction_note AS source_line,
             (substring(fr.extraction_note FROM 'artifact #([0-9]+)'))::bigint AS artifact_id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.amount_kind = 'flat'
         AND fp.amount > 0
         AND fr.extraction_note ~ ${FREE_LIST_ITEM_PREFILTER}
         -- notAdminCorrectedSql("fp") (fee-correction-guard), written inline for the tagged template: never take down an admin-corrected fee.
         AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
         AND (${!scoped} OR fp.institution_id = ANY(${ids ?? [0]}::bigint[]))
    ),
    listed AS (
      SELECT a.id
        FROM agent_source_texts a
       WHERE a.id IN (SELECT DISTINCT artifact_id FROM candidates WHERE artifact_id IS NOT NULL)
         AND a.normalized_text ~* ${FREE_LIST_HEADING_SQL}
    )
    SELECT c.* FROM candidates c JOIN listed ON listed.id = c.artifact_id
     ORDER BY c.fee_published_id
     LIMIT ${limit}::int
  `;
}

/** Read-only: the texts Knox read, by artifact id. */
export async function freeListItemTexts(db: SqlTag, artifactIds: readonly number[]): Promise<Map<number, string>> {
  const texts = new Map<number, string>();
  const ids = [...new Set(artifactIds)];
  for (let start = 0; start < ids.length; start += TEXT_CHUNK) {
    const chunk = ids.slice(start, start + TEXT_CHUNK);
    const rows = await db<{ id: number | string; normalized_text: string | null }[]>`
      SELECT id, normalized_text FROM agent_source_texts WHERE id = ANY(${chunk}::bigint[]) AND normalized_text IS NOT NULL
    `;
    for (const row of rows) if (row.normalized_text) texts.set(Number(row.id), row.normalized_text);
  }
  return texts;
}

function emptyResult(live: boolean, dryRun: boolean, scoped: boolean): FreeListItemResult {
  return { live, dryRun, scoped, checked: 0, noText: 0, matched: 0, institutions: 0, samples: [], flagged: 0, waiting: 0, takenDown: [] };
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckFreeListItems(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<FreeListItemResult> {
  const live = options.live ?? FREE_LIST_ITEM_TAKEDOWN_LIVE;
  const result = emptyResult(live, options.dryRun, options.institutionId != null);

  let rows: FreeListItemLiveRow[];
  let texts: Map<number, string>;
  try {
    rows = await inSavepoint(db, (scope) => freeListItemRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
    const artifactIds = rows.map((row) => num(row.artifact_id)).filter((id): id is number => id != null);
    texts = await inSavepoint(db, (scope) => freeListItemTexts(scope, artifactIds));
  } catch (error) {
    console.warn("[darwin] free list item check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findFreeListItems(rows, texts);
  Object.assign(result, findings);

  if (live && !options.dryRun && matches.length > 0) {
    const look = await secondLook(db, {
      check: FREE_LIST_ITEM_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now,
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
          ${options.runId}, ${options.stepId ?? null}, ${FREE_LIST_ITEM_CHECK}, 'completed',
          ${`Read live priced fees named as an item of a free services list: ${result.matched} of ${result.checked} live fee(s) at ${result.institutions} institution(s); ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(freeListItemDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] free list item check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: FreeListItemMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-free-list-item-${runId}`},
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
                   WHEN fv.outlier_flags ? ${FREE_LIST_ITEM_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${FREE_LIST_ITEM_FLAG}::text)
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
    console.error("[darwin] free list item takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: FreeListItemMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.free_list_item_takedown', 'completed',
        ${`Archived ${archived.length} live priced fee(s) named as an item of a free services list, on their second look`},
        ${JSON.stringify({ version: FREE_LIST_ITEM_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] free list item takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: FreeListItemMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    item: fee.item,
    heading: fee.heading,
    traced_line: fee.tracedLine,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function freeListItemDetail(result: FreeListItemResult) {
  return {
    check: FREE_LIST_ITEM_CHECK,
    version: FREE_LIST_ITEM_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    checked: result.checked,
    no_text: result.noText,
    matched: result.matched,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
