import { htmlToText } from "./fed";
import { registryFetch, RegistryHttpError, type RegistryFetchOptions } from "./http";
import { eventDate, exactNameKey, findDataLinks, hashKey } from "./industry-events";

/**
 * Decisions on bank merger and acquisition applications: Federal Reserve Board orders on banking
 * applications and OCC corporate decisions on mergers. Pure: fetches, parses and checks; never
 * writes to the database.
 *
 * What is read (addresses and layouts from memory; the sites are not reachable from where this
 * was written, so every field is checked at run time and gaps are reported, never filled):
 *   Fed  the press-release feed https://www.federalreserve.gov/json/ne-press.json, entries with
 *        press type "Orders on Banking Applications" (fields d, t, l, pt); each release page for
 *        its sentence naming applicant and target and its link to the order PDF; the order PDF
 *        for the competitive analysis.
 *   OCC  the Interpretations and Actions index and its monthly pages, PDF corporate decisions and
 *        conditional approvals whose text is about a merger, purchase or acquisition.
 *
 * Competitive figures (HHI change, post-merger HHI, deposit share) are taken only from a sentence
 * of the order that states them, and that sentence is kept verbatim beside the numbers. A figure
 * that no pattern reads stays absent; nothing is computed or estimated here.
 */

export const FED_PRESS_FEED = "https://www.federalreserve.gov/json/ne-press.json";
export const FED_BASE = "https://www.federalreserve.gov";
export const FED_ORDER_PRESS_TYPE = /orders on banking applications/i;
export const FED_FEED_FIELDS = ["d", "t", "l", "pt"] as const;

export const OCC_DECISION_PAGES = [
  "https://www.occ.gov/topics/charters-and-licensing/interpretations-and-actions/index-interpretations-and-actions.html",
] as const;

export type DecisionAgency = "frb" | "occ";
export type DecisionKind = "approval" | "conditional_approval" | "denial" | "withdrawal" | "other";

export interface CompetitiveFigure {
  /** The order's own sentence, verbatim (whitespace collapsed), capped at 600 characters. */
  sentence: string;
  market: string | null;
  hhi_change: number | null;
  hhi_post: number | null;
  /** Every "<n> percent of ... deposits" in the sentence, as stated. */
  deposit_shares: number[];
}

export interface MergerDecision {
  eventKey: string;
  agency: DecisionAgency;
  decisionDate: string | null;
  kind: DecisionKind;
  title: string | null;
  applicant: string | null;
  target: string | null;
  /** The sentence the applicant and target were read from. */
  partiesSentence: string | null;
  documentUrl: string | null;
  pageUrl: string;
  pdfStatus: "read" | "no_pdf" | "fetch_failed" | "not_read";
  competitive: CompetitiveFigure[];
  raw: Record<string, unknown>;
}

export interface FetchedDecisions {
  sourceUrl: string;
  decisions: MergerDecision[];
  missingFields: string[];
  unexpectedFields: string[];
  /** Entries left for a later run (PDF budget used up). */
  deferred: number;
  reason: string | null;
  extra: Record<string, unknown>;
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function num(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function decisionKind(text: string): DecisionKind {
  if (/conditional(ly)? approv/i.test(text)) return "conditional_approval";
  if (/\bden(y|ied|ial|ies)\b/i.test(text)) return "denial";
  if (/withdr[ae]w/i.test(text)) return "withdrawal";
  if (/approv/i.test(text)) return "approval";
  return "other";
}

/** "X, of Columbus, Ohio" -> "X"; trailing parentheticals and "and its subsidiary" tails dropped. */
export function partyName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const out = clean(raw)
    .split(/,\s+(?:of|both of|each of|all of)\s+/i)[0]
    .split(/\s+\((?:"|“)/)[0]
    .replace(/^(?:the\s+)?(?:voting\s+)?(?:shares\s+of\s+|assets\s+of\s+|all\s+of\s+the\s+(?:voting\s+)?shares\s+of\s+)/i, "")
    .replace(/[,;.]+$/, "")
    .trim();
  return out.length >= 3 && out.length <= 160 ? out : null;
}

const PARTY_PATTERNS: RegExp[] = [
  // "...approval of the application by X to acquire Y." / "...proposal by X to merge with Y"
  /\b(?:application|applications|proposal|notice)s?\s+(?:by|of|from)\s+(.+?)\s+to\s+(?:acquire|merge\s+with|purchase(?:\s+certain\s+assets\s+of)?|acquire\s+and\s+merge\s+with)\s+(.+?)(?:\s+and\s+(?:thereby|its|to\s)|[.;](?:\s|$)|$)/i,
  // OCC: "to merge X with and into Y" (Y survives: Y is the applicant).
  /\bmerge\s+(.+?)\s+with\s+and\s+into\s+(.+?)(?:[,.;(]|\s+under\s|$)/i,
];

/** Applicant and target from one sentence, or nulls. For "A with and into B", B is the applicant. */
export function readParties(text: string): { applicant: string | null; target: string | null; sentence: string | null } {
  const sentences = clean(text).split(/(?<=[.;])\s+(?=[A-Z“"])/);
  for (const sentence of sentences) {
    const a = PARTY_PATTERNS[0].exec(sentence);
    if (a) return { applicant: partyName(a[1]), target: partyName(a[2]), sentence: sentence.slice(0, 600) };
    const b = PARTY_PATTERNS[1].exec(sentence);
    // Location follows the first comma in OCC letters ("X, N.A., Dayton, Ohio"): the name is what precedes it.
    if (b) return { applicant: partyName(b[2]), target: partyName(b[1].split(",")[0]), sentence: sentence.slice(0, 600) };
  }
  return { applicant: null, target: null, sentence: null };
}

const COMPETITIVE_SENTENCE = /\bHHI\b|Herfindahl|percent of (?:the )?(?:total )?(?:insured )?deposits/i;

/**
 * Sentences of an order that state HHI or deposit-share figures, each with the numbers it states.
 * Footnote markers glued to numbers ("1,450.12") are not unpicked: such a figure is left null.
 */
export function competitiveFigures(text: string, max = 40): CompetitiveFigure[] {
  const out: CompetitiveFigure[] = [];
  const sentences = clean(text).split(/(?<=[.])\s+(?=[A-Z(])/);
  for (const sentence of sentences) {
    if (!COMPETITIVE_SENTENCE.test(sentence) || !/\d/.test(sentence)) continue;
    const s = sentence.slice(0, 600);
    const hhi = /(?:HHI|Herfindahl[^.]*?Index)[^.]*?(increase|decrease|rise|decline)\w*\s+(?:by\s+|of\s+)?(?:approximately\s+|about\s+)?(\d[\d,]*)\s+points?[^.]*?\bto\s+(?:a\s+level\s+of\s+)?(?:approximately\s+)?(\d{1,2},?\d{3}|\d{3})\b/i.exec(s);
    const changeOnly = hhi ? null : /(?:HHI|Herfindahl)[^.]*?(increase|decrease|rise|decline)\w*\s+(?:by\s+|of\s+)?(?:approximately\s+)?(\d[\d,]*)\s+points?/i.exec(s);
    const sign = (word: string | undefined) => (word && /decrease|decline/i.test(word) ? -1 : 1);
    const shares = [...s.matchAll(/(\d{1,3}(?:\.\d+)?)\s+percent\s+of\s+(?:the\s+)?(?:total\s+)?(?:insured\s+)?deposits/gi)]
      .map((m) => Number(m[1]))
      .filter((v) => Number.isFinite(v));
    const market = /\b(?:[Ii]n|[Oo]f)\s+the\s+([A-Z][A-Za-z.'’\- ]{1,60}?(?:,\s+[A-Z][A-Za-z]+)?)\s+(?:banking\s+)?market\b/.exec(s)?.[1] ?? null;
    const change = hhi ? num(hhi[2]) : changeOnly ? num(changeOnly[2]) : null;
    const word = hhi?.[1] ?? changeOnly?.[1];
    out.push({
      sentence: s,
      market,
      hhi_change: change === null ? null : sign(word) * change,
      hhi_post: hhi ? num(hhi[3]) : null,
      deposit_shares: shares,
    });
    if (out.length >= max) break;
  }
  return out;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

async function fetchPdfText(url: string, options: RegistryFetchOptions): Promise<string> {
  const response = await registryFetch(url, { timeoutMs: 120_000, ...options });
  return pdfText(new Uint8Array(await response.arrayBuffer()));
}

// ---------------------------------------------------------------------------
// Federal Reserve orders
// ---------------------------------------------------------------------------

export interface FedFeedEntry {
  date: string | null;
  title: string | null;
  url: string;
  pressType: string | null;
  raw: Record<string, unknown>;
}

/** "10/16/2026 4:15:00 PM" -> "2026-10-16". */
export function fedFeedDate(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
  return m ? eventDate(`${m[1]}/${m[2]}/${m[3]}`) : eventDate(raw);
}

/** Order entries from the press feed, with the fields the feed was expected to carry and did not. */
export function parseFedFeed(body: unknown): { entries: FedFeedEntry[]; missingFields: string[]; unexpectedFields: string[] } {
  const list = Array.isArray(body) ? (body as Array<Record<string, unknown>>) : [];
  const seenFields = new Set<string>();
  for (const e of list.slice(0, 200)) for (const k of Object.keys(e ?? {})) seenFields.add(k);
  const missingFields = list.length === 0 ? [...FED_FEED_FIELDS] : FED_FEED_FIELDS.filter((f) => !seenFields.has(f));
  const unexpectedFields = [...seenFields].filter((f) => !(FED_FEED_FIELDS as readonly string[]).includes(f));
  const entries: FedFeedEntry[] = [];
  for (const e of list) {
    const pt = typeof e.pt === "string" ? e.pt : null;
    const link = typeof e.l === "string" ? e.l : null;
    if (!pt || !FED_ORDER_PRESS_TYPE.test(pt) || !link) continue;
    let url: string;
    try {
      url = new URL(link, FED_BASE).toString();
    } catch {
      continue;
    }
    entries.push({ date: fedFeedDate(e.d), title: typeof e.t === "string" ? clean(e.t) : null, url, pressType: pt, raw: e });
  }
  return { entries, missingFields, unexpectedFields };
}

/** Stable key from the release address ("orders20261016a"), else a hash of it. */
export function fedEventKey(url: string): string {
  const m = /\/(orders\d{8}[a-z]?)\.htm/i.exec(url);
  return `frb:${m ? m[1].toLowerCase() : hashKey([url])}`;
}

/** The order PDF linked from a release page ("Board order (PDF)"), preferring links that say order. */
export function orderPdfLink(html: string, pageUrl: string): string | null {
  const links = findDataLinks(html, pageUrl, /order|files\//i).filter((l) => l.kind === "pdf");
  return (links.find((l) => /order/i.test(l.text)) ?? links[0])?.url ?? null;
}

export interface DecisionFetchOptions extends RegistryFetchOptions {
  /** Event keys already stored with their order read; skipped (no page or PDF fetch). */
  known?: ReadonlySet<string>;
  /** Most PDFs to read per run. */
  maxDocuments?: number;
}

export async function fetchFedOrders(year: number, options: DecisionFetchOptions = {}): Promise<FetchedDecisions> {
  const { known = new Set<string>(), maxDocuments = 40, ...fetchOptions } = options;
  const response = await registryFetch(FED_PRESS_FEED, fetchOptions);
  const text = (await response.text()).replace(/^﻿/, "");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { sourceUrl: FED_PRESS_FEED, decisions: [], missingFields: [...FED_FEED_FIELDS], unexpectedFields: [], deferred: 0, reason: "the Fed press feed did not return JSON", extra: {} };
  }
  const feed = parseFedFeed(body);
  const inYear = feed.entries.filter((e) => e.date?.startsWith(String(year)));
  const fresh = inYear.filter((e) => !known.has(fedEventKey(e.url)));
  const decisions: MergerDecision[] = [];
  let budget = maxDocuments;
  let deferred = 0;
  for (const entry of fresh) {
    if (budget <= 0) {
      deferred += 1;
      continue;
    }
    budget -= 1;
    const base: MergerDecision = {
      eventKey: fedEventKey(entry.url),
      agency: "frb",
      decisionDate: entry.date,
      kind: decisionKind(entry.title ?? ""),
      title: entry.title,
      applicant: null,
      target: null,
      partiesSentence: null,
      documentUrl: null,
      pageUrl: entry.url,
      pdfStatus: "not_read",
      competitive: [],
      raw: { feed: entry.raw },
    };
    try {
      const html = await (await registryFetch(entry.url, fetchOptions)).text();
      const pageText = htmlToText(html);
      const parties = readParties(pageText);
      base.applicant = parties.applicant;
      base.target = parties.target;
      base.partiesSentence = parties.sentence;
      base.documentUrl = orderPdfLink(html, entry.url);
      if (!base.documentUrl) base.pdfStatus = "no_pdf";
      else {
        try {
          const orderText = await fetchPdfText(base.documentUrl, fetchOptions);
          base.competitive = competitiveFigures(orderText);
          base.pdfStatus = "read";
          if (!base.applicant || !base.target) {
            const fromOrder = readParties(orderText.slice(0, 6_000));
            base.applicant ??= fromOrder.applicant;
            base.target ??= fromOrder.target;
            base.partiesSentence ??= fromOrder.sentence;
          }
        } catch (error) {
          base.pdfStatus = "fetch_failed";
          base.raw.pdf_error = String(error).slice(0, 300);
        }
      }
    } catch (error) {
      base.raw.page_error = String(error).slice(0, 300);
    }
    decisions.push(base);
  }
  return {
    sourceUrl: FED_PRESS_FEED,
    decisions,
    missingFields: feed.missingFields,
    unexpectedFields: feed.unexpectedFields,
    deferred,
    reason: inYear.length === 0 ? `the Fed press feed listed no orders on banking applications dated ${year}` : fresh.length === 0 ? "every order for the year is already stored" : null,
    extra: { feed_orders_total: feed.entries.length, orders_in_year: inYear.length, already_stored: inYear.length - fresh.length },
  };
}

// ---------------------------------------------------------------------------
// OCC corporate decisions
// ---------------------------------------------------------------------------

const OCC_DECISION_LINK = /corporate[\s-]+decision|conditional[\s-]+approval|\bcd\d|\bca\d|merger|decision/i;
const OCC_MONTH_PAGE = /interpretations-and-actions\/\d{4}\//i;
const MERGER_WORDS = /\bmerge|\bmerger|purchase and assumption|\bacquir|\bconsolidat/i;

export function occEventKey(url: string): string {
  const file = url.split("/").pop() ?? "";
  return `occ:${/\.pdf$/i.test(file) ? file.toLowerCase() : hashKey([url])}`;
}

/** The decision's date: a "Month D, YYYY" in the link text, else the first one in the letter's opening. */
export function occDecisionDate(linkText: string, text: string): string | null {
  const named = /([A-Z][a-z]{2,8}\.? \d{1,2},? \d{4})/;
  const fromLink = named.exec(linkText)?.[1];
  if (fromLink) return eventDate(fromLink.replace(".", ""));
  const fromText = named.exec(clean(text).slice(0, 2_000))?.[1];
  return fromText ? eventDate(fromText.replace(".", "")) : null;
}

export async function fetchOccMergerDecisions(options: DecisionFetchOptions = {}, pages: readonly string[] = OCC_DECISION_PAGES, monthPages = 3): Promise<FetchedDecisions> {
  const { known = new Set<string>(), maxDocuments = 25, ...fetchOptions } = options;
  const links: Array<{ url: string; text: string }> = [];
  const pagesRead: Array<{ url: string; status: string; links: number }> = [];
  let sourceUrl: string = pages[0];
  for (const page of pages) {
    let html: string;
    try {
      html = await (await registryFetch(page, fetchOptions)).text();
    } catch (error) {
      pagesRead.push({ url: page, status: error instanceof RegistryHttpError && error.status ? `http_${error.status}` : "error", links: 0 });
      continue;
    }
    sourceUrl = page;
    const own = findDataLinks(html, page, OCC_DECISION_LINK).filter((l) => l.kind === "pdf");
    links.push(...own);
    pagesRead.push({ url: page, status: "read", links: own.length });
    const months = [...html.matchAll(/<a\s[^>]*?href\s*=\s*["']([^"']+)["']/gi)]
      .map((m) => {
        try {
          return new URL(m[1], page).toString();
        } catch {
          return null;
        }
      })
      .filter((u): u is string => u !== null && OCC_MONTH_PAGE.test(u) && /\.html?$/i.test(u));
    for (const month of [...new Set(months)].slice(0, monthPages)) {
      try {
        const monthHtml = await (await registryFetch(month, fetchOptions)).text();
        const found = findDataLinks(monthHtml, month, OCC_DECISION_LINK).filter((l) => l.kind === "pdf");
        links.push(...found);
        pagesRead.push({ url: month, status: "read", links: found.length });
      } catch (error) {
        pagesRead.push({ url: month, status: `error: ${String(error).slice(0, 80)}`, links: 0 });
      }
    }
  }
  const unique = [...new Map(links.map((l) => [l.url, l])).values()];
  const fresh = unique.filter((l) => !known.has(occEventKey(l.url)));
  const decisions: MergerDecision[] = [];
  let notMerger = 0;
  let failed = 0;
  let deferred = 0;
  let budget = maxDocuments;
  for (const link of fresh) {
    if (budget <= 0) {
      deferred += 1;
      continue;
    }
    budget -= 1;
    let text: string;
    try {
      text = await fetchPdfText(link.url, fetchOptions);
    } catch {
      failed += 1;
      continue;
    }
    const opening = clean(text).slice(0, 6_000);
    if (!MERGER_WORDS.test(opening)) {
      notMerger += 1;
      continue;
    }
    const parties = readParties(opening);
    decisions.push({
      eventKey: occEventKey(link.url),
      agency: "occ",
      decisionDate: occDecisionDate(link.text, text),
      kind: decisionKind(`${link.text} ${opening.slice(0, 1_500)}`),
      title: link.text || null,
      applicant: parties.applicant,
      target: parties.target,
      partiesSentence: parties.sentence,
      documentUrl: link.url,
      pageUrl: sourceUrl,
      pdfStatus: "read",
      competitive: competitiveFigures(text),
      raw: { link_text: link.text },
    });
  }
  const reason =
    pagesRead.every((p) => p.status !== "read")
      ? `no OCC decision page answered (${pagesRead.map((p) => p.status).join(", ")})`
      : unique.length === 0
        ? "the OCC pages linked no corporate-decision PDFs"
        : fresh.length === 0
          ? "every linked decision is already stored"
          : decisions.length === 0
            ? "no linked decision was about a merger or acquisition"
            : null;
  return {
    sourceUrl,
    decisions,
    missingFields: [],
    unexpectedFields: [],
    deferred,
    reason,
    extra: { pages_read: pagesRead, decision_links: unique.length, not_merger: notMerger, pdf_failed: failed },
  };
}

// ---------------------------------------------------------------------------
// Cleaning pass (reports; never changes, drops or fills a value)
// ---------------------------------------------------------------------------

export interface DecisionChecks {
  rows: number;
  duplicateKeys: number;
  missingByField: Record<string, number>;
  impossibleDates: string[];
  /** Figures outside what an HHI (0-10,000) or a share (0-100) can be: flagged, kept as read. */
  impossibleFigures: Array<{ key: string; field: string; value: number }>;
  withCompetitiveFigures: number;
  pdfStatus: Record<string, number>;
}

export function checkMergerDecisions(rows: MergerDecision[], now: Date = new Date()): DecisionChecks {
  const seen = new Set<string>();
  let duplicateKeys = 0;
  const missingByField: Record<string, number> = {};
  const impossibleDates: string[] = [];
  const impossibleFigures: DecisionChecks["impossibleFigures"] = [];
  const pdfStatus: Record<string, number> = {};
  const today = now.toISOString().slice(0, 10);
  for (const r of rows) {
    if (seen.has(r.eventKey)) duplicateKeys += 1;
    seen.add(r.eventKey);
    for (const [field, value] of Object.entries({ decision_date: r.decisionDate, applicant: r.applicant, target: r.target, document_url: r.documentUrl })) {
      if (!value) missingByField[field] = (missingByField[field] ?? 0) + 1;
    }
    if (r.decisionDate && (r.decisionDate > today || r.decisionDate < "1990-01-01") && impossibleDates.length < 10) impossibleDates.push(`${r.eventKey}:${r.decisionDate}`);
    for (const f of r.competitive) {
      if (f.hhi_post !== null && (f.hhi_post < 0 || f.hhi_post > 10_000)) impossibleFigures.push({ key: r.eventKey, field: "hhi_post", value: f.hhi_post });
      if (f.hhi_change !== null && Math.abs(f.hhi_change) > 10_000) impossibleFigures.push({ key: r.eventKey, field: "hhi_change", value: f.hhi_change });
      for (const s of f.deposit_shares) if (s < 0 || s > 100) impossibleFigures.push({ key: r.eventKey, field: "deposit_share", value: s });
    }
    pdfStatus[r.pdfStatus] = (pdfStatus[r.pdfStatus] ?? 0) + 1;
  }
  return {
    rows: rows.length,
    duplicateKeys,
    missingByField,
    impossibleDates,
    impossibleFigures: impossibleFigures.slice(0, 20),
    withCompetitiveFigures: rows.filter((r) => r.competitive.some((f) => f.hhi_change !== null || f.hhi_post !== null || f.deposit_shares.length > 0)).length,
    pdfStatus,
  };
}

// ---------------------------------------------------------------------------
// Holding-company names: legal-form words written out or abbreviated
// ---------------------------------------------------------------------------

/**
 * The exact-name key with legal-form words abbreviated, so "Huntington Bancshares Incorporated"
 * and FDIC's "HUNTINGTON BANCSHARES INC" agree. Only these suffix words change; nothing else.
 */
export function companyNameKey(name: string | null | undefined): string {
  return exactNameKey(name)
    .replace(/\bincorporated\b/g, "inc")
    .replace(/\bcorporation\b/g, "corp")
    .replace(/\bcompany\b/g, "co")
    .replace(/\blimited\b/g, "ltd")
    .replace(/\bnational association\b/g, "na")
    .replace(/\s+/g, " ")
    .trim();
}
