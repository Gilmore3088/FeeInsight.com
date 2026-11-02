/**
 * Row pairing for `read.html_dom` (#1092, class R2 of the lab's answer-key misses): a fee's label
 * and its price that one DOM row holds come out on one line, "Label | $X", as table rows already
 * do. Many fee pages lay a row out with `<div>`s instead of `<table>`: ARIA rows
 * (`role="row"` / `role="cell"`), grid frameworks (Bootstrap `.row > .col-*`, Kadence, Gutenberg
 * and page-builder columns) and flex rows. Stripping them put the label and the price on separate
 * lines, and Knox paired neither (Northern Communities FCU, Peach State FCU, River City Bank).
 *
 * Only positive DOM evidence joins: an ARIA row, a grid row whose children are all its columns, or
 * a flex/grid row. Two lines that merely sit next to each other in the text never join. A grid or
 * flex row joins only when it reads as one fee: at least one cell starts with a price and at least
 * one other cell is a label with no price of its own, so a row of pricing cards stays as it was.
 *
 * Off by default (`HTML_ROW_PAIRING_LIVE`): a reader change alters the text of every page read
 * after it. Pure; no network or database.
 */

export const HTML_ROW_PAIRING_LIVE = false;

/** The structural part of an htmlparser2 element this module reads. */
export interface PairingElement {
  type: string;
  name: string;
  attribs: Record<string, string>;
  children: PairingNode[];
}
export type PairingNode = PairingElement | { type: string; data?: string };

export type RowEvidence = "aria_row" | "grid_row" | "flex_row";

export interface PairedRow {
  evidence: RowEvidence;
  /** The row's non-empty cells in reading order, labels before a leading price. */
  cells: string[];
  /** Text a cell carried after its first block (a description paragraph), each on its own line after the row. */
  notes: string[];
}

/** Writes the visible text of some nodes on one line (html-dom's own walker, so entities and skips match). */
export type InlineText = (nodes: PairingNode[]) => string;

const CELL_ROLES = new Set(["cell", "gridcell", "columnheader", "rowheader"]);
const ROW_CLASS =
  /^(?:row|columns|wp-block-columns|kt-row-column-wrap|elementor-container|elementor-row|et_pb_row|vc_row|vc_row-fluid|w-row|fl-col-group|grid-x)$/;
const COLUMN_CLASS =
  /^(?:col|col-[\w-]+|column|columns|cell|wp-block-column|wp-block-kadence-column|elementor-column|et_pb_column(?:_[\w]+)?|vc_col-[\w-]+|w-col(?:-[\w]+)?|fl-col|(?:small|medium|large)-\d+)$/;
const FLEX_CLASS = /^(?:d-flex|d-md-flex|d-lg-flex|flex|inline-flex|d-grid|grid)$/;
const STACKED_CLASS = /^(?:flex-column|flex-col|flex-md-column|flex-wrap|grid-cols-1)$/;
/** Shown only below a breakpoint (a mobile copy of the column header); the desktop page has none. */
const MOBILE_ONLY_CLASS = /^(?:d-(?:sm|md|lg|xl|xxl)-none|visible-xs|hidden-sm-up|hide-for-medium|hide-for-large)$/;
/** A cell holding any of these is a layout region, not one fee's cell. */
const STRUCTURE_TAGS = new Set(["table", "dl", "ul", "ol", "form", "nav", "select", "textarea", "iframe"]);
const SKIPPED_TAGS = new Set(["script", "style", "noscript", "template", "svg", "head"]);
const HEADING = /^h[1-6]$/;

const MIN_CELLS = 2;
/** A grid or flex row with more cells than this is a strip of cards or links, not one fee. */
const MAX_FEE_ROW_CELLS = 4;
/** ARIA rows are tables in all but tag, read as tables read (`isLayoutTable` allows any width). */
const MAX_ARIA_ROW_CELLS = 12;
/** Longer label text is a description paragraph: its first block names the fee. */
const MAX_LABEL_CHARS = 120;
/** Longer price text keeps its first block on the row and the rest as a note. */
const MAX_PRICE_CHARS = 200;

/** A cell that states the fee: a dollar amount first, or a stated free price. */
const PRICE_START = /^(?:\$\s?\d|no charge\b|no fee\b|free(?:\s*[.*!]?\s*$|\s+(?:with|for|to|per|each|of charge)\b))/i;
const MONEY = /\$\s?\d/;

function isElement(node: PairingNode): node is PairingElement {
  return "name" in node && "children" in node && node.type === "tag";
}

function classes(element: PairingElement): string[] {
  return (element.attribs?.class ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

const hasClass = (element: PairingElement, pattern: RegExp) => classes(element).some((name) => pattern.test(name));
const role = (element: PairingElement) => (element.attribs?.role ?? "").trim().toLowerCase();
const isMobileOnly = (element: PairingElement) => hasClass(element, MOBILE_ONLY_CLASS) || element.attribs?.["aria-hidden"] === "true";
const hasOwnText = (element: PairingElement) =>
  element.children.some((node) => node.type === "text" && /\S/.test((node as { data?: string }).data ?? ""));

/** Element children a reader would see, without scripts and mobile-only copies. */
function visibleChildren(element: PairingElement): PairingElement[] {
  return element.children.filter(isElement).filter((child) => !SKIPPED_TAGS.has(child.name) && !isMobileOnly(child) && child.name !== "br");
}

function isFlexRow(element: PairingElement): boolean {
  const style = (element.attribs?.style ?? "").toLowerCase().replace(/\s+/g, "");
  if (hasClass(element, STACKED_CLASS) || /flex-direction:column|flex-wrap:wrap/.test(style)) return false;
  return hasClass(element, FLEX_CLASS) || /display:(?:inline-)?(?:flex|grid)(?:;|$)/.test(style);
}

/** The row's structure, read from its own markup only: which kind of row it is and its cells. */
export function rowStructure(element: PairingElement): { evidence: RowEvidence; cells: PairingElement[] } | null {
  if (!isElement(element) || hasOwnText(element)) return null;
  const children = visibleChildren(element);
  if (children.length < MIN_CELLS) return null;
  if (role(element) === "row") {
    return children.every((child) => CELL_ROLES.has(role(child))) ? { evidence: "aria_row", cells: children } : null;
  }
  if (hasClass(element, ROW_CLASS) && children.every((child) => hasClass(child, COLUMN_CLASS))) {
    return { evidence: "grid_row", cells: children };
  }
  if (isFlexRow(element)) return { evidence: "flex_row", cells: children };
  return null;
}

/** A cell that holds a table, a list or another row is a region of the page, not one fee's cell. */
function holdsStructure(element: PairingElement): boolean {
  return visibleChildren(element).some(
    (child) => STRUCTURE_TAGS.has(child.name) || rowStructure(child) != null || holdsStructure(child),
  );
}

/** The cell's content below wrappers that hold one element and no text of their own. */
function unwrap(cell: PairingElement): PairingElement {
  let current = cell;
  for (;;) {
    const children = visibleChildren(current);
    if (children.length !== 1 || hasOwnText(current)) return current;
    current = children[0];
  }
}

interface CellText {
  /** The whole cell on one line. */
  whole: string;
  /** Its first block alone, and the rest, when it has two or more blocks and no loose text. */
  first: string | null;
  rest: string[];
  leadsWithHeading: boolean;
}

function cellText(cell: PairingElement, inline: InlineText): CellText {
  const content = unwrap(cell);
  const whole = inline(content.children.filter((node) => !isElement(node) || !isMobileOnly(node)));
  const blocks = visibleChildren(content);
  if (hasOwnText(content) || blocks.length < 2) return { whole, first: null, rest: [], leadsWithHeading: false };
  const texts = blocks.map((block) => inline([block])).filter(Boolean);
  return { whole, first: texts[0] ?? null, rest: texts.slice(1), leadsWithHeading: HEADING.test(blocks[0].name) };
}

/** Money outside parentheses: "Premium (daily balance below $1,000)" is a label, "Basic $5" is not. */
const moneyOutsideParentheses = (text: string) => MONEY.test(text.replace(/\([^)]*\)/g, ""));

interface Cell { text: string; notes: string[]; price: boolean }

function feeCell(text: CellText): Cell | null {
  if (PRICE_START.test(text.whole)) {
    // A second block that starts with its own price is a second price ("No charge for Bank documents" /
    // "$10 per signature for others"): only the first shares the label's line, as before the change.
    const secondPrice = text.rest.some((block) => PRICE_START.test(block));
    if (text.whole.length <= MAX_PRICE_CHARS && !secondPrice) return { text: text.whole, notes: [], price: true };
    if (text.first && PRICE_START.test(text.first) && text.first.length <= MAX_PRICE_CHARS) return { text: text.first, notes: text.rest, price: true };
    return null;
  }
  const split = text.first != null && (text.leadsWithHeading || text.whole.length > MAX_LABEL_CHARS);
  const label = split ? (text.first as string) : text.whole;
  if (label.length > MAX_LABEL_CHARS || PRICE_START.test(label) || moneyOutsideParentheses(label)) return null;
  return { text: label, notes: split ? text.rest : [], price: false };
}

/** Labels first: a price-first row ("$20.00 | Wire transfer") reads as the label's fee. */
function labelFirst(cells: Cell[]): Cell[] {
  const lead = cells.findIndex((cell) => !cell.price);
  return lead <= 0 ? cells : [...cells.slice(lead), ...cells.slice(0, lead)];
}

/**
 * The element's cells on one line when its own markup makes it one row of a fee: null leaves the
 * element to the ordinary block walk. A row holding a table, a list or another row is left to the
 * walk too, so only the innermost row joins.
 */
export function pairDomRow(element: PairingElement, inline: InlineText): PairedRow | null {
  const structure = rowStructure(element);
  if (!structure || structure.cells.some(holdsStructure)) return null;
  const texts = structure.cells.map((cell) => cellText(cell, inline)).filter((text) => text.whole !== "");
  if (texts.length < MIN_CELLS) return null;
  if (structure.evidence === "aria_row") {
    if (texts.length > MAX_ARIA_ROW_CELLS) return null;
    return { evidence: "aria_row", cells: texts.map((text) => text.whole), notes: [] };
  }
  if (texts.length > MAX_FEE_ROW_CELLS) return null;
  const cells = texts.map(feeCell);
  if (cells.some((cell) => cell == null)) return null;
  const read = cells as Cell[];
  if (!read.some((cell) => cell.price) || !read.some((cell) => !cell.price)) return null;
  const ordered = labelFirst(read);
  return { evidence: structure.evidence, cells: ordered.map((cell) => cell.text), notes: ordered.flatMap((cell) => cell.notes) };
}
