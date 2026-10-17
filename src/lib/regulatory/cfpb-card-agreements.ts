import { createHash } from "node:crypto";
import { fullCompanyKey } from "./cfpb";
import { parseCsv } from "./ncua";
import { quarterEndDate, type Quarter } from "./quarters";

/**
 * CFPB card and prepaid agreement data. Pure: parses downloaded files, never writes to the
 * database and never calls a model.
 *
 * Three partition families share one loader:
 * - `card-2026Q2`: the Credit Card Agreement Database quarterly zip (issuers' agreement PDFs,
 *   one folder per issuer). One row per agreement file.
 * - `prepaid-2026Q4`: the Prepaid Product Agreements Database metadata CSV, a snapshot of the
 *   quarter the run happens in (CFPB publishes only the current set). One row per agreement.
 * - `tccp-2026H1`: the Terms of Credit Card Plans survey CSV (twice yearly: January and July
 *   data). One row per plan.
 *
 * Every URL, folder layout and column name below is written from memory because the CFPB site
 * is not reachable from the build sandbox, so each read checks the file it got: the CSV header
 * rows against the expected names (missing and unexpected headers are reported), and the zip's
 * folder depth. A field that is absent stays null; nothing is filled in or guessed.
 *
 * Fee terms come only from clearly labelled lines (a line that starts with the fee's own label,
 * or a TCCP column named for the fee). A line with one amount and no hedging words is parsed;
 * anything else ("either $10 or 5%", "$0 the first year, then $95") keeps its text with a null
 * amount. Dollar amounts and percentages are separate fields and are never pooled.
 */

export type AgreementKind = "credit_card" | "prepaid" | "tccp_plan";
export type PartitionFamily = "card" | "prepaid" | "tccp";

/* ------------------------------------------------------------------ URLs -- */

/** Quarterly archive of every card agreement on file (unconfirmed path, see module comment). */
export function cardAgreementZipUrl(q: Quarter): string {
  return `https://files.consumerfinance.gov/a/assets/credit-card-agreements/archive-zips/Credit_Card_Agreements_${q.year}_Q${q.quarter}.zip`;
}

/** Metadata for every prepaid agreement on file (unconfirmed path). */
export const PREPAID_METADATA_URL = "https://files.consumerfinance.gov/a/assets/prepaid-agreements/prepaid_metadata_all_agreements.csv";

/** Terms of Credit Card Plans survey CSV for one half-year (unconfirmed path). */
export function tccpCsvUrl(half: HalfYear): string {
  const month = half.half === 1 ? "01" : "07";
  return `https://files.consumerfinance.gov/a/assets/tccp/TCCP_${half.year}_${month}.csv`;
}

/* ------------------------------------------------------------ partitions -- */

export interface HalfYear {
  year: number;
  half: 1 | 2;
}

export type CfpbAgreementPartition =
  | { family: "card"; key: string; quarter: Quarter; period: string }
  | { family: "prepaid"; key: string; quarter: Quarter; period: string }
  | { family: "tccp"; key: string; half: HalfYear; period: string };

export function parseAgreementPartition(key: string): CfpbAgreementPartition | null {
  const trimmed = key.trim().toLowerCase();
  const q = /^(card|prepaid)-(\d{4})q([1-4])$/.exec(trimmed);
  if (q) {
    const quarter = { year: Number(q[2]), quarter: Number(q[3]) as Quarter["quarter"] };
    return { family: q[1] as "card" | "prepaid", key: trimmed, quarter, period: `${quarter.year}Q${quarter.quarter}` };
  }
  const h = /^tccp-(\d{4})h([12])$/.exec(trimmed);
  if (h) {
    const half = { year: Number(h[1]), half: Number(h[2]) as 1 | 2 };
    return { family: "tccp", key: trimmed, half, period: `${half.year}H${half.half}` };
  }
  return null;
}

/** The date a partition describes: quarter end, or the survey month (January 1 / July 1). */
export function partitionDate(p: CfpbAgreementPartition): string {
  if (p.family === "tccp") return `${p.half.year}-${p.half.half === 1 ? "01" : "07"}-01`;
  return quarterEndDate(p.quarter);
}

/* ------------------------------------------------------------ fee labels -- */

export type FeeTermType =
  | "annual_fee"
  | "late_fee"
  | "foreign_transaction_fee"
  | "cash_advance_fee"
  | "balance_transfer_fee"
  | "returned_payment_fee"
  | "monthly_fee"
  | "atm_fee"
  | "reload_fee"
  | "purchase_apr";

export const CARD_FEE_TYPES: readonly FeeTermType[] = [
  "annual_fee",
  "late_fee",
  "foreign_transaction_fee",
  "cash_advance_fee",
  "balance_transfer_fee",
  "returned_payment_fee",
];
export const PREPAID_FEE_TYPES: readonly FeeTermType[] = ["monthly_fee", "atm_fee", "reload_fee"];

interface FeeLabel {
  type: FeeTermType;
  label: RegExp;
  excludes?: RegExp;
}

const BULLET = String.raw`^\s*(?:[•·\-–*]\s*)?`;
const NOT_A_RATE = /\bAPR\b|annual percentage rate|interest rate/i;

/** A line is a fee line only when it starts with the fee's label. */
const CARD_LABELS: readonly FeeLabel[] = [
  { type: "annual_fee", label: new RegExp(`${BULLET}annual\\s+(?:membership\\s+)?fees?\\b`, "i"), excludes: NOT_A_RATE },
  { type: "late_fee", label: new RegExp(`${BULLET}late\\s+(?:payment\\s+)?(?:fees?|payments?)\\b`, "i"), excludes: NOT_A_RATE },
  {
    type: "foreign_transaction_fee",
    label: new RegExp(`${BULLET}foreign\\s+(?:transactions?|currency\\s+conversion|currency\\s+transactions?)(?:\\s+fees?)?\\b`, "i"),
    excludes: NOT_A_RATE,
  },
  { type: "cash_advance_fee", label: new RegExp(`${BULLET}cash\\s+advances?(?:\\s+fees?)?\\b`, "i"), excludes: NOT_A_RATE },
  { type: "balance_transfer_fee", label: new RegExp(`${BULLET}balance\\s+transfers?(?:\\s+fees?)?\\b`, "i"), excludes: NOT_A_RATE },
  { type: "returned_payment_fee", label: new RegExp(`${BULLET}returned\\s+payments?(?:\\s+fees?)?\\b`, "i"), excludes: NOT_A_RATE },
];

const PREPAID_LABELS: readonly FeeLabel[] = [
  { type: "monthly_fee", label: new RegExp(`${BULLET}monthly\\s+(?:usage\\s+|maintenance\\s+|service\\s+|plan\\s+|account\\s+)?fees?\\b`, "i") },
  { type: "atm_fee", label: new RegExp(`${BULLET}atm\\s+(?:cash\\s+)?withdrawals?(?:\\s+fees?)?\\b`, "i"), excludes: /balance\s+inquiry/i },
  { type: "reload_fee", label: new RegExp(`${BULLET}(?:cash\\s+reloads?|reload)(?:\\s+fees?)?\\b`, "i") },
];

/** Lines longer than this are prose, not a labelled fee line. */
export const MAX_FEE_LINE_LENGTH = 180;

/* -------------------------------------------------------------- amounts -- */

export type AmountQualifier = "exact" | "up_to" | "none";

export interface ParsedAmount {
  amountUsd: number | null;
  amountPercent: number | null;
  qualifier: AmountQualifier | null;
  ambiguous: boolean;
  reason: string | null;
}

const DOLLAR = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/g;
const PERCENT = /(\d{1,3}(?:\.\d{1,4})?)\s?%/g;
const HEDGE = /\b(or|either|whichever|greater|lesser|after that|thereafter|introductory|intro|first year|then|waived|varies|vary|depending|depends|plus|minimum|maximum|min\.?|max\.?)\b/i;
const NONE = /^\s*(?:none|no fee|not applicable|n\/a|\$0(?:\.00)?|0)\s*\.?\s*$/i;

/** One amount from the value part of a labelled line or a TCCP cell; anything hedged is ambiguous. */
export function parseFeeAmount(value: string | null | undefined): ParsedAmount {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  const blank: ParsedAmount = { amountUsd: null, amountPercent: null, qualifier: null, ambiguous: false, reason: null };
  if (!text) return { ...blank, reason: "blank" };
  if (NONE.test(text)) return { ...blank, amountUsd: 0, qualifier: "none" };
  const dollars = [...text.matchAll(DOLLAR)].map((m) => Number(`${m[1].replace(/,/g, "")}${m[2] ?? ""}`));
  const percents = [...text.matchAll(PERCENT)].map((m) => Number(m[1]));
  if (dollars.length + percents.length === 0) return { ...blank, ambiguous: true, reason: "no_amount" };
  if (dollars.length + percents.length > 1) return { ...blank, ambiguous: true, reason: "several_amounts" };
  if (HEDGE.test(text)) return { ...blank, ambiguous: true, reason: "hedged" };
  const qualifier: AmountQualifier = /\bup to\b/i.test(text) ? "up_to" : "exact";
  if (dollars.length === 1) return { ...blank, amountUsd: dollars[0], qualifier };
  return { ...blank, amountPercent: percents[0], qualifier };
}

/* ----------------------------------------------------------- extraction -- */

export interface FeeTerm {
  type: FeeTermType;
  quotedText: string;
  amountUsd: number | null;
  amountPercent: number | null;
  qualifier: AmountQualifier | null;
  ambiguous: boolean;
  reason: string | null;
  /** Labelled lines found for this fee; more than one disagreeing line makes the term ambiguous. */
  lineCount: number;
}

function sameAmount(a: ParsedAmount, b: ParsedAmount): boolean {
  return a.amountUsd === b.amountUsd && a.amountPercent === b.amountPercent;
}

/**
 * Fee terms from an agreement's text. For each fee the first labelled line with an amount (or
 * "None") is kept; when another labelled line states a different amount the term keeps the
 * first line's text and its amount goes null, so a disclosure box and a later paragraph that
 * disagree are never settled by guessing.
 */
export function extractFeeTerms(text: string, kind: "credit_card" | "prepaid"): FeeTerm[] {
  const labels = kind === "credit_card" ? CARD_LABELS : PREPAID_LABELS;
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const found = new Map<FeeTermType, Array<{ line: string; parsed: ParsedAmount }>>();
  for (const line of lines) {
    if (line.length > MAX_FEE_LINE_LENGTH) continue;
    for (const rule of labels) {
      const match = rule.label.exec(line);
      if (!match) continue;
      if (rule.excludes?.test(line)) continue;
      const parsed = parseFeeAmount(line.slice(match[0].length).replace(/^[\s:.\-–]+/, ""));
      if (parsed.reason === "blank" || parsed.reason === "no_amount") continue;
      found.set(rule.type, [...(found.get(rule.type) ?? []), { line, parsed }]);
      break;
    }
  }
  const terms: FeeTerm[] = [];
  for (const rule of labels) {
    const hits = found.get(rule.type);
    if (!hits || hits.length === 0) continue;
    const first = hits[0];
    const clear = hits.filter((h) => !h.parsed.ambiguous);
    const disagree = clear.some((h) => !sameAmount(h.parsed, clear[0].parsed));
    const chosen = disagree ? null : (clear[0] ?? null);
    terms.push({
      type: rule.type,
      quotedText: (chosen ?? first).line,
      amountUsd: chosen?.parsed.amountUsd ?? null,
      amountPercent: chosen?.parsed.amountPercent ?? null,
      qualifier: chosen?.parsed.qualifier ?? null,
      ambiguous: chosen === null,
      reason: disagree ? "lines_disagree" : chosen ? null : first.parsed.reason,
      lineCount: hits.length,
    });
  }
  return terms;
}

/* ------------------------------------------------------- agreement rows -- */

export interface AgreementRow {
  kind: AgreementKind;
  /** Stable key inside one partition: zip path, prepaid agreement id or URL, or a TCCP row hash. */
  recordKey: string;
  issuerName: string | null;
  productName: string | null;
  fileName: string | null;
  agreementUrl: string | null;
  externalId: string | null;
  status: string | null;
  effectiveDate: string | null;
  raw: Record<string, string>;
}

/* --------------------------------------------------- card agreement zip -- */

export interface CardZipIndex {
  rows: AgreementRow[];
  /** Folder depth below the common root -> PDFs; the expected layout is 2 (issuer/file). */
  layoutDepths: Record<string, number>;
  /** CSV or spreadsheet files in the zip, which may be an issuer index; reported, not trusted. */
  indexFiles: string[];
  nonPdfFiles: number;
}

const PDF = /\.pdf$/i;
const INDEX_FILE = /\.(csv|xlsx?|txt)$/i;

function stem(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Agreement rows from the zip's file list. Leading folders every PDF shares are dropped; then
 * `issuer/file.pdf` names the issuer by folder and the product by file, and
 * `issuer/product/file.pdf` takes the product from the middle folder. Any other depth keeps the
 * row with a null issuer and is counted in layoutDepths.
 */
export function indexCardAgreementZip(paths: string[], zipUrl: string): CardZipIndex {
  const files = paths.filter((p) => !p.endsWith("/"));
  const pdfs = files.filter((p) => PDF.test(p)).sort();
  const indexFiles = files.filter((p) => INDEX_FILE.test(p));
  const split = pdfs.map((p) => p.split("/").filter(Boolean));
  let common = 0;
  if (split.length > 0) {
    const shortest = Math.min(...split.map((s) => s.length - 1));
    while (common < shortest && split.every((s) => s[common] === split[0][common])) common += 1;
    // Keep the issuer folder when the zip holds a single issuer.
    if (common > 0 && split.every((s) => s.length - common === 1)) common -= 1;
  }
  const layoutDepths: Record<string, number> = {};
  const rows: AgreementRow[] = split.map((segments, i) => {
    const rest = segments.slice(common);
    layoutDepths[String(rest.length)] = (layoutDepths[String(rest.length)] ?? 0) + 1;
    const fileName = segments[segments.length - 1];
    const issuer = rest.length === 2 || rest.length === 3 ? rest[0].trim() : null;
    const product = rest.length === 3 ? rest[1].trim() : rest.length === 2 ? stem(fileName) : null;
    return {
      kind: "credit_card",
      recordKey: pdfs[i],
      issuerName: issuer || null,
      productName: product || null,
      fileName,
      agreementUrl: `${zipUrl}#${pdfs[i]}`,
      externalId: null,
      status: null,
      effectiveDate: null,
      raw: { path: pdfs[i] },
    };
  });
  return { rows, layoutDepths, indexFiles, nonPdfFiles: files.length - pdfs.length };
}

/* ------------------------------------------------------- header checking -- */

export interface HeaderCheck {
  header: string[];
  /** Fields whose every alias is absent from the header. */
  missing: string[];
  /** Header names no field reads; kept in raw_json, reported so a rename is noticed. */
  unexpected: string[];
  /** field -> the header actually used. */
  used: Record<string, string>;
}

function headerKey(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function checkHeader(header: string[], fields: Record<string, readonly string[]>): HeaderCheck {
  const present = new Map(header.map((h) => [headerKey(h), h]));
  const used: Record<string, string> = {};
  const missing: string[] = [];
  for (const [field, aliases] of Object.entries(fields)) {
    const hit = aliases.map(headerKey).find((alias) => present.has(alias));
    if (hit) used[field] = present.get(hit)!;
    else missing.push(field);
  }
  const usedSet = new Set(Object.values(used));
  return { header, missing, unexpected: header.filter((h) => !usedSet.has(h)), used };
}

/** Rows keyed by the header as written, plus the header row itself. */
function csvRows(text: string): { header: string[]; rows: Array<Record<string, string>> } {
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const header = splitHeader(firstLine);
  const upper = parseCsv(text.replace(/^﻿/, ""));
  // parseCsv upper-cases keys; map them back to the header as written.
  const back = new Map(header.map((h) => [h.trim().toUpperCase(), h]));
  const rows = upper.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [back.get(k) ?? k, v])));
  return { header, rows };
}

function splitHeader(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(field.trim());
      field = "";
    } else field += ch;
  }
  out.push(field.trim());
  return out.filter((h) => h !== "");
}

function cell(row: Record<string, string>, check: HeaderCheck, field: string): string | null {
  const header = check.used[field];
  if (!header) return null;
  const value = (row[header] ?? "").trim();
  return value === "" ? null : value;
}

/* --------------------------------------------------------- prepaid CSV -- */

export const PREPAID_FIELDS = {
  issuer: ["issuer_name", "issuer"],
  product: ["product_name", "product"],
  agreementId: ["agreement_id", "id"],
  url: ["agreement_url", "direct_download", "url", "path", "download_url"],
  effectiveDate: ["effective_date"],
  status: ["current_status", "status"],
  withdrawalDate: ["withdrawal_date"],
  productType: ["prepaid_product_type", "product_type"],
} as const;

export interface PrepaidRead {
  check: HeaderCheck;
  rows: AgreementRow[];
}

export function readPrepaidMetadata(text: string): PrepaidRead {
  const { header, rows } = csvRows(text);
  const check = checkHeader(header, PREPAID_FIELDS);
  return {
    check,
    rows: rows.map((row, i) => {
      const url = cell(row, check, "url");
      const id = cell(row, check, "agreementId");
      const fileName = url ? decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() ?? "") || null : null;
      return {
        kind: "prepaid" as const,
        recordKey: id ? `id:${id}` : url ? `url:${url}` : `row:${rowHash(row)}:${i}`,
        issuerName: cell(row, check, "issuer"),
        productName: cell(row, check, "product"),
        fileName,
        agreementUrl: url,
        externalId: id,
        status: cell(row, check, "status") ?? (cell(row, check, "withdrawalDate") ? "withdrawn" : null),
        effectiveDate: cell(row, check, "effectiveDate"),
        raw: row,
      };
    }),
  };
}

/* ------------------------------------------------------------ TCCP CSV -- */

export const TCCP_FIELDS = {
  issuer: ["institution_name", "issuer_name", "issuer", "bank_name"],
  product: ["product_name", "plan_name", "card_name"],
  reportDate: ["report_date", "survey_date", "as_of_date"],
  availability: ["availability_of_credit_card_plan", "availability", "geographic_availability"],
  state: ["location", "state", "states"],
  cardType: ["credit_card_type", "card_type"],
  annualFee: ["annual_fee"],
  lateFee: ["late_fee"],
  foreignTransactionFee: ["foreign_transaction_fee", "foreign_transaction_fees"],
  cashAdvanceFee: ["cash_advance_fee", "cash_advance_fees"],
  balanceTransferFee: ["balance_transfer_fee", "balance_transfer_fees"],
  returnedPaymentFee: ["returned_payment_fee", "returned_payment_fees"],
  purchaseApr: ["purchase_apr_median", "median_purchase_apr", "purchase_apr"],
} as const;

const TCCP_TERM_FIELDS: ReadonlyArray<[keyof typeof TCCP_FIELDS, FeeTermType]> = [
  ["annualFee", "annual_fee"],
  ["lateFee", "late_fee"],
  ["foreignTransactionFee", "foreign_transaction_fee"],
  ["cashAdvanceFee", "cash_advance_fee"],
  ["balanceTransferFee", "balance_transfer_fee"],
  ["returnedPaymentFee", "returned_payment_fee"],
  ["purchaseApr", "purchase_apr"],
];

export interface TccpRow extends AgreementRow {
  terms: FeeTerm[];
}

export interface TccpRead {
  check: HeaderCheck;
  rows: TccpRow[];
}

function rowHash(row: Record<string, string>): string {
  return createHash("sha256").update(JSON.stringify(row)).digest("hex").slice(0, 24);
}

/**
 * A bare number in a TCCP cell has no unit written beside it, so it is read only for APR
 * columns (a rate) and the fee columns' own "$" or "%" signs; otherwise its text is kept.
 */
function tccpCellAmount(value: string, type: FeeTermType): ParsedAmount {
  if (type === "purchase_apr" && /^\d{1,3}(\.\d+)?$/.test(value.trim())) {
    return { amountUsd: null, amountPercent: Number(value.trim()), qualifier: "exact", ambiguous: false, reason: null };
  }
  return parseFeeAmount(value);
}

export function readTccpCsv(text: string): TccpRead {
  const { header, rows } = csvRows(text);
  const check = checkHeader(header, TCCP_FIELDS);
  return {
    check,
    rows: rows.map((row) => {
      const terms: FeeTerm[] = [];
      for (const [field, type] of TCCP_TERM_FIELDS) {
        const value = cell(row, check, field);
        if (value === null) continue;
        const parsed = tccpCellAmount(value, type);
        if (parsed.reason === "blank") continue;
        terms.push({
          type,
          quotedText: `${check.used[field]}: ${value}`,
          amountUsd: parsed.amountUsd,
          amountPercent: parsed.amountPercent,
          qualifier: parsed.qualifier,
          ambiguous: parsed.ambiguous,
          reason: parsed.reason,
          lineCount: 1,
        });
      }
      return {
        kind: "tccp_plan" as const,
        recordKey: `row:${rowHash(row)}`,
        issuerName: cell(row, check, "issuer"),
        productName: cell(row, check, "product"),
        fileName: null,
        agreementUrl: null,
        externalId: null,
        status: cell(row, check, "availability"),
        effectiveDate: cell(row, check, "reportDate"),
        raw: row,
        terms,
      };
    }),
  };
}

/* ------------------------------------------------------ issuer matching -- */

export interface InstitutionName {
  id: number;
  name: string;
}

export interface IssuerMatch {
  institutionId: number | null;
  method: "exact_name" | "normalized_name" | null;
  /** Why a name stayed unmatched: no institution has it, or more than one does. */
  reason: "no_match" | "ambiguous" | null;
  candidates: number;
}

/** Legal suffixes dropped (fullCompanyKey) plus a trailing "N.A." / "National Association". */
export function issuerMatchKey(name: string | null | undefined): string {
  return fullCompanyKey(name)
    .replace(/\s+(N\s?A|NATIONAL ASSOCIATION)$/, "")
    .trim();
}

/**
 * Issuer name -> institution, only when exactly one institution carries the same name: first
 * ignoring case, then after issuerMatchKey on both sides. Two or more candidates stay unmatched
 * as ambiguous. Nothing partial, abbreviated or "close enough" is ever accepted.
 */
export function matchIssuers(names: Iterable<string>, institutions: InstitutionName[]): Map<string, IssuerMatch> {
  const exact = new Map<string, Set<number>>();
  const normalized = new Map<string, Set<number>>();
  const add = (map: Map<string, Set<number>>, key: string, id: number) => {
    if (!key) return;
    map.set(key, (map.get(key) ?? new Set()).add(id));
  };
  for (const inst of institutions) {
    add(exact, inst.name.trim().toLowerCase(), inst.id);
    add(normalized, issuerMatchKey(inst.name), inst.id);
  }
  const out = new Map<string, IssuerMatch>();
  for (const name of names) {
    if (out.has(name)) continue;
    const e = exact.get(name.trim().toLowerCase());
    if (e && e.size === 1) {
      out.set(name, { institutionId: [...e][0], method: "exact_name", reason: null, candidates: 1 });
      continue;
    }
    if (e && e.size > 1) {
      out.set(name, { institutionId: null, method: null, reason: "ambiguous", candidates: e.size });
      continue;
    }
    const key = issuerMatchKey(name);
    const n = key.length >= 3 ? normalized.get(key) : undefined;
    if (n && n.size === 1) out.set(name, { institutionId: [...n][0], method: "normalized_name", reason: null, candidates: 1 });
    else out.set(name, { institutionId: null, method: null, reason: n && n.size > 1 ? "ambiguous" : "no_match", candidates: n?.size ?? 0 });
  }
  return out;
}

/* -------------------------------------------------------- cleaning pass -- */

export interface CleaningReport {
  rows: number;
  missingFields: Record<string, number>;
  duplicateKeys: number;
  /** Same issuer, product and file name under different record keys. */
  duplicateAgreements: number;
  unmatchedIssuers: Array<{ name: string; reason: string; candidates: number }>;
  unmatchedIssuerCount: number;
  ambiguousTerms: Record<string, number>;
  impossibleValues: Array<{ recordKey: string; type: string; value: number; why: string }>;
  outliers: Array<{ recordKey: string; type: string; value: number; median: number }>;
}

const MAX_LISTED = 200;
/** A value this many times its fee type's median (with at least 10 values) is listed as an outlier. */
export const OUTLIER_RATIO = 5;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Gaps and outliers in one partition, for the partition detail. Reports only; it never changes,
 * drops or fills a value.
 */
export function cleanAgreementRows(
  rows: AgreementRow[],
  termsByKey: Map<string, FeeTerm[]>,
  matches: Map<string, IssuerMatch>,
): CleaningReport {
  const missingFields: Record<string, number> = {};
  const miss = (field: string) => (missingFields[field] = (missingFields[field] ?? 0) + 1);
  const keys = new Set<string>();
  const agreements = new Set<string>();
  let duplicateKeys = 0;
  let duplicateAgreements = 0;
  for (const row of rows) {
    if (!row.issuerName) miss("issuer_name");
    if (!row.productName) miss("product_name");
    if (row.kind !== "tccp_plan" && !row.fileName) miss("file_name");
    if (row.kind === "prepaid" && !row.agreementUrl) miss("agreement_url");
    if (keys.has(row.recordKey)) duplicateKeys += 1;
    keys.add(row.recordKey);
    if (row.kind !== "tccp_plan") {
      const a = `${row.issuerName}|${row.productName}|${row.fileName}`;
      if (agreements.has(a)) duplicateAgreements += 1;
      agreements.add(a);
    }
  }
  const unmatched = [...matches.entries()]
    .filter(([, m]) => m.institutionId === null)
    .map(([name, m]) => ({ name, reason: m.reason ?? "no_match", candidates: m.candidates }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const ambiguousTerms: Record<string, number> = {};
  const impossibleValues: CleaningReport["impossibleValues"] = [];
  const byType = new Map<string, Array<{ key: string; value: number }>>();
  for (const [recordKey, terms] of termsByKey) {
    for (const term of terms) {
      if (term.ambiguous) ambiguousTerms[term.type] = (ambiguousTerms[term.type] ?? 0) + 1;
      for (const [value, unit] of [[term.amountUsd, "usd"], [term.amountPercent, "pct"]] as const) {
        if (value === null) continue;
        if (value < 0) impossibleValues.push({ recordKey, type: term.type, value, why: "negative" });
        else if (unit === "pct" && value > 100) impossibleValues.push({ recordKey, type: term.type, value, why: "percent_over_100" });
        else if (value > 0) {
          const k = `${term.type}:${unit}`;
          byType.set(k, [...(byType.get(k) ?? []), { key: recordKey, value }]);
        }
      }
    }
  }
  const outliers: CleaningReport["outliers"] = [];
  for (const [k, list] of byType) {
    if (list.length < 10) continue;
    const m = median(list.map((x) => x.value))!;
    for (const x of list) if (x.value > m * OUTLIER_RATIO) outliers.push({ recordKey: x.key, type: k, value: x.value, median: m });
  }
  return {
    rows: rows.length,
    missingFields,
    duplicateKeys,
    duplicateAgreements,
    unmatchedIssuers: unmatched.slice(0, MAX_LISTED),
    unmatchedIssuerCount: unmatched.length,
    ambiguousTerms,
    impossibleValues: impossibleValues.slice(0, MAX_LISTED),
    outliers: outliers.slice(0, MAX_LISTED),
  };
}
