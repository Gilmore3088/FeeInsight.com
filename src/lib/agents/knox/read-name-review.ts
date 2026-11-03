import { classifyFeeText, paperStatementRead } from "@/lib/agents/knox/rules";
import type { ExtractedFeeCandidate } from "@/lib/agents/knox/rules";
import { passesDarwinChecks } from "@/lib/agents/knox/layout";
import { splitLiveCategory } from "@/lib/fee-fold";

/**
 * v184 (Knox slice dry run and cross-category scan, Nov 3): the last look at each read's name and category before
 * Darwin, for words another part of the page lent it. Each rule names the class it fixes; every one is pure, reads
 * only the read and the text Knox read, and leaves any other read as it is.
 *
 * - `glued_heading`: a name composed from a heading or another column's cell and the row's own label ("LOAN FEES:
 *   3x10 Box", "Wire Transfer: Deposit Item Chargeback", "Customer Services: Annual Fee 3x5", "Online Banking Fees:
 *   Share account monthly service"). When the label alone files under the read's own category and the prefix is a
 *   section heading or another fee's name (`gluedHeadingName`), the prefix is no part of the name. A label that
 *   does not file alone ("Cashier's Check: Customer", "Stop Payment Fee – Check or ACH (per item): Corporate Check"),
 *   or a prefix naming an audience, a delivery speed or an account, or a clause of other words, keeps it.
 * - `glyph_before_price`: a font glyph printed against the price ("NSF FEE | g$35.00") is no part of the name
 *   ("NSF FEE: g").
 * - `box_size_footnote`: a footnote digit glued to a box size ("Safe Deposit Box 3x103 | $50", Texas Capital Bank)
 *   comes off when the size it leaves is a box's (no side over 30 inches).
 * - `advice_name`: advice is no fee's name ("Avoid these fees by using an ATM that utilizes the MoneyPass©
 *   Network", River City Bank): the read takes the title line right above its line when that title files under the
 *   read's category. Otherwise it keeps its name: the advice is often a real fee's only words.
 * - `opening_deposit`: a price the line says is a deposit to open or join ("Only a $25 membership deposit to get
 *   started", America's FCU) is no fee.
 * - `caps_cell_label`: on an all-capitals two-column page, a price whose own cell opens with a label of its own
 *   ("COUNTER CHECKS | PER DEBIT ITEM • $32", First State Bank and Trust) is that label's, not the cell before it.
 * - `box_late_fee`: a late charge filed as a loan's late payment whose name names the box ("Box Late Fee",
 *   Cornerstone Community FCU) is the safe deposit box's, by the taxonomy fold's own split (`splitLiveCategory`),
 *   which Hamilton applies at publish: Knox now reads it there.
 */
export interface ReviewedRead {
  canonicalHint: string;
  feeName: string;
  amount: number;
  excerpt: string;
  /** The account the read belongs to, when Knox read one. */
  lineup?: { productName?: string | null } | null;
}

export type NameReviewRule = "glued_heading" | "glyph_before_price" | "box_size_footnote" | "advice_name" | "opening_deposit" | "caps_cell_label" | "box_late_fee" | "paper_offer";

const GLYPH_TAIL = /:\s*([a-z]{1,2})$/;
const BOX_SIZE_FOOTNOTE = /\b(\d{1,2})(\s?[xX×]\s?)(\d{1,2})(\d)\b/g;
const MAX_BOX_SIDE = 30;
const ADVICE = /^\W*(?:to\s+)?avoid\b/i;
const OPENING_DEPOSIT = (price: string) =>
  new RegExp(String.raw`${price}\s+(?:membership|opening|initial|minimum\s+opening)\s+deposit\b|${price}\s+(?:deposit\s+)?(?:to|will)\s+(?:open|join|get\s+started)\b|(?:deposit|open\s+(?:an?\s+)?(?:account|membership))\s+(?:of|with)\s+(?:only\s+)?${price}\b`, "i");
const CAPS_LABEL_CELL = /^\s*[A-Z][A-Z0-9 &/'’-]{3,}?\s*[•:–-]\s*\$\s?\d/;

function priceText(amount: number): string {
  const whole = Math.trunc(amount);
  const cents = Math.round((amount - whole) * 100);
  return String.raw`\$\s?${whole}${cents === 0 ? String.raw`(?:\.00)?` : String.raw`\.${String(cents).padStart(2, "0")}`}(?![\d,])`;
}

/** A prefix that qualifies the fee: whom it is for, or how fast ("Non-Customer Services", "Expedited delivery"). */
const QUALIFIER_PREFIX = /\b(?:non-?members?|non-?customers?|business|commercial|seniors?|students?|youth|minors?|expedit\w*|rush|overnight|express|same[- ]day|next[- ]day)\b/i;
/** A section heading: printed in capitals, or ending in a heading word ("LOAN FEES", "Customer Services"). */
const SECTION_HEADING = /\b(?:fees|charges|services)\s*$/i;
/**
 * A prefix in capitals that ends in an account or card says whose price it is ("GOLD CHECKING", "CONSUMER ACCOUNTS",
 * "VISA CHECK CARD CHARGES": review of 29ef3de53d2, live #141969). A card inside another row's label
 * ("LOAN/LEASE/CREDIT CARD PAYMENT BY ONLINE/MOBILE USING", slice text 27330) names no product. A heading not in
 * capitals that ends in "Fees" stays a heading ("IRA Share Savings Account Fees", rb10 text 4803, live #41503).
 */
const PRODUCT_PREFIX = /\b(?:checking|savings|money\s+market|share|accounts?|ira|certificates?|club|visa|mastercard|cards?)(?:\s+accounts?)?(?:\s+(?:fees|charges|services))?\s*$/i;
/** An account named in a prefix not in capitals ("Money Market Accounts", "Four Star Banking with Interest"). */
const ACCOUNT_PREFIX = /\b(?:checking|savings|money\s+market|share|accounts?|ira|certificates?|banking|club)\b/i;

/**
 * The label of a composed name ("P: N") when the label N files under `key` alone and the prefix P is no part of the
 * fee: a section heading or another fee's name. A prefix that qualifies the fee (an audience, a delivery speed) or
 * names an account (a heading in capitals that ends in an account or card) is kept, and so is any prefix that files
 * under `key` itself.
 */
export function gluedHeadingName(name: string, key: string): string | null {
  const at = name.indexOf(": ");
  if (at <= 0) return null;
  const prefix = name.slice(0, at).trim();
  const label = name.slice(at + 2).trim();
  if (!label || label.includes(": ")) return null;
  // A label that opens with a list number ("(1) Domestic ATM fees incurred ...") after a condition ("For Kasasa Cash,
  // if qualifications are met ...") is a sentence's clause, not a row's own label: kept whole.
  if (!/^[A-Za-z0-9"“'‘]/.test(label) || /\b(?:if|when|unless|whenever)\b/i.test(prefix)) return null;
  if (classifyFeeText(label) !== key) return null;
  const prefixKey = classifyFeeText(prefix);
  if (prefixKey === key || QUALIFIER_PREFIX.test(prefix)) return null;
  // A heading in capitals is dropped unless it ends in an account or card ("VISA CHECK CARD CHARGES").
  if (prefix === prefix.toUpperCase() && /[A-Z]{3}/.test(prefix)) return PRODUCT_PREFIX.test(prefix) ? null : label;
  if (SECTION_HEADING.test(prefix)) return label;
  if (ACCOUNT_PREFIX.test(prefix)) return null;
  // Another fee's name ("Wire Transfer: Deposit Item Chargeback"). A clause of other words ("(Per month some
  // exclusions apply): Cashier's Check") carries words of its own and stays as read.
  if (prefixKey != null || (/\bwires?\b/i.test(prefix) && !key.startsWith("wire_"))) return label;
  return null;
}

/** Pure: the read reviewed, or null when it is no fee. `text` is the text Knox read. */
export function reviewReadName<T extends ReviewedRead>(read: T, text: string): { read: T | null; rule: NameReviewRule } | null {
  const excerpt = read.excerpt ?? "";
  // A check image read whose name offers paper statements at the price is the paper statement charge
  // (`paperStatementRead`, judged on the read's own line).
  if (read.canonicalHint === "check_image") {
    const paper = paperStatementRead(read as unknown as ExtractedFeeCandidate, ownLine(text, excerpt));
    if (paper.canonicalHint === "paper_statement") return { read: { ...read, canonicalHint: paper.canonicalHint, feeName: paper.feeName }, rule: "paper_offer" };
  }
  let feeName = read.feeName;
  let changed: NameReviewRule | null = null;
  const glyph = feeName.match(GLYPH_TAIL);
  if (glyph && new RegExp(String.raw`(?:^|\|)\s*${glyph[1]}\$\s?\d`).test(excerpt)) {
    feeName = feeName.slice(0, glyph.index).trim();
    changed = "glyph_before_price";
  }
  const glued = gluedHeadingName(feeName, read.canonicalHint);
  if (glued) {
    feeName = glued;
    changed = "glued_heading";
  }
  const sized = feeName.replace(BOX_SIZE_FOOTNOTE, (whole, a: string, x: string, b: string, mark: string) =>
    Number(`${b}${mark}`) > MAX_BOX_SIDE && Number(a) <= MAX_BOX_SIDE && Number(b) <= MAX_BOX_SIDE && excerpt.includes(whole) ? `${a}${x}${b}` : whole);
  if (read.canonicalHint === "safe_deposit_box" && sized !== feeName) {
    feeName = sized;
    changed = "box_size_footnote";
  }
  if (read.amount > 0 && depositOnly(ownWindow(text, excerpt), read.amount)) return { read: null, rule: "opening_deposit" };
  if (ADVICE.test(feeName)) {
    // Only renamed: an advice name is often a real fee's only words ("To avoid a monthly paper statement fee of
    // $3.00 ...", live 135372), so a read with no title above keeps its name.
    const title = titleAbove(text, excerpt);
    if (title && classifyFeeText(title) === read.canonicalHint) {
      feeName = title;
      changed = "advice_name";
    }
  }
  const cells = excerpt.split("|").map((cell) => cell.trim());
  if (cells.length >= 2 && /^[A-Z0-9 &/'’-]+$/.test(feeName) && cells[0] === feeName && CAPS_LABEL_CELL.test(cells[1]) && read.amount > 0) {
    const own = cells[1].split(/[•:–-]/)[0].trim();
    if (own && own !== feeName && new RegExp(priceText(read.amount)).test(cells[1])) return { read: null, rule: "caps_cell_label" };
  }
  if (read.canonicalHint === "late_payment" && splitLiveCategory("late_payment", feeName)?.to === "safe_deposit_box" &&
    passesDarwinChecks("safe_deposit_box", feeName, read.amount)) {
    return { read: { ...read, feeName, canonicalHint: "safe_deposit_box" }, rule: "box_late_fee" };
  }
  if (!changed || feeName === read.feeName || !passesDarwinChecks(read.canonicalHint, feeName, read.amount)) return null;
  return { read: { ...read, feeName }, rule: changed };
}

/** The text's line that holds the read's stored line (the stored line itself when none does). */
function ownLine(text: string, excerpt: string): string {
  const probe = excerpt.replace(/\s+/g, " ").trim();
  if (probe.length < 6) return excerpt;
  return text.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).find((line) => line.includes(probe)) ?? excerpt;
}

/**
 * The read's own words on its line: from where its stored line starts to a little past where it ends (a cut stored
 * line, "Only a $25", reaches "membership deposit"), never another account's words further along a long line ("...
 * charge of $5.00 Super Advantage Checking ... $5 Deposit to open", Lyons FCU).
 */
function ownWindow(text: string, excerpt: string): string {
  const probe = excerpt.replace(/\s+/g, " ").trim();
  const line = ownLine(text, excerpt);
  const at = line.indexOf(probe);
  return at < 0 ? probe : line.slice(at, at + probe.length + OWN_WINDOW_REACH);
}
const OWN_WINDOW_REACH = 40;

/**
 * Every time the read's own words print its price, they call it a deposit to open or join. A window that also prints
 * the price as a charge ("Regular Savings $5 minimum opening deposit; monthly service charge $5") keeps the read.
 */
function depositOnly(window: string, amount: number): boolean {
  const price = priceText(amount);
  const all = window.match(new RegExp(price, "gi")) ?? [];
  const deposits = window.match(new RegExp(OPENING_DEPOSIT(price).source, "gi")) ?? [];
  return deposits.length > 0 && deposits.length >= all.length;
}

/** The short title line right above the read's own line (no price, at most six words), or null. */
function titleAbove(text: string, excerpt: string): string | null {
  const lines = text.split("\n").map((line) => line.replace(/\s+/g, " ").trim());
  const probe = excerpt.replace(/\s+/g, " ").trim().slice(0, 60);
  if (probe.length < 8) return null;
  const at = lines.findIndex((line) => line.includes(probe));
  if (at < 0) return null;
  for (let index = at - 1; index >= Math.max(0, at - 3); index -= 1) {
    const line = lines[index];
    if (!line) continue;
    if (/\$|\d\s?%/.test(line) || line.split(" ").length > 6) return null;
    return line;
  }
  return null;
}

/** Each read reviewed (`reviewReadName`), dropped ones left out and renamed twins of an earlier read merged. */
export function withReviewedNames<T extends ReviewedRead>(reads: readonly T[], text: string): T[] {
  // Each kept read's twin key, and whether the review renamed it: a twin is dropped only when one of the pair was
  // renamed (the rename made them twins); two reads Knox made alike before stay as they were.
  const seen = new Map<string, boolean>();
  const out: T[] = [];
  for (const read of reads) {
    const reviewed = reviewReadName(read, text);
    const kept = reviewed ? reviewed.read : read;
    if (!kept) continue;
    const key = twinKey(kept);
    if (seen.has(key) && (reviewed || seen.get(key))) continue;
    seen.set(key, (seen.get(key) ?? false) || reviewed != null);
    out.push(kept);
  }
  return out;
}

/** A box is named by its size ("3x10 Box" is "Safe Deposit Box 3x10"); any other read by its whole name. */
function twinKey(read: ReviewedRead): string {
  const size = read.canonicalHint === "safe_deposit_box" ? read.feeName.match(/\b(\d{1,2})\s?[xX×]\s?(\d{1,2})\b/) : null;
  const name = size ? `size ${Number(size[1])}x${Number(size[2])}` : read.feeName.toLowerCase();
  // Two accounts' fees at one price are two fees (review of 29ef3de53d2): the product is part of the key.
  return `${read.canonicalHint}|${name}|${read.amount}|${(read.lineup?.productName ?? "").toLowerCase()}`;
}
