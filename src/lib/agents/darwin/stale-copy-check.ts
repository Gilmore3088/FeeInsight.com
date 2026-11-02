import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { currentCopyVerdict } from "@/lib/agents/hamilton/current-copy";
import { NEWER_COPY_MIN_SHARED_FEES, NEWER_COPY_MIN_SHARED_SHARE, squash } from "@/lib/agents/hamilton/newer-copy-retire";
import { KNOX_RULES_STRATEGY } from "@/lib/agents/knox/specialists";
import { sameProduct } from "@/lib/fee-product";
import { checkFeeAgainstSource, sourceLines } from "@/lib/custom-report/source-check";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of fees still read from a superseded copy of their bank's page (Nov 2 audit:
 * 7,035 live fees, 6,720 of them flat dollar fees, cite 2,364 superseded copies; James's live check
 * found Citizens Savings Bank (IA, institution 3416) showing "Overdraft charge" $25 from the current
 * copy beside "Overdraft Fee" $25 from the February copy of the same page).
 *
 * Why the existing machinery leaves them live (prod, read-only, Nov 2):
 * - Hamilton's refresh-copy (`hamilton/refresh-copy.ts`) moves a fee onto the current copy only when
 *   the current copy's row is the same line under the same tidied name. A current-copy row Knox read
 *   under another name ("Overdraft charge" for "Overdraft Fee") is already live in its own right, so
 *   the pair is skipped (`name_differs`, `pair_taken`) and both stay live.
 * - Hamilton's current-copy check (`hamilton/current-copy.ts`) skips every fee whose current copy has
 *   a verified row at the same category and amount (`restated_row`, refresh-copy's job), so that twin
 *   is never judged by anyone; and its takedown (`CURRENT_COPY_CONFIRM_LIVE`) is off because its text
 *   matcher alone flagged fees the current copy still prints (hand checks, #2477, #2072).
 * Measured: 759 live flat fees have a live fee of the same category and amount read from their
 * current copy (356 of them also of the same audience and product), and 4,500 sit on copies whose
 * current copy's text Knox has read at a rules version at least the fee's own, but only 123 at v155
 * and none yet at v156.
 *
 * This check settles each such fee one of two ways, each on the current copy's stored text, judged
 * with the one shared source check (`checkFeeAgainstSource`):
 * - Twin (`twin`): a live fee read from the current copy is the same line: same category, amount,
 *   audience and product; the current text states the twin at that amount; the stale fee does not
 *   trace on the current text to any other line; and either the twin has the stale fee's name or the
 *   twin's current line is the line the stale fee traces to on the older copy. The stale fee is the
 *   double count and comes down, reason `stale_copy_twin: kept #<twin> (#<old> -> #<current>)`. A
 *   stale fee printed on a line of its own stays (`stated`), and a same-price fee on another line
 *   ("Checking Dormant Charges" for "Savings Dormant Charges") is no twin. No Knox version is needed:
 *   the twin is the current copy's own verified read of the line. v2 (Nov 2 dry run, 2 of 20 sampled
 *   twins wrong): the shared matcher can trace a fee to its same-price neighbour on both copies, so a
 *   pair is also no twin when the stale fee's own name, or the twin's, labels a row at the amount
 *   elsewhere on the current copy ("Below minimum fee/each occurrence" $3 is not "Below minimum
 *   balance/per day" $3), read on the matcher's lines and on the stored text's own rows (a long row
 *   the matcher splits into sentences); when the two name different cells of a two-fee row ("Account History |
 *   $5.00 | Mailed Paper Statement Fee | $5.00"); or when the stale name carries a qualifier the twin's
 *   name, product and line lack ("Processing Fee (personal unsecured loans)" is not the savings
 *   secured loans' $95).
 * - Dropped (`dropped`): no twin, and all of: Knox has read the current copy's stored text (same text
 *   hash) at the current rules version or later (`KNOX_RULES_STRATEGY.version`, and never below the
 *   fee's own read version); the older copy's text states the fee (else the matcher's miss,
 *   `unproven`); the current text does not (`checkFeeAgainstSource` fails) and Hamilton's current-copy
 *   verdict, with its layout and change-notice guards, does not call it stated or unproven; Knox's
 *   read of the current copy has no row at the fee's amount under the same name; and the current copy
 *   is recognizably the same schedule (it states at least `NEWER_COPY_MIN_SHARED_FEES` and
 *   `NEWER_COPY_MIN_SHARED_SHARE` of the older copy's judged live fees, or carries their twins). Then
 *   the fee comes down, reason `stale_copy_dropped: not on current copy #<current> (Knox v<n>)`.
 * Every other fee stays live, counted by why: `stated` (the current copy prints it; refresh-copy's or
 * the next re-read's to move), `waiting_reread` (Knox has not read the current text at the current
 * version: the re-read backlog's job), `knox_reads_it`, `unproven`, `not_same_schedule`, `no_text`.
 *
 * Admin-corrected and quarantined fees are never read; only flat dollar fees above $0 are judged.
 * Switched on, a fee to retire goes through the shared 12-hour second look (check
 * `darwin.stale_copy`) and is archived on its second failure: rolled back with its reason, its
 * verified row rejected with the `stale_copy` flag so publish does not bring it back, never deleted;
 * a twin retire also requires the twin to be live in the same write. A `darwin.stale_copy_takedown`
 * event lists them. `STALE_COPY_RETIRE_LIVE` is on (Nov 2: v2's full read-only pass over prod found 57
 * twins at 46 institutions and no drops, and 20 of 20 sampled twins were right against the stored
 * texts); with it off, or in a dry run, the step only reports. Each step reads the next `STALE_COPY_DOCUMENT_LIMIT` superseded copies after a cursor kept
 * on the run ledger (the `darwin.stale_copy` event's `next_after_id`, 0 once a pass reaches the end),
 * so every copy is read again on the next pass and a first look meets its second. An
 * institution-scoped run reads that institution's copies and leaves the cursor alone.
 *
 * Dropped line (v3, `STALE_COPY_DROPPED_LINE_LIVE`, off). Live-site audit draw 275762 flagged fee 103684
 * at Olympia Federal (institution 1020): "Tax Registration" $81, read on Oct 9 from copy 23786 of
 * olyfed.com/rates/. The Nov 2 copy (41830) replaced the HELOC third-party fee list with one total, and
 * six live fees from that list stayed live. Two gates kept the `dropped` verdict from ever firing:
 * - It waits on a Knox read of the current text at today's rules version. The rules move almost daily
 *   (v156 to v163 on Nov 2) and Knox re-reads a current copy once per version from a backlog: on Nov 2,
 *   25 of 2,186 superseded copies with live fees had a current copy read at v163 and 1,424 one read at
 *   v97 or later. With the switch on, Knox's read (only ever a veto: a row of the fee's name at its
 *   amount keeps it live) counts from Knox's stale-read floor (`STALE_COPY_SETTLED_READ_FLOOR`, the
 *   version every current copy is read at once) and never below the fee's own read version.
 * - The current copy must carry at least half of the older copy's judged live fees. A bank that drops a
 *   whole block leaves too few (Olympia: 2 of 8). With the switch on, the same address whose current
 *   text still prints `STALE_COPY_SAME_TEXT_SHARE` of the older copy's lines is the same page too.
 * Guards on every drop, switch on or off, from the Nov 2 read-only dry run (10 would-be drops were still
 * on the page): the fee's name and price must not both still appear on the current copy
 * (`named_and_priced`: a layout that moved the price, an HTML entity, a glued name), no live fee read
 * from the current copy may share its category and amount (`restated`), and both copies must come from
 * the same address (`not_same_page`). Admin-corrected fees are never read.
 */
export const STALE_COPY_CHECK = "darwin.stale_copy";
export const STALE_COPY_CHECK_VERSION = 3;
export const STALE_COPY_RETIRE_LIVE = true;
/** Off: a `dropped` verdict needs a current-version Knox read and the fee-count same-schedule test (see the module note). */
export const STALE_COPY_DROPPED_LINE_LIVE = false;
/** Knox's stale-read floor (`KNOX_STALE_READ_BELOW_VERSION` in `knox/extract.ts`; a test keeps them equal). */
export const STALE_COPY_SETTLED_READ_FLOOR = 97;
/** With the switch on, the share of the older copy's lines a same-address current copy must still print to be the same page. */
export const STALE_COPY_SAME_TEXT_SHARE = 0.6;
export const STALE_COPY_FLAG = "stale_copy";
export const STALE_COPY_TWIN_REASON_PREFIX = "stale_copy_twin: kept #";
export const STALE_COPY_DROPPED_REASON_PREFIX = "stale_copy_dropped: not on current copy #";
export const STALE_COPY_BATCH_PREFIX = "darwin-stale-copy-";
export const STALE_COPY_DOCUMENT_LIMIT = 60;
export const STALE_COPY_SAMPLES = 20;

export type StaleCopyVerdict =
  | "twin"
  | "dropped"
  | "stated"
  | "waiting_reread"
  | "knox_reads_it"
  | "named_and_priced"
  | "restated"
  | "not_same_page"
  | "unproven"
  | "not_same_schedule"
  | "no_text";

export const STALE_COPY_VERDICTS: readonly StaleCopyVerdict[] = [
  "twin", "dropped", "stated", "waiting_reread", "knox_reads_it", "restated", "named_and_priced", "not_same_page", "unproven", "not_same_schedule", "no_text",
];

/** One live fee read from a superseded copy, with its bank's current copy of the page. */
export interface StaleCopyFeeRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  older_document_id: number | string;
  current_document_id: number | string;
  canonical_fee_key: string | null;
  fee_name: string;
  amount: number | string | null;
  product_name: string | null;
  fee_audience: string | null;
  /** Highest Knox rules version that read the older copy (null: read before the ledger). */
  fee_read_version: number | string | null;
  /** Highest Knox rules version that read the current copy's stored text (its text hash). */
  current_read_version: number | string | null;
  /** The address each copy was fetched from; a fee is judged dropped only between copies of one address. */
  older_url: string | null;
  current_url: string | null;
}

/**
 * One page: the same address once scheme, "www.", a trailing slash, query and fragment are set aside.
 * A copy chain can link a schedule that moved ("/virtualDocuments/Checking-Pricing-Schedule.pdf" to
 * "/-/media/pdfs/pricing-schedules/Checking-Pricing-Schedule.pdf", Regions, Nov 2 dry run); the
 * moved copy may be another edition or audience, so its silence proves no drop.
 */
export function samePageUrl(olderUrl: string | null, currentUrl: string | null): boolean {
  const page = (url: string | null) =>
    (url ?? "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  const older = page(olderUrl);
  return older !== "" && older === page(currentUrl);
}

/** A stored line shorter than this (squashed) is too common to say two copies are one page. */
const OVERLAP_MIN_LINE = 12;

/** The share of the older copy's distinct lines (squashed, at least `OVERLAP_MIN_LINE` long) the current copy still prints. */
export function pageTextOverlap(olderText: string, currentText: string): number {
  const linesOf = (text: string) => new Set(text.split(/\r?\n/).map((line) => squash(line)).filter((line) => line.length >= OVERLAP_MIN_LINE));
  const older = linesOf(olderText);
  if (older.size === 0) return 0;
  const current = linesOf(currentText);
  let kept = 0;
  for (const line of older) if (current.has(line)) kept += 1;
  return kept / older.size;
}

/** A live fee read from the current copy. */
export interface StaleCopyTwinRow {
  fee_published_id: number | string;
  current_document_id: number | string;
  canonical_fee_key: string | null;
  fee_name: string;
  amount: number | string | null;
  product_name: string | null;
  fee_audience: string | null;
}

/** A row Knox read from the current copy, live or not. */
export interface StaleCopyRawRow {
  current_document_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
}

export interface StaleCopyDocumentInput {
  fees: StaleCopyFeeRow[];
  twins: StaleCopyTwinRow[];
  rawRows: StaleCopyRawRow[];
  currentText: string | null;
  olderText: string | null;
  /** The rules version a current-copy read must reach before Knox's silence counts; defaults to Knox's current one. */
  knoxVersion?: number;
  /** With the settled read on, a current-copy read at or above Knox's stale-read floor counts (defaults to the switch). */
  droppedLine?: boolean;
}

/** The Knox rules version a read of the current copy must reach before Knox's silence on a fee counts. */
export function requiredCurrentReadVersion(feeReadVersion: number | null, knoxVersion: number, droppedLine: boolean): number {
  return Math.max(droppedLine ? STALE_COPY_SETTLED_READ_FLOOR : knoxVersion, feeReadVersion ?? 0);
}

export interface StaleCopyJudgement {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  sourceDocumentId: number;
  currentDocumentId: number;
  canonicalFeeKey: string | null;
  feeName: string;
  amount: number | null;
  verdict: StaleCopyVerdict;
  /** The twin kept, for a `twin` verdict. */
  keptFeePublishedId: number | null;
  /** The current-copy line the fee (or its twin) traces to, when one does. */
  currentLine: string | null;
  reason: string;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const sameAmount = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) < 0.005;
const audienceKey = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

function trace(text: string, name: string, amount: number, key: string | null) {
  return checkFeeAgainstSource(text, name, amount, ".", key);
}

/** Lines after a fee's name that may still hold its price ("Below minimum fee/each occurrence" / "$3.00"). */
const OWN_ROW_WINDOW = 3;

/**
 * The stale fee's own name labels a row at its amount on the current copy other than the twin's line
 * (Nov 2 dry run: "Below minimum fee/each occurrence" $3 paired with "Below minimum balance/per day" $3,
 * "Account Reconciliation Per Hour" $25 with "Research/Account Reconcilement (Per Hour)" $25, "Stop
 * payment" $20 with "ACH stop payment" $20). The shared matcher can trace such a fee to its same-price
 * neighbour on both copies, so the line match alone does not prove one line; the named row of its own
 * means the stale fee is another fee, and it stays live.
 */
function ownRowElsewhere(lines: string[], name: string, amount: number, key: string | null, twinLine: string): boolean {
  const needle = squash(name);
  if (!needle) return false;
  return lines.some((line, index) => {
    if (!squash(line).includes(needle)) return false;
    const own = trace(lines.slice(index, index + OWN_ROW_WINDOW).join("\n"), name, amount, key);
    if (!own.ok) return false;
    const ownLine = squash(own.sourceLine);
    return ownLine !== twinLine && !twinLine.includes(ownLine) && !ownLine.includes(twinLine);
  });
}

// "$35.00", "$.50", and a bare "35.00" (a table cell or "… charged at 35.00"); a bare whole number is no price.
const PRICE_TEXT = /\$\s?(\d[\d,]*(?:\.\d+)?|\.\d+)|(?<![\d.,$])(\d[\d,]*\.\d{2})(?![\d%])/g;
export const printsAmount = (text: string, amount: number) =>
  [...text.matchAll(PRICE_TEXT)].some((match) => sameAmount(Number((match[1] ?? match[2]).replace(/,/g, "")), amount));
const NAME_ENTITIES: Record<string, string> = { amp: "&", nbsp: " ", quot: '"', apos: "'", "#39": "'", "#x27": "'" };
/** A stored name glued to a neighbour's words still counts when this share of it runs unbroken on the page. */
const NAME_RUN_SHARE = 0.6;
const NAME_RUN_MIN = 16;

/**
 * The ways a page may still print the fee's name: whole (HTML entities decoded), its head before a
 * bracket or comma ("Check Cashing (Non-Customers)"), and each part of a slash-joined name ("Paid
 * Overdraft Item/Returned Item Fee").
 */
function nameForms(name: string): string[] {
  const decoded = name.replace(/&(amp|nbsp|quot|apos|#39|#x27);/gi, (_, code: string) => NAME_ENTITIES[code.toLowerCase()] ?? " ");
  const forms = [decoded, decoded.split(/[(,]/)[0], ...decoded.split("/")].map((form) => squash(form)).filter((form) => form.length >= 6);
  return [...new Set(forms)];
}

/** A run of at least `NAME_RUN_SHARE` of the squashed name (and `NAME_RUN_MIN` characters) appears in the squashed page. */
function longRunOf(squashedText: string, name: string): boolean {
  const needle = squash(name);
  const run = Math.max(NAME_RUN_MIN, Math.ceil(needle.length * NAME_RUN_SHARE));
  if (needle.length < run) return false;
  for (let start = 0; start + run <= needle.length; start++) {
    if (squashedText.includes(needle.slice(start, start + run))) return true;
  }
  return false;
}

/**
 * A dropped line is proven only when the current copy no longer prints the fee's name or no longer
 * prints its price anywhere. The shared matcher misses a fee the current copy still carries when its
 * layout moved the price away from the name: a two-column PDF that put "$10.00 per hour /" on the row
 * above "Account Reconciliation fee", a PDF that interleaved one table with another ("ACCOUNT
 * RESEARCH (1 hour minimum)" then "31-day | $1,000 | ... | $20 per hour"), a table flattened column by
 * column ("Monthly fee" far above its "$25"); and a stored name it cannot find: one with an HTML
 * entity the newer copy decodes ("Levy &amp; Garnishment"), or glued to its neighbour's words
 * ("processing Fee varies IRA transfer fee to another financial institution"). Nov 2 dry run of the
 * dropped line: 9 would-be drops were still printed this way. Such a fee stays live
 * (`named_and_priced`); this check only ever keeps a fee live.
 */
export function stillNamedAndPriced(text: string, name: string, amount: number): boolean {
  if (!printsAmount(text, amount)) return false;
  const page = squash(text.replace(/&(amp|nbsp|quot|apos|#39|#x27);/gi, (_, code: string) => NAME_ENTITIES[code.toLowerCase()] ?? " "));
  return nameForms(name).some((form) => page.includes(form)) || longRunOf(page, name);
}

/** A price cell on its own line under a row's name ("$3.00", "$5.00 / month", "3.00"). */
const PRICE_LINE = /^[\s*†‡|(–-]*(?:\$\s?[\d.]|\d[\d,]*\.\d{2}(?![\d%]))/;

/**
 * Review of #2914: the stored text's own rows, not the matcher's sentence pieces. A row that names
 * either fee and prints the amount (on the row or on the price line under it), and is not the row the
 * twin traces to, is another fee at that price: "Overdraft Fee (Per item covering overdrafts …) $35.00"
 * beside "Overdraft Fee under Bounce Protection (… Refer to Bounce Protection Overdraft Disclosure.)
 * $35.00" (institution 1606, copy 38976), where the matcher reads both names from the second row's
 * last sentence and the first row's long text never traces at its price. Kept live when unsure.
 */
function namedRawRowElsewhere(text: string, names: string[], amount: number, twinPiece: string): boolean {
  const rows = text.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  const piece = squash(twinPiece);
  if (!piece) return false;
  const needles = names.map((name) => squash(name)).filter((needle) => needle.length >= 3);
  return rows.some((row, index) => {
    if (!needles.some((needle) => squash(row).includes(needle))) return false;
    const priced = [row];
    for (let next = index + 1; next < rows.length && priced.length < 3 && PRICE_LINE.test(rows[next]); next++) priced.push(rows[next]);
    // The twin's own row holds the whole piece the twin traces to (with the price lines the matcher
    // joined to it). Never the reverse: "Late Payment | $25.00" sits inside "Loan Late Payment | $25.00
    // Flat Fee" and is another row (re-review of #2914, institution 6137, copy 31119).
    if (squash(priced.join(" ")).includes(piece)) return false;
    return printsAmount(priced.join(" "), amount);
  });
}

/** Words a qualifier never rests on: the price's own nouns and joining words. */
const PLAIN_WORDS = new Set(["fee", "charge", "cost", "the", "a", "an", "of", "for", "per", "each", "ea", "and", "or", "to", "at", "in", "on", "s", "c"]);
const words = (text: string | null | undefined) =>
  (text ?? "").toLowerCase().match(/[a-z0-9]+/g)?.map((word) => (word.length > 3 ? word.replace(/s$/, "") : word)) ?? [];

/**
 * A qualifier the stale fee's name carries and the twin's name and product do not ("Processing Fee
 * (personal unsecured loans)" beside "Processing Fee (personal savings secured loans)", Nov 2 dry run)
 * must be printed on the twin's line: else the two may price different products at one amount.
 */
function qualifierMissing(staleName: string, twinName: string, twinProduct: string | null, twinSourceLine: string): boolean {
  const twinWords = new Set([...words(twinName), ...words(twinProduct)]);
  const line = squash(twinSourceLine);
  return words(staleName).some((word) => !PLAIN_WORDS.has(word) && !twinWords.has(word) && !line.includes(word));
}

/** The cell of a row ("A | $5.00 | B | $5.00") a name labels: its own needle first, then a containing one. */
function cellOf(cells: string[], name: string): number {
  const needle = squash(name.replace(/\$\s?\d[\d,]*(?:\.\d+)?/g, " "));
  if (needle.length < 3) return -1;
  const bare = cells.map((cell) => squash(cell.replace(/\$\s?\d[\d,]*(?:\.\d+)?/g, " ")));
  const exact = bare.findIndex((cell) => cell === needle);
  if (exact >= 0) return exact;
  return bare.findIndex((cell) => cell.length >= 3 && (cell.includes(needle) || needle.includes(cell)));
}

/**
 * A row of two cells ("Account History (since last statement) | $5.00 | Mailed Paper Statement Fee |
 * $5.00", "Late payment 4 …… $25 | Late Payment …… $25") holds two fees: a stale fee and a twin named
 * for different cells are different fees, whatever their price.
 */
function otherCell(twinSourceLine: string, staleName: string, twinName: string): boolean {
  const cells = twinSourceLine.split("|").map((cell) => cell.trim()).filter(Boolean);
  if (cells.length < 2 || squash(staleName) === squash(twinName)) return false;
  const stale = cellOf(cells, staleName);
  const twin = cellOf(cells, twinName);
  return stale >= 0 && twin >= 0 && stale !== twin;
}

/**
 * Pure: one superseded copy's live fees judged against its current copy (see the module note). Every
 * fee gets one verdict; only `twin` and `dropped` retire.
 */
export function judgeStaleCopyDocument(input: StaleCopyDocumentInput): StaleCopyJudgement[] {
  const knoxVersion = input.knoxVersion ?? KNOX_RULES_STRATEGY.version;
  const droppedLine = input.droppedLine ?? STALE_COPY_DROPPED_LINE_LIVE;
  const currentText = input.currentText ?? "";
  const olderText = input.olderText ?? "";
  let lines: string[] | null = null;
  const currentLines = () => (lines ??= sourceLines(currentText));
  type Candidate = { twinId: number; line: string; rank: number };
  type Traced = ReturnType<typeof trace>;
  type Prepared =
    | { done: StaleCopyJudgement }
    | { done: null; fee: StaleCopyFeeRow; base: StaleCopyJudgement; amount: number; own: Traced; older: Traced; candidates: Candidate[] };
  const prepared: Prepared[] = input.fees.map((fee): Prepared => {
    const amount = num(fee.amount);
    const base: StaleCopyJudgement = {
      feePublishedId: Number(fee.fee_published_id),
      feeVerifiedId: num(fee.fee_verified_id),
      institutionId: Number(fee.institution_id),
      sourceDocumentId: Number(fee.older_document_id),
      currentDocumentId: Number(fee.current_document_id),
      canonicalFeeKey: fee.canonical_fee_key,
      feeName: (fee.fee_name ?? "").trim(),
      amount,
      verdict: "unproven",
      keptFeePublishedId: null,
      currentLine: null,
      reason: "",
    };
    if (!currentText.trim()) return { done: { ...base, verdict: "no_text" } };
    if (amount == null || !(amount > 0)) return { done: base };
    const own = trace(currentText, base.feeName, amount, fee.canonical_fee_key);
    const older = trace(olderText, base.feeName, amount, fee.canonical_fee_key);
    const lineOf = (result: Traced) => (result.ok ? squash(result.sourceLine) : null);

    // Twin candidates: the current copy's own live read of the same line.
    const candidates: Candidate[] = [];
    for (const twin of input.twins) {
      if (Number(twin.current_document_id) !== base.currentDocumentId) continue;
      if (Number(twin.fee_published_id) === base.feePublishedId) continue;
      if ((twin.canonical_fee_key ?? "") !== (fee.canonical_fee_key ?? "")) continue;
      if (!sameAmount(num(twin.amount), amount)) continue;
      if (audienceKey(twin.fee_audience) !== audienceKey(fee.fee_audience) || !sameProduct(twin.product_name, fee.product_name)) continue;
      const twinTrace = trace(currentText, twin.fee_name, amount, twin.canonical_fee_key);
      if (!twinTrace.ok) continue;
      const twinLine = squash(twinTrace.sourceLine);
      // The stale fee printed on a line of its own on the current copy is another fee, not this twin.
      if (own.ok && lineOf(own) !== twinLine) continue;
      // Same line: the twin has the stale fee's name, or reads the very line the stale fee was read
      // from on the older copy ("An overdraft charge of $25.00 per presentment …" read as "Overdraft
      // Fee" in February and "Overdraft charge" in October). A same-price fee on another line
      // ("Checking Dormant Charges" beside "Savings Dormant Charges") is no twin.
      const lineMatch = lineOf(older) === twinLine;
      if (squash(twin.fee_name) !== squash(base.feeName) && !lineMatch) continue;
      // A row of the stale fee's own name elsewhere on the current copy: another fee, not this twin. A
      // row of the twin's own name elsewhere: the twin's line is not proven, so neither is the pair.
      if (ownRowElsewhere(currentLines(), base.feeName, amount, fee.canonical_fee_key, twinLine)) continue;
      if (ownRowElsewhere(currentLines(), twin.fee_name, amount, twin.canonical_fee_key, twinLine)) continue;
      if (namedRawRowElsewhere(currentText, [base.feeName, twin.fee_name], amount, twinTrace.sourceLine)) continue;
      if (otherCell(twinTrace.sourceLine, base.feeName, twin.fee_name)) continue;
      if (qualifierMissing(base.feeName, twin.fee_name, twin.product_name, twinTrace.sourceLine)) continue;
      candidates.push({ twinId: Number(twin.fee_published_id), line: twinTrace.sourceLine.slice(0, 300), rank: lineMatch ? 0 : 1 });
    }
    return { done: null, fee, base, amount, own, older, candidates };
  });

  // One twin stands for one old fee on this copy (review of #2906): two live "Monthly service
  // charge $10" fees read from the older copy cannot both retire against one current line. Pairs
  // whose older line is the twin's line go first, then same-name pairs, then the lowest fee id; an
  // old fee left without a twin of its own stays live (unproven).
  const pairs = prepared
    .flatMap((item) => (item.done ? [] : item.candidates.map((candidate) => ({ feeId: item.base.feePublishedId, candidate }))))
    .sort((a, b) => a.candidate.rank - b.candidate.rank || a.feeId - b.feeId || a.candidate.twinId - b.candidate.twinId);
  const assigned = new Map<number, Candidate>();
  const usedTwins = new Set<number>();
  for (const pair of pairs) {
    if (assigned.has(pair.feeId) || usedTwins.has(pair.candidate.twinId)) continue;
    assigned.set(pair.feeId, pair.candidate);
    usedTwins.add(pair.candidate.twinId);
  }

  const judged = prepared.map((item): StaleCopyJudgement => {
    if (item.done) return item.done;
    const { fee, base, amount, own, older, candidates } = item;
    const match = assigned.get(base.feePublishedId);
    if (match) {
      return {
        ...base,
        verdict: "twin",
        keptFeePublishedId: match.twinId,
        currentLine: match.line,
        reason: `${STALE_COPY_TWIN_REASON_PREFIX}${match.twinId} (#${base.sourceDocumentId} -> #${base.currentDocumentId})`,
      };
    }
    // Its twin stands for another old fee on this copy: keep it live rather than guess.
    if (candidates.length > 0) return base;
    if (own.ok) return { ...base, verdict: "stated", currentLine: own.sourceLine.slice(0, 300) };

    const required = requiredCurrentReadVersion(num(fee.fee_read_version), knoxVersion, droppedLine);
    const readAt = num(fee.current_read_version);
    if (readAt == null || readAt < required) return { ...base, verdict: "waiting_reread" };
    if (!older.ok) return base;
    const layout = currentCopyVerdict(
      {
        fee_published_id: base.feePublishedId,
        fee_verified_id: base.feeVerifiedId ?? 0,
        institution_id: base.institutionId,
        older_document_id: base.sourceDocumentId,
        current_document_id: base.currentDocumentId,
        canonical_fee_key: fee.canonical_fee_key ?? "",
        fee_name: base.feeName,
        amount,
        product_name: fee.product_name,
        restated_row: false,
      },
      currentText,
      olderText,
    );
    if (layout === "still_stated") return { ...base, verdict: "stated" };
    if (layout !== "dropped" && layout !== "still_named") return base;
    const ownName = squash(base.feeName);
    const knoxRow = input.rawRows.some((row) =>
      Number(row.current_document_id) === base.currentDocumentId
      && sameAmount(num(row.amount), amount)
      && squash(row.fee_name ?? "") === ownName);
    if (knoxRow) return { ...base, verdict: "knox_reads_it" };
    // A live fee read from the current copy in the same category at the same amount may be this fee
    // under the page's new name ("$10 monthly fee if your daily balance falls below $500" became "$10 plus
    // tax maintenance fee if …", institution 3575, Nov 2 dry run). Hamilton's current-copy check skips
    // the same pair (`restated_row`); here it stays live too.
    const restated = input.twins.some((twin) =>
      Number(twin.current_document_id) === base.currentDocumentId
      && Number(twin.fee_published_id) !== base.feePublishedId
      && (twin.canonical_fee_key ?? "") === (fee.canonical_fee_key ?? "")
      && sameAmount(num(twin.amount), amount));
    if (restated) return { ...base, verdict: "restated" };
    if (stillNamedAndPriced(currentText, base.feeName, amount)) return { ...base, verdict: "named_and_priced" };
    if (!samePageUrl(fee.older_url, fee.current_url)) return { ...base, verdict: "not_same_page" };
    return {
      ...base,
      verdict: "dropped",
      reason: `${STALE_COPY_DROPPED_REASON_PREFIX}${base.currentDocumentId} (Knox v${readAt}; read from #${base.sourceDocumentId})`,
    };
  });

  // Same schedule: the current copy must carry enough of the older copy's fees for its silence to count.
  // A fee kept live by a guard (restated, named_and_priced, not_same_page) was a drop before those guards
  // existed, and still counts on the dropped side here: otherwise the guards would shrink the count and
  // let a copy that is not the same schedule pass, so its other drops retire (review of #2950).
  const KEPT_BY_GUARD: ReadonlySet<string> = new Set(["restated", "named_and_priced", "not_same_page"]);
  const proven = judged.filter((fee) => fee.verdict === "twin" || fee.verdict === "stated" || fee.verdict === "dropped" || KEPT_BY_GUARD.has(fee.verdict));
  const carried = proven.filter((fee) => fee.verdict === "twin" || fee.verdict === "stated").length;
  const byFees = carried >= NEWER_COPY_MIN_SHARED_FEES && carried >= proven.length * NEWER_COPY_MIN_SHARED_SHARE;
  // With the switch on, the same address whose text mostly carries over is the same page too: a bank that
  // drops a whole block of fees (Olympia Federal's eight HELOC third-party lines) leaves too few live
  // fees carried for the count above, though the rest of the page is unchanged.
  const first = input.fees[0];
  const byText = droppedLine && first != null && samePageUrl(first.older_url, first.current_url)
    && pageTextOverlap(olderText, currentText) >= STALE_COPY_SAME_TEXT_SHARE;
  const recognized = byFees || byText;
  return recognized ? judged : judged.map((fee) => (fee.verdict === "dropped" ? { ...fee, verdict: "not_same_schedule" as const, reason: "" } : fee));
}

export interface StaleCopyFindings {
  documents: number;
  checked: number;
  byVerdict: Record<StaleCopyVerdict, number>;
  /** Fees to retire (`twin` + `dropped`). */
  matched: number;
  institutions: number;
  samples: StaleCopyJudgement[];
}

export interface StaleCopyResult extends StaleCopyFindings {
  live: boolean;
  dryRun: boolean;
  scoped: boolean;
  knoxVersion: number;
  /** `STALE_COPY_DROPPED_LINE_LIVE` as this step read it. */
  droppedLine: boolean;
  afterId: number;
  /** The next step's cursor: the last copy read on a full batch, or 0 once a pass reaches the end. */
  nextAfterId: number;
  flagged: number;
  waiting: number;
  cleared: number;
  takenDown: number[];
}

function emptyVerdicts(): Record<StaleCopyVerdict, number> {
  return Object.fromEntries(STALE_COPY_VERDICTS.map((verdict) => [verdict, 0])) as Record<StaleCopyVerdict, number>;
}

/** Pure: the findings over many documents' judgements. */
export function staleCopyFindings(judgements: StaleCopyJudgement[]): StaleCopyFindings & { retire: StaleCopyJudgement[] } {
  const byVerdict = emptyVerdicts();
  for (const fee of judgements) byVerdict[fee.verdict] += 1;
  const retire = judgements.filter((fee) => fee.verdict === "twin" || fee.verdict === "dropped");
  return {
    documents: new Set(judgements.map((fee) => fee.sourceDocumentId)).size,
    checked: judgements.length,
    byVerdict,
    matched: retire.length,
    institutions: new Set(retire.map((fee) => fee.institutionId)).size,
    samples: retire.slice(0, STALE_COPY_SAMPLES),
    retire,
  };
}

/**
 * Read-only: the live flat fees on the next `limit` superseded copies after the cursor (oldest copy
 * first), each with the newest copy at the end of its `superseded_by_id` chain and the Knox rules
 * versions that read each.
 *
 * Driven from `source_documents` (cursor and limit first), not from the live table: a copy is taken
 * when one live flat fee of its own institution was read from it, probed through the institution's
 * live-fee index (`published_fee_records_live_institution_idx`), so a step reads about 60 copies'
 * fees instead of joining every live fee through verified and raw (review of #2906: ~2.6 s a step).
 * The probe covers every raw source (Knox rows and the February import alike), since
 * `raw_fee_observations` has no plain index on `source_document_id`.
 */
export function staleCopyRowsSql(db: SqlTag, options: { institutionId?: number; limit?: number; afterId?: number } = {}) {
  const scoped = options.institutionId != null;
  const limit = Math.max(1, Math.min(options.limit ?? STALE_COPY_DOCUMENT_LIMIT, 5_000));
  return db<StaleCopyFeeRow[]>`
    WITH RECURSIVE docs AS MATERIALIZED (
      SELECT sd.id AS older_document_id, sd.institution_id, sd.superseded_by_id
        FROM source_documents sd
       CROSS JOIN LATERAL (
         SELECT 1 FROM published_fee_records fp
           JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
           JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
          WHERE fp.institution_id = sd.institution_id AND fr.source_document_id = sd.id
            AND fp.rolled_back_at IS NULL AND fp.quarantined_at IS NULL AND fp.amount_kind = 'flat' AND fp.amount > 0
            AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
          LIMIT 1
       ) has_live
       WHERE sd.superseded_by_id IS NOT NULL
         AND sd.superseded_by_id <> sd.id
         AND sd.id > ${options.afterId ?? 0}::bigint
         AND (${!scoped} OR sd.institution_id = ${options.institutionId ?? 0})
       ORDER BY sd.id
       LIMIT ${limit}::int
    ), live AS MATERIALIZED (
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, d.older_document_id,
             fp.canonical_fee_key, fp.fee_name, fp.amount, fr.product_name, fp.fee_audience
        FROM docs d
        JOIN published_fee_records fp ON fp.institution_id = d.institution_id
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id AND fr.source_document_id = d.older_document_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.amount_kind = 'flat'
         AND fp.amount > 0
         -- notAdminCorrectedSql("fp") (fee-correction-guard), inline for the tagged template.
         AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
    ), chain AS (
      -- The newest copy at the end of the page's chain: a copy can itself be superseded.
      SELECT d.older_document_id, d.superseded_by_id AS current_document_id, 1 AS depth FROM docs d
      UNION ALL
      SELECT c.older_document_id, s.superseded_by_id, c.depth + 1
        FROM chain c JOIN source_documents s ON s.id = c.current_document_id
       WHERE s.superseded_by_id IS NOT NULL AND s.superseded_by_id <> s.id AND c.depth < 20
    ), current_copy AS MATERIALIZED (
      SELECT DISTINCT ON (older_document_id) older_document_id, current_document_id FROM chain ORDER BY older_document_id, depth DESC
    ), versions AS MATERIALIZED (
      -- Read versions once per copy, not once per fee.
      SELECT cc.older_document_id, cc.current_document_id,
             (SELECT MAX(pa.strategy_version) FROM pipeline_attempts pa
               WHERE pa.source_document_id = cc.older_document_id AND pa.stage = 'extract' AND pa.strategy = ${KNOX_RULES_STRATEGY.strategy}) AS fee_read_version,
             (SELECT MAX(pa.strategy_version) FROM pipeline_attempts pa
               WHERE pa.source_document_id = cc.current_document_id AND pa.stage = 'extract' AND pa.strategy = ${KNOX_RULES_STRATEGY.strategy}
                 AND pa.input_fingerprint = (
                   SELECT t.text_hash FROM agent_source_texts t
                    WHERE t.source_document_id = cc.current_document_id AND t.status = 'completed' AND t.normalized_text IS NOT NULL
                    ORDER BY t.id DESC LIMIT 1
                 )) AS current_read_version
        FROM current_copy cc
    )
    SELECT live.fee_published_id, live.fee_verified_id, live.institution_id, live.older_document_id, v.current_document_id,
           live.canonical_fee_key, live.fee_name, live.amount, live.product_name, live.fee_audience,
           v.fee_read_version, v.current_read_version,
           older_doc.document_url AS older_url, current_doc.document_url AS current_url
      FROM live
      JOIN versions v ON v.older_document_id = live.older_document_id
      LEFT JOIN source_documents older_doc ON older_doc.id = v.older_document_id
      LEFT JOIN source_documents current_doc ON current_doc.id = v.current_document_id
     ORDER BY live.older_document_id, live.fee_published_id
  `;
}

/** One current copy and the institution whose page it is. */
export interface StaleCopyCurrentDocument {
  currentDocumentId: number;
  institutionId: number;
}

/**
 * Read-only: live flat fees read from the given current copies, probed through each copy's
 * institution's live fees (the live-institution index), not by a scan of raw rows.
 */
export function currentTwinsSql(db: SqlTag, copies: StaleCopyCurrentDocument[]) {
  return db<StaleCopyTwinRow[]>`
      SELECT fp.fee_published_id, fr.source_document_id AS current_document_id, fp.canonical_fee_key, fp.fee_name, fp.amount,
             fr.product_name, fp.fee_audience
        FROM unnest(${copies.map((copy) => copy.currentDocumentId)}::bigint[], ${copies.map((copy) => copy.institutionId)}::bigint[])
             AS c(current_document_id, institution_id)
        JOIN published_fee_records fp ON fp.institution_id = c.institution_id
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id AND fr.source_document_id = c.current_document_id
       WHERE fp.rolled_back_at IS NULL AND fp.quarantined_at IS NULL AND fp.amount_kind = 'flat'
  `;
}

/**
 * Read-only: every raw row on the given current copies, whatever wrote it. Any row that still names the
 * fee at its amount keeps it live (`knox_reads_it`), so no source may be left out: on prod (Nov 2) 146
 * current copies also carry `migration_v10` rows and 4 carry `magellan` rows. Knox and `migration_v10`
 * rows are read through their own partial indexes; the few other rows (under 500 in all) by a scan.
 */
export function currentRawRowsSql(db: SqlTag, currentIds: number[]) {
  return db<StaleCopyRawRow[]>`
    SELECT source_document_id AS current_document_id, fee_name, amount
      FROM raw_fee_observations
     WHERE source = 'knox' AND source_document_id = ANY(${currentIds}::bigint[])
    UNION ALL
    SELECT source_document_id AS current_document_id, fee_name, amount
      FROM raw_fee_observations
     WHERE source = 'migration_v10' AND source_document_id = ANY(${currentIds}::bigint[])
    UNION ALL
    SELECT source_document_id AS current_document_id, fee_name, amount
      FROM raw_fee_observations
     WHERE source NOT IN ('knox', 'migration_v10') AND source_document_id = ANY(${currentIds}::bigint[])
  `;
}

async function readCursor(db: SqlTag): Promise<number> {
  try {
    const [row] = await inSavepoint(db, (scope) => scope<{ next_after_id: string | null }[]>`
      SELECT detail->>'next_after_id' AS next_after_id
        FROM agent_run_events
       WHERE event_type = ${STALE_COPY_CHECK}
         AND detail->>'next_after_id' IS NOT NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `);
    return num(row?.next_after_id ?? null) ?? 0;
  } catch (error) {
    console.warn("[darwin] stale copy cursor read failed", error instanceof Error ? error.message : error);
    return 0;
  }
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a failed
 * write leaves the fees as they were.
 */
export async function recheckStaleCopies(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date; knoxVersion?: number; droppedLine?: boolean },
): Promise<StaleCopyResult> {
  const live = options.live ?? STALE_COPY_RETIRE_LIVE;
  const droppedLine = options.droppedLine ?? STALE_COPY_DROPPED_LINE_LIVE;
  const knoxVersion = options.knoxVersion ?? KNOX_RULES_STRATEGY.version;
  const scoped = options.institutionId != null;
  const afterId = scoped ? 0 : await readCursor(db);
  const limit = Math.max(1, Math.min(options.limit ?? STALE_COPY_DOCUMENT_LIMIT, 5_000));
  const result: StaleCopyResult = {
    live, dryRun: options.dryRun, scoped, knoxVersion, droppedLine, afterId, nextAfterId: afterId,
    documents: 0, checked: 0, byVerdict: emptyVerdicts(), matched: 0, institutions: 0, samples: [],
    flagged: 0, waiting: 0, cleared: 0, takenDown: [],
  };

  let judgements: StaleCopyJudgement[];
  try {
    judgements = await inSavepoint(db, async (scope) => {
      const fees = await staleCopyRowsSql(scope, { institutionId: options.institutionId, limit, afterId });
      const olderIds = [...new Set(fees.map((fee) => Number(fee.older_document_id)))];
      // A full batch continues after its last copy; a short one finished the pass.
      result.nextAfterId = scoped ? afterId : olderIds.length >= limit ? Math.max(...olderIds) : 0;
      if (fees.length === 0) return [];
      const currentIds = [...new Set(fees.map((fee) => Number(fee.current_document_id)))];
      const ids = [...new Set([...currentIds, ...fees.map((fee) => Number(fee.older_document_id))])];
      const copies = [...new Map(fees.map((fee) => [Number(fee.current_document_id), Number(fee.institution_id)])).entries()]
        .map(([currentDocumentId, institutionId]) => ({ currentDocumentId, institutionId }));
      const twins = await currentTwinsSql(scope, copies);
      const raw = await currentRawRowsSql(scope, currentIds);
      const texts = await scope<{ source_document_id: number | string; normalized_text: string }[]>`
        SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
          FROM agent_source_texts
         WHERE source_document_id = ANY(${ids}::bigint[]) AND status = 'completed' AND normalized_text IS NOT NULL
         ORDER BY source_document_id, id DESC
      `;
      const text = new Map(texts.map((row) => [Number(row.source_document_id), row.normalized_text]));
      const byDocument = new Map<number, StaleCopyFeeRow[]>();
      for (const fee of fees) {
        const id = Number(fee.older_document_id);
        byDocument.set(id, [...(byDocument.get(id) ?? []), fee]);
      }
      return [...byDocument.values()].flatMap((docFees) => {
        const currentId = Number(docFees[0].current_document_id);
        return judgeStaleCopyDocument({
          fees: docFees,
          twins: twins.filter((twin) => Number(twin.current_document_id) === currentId),
          rawRows: raw.filter((row) => Number(row.current_document_id) === currentId),
          currentText: text.get(currentId) ?? null,
          olderText: text.get(Number(docFees[0].older_document_id)) ?? null,
          knoxVersion,
          droppedLine,
        });
      });
    });
  } catch (error) {
    console.warn("[darwin] stale copy check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { retire, ...findings } = staleCopyFindings(judgements);
  Object.assign(result, findings);

  if (live && !options.dryRun) {
    const retiring = new Set(retire.map((fee) => fee.feePublishedId));
    const passing = judgements.filter((fee) => !retiring.has(fee.feePublishedId) && fee.verdict === "stated").map((fee) => fee.feePublishedId);
    const unjudged = judgements.filter((fee) => !retiring.has(fee.feePublishedId) && fee.verdict !== "stated").map((fee) => fee.feePublishedId);
    const look = await secondLook(db, { check: STALE_COPY_CHECK, runId: options.runId, failing: retire, passing, unjudged, dryRun: false, now: options.now });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    result.cleared = look.cleared;
    if (look.confirmed.length > 0) {
      result.takenDown = await archiveStaleCopies(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  if (!options.dryRun && (result.checked > 0 || result.nextAfterId !== afterId)) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${STALE_COPY_CHECK}, 'completed',
          ${`Read ${result.checked} live fee(s) on ${result.documents} superseded cop${result.documents === 1 ? "y" : "ies"}: ${result.byVerdict.twin} twin(s) of a live current-copy fee, ${result.byVerdict.dropped} not on the current copy, ${result.byVerdict.stated} still stated, ${result.byVerdict.waiting_reread} waiting on a Knox v${droppedLine ? `${STALE_COPY_SETTLED_READ_FLOOR}+` : knoxVersion} read; ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would retire, nothing written"}`},
          ${JSON.stringify(staleCopyDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] stale copy check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/**
 * Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never
 * deleted. A twin retire needs its kept twin still live in the same write, so the line keeps a reading.
 */
export async function archiveStaleCopies(db: SqlTag, runId: number, fees: StaleCopyJudgement[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`${STALE_COPY_BATCH_PREFIX}${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[],
                      ${fees.map((fee) => fee.amount ?? 0)}::numeric[], ${fees.map((fee) => fee.keptFeePublishedId ?? 0)}::bigint[])
               AS v(fee_published_id, reason, amount, kept_id)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.amount = v.amount
           AND fp.rolled_back_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
           -- A twin retires only while the fee it keeps stays live: not rolled back or quarantined, and
           -- with no takedown pending from another check's second look, so neither fee comes down twice.
           AND (v.kept_id = 0 OR (
             EXISTS (
               SELECT 1 FROM published_fee_records kept
                WHERE kept.fee_published_id = v.kept_id AND kept.rolled_back_at IS NULL AND kept.quarantined_at IS NULL
             )
             AND NOT EXISTS (
               SELECT 1 FROM pipeline_feedback pending
                WHERE pending.fee_published_id = v.kept_id AND pending.kind = 'takedown_pending'
             )
           ))
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const verified = fees.filter((fee) => ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
      if (verified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? ${STALE_COPY_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${STALE_COPY_FLAG}::text)
                 END
           WHERE fv.fee_verified_id = ANY(${verified.map((fee) => fee.feeVerifiedId as number)}::bigint[])
             AND fv.review_status IN ('verified', 'approved')
        `;
      }
      return fees.filter((fee) => ids.has(fee.feePublishedId)).map((fee) => fee.feePublishedId);
    });
    if (closed.length > 0) invalidatePublicReadCache();
    return closed;
  } catch (error) {
    console.error("[darwin] stale copy takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: StaleCopyJudgement[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.stale_copy_takedown', 'completed',
        ${`Archived ${archived.length} live fee(s) read from a superseded copy of their page, on their second look`},
        ${JSON.stringify({ version: STALE_COPY_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] stale copy takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: StaleCopyJudgement) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    older_document_id: fee.sourceDocumentId,
    current_document_id: fee.currentDocumentId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    verdict: fee.verdict,
    kept_fee_published_id: fee.keptFeePublishedId,
    current_line: fee.currentLine,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function staleCopyDetail(result: StaleCopyResult) {
  return {
    check: STALE_COPY_CHECK,
    version: STALE_COPY_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    knox_version: result.knoxVersion,
    dropped_line: result.droppedLine,
    after_id: result.afterId,
    next_after_id: result.scoped ? null : result.nextAfterId,
    documents: result.documents,
    checked: result.checked,
    by_verdict: result.byVerdict,
    matched: result.matched,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    cleared: result.cleared,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
