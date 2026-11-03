import type { sql } from "@/lib/data-store/connection";
import { sameProduct } from "@/lib/fee-product";
import { inSavepoint } from "@/lib/agents/savepoint";
import { frequencyClass } from "@/lib/agents/hamilton/exact-duplicate";
import { classifyFeeText } from "@/lib/agents/knox/rules";
import { pricedOnce, samePageCopy, type ProductSplitSide } from "./product-split";
import { PUBLISHED_IDENTITY_COLUMNS } from "./published-identity";
import { readPublicationEvidence, type PublicationEvidence } from "./publication-evidence";
import type { PriorPublishedFeeRow } from "./publish";

type SqlTag = typeof sql;

/**
 * One printed line, two categories (re-read backlog dry runs rb to rb10, Nov 3). When Knox reads a
 * page again with today's rules and files a line under a corrected category, the new row is a new fee
 * to every identity check after Knox, because each compares the category exactly: Hamilton's
 * live-line read (`selectLivePublishedFees`, `decidePriorFee`), the exact and page-copy collapses, the
 * same-line read and the product split. The re-read went live beside the live fee of its own line and
 * the old, wrong-category copy stayed: a scan of 482 backlog texts found 37 such pairs, 21 of them a
 * right correction (Intercredit Bank's "Late Payment Fee .... $15.00" in its safe deposit box list,
 * live as a loan late payment fee, #64789), and 21 more pairs at one price that are different fees
 * (check copies and statement copies at $3, domestic and foreign incoming wires, a box key and a
 * night-deposit key at $30).
 *
 * The rule (`rereadsLineInAnotherCategory`). A row is a re-read of a live fee's line, filed under
 * another category, when all of these hold:
 * - same institution and dollar amount, different categories, the same product;
 * - the same page: one document, or a copy of the same page (`samePageCopy`); the row's copy is not
 *   older than the live fee's;
 * - the row is a later read: the live fee's raw row was written before the row's (`read_at`). This is
 *   the re-read gate: a page read for the first time has no earlier read of its lines, and two rows
 *   from one read (one Knox pass reading a line twice) are a Knox problem, never a replacement;
 * - the same stated line (`sameStatedLine`): the two stored lines (Knox's `excerpt=`) fold to the same
 *   words and figures ("$1" and "$1.00" alike), or one is the other with only priceless words around
 *   it (a heading glued on in front, a neighbour's label after the price); the shorter line is printed
 *   exactly once in the newer document's current stored text, and so is the longer;
 * - the line prints the amount once (`pricedOnce`), unless both rows carry the same name: a line that
 *   prints the price twice may hold two fees;
 * - one name's words are all in the other's (`namesShareReading` in publish.ts, passed in);
 * - their frequencies do not differ (`frequencyClass`);
 * - the move is never between overdraft and NSF (`OVERDRAFT_NSF_MOVE`), in either direction: the paid-NSF
 *   convention (#1513) is James's to settle, and a combined line can name its overdraft program by a
 *   word no list holds ("NSF/Privilege Pay Fee");
 * - the line does not price an item of each category (`lineNamesBothCategories`): "Official Checks and
 *   Money Orders | $2.00" is one price for two fees, so both categories stay live.
 *
 * Hamilton's publish step then supersedes the live fee with the re-read (`superseded by #<id>`, no price
 * change recorded, the amount is the same). Darwin's live re-check (`darwin/reread-category-move-check.ts`)
 * reads the pairs already live with the same rule and takes the earlier read down.
 *
 * The switch is off: the publish step and Darwin only count (`reread_category_move_check`). In the
 * same dry runs, 5 of the 37 re-reads were Knox's wrong reads ("Returned Item Fee" re-read as NSF where
 * the page lists it under returned deposited items, "Box Late Fee" re-read as a loan late fee); with the
 * switch on, each would replace the right live fee. Knox's fix for them comes first, then the switch.
 */
export const REREAD_CATEGORY_MOVE_LIVE = false;

/** One side of a pair: a row about to publish, or a live fee, with its raw read. */
export interface CategoryMoveSide extends ProductSplitSide {
  canonical_fee_key: string | null;
  fee_name: string | null;
  /** When the raw row was written (`raw_fee_observations.created_at`): one Knox read writes all its rows at once. */
  read_at: string | Date | null;
}

const PRICE = /\$\s*\d[\d,]*(?:\.\d{1,2})?|(?<![\d.,$])\d[\d,]*\.\d{2}(?!\d)/g;

/** Pure: a stored line's words and figures, lower case, one space apart, whole-dollar cents dropped ("$1.00" reads "1"). */
export function statedLineFold(text: string | null | undefined): string {
  return (text ?? "").replace(/(\d)\.00(?!\d)/g, "$1").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function timeOf(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function runCount(folded: string, line: string): number {
  if (!line) return 0;
  let count = 0;
  for (let at = folded.indexOf(` ${line} `); at >= 0; at = folded.indexOf(` ${line} `, at + line.length + 1)) count += 1;
  return count;
}

/**
 * Pure: the two stored lines are one stated line of `text` (the newer document's current stored text).
 * Folded alike, or one is the other with priceless words around it; the shorter printed exactly once in
 * the text, and the longer too. Returns the shorter raw line, or null.
 */
export function sameStatedLine(one: string | null | undefined, two: string | null | undefined, text: string | null): string | null {
  const [a, b] = [statedLineFold(one), statedLineFold(two)];
  if (!a || !b || !text) return null;
  const [longRaw, shortRaw] = a.length >= b.length ? [one ?? "", two ?? ""] : [two ?? "", one ?? ""];
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  if (long !== short) {
    if (!` ${long} `.includes(` ${short} `)) return null;
    // Only words around the shorter line: no price of its own (another fee), and the shorter line holds one.
    const prices = (line: string) => line.match(PRICE)?.length ?? 0;
    if (prices(shortRaw) === 0 || prices(longRaw) !== prices(shortRaw)) return null;
  }
  const folded = ` ${statedLineFold(text)} `;
  if (runCount(folded, short) !== 1 || runCount(folded, long) !== 1) return null;
  return shortRaw;
}

const OVERDRAFT_WORD = /overdr|courtesy\s*pay|\bod\b/i;
/** NSF's own words, and the returned item it is charged for ("Overdraft/Returned Item Fee" is one combined line). */
const NSF_WORD = /\bnsf\b|(?:non|in)[\s-]*sufficient|\breturn(?:ed)?\s+(?:items?|checks?)\b|\bunpaid\b/i;

/**
 * Pure: a move between overdraft and NSF on a line (or a name) that names both: an overdraft word and
 * an NSF word or a returned item ("NSF/Overdraft", "Overdraft/Returned Item Fee"). The paid-NSF
 * convention (#1513) is James's to settle, so such a move is never made here.
 */
export function combinedOverdraftNsfLine(keys: [string | null, string | null], texts: Array<string | null | undefined>): boolean {
  const pair = new Set(keys);
  if (!(pair.has("overdraft") && pair.has("nsf"))) return false;
  return texts.some((text) => OVERDRAFT_WORD.test(text ?? "") && NSF_WORD.test(text ?? ""));
}

/** Never a move, either way: the paid-NSF convention (#1513), as `CONVENTION_PENDING` in darwin/reread-category-check.ts. */
export function overdraftNsfMove(keys: [string | null, string | null]): boolean {
  const pair = new Set(keys);
  return pair.has("overdraft") && pair.has("nsf");
}

/**
 * The parts of a line's label: split at "/", "and", "&", "or", commas and brackets, prices dropped. Never
 * at a table cell ("Stop Payment | Cashier's Check | $5.00" is a heading cell and the row's own item).
 */
const LABEL_JOINER = /\s*(?:\/|\band\b|&|,|;|\bor\b|\(|\))\s*/i;
/** A part that is a condition, not an item ("2 Free Per Month", "Thereafter", "per presentment"): never borrows the head. */
const CONDITION_PART = /\d|\b(?:free|per|each|ea|month|monthly|year|thereafter|after|first|up|to|over|under|max(?:imum)?|min(?:imum)?|only|plus|fee|fees|charge)\b/i;
const singular = (word: string) => word.replace(/['’]s$/i, "").replace(/(?<=[a-z]{3})s$/i, "");

/**
 * Pure: the categories a line's label names, part by part. A later part also borrows the head part's
 * words ("Copy Requests (checks, statements)" names a check copy and a statement copy).
 */
export function labelCategories(text: string | null | undefined): Set<string> {
  const label = String(text ?? "").replace(PRICE, " ");
  const parts = label.split(LABEL_JOINER).map((part) => part.trim()).filter((part) => /[a-z]{2}/i.test(part));
  const keys = new Set<string>();
  const add = (value: string) => {
    const key = classifyFeeText(value);
    if (key) keys.add(key);
  };
  const head = parts[0] ?? "";
  for (const [index, part] of parts.entries()) {
    add(part);
    if (index === 0 || CONDITION_PART.test(part) || part.split(/\s+/).length > 3 || !/[a-z]{4}/i.test(part)) continue;
    add(`${head} ${part}`);
    for (const word of head.split(/\s+/).filter((w) => /^[a-z]{3,}$/i.test(w))) add(`${singular(part)} ${singular(word)}`);
  }
  return keys;
}

/**
 * Pure: the line (or a name) prices an item of each category ("Money order/Cashier check fee | $8.00",
 * "Purchase money orders and cashier's checks / Free"). One price for two fees: both stay live.
 */
export function lineNamesBothCategories(keys: [string | null, string | null], texts: Array<string | null | undefined>): boolean {
  const [one, two] = keys;
  if (!one || !two) return false;
  return texts.some((text) => {
    const named = labelCategories(text);
    return named.has(one) && named.has(two);
  });
}

/**
 * Pure: `read` re-reads `live`'s printed line under another category (the module note's rule).
 * `currentText` is the stored text of the newer of the two documents; `amount` the shared amount;
 * `namesShare` is `namesShareReading(read.fee_name, live.fee_name)`.
 */
export function rereadsLineInAnotherCategory(
  read: CategoryMoveSide,
  live: CategoryMoveSide,
  currentText: string | null,
  amount: number | string | null,
  namesShare: boolean,
): boolean {
  if (!read.canonical_fee_key || !live.canonical_fee_key || read.canonical_fee_key === live.canonical_fee_key) return false;
  if (overdraftNsfMove([read.canonical_fee_key, live.canonical_fee_key])) return false;
  if (!sameProduct(read.product_name, live.product_name)) return false;
  if (!samePageCopy(read, live)) return false;
  // The re-read gate: an earlier read of the line, from the same copy or an older copy of the page.
  const [readAt, liveAt] = [timeOf(read.read_at), timeOf(live.read_at)];
  if (readAt == null || liveAt == null || liveAt >= readAt) return false;
  if (String(read.source_document_id) !== String(live.source_document_id)) {
    const [readCopy, liveCopy] = [timeOf(read.document_crawled_at), timeOf(live.document_crawled_at)];
    if (readCopy == null || (liveCopy != null && liveCopy > readCopy)) return false;
  }
  const line = sameStatedLine(read.excerpt, live.excerpt, currentText);
  if (line == null) return false;
  const sameName = statedLineFold(read.fee_name) !== "" && statedLineFold(read.fee_name) === statedLineFold(live.fee_name);
  if (!pricedOnce(line, amount) && !sameName) return false;
  if (!namesShare) return false;
  const [one, two] = [frequencyClass(read.frequency), frequencyClass(live.frequency)];
  if (one != null && two != null && one !== two) return false;
  return !lineNamesBothCategories([read.canonical_fee_key, live.canonical_fee_key], [line, read.excerpt, live.excerpt, read.fee_name, live.fee_name]);
}

export interface CategoryMoveCandidate {
  feeRawId: number;
  institutionId: number;
  canonicalFeeKey: string;
  amount: number;
  feeName: string | null;
  productName: string | null | undefined;
  frequency: string | null | undefined;
  sourceDocumentId: number;
  documentUrl: string | null | undefined;
  sourceUrl: string | null | undefined;
  documentStream: string | null | undefined;
  documentCrawledAt: string | Date | null | undefined;
}

type LiveMoveRow = PriorPublishedFeeRow & {
  canonical_fee_key: string | null;
  frequency: string | null;
  excerpt: string | null;
  read_at: string | Date | null;
};

/** SQL: Knox's stored source line of raw alias `alias`, unfolded; NULL when none. */
function excerptSql(alias: string): string {
  return `substring(COALESCE(${alias}.extraction_note, ${alias}.conditions) from 'excerpt="?(.*?)"?$')`;
}

/**
 * The live fee this row re-reads under another category, or null. Reads the row's own stored line and
 * read time, the live dollar rows of its institution and amount in other categories, and the newer
 * document's current text; judged by `rereadsLineInAnotherCategory`. `sharesReading` is publish's
 * `namesShareReading`.
 */
export async function selectRereadCategoryMove(
  db: SqlTag,
  row: CategoryMoveCandidate,
  sharesReading: (one: string | null, two: string | null) => boolean,
): Promise<PublicationEvidence<PriorPublishedFeeRow | null>> {
  const read = await readPublicationEvidence("reread_category_move", () => inSavepoint(db, async (scope) => {
    const [own] = await scope.unsafe<{ excerpt: string | null; read_at: string | Date | null }[]>(
      `SELECT ${excerptSql("fr")} AS excerpt, fr.created_at AS read_at FROM raw_fee_observations fr WHERE fr.fee_raw_id = $1::bigint`, [row.feeRawId]);
    if (!own?.excerpt?.trim()) return { live: [] as LiveMoveRow[], own: null, texts: new Map<string, string>() };
    const live = await scope.unsafe<LiveMoveRow[]>(
      `SELECT fp.fee_published_id, fp.amount, fp.amount_kind, fp.rate_percent, fp.fee_name, fp.published_at, fp.source_url,
              fp.canonical_fee_key, fp.frequency, fr.source_document_id, fr.product_name, fr.created_at AS read_at,
              sd.crawled_at AS document_crawled_at, to_jsonb(sd)->>'companion_source_id' AS document_stream, sd.document_url,
              ${excerptSql("fr")} AS excerpt, ${PUBLISHED_IDENTITY_COLUMNS}
         FROM published_fee_records fp
         JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
         JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
         JOIN source_documents sd ON sd.id = fr.source_document_id
        WHERE fp.institution_id = $1::bigint
          AND fp.canonical_fee_key <> $2
          AND fp.amount = $3::numeric
          AND fp.rate_percent IS NULL
          AND fp.rolled_back_at IS NULL
          AND fp.quarantined_at IS NULL
          AND fr.fee_raw_id <> $4::bigint
          AND fr.created_at < $5::timestamptz
        ORDER BY fp.fee_published_id`,
      [row.institutionId, row.canonicalFeeKey, row.amount, row.feeRawId, own.read_at]);
    const texts = live.length === 0 ? [] : await scope.unsafe<{ source_document_id: number | string; normalized_text: string }[]>(
      `SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
         FROM agent_source_texts
        WHERE source_document_id = ANY($1::bigint[]) AND status = 'completed' AND normalized_text IS NOT NULL
        ORDER BY source_document_id, id DESC`, [[row.sourceDocumentId]]);
    return { live, own, texts: new Map(texts.map((text) => [String(text.source_document_id), text.normalized_text])) };
  }));
  if (read.state === "unavailable") return read;
  const { live, own, texts } = read.value;
  if (!own) return { state: "available", value: null };
  const side: CategoryMoveSide = {
    canonical_fee_key: row.canonicalFeeKey, fee_name: row.feeName, read_at: own.read_at,
    product_name: row.productName ?? null, frequency: row.frequency ?? null, source_document_id: row.sourceDocumentId,
    document_url: row.documentUrl ?? null, source_url: row.sourceUrl ?? null, document_stream: row.documentStream ?? null,
    document_crawled_at: row.documentCrawledAt ?? null, excerpt: own.excerpt,
  };
  // The row's own document is the newer copy: a live fee from a newer copy never loses to it.
  const text = texts.get(String(row.sourceDocumentId)) ?? null;
  const prior = live.find((fee) => rereadsLineInAnotherCategory(side, fee, text, row.amount, sharesReading(row.feeName, fee.fee_name)));
  return { state: "available", value: prior ?? null };
}
