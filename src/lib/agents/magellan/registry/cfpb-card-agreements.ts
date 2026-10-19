import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { sql } from "@/lib/data-store/connection";
import { layoutDocumentText, type PdfTextItem } from "@/lib/agents/rosetta/pdf-layout";
import { registryFetch, type RegistryFetchOptions } from "@/lib/regulatory/http";
import {
  PREPAID_METADATA_URL,
  cardAgreementZipUrl,
  cleanAgreementRows,
  extractFeeTerms,
  indexCardAgreementZip,
  matchIssuers,
  parseAgreementPartition,
  partitionDate,
  readPrepaidMetadata,
  readTccpCsv,
  tccpCsvUrl,
  type AgreementRow,
  type CfpbAgreementPartition,
  type FeeTerm,
  type HalfYear,
  type HeaderCheck,
  type IssuerMatch,
} from "@/lib/regulatory/cfpb-card-agreements";
import {
  compareQuarters,
  latestPublishableQuarter,
  quarterKey,
  quarterOf,
  quartersNewestFirst,
  type Quarter,
} from "@/lib/regulatory/quarters";
import { mapWithConcurrency, recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: CFPB card and prepaid agreements and the Terms of Credit Card Plans
 * survey, one partition per step (src/lib/regulatory/cfpb-card-agreements.ts has the formats).
 *
 * Writes one row per agreement (or TCCP plan) to cfpb_card_agreements, matched to
 * institution_sources only by an exact or normalized issuer name held by exactly one institution;
 * every other issuer stays unmatched (institution_id NULL) and is listed in the partition detail.
 * Fee terms go to cfpb_agreement_terms: the quoted line and, when the line is unambiguous, its
 * amount (dollars and percentages in separate columns). PDF text comes from unpdf (already a
 * dependency, used by Rosetta) laid out by Rosetta's line builder. No model or provider call.
 *
 * Reading PDFs is bounded per run (time and file count). Agreements not reached are stored with
 * fee_status 'pending' and the partition comes due again within the hour; an agreement already
 * read by this parser version with the same file hash is not read again.
 */

export const CFPB_CARD_AGREEMENTS_SOURCE = "cfpb-card-agreements";
export const CFPB_CARD_AGREEMENTS_PARSER_VERSION = 1;
/** Card agreement quarters, newest first back to here. */
export const CARD_AGREEMENTS_FIRST: Quarter = { year: 2018, quarter: 1 };
/** TCCP survey halves, newest first back to here. */
export const TCCP_FIRST: HalfYear = { year: 2021, half: 1 };
/** Issuers file within 30 days of quarter end; CFPB posts the archive some weeks later (estimate). */
export const CARD_AGREEMENTS_LAG_DAYS = 90;
/** The January survey is published around mid-year and the July one around year end (estimate). */
export const TCCP_LAG_DAYS = 180;

const MAX_PDF_PAGES = 8;
const PDF_READ_TIMEOUT_MS = 15_000;
const DEFAULT_BUDGET_MS = 240_000;
const DEFAULT_MAX_PDFS = 300;
const UNZIP_BATCH = 25;
const WRITE_CHUNK = 1_000;
const PENDING_RETRY_HOURS = 1;
const EMPTY_RETRY_HOURS = 24 * 3;
const RECENT_REFRESH_HOURS = 24 * 7;
const PREPAID_REFRESH_HOURS = 24 * 14;
const HISTORICAL_REFRESH_HOURS = 24 * 180;

function latestTccpHalf(now: Date): HalfYear {
  const lagged = new Date(now.getTime() - TCCP_LAG_DAYS * 86_400_000);
  return { year: lagged.getUTCFullYear(), half: lagged.getUTCMonth() < 6 ? 1 : 2 };
}

function halvesNewestFirst(from: HalfYear, to: HalfYear): HalfYear[] {
  const out: HalfYear[] = [];
  let h = to;
  while (h.year > from.year || (h.year === from.year && h.half >= from.half)) {
    out.push(h);
    h = h.half === 2 ? { year: h.year, half: 1 } : { year: h.year - 1, half: 2 };
  }
  return out;
}

/**
 * The current quarter's prepaid snapshot first, then card quarters and TCCP halves merged newest
 * first by the date each describes.
 */
export function cfpbCardAgreementsPartitions(now: Date, from: Quarter = CARD_AGREEMENTS_FIRST): string[] {
  const cardFrom = compareQuarters(from, CARD_AGREEMENTS_FIRST) > 0 ? from : CARD_AGREEMENTS_FIRST;
  const cards = quartersNewestFirst(cardFrom, latestPublishableQuarter(now, CARD_AGREEMENTS_LAG_DAYS)).map((q) => `card-${quarterKey(q)}`);
  const tccp = halvesNewestFirst(TCCP_FIRST, latestTccpHalf(now)).map((h) => `tccp-${h.year}H${h.half}`);
  const dated = [...cards, ...tccp]
    .map((key) => ({ key, date: partitionDate(parseAgreementPartition(key)!) }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.key.localeCompare(b.key)));
  return [`prepaid-${quarterKey(quarterOf(now))}`, ...dated.map((d) => d.key)];
}

export type PdfTextReader = (bytes: Uint8Array) => Promise<string | null>;

/** Text of a PDF's first pages laid out by Rosetta's reader; null for a scan, a broken file or a timeout. */
export async function readAgreementPdfText(bytes: Uint8Array): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const { getDocumentProxy } = await import("unpdf");
    const read = (async () => {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      try {
        const pages: PdfTextItem[][] = [];
        for (let n = 1; n <= Math.min(Number(pdf.numPages ?? 0), MAX_PDF_PAGES); n += 1) {
          const content = await (await pdf.getPage(n)).getTextContent();
          const items: PdfTextItem[] = [];
          for (const item of content.items) if ("str" in item) items.push(item);
          pages.push(items);
        }
        return layoutDocumentText(pages);
      } finally {
        await pdf.destroy?.();
      }
    })();
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), PDF_READ_TIMEOUT_MS);
    });
    const text = await Promise.race([read, timeout]);
    return text && text.replace(/\s+/g, "").length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface RegistryCfpbCardAgreementsOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  now?: Date;
  pdfReader?: PdfTextReader;
  /** Time allowed for reading PDFs in one run. */
  budgetMs?: number;
  /** Most PDFs read in one run. */
  maxPdfs?: number;
}

export interface RegistryCfpbCardAgreementsResult {
  source: string;
  partitionKey: string;
  family: CfpbAgreementPartition["family"];
  period: string;
  sourceUrl: string;
  agreements: number;
  issuers: number;
  matchedIssuers: number;
  unmatchedIssuers: number;
  feeRead: number;
  feeNoText: number;
  feeFetchFailed: number;
  feeKept: number;
  feePending: number;
  terms: number;
  writtenRows: number;
  missingHeaders: string[];
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
}

type FeeStatus = "read" | "no_text" | "fetch_failed" | "pending" | "kept";

interface LoadedRow {
  row: AgreementRow;
  status: FeeStatus;
  sha256: string | null;
  bytes: number | null;
  terms: FeeTerm[];
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "status" in error && (error as { status: number }).status === 404);
}

async function fetchBytes(url: string, options: RegistryFetchOptions, timeoutMs: number): Promise<Uint8Array | null> {
  try {
    const response = await registryFetch(url, { timeoutMs, ...options });
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function loadInstitutionNames(db: RegistryDb): Promise<Array<{ id: number; name: string }>> {
  const rows = await db<Array<{ id: number; institution_name: string }>>`
    SELECT id, institution_name FROM institution_sources WHERE regulatory_status IS DISTINCT FROM 'inactive'
  `;
  return [...rows].map((r) => ({ id: Number(r.id), name: String(r.institution_name ?? "") }));
}

/** record_key -> file hash for agreements this parser version already read in the partition. */
async function loadAlreadyRead(db: RegistryDb, kind: string, period: string): Promise<Map<string, string | null>> {
  const rows = await db<Array<{ record_key: string; file_sha256: string | null }>>`
    SELECT record_key, file_sha256 FROM cfpb_card_agreements
     WHERE agreement_kind = ${kind} AND period = ${period}
       AND fee_status IN ('read', 'no_text') AND fee_parser_version = ${CFPB_CARD_AGREEMENTS_PARSER_VERSION}
  `;
  return new Map([...rows].map((r) => [r.record_key, r.file_sha256]));
}

async function readCardPdfs(
  zip: Uint8Array,
  rows: AgreementRow[],
  already: Map<string, string | null>,
  reader: PdfTextReader,
  deadline: number,
  maxPdfs: number,
): Promise<LoadedRow[]> {
  const out: LoadedRow[] = [];
  let read = 0;
  for (let at = 0; at < rows.length; at += UNZIP_BATCH) {
    const batch = rows.slice(at, at + UNZIP_BATCH);
    const wanted = new Set(batch.map((r) => r.recordKey));
    const files = unzipSync(zip, { filter: (file) => wanted.has(file.name) });
    for (const row of batch) {
      const bytes = files[row.recordKey];
      if (!bytes) {
        out.push({ row, status: "fetch_failed", sha256: null, bytes: null, terms: [] });
        continue;
      }
      const hash = sha256(bytes);
      if (already.get(row.recordKey) === hash) {
        out.push({ row, status: "kept", sha256: hash, bytes: bytes.length, terms: [] });
        continue;
      }
      if (read >= maxPdfs || Date.now() >= deadline) {
        out.push({ row, status: "pending", sha256: hash, bytes: bytes.length, terms: [] });
        continue;
      }
      read += 1;
      const text = await reader(bytes);
      out.push({
        row,
        status: text ? "read" : "no_text",
        sha256: hash,
        bytes: bytes.length,
        terms: text ? extractFeeTerms(text, "credit_card") : [],
      });
    }
  }
  return out;
}

async function readPrepaidPdfs(
  rows: AgreementRow[],
  already: Map<string, string | null>,
  reader: PdfTextReader,
  deadline: number,
  maxPdfs: number,
  fetchOptions: RegistryFetchOptions,
): Promise<LoadedRow[]> {
  let started = 0;
  return mapWithConcurrency(rows, 4, async (row): Promise<LoadedRow> => {
    if (already.has(row.recordKey)) return { row, status: "kept", sha256: already.get(row.recordKey) ?? null, bytes: null, terms: [] };
    if (!row.agreementUrl || !/^https?:\/\//i.test(row.agreementUrl)) return { row, status: "fetch_failed", sha256: null, bytes: null, terms: [] };
    if (started >= maxPdfs || Date.now() >= deadline) return { row, status: "pending", sha256: null, bytes: null, terms: [] };
    started += 1;
    let bytes: Uint8Array | null = null;
    try {
      bytes = await fetchBytes(row.agreementUrl, { retries: 1, ...fetchOptions }, 60_000);
    } catch {
      bytes = null;
    }
    if (!bytes) return { row, status: "fetch_failed", sha256: null, bytes: null, terms: [] };
    const text = await reader(bytes);
    return { row, status: text ? "read" : "no_text", sha256: sha256(bytes), bytes: bytes.length, terms: text ? extractFeeTerms(text, "prepaid") : [] };
  });
}

async function writeAgreements(
  db: RegistryDb,
  p: CfpbAgreementPartition,
  sourceUrl: string,
  loaded: LoadedRow[],
  matches: Map<string, IssuerMatch>,
  runId: number | null,
  touchFees: boolean,
): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  const periodDate = partitionDate(p);
  for (let at = 0; at < loaded.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(
      loaded.slice(at, at + WRITE_CHUNK).map(({ row, status, sha256: hash, bytes }) => {
        const match = row.issuerName ? matches.get(row.issuerName) : undefined;
        return {
          agreement_kind: row.kind,
          record_key: row.recordKey,
          issuer_name: row.issuerName,
          product_name: row.productName,
          file_name: row.fileName,
          agreement_url: row.agreementUrl,
          external_id: row.externalId,
          agreement_status: row.status,
          effective_date_text: row.effectiveDate,
          institution_id: match?.institutionId ?? null,
          match_method: match?.method ?? null,
          file_sha256: hash,
          file_bytes: bytes,
          fee_status: status === "kept" ? null : status,
          raw_json: row.raw,
        };
      }),
    );
    const result = touchFees
      ? await db`
        INSERT INTO cfpb_card_agreements AS t
          (agreement_kind, period, period_date, record_key, issuer_name, product_name, file_name, agreement_url,
           external_id, agreement_status, effective_date_text, institution_id, match_method, file_sha256, file_bytes,
           fee_status, fee_parser_version, raw_json, source_url, agent_run_id, fetched_at)
        SELECT r.agreement_kind, ${p.period}, ${periodDate}::date, r.record_key, r.issuer_name, r.product_name, r.file_name,
               r.agreement_url, r.external_id, r.agreement_status, r.effective_date_text, r.institution_id, r.match_method,
               r.file_sha256, r.file_bytes, r.fee_status, ${CFPB_CARD_AGREEMENTS_PARSER_VERSION}, r.raw_json, ${sourceUrl},
               ${runId}, NOW()
          FROM jsonb_to_recordset(${payload}::jsonb) AS r(
            agreement_kind text, record_key text, issuer_name text, product_name text, file_name text, agreement_url text,
            external_id text, agreement_status text, effective_date_text text, institution_id bigint, match_method text,
            file_sha256 text, file_bytes bigint, fee_status text, raw_json jsonb)
        ON CONFLICT (agreement_kind, period, record_key) DO UPDATE SET
          issuer_name = EXCLUDED.issuer_name, product_name = EXCLUDED.product_name, file_name = EXCLUDED.file_name,
          agreement_url = EXCLUDED.agreement_url, external_id = EXCLUDED.external_id,
          agreement_status = EXCLUDED.agreement_status, effective_date_text = EXCLUDED.effective_date_text,
          institution_id = EXCLUDED.institution_id, match_method = EXCLUDED.match_method,
          file_sha256 = EXCLUDED.file_sha256, file_bytes = EXCLUDED.file_bytes, fee_status = EXCLUDED.fee_status,
          fee_parser_version = EXCLUDED.fee_parser_version, raw_json = EXCLUDED.raw_json,
          source_url = EXCLUDED.source_url, agent_run_id = EXCLUDED.agent_run_id, fetched_at = NOW()
        RETURNING id, record_key
      `
      : await db`
        UPDATE cfpb_card_agreements AS t SET
          issuer_name = r.issuer_name, product_name = r.product_name, file_name = r.file_name,
          agreement_url = r.agreement_url, external_id = r.external_id, agreement_status = r.agreement_status,
          effective_date_text = r.effective_date_text, institution_id = r.institution_id, match_method = r.match_method,
          raw_json = r.raw_json, source_url = ${sourceUrl}, agent_run_id = ${runId}, fetched_at = NOW()
          FROM jsonb_to_recordset(${payload}::jsonb) AS r(
            agreement_kind text, record_key text, issuer_name text, product_name text, file_name text, agreement_url text,
            external_id text, agreement_status text, effective_date_text text, institution_id bigint, match_method text,
            raw_json jsonb)
         WHERE t.agreement_kind = r.agreement_kind AND t.period = ${p.period} AND t.record_key = r.record_key
        RETURNING t.id, t.record_key
      `;
    for (const r of [...(result as unknown as Array<{ id: number; record_key: string }>)]) ids.set(r.record_key, Number(r.id));
  }
  return ids;
}

async function writeTerms(db: RegistryDb, loaded: LoadedRow[], ids: Map<string, number>): Promise<number> {
  const touched = loaded.filter((l) => l.status !== "kept" && ids.has(l.row.recordKey));
  if (touched.length === 0) return 0;
  const idList = touched.map((l) => ids.get(l.row.recordKey)!);
  for (let at = 0; at < idList.length; at += WRITE_CHUNK) {
    await db`DELETE FROM cfpb_agreement_terms WHERE agreement_id = ANY(${idList.slice(at, at + WRITE_CHUNK)}::bigint[])`;
  }
  const terms = touched.flatMap((l) =>
    l.terms.map((t) => ({
      agreement_id: ids.get(l.row.recordKey)!,
      term_type: t.type,
      quoted_text: t.quotedText,
      amount_usd: t.amountUsd,
      amount_percent: t.amountPercent,
      amount_qualifier: t.qualifier,
      ambiguous: t.ambiguous,
      ambiguity_reason: t.reason,
      line_count: t.lineCount,
    })),
  );
  let written = 0;
  for (let at = 0; at < terms.length; at += WRITE_CHUNK) {
    const payload = JSON.stringify(terms.slice(at, at + WRITE_CHUNK));
    const result = await db`
      INSERT INTO cfpb_agreement_terms
        (agreement_id, term_type, quoted_text, amount_usd, amount_percent, amount_qualifier, ambiguous,
         ambiguity_reason, line_count, parser_version, created_at)
      SELECT r.agreement_id, r.term_type, r.quoted_text, r.amount_usd, r.amount_percent, r.amount_qualifier, r.ambiguous,
             r.ambiguity_reason, r.line_count, ${CFPB_CARD_AGREEMENTS_PARSER_VERSION}, NOW()
        FROM jsonb_to_recordset(${payload}::jsonb) AS r(
          agreement_id bigint, term_type text, quoted_text text, amount_usd numeric, amount_percent numeric,
          amount_qualifier text, ambiguous boolean, ambiguity_reason text, line_count integer)
      ON CONFLICT (agreement_id, term_type) DO UPDATE SET
        quoted_text = EXCLUDED.quoted_text, amount_usd = EXCLUDED.amount_usd, amount_percent = EXCLUDED.amount_percent,
        amount_qualifier = EXCLUDED.amount_qualifier, ambiguous = EXCLUDED.ambiguous,
        ambiguity_reason = EXCLUDED.ambiguity_reason, line_count = EXCLUDED.line_count,
        parser_version = EXCLUDED.parser_version, created_at = NOW()
      RETURNING 1
    `;
    written += [...(result as unknown as unknown[])].length;
  }
  return written;
}

const REQUIRED_FIELDS = ["issuer", "product"];

export async function runRegistryCfpbCardAgreements(options: RegistryCfpbCardAgreementsOptions): Promise<RegistryCfpbCardAgreementsResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const p = parseAgreementPartition(options.partitionKey);
  if (!p) throw new Error(`Invalid CFPB card agreements partition: ${options.partitionKey}`);
  const now = options.now ?? new Date();
  const fetchOptions = options.fetchOptions ?? {};
  const reader = options.pdfReader ?? readAgreementPdfText;
  const deadline = Date.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS);
  const maxPdfs = options.maxPdfs ?? DEFAULT_MAX_PDFS;

  const sourceUrl = p.family === "card" ? cardAgreementZipUrl(p.quarter) : p.family === "prepaid" ? PREPAID_METADATA_URL : tccpCsvUrl(p.half);
  const body = await fetchBytes(sourceUrl, fetchOptions, p.family === "card" ? 300_000 : 120_000);

  let rows: AgreementRow[] = [];
  let check: HeaderCheck | null = null;
  let zipDetail: Record<string, unknown> = {};
  const tccpTerms = new Map<string, FeeTerm[]>();
  let unreadable: string | null = null;
  if (body && p.family === "card") {
    const names: string[] = [];
    try {
      unzipSync(body, {
        filter: (file) => {
          names.push(file.name);
          return false;
        },
      });
      const index = indexCardAgreementZip(names, sourceUrl);
      rows = index.rows;
      zipDetail = { layout_depths: index.layoutDepths, index_files: index.indexFiles, non_pdf_files: index.nonPdfFiles };
    } catch (error) {
      unreadable = `The download is not a readable zip (${error instanceof Error ? error.message : String(error)})`;
    }
  } else if (body) {
    const text = new TextDecoder("utf-8").decode(body);
    if (p.family === "prepaid") {
      const read = readPrepaidMetadata(text);
      check = read.check;
      rows = read.rows;
    } else {
      const read = readTccpCsv(text);
      check = read.check;
      rows = read.rows;
      for (const row of read.rows) tccpTerms.set(row.recordKey, row.terms);
    }
  }
  const missingRequired = check ? REQUIRED_FIELDS.filter((f) => check!.missing.includes(f)) : [];
  const emptyReason = !body
    ? "CFPB has not published this file (HTTP 404)"
    : unreadable
      ? unreadable
      : missingRequired.length > 0
        ? `The header row has no ${missingRequired.join(" or ")} column, so no row can be named`
        : rows.length === 0
          ? "The file holds no agreements"
          : null;

  const latestCard = latestPublishableQuarter(now, CARD_AGREEMENTS_LAG_DAYS);
  const recent =
    p.family === "prepaid" ||
    (p.family === "card" && compareQuarters(p.quarter, latestCard) === 0) ||
    (p.family === "tccp" && p.half.year === latestTccpHalf(now).year && p.half.half === latestTccpHalf(now).half);
  const refreshHours = p.family === "prepaid" ? PREPAID_REFRESH_HOURS : recent ? RECENT_REFRESH_HOURS : HISTORICAL_REFRESH_HOURS;
  const base: RegistryCfpbCardAgreementsResult = {
    source: CFPB_CARD_AGREEMENTS_SOURCE,
    partitionKey: options.partitionKey,
    family: p.family,
    period: p.period,
    sourceUrl,
    agreements: emptyReason ? 0 : rows.length,
    issuers: 0,
    matchedIssuers: 0,
    unmatchedIssuers: 0,
    feeRead: 0,
    feeNoText: 0,
    feeFetchFailed: 0,
    feeKept: 0,
    feePending: 0,
    terms: 0,
    writtenRows: 0,
    missingHeaders: check?.missing ?? [],
    dryRun,
    empty: emptyReason !== null,
    emptyReason,
  };
  const headerDetail = check ? { header: check.header, missing_headers: check.missing, unexpected_headers: check.unexpected, headers_used: check.used } : {};

  if (emptyReason !== null) {
    if (!dryRun) {
      await recordRegistryPartition(db, {
        source: CFPB_CARD_AGREEMENTS_SOURCE,
        partitionKey: options.partitionKey,
        status: "empty",
        rowCount: 0,
        sourceUrl,
        runId: options.runId ?? null,
        nextAttemptAfterHours: body ? refreshHours : recent ? EMPTY_RETRY_HOURS : HISTORICAL_REFRESH_HOURS,
        detail: { parser_version: CFPB_CARD_AGREEMENTS_PARSER_VERSION, family: p.family, period: p.period, reason: emptyReason, ...headerDetail, ...zipDetail },
      });
    }
    return base;
  }

  const issuerNames = [...new Set(rows.map((r) => r.issuerName).filter((n): n is string => Boolean(n)))];
  const matches = matchIssuers(issuerNames, await loadInstitutionNames(db));
  const matchedIssuers = [...matches.values()].filter((m) => m.institutionId !== null).length;
  const withMatches = { ...base, issuers: issuerNames.length, matchedIssuers, unmatchedIssuers: issuerNames.length - matchedIssuers };
  if (dryRun) return withMatches;

  let loaded: LoadedRow[];
  if (p.family === "tccp") {
    loaded = rows.map((row) => ({ row, status: "read" as const, sha256: null, bytes: null, terms: tccpTerms.get(row.recordKey) ?? [] }));
  } else {
    const already = await loadAlreadyRead(db, rows[0].kind, p.period);
    loaded =
      p.family === "card"
        ? await readCardPdfs(body!, rows, already, reader, deadline, maxPdfs)
        : await readPrepaidPdfs(rows, already, reader, deadline, maxPdfs, fetchOptions);
  }
  const count = (s: FeeStatus) => loaded.filter((l) => l.status === s).length;

  const fresh = loaded.filter((l) => l.status !== "kept");
  const kept = loaded.filter((l) => l.status === "kept");
  const ids = new Map<string, number>([
    ...(await writeAgreements(db, p, sourceUrl, fresh, matches, options.runId ?? null, true)),
    ...(await writeAgreements(db, p, sourceUrl, kept, matches, options.runId ?? null, false)),
  ]);
  const terms = await writeTerms(db, loaded, ids);

  const cleaning = cleanAgreementRows(rows, new Map(fresh.map((l) => [l.row.recordKey, l.terms])), matches);
  const termsByType: Record<string, { found: number; with_amount: number }> = {};
  for (const l of fresh) {
    for (const t of l.terms) {
      const entry = (termsByType[t.type] ??= { found: 0, with_amount: 0 });
      entry.found += 1;
      if (t.amountUsd !== null || t.amountPercent !== null) entry.with_amount += 1;
    }
  }
  const result: RegistryCfpbCardAgreementsResult = {
    ...withMatches,
    feeRead: count("read"),
    feeNoText: count("no_text"),
    feeFetchFailed: count("fetch_failed"),
    feeKept: count("kept"),
    feePending: count("pending"),
    terms,
    writtenRows: ids.size,
  };
  const matchedRows = rows.filter((r) => r.issuerName && matches.get(r.issuerName)?.institutionId != null).length;
  await recordRegistryPartition(db, {
    source: CFPB_CARD_AGREEMENTS_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: rows.length,
    matchedCount: matchedRows,
    unmatchedCount: rows.length - matchedRows,
    insertedCount: ids.size,
    sourceUrl,
    runId: options.runId ?? null,
    nextAttemptAfterHours: result.feePending > 0 ? PENDING_RETRY_HOURS : refreshHours,
    detail: {
      parser_version: CFPB_CARD_AGREEMENTS_PARSER_VERSION,
      family: p.family,
      period: p.period,
      ...headerDetail,
      ...zipDetail,
      issuers: result.issuers,
      matched_issuers: result.matchedIssuers,
      unmatched_issuers: result.unmatchedIssuers,
      fee_status: { read: result.feeRead, no_text: result.feeNoText, fetch_failed: result.feeFetchFailed, kept: result.feeKept, pending: result.feePending },
      terms_written: terms,
      terms_by_type: termsByType,
      cleaning,
    },
  });
  return result;
}
