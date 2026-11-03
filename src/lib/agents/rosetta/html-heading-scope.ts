import type { HeadingKind, HeadingSpan } from "@/lib/heading-context-trailer";

/**
 * Heading scope for `read.html_dom` (#1092, class R1 of the lab's answer-key misses): which real
 * heading or table header each line of the text sits under, so Knox can read a row whose own name
 * names no fee ("Bag Replacement: $25.00 each") under the heading that does ("Night Depository").
 * The reader's text keeps no heading levels, so a short line and a heading looked alike to every
 * stage after Rosetta, and rules that guessed a heading from a line's shape lost to review (#2872,
 * #2888, #2965). This reads only what the markup states:
 *
 *  - an `<h1>`-`<h6>`, or an element with `role="heading"` (level from `aria-level`, default 2);
 *  - a table's header row (`<th>` cells only, or a `<thead>` row): a one-cell row heads the rows
 *    under it, a wider row's cell over the row names (grid column 0) heads them;
 *  - a table row whose one cell holds a heading element heads the rows under it in that table.
 *
 * A heading's scope is the HTML outline's: until the next heading of the same or a higher rank, or
 * the end of the sectioning element or sectioning root that holds it (`article`, `aside`, `nav`,
 * `section`, `header`, `footer`, `main`, `blockquote`, `details`, `dialog`, `fieldset`, `figure`, a
 * layout table's cell). In a table, its header row (or heading row) is nearer than any heading
 * above the table, so it wins; the table's end restores the heading above it.
 *
 * Refused, and blocking the heading above (nothing under them takes any heading): a heading in
 * `nav`, `header`, `footer`, `aside`, `form` or `dialog` (or their ARIA landmarks), and a heading or
 * header cell that is hidden (`hidden`, `aria-hidden="true"`, `display:none`, `visibility:hidden`,
 * or a screen-reader-only or hidden class), itself or through an ancestor.
 *
 * Off by default (`HTML_HEADING_CONTEXT_LIVE`). The reader's text never changes: with the switch on,
 * the walk also writes private-use marks into a second copy of its output, and `headingSpans`
 * turns that copy into the spans of the text's trailer (`heading-context-trailer.ts`). Pure.
 */

export const HTML_HEADING_CONTEXT_LIVE = false;

/** Marks only this module writes and reads: U+E000 to U+E002 never reach the stored text. */
const CONTEXT_MARK = "\uE000";
const HEADING_MARK = "\uE002";
const MARK_END = "\uE001";
const NO_CONTEXT = "x";
const MARKS = /[]/;
const ANY_MARK = /[][^]*/g;

const BOUNDARY_TAGS = new Set([
  "article", "aside", "nav", "section", "header", "footer", "main", "blockquote", "details", "dialog", "fieldset", "figure", "form",
]);
/** Landmarks whose headings name page furniture, not the fee schedule. */
const EXCLUDED_TAGS = new Set(["nav", "header", "footer", "aside", "form", "dialog"]);
const EXCLUDED_ROLES = new Set(["navigation", "banner", "contentinfo", "complementary", "search", "dialog", "alertdialog", "menu", "menubar"]);
const HIDDEN_CLASS =
  /^(?:sr-only|sr-only-focusable|visually-hidden|visuallyhidden|screen-reader-text|screen-reader-only|element-invisible|hidden|hide|invisible|d-none|is-hidden|u-hidden|offscreen)$/i;
const HIDDEN_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i;
const HEADING_TAG = /^h([1-6])$/;
/** A heading this long is a sentence or a block of text, not a name. */
const MAX_HEADING_CHARS = 120;

export interface ScopeElement {
  name: string;
  attribs: Record<string, string>;
}

export function isHiddenElement(element: ScopeElement): boolean {
  const a = element.attribs ?? {};
  if ("hidden" in a || (a["aria-hidden"] ?? "").trim().toLowerCase() === "true") return true;
  if (HIDDEN_STYLE.test(a.style ?? "")) return true;
  return (a.class ?? "").split(/\s+/).some((token) => HIDDEN_CLASS.test(token));
}

function isExcludedLandmark(element: ScopeElement): boolean {
  return EXCLUDED_TAGS.has(element.name) || EXCLUDED_ROLES.has((element.attribs?.role ?? "").trim().toLowerCase());
}

/** 1-6 for a heading element, null for anything else. */
export function headingLevel(element: ScopeElement): number | null {
  const tag = HEADING_TAG.exec(element.name);
  if (tag) return Number(tag[1]);
  if ((element.attribs?.role ?? "").trim().toLowerCase() !== "heading") return null;
  const level = Number.parseInt(element.attribs?.["aria-level"] ?? "", 10);
  return level >= 1 && level <= 6 ? level : 2;
}

interface Registered {
  kind: HeadingKind;
  cell: number;
  text: string;
}

interface StackEntry {
  /** null: a refused heading, which blocks the headings above it. */
  id: number | null;
  level: number;
  boundary: number;
}

interface Frame {
  boundary: boolean;
  blocking: boolean;
  /** A heading element: pushed onto the stack when it closes. */
  heading?: { id: number | null; level: number };
}

export interface ScopeToken {
  frame: Frame;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** The scope state of one walk. Marks are returned as strings for the walker to write. */
export class HeadingScope {
  readonly registered: Registered[] = [];
  private readonly stack: StackEntry[] = [];
  private readonly frames: Frame[] = [];
  private boundaries = 0;
  private blockingDepth = 0;

  private register(entry: Registered): number {
    this.registered.push(entry);
    return this.registered.length - 1;
  }

  /** The heading the next line sits under: the nearest open heading, or none. */
  current(): number | null {
    // Page furniture and hidden content sit under no heading, whatever is open around them.
    if (this.blockingDepth > 0) return null;
    return this.stack.length ? this.stack[this.stack.length - 1].id : null;
  }

  contextMark(id: number | null = this.current()): string {
    return `${CONTEXT_MARK}${id == null ? NO_CONTEXT : id}${MARK_END}`;
  }

  headingMark(id: number): string {
    return `${HEADING_MARK}${id}${MARK_END}`;
  }

  get blocked(): boolean {
    return this.blockingDepth > 0;
  }

  /**
   * Called for every element the walker writes as a block or inline run. Returns a token (and the
   * mark to write before the element's text) for a heading, a sectioning boundary or a blocking
   * element; null for anything else.
   */
  enter(element: ScopeElement, text: () => string): { token: ScopeToken; before: string } | null {
    const level = headingLevel(element);
    const hidden = isHiddenElement(element);
    const excluded = isExcludedLandmark(element);
    if (level != null) {
      const refused = this.blocked || hidden || excluded;
      const value = collapse(text());
      const id = refused || !value || value.length > MAX_HEADING_CHARS ? null : this.register({ kind: level as HeadingKind, cell: -1, text: value });
      const frame: Frame = { boundary: false, blocking: hidden || excluded, heading: { id, level } };
      this.frames.push(frame);
      if (frame.blocking) this.blockingDepth += 1;
      return { token: { frame }, before: id == null ? "" : this.headingMark(id) };
    }
    const boundary = BOUNDARY_TAGS.has(element.name) || excluded;
    const blocking = hidden || excluded;
    if (!boundary && !blocking) return null;
    const frame: Frame = { boundary, blocking };
    this.frames.push(frame);
    if (boundary) this.boundaries += 1;
    if (blocking) this.blockingDepth += 1;
    return { token: { frame }, before: "" };
  }

  /** Closes what `enter` opened; returns the context mark for the text after it. */
  exit(token: ScopeToken): string {
    const frame = this.frames.pop();
    if (frame !== token.frame) throw new Error("heading scope: frames closed out of order");
    if (frame.blocking) this.blockingDepth -= 1;
    if (frame.heading) {
      const { id, level } = frame.heading;
      // The outline: a heading closes every open heading of its rank or lower in its own boundary.
      while (this.stack.length && this.stack[this.stack.length - 1].boundary === this.boundaries && this.stack[this.stack.length - 1].level >= level) {
        this.stack.pop();
      }
      this.stack.push({ id, level, boundary: this.boundaries });
    }
    if (frame.boundary) {
      while (this.stack.length && this.stack[this.stack.length - 1].boundary === this.boundaries) this.stack.pop();
      this.boundaries -= 1;
    }
    return this.contextMark();
  }

  /** A layout table's cell is a sectioning root: its headings end with it. */
  enterRoot(): ScopeToken {
    const frame: Frame = { boundary: true, blocking: false };
    this.frames.push(frame);
    this.boundaries += 1;
    return { frame };
  }

  /** A table's header row (or heading row): returns its id, null when refused. */
  tableHeading(kind: HeadingKind, cell: number, text: string, hidden: boolean): number | null {
    const value = collapse(text);
    if (this.blocked || hidden || !value || value.length > MAX_HEADING_CHARS) return null;
    return this.register({ kind, cell, text: value });
  }
}

/**
 * The trailer's spans from the walk's marked output and the reader's normalised text. `normalize`
 * is the caller's whitespace normaliser (rosetta/read.ts `normalizeWhitespace`). The marked copy,
 * normalised the same way and with its marks removed, must give the text's lines in order; if any
 * line differs, no span is returned.
 */
export function headingSpans(marked: string, text: string, normalize: (value: string) => string, registered: readonly Registered[]): HeadingSpan[] {
  // A page that prints these private-use characters itself (an icon font) cannot carry marks.
  if (MARKS.test(text)) return [];
  const textLines = text.split("\n");
  const markedLines = normalize(marked).split("\n");
  const lineContext: Array<number | null> = textLines.map(() => null);
  const headingLineOf = new Map<number, number>();
  let context: number | null = null;
  // A heading mark names the next line that prints anything: a table row's mark is written before
  // the row's line break, so it can sit at the end of the line above.
  let pending: number[] = [];
  let next = 0;
  for (const raw of markedLines) {
    let lineCtx: number | null | undefined;
    let headingsHere: number[] = [];
    let index = 0;
    while (index < raw.length) {
      const char = raw[index];
      if (char === CONTEXT_MARK || char === HEADING_MARK) {
        const end = raw.indexOf(MARK_END, index);
        if (end < 0) return [];
        const value = raw.slice(index + 1, end);
        if (char === CONTEXT_MARK) context = value === NO_CONTEXT ? null : Number(value);
        else pending.push(Number(value));
        index = end + 1;
        continue;
      }
      if (lineCtx === undefined && char !== " ") {
        lineCtx = context;
        headingsHere = pending;
        pending = [];
      }
      index += 1;
    }
    const visible = collapse(raw.replace(ANY_MARK, ""));
    if (!visible) continue;
    while (next < textLines.length && textLines[next] === "") next += 1;
    if (next >= textLines.length || textLines[next] !== visible) return [];
    lineContext[next] = lineCtx ?? null;
    for (const id of headingsHere) if (!headingLineOf.has(id)) headingLineOf.set(id, next);
    next += 1;
  }
  if (textLines.slice(next).some((line) => line !== "")) return [];

  const headingLines = new Set(headingLineOf.values());
  // A heading counts only where its line prints exactly its text (a <br> inside it splits it).
  const valid = new Map<number, number>();
  for (const [id, line] of headingLineOf) {
    const entry = registered[id];
    const printed = entry.cell < 0 ? textLines[line] : textLines[line].split(" | ")[entry.cell];
    if (printed != null && printed.trim() === entry.text) valid.set(id, line);
  }
  const spans: HeadingSpan[] = [];
  let open: HeadingSpan | null = null;
  textLines.forEach((line, index) => {
    if (line === "") return;
    const id = headingLines.has(index) ? null : lineContext[index];
    const headingLine = id == null ? undefined : valid.get(id);
    if (id == null || headingLine === undefined || headingLine >= index) {
      open = null;
      return;
    }
    if (open && open.headingLine === headingLine && open.cell === registered[id].cell) {
      open.to = index;
      return;
    }
    open = { headingLine, cell: registered[id].cell, kind: registered[id].kind, from: index, to: index };
    spans.push(open);
  });
  return spans;
}

export function hasScopeMarks(value: string): boolean {
  return MARKS.test(value);
}

export function withoutScopeMarks(value: string): string {
  return value.replace(ANY_MARK, "");
}
