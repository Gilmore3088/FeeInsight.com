import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import {
  documentHostLabelSql,
  documentPathSegmentsSql,
  nonDepositDocumentKind,
  nonDepositKindSql,
  type NonDepositDocumentKind,
} from "@/lib/non-deposit-document";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of fees read from documents that are not deposit fee schedules (#1442;
 * decision 2026-10-15, "Darwin re-checks every live fee against today's rules"). James's catalog
 * review (Oct 15, prod read-only, URL heuristics) found live rows from brokerage and wealth pages
 * (33 rows on 5 addresses: Northern Trust wealth, U.S. Bank self-directed investing "Research"
 * $20) and from loan, card, HELOC, mortgage and rate pages (386 rows on 85 addresses: Bank of
 * Greene `/current-rates/` "Appraisal $400"). Those counts are the issue's, not this rule's; the
 * rule's own count is `nonDepositCountSql`.
 *
 * The rule is the shared classifier `nonDepositDocumentKind` (`@/lib/non-deposit-document`, also
 * Magellan's companion filter), read on the address of the stored document each live fee came
 * from (the same join as `document-owner.ts`: `published_fee_records.lineage_ref` ->
 * `verified_fee_observations` -> `raw_fee_observations.source_document_id` -> `source_documents`).
 * It is conservative: a path segment must name the page as a loan, rate, card, mortgage, HELOC,
 * brokerage, investing or wealth page, a deposit word anywhere wins, and business and commercial
 * documents are out of scope (kept on purpose; fee-stats drops them from medians).
 *
 * Each Darwin verify step reads the next `NON_DEPOSIT_BATCH` live fees after a cursor kept on the
 * run ledger (the `darwin.non_deposit_document` event's `next_after_id`, 0 once a pass reaches the
 * end). An institution-scoped run reads that institution's live fees and leaves the cursor alone.
 *
 * Shadow first (CLAUDE.md standing rule): while `NON_DEPOSIT_DOCUMENT_TAKEDOWN_LIVE` is false, or in
 * a dry run, the step only reports what it would take down (by kind, with samples). Switched on, a
 * matching fee goes through the shared 12-hour second look (check `darwin.non_deposit_document`)
 * and is archived on its second failure: rolled back with `non_deposit_document: <kind> #<doc>`,
 * its verified row rejected with the `non_deposit_document` flag, never deleted, and a
 * `darwin.non_deposit_document_takedown` event lists them. Fees that pass clear a pending flag.
 */
export const NON_DEPOSIT_CHECK = "darwin.non_deposit_document";
export const NON_DEPOSIT_CHECK_VERSION = 1;
/**
 * Default-off switch. It turns on by PR after the dry-run count over the whole live table
 * (`nonDepositCountSql`, or the verify step's `non_deposit_full_count` param) and a sample
 * (`nonDepositSamplesSql`) have been shown to James.
 */
export const NON_DEPOSIT_DOCUMENT_TAKEDOWN_LIVE = false;
export const NON_DEPOSIT_REASON = "non_deposit_document";
export const NON_DEPOSIT_FLAG = "non_deposit_document";
/** Live fees read per step; an address-only read. */
export const NON_DEPOSIT_BATCH = 2_000;
export const NON_DEPOSIT_SAMPLES = 20;

export interface NonDepositRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  source_document_id: number | string | null;
  document_url: string | null;
}

export interface NonDepositMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string | null;
  sourceDocumentId: number;
  documentUrl: string;
  kind: NonDepositDocumentKind;
  reason: string;
}

export interface NonDepositFindings {
  checked: number;
  /** Fees whose stored document address was found. */
  withDocument: number;
  matched: number;
  byKind: Record<NonDepositDocumentKind, number>;
  /** Distinct documents and institutions among the matches. */
  documents: number;
  institutions: number;
  samples: NonDepositMatch[];
}

export interface NonDepositResult extends NonDepositFindings {
  live: boolean;
  dryRun: boolean;
  afterId: number | null;
  nextAfterId: number | null;
  /** Switch on: first looks logged, fees still waiting for their second look, pending flags cleared. */
  flagged: number;
  waiting: number;
  cleared: number;
  /** Live fees archived in this step (switch on, not a dry run). */
  takenDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pure: the live rows whose document is a brokerage/wealth or loan/rate page, counted by kind, with every match kept. */
export function findNonDepositFees(rows: NonDepositRow[]): NonDepositFindings & { matches: NonDepositMatch[]; passing: number[] } {
  const byKind: Record<NonDepositDocumentKind, number> = { brokerage: 0, loan: 0 };
  const matches: NonDepositMatch[] = [];
  const passing: number[] = [];
  let withDocument = 0;
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const documentId = num(row.source_document_id);
    const url = (row.document_url ?? "").trim();
    if (documentId == null || !url) continue;
    withDocument += 1;
    const kind = nonDepositDocumentKind(url);
    if (!kind) {
      passing.push(Number(row.fee_published_id));
      continue;
    }
    byKind[kind] += 1;
    matches.push({
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: row.fee_name ?? "",
      amount: num(row.amount),
      canonicalFeeKey: row.canonical_fee_key ?? null,
      sourceDocumentId: documentId,
      documentUrl: url,
      kind,
      reason: `${NON_DEPOSIT_REASON}: ${kind} #${documentId}`,
    });
  }
  return {
    checked: rows.length,
    withDocument,
    matched: matches.length,
    byKind,
    documents: new Set(matches.map((fee) => fee.sourceDocumentId)).size,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, NON_DEPOSIT_SAMPLES),
    matches,
    passing,
  };
}

function findingsOnly(found: ReturnType<typeof findNonDepositFees>): NonDepositFindings {
  const { matches: _matches, passing: _passing, ...findings } = found;
  void _matches;
  void _passing;
  return findings;
}

async function readCursor(db: SqlTag): Promise<number> {
  const [row] = await inSavepoint(db, (scope) => scope<{ next_after_id: string | null }[]>`
    SELECT detail->>'next_after_id' AS next_after_id
      FROM agent_run_events
     WHERE event_type = ${NON_DEPOSIT_CHECK}
       AND detail->>'next_after_id' IS NOT NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `);
  return num(row?.next_after_id ?? null) ?? 0;
}

/**
 * One step's share of the live re-check (see the module note). Never throws: a failed read reports
 * nothing checked, and a failed write leaves the fees as they were.
 */
export async function recheckNonDepositDocuments(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<NonDepositResult> {
  const live = options.live ?? NON_DEPOSIT_DOCUMENT_TAKEDOWN_LIVE;
  const limit = Math.max(1, Math.min(options.limit ?? NON_DEPOSIT_BATCH, 20_000));
  const scoped = options.institutionId != null;
  const result: NonDepositResult = {
    live, dryRun: options.dryRun, ...findingsOnly(findNonDepositFees([])), afterId: null, nextAfterId: null,
    flagged: 0, waiting: 0, cleared: 0, takenDown: [],
  };
  let rows: NonDepositRow[];
  try {
    const afterId = scoped ? 0 : await readCursor(db);
    // The document-owner join; LEFT JOINs so the cursor walks every live fee, documented or not.
    rows = await inSavepoint(db, (scope) => scope<NonDepositRow[]>`
      SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
             fp.canonical_fee_key, fr.source_document_id, btrim(sd.document_url) AS document_url
        FROM published_fee_records fp
        LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        LEFT JOIN source_documents sd ON sd.id = fr.source_document_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.fee_published_id > ${afterId}
         AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
       ORDER BY fp.fee_published_id
       LIMIT ${limit}::int
    `);
    if (!scoped) {
      result.afterId = afterId;
      result.nextAfterId = rows.length < limit ? 0 : Number(rows[rows.length - 1].fee_published_id);
    }
  } catch (error) {
    console.warn("[darwin] non-deposit document check read failed", error instanceof Error ? error.message : error);
    return result;
  }

  const found = findNonDepositFees(rows);
  Object.assign(result, findingsOnly(found));

  if (live && !options.dryRun && (found.matches.length > 0 || found.passing.length > 0)) {
    const look = await secondLook(db, {
      check: NON_DEPOSIT_CHECK, runId: options.runId, failing: found.matches, passing: found.passing, dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    result.cleared = look.cleared;
    if (look.confirmed.length > 0) {
      result.takenDown = await archive(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  // The step's report, which also carries the cursor for the next step. A dry run writes nothing.
  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${NON_DEPOSIT_CHECK}, 'completed',
          ${`Read ${result.checked} live fee(s) (${result.withDocument} with a stored document): ${result.matched} came from a non-deposit document (${result.byKind.brokerage} brokerage or wealth, ${result.byKind.loan} loan, card or rate); ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(nonDepositDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] non-deposit document check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: NonDepositMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-non-deposit-${runId}`},
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
                   WHEN fv.outlier_flags ? ${NON_DEPOSIT_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${NON_DEPOSIT_FLAG}::text)
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
    console.error("[darwin] non-deposit document takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: NonDepositMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.non_deposit_document_takedown', 'completed',
        ${`Archived ${archived.length} live fee(s) read from brokerage, wealth, loan, card or rate documents on their second look`},
        ${JSON.stringify({
          version: NON_DEPOSIT_CHECK_VERSION,
          taken_down: archived.length,
          by_kind: archived.reduce<Record<string, number>>((counts, fee) => {
            counts[fee.kind] = (counts[fee.kind] ?? 0) + 1;
            return counts;
          }, {}),
          samples: archived.slice(0, 50).map(sampleDetail),
        })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] non-deposit document takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: NonDepositMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    source_document_id: fee.sourceDocumentId,
    document_url: fee.documentUrl,
    kind: fee.kind,
  };
}

/** The findings as ledger detail. */
export function nonDepositFindingsDetail(found: NonDepositFindings) {
  return {
    checked: found.checked,
    with_document: found.withDocument,
    would_take_down: found.matched,
    by_kind: found.byKind,
    documents: found.documents,
    institutions: found.institutions,
    samples: found.samples.map(sampleDetail),
  };
}

/** The step detail (and ledger event detail) for one step's share. */
export function nonDepositDetail(result: NonDepositResult) {
  return {
    check: NON_DEPOSIT_CHECK,
    version: NON_DEPOSIT_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    batch: NON_DEPOSIT_BATCH,
    after_id: result.afterId,
    next_after_id: result.nextAfterId,
    ...nonDepositFindingsDetail(result),
    flagged: result.flagged,
    waiting: result.waiting,
    cleared: result.cleared,
    taken_down: result.takenDown.length,
  };
}

/**
 * The dry-run count over the whole live table in one read (nothing written, no cursor), for the
 * count James sees before the switch goes on. Run it with the verify step's `non_deposit_full_count`
 * param. Reads one row per (document, fee) and classifies in JS, as the step does.
 */
export async function countNonDepositFees(db: SqlTag): Promise<NonDepositFindings | null> {
  try {
    const rows = await inSavepoint(db, (scope) => scope<NonDepositRow[]>`
      SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
             fp.canonical_fee_key, fr.source_document_id, btrim(sd.document_url) AS document_url
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        JOIN source_documents sd ON sd.id = fr.source_document_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND btrim(COALESCE(sd.document_url, '')) <> ''
       ORDER BY fp.fee_published_id
    `);
    return findingsOnly(findNonDepositFees(rows));
  } catch (error) {
    console.warn("[darwin] non-deposit document full count failed", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Live fees with their stored document's address, normalised path and kind (`nonDepositKindSql`,
 * the Postgres mirror of `nonDepositDocumentKind` on the address alone). Read-only.
 */
function liveNonDepositSql(): string {
  return `WITH live AS (
  SELECT fp.fee_published_id, fp.institution_id, fp.fee_name, fp.amount, fp.canonical_fee_key,
         fr.source_document_id, btrim(sd.document_url) AS document_url
    FROM published_fee_records fp
    JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
    JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
    JOIN source_documents sd ON sd.id = fr.source_document_id
   WHERE fp.rolled_back_at IS NULL AND fp.quarantined_at IS NULL AND btrim(COALESCE(sd.document_url, '')) <> ''
), documents AS (
  SELECT source_document_id, document_url,
         ${documentPathSegmentsSql("document_url")} AS path,
         ${documentHostLabelSql("document_url")} AS host
    FROM (SELECT DISTINCT source_document_id, document_url FROM live) d
), judged AS (
  SELECT source_document_id, document_url, path, ${nonDepositKindSql("path", "host")} AS kind
    FROM documents
)`;
}

/**
 * The same count as one read-only SQL statement, for someone with prod access (#1442): live fees
 * whose stored document is a brokerage/wealth or loan/card/rate page, by kind, with the
 * documents and institutions behind them, and every live fee with a document as the base.
 */
export function nonDepositCountSql(): string {
  return `${liveNonDepositSql()}
SELECT COALESCE(j.kind, 'all kinds') AS kind,
       count(*) AS live_fees,
       count(DISTINCT l.source_document_id) AS documents,
       count(DISTINCT l.institution_id) AS institutions,
       (SELECT count(*) FROM live) AS live_fees_with_document
  FROM live l
  JOIN judged j ON j.source_document_id = l.source_document_id
 WHERE j.kind IS NOT NULL
 GROUP BY ROLLUP (j.kind)
 ORDER BY 1;`;
}

/**
 * Read-only: the matched documents, most live fees first (`limit` of them), with their kind,
 * normalised path, institutions and up to five fee names with amounts each.
 */
export function nonDepositSamplesSql(limit = 60): string {
  const rows = Math.max(1, Math.min(Math.trunc(limit), 500));
  return `${liveNonDepositSql()}
SELECT j.kind, j.source_document_id, j.document_url, j.path,
       count(*) AS live_fees,
       array_agg(DISTINCT l.institution_id) AS institution_ids,
       (array_agg(l.fee_name || ' $' || COALESCE(l.amount::text, '?') ORDER BY l.fee_published_id))[1:5] AS sample_fees
  FROM live l
  JOIN judged j ON j.source_document_id = l.source_document_id
 WHERE j.kind IS NOT NULL
 GROUP BY j.kind, j.source_document_id, j.document_url, j.path
 ORDER BY count(*) DESC, j.source_document_id
 LIMIT ${rows};`;
}
