import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of fees read from a Canadian bank's document (#2022, James chose "Do all
 * three" on Oct 19; decision 2026-10-15, "Darwin re-checks every live fee against today's rules").
 * Natbank, National Association is a Florida bank owned by National Bank of Canada, and its
 * registry pointed at nbc.ca, so 12 fees were read from the parent's Canadian chequing page and
 * personal fee guide (Canadian dollars, Interac e-Transfers) and published as Natbank's.
 *
 * Every institution here is U.S.-chartered, so a document is Canadian when its stored text names a
 * Canadian marker (`CANADIAN_MARKS`: Interac, CDIC or Canada Deposit Insurance) and names no U.S.
 * insurer (`US_INSURER`: FDIC or NCUA). The address is not used: Natbank's own U.S. pages live on
 * nbc.ca too (docs 17161, 33328), and they name no Interac. Whole words only: "interactive"
 * matched 352 live documents on Oct 19, "\mInterac\M" only Natbank's two. RBC Bank's cross-border
 * pages name CDIC beside FDIC, so they stay.
 *
 * Every live document's text is read (8,722 documents, 1.3 to 3.9 s on prod, Oct 19), so a step
 * reads at most once per `CANADIAN_DOCUMENT_SCAN_INTERVAL_HOURS`, keyed on the last event of a real
 * read. An institution-scoped run reads only that institution's fees, every time.
 *
 * Switched on, a matching fee goes through the shared 12-hour second look (check
 * `darwin.canadian_document`) and is archived on its second failure: rolled back with
 * `canadian_document: #<doc>`, its verified row rejected with the `canadian_document` flag, never
 * deleted, and a `darwin.canadian_document_takedown` event lists them. A document's stored text
 * does not change once read, so the step passes no fee as cleared. In a dry run, or with the switch
 * off, the step only reports.
 *
 * Dry run, prod read-only, 2026-10-19 (`canadianDocumentRowsSql`): 12 live fees on 2 documents
 * (26833 chequing page, 26834 fee guide), all at Natbank (2675); its U.S. fee 124809 (doc 17161)
 * stays. The 12 are also listed as #2022 hand takedowns, so the check finds none once they apply.
 */
export const CANADIAN_DOCUMENT_CHECK = "darwin.canadian_document";
export const CANADIAN_DOCUMENT_CHECK_VERSION = 1;
/** The switch. On with the PR that adds it (James, "Do all three", #2022, Oct 19). Roll back by setting it to false. */
export const CANADIAN_DOCUMENT_TAKEDOWN_LIVE = true;
export const CANADIAN_DOCUMENT_REASON = "canadian_document";
export const CANADIAN_DOCUMENT_FLAG = "canadian_document";
export const CANADIAN_DOCUMENT_LIMIT = 2_000;
export const CANADIAN_DOCUMENT_SAMPLES = 20;
export const CANADIAN_DOCUMENT_SCAN_INTERVAL_HOURS = 1;

/** Words a Canadian bank's document names, written once for JS and Postgres (`\m...\M`, `~*`). */
const CANADIAN_WORDS = "interac|cdic|canada deposit insurance";
const US_INSURER_WORDS = "fdic|ncua";
export const CANADIAN_MARKS_SQL = `\\m(${CANADIAN_WORDS})\\M`;
export const US_INSURER_SQL = `\\m(${US_INSURER_WORDS})\\M`;
const CANADIAN_MARKS = new RegExp(`\\b(?:${CANADIAN_WORDS})\\b`, "i");
const US_INSURER = new RegExp(`\\b(?:${US_INSURER_WORDS})\\b`, "i");

/** Pure: the text is a Canadian bank's document (a Canadian marker, no U.S. insurer). */
export function canadianDocument(text: string | null | undefined): boolean {
  const body = text ?? "";
  return CANADIAN_MARKS.test(body) && !US_INSURER.test(body);
}

export interface CanadianDocumentRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  source_document_id: number | string | null;
  document_url: string | null;
}

export interface CanadianDocumentMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string | null;
  sourceDocumentId: number;
  documentUrl: string;
  reason: string;
}

export interface CanadianDocumentFindings {
  matched: number;
  documents: number;
  institutions: number;
  samples: CanadianDocumentMatch[];
}

export interface CanadianDocumentResult extends CanadianDocumentFindings {
  live: boolean;
  dryRun: boolean;
  /** True when the step skipped the read (the last real read was under the interval ago). */
  skipped: boolean;
  flagged: number;
  waiting: number;
  takenDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pure: the matches for rows the read selected (each already on a Canadian document). */
export function findCanadianDocuments(rows: CanadianDocumentRow[]): CanadianDocumentFindings & { matches: CanadianDocumentMatch[] } {
  const matches: CanadianDocumentMatch[] = [];
  const seen = new Set<number>();
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const documentId = num(row.source_document_id);
    const feeId = Number(row.fee_published_id);
    if (documentId == null || seen.has(feeId)) continue;
    seen.add(feeId);
    matches.push({
      feePublishedId: feeId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: row.fee_name ?? "",
      amount: num(row.amount),
      canonicalFeeKey: row.canonical_fee_key ?? null,
      sourceDocumentId: documentId,
      documentUrl: (row.document_url ?? "").trim(),
      reason: `${CANADIAN_DOCUMENT_REASON}: #${documentId}`,
    });
  }
  return {
    matched: matches.length,
    documents: new Set(matches.map((fee) => fee.sourceDocumentId)).size,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, CANADIAN_DOCUMENT_SAMPLES),
    matches,
  };
}

/** Read-only: every live fee whose document's stored text is a Canadian bank's (see the module note). */
export function canadianDocumentRowsSql(db: SqlTag, options: { institutionId?: number; limit?: number } = {}) {
  const scoped = options.institutionId != null;
  const limit = Math.max(1, Math.min(options.limit ?? CANADIAN_DOCUMENT_LIMIT, 20_000));
  return db<CanadianDocumentRow[]>`
    WITH live AS (
      SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
             fp.canonical_fee_key, fr.source_document_id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fr.source_document_id IS NOT NULL
         AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
    ), canadian AS (
      SELECT d.source_document_id
        FROM (SELECT DISTINCT source_document_id FROM live) d
        -- One text per document, read through its index: a plain join scans every stored text (5.9 s).
        JOIN LATERAL (
          SELECT ast.normalized_text FROM agent_source_texts ast
           WHERE ast.source_document_id = d.source_document_id
           LIMIT 1
        ) t ON TRUE
       WHERE t.normalized_text ~* ${CANADIAN_MARKS_SQL}
         AND t.normalized_text !~* ${US_INSURER_SQL}
    )
    SELECT live.*, btrim(sd.document_url) AS document_url
      FROM live
      JOIN canadian ON canadian.source_document_id = live.source_document_id
      JOIN source_documents sd ON sd.id = live.source_document_id
     ORDER BY live.fee_published_id
     LIMIT ${limit}::int
  `;
}

/** True when a real (not skipped) read ran under the interval ago. A failed read never skips. */
async function readRecently(db: SqlTag, now: Date): Promise<boolean> {
  try {
    const rows = await inSavepoint(db, (scope) => scope<{ created_at: Date | string | null }[]>`
      SELECT created_at
        FROM agent_run_events
       WHERE event_type = ${CANADIAN_DOCUMENT_CHECK}
         AND COALESCE(detail->>'skipped', 'false') <> 'true'
       ORDER BY id DESC
       LIMIT 1
    `);
    const at = rows[0]?.created_at == null ? null : new Date(rows[0].created_at).getTime();
    return at != null && Number.isFinite(at) && now.getTime() - at < CANADIAN_DOCUMENT_SCAN_INTERVAL_HOURS * 3_600_000;
  } catch (error) {
    console.warn("[darwin] canadian document interval read failed", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckCanadianDocuments(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<CanadianDocumentResult> {
  const live = options.live ?? CANADIAN_DOCUMENT_TAKEDOWN_LIVE;
  const { matches: _none, ...empty } = findCanadianDocuments([]);
  void _none;
  const result: CanadianDocumentResult = { live, dryRun: options.dryRun, skipped: false, ...empty, flagged: 0, waiting: 0, takenDown: [] };

  if (options.institutionId == null && !options.dryRun && await readRecently(db, options.now ?? new Date())) {
    result.skipped = true;
    return result;
  }

  let rows: CanadianDocumentRow[];
  try {
    rows = await inSavepoint(db, (scope) => canadianDocumentRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] canadian document check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findCanadianDocuments(rows);
  Object.assign(result, findings);

  if (live && !options.dryRun && matches.length > 0) {
    const look = await secondLook(db, {
      check: CANADIAN_DOCUMENT_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
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
          ${options.runId}, ${options.stepId ?? null}, ${CANADIAN_DOCUMENT_CHECK}, 'completed',
          ${`Read live fees' documents for a Canadian bank's text: ${result.matched} live fee(s) on ${result.documents} Canadian document(s); ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(canadianDocumentDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] canadian document check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: CanadianDocumentMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-canadian-document-${runId}`},
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
                   WHEN fv.outlier_flags ? ${CANADIAN_DOCUMENT_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${CANADIAN_DOCUMENT_FLAG}::text)
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
    console.error("[darwin] canadian document takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: CanadianDocumentMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.canadian_document_takedown', 'completed',
        ${`Archived ${archived.length} live fee(s) read from a Canadian bank's document, on their second look`},
        ${JSON.stringify({ version: CANADIAN_DOCUMENT_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] canadian document takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: CanadianDocumentMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    source_document_id: fee.sourceDocumentId,
    document_url: fee.documentUrl,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function canadianDocumentDetail(result: CanadianDocumentResult) {
  return {
    check: CANADIAN_DOCUMENT_CHECK,
    version: CANADIAN_DOCUMENT_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    skipped: result.skipped,
    matched: result.matched,
    documents: result.documents,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
