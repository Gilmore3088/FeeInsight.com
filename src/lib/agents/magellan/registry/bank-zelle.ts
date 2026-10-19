import { sql } from "@/lib/data-store/connection";
import { isZelleListHost } from "@/lib/data-store/struck-sources";
import { BANK_ZELLE_MATCHER_VERSION, decideZelle, type ZelleDocument, type ZelleFinding } from "./bank-zelle-match";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Registry step `registry-bank-zelle` (#1875): records whether each institution offers Zelle, read
 * from its own documents that the pipeline already stores (the current copy of each page in
 * source_documents and its text in agent_source_texts). Nothing is fetched, and nothing is read
 * from Zelle's participant list, which was struck on 2026-10-17 because its terms bar commercial
 * use. Every stored row carries the link to the institution's own document it was read from.
 *
 * Bounded, so it never back-fills everything at once while the database is under strain: one
 * partition ("current") works through institutions in id order, BATCH_SIZE per run, each query
 * under a STATEMENT_TIMEOUT. The partition records where it stopped (`detail.cursor`); the next
 * run starts there an hour later. A finished pass waits PASS_REFRESH_HOURS before starting again.
 * A new BANK_ZELLE_MATCHER_VERSION restarts the pass from the first institution.
 *
 * For each institution in the batch: a finding (bank-zelle-match.ts) is upserted into
 * institution_payment_features (feature 'zelle'); an institution whose current documents no
 * longer name Zelle has its stored row removed, since its evidence is gone. An institution whose
 * documents never name Zelle gets no row: silence is not "does not offer".
 */

export const BANK_ZELLE_SOURCE = "bank-zelle";
export const BANK_ZELLE_PARTITION = "current";
export const BANK_ZELLE_FEATURE = "zelle";
/** Institutions read per run. */
export const BANK_ZELLE_BATCH_SIZE = 300;
/** Each read and write runs under this statement timeout. */
export const BANK_ZELLE_STATEMENT_TIMEOUT = "30s";
/** A document's text longer than this is read only up to here. */
const TEXT_LIMIT_CHARS = 2_000_000;
const NEXT_BATCH_HOURS = 1;
const PASS_REFRESH_HOURS = 24 * 7;

export interface RegistryBankZelleResult {
  source: string;
  partitionKey: string;
  matcherVersion: number;
  /** The institution id the batch started after. */
  cursorFrom: number;
  /** Where the next run starts; 0 when this run finished the pass. */
  cursorTo: number;
  passFinished: boolean;
  institutionsRead: number;
  /** Current documents read for those institutions. */
  documentsRead: number;
  documentsNamingZelle: number;
  /** Documents naming Zelle that were skipped: their address is on Zelle's own sites, or is not a readable URL. */
  documentsSkipped: number;
  offers: number;
  doesNotOffer: number;
  unclear: number;
  written: number;
  removed: number;
  dryRun: boolean;
}

interface CursorState {
  cursor: number;
  passStartedAt: string | null;
}

/** Where the last run stopped, or the start when the rules changed since. */
export async function readBankZelleCursor(db: RegistryDb): Promise<CursorState> {
  const rows = await db<Array<{ detail: Record<string, unknown> | null }>>`
    SELECT detail FROM registry_ingest_partitions
     WHERE source = ${BANK_ZELLE_SOURCE} AND partition_key = ${BANK_ZELLE_PARTITION}
  `;
  const detail = [...(rows as unknown as Array<{ detail: Record<string, unknown> | null }>)][0]?.detail ?? {};
  const version = Number(detail.parser_version ?? 0);
  const cursor = Number(detail.cursor ?? 0);
  if (version !== BANK_ZELLE_MATCHER_VERSION || !Number.isFinite(cursor) || cursor < 0) return { cursor: 0, passStartedAt: null };
  return { cursor, passStartedAt: typeof detail.pass_started_at === "string" ? detail.pass_started_at : null };
}

/** Runs `fn` in a transaction under the step's statement timeout. */
async function bounded<T>(db: RegistryDb, fn: (tx: RegistryDb) => Promise<T>): Promise<T> {
  return (await db.begin(async (tx) => {
    const scoped = tx as unknown as RegistryDb;
    await scoped`SELECT set_config('statement_timeout', ${BANK_ZELLE_STATEMENT_TIMEOUT}, true)`;
    return fn(scoped);
  })) as T;
}

interface TextRow {
  agent_source_text_id: number | string;
  institution_id: number | string;
  source_document_id: number | string;
  url: string | null;
  text: string | null;
}

/** The next batch of institution ids after the cursor, in id order. */
async function nextInstitutions(db: RegistryDb, cursor: number): Promise<number[]> {
  const rows = await db<Array<{ id: number | string }>>`
    SELECT id FROM institution_sources
     WHERE id > ${cursor}
     ORDER BY id
     LIMIT ${BANK_ZELLE_BATCH_SIZE}
  `;
  return [...(rows as unknown as Array<{ id: number | string }>)].map((r) => Number(r.id));
}

/**
 * The newest completed text of each current document for these institutions. The text itself
 * comes back only when it names Zelle; the rest are counted.
 */
async function currentTexts(db: RegistryDb, ids: number[]): Promise<TextRow[]> {
  const rows = await db<TextRow[]>`
    WITH current_text AS (
      SELECT DISTINCT ON (t.source_document_id)
             t.id, t.institution_id, t.source_document_id, COALESCE(doc.document_url, t.source_url) AS url
        FROM agent_source_texts t
        JOIN source_documents doc ON doc.id = t.source_document_id
       WHERE t.institution_id = ANY(${ids}::bigint[])
         AND t.status = 'completed'
         AND doc.institution_id = t.institution_id
         AND doc.status = 'success'
         AND doc.duplicate_of_id IS NULL
         AND doc.superseded_by_id IS NULL
       ORDER BY t.source_document_id, t.id DESC
    )
    SELECT c.id AS agent_source_text_id, c.institution_id, c.source_document_id, c.url,
           CASE WHEN t.normalized_text ILIKE '%zelle%' THEN left(t.normalized_text, ${TEXT_LIMIT_CHARS}) END AS text
      FROM current_text c
      JOIN agent_source_texts t ON t.id = c.id
  `;
  return [...(rows as unknown as TextRow[])];
}

interface FeatureRow {
  institution_id: number;
  status: string;
  rule: string;
  evidence_url: string;
  evidence_snippet: string;
  source_document_id: number;
  agent_source_text_id: number;
  documents_mentioning: number;
  offers_sentences: number;
  does_not_offer_sentences: number;
  mention_sentences: number;
}

function featureRow(institutionId: number, finding: ZelleFinding): FeatureRow {
  return {
    institution_id: institutionId,
    status: finding.status,
    rule: finding.rule,
    evidence_url: finding.evidence.url,
    evidence_snippet: finding.snippet,
    source_document_id: finding.evidence.sourceDocumentId,
    agent_source_text_id: finding.evidence.agentSourceTextId,
    documents_mentioning: finding.documentsMentioning,
    offers_sentences: finding.offersSentences,
    does_not_offer_sentences: finding.doesNotOfferSentences,
    mention_sentences: finding.mentionSentences,
  };
}

async function writeFeatures(db: RegistryDb, rows: FeatureRow[], cleared: number[], runId: number | null): Promise<{ written: number; removed: number }> {
  let written = 0;
  if (rows.length > 0) {
    const result = await db`
      INSERT INTO institution_payment_features
        (institution_id, feature, status, rule, evidence_url, evidence_snippet, source_document_id,
         agent_source_text_id, documents_mentioning, offers_sentences, does_not_offer_sentences,
         mention_sentences, matcher_version, agent_run_id, read_at)
      SELECT r.institution_id, ${BANK_ZELLE_FEATURE}, r.status, r.rule, r.evidence_url, r.evidence_snippet,
             r.source_document_id, r.agent_source_text_id, r.documents_mentioning, r.offers_sentences,
             r.does_not_offer_sentences, r.mention_sentences, ${BANK_ZELLE_MATCHER_VERSION}, ${runId}, NOW()
        FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
          AS r(institution_id bigint, status text, rule text, evidence_url text, evidence_snippet text,
               source_document_id bigint, agent_source_text_id bigint, documents_mentioning int,
               offers_sentences int, does_not_offer_sentences int, mention_sentences int)
      ON CONFLICT (institution_id, feature) DO UPDATE SET
        status = EXCLUDED.status,
        rule = EXCLUDED.rule,
        evidence_url = EXCLUDED.evidence_url,
        evidence_snippet = EXCLUDED.evidence_snippet,
        source_document_id = EXCLUDED.source_document_id,
        agent_source_text_id = EXCLUDED.agent_source_text_id,
        documents_mentioning = EXCLUDED.documents_mentioning,
        offers_sentences = EXCLUDED.offers_sentences,
        does_not_offer_sentences = EXCLUDED.does_not_offer_sentences,
        mention_sentences = EXCLUDED.mention_sentences,
        matcher_version = EXCLUDED.matcher_version,
        agent_run_id = EXCLUDED.agent_run_id,
        read_at = EXCLUDED.read_at
      RETURNING 1
    `;
    written = [...(result as unknown as unknown[])].length;
  }
  let removed = 0;
  if (cleared.length > 0) {
    const result = await db`
      DELETE FROM institution_payment_features
       WHERE feature = ${BANK_ZELLE_FEATURE}
         AND institution_id = ANY(${cleared}::bigint[])
      RETURNING 1
    `;
    removed = [...(result as unknown as unknown[])].length;
  }
  return { written, removed };
}

export async function runRegistryBankZelle(options: { runId?: number | null; dryRun?: boolean; db?: RegistryDb; now?: Date } = {}): Promise<RegistryBankZelleResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const now = options.now ?? new Date();
  const state = await readBankZelleCursor(db);

  const read = await bounded(db, async (tx) => {
    const ids = await nextInstitutions(tx, state.cursor);
    return { ids, texts: ids.length > 0 ? await currentTexts(tx, ids) : [] };
  });

  const byInstitution = new Map<number, ZelleDocument[]>();
  let documentsNamingZelle = 0;
  let documentsSkipped = 0;
  for (const row of read.texts) {
    if (!row.text || !row.url) continue;
    if (isZelleListHost(row.url)) {
      documentsSkipped += 1;
      continue;
    }
    documentsNamingZelle += 1;
    const id = Number(row.institution_id);
    const docs = byInstitution.get(id) ?? [];
    docs.push({ agentSourceTextId: Number(row.agent_source_text_id), sourceDocumentId: Number(row.source_document_id), url: row.url, text: row.text });
    byInstitution.set(id, docs);
  }

  const rows: FeatureRow[] = [];
  const cleared: number[] = [];
  for (const id of read.ids) {
    const finding = decideZelle(byInstitution.get(id) ?? []);
    if (finding) rows.push(featureRow(id, finding));
    else cleared.push(id);
  }

  const passFinished = read.ids.length < BANK_ZELLE_BATCH_SIZE;
  const cursorTo = passFinished ? 0 : read.ids[read.ids.length - 1];
  const count = (status: string) => rows.filter((r) => r.status === status).length;
  const result: RegistryBankZelleResult = {
    source: BANK_ZELLE_SOURCE,
    partitionKey: BANK_ZELLE_PARTITION,
    matcherVersion: BANK_ZELLE_MATCHER_VERSION,
    cursorFrom: state.cursor,
    cursorTo,
    passFinished,
    institutionsRead: read.ids.length,
    documentsRead: read.texts.length,
    documentsNamingZelle,
    documentsSkipped,
    offers: count("offers"),
    doesNotOffer: count("does_not_offer"),
    unclear: count("unclear"),
    written: 0,
    removed: 0,
    dryRun,
  };
  if (dryRun) return result;

  const writes = await bounded(db, (tx) => writeFeatures(tx, rows, cleared, options.runId ?? null));
  result.written = writes.written;
  result.removed = writes.removed;

  await recordRegistryPartition(db, {
    source: BANK_ZELLE_SOURCE,
    partitionKey: BANK_ZELLE_PARTITION,
    status: rows.length > 0 || read.ids.length > 0 ? "succeeded" : "empty",
    rowCount: result.written,
    matchedCount: rows.length,
    unmatchedCount: cleared.length,
    runId: options.runId ?? null,
    nextAttemptAfterHours: passFinished ? PASS_REFRESH_HOURS : NEXT_BATCH_HOURS,
    detail: {
      parser_version: BANK_ZELLE_MATCHER_VERSION,
      cursor: cursorTo,
      cursor_from: state.cursor,
      pass_started_at: state.cursor === 0 ? now.toISOString() : state.passStartedAt,
      pass_finished: passFinished,
      batch_size: BANK_ZELLE_BATCH_SIZE,
      institutions_read: result.institutionsRead,
      documents_read: result.documentsRead,
      documents_naming_zelle: documentsNamingZelle,
      documents_skipped: documentsSkipped,
      offers: result.offers,
      does_not_offer: result.doesNotOffer,
      unclear: result.unclear,
      removed: result.removed,
      ...(read.ids.length === 0 ? { reason: "No institutions after the cursor; the pass starts again from the first." } : {}),
    },
  });
  return result;
}
