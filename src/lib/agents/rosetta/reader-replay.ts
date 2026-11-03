/**
 * Reader replay (#2069): when a Rosetta reader moves to a new version, every current document
 * whose stored text an older version of that reader (or the legacy reader) wrote is read once
 * more, whatever its fee count. Before this, a version bump reached only thin texts (under
 * THIN_DOCUMENT_MAX_FEES fees sent to Darwin) and the narrow witnesses, so a garbled text that
 * still yielded many fees was never read again.
 *
 * Scope, "Re-read all" (James, 25 Oct): the lane is live with no switch, and takes
 * - every primary-reader or legacy text with no settled primary read of its bytes at
 *   ROSETTA_READ_VERSION,
 * - every free-OCR text with no OCR read of its bytes at ROSETTA_OCR_VERSION, and
 * - every JavaScript-fallback text with no fallback read of its bytes at ROSETTA_JS_FALLBACK_VERSION,
 * - above its base, every HTML-read text with no read of its bytes recording HTML_READ_VERSION
 *   (#1092; v2 is HTML_ROW_PAIRING_LIVE), so an HTML change replays no PDF,
 * - above its base, every PDF-read text with no read of its bytes recording PDF_READ_VERSION
 *   (#1092; v2 is PDF_TEXT_DIRECTION_LIVE), so a PDF change replays no HTML page,
 * on the bank's current copy (not superseded, not a duplicate), including a copy whose link has a
 * newer download, since its fees are still live. The paid pass (read.paid_transcribe) is left out:
 * re-reading it would be a paid provider call.
 * Measured with read-only prod SELECTs on 25 Oct 2026 (docs/project/findings/
 * 2026-10-25-reader-upgrade-reaches-thin-texts-only.md has the SQL): 375 current documents at 374
 * banks, carrying 5,526 of 85,713 live fees in published_fee_catalog: 277 legacy texts (4,550 live
 * fees), 67 JavaScript-fallback texts below v3 (651) and 31 OCR texts below v2 (325); 76 of the 375
 * are not in the vault and are fetched again from their link. One legacy text has a dead link and
 * no vault copy, so it cannot be read again.
 *
 * Bounded and once per version:
 * - The read step takes at most READER_REPLAY_PER_RUN of them a run (its own lane, like the
 *   stacked-column repair), so the backlog drains at a steady pace beside new documents.
 * - A document is due while its reader has no read of its bytes at the current version and no
 *   `rosetta.reader_replay` receipt at that version names it. Every replay writes that receipt,
 *   whatever the read's outcome (a timeout or byte mismatch included), so a document is replayed
 *   once per version and never holds a lane slot run after run.
 * - The lost-text rule holds: the earlier text is passed to the read as the text to beat, so the
 *   new text replaces it only when it lists at least as many fees (`rungTextNotWorse`), and a
 *   replay that fails never sends the bank back to Magellan or hands it to the paid finder.
 * - A replay runs the ordinary read, so a scan escalates to free OCR and a script-built page to the
 *   JavaScript fallback inside the same read, at their current versions.
 *
 * Where the new text differs, Knox re-extracts it (a new text hash) and Darwin re-checks the
 * fees; the receipt records old and new text hashes so the fee changes can be counted after.
 */
import type { sql } from "@/lib/data-store/connection";
import { DOCX_STRATEGY } from "./docx";
import {
  HTML_READ_BASE_VERSION,
  HTML_READ_READERS,
  HTML_READ_VERSION,
  PDF_LAYOUT_REPLAY_VERSION,
  PDF_READ_BASE_VERSION,
  PDF_READ_READERS,
  PDF_READ_VERSION,
  ROSETTA_JS_FALLBACK_VERSION,
  ROSETTA_OCR_VERSION,
  ROSETTA_READ_VERSION,
} from "./reader-versions";

type SqlTag = typeof sql;

export const READER_REPLAY_EVENT = "rosetta.reader_replay";
/** Older-reader documents read per read step: the 375 due on 25 Oct take 94 steps, about a day at ~100 a day. */
export const READER_REPLAY_PER_RUN = 4;
/** Readers versioned by ROSETTA_READ_VERSION. A text with no reader is the legacy reader's. */
export const READER_REPLAY_READERS: string[] = ["read.pdf_layout", "read.html_dom", "read.plain_text", DOCX_STRATEGY];
/**
 * Readers with their own version, replayed when their text predates it. The strategy names equal
 * OCR_STRATEGY (ocr.ts) and JS_FALLBACK_STRATEGY (js-fallback.ts); this module stays free of the
 * OCR and browser imports (reader-replay.test.ts checks they match).
 */
export const READER_REPLAY_OWN_VERSIONS: ReadonlyArray<{ reader: string; version: number; receiptKey: string }> = [
  { reader: "read.ocr_tesseract", version: ROSETTA_OCR_VERSION, receiptKey: "ocr_version" },
  { reader: "read.js_fallback", version: ROSETTA_JS_FALLBACK_VERSION, receiptKey: "js_fallback_version" },
];

/**
 * Layout v6 cell ownership (Mountain Star FCU fee 159428, Nov 2): a `read.pdf_layout` text that
 * holds a cell break (" | ") and has no layout read of its bytes at PDF_LAYOUT_REPLAY_VERSION is
 * replayed once. Off until the record-only layout recheck (layout-recheck.ts, which samples every
 * live-fee text below the current layout) shows the new reading loses no supported live fee: on
 * Nov 2, 3,226 current pdf_layout texts held a cell break, carrying 30,735 live fees.
 */
export const PDF_CELL_REPLAY_LIVE = false;
export const READER_REPLAY_PDF_LAYOUT = {
  reader: "read.pdf_layout",
  version: PDF_LAYOUT_REPLAY_VERSION,
  receiptKey: "pdf_layout_version",
} as const;

/**
 * HTML reader version (#1092): above HTML_READ_BASE_VERSION, a current completed text an HTML
 * reader wrote (`read.html_dom`, `read.js_fallback`) with no read attempt on its bytes recording
 * `detail.html_read` at the version is replayed once. A legacy text (no reader) is not: an HTML
 * reader did not write it, and it is due under ROSETTA_READ_VERSION until a current-version read.
 */
export const READER_REPLAY_HTML = {
  readers: HTML_READ_READERS,
  version: HTML_READ_VERSION,
  receiptKey: "html_read_version",
} as const;

/**
 * PDF reader version (#1092): above PDF_READ_BASE_VERSION, a current completed text a PDF reader
 * wrote (`read.pdf_layout`) with no read attempt on its bytes recording `detail.pdf_read` at the
 * version is replayed once. A legacy text (no reader) is not, as for HTML.
 */
export const READER_REPLAY_PDF = {
  readers: PDF_READ_READERS,
  version: PDF_READ_VERSION,
  receiptKey: "pdf_read_version",
} as const;

/**
 * SQL: true when the stored text `alias` came from an older version of its reader and has not
 * been replayed at the current version. `notSettled` is the read step's "no settled read of these
 * bytes at the current primary reader version" test for the same alias. At HTML_READ_BASE_VERSION
 * and PDF_READ_BASE_VERSION their branches are left out, so the SQL is the same text as before
 * those versions existed.
 */
export function readerReplayDueSql(
  alias: string,
  params: { readers: string; version: string; event: string },
  notSettled: string,
  pdfCellReplay: boolean = PDF_CELL_REPLAY_LIVE,
  htmlReadVersion: number = HTML_READ_VERSION,
  pdfReadVersion: number = PDF_READ_VERSION,
): string {
  const notReplayed = (key: string, version: string) => `NOT EXISTS (
                  SELECT 1 FROM agent_run_events replayed
                   WHERE replayed.event_type = ${params.event}
                     AND replayed.detail->>'source_document_id' = ${alias}.source_document_id::text
                     AND replayed.detail->>'source_hash' IS NOT DISTINCT FROM ${alias}.source_hash
                     AND (replayed.detail->>'${key}')::int >= ${version}::int
                )`;
  // The versions are code constants (integers) and the reader names fixed strings.
  const ownReaders = READER_REPLAY_OWN_VERSIONS.map(({ reader, version, receiptKey }) => `(
                  ${alias}.reader = '${reader}'
                  AND NOT EXISTS (
                    SELECT 1 FROM pipeline_attempts own_read
                     WHERE own_read.stage = 'read'
                       AND own_read.strategy = '${reader}'
                       AND own_read.institution_id = ${alias}.institution_id
                       AND own_read.input_fingerprint = ${alias}.source_hash
                       AND own_read.strategy_version >= ${Number(version)}
                  )
                  AND ${notReplayed(receiptKey, String(Number(version)))}
                )`).join("\n                OR ");
  const layout = READER_REPLAY_PDF_LAYOUT;
  // A pdf_layout read records its layout version in detail.pdf_layout (read.ts); none means v1.
  const layoutReplay = pdfCellReplay ? `
                OR (
                  ${alias}.reader = '${layout.reader}'
                  AND position(' | ' in ${alias}.normalized_text) > 0
                  AND NOT EXISTS (
                    SELECT 1 FROM pipeline_attempts layout_read
                     WHERE layout_read.stage = 'read'
                       AND layout_read.strategy = '${layout.reader}'
                       AND layout_read.institution_id = ${alias}.institution_id
                       AND layout_read.input_fingerprint = ${alias}.source_hash
                       AND COALESCE((layout_read.detail->>'pdf_layout')::int, 1) >= ${Number(layout.version)}
                  )
                  AND ${notReplayed(layout.receiptKey, String(Number(layout.version)))}
                )` : "";
  const html = Number(htmlReadVersion);
  const htmlReaders = READER_REPLAY_HTML.readers.map((reader) => `'${reader}'`).join(", ");
  // Any read of these bytes that recorded the HTML version settles it; none recorded means the base.
  const htmlReplay = html > HTML_READ_BASE_VERSION ? `
                OR (
                  ${alias}.reader IN (${htmlReaders})
                  AND NOT EXISTS (
                    SELECT 1 FROM pipeline_attempts html_read
                     WHERE html_read.stage = 'read'
                       AND html_read.institution_id = ${alias}.institution_id
                       AND html_read.input_fingerprint = ${alias}.source_hash
                       AND COALESCE((html_read.detail->>'html_read')::int, ${HTML_READ_BASE_VERSION}) >= ${html}
                  )
                  AND ${notReplayed(READER_REPLAY_HTML.receiptKey, String(html))}
                )` : "";
  const pdf = Number(pdfReadVersion);
  const pdfReaders = READER_REPLAY_PDF.readers.map((reader) => `'${reader}'`).join(", ");
  // Any read of these bytes that recorded the PDF version settles it; none recorded means the base.
  const pdfReplay = pdf > PDF_READ_BASE_VERSION ? `
                OR (
                  ${alias}.reader IN (${pdfReaders})
                  AND NOT EXISTS (
                    SELECT 1 FROM pipeline_attempts pdf_read
                     WHERE pdf_read.stage = 'read'
                       AND pdf_read.institution_id = ${alias}.institution_id
                       AND pdf_read.input_fingerprint = ${alias}.source_hash
                       AND COALESCE((pdf_read.detail->>'pdf_read')::int, ${PDF_READ_BASE_VERSION}) >= ${pdf}
                  )
                  AND ${notReplayed(READER_REPLAY_PDF.receiptKey, String(pdf))}
                )` : "";
  return `(
                ${alias}.status = 'completed'
                AND ((
                  (${alias}.reader IS NULL OR ${alias}.reader = ANY(${params.readers}::text[]))
                  AND ${notSettled}
                  AND ${notReplayed("reader_version", params.version)}
                )
                OR ${ownReaders}${layoutReplay}${htmlReplay}${pdfReplay})
              )`;
}

export interface ReaderReplayRow {
  source_document_id: number | string;
  institution_id: number | string;
  content_hash: string | null;
  reader_replay_text_hash?: string | null;
  reader_replay_reader?: string | null;
  reader_replay_from_version?: number | string | null;
}

export interface ReaderReplayRead {
  status: string;
  attemptOutcome: string | null;
  reader?: string | null;
  fromVault?: boolean;
  error?: string | null;
}

/** One receipt per replayed document; returns whether the stored text changed. */
export async function recordReaderReplay(
  db: SqlTag,
  env: { runId: number; stepId: number | null },
  row: ReaderReplayRow,
  read: ReaderReplayRead,
): Promise<{ textChanged: boolean }> {
  const [current] = await db<Array<{ text_hash: string | null; status: string | null }>>`
    SELECT text_hash, status FROM agent_source_texts
     WHERE source_document_id = ${Number(row.source_document_id)}
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1
  `;
  const oldHash = row.reader_replay_text_hash ?? null;
  const newHash = current?.text_hash ?? null;
  const textChanged = current?.status === "completed" && newHash != null && newHash !== oldHash;
  const detail = {
    protocol: `${READER_REPLAY_EVENT}.v1`,
    reader_version: ROSETTA_READ_VERSION,
    ocr_version: ROSETTA_OCR_VERSION,
    js_fallback_version: ROSETTA_JS_FALLBACK_VERSION,
    // Only a pdf_layout text's replay is a layout replay; OCR and fallback receipts carry none.
    pdf_layout_version: row.reader_replay_reader === READER_REPLAY_PDF_LAYOUT.reader ? PDF_LAYOUT_REPLAY_VERSION : undefined,
    // Only an HTML reader's text is an HTML replay.
    html_read_version: row.reader_replay_reader != null && READER_REPLAY_HTML.readers.includes(row.reader_replay_reader)
      ? HTML_READ_VERSION : undefined,
    // Only a PDF reader's text is a PDF replay.
    pdf_read_version: row.reader_replay_reader != null && READER_REPLAY_PDF.readers.includes(row.reader_replay_reader)
      ? PDF_READ_VERSION : undefined,
    from_reader: row.reader_replay_reader ?? null,
    from_reader_version: row.reader_replay_from_version == null ? null : Number(row.reader_replay_from_version),
    institution_id: Number(row.institution_id),
    source_document_id: Number(row.source_document_id),
    source_hash: row.content_hash,
    old_text_hash: oldHash,
    new_text_hash: newHash,
    text_changed: textChanged,
    read_status: read.status,
    attempt_outcome: read.attemptOutcome,
    reader: read.reader ?? null,
    from_vault: read.fromVault ?? false,
    error: read.error ?? null,
  };
  const message = textChanged
    ? `Reader replay v${ROSETTA_READ_VERSION}: new text stored for document ${detail.source_document_id}`
    : `Reader replay v${ROSETTA_READ_VERSION}: earlier text kept for document ${detail.source_document_id} (${read.status})`;
  await db`
    INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
    VALUES (${env.runId}, ${env.stepId}, ${READER_REPLAY_EVENT}, ${read.status === "completed" ? "completed" : "skipped"}, ${message}, ${JSON.stringify(detail)}::jsonb)
  `;
  return { textChanged };
}

/** Replays done at the current version and how many changed their text (Bayes's ledger). */
export async function countReaderReplaysDone(db: SqlTag): Promise<{ done: number; textChanged: number }> {
  const [row] = await db.unsafe<Array<{ done: number | string; changed: number | string }>>(`
    SELECT COUNT(DISTINCT detail->>'source_document_id') AS done,
           COUNT(DISTINCT detail->>'source_document_id') FILTER (WHERE (detail->>'text_changed')::boolean) AS changed
      FROM agent_run_events
     WHERE event_type = $1
       AND (detail->>'reader_version')::int >= $2
  `, [READER_REPLAY_EVENT, ROSETTA_READ_VERSION]);
  return { done: Number(row?.done ?? 0), textChanged: Number(row?.changed ?? 0) };
}
