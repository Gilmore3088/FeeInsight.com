import type { InlineText, PairingElement, PairingNode } from "./html-row-pairing";

/**
 * Cell-list pairing for `read.html_dom` (#1092, class R3 of the lab's answer-key misses): a table
 * row whose label cell lists several items and whose price cell lists one price per item. St. Cloud
 * FCU (answer key state:9308) writes ten such rows: the label cell holds a bold heading and a `<ul>`
 * with one `<li>` per item, and the price cell holds a `<br/>` (standing in for the heading) and a
 * `<ul>` with one `<li>` per price. `read.html_dom` writes a table row on one line, so the row came
 * out as "Safe Deposit Boxes 3 x 5 3 x 10 ... | $18.00 a year $30.00 a year ..." and Knox could
 * pair none of the prices with its item.
 *
 * Only the markup's own item-for-item structure pairs, and every condition below can only refuse:
 * - the row is a body row of a data table with exactly two non-empty `<td>` cells, no colspan or
 *   rowspan (its own or one held from a row above), no nested table, no hidden element, and it does
 *   not sit inside a `<nav>` or `<footer>`;
 * - list form: each cell holds exactly one list (`<ul>`/`<ol>`) as a direct child, no other list,
 *   and nothing after it but `<br>`s; the label cell's inline text before its list is the heading,
 *   the price cell has no text outside its list; each list holds only `<li>` items (and stray
 *   `<br>`s), none empty and none holding a nested list or table;
 * - `<br>` form: neither cell holds a block or a list, each is split at its own `<br>`s, and every
 *   piece is non-empty;
 * - both cells have the same form and the same number of items, 2 to `MAX_ITEMS`;
 * - every price item starts with its price and states exactly one price or free word, and no
 *   label item or heading states a dollar amount.
 * A row that fails any of these is written exactly as `read.html_dom` writes it with the switch off.
 *
 * Off by default (`HTML_CELL_LIST_PAIRING_LIVE`): a reader change alters the text of every page read
 * after it. Turning it on bumps `HTML_READ_VERSION` (reader-versions.ts) by one in the same change,
 * so reader replay re-reads the HTML pages already read, and no PDF (reader-replay.test.ts fails
 * otherwise). Pure; no network or database.
 */

export const HTML_CELL_LIST_PAIRING_LIVE = false;

/** A row listing more items than this is a list of something else (branches, links), not one fee's prices. */
export const MAX_ITEMS = 12;
/** A price item longer than this is a description that happens to start with a price. */
export const MAX_PRICE_ITEM_CHARS = 60;

export interface CellListPair {
  label: string;
  price: string;
}

const LIST_TAGS = new Set(["ul", "ol"]);
const STRUCTURE_TAGS = new Set(["ul", "ol", "li", "table", "dl"]);
const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "center", "details", "dialog", "div", "dl", "fieldset", "figure",
  "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre",
  "section", "table", "ul",
]);
const SKIPPED_TAGS = new Set(["script", "style", "noscript", "template", "svg"]);
const HIDDEN_CLASS = /^(?:hidden|d-none|sr-only|visually-hidden|screen-reader-text|hide)$/;

/** A price item starts with its price: a dollar amount or a stated free price. */
const PRICE_START = /^(?:\$\s?\d|no charge\b|no fee\b|free\b)/i;
const MONEY = /\$\s?\d[\d,]*(?:\.\d+)?/g;
const FREE_WORD = /\b(?:free|no charge|no fee)\b/gi;
const PERCENT = /\d(?:[\d.,]*)\s?%/g;
/** A bullet a page types into a `<br>` list ("• Notary Service"). */
const LEADING_BULLET = /^[•·▪◦‣∙●-]\s*/;

function isElement(node: PairingNode): node is PairingElement {
  return "name" in node && "children" in node && node.type === "tag";
}

const isBlankText = (node: PairingNode) => node.type === "text" && !/\S/.test((node as { data?: string }).data ?? "");
const isComment = (node: PairingNode) => node.type === "comment";
const isBr = (node: PairingNode) => isElement(node) && node.name === "br";
const isList = (node: PairingNode): node is PairingElement => isElement(node) && LIST_TAGS.has(node.name);

function isHidden(element: PairingElement): boolean {
  const attribs = element.attribs ?? {};
  const style = (attribs.style ?? "").toLowerCase().replace(/\s+/g, "");
  const classes = (attribs.class ?? "").toLowerCase().split(/\s+/);
  return (
    "hidden" in attribs ||
    attribs["aria-hidden"] === "true" ||
    /display:none|visibility:hidden/.test(style) ||
    classes.some((name) => HIDDEN_CLASS.test(name))
  );
}

/** Whether any element under `element` (not itself) matches. */
function anyDescendant(element: PairingElement, test: (child: PairingElement) => boolean): boolean {
  return element.children.some((child) => isElement(child) && (test(child) || anyDescendant(child, test)));
}

function spanned(cell: PairingElement): boolean {
  return ["colspan", "rowspan"].some((name) => {
    const value = cell.attribs?.[name];
    return value != null && value.trim() !== "" && value.trim() !== "1";
  });
}

interface CellItems {
  form: "list" | "br";
  heading: string;
  items: string[];
}

/** A list's items: only `<li>`s (stray `<br>`s and comments allowed), none empty or holding structure. */
function listItems(list: PairingElement, inline: InlineText): string[] | null {
  const items: string[] = [];
  for (const node of list.children) {
    if (isBlankText(node) || isComment(node) || isBr(node)) continue;
    if (!isElement(node) || node.name !== "li") return null;
    if (anyDescendant(node, (child) => STRUCTURE_TAGS.has(child.name))) return null;
    const text = inline(node.children);
    if (!text) return null;
    items.push(text);
  }
  return items;
}

/** List form: inline heading text, one list as a direct child, then nothing but `<br>`s. */
function listForm(cell: PairingElement, inline: InlineText): CellItems | null {
  const lists = cell.children.filter(isList);
  if (lists.length !== 1) return null;
  const at = cell.children.indexOf(lists[0]);
  const before = cell.children.slice(0, at);
  const after = cell.children.slice(at + 1);
  if (after.some((node) => !isBlankText(node) && !isComment(node) && !isBr(node))) return null;
  // The heading is inline text: a block or a second list before the list is a region, not a heading.
  if (before.some((node) => isElement(node) && (BLOCK_TAGS.has(node.name) || anyDescendant(node, (child) => BLOCK_TAGS.has(child.name))))) {
    return null;
  }
  const items = listItems(lists[0], inline);
  return items ? { form: "list", heading: inline(before), items } : null;
}

/** `<br>` form: no block or list anywhere in the cell, pieces split at the cell's own `<br>`s. */
function brForm(cell: PairingElement, inline: InlineText): CellItems | null {
  if (anyDescendant(cell, (child) => BLOCK_TAGS.has(child.name))) return null;
  // A <br> inside an inline element (<b>a<br>b</b>) splits nothing the pairing can see.
  if (cell.children.some((node) => isElement(node) && anyDescendant(node, (child) => child.name === "br"))) return null;
  const groups: PairingNode[][] = [[]];
  for (const node of cell.children) {
    if (isBr(node)) groups.push([]);
    else groups[groups.length - 1].push(node);
  }
  const pieces = groups.map((group) => inline(group));
  // A trailing <br> shifts nothing above it; any other empty piece would misalign the two cells.
  while (pieces.length > 0 && pieces[pieces.length - 1] === "") pieces.pop();
  if (pieces.some((piece) => piece === "")) return null;
  return { form: "br", heading: "", items: pieces };
}

function cellItems(cell: PairingElement, inline: InlineText): CellItems | null {
  return listForm(cell, inline) ?? brForm(cell, inline);
}

const stripBullet = (text: string) => text.replace(LEADING_BULLET, "").trim();
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

/** Exactly one price or free word, and the item starts with it. */
function isOnePrice(item: string): boolean {
  if (item.length > MAX_PRICE_ITEM_CHARS || !PRICE_START.test(item)) return false;
  return count(item, MONEY) + count(item, FREE_WORD) + count(item, PERCENT) === 1;
}

/**
 * The row's label and price pairs when its two cells list the same number of items, item for item;
 * null leaves the row to `read.html_dom`'s ordinary one-line table row. `cells` are the row's
 * `<td>`/`<th>` elements; the caller has already checked the row is a body row of a data table on
 * the table's first two grid columns and not inside page chrome.
 */
export function pairCellLists(cells: readonly PairingElement[], inline: InlineText): CellListPair[] | null {
  if (cells.length !== 2 || cells.some((cell) => cell.name !== "td" || spanned(cell))) return null;
  if (cells.some((cell) => isHidden(cell) || anyDescendant(cell, (child) => child.name === "table" || isHidden(child)))) return null;
  if (cells.some((cell) => !inline(cell.children.filter((node) => !isElement(node) || !SKIPPED_TAGS.has(node.name))))) return null;
  const [label, price] = cells.map((cell) => cellItems(cell, inline));
  if (!label || !price || label.form !== price.form || price.heading !== "") return null;
  const n = label.items.length;
  if (n < 2 || n > MAX_ITEMS || price.items.length !== n) return null;
  const labels = label.items.map(stripBullet);
  const prices = price.items.map(stripBullet);
  if (labels.some((item) => !item) || count(label.heading, MONEY) > 0 || labels.some((item) => count(item, MONEY) > 0)) return null;
  if (!prices.every(isOnePrice)) return null;
  return labels.map((item, index) => ({ label: [label.heading, item].filter(Boolean).join(" "), price: prices[index] }));
}
