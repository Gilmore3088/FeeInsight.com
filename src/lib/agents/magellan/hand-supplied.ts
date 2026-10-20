import { createHash } from "crypto";

import { sql, withTransaction } from "@/lib/data-store/connection";
import { companionStreamsReady } from "@/lib/agents/companion-streams";
import { documentVaultSchemaReady, getDocumentVault, type DocumentVault } from "@/lib/agents/document-vault";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { closeInlineAgentRun, openInlineAgentRun } from "@/lib/agents/run-store";
import { readHandSuppliedDocument, type ReadResult } from "@/lib/agents/rosetta/read";

import { markCurrentCopy } from "./current-copy";
import { urlIdentity } from "./finders";
import { MAX_DOCUMENT_BYTES } from "./fetch";
import { parseSuppliedFileName, planHuntRows, type HuntRow } from "./hand-supplied-files";
import { addHandFoundLink, cleanHandFoundUrl, type HandFoundLinkErrorCode } from "./operator-schedules";
import { otherInstitutionAtHost } from "./other-bank-host";

type SqlTag = typeof sql;

/**
 * Fee schedules a person supplies by hand: a PDF they downloaded from the bank's own site as an
 * ordinary visitor, for a bank whose site refuses our fetcher (HTTP 403 bot walls) or where we
 * hold the wrong page. Magellan never gets past a wall itself (no browser, no proxy); a person
 * can, and this is where their copy comes in.
 *
 * Each file is stored as a companion document of its institution (`consumer_supplement`, the
 * same role as a hand-found link, `operator-schedules.ts`), marked hand-supplied by its
 * strategy (HAND_SUPPLIED_STRATEGY) with who gave it and when. Its bytes go to the document
 * vault and Rosetta reads them at once (`readHandSuppliedDocument`); the bank's site is never
 * asked for the file. Knox, Darwin and Hamilton then take the text through the usual flow.
 *
 * Nothing is replaced or deleted: the bank's fee link, its other documents and its live fees
 * stay as they are (a hand-found link never sets the fee link, so neither does this), and the
 * same bytes twice for one institution are a no-op once that copy has been read. Every load is its own run in the ledger.
 */
export const HAND_SUPPLIED_STRATEGY = { strategy: "supply.hand_supplied", version: 1 } as const;
export const HAND_SUPPLIED_SOURCE = "magellan.hand_supplied";
export const HAND_SUPPLIED_STEP_KEY = "hand-supply";

export type HandSuppliedOutcome = "loaded" | "already_loaded" | "refused";

export interface HandSuppliedResult {
  fileName: string;
  institutionId: number | null;
  institutionName: string | null;
  outcome: HandSuppliedOutcome;
  message: string;
  runId: number | null;
  sourceDocumentId: number | null;
  /** Rosetta's verdict on the text: completed, needs_ocr, wrong_document, ... */
  readStatus: string | null;
}

const isPdf = (bytes: Uint8Array) =>
  bytes.byteLength >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;

const READ_MESSAGE: Record<string, string> = {
  completed: "Read: Knox takes it next",
  needs_ocr: "Stored; it is a scan and OCR could not read it here, so it waits for Rosetta's OCR",
  wrong_document: "Stored, but Rosetta reads no fee schedule in it, so its page was set aside",
  empty: "Stored, but it holds no readable text",
  failed: "Stored, but the read failed",
};

type StoredCopy = { refused: string } | { sourceDocumentId: number; companionId: number; joined: boolean };

export interface LoadHandSuppliedOptions {
  db?: SqlTag;
  fileName: string;
  bytes: Uint8Array;
  /** The address the person downloaded it from (the CSV's found_url); stored as the document's source. */
  sourceUrl: string | null;
  effectiveDate?: string | null;
  notes?: string | null;
  /** Who supplied it, e.g. the admin's username. */
  suppliedBy: string;
  now?: Date;
  vault?: DocumentVault;
  read?: typeof readHandSuppliedDocument;
}

/** Stores one hand-supplied PDF as a source document of the institution its file name names, and reads it. */
export async function loadHandSuppliedDocument(options: LoadHandSuppliedOptions): Promise<HandSuppliedResult> {
  const db = options.db ?? sql;
  const inTransaction = <T>(work: (tx: SqlTag) => Promise<T>): Promise<T> => (options.db ? work(db) : withTransaction(work));
  const parsed = parseSuppliedFileName(options.fileName);
  const base: HandSuppliedResult = {
    fileName: options.fileName,
    institutionId: parsed?.institutionId ?? null,
    institutionName: null,
    outcome: "refused",
    message: "",
    runId: null,
    sourceDocumentId: null,
    readStatus: null,
  };
  const refuse = (message: string): HandSuppliedResult => ({ ...base, outcome: "refused", message });

  if (!parsed) return refuse("File name must start with the institution id: <id>__<short-name>__consumer.pdf");
  if (parsed.audience === "business") {
    return refuse("A business schedule is not loaded: the index reads consumer schedules");
  }
  if (!isPdf(options.bytes)) return refuse("Not a PDF file");
  if (options.bytes.byteLength > MAX_DOCUMENT_BYTES) return refuse(`Larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`);
  if (!options.sourceUrl?.trim()) {
    return refuse("No source address: add the CSV with this file's found_url, so the document shows where it came from");
  }
  const cleaned = cleanHandFoundUrl(options.sourceUrl);
  if ("error" in cleaned) return refuse(`found_url: ${cleaned.error}`);
  const sourceUrl = cleaned.url;

  const [institution] = await db<Array<{ institution_name: string }>>`
    SELECT institution_name FROM institution_sources WHERE id = ${parsed.institutionId}
  `;
  if (!institution) return refuse(`No institution ${parsed.institutionId}`);
  base.institutionName = String(institution.institution_name);
  // As for a hand-found link: a page on another institution's own website is that bank's schedule.
  const other = await otherInstitutionAtHost(db, parsed.institutionId, sourceUrl);
  if (other) {
    return refuse(`found_url is on the website of ${other.institutionName}${other.stateCode ? ` (${other.stateCode})` : ""}, another institution`);
  }
  const vault = options.vault ?? getDocumentVault();
  // Rosetta's later re-reads take the bytes from the vault; without it they would ask the bank's site.
  if (!vault.configured || !(await documentVaultSchemaReady(db))) return refuse("The document vault is not set up here, so nothing was stored");
  if (!(await companionStreamsReady(db))) return refuse("Companion documents are not set up here, so nothing was stored");

  const contentHash = createHash("sha256").update(options.bytes).digest("hex");
  const at = (options.now ?? new Date()).toISOString().replace("T", " ").slice(0, 16);
  const givenBy = `${options.suppliedBy}, ${at} UTC`;
  const params = {
    source: HAND_SUPPLIED_SOURCE,
    institution_id: parsed.institutionId,
    file_name: options.fileName,
    source_url: sourceUrl,
    content_hash: contentHash,
    bytes: options.bytes.byteLength,
    supplied_by: options.suppliedBy,
    effective_date: options.effectiveDate || null,
    notes: options.notes || null,
  };
  const run = await openInlineAgentRun({
    db,
    agent: "magellan",
    title: `Hand-supplied schedule: ${base.institutionName}`,
    stepKey: HAND_SUPPLIED_STEP_KEY,
    stepTitle: `Store and read ${options.fileName}`,
    params,
    triggeredBy: options.suppliedBy,
  });
  base.runId = run.runId;

  try {
    // The same bytes already on file. A copy that was never read (Rosetta asked the bank's site
    // for it and was refused, #1754: Alliant's 2026-02 copy, text "HTTP 403") is read now from the
    // uploaded bytes, which also go to the vault; a copy already read stays as it is.
    const [existing] = await db<Array<{ id: number | string; document_r2_key: string | null; read_ok: boolean }>>`
      SELECT d.id, d.document_r2_key,
             EXISTS (
               SELECT 1 FROM agent_source_texts t
                WHERE t.source_document_id = d.id AND t.status = 'completed' AND t.char_count > 0
             ) AS read_ok
        FROM source_documents d
       WHERE d.institution_id = ${parsed.institutionId}
         AND d.content_hash = ${contentHash}
         AND d.status = 'success'
       ORDER BY d.id ASC
       LIMIT 1
    `;
    if (existing?.read_ok) {
      const message = `Already loaded as document ${Number(existing.id)}; nothing changed`;
      await closeInlineAgentRun(run, { db, status: "completed", summary: message, detail: { outcome: "already_loaded", source_document_id: Number(existing.id) } });
      return { ...base, outcome: "already_loaded", message, sourceDocumentId: Number(existing.id) };
    }
    if (existing) {
      const sourceDocumentId = Number(existing.id);
      if (!existing.document_r2_key) {
        const vaulted = await vault.store(options.bytes, contentHash, "application/pdf");
        if (!vaulted.key) throw new Error(`Document vault store failed: ${vaulted.error ?? vaulted.status}`);
        await db`
          UPDATE source_documents
             SET document_r2_key = ${vaulted.key}, content_type = 'application/pdf', byte_size = ${options.bytes.byteLength}
           WHERE id = ${sourceDocumentId}
        `;
      }
      const read: ReadResult | null = await (options.read ?? readHandSuppliedDocument)({
        db,
        runId: run.runId,
        stepId: run.stepId,
        sourceDocumentId,
        bytes: options.bytes,
        contentType: "application/pdf",
      });
      const readStatus = read?.status ?? null;
      const message = `On file as document ${sourceDocumentId}, never read until now. ${READ_MESSAGE[readStatus ?? ""] ?? `Read: ${readStatus ?? "not read"}`}`;
      await closeInlineAgentRun(run, {
        db,
        status: "completed",
        summary: message,
        detail: { outcome: "loaded", source_document_id: sourceDocumentId, reread_unread_copy: true, read_status: readStatus, read_error: read?.error ?? null, chars: read?.charCount ?? 0 },
      });
      return { ...base, outcome: "loaded", message, sourceDocumentId, readStatus };
    }

    const reason = `Consumer fee schedule hand-supplied by ${givenBy}: downloaded as a normal visitor from ${sourceUrl}${
      options.effectiveDate ? `, effective ${options.effectiveDate}` : ""
    }`;
    const stored = await inTransaction(async (tx): Promise<StoredCopy> => {
      // The page may already be on file as a companion (a hand-found link our fetcher could not
      // open): the copy joins that page. A page a reviewer or a rule ruled out stays ruled out.
      const companions = await tx<Array<{ id: number | string; url: string; status: string; reason: string | null }>>`
        SELECT id, url, status, reason FROM institution_additional_sources WHERE institution_id = ${parsed.institutionId}
      `;
      const samePage = companions.find((row) => urlIdentity(row.url) === urlIdentity(sourceUrl));
      if (samePage?.status === "rejected") {
        return { refused: `That page was ruled out for this institution (${samePage.reason ?? "no reason recorded"})` };
      }
      let companionId: number;
      if (samePage) {
        companionId = Number(samePage.id);
        await tx`
          UPDATE institution_additional_sources
             SET reason = COALESCE(reason || '; ', '') || ${`copy hand-supplied by ${givenBy}`}, updated_at = NOW()
           WHERE id = ${companionId}
        `;
      } else {
        const [inserted] = await tx<Array<{ id: number | string }>>`
          INSERT INTO institution_additional_sources
            (institution_id, url, document_type, document_role, status, found_by_strategy, strategy_version, agent_run_id, reason)
          VALUES
            (${parsed.institutionId}, ${sourceUrl}, 'pdf', 'consumer_supplement', 'fetched',
             ${HAND_SUPPLIED_STRATEGY.strategy}, ${HAND_SUPPLIED_STRATEGY.version}, ${run.runId}, ${reason})
          RETURNING id
        `;
        companionId = Number(inserted.id);
      }
      const [document] = await tx<Array<{ id: number | string }>>`
        INSERT INTO source_documents
          (institution_id, status, document_url, document_path, content_hash, fees_extracted, error_message,
           crawled_at, status_code, last_checked_at, companion_source_id)
        VALUES
          (${parsed.institutionId}, 'success', ${sourceUrl}, NULL, ${contentHash}, 0, NULL,
           NOW(), NULL, NOW(), ${companionId})
        RETURNING id
      `;
      const sourceDocumentId = Number(document.id);
      const vaulted = await vault.store(options.bytes, contentHash, "application/pdf");
      if (!vaulted.key) throw new Error(`Document vault store failed: ${vaulted.error ?? vaulted.status}`);
      await tx`
        UPDATE source_documents
           SET document_r2_key = ${vaulted.key}, content_type = 'application/pdf', byte_size = ${options.bytes.byteLength}
         WHERE id = ${sourceDocumentId}
      `;
      // A newer copy of a page already on file is that page's current copy, as in companion
      // fetch. A new page supersedes nothing.
      if (samePage) await markCurrentCopy(tx, sourceDocumentId);
      await tx`
        UPDATE institution_additional_sources
           SET status = 'fetched',
               document_type = 'pdf',
               last_fetched_at = NOW(),
               last_source_document_id = ${sourceDocumentId},
               fetch_failures = 0,
               last_fetch_error = NULL,
               updated_at = NOW()
         WHERE id = ${companionId}
      `;
      await recordAttempt(tx, {
        institutionId: parsed.institutionId,
        sourceDocumentId,
        stage: "fetch",
        strategy: HAND_SUPPLIED_STRATEGY.strategy,
        version: HAND_SUPPLIED_STRATEGY.version,
        fingerprint: sourceUrl,
        outcome: "ok",
        yieldCount: 1,
        costMicrousd: 0,
        durationMs: 0,
        runId: run.runId,
        stepId: run.stepId,
        // Like every companion page, it stays out of the bank's playbook (its main fee link's).
        foldIntoPlaybook: false,
        detail: {
          url: sourceUrl,
          companion_source_id: companionId,
          joined_page_on_file: Boolean(samePage),
          file_name: options.fileName,
          supplied_by: options.suppliedBy,
          bytes: options.bytes.byteLength,
          effective_date: options.effectiveDate || null,
          notes: options.notes || null,
        },
      });
      return { sourceDocumentId, companionId, joined: Boolean(samePage) };
    });
    if ("refused" in stored) {
      await closeInlineAgentRun(run, { db, status: "completed", summary: `Not stored: ${stored.refused}`, detail: { outcome: "refused" } });
      return { ...base, message: stored.refused };
    }

    const read: ReadResult | null = await (options.read ?? readHandSuppliedDocument)({
      db,
      runId: run.runId,
      stepId: run.stepId,
      sourceDocumentId: stored.sourceDocumentId,
      bytes: options.bytes,
      contentType: "application/pdf",
    });
    const readStatus = read?.status ?? null;
    const message = `Stored as document ${stored.sourceDocumentId}. ${READ_MESSAGE[readStatus ?? ""] ?? `Read: ${readStatus ?? "not read"}`}`;
    await closeInlineAgentRun(run, {
      db,
      status: "completed",
      summary: message,
      detail: {
        outcome: "loaded",
        source_document_id: stored.sourceDocumentId,
        companion_source_id: stored.companionId,
        joined_page_on_file: stored.joined,
        read_status: readStatus,
        read_error: read?.error ?? null,
        chars: read?.charCount ?? 0,
      },
    });
    return { ...base, outcome: "loaded", message, sourceDocumentId: stored.sourceDocumentId, readStatus };
  } catch (error) {
    const message = `Load failed: ${error instanceof Error ? error.message : String(error)}`;
    await closeInlineAgentRun(run, { db, status: "failed", summary: message }).catch(() => undefined);
    return { ...base, message };
  }
}

export type HuntLinkOutcome = "added" | "already_on_file" | "other_institution_site" | "invalid" | "skipped" | "file";

export interface HuntLinkResult {
  line: number;
  institutionId: number | null;
  institution: string;
  outcome: HuntLinkOutcome;
  message: string;
}

export interface HuntImportResult {
  runId: number;
  results: HuntLinkResult[];
  counts: Record<HuntLinkOutcome, number>;
}

const LINK_OUTCOME: Record<HandFoundLinkErrorCode, HuntLinkOutcome> = {
  already_on_file: "already_on_file",
  other_institution_site: "other_institution_site",
  invalid_institution: "invalid",
  invalid_link: "invalid",
  institution_not_found: "invalid",
};

/**
 * The browser hunt's CSV: every FOUND row with a found_url and no uploaded file becomes a
 * hand-found link (`addHandFoundLink`), which Atlas's priority path fetches on a later tick.
 * Rows with an uploaded file are loaded from the file instead, and every other row is skipped.
 * One run records the import, with each row's result.
 */
export async function importHuntLinks(options: {
  db?: SqlTag;
  rows: readonly HuntRow[];
  uploadedFileNames: readonly string[];
  suppliedBy: string;
  now?: Date;
}): Promise<HuntImportResult> {
  const db = options.db ?? sql;
  const at = (options.now ?? new Date()).toISOString().replace("T", " ").slice(0, 16);
  const givenBy = `${options.suppliedBy} in the browser hunt (a person's browser, as a normal visitor), ${at} UTC`;
  const plan = planHuntRows(options.rows, options.uploadedFileNames);
  const run = await openInlineAgentRun({
    db,
    agent: "magellan",
    title: "Browser hunt links",
    stepKey: HAND_SUPPLIED_STEP_KEY,
    stepTitle: `Add the browser hunt's found links (${plan.filter((item) => item.kind === "link").length} rows)`,
    params: { source: HAND_SUPPLIED_SOURCE, rows: options.rows.length, uploaded_files: options.uploadedFileNames.length, supplied_by: options.suppliedBy },
    triggeredBy: options.suppliedBy,
  });
  const counts: Record<HuntLinkOutcome, number> = { added: 0, already_on_file: 0, other_institution_site: 0, invalid: 0, skipped: 0, file: 0 };
  const results: HuntLinkResult[] = [];
  try {
    for (const item of plan) {
      const head = { line: item.row.line, institutionId: item.row.institutionId, institution: item.row.institution };
      let result: HuntLinkResult;
      if (item.kind === "skip") result = { ...head, outcome: "skipped", message: item.reason };
      else if (item.kind === "file") result = { ...head, outcome: "file", message: `Loaded from ${item.fileName}` };
      else {
        const added = await addHandFoundLink({ db, institutionId: Number(item.row.institutionId), url: item.row.foundUrl, givenBy });
        result = added.ok
          ? { ...head, outcome: "added", message: `Added for ${added.institutionName}; it is fetched on a later tick` }
          : { ...head, outcome: LINK_OUTCOME[added.code], message: added.error };
      }
      counts[result.outcome] += 1;
      results.push(result);
    }
    const summary = `Browser hunt CSV: ${counts.added} links added, ${counts.already_on_file} already on file, ${counts.other_institution_site} on another institution's site, ${counts.invalid} invalid, ${counts.file} loaded from files, ${counts.skipped} skipped`;
    await closeInlineAgentRun(run, {
      db,
      status: "completed",
      summary,
      detail: {
        counts,
        // Rows that changed something or need a person; skipped rows are only counted.
        rows: results.filter((row) => row.outcome !== "skipped").map((row) => ({ line: row.line, institution_id: row.institutionId, outcome: row.outcome, message: row.message })),
      },
    });
  } catch (error) {
    await closeInlineAgentRun(run, { db, status: "failed", summary: `Import failed: ${error instanceof Error ? error.message : String(error)}` }).catch(() => undefined);
    throw error;
  }
  return { runId: run.runId, results, counts };
}
