import type { sql } from "@/lib/data-store/connection";
import { productKey, productKeySql, sameProduct } from "@/lib/fee-product";
import { inSavepoint } from "@/lib/agents/savepoint";
import { frequencyClass } from "@/lib/agents/hamilton/exact-duplicate";
import { feePageKey } from "./page-key";
import { pricePrints } from "./same-line-read";
import { PUBLISHED_IDENTITY_COLUMNS } from "./published-identity";
import { readPublicationEvidence, type PublicationEvidence } from "./publication-evidence";
import type { PriorPublishedFeeRow } from "./publish";

type SqlTag = typeof sql;

/**
 * One printed line, two products (re-read backlog dry runs 3 and 4, Nov 3). When Knox re-reads a
 * page and its grounded lineup names a different product for a line (or none) than the live row of
 * that line, every identity check after Knox kept the two apart, because each one compares the
 * product exactly: Hamilton's live-line read (`selectLivePublishedFees`, `decidePriorFee`), the
 * exact and page-copy collapses, the same-line read, and Darwin's stale-copy twin. The re-read went
 * live as a new fee and the old row stayed, so one bank line showed twice:
 * - Polish & Slavic FCU doc 41770: "Plus Business Checking (monthly, if average daily balance below
 *   $10,000) | $10.00" read under "Plus Business Checking", live #94866 under no product; "Monthly
 *   Fee | $0.00" and "Minimum Balance Fee | $0.00" under "Savings/Checking Accounts", live #49397
 *   and #49398 under none.
 * - Cvph Employees FCU doc 41763: "Monthly Fee for Draft Checking Accounts…..$1.00" read under no
 *   product, live #141419 under "Demand Deposit Account" (a rates heading further down the page).
 * - MutualOne Bank doc 41984: "Monthly Service Charge | None" read under "Free Business Checking
 *   Plus", live #73214 under none.
 *
 * The rule. A row and a live fee are one line read twice, whatever product each carries, when all
 * of these hold:
 * - same institution, category, variant and dollar amount, and different products;
 * - the same page: the same document, or a copy of the same page (`feePageKey`) in the same stream;
 * - the same stored source line (Knox's `excerpt=`, folded to its words and figures, so dot leaders
 *   and pipes do not matter: "Accounts…..$1.00" and "Accounts $1.00");
 * - that line is printed exactly once in the newer document's current stored text, and prints the
 *   amount once (a $0 line may print no figure, "| None"). A line a schedule prints once per account
 *   ("Monthly Maintenance Service Charge | $10" under two accounts, Cambridge Savings doc 42199) is a
 *   real per-product price and stays two rows;
 * - the page does not name both products for the line (on it or on headings above it) unless one
 *   name is a part of the other: "Checking and Savings Accounts: Paper statement fee $2.00" prices
 *   two products (`namesBothProducts`);
 * - their frequencies do not differ.
 *
 * Which product wins (`productSplitWinner`): a read from an older copy than the live fee never wins.
 * Otherwise the bank's page decides: the product named nearest the line wins, on the line itself or
 * on the nearest heading above it that names it (the account heading the line sits under: a short
 * line with no price or table cell, within `PRODUCT_HEADING_WINDOW` lines). A product the page heads
 * nowhere close above the line counts as no product: Cvph's "Demand Deposit Account" is a
 * rates heading below the fee. On a tie the newer read wins, Knox's lineup on today's copy.
 * "Newer wins" alone was wrong on 2 of 5 sampled live pairs (prod, Nov 3): a re-read that lost
 * "Bank of Commerce Super NOW Account" and "Infinity Checking", the headings right above the line.
 *
 * Hamilton's publish step then supersedes the live row with the re-read (no price change is
 * recorded, the amount is the same) or, when the live row wins, refuses the re-read. Darwin's live
 * re-check (`darwin/product-split-check.ts`) reads the pairs already live with the same rule.
 *
 * The switch is off: the publish step and Darwin only count (`product_split_check`) until a dry run
 * is sampled. On, both act.
 */
export const PRODUCT_SPLIT_MERGE_LIVE = false;
export const PUBLISH_PRODUCT_SPLIT_REFUSE_REASON_PREFIX = "Same printed line as live fee #";
export const PRODUCT_SPLIT_REFUSE_REASON_SUFFIX = " under another product";

/** Pure: a line's words and figures, lower case, one space apart. */
export function lineFold(text: string | null | undefined): string {
  return (text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Pure: how many times the folded line is printed in `text`. Counted by line first (a stored line is
 * normally one line of the text); a line spread over several text lines is counted as a whole-word
 * run of the folded text.
 */
export function linePrintCount(text: string, excerpt: string): number {
  const line = lineFold(excerpt);
  if (!line) return 0;
  const byLine = text.split(/\r?\n/).filter((each) => lineFold(each) === line).length;
  if (byLine > 0) return byLine;
  const folded = ` ${lineFold(text)} `;
  let count = 0;
  for (let at = folded.indexOf(` ${line} `); at >= 0; at = folded.indexOf(` ${line} `, at + line.length + 1)) count += 1;
  return count;
}

const ANY_PRICE = /\$\s*\d|(?<![\d.,$])\d[\d,]*\.\d{2}(?!\d)/;

const ZERO_WORD = /\b(?:free|none|n\/?c|n\/?a|no\s+charge|waived|no\s+fee)\b/gi;

/** Pure: the value cells of a table row (every cell after the label, which may be empty); null for a line with no table cells. */
function tableValueCells(line: string): string[] | null {
  if (!line.includes("|")) return null;
  const cells = line.split("|").map((cell) => cell.trim());
  if (cells[0] === "" && line.trimStart().startsWith("|")) cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === "" && line.trimEnd().endsWith("|")) cells.pop();
  return cells.slice(1).filter(Boolean);
}

/**
 * Pure: how many $0 prices the line prints. A table row counts every filled value cell, whatever it
 * says ("Included", "-0-", "No monthly fee"): one per account column. Other lines count zero words
 * and zero figures.
 */
export function zeroPriceCount(line: string): number {
  const values = tableValueCells(line);
  if (values) return values.length;
  return (line.match(ZERO_WORD) ?? []).length + (line.match(/(?<![\d.,])\$?\s*0(?:\.0{1,2})?(?![\d.,])/g) ?? []).length;
}

/**
 * Pure: the line prints the amount once, or is a $0 line that prints no other figure. A $0 line must
 * print at most one $0 price: "| Monthly Fee | Free | None |" or "| Monthly Fee | 0 | - |" prints one
 * price per account column, two products, two rows.
 */
export function pricedOnce(line: string, amount: number | string | null): boolean {
  if (Number(amount) === 0) {
    if (zeroPriceCount(line) > 1) return false;
    return pricePrints(line, amount) === 1 || !ANY_PRICE.test(line);
  }
  return pricePrints(line, amount) === 1;
}

const PRODUCT_FILLER = new Set(["account", "accounts", "the", "and", "of", "for"]);

function productWords(product: string | null | undefined): string[] {
  return lineFold((product ?? "").replace(/(?<=[a-z])\d{1,2}\b/gi, "")).split(" ").filter((word) => word && !PRODUCT_FILLER.has(word));
}

/** Pure: every word of the product (footnote digits off) is a word of the line. An empty product is never printed. */
export function productPrintedOnLine(product: string | null | undefined, line: string): boolean {
  const words = productWords(product);
  if (words.length === 0) return false;
  const lineWords = new Set(lineFold(line).split(" "));
  return words.every((word) => lineWords.has(word));
}

/** Non-blank text lines above a fee's line searched for its account heading. */
export const PRODUCT_HEADING_WINDOW = 12;
/** Words that make a short line a fee row's label rather than an account heading. */
const FEE_LABEL_WORDS = new Set(["fee", "fees", "charge", "charges", "charged"]);
/** Words a heading may carry beyond the product's own ("Truth-In-Savings Disclosure" style labels). */
const HEADING_EXTRA_WORDS = 4;

/**
 * Pure: `line` is a heading that names the product: every product word, at most a few other words,
 * and no price or table cell ("Account Research** | |" is a fee row, not the "Account Research" account).
 */
export function headingNamesProduct(product: string | null | undefined, line: string): boolean {
  if (/[$|]/.test(line) || ANY_PRICE.test(line)) return false;
  const words = productWords(product);
  // "Account Reconciliation Fee" is a fee row's label, not the heading of an account, even when Knox
  // took it as the product. "Fee Free Checking" and "No Fee Savings" are account names.
  if (lineFold(line).replace(/\b(?:no|free)\s+(?:fees?|charges?)\b|\b(?:fees?|charges?)\s+free\b/g, " ").split(" ").some((word) => FEE_LABEL_WORDS.has(word))) return false;
  const lineWords = lineFold(line).split(" ").filter(Boolean);
  return words.length > 0 && lineWords.length <= words.length + HEADING_EXTRA_WORDS && productPrintedOnLine(product, line);
}

/**
 * Pure: how many non-blank lines above the fee's line the nearest heading naming the product is (0 when the
 * fee's own line names it), within `PRODUCT_HEADING_WINDOW`; Infinity when there is no product, no
 * such heading, or the fee's line is not in the text (then only the line itself counts).
 */
export function productDistance(product: string | null | undefined, text: string | null, excerpt: string): number {
  if (productWords(product).length === 0) return Infinity;
  if (productPrintedOnLine(product, excerpt)) return 0;
  if (!text) return Infinity;
  const line = lineFold(excerpt);
  const lines = text.split(/\r?\n/).filter((each) => each.trim() !== "");
  const at = lines.findIndex((each) => lineFold(each) === line);
  if (at < 0) return Infinity;
  for (let index = at - 1; index >= Math.max(0, at - PRODUCT_HEADING_WINDOW); index -= 1) {
    if (headingNamesProduct(product, lines[index])) return at - index;
  }
  return Infinity;
}

export interface ProductSplitSide {
  product_name?: string | null;
  frequency?: string | null;
  source_document_id?: number | string | null;
  document_url?: string | null;
  source_url?: string | null;
  document_stream?: string | null;
  document_crawled_at?: string | Date | null;
  /** The stored source line (Knox's `excerpt=`), unfolded. */
  excerpt?: string | null;
}

function time(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function sameDocument(a: ProductSplitSide, b: ProductSplitSide): boolean {
  return a.source_document_id != null && b.source_document_id != null && String(a.source_document_id) === String(b.source_document_id);
}

/** Pure: both were read from one page: one document, or copies of one page in one stream. */
export function samePageCopy(a: ProductSplitSide, b: ProductSplitSide): boolean {
  if (sameDocument(a, b)) return true;
  const one = feePageKey(a.document_url ?? a.source_url);
  return one != null && one === feePageKey(b.document_url ?? b.source_url) && (a.document_stream ?? "") === (b.document_stream ?? "");
}

/** Pure: a short label, not a sentence or a "Name: description" line ("Basic Checking: no minimum balance"). */
function headingShaped(line: string): boolean {
  const plain = line.replace(/^[#*\s]+|[*\s]+$/g, "");
  if (/[.!?]$/.test(plain) || /:\s*\S/.test(plain)) return false;
  return lineFold(plain).split(" ").filter(Boolean).length <= 12;
}

function wordsWithin(inner: string[], outer: string[]): boolean {
  return inner.length > 0 && inner.every((word) => outer.includes(word));
}

/**
 * Pure: the page names both products for this line, on the line itself or on the one heading the
 * line sits under (the nearest line above with no price that names either), and neither name is a
 * part of the other. "Checking and Savings Accounts: Paper
 * statement fee $2.00", or a line under "Basic Checking & Student Checking", prices both products:
 * two rows. "Fresh Start Checking" and "Checking" are one name, the shorter a part of the longer:
 * still one line read twice. Two separate headings above the line (an earlier account's section,
 * then the line's own) are not both the line's: the nearer one heads it.
 */
export function namesBothProducts(one: string | null | undefined, two: string | null | undefined, text: string | null, excerpt: string): boolean {
  const [a, b] = [productWords(one), productWords(two)];
  if (a.length === 0 || b.length === 0 || wordsWithin(a, b) || wordsWithin(b, a)) return false;
  const both = (line: string) => productPrintedOnLine(one, line) && productPrintedOnLine(two, line);
  if (both(excerpt)) return true;
  if (!text) return false;
  const lines = text.split(/\r?\n/).filter((each) => each.trim() !== "");
  const at = lines.findIndex((each) => lineFold(each) === lineFold(excerpt));
  if (at < 0) return false;
  // Looser than an account heading for the winner: any priceless line naming both products keeps
  // two rows ("Checking and Savings Account Fees", "These fees apply to Basic Checking and Student
  // Checking accounts:", a table header row). The scan stops at a short label naming only one; a
  // sentence naming one ("Basic Checking: no minimum balance") is passed over. Wrongly keeping two
  // rows is the safe side.
  for (let index = at - 1; index >= Math.max(0, at - PRODUCT_HEADING_WINDOW); index -= 1) {
    const above = lines[index];
    if (/\$/.test(above) || ANY_PRICE.test(above)) continue;
    if (!productPrintedOnLine(one, above) && !productPrintedOnLine(two, above)) continue;
    if (both(above)) return true;
    if (headingShaped(above)) return false;
  }
  return false;
}

/**
 * Pure: `read` and `live` are one printed line read under two products (the module note's rule).
 * `currentText` is the stored text of the newer of the two documents; `amount` the shared amount.
 */
export function readsOneLineTwoProducts(read: ProductSplitSide, live: ProductSplitSide, currentText: string | null, amount: number | string | null): boolean {
  if (sameProduct(read.product_name, live.product_name)) return false;
  if (!samePageCopy(read, live)) return false;
  const line = lineFold(read.excerpt);
  if (!line || line !== lineFold(live.excerpt)) return false;
  if (!currentText || linePrintCount(currentText, read.excerpt ?? "") !== 1) return false;
  if (!pricedOnce(read.excerpt ?? "", amount)) return false;
  if (namesBothProducts(read.product_name, live.product_name, currentText, read.excerpt ?? "")) return false;
  const [one, two] = [frequencyClass(read.frequency), frequencyClass(live.frequency)];
  return one == null || two == null || one === two;
}

/**
 * Pure: whose product the merged line keeps. A read from an older copy than the live fee never
 * wins. Then the bank's page decides: the product named nearest the line wins (on the line itself,
 * else the nearest line above it in `text`, the newer document's stored text, that names it). A
 * product the page names nowhere above the line counts as none. On a tie the newer read wins.
 */
export function productSplitWinner(read: ProductSplitSide, live: ProductSplitSide, text: string | null = null): "read" | "live" {
  if (!sameDocument(read, live)) {
    const [readAt, liveAt] = [time(read.document_crawled_at), time(live.document_crawled_at)];
    if (readAt == null || (liveAt != null && liveAt > readAt)) return "live";
  }
  const line = read.excerpt ?? "";
  return productDistance(live.product_name, text, line) < productDistance(read.product_name, text, line) ? "live" : "read";
}

export interface ProductSplitCandidate {
  feeRawId: number;
  institutionId: number;
  canonicalFeeKey: string;
  variantType: string | null | undefined;
  amount: number;
  productName: string | null | undefined;
  frequency: string | null | undefined;
  sourceDocumentId: number;
  documentUrl: string | null | undefined;
  sourceUrl: string | null | undefined;
  documentStream: string | null | undefined;
  documentCrawledAt: string | Date | null | undefined;
}

export interface ProductSplitMatch {
  prior: PriorPublishedFeeRow;
  winner: "read" | "live";
}

type LiveSplitRow = PriorPublishedFeeRow & { frequency: string | null; excerpt: string | null };

/** SQL: Knox's stored source line of raw alias `alias`, unfolded; NULL when none. */
function excerptSql(alias: string): string {
  return `substring(COALESCE(${alias}.extraction_note, ${alias}.conditions) from 'excerpt="?(.*?)"?$')`;
}

/**
 * The live fee this row would repeat as one line read under another product, with whose product
 * wins, or null. Reads the live dollar rows of the row's institution, category, variant and amount
 * under any other product, the row's own stored line, and the newer document's current text.
 */
export async function selectProductSplitTwin(db: SqlTag, row: ProductSplitCandidate): Promise<PublicationEvidence<ProductSplitMatch | null>> {
  const read = await readPublicationEvidence("product_split", () => inSavepoint(db, async (scope) => {
    const [own] = await scope.unsafe<{ excerpt: string | null }[]>(
      `SELECT ${excerptSql("fr")} AS excerpt FROM raw_fee_observations fr WHERE fr.fee_raw_id = $1::bigint`, [row.feeRawId]);
    if (!own?.excerpt?.trim()) return { live: [] as LiveSplitRow[], own: null, texts: new Map<string, string>() };
    const live = await scope.unsafe<LiveSplitRow[]>(
      `SELECT fp.fee_published_id, fp.amount, fp.amount_kind, fp.rate_percent, fp.fee_name, fp.published_at, fp.source_url,
              fp.frequency, fr.source_document_id, fr.product_name, sd.crawled_at AS document_crawled_at,
              to_jsonb(sd)->>'companion_source_id' AS document_stream, sd.document_url, ${excerptSql("fr")} AS excerpt,
              ${PUBLISHED_IDENTITY_COLUMNS}
         FROM published_fee_records fp
         JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
         JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
         JOIN source_documents sd ON sd.id = fr.source_document_id
        WHERE fp.institution_id = $1::bigint
          AND fp.canonical_fee_key = $2
          AND COALESCE(fp.variant_type, '') = COALESCE($3::text, '')
          AND fp.amount = $4::numeric
          AND fp.rate_percent IS NULL
          AND fp.rolled_back_at IS NULL
          AND fp.quarantined_at IS NULL
          AND fr.fee_raw_id <> $5::bigint
          AND ${productKeySql("fr.product_name")} <> $6
        ORDER BY fp.fee_published_id`,
      [row.institutionId, row.canonicalFeeKey, row.variantType ?? null, row.amount, row.feeRawId, productKey(row.productName)]);
    const documentIds = [...new Set([row.sourceDocumentId, ...live.map((prior) => Number(prior.source_document_id))])];
    const texts = live.length === 0 ? [] : await scope.unsafe<{ source_document_id: number | string; normalized_text: string }[]>(
      `SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
         FROM agent_source_texts
        WHERE source_document_id = ANY($1::bigint[]) AND status = 'completed' AND normalized_text IS NOT NULL
        ORDER BY source_document_id, id DESC`, [documentIds]);
    return { live, own: own.excerpt, texts: new Map(texts.map((text) => [String(text.source_document_id), text.normalized_text])) };
  }));
  if (read.state === "unavailable") return read;
  const { live, own, texts } = read.value;
  const side: ProductSplitSide = {
    product_name: row.productName ?? null, frequency: row.frequency ?? null, source_document_id: row.sourceDocumentId,
    document_url: row.documentUrl ?? null, source_url: row.sourceUrl ?? null, document_stream: row.documentStream ?? null,
    document_crawled_at: row.documentCrawledAt ?? null, excerpt: own,
  };
  for (const prior of live) {
    // The line must print once in the newer document's text: the row's own unless the live fee is newer.
    const [readAt, liveAt] = [time(side.document_crawled_at), time(prior.document_crawled_at)];
    const liveNewer = !sameDocument(side, prior) && (readAt == null || (liveAt != null && liveAt > readAt));
    const text = texts.get(String(liveNewer ? prior.source_document_id : row.sourceDocumentId)) ?? null;
    if (readsOneLineTwoProducts(side, prior, text, row.amount)) {
      return { state: "available", value: { prior, winner: productSplitWinner(side, prior, text) } };
    }
  }
  return { state: "available", value: null };
}
