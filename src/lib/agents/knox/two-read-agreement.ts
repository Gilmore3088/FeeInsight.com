import type { sql } from "@/lib/data-store/connection";
import { sameEquivalentCategory } from "@/lib/agents/knox/category-equivalence";
import { inSavepoint, inSavepointOrTransaction } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Knox's two-read agreement (Pipeline wiring audit, Nov 2, gap 4). Until v1 nothing read a
 * document twice and sent a disagreement to review: the paid pass's comparison with the free team
 * (`paid-find-misses.ts`) only counts, and writes nothing. Where two independent reads of one
 * current text exist, this check compares them, and a fee the two reads disagree on is held before
 * Darwin publishes it.
 *
 * The two reads are the free team's raw rows (rules + specialists) and the paid pass's raw rows
 * (`knox_paid_extraction`) that carry the same document and the same `text_hash=` in their note:
 * two readers, one text. No new read is bought: the check only compares rows already written.
 * Deterministic, no provider call. Rosetta's PDF reader agreement (#2553) compares two readings of
 * the file, not two reads of its fees, so it is not one of the two reads here.
 *
 * Pairing. A paid row and a free row read the same printed line when their stored excerpts, folded
 * (lowercase, every run of other characters one space), are equal, or the shorter, at least
 * `TWO_READ_MIN_CONTAINED_CHARS` long, sits inside the longer. A shorter one may not: "Fees &
 * Charges / $5.00" sits inside every row of that bank's table.
 *
 * Verdicts, per pair of rows on one line. "Same category" means equal under the shared
 * `EQUIVALENT_CATEGORIES` (`category-equivalence.ts`, the answer-key gate's map): since v2 a minimum
 * balance fee and a monthly maintenance fee are one category ("$10 fee if balance below $1,000").
 * - `agree`: same category, same amount. Both rows are recorded as agreeing.
 * - `category`: same amount, another category ("Accounts will be charged the standard Overdraft fee
 *   of $32.00" read as overdraft by one reader and NSF by the other).
 * - `amount`: same category, another amount, and the rows do not name two different accounts
 *   (`product_name`): "Monthly fee | $3 | None | $10 | $5" read for two accounts is two fees.
 * - A pair with another category and another amount is two fees on one line: no verdict.
 * A row with an agreeing partner is never in a disagreement: a line read for two fees at one price
 * ("Overdraft/NSF fee $20") agrees on each.
 *
 * Holding. A row in a disagreement that is still waiting for Darwin (`needs_darwin_verification`,
 * no verified row) is held: that flag comes off and `knox_review:two_read_disagreement` goes on.
 * Both rows of the pair are held, since neither read is known to be right; a person, or the next
 * read of the page, settles it; a held row Knox's insert takeover sent back to Darwin is held again.
 * A held row whose disagreement no longer stands (its partner was retired, or a re-read agreed) is
 * released: the hold flag comes off and the row goes back to
 * Darwin, unless it carries another `knox_review:*` hold, which stays. A row already verified or live
 * is never changed here, not even by the agreement flag; live fees in a disagreement are
 * counted on the event (no takedown: see the finding 2026-11-02-knox-two-read-agreement.md).
 *
 * The switch `KNOX_TWO_READ_AGREEMENT_LIVE` (1 or true) turns holding, releasing and the agreement
 * flag on. Off, or in a dry-run run, the step only reports: one `knox.two_read_agreement` event with
 * the counts and samples, and no row changes.
 */
export const TWO_READ_AGREEMENT_STRATEGY = { strategy: "knox.two_read_agreement", version: 2 } as const;
export const TWO_READ_AGREEMENT_SWITCH = "KNOX_TWO_READ_AGREEMENT_LIVE";
export const TWO_READ_AGREEMENT_EVENT = "knox.two_read_agreement";
/** The held shape (`knox_review:<shape>`, held-queue.ts). */
export const TWO_READ_HOLD_SHAPE = "two_read_disagreement";
export const TWO_READ_HOLD_FLAG = `knox_review:${TWO_READ_HOLD_SHAPE}`;
/** The evidence flag on both rows of an agreeing pair. */
export const TWO_READ_AGREED_FLAG = "knox_two_read_agreed";
export const TWO_READ_MIN_EXCERPT_CHARS = 8;
export const TWO_READ_MIN_CONTAINED_CHARS = 24;
/** Documents compared per step. */
export const TWO_READ_DOCUMENT_LIMIT = 200;
const SAMPLE_LIMIT = 20;
const SUPERSEDED_FLAGS = ["superseded_by_reread", "superseded_by_newer_copy"];

/** The switch reads on for "1" or "true", allowing for stray spaces, quotes and capitals. */
export function twoReadAgreementLive(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[TWO_READ_AGREEMENT_SWITCH];
  if (raw == null) return false;
  const value = raw.trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase();
  return value === "1" || value === "true";
}

export interface TwoReadRow {
  fee_raw_id: number | string;
  institution_id: number | string;
  source_document_id: number | string;
  paid: boolean;
  fee_name: string | null;
  amount: number | string | null;
  /** The note's `canonical_hint=`. */
  category: string | null;
  /** The note's `excerpt="..."`. */
  excerpt: string | null;
  product_name: string | null;
  /** Still waiting for Darwin: `needs_darwin_verification` and no verified row. */
  pending: boolean;
  /** Has a verified row. */
  verified: boolean;
  /** Its verified row is published and not rolled back or quarantined. */
  live: boolean;
  /** Carries `knox_review:two_read_disagreement`. */
  held: boolean;
  /** Carries `knox_two_read_agreed`. */
  agreed: boolean;
  /**
   * Carries another `knox_review:*` hold (Knox's promotion re-check withdrew it as unclassified, say).
   * Such a row is no filed read: it is compared with nothing and never released by this check.
   */
  other_hold?: boolean;
}

export type TwoReadDisagreementKind = "category" | "amount";

export interface TwoReadDisagreement {
  kind: TwoReadDisagreementKind;
  sourceDocumentId: number;
  institutionId: number;
  paid: { feeRawId: number; feeName: string; amount: number; category: string };
  free: { feeRawId: number; feeName: string; amount: number; category: string };
  excerpt: string;
}

export interface TwoReadPlan {
  documents: number;
  /** Documents with at least one paid and one free row. */
  documentsWithTwoReads: number;
  paidRows: number;
  freeRows: number;
  /** Paid rows with a free row on the same line. */
  paidPaired: number;
  /** Paid rows with an agreeing free row. */
  paidAgreed: number;
  /** Paid rows in a disagreement. */
  paidDisagreed: number;
  disagreements: TwoReadDisagreement[];
  byKind: Record<TwoReadDisagreementKind, number>;
  /** Rows to hold: in a disagreement, pending, not yet held. */
  hold: number[];
  /** Held rows whose disagreement no longer stands. */
  release: number[];
  /** Rows of an agreeing pair not yet flagged. */
  agree: number[];
  /** Rows in a disagreement whose verified row is live (counted, never changed here). */
  liveInDisagreement: number[];
  /** Rows in a disagreement already verified but not live (counted, never changed here). */
  verifiedInDisagreement: number[];
}

/** An excerpt folded for comparison: lowercase, every run of other characters one space. */
export function foldExcerpt(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9$.]+/g, " ").trim();
}

/** The two folded excerpts are one printed line. Pure. */
export function sameReadLine(a: string, b: string): boolean {
  if (a.length < TWO_READ_MIN_EXCERPT_CHARS || b.length < TWO_READ_MIN_EXCERPT_CHARS) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= TWO_READ_MIN_CONTAINED_CHARS && longer.includes(shorter);
}

function money(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function product(value: string | null): string | null {
  const folded = value?.trim().toLowerCase();
  return folded ? folded : null;
}

interface Comparable {
  row: TwoReadRow;
  id: number;
  amount: number;
  category: string;
  line: string;
}

function comparable(row: TwoReadRow): Comparable | null {
  const amount = money(row.amount);
  const line = foldExcerpt(row.excerpt);
  if (row.other_hold || amount == null || !row.category || line.length < TWO_READ_MIN_EXCERPT_CHARS) return null;
  return { row, id: Number(row.fee_raw_id), amount, category: row.category, line };
}

/** The verdict for one pair on one line; null for two fees on one line. Pure. */
export function pairVerdict(
  paid: Pick<Comparable, "amount" | "category"> & { product: string | null },
  free: Pick<Comparable, "amount" | "category"> & { product: string | null },
): "agree" | TwoReadDisagreementKind | null {
  const sameAmount = paid.amount === free.amount;
  // v2: categories equal under the shared equivalence (minimum balance = monthly maintenance, as
  // the answer-key gate counts them) are one category: "$10 fee if balance below $1,000" is one fee.
  const sameCategory = sameEquivalentCategory(paid.category, free.category);
  if (sameAmount && sameCategory) return "agree";
  if (sameAmount) return "category";
  if (sameCategory && paid.product === free.product) return "amount";
  return null;
}

/**
 * Pure: compares the paid and free rows of each document. `rows` are the filed rows of current
 * texts: a category, a dollar amount and an excerpt, not retired, and either waiting for Darwin,
 * verified, or held by this check.
 */
export function planTwoReadAgreement(rows: readonly TwoReadRow[]): TwoReadPlan {
  const byDocument = new Map<number, Comparable[]>();
  const documents = new Set<number>();
  for (const row of rows) {
    documents.add(Number(row.source_document_id));
    const item = comparable(row);
    if (!item) continue;
    const list = byDocument.get(Number(row.source_document_id)) ?? [];
    list.push(item);
    byDocument.set(Number(row.source_document_id), list);
  }
  const plan: TwoReadPlan = {
    documents: documents.size,
    documentsWithTwoReads: 0,
    paidRows: 0,
    freeRows: 0,
    paidPaired: 0,
    paidAgreed: 0,
    paidDisagreed: 0,
    disagreements: [],
    byKind: { category: 0, amount: 0 },
    hold: [],
    release: [],
    agree: [],
    liveInDisagreement: [],
    verifiedInDisagreement: [],
  };
  const inDisagreement = new Set<number>();
  const agreeing = new Set<number>();
  const all: Comparable[] = [];
  for (const [documentId, items] of [...byDocument.entries()].sort((a, b) => a[0] - b[0])) {
    const paid = items.filter((item) => item.row.paid).sort((a, b) => a.id - b.id);
    const free = items.filter((item) => !item.row.paid).sort((a, b) => a.id - b.id);
    plan.paidRows += paid.length;
    plan.freeRows += free.length;
    all.push(...items);
    if (paid.length === 0 || free.length === 0) continue;
    plan.documentsWithTwoReads += 1;
    const pairs: Array<{ p: Comparable; f: Comparable; verdict: ReturnType<typeof pairVerdict> }> = [];
    for (const p of paid) {
      for (const f of free) {
        if (!sameReadLine(p.line, f.line)) continue;
        pairs.push({ p, f, verdict: pairVerdict({ ...p, product: product(p.row.product_name) }, { ...f, product: product(f.row.product_name) }) });
      }
    }
    for (const pair of pairs) {
      if (pair.verdict === "agree") {
        agreeing.add(pair.p.id);
        agreeing.add(pair.f.id);
      }
    }
    const pairedPaid = new Set(pairs.map((pair) => pair.p.id));
    plan.paidPaired += pairedPaid.size;
    plan.paidAgreed += paid.filter((p) => agreeing.has(p.id)).length;
    const disagreedPaid = new Set<number>();
    for (const pair of pairs) {
      if (pair.verdict !== "category" && pair.verdict !== "amount") continue;
      // A row that agrees with any read of the other reader is not in a disagreement.
      if (agreeing.has(pair.p.id) || agreeing.has(pair.f.id)) continue;
      disagreedPaid.add(pair.p.id);
      inDisagreement.add(pair.p.id);
      inDisagreement.add(pair.f.id);
      plan.byKind[pair.verdict] += 1;
      plan.disagreements.push({
        kind: pair.verdict,
        sourceDocumentId: documentId,
        institutionId: Number(pair.p.row.institution_id),
        paid: { feeRawId: pair.p.id, feeName: pair.p.row.fee_name ?? "", amount: pair.p.amount, category: pair.p.category },
        free: { feeRawId: pair.f.id, feeName: pair.f.row.fee_name ?? "", amount: pair.f.amount, category: pair.f.category },
        excerpt: (pair.p.line.length <= pair.f.line.length ? pair.p.row.excerpt : pair.f.row.excerpt)?.slice(0, 200) ?? "",
      });
    }
    plan.paidDisagreed += disagreedPaid.size;
  }
  for (const item of all.sort((a, b) => a.id - b.id)) {
    const { row, id } = item;
    if (inDisagreement.has(id)) {
      // A held row Knox's insert takeover sent back to Darwin (`needs_darwin_verification` again, the
      // hold flag kept) is pending once more: hold it again.
      if (row.pending) plan.hold.push(id);
      else if (row.live) plan.liveInDisagreement.push(id);
      else if (row.verified) plan.verifiedInDisagreement.push(id);
    } else if (row.held && !row.verified && !row.other_hold) {
      plan.release.push(id);
    }
    // Evidence goes on unverified rows only: this check never changes a verified or live row.
    if (agreeing.has(id) && !row.agreed && !row.verified) plan.agree.push(id);
  }
  return plan;
}

export interface TwoReadAgreementResult {
  /** The switch is on. */
  live: boolean;
  /** Nothing written to rows: the switch is off or the run is a dry run. */
  dryRun: boolean;
  plan: TwoReadPlan;
  held: number[];
  released: number[];
  agreedFlagged: number[];
  error: string | null;
}

const EMPTY_PLAN = (): TwoReadPlan => planTwoReadAgreement([]);

/** The step detail: counts and the first disagreements, never the source text. */
export function twoReadAgreementDetail(result: TwoReadAgreementResult) {
  const { plan } = result;
  return {
    version: TWO_READ_AGREEMENT_STRATEGY.version,
    live: result.live,
    dry_run: result.dryRun,
    documents: plan.documents,
    documents_with_two_reads: plan.documentsWithTwoReads,
    paid_rows: plan.paidRows,
    free_rows: plan.freeRows,
    paid_paired: plan.paidPaired,
    paid_agreed: plan.paidAgreed,
    paid_disagreed: plan.paidDisagreed,
    disagreements_by_kind: plan.byKind,
    would_hold: plan.hold.length,
    would_release: plan.release.length,
    would_flag_agreed: plan.agree.length,
    held: result.held.length,
    released: result.released.length,
    agreed_flagged: result.agreedFlagged.length,
    live_in_disagreement: plan.liveInDisagreement.length,
    verified_in_disagreement: plan.verifiedInDisagreement.length,
    live_in_disagreement_ids: plan.liveInDisagreement.slice(0, SAMPLE_LIMIT),
    error: result.error,
    samples: plan.disagreements.slice(0, SAMPLE_LIMIT).map((item) => ({
      kind: item.kind,
      source_document_id: item.sourceDocumentId,
      institution_id: item.institutionId,
      paid: { fee_raw_id: item.paid.feeRawId, fee_name: item.paid.feeName, amount: item.paid.amount, category: item.paid.category },
      free: { fee_raw_id: item.free.feeRawId, fee_name: item.free.feeName, amount: item.free.amount, category: item.free.category },
      excerpt: item.excerpt,
    })),
  };
}

/** One sentence for a step summary; empty when nothing had two reads. */
export function twoReadAgreementNote(result: TwoReadAgreementResult): string {
  const { plan } = result;
  if (plan.documentsWithTwoReads === 0 && plan.release.length === 0 && result.released.length === 0) return "";
  const mode = result.dryRun ? (result.live ? "dry run" : "switch off, nothing written") : "live";
  const held = result.dryRun ? `${plan.hold.length.toLocaleString()} would be held` : `${result.held.length.toLocaleString()} held, ${result.released.length.toLocaleString()} released`;
  return ` Two-read agreement (${mode}): on ${plan.documentsWithTwoReads.toLocaleString()} texts read by both the free and the paid reader, ${plan.paidAgreed.toLocaleString()} of ${plan.paidPaired.toLocaleString()} paired paid fees agree and ${plan.paidDisagreed.toLocaleString()} disagree (${plan.byKind.category.toLocaleString()} on category, ${plan.byKind.amount.toLocaleString()} on amount); ${held}, ${plan.liveInDisagreement.length.toLocaleString()} live fees in a disagreement counted.`;
}

function scopeSql(options: { institutionId: number | null; stateCode: string | null; documentIds: number[] | null }): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const parts: string[] = [];
  if (options.documentIds) {
    params.push(options.documentIds);
    parts.push(`fr.source_document_id = ANY($${params.length}::bigint[])`);
  }
  if (options.institutionId != null) {
    params.push(options.institutionId);
    parts.push(`fr.institution_id = $${params.length}::bigint`);
  }
  if (options.stateCode) {
    params.push(options.stateCode);
    parts.push(`upper(btrim(inst.state_code)) = $${params.length}::text`);
  }
  return { text: parts.map((part) => `AND ${part}`).join("\n"), params };
}

/**
 * The filed rows of each current text that both readers read. A text is current when it is its
 * document's latest completed text and the document has no newer copy. Exported for the finding's
 * dry run.
 */
export function twoReadRowsSql(scope: string, limitParam: string): string {
  const superseded = SUPERSEDED_FLAGS.map((flag) => `'${flag}'`).join(", ");
  return `
    WITH paid_docs AS (
      SELECT fr.source_document_id, max(fr.fee_raw_id) AS newest
        FROM raw_fee_observations fr
        JOIN institution_sources inst ON inst.id = fr.institution_id
        JOIN source_documents sd ON sd.id = fr.source_document_id AND sd.superseded_by_id IS NULL
       WHERE fr.source = 'knox'
         AND fr.outlier_flags ? 'knox_paid_extraction'
         AND NOT (COALESCE(fr.outlier_flags, '[]'::jsonb) ?| array[${superseded}])
         ${scope}
       GROUP BY fr.source_document_id
    ), docs AS (
      -- Only documents with a row this check can still move: one waiting for Darwin with no
      -- verified row (a verified row keeps \`needs_darwin_verification\`, so the flag alone is not
      -- enough), or one it holds. Documents with a waiting row come first, newest paid read first,
      -- so a lane's limit goes to the reads Darwin has not judged yet.
      SELECT paid_docs.source_document_id
        FROM paid_docs
        JOIN LATERAL (
          SELECT bool_or(work.outlier_flags ? 'needs_darwin_verification'
                         AND NOT EXISTS (SELECT 1 FROM verified_fee_observations wv WHERE wv.fee_raw_id = work.fee_raw_id)) AS waiting,
                 bool_or(work.outlier_flags ? '${TWO_READ_HOLD_FLAG}') AS held
            FROM raw_fee_observations work
           WHERE work.source_document_id = paid_docs.source_document_id
             AND work.source = 'knox'
        ) work ON work.waiting OR work.held
       ORDER BY work.waiting DESC, paid_docs.newest DESC, paid_docs.source_document_id
       LIMIT ${limitParam}
    ), cur AS (
      SELECT docs.source_document_id, txt.text_hash
        FROM docs
        JOIN LATERAL (
          SELECT t.text_hash FROM agent_source_texts t
           WHERE t.source_document_id = docs.source_document_id
             AND t.status = 'completed' AND t.text_hash IS NOT NULL
           ORDER BY t.id DESC LIMIT 1
        ) txt ON true
    )
    SELECT fr.fee_raw_id, fr.institution_id, fr.source_document_id,
           fr.outlier_flags ? 'knox_paid_extraction' AS paid,
           fr.fee_name, fr.amount, fr.product_name,
           substring(COALESCE(fr.extraction_note, fr.conditions) FROM 'canonical_hint=([a-z_]+)') AS category,
           substring(COALESCE(fr.extraction_note, fr.conditions) FROM 'excerpt="(.*)"\\s*$') AS excerpt,
           (fr.outlier_flags ? 'needs_darwin_verification' AND fv.fee_verified_id IS NULL) AS pending,
           (fv.fee_verified_id IS NOT NULL) AS verified,
           COALESCE(live.is_live, false) AS live,
           fr.outlier_flags ? '${TWO_READ_HOLD_FLAG}' AS held,
           fr.outlier_flags ? '${TWO_READ_AGREED_FLAG}' AS agreed,
           EXISTS (
             SELECT 1 FROM jsonb_array_elements_text(COALESCE(fr.outlier_flags, '[]'::jsonb)) other
              WHERE other LIKE 'knox_review:%' AND other <> '${TWO_READ_HOLD_FLAG}'
           ) AS other_hold
      FROM cur
      JOIN raw_fee_observations fr
        ON fr.source_document_id = cur.source_document_id
       AND position(('text_hash=' || cur.text_hash || ';') IN COALESCE(fr.extraction_note, fr.conditions, '')) > 0
      LEFT JOIN LATERAL (
        SELECT v.fee_verified_id FROM verified_fee_observations v
         WHERE v.fee_raw_id = fr.fee_raw_id ORDER BY v.fee_verified_id DESC LIMIT 1
      ) fv ON true
      LEFT JOIN LATERAL (
        SELECT true AS is_live FROM published_fee_records fp
         WHERE fp.lineage_ref = fv.fee_verified_id AND fp.rolled_back_at IS NULL AND fp.quarantined_at IS NULL
         LIMIT 1
      ) live ON true
     WHERE fr.source = 'knox'
       AND fr.amount IS NOT NULL
       AND NOT (COALESCE(fr.outlier_flags, '[]'::jsonb) ?| array[${superseded}])
       -- Filed rows only: another hold was never sent to Darwin, so it is no read to compare.
       AND (
         fr.outlier_flags ? '${TWO_READ_HOLD_FLAG}'
         OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(fr.outlier_flags, '[]'::jsonb)) flag WHERE flag LIKE 'knox_review:%')
       )
     ORDER BY fr.source_document_id, fr.fee_raw_id
  `;
}

export async function checkTwoReadAgreement(
  db: SqlTag,
  options: {
    runId: number;
    stepId?: number | null;
    dryRun: boolean;
    institutionId?: number | null;
    stateCode?: string | null;
    /** The paid step passes the documents it just read. */
    sourceDocumentIds?: number[] | null;
    documentLimit?: number;
    /** Overrides the env switch (tests). */
    live?: boolean;
  },
): Promise<TwoReadAgreementResult> {
  const live = options.live ?? twoReadAgreementLive();
  const dryRun = options.dryRun || !live;
  const base: TwoReadAgreementResult = { live, dryRun, plan: EMPTY_PLAN(), held: [], released: [], agreedFlagged: [], error: null };
  const institutionId = options.institutionId ?? null;
  const stateCode = options.stateCode?.trim().toUpperCase() || null;
  const documentIds = options.sourceDocumentIds ? [...new Set(options.sourceDocumentIds.map(Number).filter(Number.isFinite))] : null;
  // Scoped like Knox's other backlog passes: one bank, one state lane, or the documents just read.
  if (institutionId == null && stateCode == null && documentIds == null) return base;
  if (documentIds && documentIds.length === 0) return base;
  const limit = Math.max(1, Math.min(options.documentLimit ?? TWO_READ_DOCUMENT_LIMIT, TWO_READ_DOCUMENT_LIMIT));

  let rows: TwoReadRow[];
  try {
    const scope = scopeSql({ institutionId, stateCode, documentIds });
    rows = await inSavepoint(db, (tx) => tx.unsafe<TwoReadRow[]>(twoReadRowsSql(scope.text, `$${scope.params.length + 1}`), [...scope.params, limit] as never[]));
  } catch (error) {
    // A failed check must never block the extract step.
    console.error("checkTwoReadAgreement select failed:", error);
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
  const plan = planTwoReadAgreement(rows);
  const result: TwoReadAgreementResult = { ...base, plan };
  // A dry-run run writes nothing at all; a step with the switch off still writes its report.
  if (options.dryRun || (plan.documentsWithTwoReads === 0 && plan.release.length === 0)) return result;

  try {
    await inSavepointOrTransaction(db, async (tx) => {
      if (!dryRun) {
        if (plan.hold.length > 0) {
          const held = await tx<{ fee_raw_id: number | string }[]>`
            UPDATE raw_fee_observations fr
               SET outlier_flags = (COALESCE(fr.outlier_flags, '[]'::jsonb) - 'needs_darwin_verification' - ${TWO_READ_HOLD_FLAG}::text)
                                   || ${JSON.stringify([TWO_READ_HOLD_FLAG])}::jsonb
             WHERE fr.fee_raw_id = ANY(${plan.hold}::bigint[])
               AND fr.outlier_flags ? 'needs_darwin_verification'
               AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
            RETURNING fr.fee_raw_id
          `;
          result.held = held.map((row) => Number(row.fee_raw_id));
        }
        if (plan.release.length > 0) {
          const released = await tx<{ fee_raw_id: number | string }[]>`
            UPDATE raw_fee_observations fr
               SET outlier_flags = (COALESCE(fr.outlier_flags, '[]'::jsonb) - ${TWO_READ_HOLD_FLAG}::text - 'needs_darwin_verification')
                                   || '["needs_darwin_verification"]'::jsonb
             WHERE fr.fee_raw_id = ANY(${plan.release}::bigint[])
               AND fr.outlier_flags ? ${TWO_READ_HOLD_FLAG}
               -- A row held for another reason too stays held: only this check's hold comes off.
               AND NOT EXISTS (
                 SELECT 1 FROM jsonb_array_elements_text(COALESCE(fr.outlier_flags, '[]'::jsonb)) other
                  WHERE other LIKE 'knox_review:%' AND other <> ${TWO_READ_HOLD_FLAG}
               )
               AND NOT (COALESCE(fr.outlier_flags, '[]'::jsonb) ?| ${SUPERSEDED_FLAGS}::text[])
               AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
            RETURNING fr.fee_raw_id
          `;
          result.released = released.map((row) => Number(row.fee_raw_id));
        }
        if (plan.agree.length > 0) {
          const agreed = await tx<{ fee_raw_id: number | string }[]>`
            UPDATE raw_fee_observations fr
               SET outlier_flags = COALESCE(fr.outlier_flags, '[]'::jsonb) || ${JSON.stringify([TWO_READ_AGREED_FLAG])}::jsonb
             WHERE fr.fee_raw_id = ANY(${plan.agree}::bigint[])
               AND NOT (COALESCE(fr.outlier_flags, '[]'::jsonb) ? ${TWO_READ_AGREED_FLAG})
               AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
            RETURNING fr.fee_raw_id
          `;
          result.agreedFlagged = agreed.map((row) => Number(row.fee_raw_id));
        }
      }
      const detail = twoReadAgreementDetail(result);
      await tx`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${TWO_READ_AGREEMENT_EVENT}, 'completed',
          ${twoReadAgreementNote(result).trim()},
          ${JSON.stringify(detail)}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("checkTwoReadAgreement write failed:", error);
    return { ...result, held: [], released: [], agreedFlagged: [], error: error instanceof Error ? error.message : String(error) };
  }
  return result;
}
