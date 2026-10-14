/**
 * The Regulatory Wire's research layer (stage 2). Pure: no database, no network, no model.
 *
 * - Readable text from an item's own page (`extractReadableText`).
 * - The model prompt and the check of what comes back (`validateResearch`): strict JSON, a
 *   known action type, and every date must appear in the source text or it is dropped
 *   (`dateAppearsInText`).
 * - Deterministic links between items (`relatedFederal`, `relatedPressForBill`,
 *   `relatedBillsForPress`): a shared docket, rule name, headline or institution within 90 days, or
 *   a press headline that names a bill.
 * - A bill's status timeline from the stage and dates already stored (`billTimeline`).
 *
 * Magellan's registry-wire-research step writes the notes (agents/magellan/registry/
 * wire-research.ts); the news page reads them (data-store/wire-research.ts).
 */
import { headlineNamesBill, splitPublisher } from "./state-news";

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export const RESEARCH_ACTION_TYPES = [
  "proposed_rule",
  "final_rule",
  "guidance",
  "enforcement",
  "approval_ma",
  "comment_period_change",
  "bill_action",
  "other",
] as const;
export type ResearchActionType = (typeof RESEARCH_ACTION_TYPES)[number];

export const ACTION_TYPE_LABELS: Record<ResearchActionType, string> = {
  proposed_rule: "Proposed rule",
  final_rule: "Final rule",
  guidance: "Guidance",
  enforcement: "Enforcement action",
  approval_ma: "Approval or merger",
  comment_period_change: "Comment period change",
  bill_action: "Bill action",
  other: "Other",
};

export type ResearchStatus = "ok" | "source_unreadable" | "skipped";

/** reg_articles items are keyed by guid; reg_tracker_items (bills) by "source:external_id". */
export type ResearchItemKind = "article" | "tracker";

export function researchKey(kind: ResearchItemKind, id: string): string {
  return `${kind}|${id}`;
}

export function trackerItemId(source: string, externalId: string): string {
  return `${source}:${externalId}`;
}

/** One stored note, as the news page reads it. Dates are ISO days. */
export interface ResearchNote {
  itemKind: ResearchItemKind;
  itemId: string;
  status: ResearchStatus;
  reason: string | null;
  summary: string | null;
  actionType: ResearchActionType | null;
  commentDeadline: string | null;
  effectiveDate: string | null;
  whyItMatters: string | null;
  dockets: string[];
  sourceUrl: string;
  model: string | null;
  createdAt: string | null;
}

// ---------------------------------------------------------------------------
// Readable text
// ---------------------------------------------------------------------------

/** Text sent to the model is cut here so one call's cost stays bounded (about 4,000 tokens). */
export const MAX_SOURCE_CHARS = 16_000;
/** Less readable text than this is an error page, a menu or a script shell. */
export const MIN_READABLE_CHARS = 200;

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ldquo: "“", rdquo: "”",
  lsquo: "‘", rsquo: "’", ndash: "–", mdash: "—", hellip: "…", sect: "§", middot: "·",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    return ENTITIES[code.toLowerCase()] ?? " ";
  });
}

/** Elements that are never the document's own words. */
const NOISE_ELEMENTS = ["script", "style", "noscript", "svg", "template", "iframe", "form", "nav", "header", "footer", "aside", "select", "button"];

function innerOf(html: string, tag: string): string | null {
  const open = new RegExp(`<${tag}\\b[^>]*>`, "i").exec(html);
  if (!open) return null;
  const close = html.toLowerCase().lastIndexOf(`</${tag}>`);
  if (close <= open.index) return null;
  return html.slice(open.index + open[0].length, close);
}

export interface ReadableText {
  text: string;
  /** Characters before the MAX_SOURCE_CHARS cut. */
  fullChars: number;
  truncated: boolean;
}

/**
 * The page's own words: scripts, menus, headers and footers removed, the <main> or
 * <article> element preferred when the page has one, block ends kept as line breaks.
 * Plain text passes through with its whitespace tidied.
 */
export function extractReadableText(body: string, contentType: string | null = null): ReadableText {
  const isHtml = /html|xml/i.test(contentType ?? "") || /<(html|body|p|div)\b/i.test(body.slice(0, 5000));
  let text: string;
  if (!isHtml) {
    text = body;
  } else {
    let html = body.replace(/<!--[\s\S]*?-->/g, " ");
    for (const tag of NOISE_ELEMENTS) {
      html = html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
    }
    const main = innerOf(html, "main") ?? innerOf(html, "article") ?? innerOf(html, "body") ?? html;
    text = decodeEntities(
      main
        .replace(/<\/(p|li|div|h[1-6]|tr|section|blockquote|dd|dt|table)>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    );
  }
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line.length > 1);
  const clean = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    text: clean.length > MAX_SOURCE_CHARS ? clean.slice(0, MAX_SOURCE_CHARS) : clean,
    fullChars: clean.length,
    truncated: clean.length > MAX_SOURCE_CHARS,
  };
}

/** A PDF or other binary body cannot be read as text by this step. */
export function isUnreadableBody(body: string, contentType: string | null): boolean {
  if (/pdf|octet-stream|msword|officedocument|image\//i.test(contentType ?? "")) return true;
  return body.startsWith("%PDF");
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept?", "Oct", "Nov", "Dec"];

export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * True when the source text states this day: "November 4, 2026", "Nov. 4, 2026",
 * "4 November 2026", "11/4/2026", "2026-11-04". A day written without a year
 * ("until November 4") counts only when no year follows it and the date's year is the
 * item's publication year or the next one (`contextYear`).
 */
export function dateAppearsInText(iso: string, text: string, contextYear: number | null = null): boolean {
  if (!isIsoDay(iso)) return false;
  const [year, month, day] = iso.split("-").map(Number);
  const flat = text.replace(/\s+/g, " ");
  const monthWord = `(?:${MONTH_NAMES[month - 1]}|${MONTH_SHORT[month - 1]}\\.?)`;
  const dayWord = `0?${day}(?:st|nd|rd|th)?`;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const withYear = [
    `\\b${monthWord}\\s+${dayWord},?\\s+${year}\\b`,
    `\\b${dayWord}\\s+${monthWord},?\\s+${year}\\b`,
    `\\b0?${month}/0?${day}/${year}\\b`,
    `\\b${year}-${mm}-${dd}\\b`,
  ];
  if (withYear.some((p) => new RegExp(p, "i").test(flat))) return true;
  if (contextYear === null || (year !== contextYear && year !== contextYear + 1)) return false;
  // No year after it: "November 4" but not "November 4, 2025".
  return new RegExp(`\\b${monthWord}\\s+${dayWord}\\b(?!,?\\s*\\d{4})`, "i").test(flat);
}

// ---------------------------------------------------------------------------
// The model's answer
// ---------------------------------------------------------------------------

const ABBREVIATIONS = /\b(U\.S|U\.K|Inc|Co|Corp|Ltd|No|Nos|Mr|Mrs|Ms|Dr|St|Jr|Sr|N\.A|e\.g|i\.e|vs|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Gov|Sen|Rep|Pub|L|Fed|Reg)\./g;

/** Sentences in a short plain paragraph; common abbreviations do not end one. */
export function countSentences(text: string): number {
  const masked = text.replace(ABBREVIATIONS, (m) => m.replace(/\./g, "·"));
  return masked
    .split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;
}

export interface ResearchDraft {
  summary: string;
  actionType: ResearchActionType;
  commentDeadline: string | null;
  effectiveDate: string | null;
  whyItMatters: string | null;
}

export type ResearchValidation =
  | { ok: true; draft: ResearchDraft; droppedDates: string[] }
  | { ok: false; unreadable: boolean; reason: string };

const MAX_SUMMARY_CHARS = 700;
const MAX_WHY_CHARS = 320;

/**
 * Checks the model's JSON. A summary must be 1 to 3 sentences of plain text (the prompt asks
 * for 2 or 3); the action type must be one of RESEARCH_ACTION_TYPES. Each date must be a real
 * day that the source text states (dateAppearsInText): a date the text does not carry is
 * dropped, never kept, and reported in `droppedDates`.
 */
export function validateResearch(raw: unknown, sourceText: string, contextYear: number | null): ResearchValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, unreadable: false, reason: "not_a_json_object" };
  const obj = raw as Record<string, unknown>;
  if (obj.unreadable === true) return { ok: false, unreadable: true, reason: "model_said_unreadable" };
  const summary = typeof obj.summary === "string" ? obj.summary.replace(/\s+/g, " ").trim() : "";
  if (!summary) return { ok: false, unreadable: false, reason: "missing_summary" };
  if (summary.length > MAX_SUMMARY_CHARS) return { ok: false, unreadable: false, reason: "summary_too_long" };
  if (/[<>*#`]|https?:\/\//.test(summary)) return { ok: false, unreadable: false, reason: "summary_not_plain_text" };
  const sentences = countSentences(summary);
  if (sentences < 1 || sentences > 3) return { ok: false, unreadable: false, reason: "summary_sentence_count" };
  const actionType = obj.action_type;
  if (typeof actionType !== "string" || !(RESEARCH_ACTION_TYPES as readonly string[]).includes(actionType)) {
    return { ok: false, unreadable: false, reason: "unknown_action_type" };
  }
  const droppedDates: string[] = [];
  const checkDate = (field: string): string | null => {
    const value = obj[field];
    if (value === null || value === undefined || value === "") return null;
    if (isIsoDay(value) && dateAppearsInText(value, sourceText, contextYear)) return value;
    droppedDates.push(`${field}:${String(value).slice(0, 40)}`);
    return null;
  };
  const commentDeadline = checkDate("comment_deadline");
  const effectiveDate = checkDate("effective_date");
  const whyRaw = typeof obj.why_it_matters === "string" ? obj.why_it_matters.replace(/\s+/g, " ").trim() : "";
  const whyItMatters = whyRaw && whyRaw.length <= MAX_WHY_CHARS && !/[<>*#`]/.test(whyRaw) ? whyRaw : null;
  return {
    ok: true,
    draft: { summary, actionType: actionType as ResearchActionType, commentDeadline, effectiveDate, whyItMatters },
    droppedDates,
  };
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

export type ResearchSubjectKind = "federal_release" | "state_regulator_post" | "state_bill";

const SUBJECT_WORDS: Record<ResearchSubjectKind, string> = {
  federal_release: "an official press release from a federal banking agency",
  state_regulator_post: "an official post from a state banking or credit union regulator",
  state_bill: "a state legislature's page for a bill",
};

export const RESEARCH_SYSTEM_PROMPT = [
  "You summarise one official banking-regulatory document for bank and credit union marketing and product managers.",
  "Use ONLY the source text in the user message. Do not add facts, dates, names or numbers from anywhere else.",
  "Reply with one JSON object and nothing else, with exactly these keys:",
  '{"summary": string, "action_type": string, "comment_deadline": "YYYY-MM-DD" or null, "effective_date": "YYYY-MM-DD" or null, "why_it_matters": string}',
  "summary: 2 or 3 plain sentences: what the document does, who issued it, and who it applies to. No lists, links or markdown.",
  `action_type: one of ${RESEARCH_ACTION_TYPES.join(", ")}. approval_ma is an approval of a merger, acquisition or application; comment_period_change is an extended, reopened or shortened comment period; bill_action is a bill's introduction, vote or signing.`,
  "comment_deadline: only when the text states the day comments are due. effective_date: only when the text states the day the rule, order or law takes effect. Write the day the text states as YYYY-MM-DD; otherwise null. Never work a date out.",
  "why_it_matters: one sentence on why a bank or credit union might care. It is shown labelled as interpretation, so do not state it as a requirement and do not give legal advice.",
  'If the text is not a readable document (an error page, a login page, a list of links), reply {"unreadable": true}.',
].join("\n");

export function buildResearchPrompt(input: {
  kind: ResearchSubjectKind;
  headline: string;
  publishedOn: string | null;
  sourceUrl: string;
  text: string;
}): string {
  return [
    `Document: ${SUBJECT_WORDS[input.kind]}.`,
    `Headline: ${input.headline}`,
    `Published: ${input.publishedOn ?? "not given"}`,
    `Source URL: ${input.sourceUrl}`,
    "",
    "Source text:",
    "<<<",
    input.text,
    ">>>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Link keys: dockets, rule names, institutions
// ---------------------------------------------------------------------------

const DOCKET_PATTERNS = [
  /\b(?:CFPB|OCC|FDIC|FRB|NCUA|FinCEN|FHFA|TREAS)-\d{4}-\d{4}(?:-\d{4})?\b/gi,
  /\bDocket\s+(?:No\.?|Number)\s*([A-Z]{1,4}-\d{3,5}(?:-\d{2,5})?)/gi,
  /\b(?:RIN)\s*(\d{4}-[A-Z]{2}\d{2})\b/gi,
];

/** Docket and RIN numbers in a text, upper-cased and de-duplicated. */
export function extractDockets(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of DOCKET_PATTERNS) {
    for (const m of text.matchAll(pattern)) found.add((m[1] ?? m[0]).toUpperCase().replace(/\s+/g, ""));
  }
  return [...found].slice(0, 20);
}

const INSTITUTION_SUFFIX =
  /\b(Bank|Bancorp|Bancorporation|Bancshares|Bankshares|Banc|Financial Corporation|Financial Corp|Financial Group|Financial Holdings|Trust Company|Credit Union|Savings Bank)\b/g;
const NAME_STOP = new Set([
  "a", "an", "and", "the", "of", "by", "for", "to", "with", "against", "on", "in", "at", "from", "its",
  "announces", "announce", "approves", "approval", "approved", "application", "applications", "issues",
  "issued", "releases", "release", "terminates", "termination", "action", "actions", "enforcement",
  "order", "orders", "agencies", "agency", "board", "federal", "reserve", "fdic", "occ", "cfpb", "fed",
  "statement", "proposal", "proposed", "final", "rule", "acquire", "acquisition", "merger", "merge", "requests", "request", "comment", "public", "joint",
  // Title-case headlines capitalise every word: verbs and report words end a name too.
  "reports", "report", "publishes", "publish", "hails", "assumes", "assume", "names", "fines", "sues",
  "quarter", "annual", "results", "list", "lists", "trading",
  "revenue", "mortgage", "performance", "update", "remarks", "before", "after", "all", "certain",
  "deposits", "assets", "examined", "evaluations", "banks", "former", "employee", "employees",
]);
/** A name made only of these words is a kind of bank ("Community Bank"), not one bank. */
const GENERIC_NAME = new Set([
  "community", "national", "state", "savings", "commercial", "member", "insured", "small", "large",
  "regional", "foreign", "depository", "de", "novo", "big", "u.s.", "us", "american", "minority",
]);
/** Words that name an agency, not an institution, before a "Bank" suffix. */
const NOT_INSTITUTIONS = /\b(reserve bank|federal home loan bank|world bank|export-import bank|central bank|national bank act)\b/i;

/**
 * Institution names in a headline: up to five capitalised words before a suffix such as
 * Bank, Bancorp or Credit Union, after dropping verbs and agency words ("Federal Reserve Board
 * announces approval of application by First Example Bancorp" gives "first example bancorp").
 * A suffix with no name before it is not a name.
 */
export function extractInstitutions(title: string): string[] {
  const out = new Set<string>();
  for (const m of title.matchAll(INSTITUTION_SUFFIX)) {
    const before = title.slice(0, m.index).trimEnd().split(/\s+/);
    const name: string[] = [];
    for (let i = before.length - 1; i >= 0 && name.length < 5; i -= 1) {
      const word = before[i].replace(/[,;:()"“”]/g, "");
      // A year or a count ("2026", "15") is never part of a name.
      if (!word || !/^[A-Z&]/.test(word) || NAME_STOP.has(word.toLowerCase())) break;
      name.unshift(word);
    }
    if (name.length === 0 || name.every((w) => GENERIC_NAME.has(w.toLowerCase()))) continue;
    const full = `${name.join(" ")} ${m[0]}`;
    if (NOT_INSTITUTIONS.test(full)) continue;
    out.add(full.toLowerCase().replace(/[.,']/g, "").replace(/\s+/g, " ").trim());
  }
  return [...out];
}

const ACT_STOP = new Set(["the", "this", "an", "a", "and", "of"]);

/** Rule names: "Regulation O", "Community Reinvestment Act", "Section 1033". Lower case. */
export function extractRuleNames(title: string): string[] {
  const out = new Set<string>();
  for (const m of title.matchAll(/\bRegulation\s+([A-Z]{1,2})\b/g)) out.add(`regulation ${m[1].toLowerCase()}`);
  for (const m of title.matchAll(/\b((?:[A-Z][A-Za-z-]+\s+){1,5})Act\b/g)) {
    const words = m[1].trim().split(/\s+/);
    while (words.length > 0 && (ACT_STOP.has(words[0].toLowerCase()) || NAME_STOP.has(words[0].toLowerCase()))) words.shift();
    if (words.length >= 1) out.add(`${words.join(" ").toLowerCase()} act`);
  }
  for (const m of title.matchAll(/\b(?:Section|§)\s*(\d{3,4}[a-z]?)\b/gi)) out.add(`section ${m[1].toLowerCase()}`);
  return [...out];
}

// ---------------------------------------------------------------------------
// Related federal releases
// ---------------------------------------------------------------------------

export const RELATED_WINDOW_DAYS = 90;
export const MAX_RELATED = 4;

export interface LinkCandidate {
  key: string;
  kind: "release" | "rule";
  /** Agency code for a release (FED, FDIC...) or the rule's agencies. */
  source: string;
  title: string;
  url: string;
  date: string | null;
  /** Dockets from the note's source text (releases) or the Federal Register (rules). */
  dockets?: string[];
}

export interface RelatedItem {
  key: string;
  kind: "release" | "rule" | "bill" | "press";
  title: string;
  url: string | null;
  date: string | null;
  /** Who published it: an agency code, a state, or an outlet. */
  source: string | null;
  /** Why it is linked, in plain words: "same docket R-1813", "names Regulation O". */
  reason: string;
}

function dayNumber(value: string | null): number | null {
  if (!value) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 86_400_000);
}

interface Keys {
  dockets: Set<string>;
  rules: Set<string>;
  institutions: Set<string>;
}

function keysOf(item: Pick<LinkCandidate, "title" | "dockets">): Keys {
  return {
    dockets: new Set([...(item.dockets ?? []).map((d) => d.toUpperCase()), ...extractDockets(item.title)]),
    rules: new Set(extractRuleNames(item.title)),
    institutions: new Set(extractInstitutions(item.title)),
  };
}

function shared(a: Set<string>, b: Set<string>): string | null {
  for (const value of a) if (b.has(value)) return value;
  return null;
}

/** Words of a headline that set it apart, agency boilerplate removed. */
function headlineWords(title: string): Set<string> {
  return new Set(distinctiveWords(title.replace(/^press release:\s*/i, "")).filter((w) => !NAME_STOP.has(w)));
}

/**
 * Two headlines carry the same title: at least four distinctive words in common and most of
 * each one's words shared, as when two agencies publish the same joint release.
 */
export function sameHeadline(a: string, b: string): boolean {
  const x = headlineWords(a);
  const y = headlineWords(b);
  let common = 0;
  for (const w of x) if (y.has(w)) common += 1;
  return common >= 4 && common / Math.max(x.size, y.size) >= 0.7;
}

function titleCase(value: string): string {
  return value.replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bAct\b/, "Act");
}

/**
 * Federal items related to one release: within 90 days either side and sharing a docket,
 * a rule name, nearly the same headline (one joint release from two agencies) or an
 * institution name. Dockets rank first, then rules and shared headlines, then institutions,
 * then the nearest date. The release itself is never its own related item.
 */
export function relatedFederal(target: LinkCandidate, candidates: LinkCandidate[], max = MAX_RELATED): RelatedItem[] {
  const day = dayNumber(target.date);
  const mine = keysOf(target);
  const scored: Array<{ item: RelatedItem; score: number; distance: number }> = [];
  for (const c of candidates) {
    if (c.key === target.key) continue;
    const other = dayNumber(c.date);
    const distance = day !== null && other !== null ? Math.abs(day - other) : Number.POSITIVE_INFINITY;
    if (distance > RELATED_WINDOW_DAYS) continue;
    const theirs = keysOf(c);
    const docket = shared(mine.dockets, theirs.dockets);
    const rule = docket ? null : shared(mine.rules, theirs.rules);
    const sameTitle = docket || rule ? false : sameHeadline(target.title, c.title);
    const institution = docket || rule || sameTitle ? null : shared(mine.institutions, theirs.institutions);
    const reason = docket
      ? `same docket ${docket}`
      : rule
        ? `also names ${titleCase(rule)}`
        : sameTitle
          ? "nearly the same headline (a joint or repeated release)"
          : institution
            ? `also names ${titleCase(institution)}`
            : null;
    if (!reason) continue;
    scored.push({
      item: { key: c.key, kind: c.kind, title: c.title, url: c.url, date: c.date, source: c.source, reason },
      score: docket ? 3 : rule || sameTitle ? 2 : 1,
      distance,
    });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.distance - b.distance || a.item.title.localeCompare(b.item.title))
    .slice(0, max)
    .map((s) => s.item);
}

// ---------------------------------------------------------------------------
// Bills and their press coverage
// ---------------------------------------------------------------------------

export interface BillForLink {
  key: string;
  state: string;
  identifier: string | null;
  title: string;
  url: string | null;
  date: string | null;
}

export interface PressForLink {
  key: string;
  state: string;
  /** The Google News title, publisher included. */
  title: string;
  url: string;
  date: string | null;
}

const TITLE_STOP = new Set([
  "relating", "relates", "concerning", "regarding", "providing", "certain", "financial", "institutions",
  "institution", "amend", "amends", "amending", "section", "sections", "chapter", "statutes", "statute",
  "revised", "general", "code", "state", "states", "public", "other", "under", "their", "which",
  "about", "after", "before", "these", "those", "there", "where", "shall", "would", "could", "bills",
  "credit", "union", "unions", "banks", "banking", "consumer", "consumers", "establish", "establishes",
  "making", "requires", "require", "prohibit", "prohibits", "act", "acts", "law", "laws", "new",
]);

/** Words of a bill title that set it apart: five letters or more and not boilerplate. */
export function distinctiveWords(title: string): string[] {
  const words = title.toLowerCase().match(/[a-z][a-z-]{4,}/g) ?? [];
  return [...new Set(words.filter((w) => !TITLE_STOP.has(w)))];
}

/**
 * A press headline is about a bill when it carries the bill's number (headlineNamesBill, the
 * same test registry-state-bill-news uses) or at least two of the bill title's distinctive
 * words. Both must be in the same state.
 */
export function pressNamesBill(press: PressForLink, bill: BillForLink): { linked: boolean; reason: string | null } {
  if (press.state !== bill.state) return { linked: false, reason: null };
  if (bill.identifier && headlineNamesBill(press.title, bill.identifier)) {
    return { linked: true, reason: `names ${bill.identifier}` };
  }
  const { headline } = splitPublisher(press.title);
  const lower = headline.toLowerCase();
  const hits = distinctiveWords(bill.title).filter((w) => new RegExp(`\\b${w.replace(/-/g, "\\-")}\\b`).test(lower));
  if (hits.length >= 2) return { linked: true, reason: `shares "${hits.slice(0, 2).join('", "')}" with the bill title` };
  return { linked: false, reason: null };
}

function byDateDesc(a: RelatedItem, b: RelatedItem): number {
  return (b.date ?? "").localeCompare(a.date ?? "");
}

export function relatedPressForBill(bill: BillForLink, press: PressForLink[], max = MAX_RELATED): RelatedItem[] {
  const out: RelatedItem[] = [];
  for (const p of press) {
    const { linked, reason } = pressNamesBill(p, bill);
    if (!linked || !reason) continue;
    const { headline, publisher } = splitPublisher(p.title);
    out.push({ key: p.key, kind: "press", title: headline, url: p.url, date: p.date, source: publisher, reason: `Coverage: ${reason}` });
  }
  return out.sort(byDateDesc).slice(0, max);
}

export function relatedBillsForPress(press: PressForLink, bills: BillForLink[], max = MAX_RELATED): RelatedItem[] {
  const out: RelatedItem[] = [];
  for (const b of bills) {
    const { linked, reason } = pressNamesBill(press, b);
    if (!linked || !reason) continue;
    out.push({
      key: b.key,
      kind: "bill",
      title: b.identifier ? `${b.identifier}: ${b.title}` : b.title,
      url: b.url,
      date: b.date,
      source: b.state,
      reason: `The story ${reason}`,
    });
  }
  return out.sort(byDateDesc).slice(0, max);
}

// ---------------------------------------------------------------------------
// Bill status timeline
// ---------------------------------------------------------------------------

const STAGE_WORDS: Record<string, string> = {
  introduced: "Introduced",
  in_committee: "Referred to committee",
  passed_chamber: "Passed one chamber",
  passed_legislature: "Passed the legislature",
  signed: "Signed into law",
  vetoed: "Vetoed",
  failed: "Failed",
};

export interface TimelineEntry {
  label: string;
  date: string | null;
  /** The latest recorded step. */
  current: boolean;
}

/**
 * A bill's dated steps from what is stored: its introduction (published_on) and its latest
 * action (stage, stage_on). Steps in between have no stored date, so none is shown.
 */
export function billTimeline(bill: { introducedOn: string | null; stage: string | null; stageOn: string | null }): TimelineEntry[] {
  const stage = bill.stage ?? null;
  const stageLabel = stage ? STAGE_WORDS[stage] ?? stage.replace(/_/g, " ") : null;
  if (!stage || stage === "introduced") {
    const date = bill.introducedOn ?? bill.stageOn;
    return date || stage ? [{ label: "Introduced", date, current: true }] : [];
  }
  const entries: TimelineEntry[] = [];
  if (bill.introducedOn) entries.push({ label: "Introduced", date: bill.introducedOn, current: false });
  entries.push({ label: stageLabel ?? "Latest action", date: bill.stageOn, current: true });
  return entries;
}
