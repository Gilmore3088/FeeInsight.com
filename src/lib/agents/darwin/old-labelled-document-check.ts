import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { oldLabelledAddress } from "@/lib/agents/magellan/old-labelled-link";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of fees read from a document whose own address calls it old or archived
 * (#1026, #1455 class, Nov 3; decision 2026-10-15, "Darwin re-checks every live fee against today's
 * rules"). Westreet FCU (6933) showed 32 live fees, fee 43316 among them, read from
 * "/wp-content/uploads/2021/06/Fee-Schedule-Old.pdf"; WinSouth, Central Jersey Police & Fire, Citizens
 * Bank & Trust and Clackamas County Bank had 54 more from "...716.OLD.pdf", "/old-web-site/",
 * "/schedule-of-fees-old" and "/archive-2021/". The live-site audit never caught them: it checks the
 * page a fee cites, and an old page still prints its old prices. Magellan now refuses such a link
 * and sends a stored one back to discovery (`magellan/old-labelled-link.ts`); this check settles the
 * fees already live.
 *
 * The rule is Magellan's `oldLabelledAddress`, read on the URL of the stored document each live fee
 * came from (`published_fee_records.lineage_ref` -> `verified_fee_observations` ->
 * `raw_fee_observations.source_document_id` -> `source_documents`). A loose SQL pre-filter picks the
 * candidates and the exact rule runs here.
 *
 * An old label alone does not take a fee down: the document may still be the only schedule the bank
 * has posted, and an old page's price can still be today's. A fee comes down only when the bank's
 * own current fee link proves a newer schedule exists and that schedule does not state the fee:
 * - `no_current_link`: the bank has no fee link (Magellan is searching). Kept.
 * - `current_link_is_this_page`: the bank's fee link is this old document's own address (WinSouth,
 *   Central Jersey Police & Fire, Citizens Bank & Trust on Nov 3). Kept: Magellan's fetch sends that
 *   link back to discovery, and once a newer link is found and captured the fee is judged again.
 * - `current_link_old_labelled`: the link is another old-labelled address. Kept, the same way.
 * - `current_link_not_captured`: the link is a different, current address, but no stored copy of it
 *   with text exists yet (Westreet's "/documents/fee-schedule" on Nov 3). Kept: nothing proves that
 *   address is a schedule, or that it answers. Judged again once Magellan captures it.
 * - `stated_on_current_link`: the current link's newest stored text states the fee at its amount
 *   (the one shared check, `checkFeeAgainstSource`). Kept: the price is today's, so taking it down
 *   would lose a right fee. A live twin from the current copy, if any, is the duplicate checks' job.
 * - `takedown`: the current link is a different, non-old address with stored text, and that text
 *   does not state the fee. The old document's fee comes down as `old_labelled_document: #<doc>
 *   (current link #<link doc>)`.
 * So the check errs toward keeping a fee whenever nothing proves a newer schedule exists.
 *
 * Every candidate is read each step (a few hundred live fees on Nov 3), at most once per
 * `OLD_LABELLED_DOCUMENT_SCAN_INTERVAL_HOURS`, keyed on the last event of a full read; an
 * institution-scoped run reads only that institution's fees, every time, and does not restart the
 * clock. Admin-corrected and quarantined fees are never read.
 *
 * Shadow first (CLAUDE.md standing rule): with `OLD_LABELLED_DOCUMENT_TAKEDOWN_LIVE` false, or in a
 * dry run, the step only reports what it would take down. Switched on, a matching fee goes through
 * the shared 12-hour second look (check `darwin.old_labelled_document`) and is archived on its second
 * failure: rolled back with its reason, its verified row rejected with the `old_labelled_document`
 * flag, never deleted, and a `darwin.old_labelled_document_takedown` event lists them. Fees that now
 * pass clear a pending first look.
 *
 * Dry run, prod read-only, Nov 3 (`oldLabelledDocumentRowsSql`, then `findOldLabelledDocuments`): see
 * the switch's note.
 */
export const OLD_LABELLED_DOCUMENT_CHECK = "darwin.old_labelled_document";
export const OLD_LABELLED_DOCUMENT_CHECK_VERSION = 1;
/**
 * The switch, off. The Nov 3 dry run (prod, read-only) read 86 live fees on the 5 old-labelled
 * documents at 5 banks: 0 would come down. 52 are kept because the bank's link is the old document
 * itself (WinSouth 24, Central Jersey Police & Fire 16, Citizens Bank & Trust 12), 32 because
 * Westreet's current link was never captured, and Clackamas County Bank's 2 because its current
 * page (doc 16917) still states both prices. The banks' live sites could not be fetched from the
 * session that built this, so no takedown has been checked against a bank's current document; the
 * switch turns on by PR once a re-count after Magellan's fetch captures the banks' current links
 * has a sample checked against them (sampled-clean rule). Roll back by setting it to false.
 */
export const OLD_LABELLED_DOCUMENT_TAKEDOWN_LIVE = false;
export const OLD_LABELLED_DOCUMENT_REASON = "old_labelled_document";
export const OLD_LABELLED_DOCUMENT_FLAG = "old_labelled_document";
export const OLD_LABELLED_DOCUMENT_LIMIT = 5_000;
export const OLD_LABELLED_DOCUMENT_SAMPLES = 20;
export const OLD_LABELLED_DOCUMENT_SCAN_INTERVAL_HOURS = 1;
/** The loose path pre-filter (a superset of `oldLabelledAddress`; `old-labelled-link.ts`'s `oldLabelledPrefilterSql`). */
export const OLD_LABELLED_PREFILTER = "(old|archiv|previous|prior|supersed|expired|obsolete|outdated)";

export type OldLabelledVerdict =
  | "takedown"
  | "not_old_labelled"
  | "no_current_link"
  | "current_link_is_this_page"
  | "current_link_old_labelled"
  | "current_link_not_captured"
  | "stated_on_current_link";

export const OLD_LABELLED_VERDICTS: readonly OldLabelledVerdict[] = [
  "takedown", "not_old_labelled", "no_current_link", "current_link_is_this_page", "current_link_old_labelled",
  "current_link_not_captured", "stated_on_current_link",
];

export interface OldLabelledDocumentRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  source_document_id: number | string | null;
  document_url: string | null;
  /** The bank's fee link (`institution_sources.fee_schedule_url`). */
  current_link: string | null;
  /** The newest stored copy of that link with text, when one exists. */
  link_document_id: number | string | null;
  link_text: string | null;
}

export interface OldLabelledDocumentMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string | null;
  sourceDocumentId: number;
  documentUrl: string;
  oldWord: string;
  currentLink: string | null;
  linkDocumentId: number | null;
  verdict: OldLabelledVerdict;
  reason: string;
}

export interface OldLabelledDocumentFindings {
  /** Live fees on an old-labelled document (every verdict but `not_old_labelled`). */
  read: number;
  /** Fees the check would take down. */
  matched: number;
  documents: number;
  institutions: number;
  verdicts: Record<OldLabelledVerdict, number>;
  samples: OldLabelledDocumentMatch[];
  kept: OldLabelledDocumentMatch[];
}

export interface OldLabelledDocumentResult extends OldLabelledDocumentFindings {
  live: boolean;
  dryRun: boolean;
  skipped: boolean;
  scoped: boolean;
  flagged: number;
  waiting: number;
  cleared: number;
  takenDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pure: one page however it is spelled (scheme, "www.", case and a trailing slash dropped); the same as the SQL's `pageKeySql`. */
export function oldLabelledPageKey(url: string | null | undefined): string {
  return (url ?? "").trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
}

/**
 * Pure: what the check does with one live fee (see the module note). The old word is the document's;
 * `null` means the address is not old-labelled at all.
 */
export function oldLabelledDocumentVerdict(input: {
  documentUrl: string | null;
  currentLink: string | null;
  linkText: string | null;
  feeName: string | null;
  amount: number | null;
  canonicalFeeKey: string | null;
}): OldLabelledVerdict {
  if (!oldLabelledAddress(input.documentUrl)) return "not_old_labelled";
  const link = (input.currentLink ?? "").trim();
  if (!link) return "no_current_link";
  if (oldLabelledPageKey(link) === oldLabelledPageKey(input.documentUrl)) return "current_link_is_this_page";
  if (oldLabelledAddress(link)) return "current_link_old_labelled";
  if (!input.linkText || !input.linkText.trim()) return "current_link_not_captured";
  if (input.amount != null && input.feeName) {
    const stated = checkFeeAgainstSource(input.linkText, input.feeName, input.amount, ".", input.canonicalFeeKey);
    if (stated.ok) return "stated_on_current_link";
  }
  return "takedown";
}

function emptyVerdicts(): Record<OldLabelledVerdict, number> {
  return Object.fromEntries(OLD_LABELLED_VERDICTS.map((verdict) => [verdict, 0])) as Record<OldLabelledVerdict, number>;
}

/** Pure: each candidate row's verdict, the fees to take down and the counts. */
export function findOldLabelledDocuments(rows: OldLabelledDocumentRow[]): OldLabelledDocumentFindings & { matches: OldLabelledDocumentMatch[] } {
  const verdicts = emptyVerdicts();
  const matches: OldLabelledDocumentMatch[] = [];
  const kept: OldLabelledDocumentMatch[] = [];
  const seen = new Set<number>();
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    const documentId = num(row.source_document_id);
    if (documentId == null || seen.has(feeId)) continue;
    seen.add(feeId);
    const documentUrl = (row.document_url ?? "").trim();
    const amount = num(row.amount);
    const verdict = oldLabelledDocumentVerdict({
      documentUrl,
      currentLink: row.current_link,
      linkText: row.link_text,
      feeName: row.fee_name,
      amount,
      canonicalFeeKey: row.canonical_fee_key,
    });
    verdicts[verdict] += 1;
    if (verdict === "not_old_labelled") continue;
    const linkDocumentId = num(row.link_document_id);
    const fee: OldLabelledDocumentMatch = {
      feePublishedId: feeId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: row.fee_name ?? "",
      amount,
      canonicalFeeKey: row.canonical_fee_key ?? null,
      sourceDocumentId: documentId,
      documentUrl,
      oldWord: oldLabelledAddress(documentUrl) ?? "",
      currentLink: (row.current_link ?? "").trim() || null,
      linkDocumentId,
      verdict,
      reason: `${OLD_LABELLED_DOCUMENT_REASON}: #${documentId} (current link #${linkDocumentId ?? "?"})`,
    };
    (verdict === "takedown" ? matches : kept).push(fee);
  }
  return {
    read: matches.length + kept.length,
    matched: matches.length,
    documents: new Set(matches.map((fee) => fee.sourceDocumentId)).size,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    verdicts,
    samples: matches.slice(0, OLD_LABELLED_DOCUMENT_SAMPLES),
    kept: kept.slice(0, OLD_LABELLED_DOCUMENT_SAMPLES),
    matches,
  };
}

/**
 * Read-only: every live fee whose document's path passes the loose pre-filter, with the bank's fee
 * link and the newest stored text of a copy of that link (any of the bank's documents at the same
 * page key). This is also the dry-run read: `countOldLabelledDocuments` runs it and applies the rule.
 */
export function oldLabelledDocumentRowsSql(db: SqlTag, options: { institutionId?: number; limit?: number } = {}) {
  const scoped = options.institutionId != null;
  const limit = Math.max(1, Math.min(options.limit ?? OLD_LABELLED_DOCUMENT_LIMIT, 20_000));
  return db<OldLabelledDocumentRow[]>`
    WITH live AS (
      SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
             fp.canonical_fee_key, fr.source_document_id, btrim(sd.document_url) AS document_url
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        JOIN source_documents sd ON sd.id = fr.source_document_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
         -- notAdminCorrectedSql("fp") (fee-correction-guard), inline for the tagged template.
         AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
         AND lower(regexp_replace(COALESCE(sd.document_url, ''), '^[a-z]+://[^/]+', '', 'i')) ~ ${OLD_LABELLED_PREFILTER}
    ), banks AS (
      SELECT DISTINCT live.institution_id, btrim(inst.fee_schedule_url) AS current_link
        FROM live
        JOIN institution_sources inst ON inst.id = live.institution_id
    ), links AS (
      SELECT banks.institution_id, banks.current_link, copy.id AS link_document_id, copy.normalized_text AS link_text
        FROM banks
        LEFT JOIN LATERAL (
          SELECT sd.id, t.normalized_text
            FROM source_documents sd
            JOIN LATERAL (
              SELECT ast.normalized_text FROM agent_source_texts ast
               WHERE ast.source_document_id = sd.id
               ORDER BY ast.id DESC
               LIMIT 1
            ) t ON TRUE
           WHERE sd.institution_id = banks.institution_id
             AND banks.current_link IS NOT NULL
             AND regexp_replace(regexp_replace(lower(btrim(sd.document_url)), '^https?://(www\\.)?', ''), '/+$', '')
               = regexp_replace(regexp_replace(lower(banks.current_link), '^https?://(www\\.)?', ''), '/+$', '')
           ORDER BY sd.id DESC
           LIMIT 1
        ) copy ON TRUE
    )
    SELECT live.*, links.current_link, links.link_document_id, links.link_text
      FROM live
      JOIN links ON links.institution_id = live.institution_id
     ORDER BY live.fee_published_id
     LIMIT ${limit}::int
  `;
}

/** The dry-run count over the whole live table in one read (nothing written). Null on a failed read. */
export async function countOldLabelledDocuments(db: SqlTag): Promise<OldLabelledDocumentFindings | null> {
  try {
    const rows = await inSavepoint(db, (scope) => oldLabelledDocumentRowsSql(scope));
    const { matches: _all, ...findings } = findOldLabelledDocuments(rows);
    void _all;
    return findings;
  } catch (error) {
    console.warn("[darwin] old-labelled document count failed", error instanceof Error ? error.message : error);
    return null;
  }
}

/** True when a full (not institution-scoped) read ran under the interval ago. A failed read never skips. */
async function readRecently(db: SqlTag, now: Date): Promise<boolean> {
  try {
    const rows = await inSavepoint(db, (scope) => scope<{ created_at: Date | string | null }[]>`
      SELECT created_at
        FROM agent_run_events
       WHERE event_type = ${OLD_LABELLED_DOCUMENT_CHECK}
         AND COALESCE(detail->>'scoped', 'false') <> 'true'
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `);
    const at = rows[0]?.created_at == null ? null : new Date(rows[0].created_at).getTime();
    return at != null && Number.isFinite(at) && now.getTime() - at < OLD_LABELLED_DOCUMENT_SCAN_INTERVAL_HOURS * 3_600_000;
  } catch (error) {
    console.warn("[darwin] old-labelled document interval read failed", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckOldLabelledDocuments(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<OldLabelledDocumentResult> {
  const live = options.live ?? OLD_LABELLED_DOCUMENT_TAKEDOWN_LIVE;
  const { matches: _none, ...empty } = findOldLabelledDocuments([]);
  void _none;
  const result: OldLabelledDocumentResult = {
    live, dryRun: options.dryRun, skipped: false, scoped: options.institutionId != null, ...empty, flagged: 0, waiting: 0, cleared: 0, takenDown: [],
  };

  if (options.institutionId == null && !options.dryRun && await readRecently(db, options.now ?? new Date())) {
    result.skipped = true;
    return result;
  }

  let rows: OldLabelledDocumentRow[];
  try {
    rows = await inSavepoint(db, (scope) => oldLabelledDocumentRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] old-labelled document check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findOldLabelledDocuments(rows);
  Object.assign(result, findings);

  if (live && !options.dryRun && (matches.length > 0 || findings.kept.length > 0)) {
    const { passing, unjudged } = keptFeeIds(rows);
    const look = await secondLook(db, {
      check: OLD_LABELLED_DOCUMENT_CHECK, runId: options.runId, failing: matches, passing, unjudged, dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    result.cleared = look.cleared;
    if (look.confirmed.length > 0) {
      result.takenDown = await archive(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${OLD_LABELLED_DOCUMENT_CHECK}, 'completed',
          ${`Read live fees on documents labelled old or archived: ${result.read} live fee(s), ${result.matched} on ${result.documents} document(s) a newer captured link does not state; ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(oldLabelledDocumentDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] old-labelled document check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/**
 * Every kept fee on an old-labelled document (not only the sampled ones), so a pending first look
 * clears: a fee the current link states is a pass; one kept because nothing proves a newer schedule
 * is unjudged (#2072, cleared at weight 0, never a learned pass).
 */
function keptFeeIds(rows: OldLabelledDocumentRow[]): { passing: number[]; unjudged: number[] } {
  const passing: number[] = [];
  const unjudged: number[] = [];
  for (const row of rows) {
    const verdict = oldLabelledDocumentVerdict({
      documentUrl: row.document_url,
      currentLink: row.current_link,
      linkText: row.link_text,
      feeName: row.fee_name,
      amount: num(row.amount),
      canonicalFeeKey: row.canonical_fee_key,
    });
    if (verdict === "stated_on_current_link") passing.push(Number(row.fee_published_id));
    else if (verdict !== "takedown" && verdict !== "not_old_labelled") unjudged.push(Number(row.fee_published_id));
  }
  return { passing, unjudged };
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: OldLabelledDocumentMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-old-labelled-document-${runId}`},
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
                   WHEN fv.outlier_flags ? ${OLD_LABELLED_DOCUMENT_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${OLD_LABELLED_DOCUMENT_FLAG}::text)
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
    console.error("[darwin] old-labelled document takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: OldLabelledDocumentMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.old_labelled_document_takedown', 'completed',
        ${`Archived ${archived.length} live fee(s) read from a document labelled old or archived, on their second look`},
        ${JSON.stringify({ version: OLD_LABELLED_DOCUMENT_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] old-labelled document takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: OldLabelledDocumentMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    source_document_id: fee.sourceDocumentId,
    document_url: fee.documentUrl,
    old_word: fee.oldWord,
    current_link: fee.currentLink,
    link_document_id: fee.linkDocumentId,
    verdict: fee.verdict,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function oldLabelledDocumentDetail(result: OldLabelledDocumentResult) {
  return {
    check: OLD_LABELLED_DOCUMENT_CHECK,
    version: OLD_LABELLED_DOCUMENT_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    skipped: result.skipped,
    scoped: result.scoped,
    read: result.read,
    matched: result.matched,
    documents: result.documents,
    institutions: result.institutions,
    verdicts: result.verdicts,
    flagged: result.flagged,
    waiting: result.waiting,
    cleared: result.cleared,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
    kept_samples: result.kept.map(sampleDetail),
  };
}
