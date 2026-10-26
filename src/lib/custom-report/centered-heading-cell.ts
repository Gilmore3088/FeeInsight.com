/**
 * #1912: a heading in a vertically centred merged cell. A PDF table prints a merged cell's text once,
 * level with the middle of the rows it spans, so the stored text puts the heading on the middle row
 * only ("Wire Transfers | Outgoing Domestic - Not in Person: $60.00") and the rows above and below it
 * lose it ("Outgoing Domestic: $30.00", "Outgoing International: $45.00 ...", Sound Community Bank,
 * doc 14765). Knox read only the middle row and the bank's $30 wire went unread.
 *
 * A block is found by its layout alone, so Knox and the shared source check see the same blocks:
 * - the middle row is "<Heading> | <name>: <price>", the heading a short figure-free cell;
 * - a row of the block is a contiguous line of the same "<name>: <price>" shape with no cell of its
 *   own, whose name shares a word with the middle row's name (a sibling: "Outgoing International"
 *   beside "Outgoing Domestic - Not in Person");
 * - the block ends at a blank line or any other line (a page footer, a wrapped note, a heading);
 * - rows above that sit right under a heading line of their own ("Stop Payments" / "Online: $20.00")
 *   are that heading's rows, not the block's;
 * - the block is centred: as many rows above the middle as below, give or take one;
 * - a row two middle rows both reach is lent by neither.
 * A caller can narrow further with `accepts` (Knox asks that heading and name read as one fee family).
 * Only the lines' text changes, each borrowed row gaining "<Heading> | "; no price moves. Pure.
 */
const MIDDLE_ROW = /^([A-Z][^|$:\d]{2,40}?)\s+\|\s+([A-Za-z(][^|$:]{1,60}?)\s*:\s*\$\s?\d/;
const BLOCK_ROW = /^([A-Za-z(][^|$:]{1,60}?)\s*:\s*\$\s?\d/;
const MAX_HEADING_WORDS = 4;
const MAX_ROW_NAME_WORDS = 6;
const SEPARATOR = " | ";
const NOT_SIBLING_WORDS = new Set(["and", "the", "for", "per", "fee", "fees", "charge", "charges", "each", "item", "with", "not"]);

/** A short figure-free line that heads the rows under it ("Stop Payments", "Wire Transfers:"). */
function headingLine(line: string): boolean {
  const text = line.replace(/\s+/g, " ").trim().replace(/:$/, "");
  if (!text || /[\d$|%]/.test(text) || !/^[A-Z]/.test(text) || /[.;!?]$/.test(text)) return false;
  return text.split(" ").length <= MAX_HEADING_WORDS;
}

const words = (name: string) => new Set((name.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((word) => !NOT_SIBLING_WORDS.has(word)));

export interface CenteredHeadingOptions {
  /** Whether the heading names a row of this name; a row it does not ends the block. */
  accepts?: (heading: string, middleName: string, rowName: string | null) => boolean;
}

/** Line index of each row that borrows a centred heading, with the heading it borrows. Pure. */
export function centeredHeadingRows(lines: string[], options: CenteredHeadingOptions = {}): Map<number, string> {
  const lent = new Map<number, string | null>();
  const clean = (at: number) => (lines[at] ?? "").replace(/\s+/g, " ").trim();
  for (let index = 0; index < lines.length; index += 1) {
    const middle = clean(index).match(MIDDLE_ROW);
    if (!middle) continue;
    const heading = middle[1].trim();
    const name = middle[2].trim();
    if (heading.split(" ").length > MAX_HEADING_WORDS) continue;
    if (options.accepts && !options.accepts(heading, name, null)) continue;
    const siblings = words(name);
    const rowOf = (at: number): boolean => {
      const line = clean(at);
      const row = line.match(BLOCK_ROW);
      if (!row || line.includes(SEPARATOR.trim())) return false;
      const own = row[1].trim();
      if (own.split(" ").length > MAX_ROW_NAME_WORDS || ![...words(own)].some((word) => siblings.has(word))) return false;
      return !options.accepts || options.accepts(heading, name, own);
    };
    let top = index;
    while (top > 0 && rowOf(top - 1)) top -= 1;
    if (top < index && top > 0 && headingLine(lines[top - 1])) top = index;
    let bottom = index;
    while (bottom + 1 < lines.length && rowOf(bottom + 1)) bottom += 1;
    const above = index - top;
    const below = bottom - index;
    if (above + below === 0 || Math.abs(above - below) > 1) continue;
    for (let at = top; at <= bottom; at += 1) {
      if (at !== index) lent.set(at, lent.has(at) ? null : heading);
    }
  }
  const rows = new Map<number, string>();
  for (const [at, heading] of lent) if (heading) rows.set(at, heading);
  return rows;
}

/** The text with each row of a centred heading's block led by that heading's cell. Pure. */
export function withCenteredHeadingCells(text: string, options?: CenteredHeadingOptions): string;
export function withCenteredHeadingCells(text: string | null | undefined, options?: CenteredHeadingOptions): string | null | undefined;
export function withCenteredHeadingCells(text: string | null | undefined, options: CenteredHeadingOptions = {}): string | null | undefined {
  if (!text || !/\S \| [^|\n$]+:\s*\$/.test(text)) return text;
  const lines = text.split("\n");
  const rows = centeredHeadingRows(lines, options);
  if (rows.size === 0) return text;
  return lines.map((line, at) => (rows.has(at) ? `${rows.get(at)}${SEPARATOR}${line.trim()}` : line)).join("\n");
}
