/**
 * #1092 (state key 5608, River City Bank): a monthly maintenance fee printed under a heading that names
 * a service, not an account, is that service's own monthly fee, never the checking account's. River
 * City's schedule prints "Consumer Online Banking Services and Mobile Banking Fees" over "Set Up Fee |
 * No charge" and "Monthly Maintenance Fee | No charge"; Knox's free read files the second row as
 * `monthly_maintenance` $0, which would tell readers the bank has free checking. The row's own words
 * name no service, so the name rules (`SERVICE_MONTHLY_CHARGE_NAME` in `service-monthly-charge.ts`,
 * guard v102) cannot see it, and `classifyFeeText` gives the heading no category.
 *
 * Shared by Knox (rules v173 holds such a read for review, $0 and priced alike, never sending it to
 * Darwin as the account's fee), Darwin's verify (refuses it, `service_maintenance_heading`) and its
 * live re-check (`darwin/service-maintenance-check.ts`). Pure: no database and no agent imports.
 *
 * The taxonomy has no category for a service's monthly fee: `bill_pay` and `mobile_deposit` take a
 * bill payer's or a mobile check deposit's monthly charge by its name (guard v102), and an online
 * banking, text banking or remote capture monthly charge has no type of the 50. So a match is held,
 * never re-filed.
 *
 * The test is structural and prefers refusing to matching:
 * - The row is found in the text by its own line (Knox's excerpt, or its first cell on a line of its
 *   own when the text stacks label and value). Every place the text prints it must pass; a row printed
 *   nowhere is never one.
 * - Its nearest heading is the first line above it that is shaped like a heading (short, no price, no
 *   cell break, no list mark, not ending like a sentence) and is not a stacked row's label (a label
 *   whose next printed line is its value: "Set Up Fee" over "No charge"). Sibling rows, values and notes
 *   between are passed over. A note between that names an account ("for checking accounts only")
 *   refuses the match.
 * - That heading names only services (`serviceHeadingOf`): online, mobile, internet or text banking,
 *   bill pay, e-statements, remote deposit, Zelle or treasury, with only audience and schedule words
 *   beside them ("Consumer", "Business", "Services", "Fees", "and"). "Checking with Online Banking",
 *   "Online Banking Included" and "Electronic Banking" are not.
 * - The heading opens its own section: the line above it is not another heading-shaped line (an
 *   account's list of features, "Premier Checking" / "Online Banking" / "Mobile Banking"), does not end
 *   in a colon, and does not introduce what an account includes, features or offers.
 * - The row's own label names no account ("Checking Monthly Maintenance Fee"), and the row has one price
 *   cell: "Monthly Maintenance Fee | $5.00 | $10.00" prices several accounts (review of #2953).
 * - The rows right above the heading are not an account's block and open on a heading of their own
 *   (review of #2953): a feature line inside an account's table ("Minimum to open | $100.00" / "Online
 *   Banking and Mobile Banking"), or straight after a fee row with no heading above it, is refused.
 */

export type ServiceKind =
  | "online_banking"
  | "mobile_banking"
  | "internet_banking"
  | "bill_pay"
  | "estatements"
  | "remote_deposit"
  | "text_banking"
  | "zelle"
  | "treasury";

export interface ServiceMaintenance {
  /** The nearest heading, as printed. */
  heading: string;
  /** The services it names. */
  services: ServiceKind[];
}

/** The only category this rule reads. */
export const SERVICE_MAINTENANCE_CATEGORY = "monthly_maintenance";
/** The longest line read as a heading. */
export const HEADING_MAX_CHARS = 90;
/** The most words in a heading. */
const HEADING_MAX_WORDS = 12;
/** How many printed lines above the row are read for its heading; none found within them is no match. */
export const HEADING_LOOKBACK_LINES = 20;

const SERVICE_PHRASES: ReadonlyArray<readonly [ServiceKind, RegExp]> = [
  ["online_banking", /\bon-?\s?line\s+banking\b/gi],
  ["mobile_banking", /\bmobile\s+banking\b/gi],
  ["internet_banking", /\binternet\s+banking\b/gi],
  ["bill_pay", /\bbill\s?pay(?:ments?)?\b/gi],
  ["estatements", /\be-?\s?statements?\b|\belectronic\s+statements?\b/gi],
  ["remote_deposit", /\bremote\s+deposits?(?:\s+capture)?\b/gi],
  ["text_banking", /\btext\s+banking\b/gi],
  ["zelle", /\bzelle\b/gi],
  ["treasury", /\btreasury(?:\s+management)?\b/gi],
];

/**
 * The words a service heading may carry beside its services: its audience, "services" and "fees", a
 * joiner, and the first half of a service shared with the next ("Online & Mobile Banking").
 */
const HEADING_FILLER = new Set([
  "consumer", "personal", "business", "commercial", "retail",
  "service", "services", "fee", "fees", "charge", "charges", "schedule", "pricing",
  "and", "or", "of", "the",
  "online", "mobile", "internet", "text",
]);

/** A deposit account: a heading, row label or note that names one is the account's, never a service's. */
const ACCOUNT_WORD = /\b(?:checking|savings|share\s+drafts?|share\s+accounts?|money\s+market|accounts?|certificates?|cds?|iras?|club|hsa)\b/i;
/** A cell break as Knox writes a table row. */
const ROW_CELL = /\s\|\s|^\||\|$/;
/** A price, a rate or a cents figure: a row or a value, never a heading. */
const PRICE = /\$\s*\d|\b\d+[.,]\d{2}\b|\d\s*%/;
/**
 * A row's value printed on its own line: "No charge", "No charge per transfer ...", "$5.00 per month",
 * or a bare "Free", "None", "Waived", "N/A", "Included" or "Varies" ("Free Checking" is a heading).
 */
const VALUE_LINE = /^(?:\$|no\s+(?:charge|fee|cost)s?\b|(?:free|none|waived|n\/[ca]|included|varies)[\s.*\d]*$)/i;
/** A bracketed note under a heading ("(Fee shown as OLB Fee)"): a note, never a heading. */
const BRACKETED_NOTE = /^\(.*\)$/;
/** A list mark: a list item is never a heading. */
const LIST_MARK = /^[-*•·▪◦●]\s*/;
/** The line above a heading that introduces an account's list of what it includes. */
const LIST_LEAD = /:\s*$|\b(?:includ\w*|features?|benefits?|following|comes\s+with|offers?)\b/i;
/** An account's own terms in a row of its table: opening deposit, minimum balance, a rate. */
const ACCOUNT_TERMS = /\b(?:minimum\s+(?:daily\s+)?balance|minimum\s+(?:to\s+open|opening|deposit)|opening\s+deposit|to\s+open|apy|annual\s+percentage\s+yield|interest\s+rate|dividends?)\b/i;

function tidy(line: string | null | undefined): string {
  return (line ?? "").replace(/\s+/g, " ").trim();
}

/** Pure: the services a heading names, when it names only services; null for any other heading. */
export function serviceHeadingOf(heading: string | null | undefined): ServiceKind[] | null {
  // Note marks and footnote numbers glued on ("Online Banking Fees1", "Zelle®") are no words.
  let rest = tidy(heading).toLowerCase().replace(/[®™©*†‡\d]/g, " ");
  if (!rest || ACCOUNT_WORD.test(rest)) return null;
  const services: ServiceKind[] = [];
  for (const [kind, phrase] of SERVICE_PHRASES) {
    if (rest.search(phrase) < 0) continue;
    services.push(kind);
    rest = rest.replace(phrase, " ");
  }
  if (services.length === 0) return null;
  const leftover = rest.match(/[a-z]+/g) ?? [];
  return leftover.every((word) => HEADING_FILLER.has(word)) ? services : null;
}

function isRow(line: string): boolean {
  return ROW_CELL.test(line) || PRICE.test(line) || VALUE_LINE.test(line);
}

/** A line shaped like a heading: short, no price or cell, no list mark, not ending like a sentence. */
function headingShaped(raw: string): boolean {
  if (LIST_MARK.test(raw.trim())) return false;
  const line = tidy(raw);
  if (!line || line.length > HEADING_MAX_CHARS || isRow(line)) return false;
  if (/[.;,!?]$/.test(line) || BRACKETED_NOTE.test(line)) return false;
  if (line.split(" ").length > HEADING_MAX_WORDS) return false;
  return /^[A-Z0-9"'(“]/.test(line);
}

function nextPrinted(lines: readonly string[], from: number, step: 1 | -1): number {
  for (let at = from + step; at >= 0 && at < lines.length; at += step) if (tidy(lines[at])) return at;
  return -1;
}

/** A stacked row's label: its next printed line is its value ("Set Up Fee" over "No charge"). */
function stackedLabel(lines: readonly string[], at: number): boolean {
  const next = nextPrinted(lines, at, 1);
  return next >= 0 && VALUE_LINE.test(tidy(lines[next]));
}

type HeadingRead = { kind: "heading"; at: number; heading: string } | { kind: "refuse" };

/** The row's nearest heading (see the module note), or a refusal when the text leaves it in doubt. */
function nearestHeading(lines: readonly string[], rowAt: number): HeadingRead {
  let read = 0;
  for (let at = rowAt - 1; at >= 0 && read < HEADING_LOOKBACK_LINES; at -= 1) {
    const line = tidy(lines[at]);
    if (!line) continue;
    read += 1;
    if (isRow(line)) continue;
    if (headingShaped(lines[at])) {
      if (stackedLabel(lines, at)) continue;
      return { kind: "heading", at, heading: line };
    }
    // A note or list item between the heading and the row: one that names an account leaves the
    // row's owner in doubt.
    if (ACCOUNT_WORD.test(line)) return { kind: "refuse" };
  }
  return { kind: "refuse" };
}

/**
 * Review of #2953: whether the rows right above a heading leave the heading's section in doubt. A
 * feature line printed inside an account's table ("Minimum to open | $100.00" / "Online Banking and
 * Mobile Banking" / "Monthly Maintenance Fee | $5.00", or under a "Fee | Basic Checking | Premier
 * Checking" column row) is no section of its own. The block is the run of rows, values and stacked labels
 * above the heading. It is in doubt when a line of it names an account or an account's terms (an opening
 * deposit, a minimum or minimum daily balance, a rate), and also (second review) when it reaches no
 * heading of its own: a short features line straight after a fee row with nothing above that row
 * ("Overdraft Fee | $30.00" / "Online Banking and Mobile Banking") could be the next account's feature
 * list as easily as a section. Only a block that opens on a heading naming no account clears it.
 */
function blockAboveInDoubt(lines: readonly string[], from: number): boolean {
  let read = 0;
  for (let at = from; at >= 0 && read < HEADING_LOOKBACK_LINES; at -= 1) {
    const line = tidy(lines[at]);
    if (!line) continue;
    read += 1;
    if (ACCOUNT_WORD.test(line) || ACCOUNT_TERMS.test(line)) return true;
    if (isRow(line) || (headingShaped(lines[at]) && stackedLabel(lines, at))) continue;
    return !headingShaped(lines[at]);
  }
  return true;
}

/**
 * The heading opens its own section: no heading-shaped line or list lead right above it, and no account's
 * block of rows right above it.
 */
function opensSection(lines: readonly string[], headingAt: number): boolean {
  const above = nextPrinted(lines, headingAt, -1);
  if (above < 0) return true;
  const line = tidy(lines[above]);
  if (isRow(line)) return !blockAboveInDoubt(lines, above);
  return !headingShaped(lines[above]) && !LIST_LEAD.test(line);
}

/** Review of #2953: a row with more than one price cell ("$5.00 | $10.00") prices several products. */
function priceCells(line: string): number {
  return tidy(line).split(/\s\|\s/).slice(1).filter((cell) => PRICE.test(cell) || VALUE_LINE.test(cell.trim())).length;
}

function firstCell(line: string): string {
  return tidy(line.split(/\s\|\s/)[0]);
}

/** Every index where the text prints the row: its whole line, or its label on a line of its own. */
function rowPlaces(lines: readonly string[], rowLine: string): number[] {
  const whole = tidy(rowLine).toLowerCase();
  const label = firstCell(rowLine).toLowerCase();
  if (!whole) return [];
  const places: number[] = [];
  lines.forEach((raw, index) => {
    const line = tidy(raw).toLowerCase();
    if (line && (line === whole || line.startsWith(whole) || (label.length > 0 && line === label))) places.push(index);
  });
  return places;
}

export interface ServiceMaintenanceInput {
  /** The row the fee was read from (Knox's excerpt, or the line the shared check traces it to). */
  line: string | null | undefined;
  canonicalFeeKey: string | null | undefined;
  /** The text the row was read from. */
  documentText: string | null | undefined;
}

/** Pure: a monthly maintenance read whose row sits under a service's heading (see the module note). */
export function serviceMaintenanceOf(input: ServiceMaintenanceInput): ServiceMaintenance | null {
  if (input.canonicalFeeKey !== SERVICE_MAINTENANCE_CATEGORY || !input.documentText) return null;
  const row = tidy(input.line);
  if (!row || ACCOUNT_WORD.test(firstCell(row)) || priceCells(row) > 1) return null;
  const lines = input.documentText.split(/\r?\n/);
  const places = rowPlaces(lines, row);
  if (places.length === 0) return null;
  let found: ServiceMaintenance | null = null;
  for (const place of places) {
    if (priceCells(lines[place]) > 1) return null;
    const read = nearestHeading(lines, place);
    if (read.kind !== "heading") return null;
    const services = serviceHeadingOf(read.heading);
    if (!services || !opensSection(lines, read.at)) return null;
    found ??= { heading: read.heading, services };
  }
  return found;
}

/**
 * Pure: Darwin's reading (verify and the live re-check). Knox's own row must sit under a service's
 * heading, and so must the line `checkFeeAgainstSource` traces the fee to, when it traces one: a
 * name traced to an account's row elsewhere in the text is the account's fee.
 */
export function serviceMaintenanceRead(input: {
  excerpt: string | null | undefined;
  tracedLine: string | null | undefined;
  canonicalFeeKey: string | null | undefined;
  documentText: string | null | undefined;
}): ServiceMaintenance | null {
  const own = serviceMaintenanceOf({ line: input.excerpt, canonicalFeeKey: input.canonicalFeeKey, documentText: input.documentText });
  if (!own) return null;
  if (input.tracedLine && !serviceMaintenanceOf({ line: input.tracedLine, canonicalFeeKey: input.canonicalFeeKey, documentText: input.documentText })) return null;
  return own;
}
