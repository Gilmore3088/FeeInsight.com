/**
 * Layout recheck (#2219): a measured, record-only dry run of what today's PDF reader would change
 * for the live fees on texts an older layout version read.
 *
 * Stored `read.pdf_layout` texts are re-read only in narrow cases (the prose interleave witness,
 * the stacked-repair witness), so thousands of texts still carry an older layout's reading. Before
 * anyone re-reads them, each read step takes up to `LAYOUT_RECHECK_PER_RUN` of them (newest texts
 * first), reads the exact vault bytes again with the current layout, and runs the one shared
 * source check on both texts for every live fee on that document. One `agent_run_events` row per
 * document is the whole output: no stored text, attempt, playbook or fee row is written, so this
 * never makes a text due for re-reading or changes what is published.
 */
import { createHash } from "crypto";

import type { sql } from "@/lib/data-store/connection";
import type { DocumentVault } from "@/lib/agents/document-vault";
import { detectFormat, isLikelyScannedPdf } from "@/lib/agents/learning/format";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import { statedInOwnSource } from "@/lib/agents/darwin/verify";
import { refileCategory } from "@/lib/fee-category-guard";
import { LAYOUT_RECHECK_VERSION, PDF_LAYOUT_VERSION } from "./reader-versions";
import type { PdfTextExtraction } from "./pdf-document-text";
import { textSha256 } from "./pdf-repair-survival";
import { loadDocumentBytes, normalizeWhitespace, hashText } from "./read";

type SqlTag = typeof sql;

export { LAYOUT_RECHECK_VERSION };
export const LAYOUT_RECHECK_EVENT = "rosetta.layout_recheck";
/** Documents re-checked per read step, at most. Bounded free local work; no download. */
export const LAYOUT_RECHECK_PER_RUN = 3;
/** Fee examples kept on each receipt for sampling (lost and gained first). */
export const LAYOUT_RECHECK_MAX_EXAMPLES = 20;
const PDF_LAYOUT_READER = "read.pdf_layout";

export type LayoutRecheckClass = "supported_both" | "lost" | "gained" | "unsupported_both";
export type LayoutRecheckOutcome = "compared" | "unavailable" | "extract_failed" | "needs_ocr" | "not_pdf";

export interface LayoutRecheckCandidate {
  source_text_id: number | string;
  source_document_id: number | string;
  institution_id: number | string;
  source_hash: string;
  text_hash: string;
  read_layout_version: number | string;
  live_fees: number | string;
  document_url: string | null;
  document_r2_key: string | null;
  content_type: string | null;
  normalized_text: string;
}

export interface LayoutRecheckFeeRow {
  fee_published_id: number | string;
  published_amount: number | string | null;
  canonical_fee_key: string;
  verified_amount: number | string | null;
  fee_name: string;
  amount: number | string | null;
  source_document_id: number | string;
  amount_kind: string | null;
  rate_percent: number | string | null;
  product_name: string | null;
  outlier_flags: unknown;
}

export interface LayoutRecheckDocument {
  outcome: LayoutRecheckOutcome;
  sourceTextId: number;
  sourceDocumentId: number;
  textChanged: boolean | null;
  counts: Record<LayoutRecheckClass, number>;
}

export interface LayoutRecheckResult {
  ready: boolean;
  selected: number;
  /** Documents whose old and new texts were compared. */
  rechecked: number;
  /** Receipts with no comparison: bytes unavailable or mismatched, not a text PDF, extraction failed. */
  notCompared: number;
  textChanged: number;
  supportedBoth: number;
  lost: number;
  gained: number;
  unsupportedBoth: number;
  documents: LayoutRecheckDocument[];
}

export interface LayoutRecheckOptions {
  runId: number;
  stepId?: number | null;
  institutionId?: number;
  stateCode?: string;
  limit?: number;
  vault: DocumentVault | null;
  pdfTextExtractor: (bytes: Uint8Array) => Promise<PdfTextExtraction>;
}

const emptyCounts = (): Record<LayoutRecheckClass, number> => ({ supported_both: 0, lost: 0, gained: 0, unsupported_both: 0 });

export function emptyLayoutRecheckResult(): LayoutRecheckResult {
  return { ready: false, selected: 0, rechecked: 0, notCompared: 0, textChanged: 0, supportedBoth: 0, lost: 0, gained: 0, unsupportedBoth: 0, documents: [] };
}

/**
 * Current-copy, vault-backed `read.pdf_layout` texts last read below the current layout, with at
 * least one live published fee and no receipt for this text hash at this layout and protocol.
 * Each stage is materialized so the costly ones run on the survivors of the cheap ones: the
 * receipt set (event_type index) once, the text/document join (primary keys), the per-text read
 * layout version (pipeline_attempts input_fingerprint index). Newest texts go first and the
 * live-fee count runs per text (raw institution index, then primary keys) only until the batch
 * is full: ranking every older text by live fees took about 20s on prod (Oct 25), this about 3s.
 */
export function layoutRecheckQuery(
  limit: number,
  scope: { institutionId?: number; stateCode?: string } = {},
): { query: string; params: Array<number | string> } {
  const params: Array<number | string> = [limit, PDF_LAYOUT_READER, PDF_LAYOUT_VERSION, LAYOUT_RECHECK_EVENT, LAYOUT_RECHECK_VERSION];
  const filters: string[] = [];
  let stateJoin = "";
  if (scope.institutionId) {
    params.push(scope.institutionId);
    filters.push(`AND adt.institution_id = $${params.length}`);
  }
  const state = normalizeStateCode(scope.stateCode);
  if (state) {
    params.push(state);
    stateJoin = "JOIN institution_sources ct ON ct.id = adt.institution_id";
    filters.push(`AND upper(btrim(ct.state_code)) = $${params.length}`);
  }
  return {
    query: `
      WITH receipted AS MATERIALIZED (
        SELECT DISTINCT e.detail->>'source_text_id' AS source_text_id, e.detail->>'text_hash' AS text_hash
          FROM agent_run_events e
         WHERE e.event_type = $4
           AND e.detail->>'pdf_layout_version' = $3::text
           AND e.detail->>'protocol_version' = $5::text
      ),
      texts AS MATERIALIZED (
        SELECT adt.id, adt.source_document_id, adt.institution_id, adt.source_hash, adt.text_hash,
               cr.document_url, cr.document_r2_key, cr.content_type
          FROM agent_source_texts adt
          JOIN source_documents cr ON cr.id = adt.source_document_id
          ${stateJoin}
         WHERE adt.status = 'completed'
           AND adt.reader = $2
           AND adt.source_hash IS NOT NULL
           AND adt.text_hash IS NOT NULL
           AND cr.status = 'success'
           AND cr.content_hash = adt.source_hash
           AND cr.superseded_by_id IS NULL AND cr.duplicate_of_id IS NULL
           AND cr.document_r2_key = left(cr.content_hash, 2) || '/' || cr.content_hash
           ${filters.join("\n           ")}
           AND NOT EXISTS (
             SELECT 1 FROM receipted rc
              WHERE rc.source_text_id = adt.id::text AND rc.text_hash = adt.text_hash
           )
      ),
      below AS MATERIALIZED (
        SELECT t.*, read_layout.version AS read_layout_version
          FROM texts t
          CROSS JOIN LATERAL (
            SELECT COALESCE(MAX(COALESCE((pa.detail->>'pdf_layout')::int, 1)), 1) AS version
              FROM pipeline_attempts pa
             WHERE pa.input_fingerprint = t.source_hash
               AND pa.strategy = $2
               AND pa.stage = 'read'
               AND pa.institution_id = t.institution_id
          ) read_layout
         WHERE read_layout.version < $3
         ORDER BY t.id DESC
      ),
      picked AS (
        SELECT b.id AS source_text_id, b.source_document_id, b.institution_id, b.source_hash, b.text_hash,
               b.read_layout_version, live.live_fees, b.document_url, b.document_r2_key, b.content_type
          FROM below b -- newest first; no outer sort, so the LIMIT stops the per-text counts early
          CROSS JOIN LATERAL (
            SELECT COUNT(*)::int AS live_fees
              FROM raw_fee_observations r
              JOIN verified_fee_observations v ON v.fee_raw_id = r.fee_raw_id
              JOIN published_fee_records p ON p.lineage_ref = v.fee_verified_id
             WHERE r.institution_id = b.institution_id
               AND r.source_document_id = b.source_document_id
               AND p.rolled_back_at IS NULL AND p.quarantined_at IS NULL
          ) live
         WHERE live.live_fees > 0
         LIMIT $1
      )
      SELECT picked.*, adt.normalized_text
        FROM picked
        JOIN agent_source_texts adt ON adt.id = picked.source_text_id AND adt.text_hash = picked.text_hash
       ORDER BY picked.source_text_id DESC
    `,
    params,
  };
}

/** Every live published fee on the document, with Darwin's live re-check inputs. */
async function liveFees(db: SqlTag, row: LayoutRecheckCandidate): Promise<LayoutRecheckFeeRow[]> {
  return db<LayoutRecheckFeeRow[]>`
    SELECT p.fee_published_id, p.amount AS published_amount, v.canonical_fee_key, v.amount AS verified_amount,
           r.fee_name, r.amount, r.source_document_id, r.amount_kind, r.rate_percent, r.product_name, r.outlier_flags
      FROM raw_fee_observations r
      JOIN verified_fee_observations v ON v.fee_raw_id = r.fee_raw_id
      JOIN published_fee_records p ON p.lineage_ref = v.fee_verified_id
     WHERE r.institution_id = ${Number(row.institution_id)}
       AND r.source_document_id = ${Number(row.source_document_id)}
       AND p.rolled_back_at IS NULL AND p.quarantined_at IS NULL
     ORDER BY p.fee_published_id
  `;
}

/**
 * Darwin's live re-check of one fee against one text: the shared `checkFeeAgainstSource` through
 * `statedInOwnSource` (category pattern ".", the refiled canonical key, the verified amount),
 * exactly as `darwin/verified-recheck.ts` reads a live fee. Pure.
 */
export function feeSupportedBy(text: string, fee: LayoutRecheckFeeRow): boolean {
  const canonicalFeeKey = refileCategory(fee.canonical_fee_key, fee.fee_name) ?? fee.canonical_fee_key;
  const documentId = Number(fee.source_document_id);
  return statedInOwnSource(
    {
      fee_name: fee.fee_name,
      amount: fee.verified_amount ?? fee.amount,
      source_document_id: documentId,
      amount_kind: fee.amount_kind,
      rate_percent: fee.rate_percent,
      product_name: fee.product_name,
      outlier_flags: fee.outlier_flags,
    },
    new Map([[documentId, text]]),
    canonicalFeeKey,
  );
}

export function classifyFee(oldText: string, newText: string, fee: LayoutRecheckFeeRow): LayoutRecheckClass {
  const before = feeSupportedBy(oldText, fee);
  const after = oldText === newText ? before : feeSupportedBy(newText, fee);
  if (before && after) return "supported_both";
  if (before) return "lost";
  if (after) return "gained";
  return "unsupported_both";
}

const EXAMPLE_ORDER: LayoutRecheckClass[] = ["lost", "gained", "unsupported_both", "supported_both"];

type NewReading =
  | { outcome: "compared"; text: string; readerDisagreements: number | null; byteIdentity: string }
  | { outcome: Exclude<LayoutRecheckOutcome, "compared">; reason: string; byteIdentity?: string };

/** The exact vault bytes, read the way `readCandidate` reads a text PDF. Never downloads. */
async function readAgain(row: LayoutRecheckCandidate, options: LayoutRecheckOptions): Promise<NewReading> {
  const loaded = await loadDocumentBytes(
    { sourceUrl: row.document_url ?? "", vaultKey: row.document_r2_key, storedContentType: row.content_type, selectedHash: row.source_hash },
    async () => new Response("Stored PDF required for the layout recheck", { status: 503 }),
    options.vault,
  );
  if (!loaded.ok) return { outcome: "unavailable", reason: loaded.error, byteIdentity: loaded.byteIdentity?.status };
  if (!loaded.fromVault || loaded.byteIdentity.status !== "verified"
    || createHash("sha256").update(loaded.bytes).digest("hex") !== row.source_hash.toLowerCase()) {
    return { outcome: "unavailable", reason: "Vault bytes are not the selected source hash", byteIdentity: loaded.byteIdentity.status };
  }
  if (detectFormat(loaded.bytes, loaded.contentType, loaded.finalUrl) !== "pdf") {
    return { outcome: "not_pdf", reason: "Stored bytes are not a PDF", byteIdentity: "verified" };
  }
  let extracted: PdfTextExtraction;
  try {
    extracted = await options.pdfTextExtractor(loaded.bytes);
  } catch (error) {
    return { outcome: "extract_failed", reason: error instanceof Error ? error.message : String(error), byteIdentity: "verified" };
  }
  const text = normalizeWhitespace(extracted.text);
  if (text.length === 0 || isLikelyScannedPdf(text, extracted.totalPages)) {
    return { outcome: "needs_ocr", reason: "The current layout reads these bytes as a scan", byteIdentity: "verified" };
  }
  // Like read.ts, the agreement receipt only describes the text it was computed on.
  const readerDisagreements = extracted.readerAgreement?.textHash === textSha256(extracted.text)
    ? extracted.readerAgreement.disagreementCount : null;
  return { outcome: "compared", text, readerDisagreements, byteIdentity: "verified" };
}

async function recordReceipt(db: SqlTag, options: LayoutRecheckOptions, message: string, status: "completed" | "skipped", detail: Record<string, unknown>) {
  await db`
    INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
    VALUES (${options.runId}, ${options.stepId ?? null}, ${LAYOUT_RECHECK_EVENT}, ${status}, ${message}, ${JSON.stringify(detail)}::jsonb)
  `;
}

/** One document: read again, classify each live fee, write one receipt. */
export async function recheckLayoutDocument(db: SqlTag, row: LayoutRecheckCandidate, options: LayoutRecheckOptions): Promise<LayoutRecheckDocument> {
  const base = {
    protocol: `${LAYOUT_RECHECK_EVENT}.v${LAYOUT_RECHECK_VERSION}`,
    protocol_version: LAYOUT_RECHECK_VERSION,
    source_text_id: Number(row.source_text_id),
    text_hash: row.text_hash,
    source_document_id: Number(row.source_document_id),
    institution_id: Number(row.institution_id),
    source_hash: row.source_hash,
    read_layout_version: Number(row.read_layout_version),
    pdf_layout_version: PDF_LAYOUT_VERSION,
    live_fees_selected: Number(row.live_fees),
  };
  const document = { sourceTextId: base.source_text_id, sourceDocumentId: base.source_document_id };
  const reading = await readAgain(row, options);
  if (reading.outcome !== "compared") {
    await recordReceipt(db, options,
      `Layout recheck of document ${base.source_document_id} not compared (${reading.outcome}): ${reading.reason}`,
      "skipped", { ...base, outcome: reading.outcome, reason: reading.reason, byte_identity: reading.byteIdentity ?? null, text_changed: null });
    return { ...document, outcome: reading.outcome, textChanged: null, counts: emptyCounts() };
  }
  const oldText = row.normalized_text;
  const textChanged = reading.text !== oldText;
  const fees = await liveFees(db, row);
  const counts = emptyCounts();
  const classified = fees.map((fee) => {
    const kind = classifyFee(oldText, reading.text, fee);
    counts[kind] += 1;
    return { fee, kind };
  });
  const examples = EXAMPLE_ORDER.flatMap((kind) => classified.filter((entry) => entry.kind === kind))
    .slice(0, LAYOUT_RECHECK_MAX_EXAMPLES)
    .map(({ fee, kind }) => ({
      fee_published_id: Number(fee.fee_published_id),
      fee_name: fee.fee_name,
      amount: fee.published_amount == null ? null : Number(fee.published_amount),
      canonical_fee_key: fee.canonical_fee_key,
      class: kind,
    }));
  await recordReceipt(db, options,
    `Layout recheck of document ${base.source_document_id} (layout v${base.read_layout_version} → v${PDF_LAYOUT_VERSION}): text ${textChanged ? "changed" : "unchanged"}; ${fees.length} live fees: ${counts.supported_both} supported both, ${counts.lost} lost, ${counts.gained} gained, ${counts.unsupported_both} unsupported both`,
    "completed", {
      ...base,
      outcome: "compared",
      byte_identity: reading.byteIdentity,
      text_changed: textChanged,
      new_text_hash: hashText(reading.text),
      chars_old: oldText.length,
      chars_new: reading.text.length,
      live_fees: fees.length,
      counts,
      reader_disagreements: reading.readerDisagreements,
      examples,
    });
  return { ...document, outcome: "compared", textChanged, counts };
}

/**
 * Up to `limit` documents per read step. Skipped without a configured vault: every text would
 * otherwise be marked unavailable for a configuration gap.
 */
export async function runLayoutRecheck(db: SqlTag, options: LayoutRecheckOptions): Promise<LayoutRecheckResult> {
  const result = emptyLayoutRecheckResult();
  if (!options.vault?.configured) return result;
  result.ready = true;
  const limit = Math.max(0, Math.floor(options.limit ?? LAYOUT_RECHECK_PER_RUN));
  if (limit === 0) return result;
  const { query, params } = layoutRecheckQuery(limit, { institutionId: options.institutionId, stateCode: options.stateCode });
  const rows = await db.unsafe<LayoutRecheckCandidate[]>(query, params);
  result.selected = rows.length;
  for (const row of rows) {
    const document = await recheckLayoutDocument(db, row, options);
    result.documents.push(document);
    if (document.outcome !== "compared") {
      result.notCompared += 1;
      continue;
    }
    result.rechecked += 1;
    if (document.textChanged) result.textChanged += 1;
    result.supportedBoth += document.counts.supported_both;
    result.lost += document.counts.lost;
    result.gained += document.counts.gained;
    result.unsupportedBoth += document.counts.unsupported_both;
  }
  return result;
}
