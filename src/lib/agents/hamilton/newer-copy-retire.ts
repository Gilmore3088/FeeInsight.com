import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

type SqlTag = typeof sql;

/** Older documents checked against their newest copy per publish step; later steps pick up the rest. */
export const NEWER_COPY_DOCUMENT_LIMIT = 25;
export const NEWER_COPY_RETIRE_REASON = "newer_copy_drops_fee";
// The text-hash guards (identical text skipped, newer text read by Knox, a fee Knox read
// from the newer text never retired) joined version 1 without a bump: they only retire
// less, and in all of version 1 one fee was retired.
export const NEWER_COPY_STRATEGY = { strategy: "hamilton.newer_copy_check", version: 1 } as const;
/**
 * The newest copy must still state at least this share of the older copy's fees before
 * any fee is retired. Below it the newer copy is not recognizably the same schedule (an
 * error page, a redesign, a different product's page), so nothing is retired.
 */
export const NEWER_COPY_MIN_SHARED_SHARE = 0.5;
export const NEWER_COPY_MIN_SHARED_FEES = 2;
/**
 * False runs the check in shadow mode: every publish step computes and logs what it would
 * retire and restore (`hamilton.newer_copy_check` events) but changes no fee. A dry run
 * over every older document with a newer read copy (1,103 documents, 12,924 live fees,
 * 6 Oct 2026) retired 1 fee, a line the bank really removed, so the check runs live.
 */
export const NEWER_COPY_RETIRE_LIVE = true;

/** One pair per older document, checked again whenever a newer copy is read. */
export function newerCopyFingerprint(olderDocumentId: number, newerDocumentId: number, live = NEWER_COPY_RETIRE_LIVE): string {
  return `v${NEWER_COPY_STRATEGY.version}${live ? "" : "-shadow"}:${olderDocumentId}:${newerDocumentId}`;
}

export interface NewerCopyFeeRow {
  fee_published_id: number | string;
  lineage_ref: number | string;
  institution_id: number | string;
  source_document_id: number | string;
  newer_document_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  /** Retired by an earlier newer-copy check; restored if the newest copy states it again. */
  retired?: boolean | null;
  /**
   * True when Knox holds a row with this fee's name or amount (under any category, held or
   * not) read from the newer copy or from any document with the same text. Such a fee is
   * never retired: the reader found it, whatever the text matcher says.
   */
  newer_row_match?: boolean | null;
}

export type NewerCopyVerdict = "still_stated" | "still_named" | "dropped" | "unproven" | "no_amount";

function states(text: string, fee: Pick<NewerCopyFeeRow, "fee_name" | "amount">): ReturnType<typeof checkFeeAgainstSource> {
  return checkFeeAgainstSource(text, fee.fee_name, Number(fee.amount), ".");
}

const PRICE = /\$\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\b\d{1,3}(?:,\d{3})*\.\d{2}\b/g;
/** Words every fee schedule repeats; they say nothing about which line a fee was. */
const GENERIC_WORDS = new Set(
  "fee fees charge charges service services account accounts per each item items month monthly annual annually year yearly day daily the and for with without from after over under less than more first all any other no not only rental rent".split(" "),
);

/** Letters and digits only: "3 x 10 - $35.00" gives "3x103500". */
export function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** A name or row with its prices removed, squashed: "3 x 10 - $35.00" gives "3x10". */
function needle(text: string): string {
  return squash(text.replace(PRICE, " "));
}

/**
 * True when the newer copy still carries the fee's words anywhere, however the page was
 * flattened: its name, the words of the older copy's row for it, or every word of its
 * name that is not generic fee vocabulary. A newer copy that glues rows together
 * ("2 x 5 - $15.003 x 5 - $20.00") or drops the price column keeps its fees, because the
 * line is not gone.
 */
function wordsSurvive(newerText: string, feeName: string, olderLine: string): boolean {
  // With and without prices: "3X5=$20.00 3X10=$30.00" reads as a name only with its
  // prices removed, while "3x5 - $253x10 - $33" keeps "3x10" only with them kept.
  const haystack = squash(newerText);
  const unpriced = needle(newerText);
  for (const candidate of [needle(feeName), needle(olderLine)]) {
    if (candidate.length >= 3 && (haystack.includes(candidate) || unpriced.includes(candidate))) return true;
  }
  const distinctive = (feeName.toLowerCase().replace(PRICE, " ").match(/[a-z]{4,}/g) ?? []).filter((word) => !GENERIC_WORDS.has(word));
  return distinctive.length > 0 && distinctive.every((word) => haystack.includes(word));
}

/**
 * Pure: what the newest copy says about one fee of the older copy. A fee is dropped only
 * when the reader finds it in the older copy, finds no row naming it in the newer copy,
 * and neither its name nor the words of its older row appear anywhere in the newer copy.
 * A layout the reader misses in both copies never retires a fee (it is `unproven`), and
 * a newer copy that is only flattened differently keeps its fees. A fee still named at a
 * different price is left to the publish step, which records the price change when Knox
 * reads the newer copy.
 */
export function newerCopyVerdict(
  fee: Pick<NewerCopyFeeRow, "fee_name" | "amount">,
  newerText: string,
  olderText: string,
): NewerCopyVerdict {
  if (fee.amount == null) return "no_amount";
  const newer = states(newerText, fee);
  if (newer.ok || newer.reason === "tiered_fee") return "still_stated";
  const older = states(olderText, fee);
  if (!older.ok) return older.reason === "tiered_fee" ? "still_named" : "unproven";
  if (newer.reason !== "name_not_in_text") return "still_named";
  return wordsSurvive(newerText, fee.fee_name, older.sourceLine) ? "still_named" : "dropped";
}

export interface NewerCopyDocumentResult {
  institutionId: number;
  olderDocumentId: number;
  newerDocumentId: number;
  stillStated: number;
  stillNamed: number;
  dropped: number;
  /** Fees the reader finds in neither copy; never retired. */
  unproven: number;
  /** False when the newer copy states too few of the older copy's fees to be the same schedule. */
  recognized: boolean;
  retire: NewerCopyFeeRow[];
  restore: NewerCopyFeeRow[];
}

/** Pure: verdicts for one older document's fees against its newest copy. */
export function judgeNewerCopy(fees: NewerCopyFeeRow[], newerText: string, olderText: string): NewerCopyDocumentResult {
  const first = fees[0];
  const result: NewerCopyDocumentResult = {
    institutionId: Number(first.institution_id),
    olderDocumentId: Number(first.source_document_id),
    newerDocumentId: Number(first.newer_document_id),
    stillStated: 0,
    stillNamed: 0,
    dropped: 0,
    unproven: 0,
    recognized: false,
    retire: [],
    restore: [],
  };
  const dropped: NewerCopyFeeRow[] = [];
  const stated: NewerCopyFeeRow[] = [];
  for (const fee of fees) {
    const verdict = newerCopyVerdict(fee, newerText, olderText);
    if (verdict === "still_stated") {
      result.stillStated += 1;
      stated.push(fee);
    } else if (verdict === "still_named") {
      result.stillNamed += 1;
    } else if (verdict === "dropped" && fee.newer_row_match) {
      result.stillNamed += 1;
    } else if (verdict === "dropped") {
      result.dropped += 1;
      dropped.push(fee);
    } else if (verdict === "unproven") {
      result.unproven += 1;
    }
  }
  const judged = result.stillStated + result.stillNamed + result.dropped;
  result.recognized =
    result.stillStated >= NEWER_COPY_MIN_SHARED_FEES && judged > 0 && result.stillStated / judged >= NEWER_COPY_MIN_SHARED_SHARE;
  if (result.recognized) {
    result.retire = dropped.filter((fee) => !fee.retired);
    result.restore = stated.filter((fee) => fee.retired);
  }
  return result;
}

export interface NewerCopyRetireResult {
  /** True when fees were (or, in a dry run, would be) changed; false in shadow mode. */
  live: boolean;
  documentsChecked: number;
  unrecognized: number;
  stillStated: number;
  stillNamed: number;
  retired: NewerCopyFeeRow[];
  restored: number;
}

const EMPTY: NewerCopyRetireResult = { live: NEWER_COPY_RETIRE_LIVE, documentsChecked: 0, unrecognized: 0, stillStated: 0, stillNamed: 0, retired: [], restored: 0 };
const RETIRED = `${NEWER_COPY_RETIRE_REASON}:%`;

/**
 * Hamilton repair: a fee line the bank removed from its schedule comes down. When
 * Magellan has fetched a newer, different copy of a document's page (same institution and
 * URL) and Rosetta has read it, each live fee read from the older copy is checked against
 * the newest copy (`newerCopyVerdict`). Fees whose line is gone are retired
 * (`rolled_back_reason = 'newer_copy_drops_fee:#<newer document id>'`, the run's batch id)
 * and their verified rows rejected, but only when the newer copy still states at least
 * half of the older copy's fees, so an error page or a redesign retires nothing. Fees an
 * earlier check retired are restored when a later copy states them again. Fees still named
 * in the newer copy stay live (a new price is the publish step's price change once Knox
 * reads the newer copy). A dry run, and shadow mode
 * (`NEWER_COPY_RETIRE_LIVE` false), report and change no fee.
 */
export async function retireFeesDroppedFromNewerCopy(
  db: SqlTag,
  options: {
    runId: number;
    batchId: string;
    dryRun: boolean;
    institutionId?: number;
    stateCode?: string | null;
    documentLimit?: number;
    live?: boolean;
  },
): Promise<NewerCopyRetireResult> {
  const live = options.live ?? NEWER_COPY_RETIRE_LIVE;
  const limit = options.documentLimit ?? NEWER_COPY_DOCUMENT_LIMIT;
  const tag = live ? `v${NEWER_COPY_STRATEGY.version}` : `v${NEWER_COPY_STRATEGY.version}-shadow`;
  let fees: NewerCopyFeeRow[];
  let texts: Map<number, string>;
  try {
    const pairs = await inSavepoint(db, (scope) => scope<{ older_id: number | string; newer_id: number | string }[]>`
      WITH older AS (
        SELECT DISTINCT fr.source_document_id AS older_id, fp.institution_id
          FROM published_fee_records fp
          JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
          JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
          JOIN institution_sources inst ON inst.id = fp.institution_id
         WHERE (fp.rolled_back_at IS NULL OR fp.rolled_back_reason LIKE ${RETIRED})
           AND fr.source_document_id IS NOT NULL
           AND (${options.institutionId ?? null}::bigint IS NULL OR fp.institution_id = ${options.institutionId ?? null}::bigint)
           AND (${options.stateCode ?? null}::text IS NULL OR upper(btrim(inst.state_code)) = ${options.stateCode ?? null}::text)
      ),
      -- Texts Knox has read: any stored text with fee rows read from a copy that holds it.
      read_texts AS MATERIALIZED (
        SELECT DISTINCT same.text_hash
          FROM agent_source_texts same
          JOIN raw_fee_observations nr ON nr.source_document_id = same.source_document_id
         WHERE same.status = 'completed' AND same.text_hash IS NOT NULL
      ),
      paired AS (
        SELECT older.older_id, newest.id AS newer_id
          FROM older
          JOIN source_documents sd ON sd.id = older.older_id
          JOIN LATERAL (
            SELECT n.id
              FROM source_documents n
             WHERE n.institution_id = sd.institution_id
               AND n.document_url = sd.document_url
               AND n.id <> sd.id
               AND n.crawled_at > sd.crawled_at
               AND n.status = 'success'
               AND n.content_hash IS NOT NULL
               AND n.content_hash IS DISTINCT FROM sd.content_hash
               AND EXISTS (
                 SELECT 1 FROM agent_source_texts t
                  WHERE t.source_document_id = n.id AND t.status = 'completed' AND t.normalized_text IS NOT NULL
               )
             ORDER BY n.crawled_at DESC, n.id DESC
             LIMIT 1
          ) newest ON TRUE
          -- Each copy's latest stored text.
          JOIN LATERAL (
            SELECT t.text_hash FROM agent_source_texts t
             WHERE t.source_document_id = older.older_id AND t.status = 'completed' AND t.normalized_text IS NOT NULL
             ORDER BY t.id DESC LIMIT 1
          ) older_text ON TRUE
          JOIN LATERAL (
            SELECT t.text_hash FROM agent_source_texts t
             WHERE t.source_document_id = newest.id AND t.status = 'completed' AND t.normalized_text IS NOT NULL
             ORDER BY t.id DESC LIMIT 1
          ) newer_text ON TRUE
         -- Identical text cannot drop a fee; the pair is skipped (its rows move to the
         -- current copy in refresh-copy.ts).
         WHERE older_text.text_hash IS DISTINCT FROM newer_text.text_hash
           -- Knox must have read the newer text (from this copy or any copy with the same
           -- text) before any of the older copy's fees can be judged gone.
           AND newer_text.text_hash IN (SELECT text_hash FROM read_texts)
      )
      SELECT paired.older_id, paired.newer_id
        FROM paired
       WHERE NOT EXISTS (
         SELECT 1 FROM pipeline_attempts pa
          WHERE pa.stage = 'publish'
            AND pa.strategy = ${NEWER_COPY_STRATEGY.strategy}
            AND pa.source_document_id = paired.older_id
            AND pa.input_fingerprint = ${tag} || ':' || paired.older_id::text || ':' || paired.newer_id::text
       )
       ORDER BY paired.older_id
       LIMIT ${limit}
    `);
    if (pairs.length === 0) return { ...EMPTY, live };
    const olderIds = pairs.map((pair) => Number(pair.older_id));
    const newerIds = pairs.map((pair) => Number(pair.newer_id));
    fees = await inSavepoint(db, (scope) => scope<NewerCopyFeeRow[]>`
      WITH newer_rows AS MATERIALIZED (
        -- Every fee row Knox read from the newer copy's text, from whichever copy holds it.
        SELECT DISTINCT newer_text.source_document_id AS newer_id,
               lower(regexp_replace(nr.fee_name, '[^a-zA-Z0-9]+', '', 'g')) AS name_key,
               nr.amount
          FROM agent_source_texts newer_text
          JOIN agent_source_texts same ON same.text_hash = newer_text.text_hash AND same.status = 'completed'
          JOIN raw_fee_observations nr ON nr.source_document_id = same.source_document_id
         WHERE newer_text.source_document_id = ANY(${newerIds}::bigint[])
           AND newer_text.status = 'completed'
           AND newer_text.text_hash IS NOT NULL
      )
      SELECT fp.fee_published_id, fp.lineage_ref, fp.institution_id, fr.source_document_id, pair.newer_id AS newer_document_id,
             fp.canonical_fee_key, fp.fee_name, fp.amount, fp.rolled_back_at IS NOT NULL AS retired,
             EXISTS (
               SELECT 1 FROM newer_rows
                WHERE newer_rows.newer_id = pair.newer_id
                  AND (
                    newer_rows.name_key = lower(regexp_replace(fp.fee_name, '[^a-zA-Z0-9]+', '', 'g'))
                    OR (fp.amount IS NOT NULL AND newer_rows.amount = fp.amount)
                  )
             ) AS newer_row_match
        FROM unnest(${olderIds}::bigint[], ${newerIds}::bigint[]) AS pair(older_id, newer_id)
        JOIN raw_fee_observations fr ON fr.source_document_id = pair.older_id
        JOIN verified_fee_observations fv ON fv.fee_raw_id = fr.fee_raw_id
        JOIN published_fee_records fp ON fp.lineage_ref = fv.fee_verified_id
       WHERE fp.rolled_back_at IS NULL OR fp.rolled_back_reason LIKE ${RETIRED}
       ORDER BY fr.source_document_id, fp.fee_published_id
    `);
    const rows = await inSavepoint(db, (scope) => scope<{ source_document_id: number | string; normalized_text: string }[]>`
      SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
        FROM agent_source_texts
       WHERE source_document_id = ANY(${[...newerIds, ...olderIds]}::bigint[])
         AND status = 'completed'
         AND normalized_text IS NOT NULL
       ORDER BY source_document_id, id DESC
    `);
    texts = new Map(rows.map((row) => [Number(row.source_document_id), row.normalized_text]));
  } catch (error) {
    // A failed sweep must never block publishing new verified rows.
    console.error("retireFeesDroppedFromNewerCopy select failed:", error);
    return { ...EMPTY, live };
  }

  const byDocument = new Map<number, NewerCopyFeeRow[]>();
  for (const fee of fees) {
    const id = Number(fee.source_document_id);
    byDocument.set(id, [...(byDocument.get(id) ?? []), fee]);
  }
  const documents = [...byDocument.values()].map((group) =>
    judgeNewerCopy(group, texts.get(Number(group[0].newer_document_id)) ?? "", texts.get(Number(group[0].source_document_id)) ?? ""),
  );
  const result: NewerCopyRetireResult = {
    live,
    documentsChecked: documents.length,
    unrecognized: documents.filter((doc) => !doc.recognized).length,
    stillStated: documents.reduce((total, doc) => total + doc.stillStated, 0),
    stillNamed: documents.reduce((total, doc) => total + doc.stillNamed, 0),
    retired: documents.flatMap((doc) => doc.retire),
    restored: documents.reduce((total, doc) => total + doc.restore.length, 0),
  };
  if (options.dryRun) return result;

  const change = live;
  const restoreIds = live ? documents.flatMap((doc) => doc.restore.map((fee) => Number(fee.fee_published_id))) : [];
  try {
    await inSavepoint(db, async (scope) => {
      if (change && result.retired.length > 0) {
        await scope`
          UPDATE published_fee_records fp
             SET rolled_back_at = NOW(),
                 rolled_back_by_batch_id = ${options.batchId},
                 rolled_back_reason = ${NEWER_COPY_RETIRE_REASON} || ':#' || retire.newer_id::text
            FROM unnest(${result.retired.map((fee) => Number(fee.fee_published_id))}::bigint[],
                        ${result.retired.map((fee) => Number(fee.newer_document_id))}::bigint[])
                 AS retire(fee_published_id, newer_id)
           WHERE fp.fee_published_id = retire.fee_published_id
             AND fp.rolled_back_at IS NULL
        `;
        await scope`
          UPDATE verified_fee_observations
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN outlier_flags ? ${NEWER_COPY_RETIRE_REASON} THEN outlier_flags
                   ELSE COALESCE(outlier_flags, '[]'::jsonb) || ${JSON.stringify([NEWER_COPY_RETIRE_REASON])}::jsonb
                 END
           WHERE fee_verified_id = ANY(${result.retired.map((fee) => Number(fee.lineage_ref))}::bigint[])
             AND review_status IN ('verified', 'approved')
        `;
      }
      if (restoreIds.length > 0) {
        // A restore never makes an exact second copy of a fee that is live again.
        const restored = await scope<{ lineage_ref: number | string }[]>`
          UPDATE published_fee_records fp
             SET rolled_back_at = NULL,
                 rolled_back_by_batch_id = NULL,
                 rolled_back_reason = NULL
           WHERE fp.fee_published_id = ANY(${restoreIds}::bigint[])
             AND fp.rolled_back_reason LIKE ${RETIRED}
             AND NOT EXISTS (
               SELECT 1 FROM published_fee_records other
                WHERE other.rolled_back_at IS NULL
                  AND other.institution_id = fp.institution_id
                  AND other.canonical_fee_key = fp.canonical_fee_key
                  AND other.amount IS NOT DISTINCT FROM fp.amount
                  AND other.fee_name = fp.fee_name
             )
          RETURNING fp.lineage_ref
        `;
        result.restored = restored.length;
        if (restored.length > 0) {
          await scope`
            UPDATE verified_fee_observations
               SET review_status = 'verified',
                   outlier_flags = outlier_flags - ${NEWER_COPY_RETIRE_REASON}
             WHERE fee_verified_id = ANY(${restored.map((row) => Number(row.lineage_ref))}::bigint[])
               AND review_status = 'rejected'
               AND outlier_flags ? ${NEWER_COPY_RETIRE_REASON}
          `;
        }
      }
      for (const doc of documents) {
        await recordAttempt(scope, {
          institutionId: doc.institutionId,
          sourceDocumentId: doc.olderDocumentId,
          stage: "publish",
          strategy: NEWER_COPY_STRATEGY.strategy,
          version: NEWER_COPY_STRATEGY.version,
          fingerprint: newerCopyFingerprint(doc.olderDocumentId, doc.newerDocumentId, live),
          outcome: !doc.recognized ? "wrong_document" : doc.retire.length > 0 ? "ok_partial" : "ok",
          yieldCount: doc.stillStated,
          costMicrousd: 0,
          runId: options.runId,
          detail: {
            newer_document_id: doc.newerDocumentId,
            live,
            recognized: doc.recognized,
            still_stated: doc.stillStated,
            still_named: doc.stillNamed,
            dropped: doc.dropped,
            unproven: doc.unproven,
            retired: doc.retire.length,
            restored: doc.restore.length,
          },
        });
      }
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.newer_copy_check', 'completed',
          ${`${live ? "" : "Shadow run, no fee changed. "}Checked ${result.documentsChecked} older document(s) against their newest copy: ${result.stillStated} fee(s) still stated, ${result.stillNamed} still named but not read at their price (kept), ${result.retired.length} ${live ? "retired" : "would be retired"} (line gone), ${result.restored} ${live ? "restored" : "would be restored"}, ${result.unrecognized} newer cop(ies) not recognizably the same schedule`},
          ${JSON.stringify({
            batch_id: options.batchId,
            live,
            documents_checked: result.documentsChecked,
            unrecognized: result.unrecognized,
            still_stated: result.stillStated,
            still_named: result.stillNamed,
            retired: result.retired.length,
            restored: result.restored,
            samples: result.retired.slice(0, 20).map((fee) => ({
              fee_published_id: Number(fee.fee_published_id),
              institution_id: Number(fee.institution_id),
              older_document_id: Number(fee.source_document_id),
              newer_document_id: Number(fee.newer_document_id),
              canonical_fee_key: fee.canonical_fee_key,
              fee_name: fee.fee_name,
              amount: fee.amount == null ? null : Number(fee.amount),
            })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("retireFeesDroppedFromNewerCopy write failed:", error);
    return { ...result, retired: [], restored: 0 };
  }
  if (change && (result.retired.length > 0 || result.restored > 0)) invalidatePublicReadCache();
  return result;
}
