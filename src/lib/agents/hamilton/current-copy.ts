import { primaryAncillaryProduct } from "../knox/ancillary-product";
import { productKey, productKeySql, sameProduct } from "@/lib/fee-product";
import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { inSavepoint } from "@/lib/agents/savepoint";
import { checkFeeAgainstSource, withDroppedDecimalPoints } from "@/lib/custom-report/source-check";
import { hasFeeChangeTable, newestColumnText } from "@/lib/fee-change-columns";
import { secondLook, secondLookDedupeKey, SECOND_LOOK_MIN_MINUTES } from "@/lib/agents/hamilton/second-look";
import { sameSchedule } from "@/lib/agents/hamilton/schedule-edition";
import {
  NEWER_COPY_MIN_SHARED_FEES,
  NEWER_COPY_MIN_SHARED_SHARE,
  GENERIC_WORDS,
  newerCopyVerdict,
  squash,
  type NewerCopyVerdict,
} from "@/lib/agents/hamilton/newer-copy-retire";

type SqlTag = typeof sql;

/**
 * Live fees still tied to a superseded copy of their bank's page (coordinator, 7 Oct: 9,816
 * live fees, one of James's critical issues). `refresh-copy.ts` moves each fee the current
 * copy restates (a verified row at the same category and amount) onto that copy. This
 * check takes the rest: a fee with no such row is read against the current copy's text.
 *
 * - The current copy states it at its price: it is current, and stays live.
 * - The current copy names it at another price, or no longer carries the line: the live
 *   price may be stale. It is flagged, and taken down only on its second look
 *   (`second-look.ts`, check `hamilton.current_copy`, 12 hours later, on a later run), archived
 *   with `rolled_back_reason = 'not_on_current_copy:#<current document id>'` and its verified
 *   row rejected so it is not republished. Nothing is deleted.
 *
 * Nothing is judged unless the older copy's own text states the fee (a layout the matcher
 * misses in both copies is the matcher's miss, `unproven`) and the current copy is
 * recognizably the same schedule: it restates at least half of the older copy's judged fees,
 * and at least two (`judgeNewerCopy`'s bar), so an error page or a redesign flags nothing.
 *
 * Retired documents (Oct 19, James: "why aren't the agents finding these problems?"). A live
 * fee can also cite a document that is no longer any of its bank's sources: not the fee
 * schedule link, not a companion page, not a non-rejected additional source, and never
 * superseded because the bank's link moved to a new address instead of changing in place
 * (Cedar Falls, #1945). Such a document is judged the same way against the newest read copy
 * at the bank's current fee link (`retiredCopiesSql`). Prod, read-only, Oct 19: 8,385 live fees
 * cite 543 such documents; 258 of them (3,607 fees) have a read copy at the current link. The
 * other 285 have no read copy there, so they wait on capture (`magellan/saved-link-fetch.ts`).
 * The address the plain fetch asks for (the profile's remembered one) also counts as a source,
 * and since #1200 the current copy is the newest read copy at either that fetch target or the
 * saved link, so a stale copy at one never judges a fee the other has re-read.
 *
 * `CURRENT_COPY_CONFIRM_LIVE` false logs first looks and confirms none, until a hand check of
 * the flags passes (18 of 20 stale), then a fix PR turns it on. A retired document is paired only
 * with a copy the bank was seen serving at or after its fetch (`retiredCopiesSql`), so no flag
 * rests on a copy older than the live fee's own document.
 */
export const CURRENT_COPY_CHECK = "hamilton.current_copy";
export const CURRENT_COPY_REASON = "not_on_current_copy";
export const CURRENT_COPY_FLAG = "not_on_current_copy";
export const CURRENT_COPY_CONFIRM_LIVE = false;
export const CURRENT_COPY_DOCUMENT_LIMIT = 40;
// v2 (9 Oct): copies judged before #471's verdict and the renamed-account fix are judged again.
// v3 (27 Oct, #2072): copies are judged again with the layout fixes of the second hand check
// (glued two-column prices, markup line breaks, spaced decimal points, fee-change notices). While
// `CURRENT_COPY_CONFIRM_LIVE` is false the re-run only logs first looks; it takes nothing down.
export const CURRENT_COPY_STRATEGY = { strategy: "hamilton.current_copy_check", version: 3 } as const;

/**
 * The retired documents among the `live` CTE's rows (columns older_document_id, institution_id,
 * superseded_by_id, companion_source_id, document_url, fee_schedule_url), each paired with the
 * newest read copy at the address its bank's plain fetch asks for or its saved link (see the module note). That
 * fetch target is the profile's remembered address, else the saved fee link (`fetch.ts`,
 * `profile_canonical_source_url ?? fee_schedule_url`): the page Magellan keeps fresh, and a
 * successful fetch remembers its final address, so its copies are stored under it. Keyed on
 * `fee_schedule_url` alone (#1200), a retired document paired only when the saved link had a copy
 * of its own, and never with the page the bank is actually fetched at. The newest read copy at
 * either address wins (the saved link is kept fresh by `magellan/saved-link-fetch.ts`), and a copy
 * with no address never pairs. Neither address
 * is retired. Links are compared without scheme, "www.", case or trailing slashes. A bank with
 * neither address, or no read copy at either, pairs nothing. Changes here change both the check
 * and Bayes's count.
 *
 * A copy the bank was last seen serving (fetched or re-checked) before the retired document was
 * fetched never pairs (#1200, Oct 26). "Retired" only says the document's address is no longer a
 * source; it does not say the document is old. On prod, read-only, 241 live fees on 25 such
 * documents were paired with a copy fetched before them, and 139 fees on 19 documents with one
 * the bank had not been seen serving since: a print view or a business schedule read on Oct 20
 * judged against the plain page last fetched on Oct 9, a page read in October against a Feb 17
 * copy at a dead link. Judging newer evidence against older evidence takes a current price down
 * as "not on the current copy". The issue held those 241 back for a hand check; the order rule
 * decides them instead: the 139 no longer pair, and the other 102 pair because the bank was still
 * serving that copy after their document was fetched. Copies superseded in place already pass it
 * (all 358 live fees whose superseding copy was fetched earlier have it re-checked since). When
 * the copy's check date moves past the retired document's fetch (Magellan's next fetch of the
 * address), the pair forms again and is judged as usual.
 */
export function retiredCopiesSql(db: SqlTag) {
  return db`
    SELECT DISTINCT ON (d.older_document_id) d.older_document_id, cur.id AS current_document_id
      FROM (
        SELECT DISTINCT l.older_document_id, l.institution_id,
               lower(regexp_replace(regexp_replace(btrim(COALESCE(l.document_url, '')), '^https?://(www\\.)?', '', 'i'), '/+$', '')) AS doc_key,
               lower(regexp_replace(regexp_replace(btrim(COALESCE(l.fee_schedule_url, '')), '^https?://(www\\.)?', '', 'i'), '/+$', '')) AS link_key,
               lower(regexp_replace(regexp_replace(btrim(COALESCE(NULLIF(btrim(profile.canonical_source_url), ''), l.fee_schedule_url, '')), '^https?://(www\\.)?', '', 'i'), '/+$', '')) AS fetch_key
          FROM live l
          LEFT JOIN institution_source_profiles profile ON profile.institution_id = l.institution_id
         WHERE l.superseded_by_id IS NULL
           AND l.companion_source_id IS NULL
      ) d
      JOIN LATERAL (
        SELECT c.id
          FROM source_documents c
         WHERE c.institution_id = d.institution_id
           AND c.id <> d.older_document_id
           AND c.superseded_by_id IS NULL
           AND c.status = 'success'
           AND c.duplicate_of_id IS NULL
           AND lower(regexp_replace(regexp_replace(btrim(COALESCE(c.document_url, '')), '^https?://(www\\.)?', '', 'i'), '/+$', '')) IN (d.fetch_key, d.link_key)
           AND btrim(COALESCE(c.document_url, '')) <> ''
           AND EXISTS (SELECT 1 FROM agent_source_texts t WHERE t.source_document_id = c.id AND t.status = 'completed' AND t.normalized_text IS NOT NULL)
           -- The copy must be what the bank served at or after the retired document was fetched
           -- (its own fetch or its last re-check). A copy last seen before then is older evidence
           -- than the live fee and never judges it (#1200: 139 live fees, Oct 26).
           AND NOT EXISTS (
             SELECT 1 FROM source_documents older
              WHERE older.id = d.older_document_id
                AND GREATEST(c.crawled_at, c.last_checked_at) < older.crawled_at
           )
         -- The newest read copy at either address: an older copy at the fetch target never wins
         -- over a newer one at the saved link, or a stale copy would judge the live fee.
         ORDER BY c.id DESC
         LIMIT 1
      ) cur ON TRUE
     WHERE d.fetch_key <> ''
       -- The address the plain fetch asks for and the saved link are still sources.
       AND d.doc_key <> d.fetch_key
       AND d.doc_key <> d.link_key
       AND NOT EXISTS (
         SELECT 1 FROM institution_additional_sources ias
          WHERE ias.institution_id = d.institution_id
            AND ias.status <> 'rejected'
            AND lower(regexp_replace(regexp_replace(btrim(COALESCE(ias.url, '')), '^https?://(www\\.)?', '', 'i'), '/+$', '')) = d.doc_key
       )
     ORDER BY d.older_document_id
  `;
}

export function currentCopyFingerprint(olderDocumentId: number, currentDocumentId: number): string {
  return `v${CURRENT_COPY_STRATEGY.version}:${olderDocumentId}:${currentDocumentId}`;
}

export interface CurrentCopyFeeRow {
  product_name?: string | null;
  fee_published_id: number | string;
  fee_verified_id: number | string;
  institution_id: number | string;
  older_document_id: number | string;
  current_document_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  /** True when the current copy holds a verified row at this category and amount (refresh-copy moves it). */
  restated_row: boolean | null;
  /** True when the older document is retired (no longer a source) rather than superseded in place. */
  retired?: boolean | null;
  older_url?: string | null;
  current_url?: string | null;
}

export interface CurrentCopyCandidate {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  sourceDocumentId: number;
  currentDocumentId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  verdict: NewerCopyVerdict;
  reason: string;
}

export interface CurrentCopyDocument {
  olderDocumentId: number;
  currentDocumentId: number;
  institutionId: number;
  stated: number;
  named: number;
  dropped: number;
  unproven: number;
  recognized: boolean;
  /** The older document is retired (no longer a source), not superseded in place. */
  retired: boolean;
  failing: CurrentCopyCandidate[];
  passing: number[];
  /**
   * Fees this run read but could not prove stale: `unproven`, or suspected on a copy that is not
   * recognizably the same schedule. A first look left on one is cleared (#2072), since the check no
   * longer has evidence for it.
   */
  notProven: number[];
}

/** Pure: one older copy's live fees judged against its current copy. */
const squashText = (value: string) => value.toLowerCase().replace(/\s+/g, " ");

/** A price in page text: "$5", "$ 5.00", "5.00". */
const PAGE_PRICE = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\b\d{1,3}(?:,\d{3})*\.\d{2}\b/g;

/**
 * True when the current page names a piece of the fee's name and the first price after it,
 * within 120 characters, is the fee's price, however the row is laid out: a name over its
 * price ("Stop Payment\n(each item ...)\n$30 each"), or one price of several on a row
 * ("Domestic wire | Outgoing = $20 Incoming = $10" anchors "Incoming" to $10). Each piece of
 * the name between separators (":", "|", parentheses, " - ") of 5 or more characters can
 * anchor ("each" cannot).
 *
 * Two misses from the 9 Oct hand check (Tampa Bay FCU, "Fresh Start Checking | $9.95/month"):
 * a name Hamilton composed from the account heading ("Fresh Start Checking Monthly Maintenance
 * Fee", `account-names.ts`) also anchors without its generic fee words, and a condition in
 * parentheses ("Rewards Checking (Waived with $1,500 ...) | $5.95/month") is read past. Pure.
 */
export function priceFollowsName(feeName: string, amount: number, currentText: string): boolean {
  const current = squashText(currentText);
  const parts = feeName.split(/[:|()\u2013\u2014]| - /).map((part) => squashText(part).trim());
  const anchors = [...parts, ...parts.map((part) => part.replace(GENERIC_FEE_WORDS, "").trim())].filter((part) => part.length >= 5);
  const isPrice = (window: string) => {
    const first = window.match(PAGE_PRICE)?.[0];
    return first != null && Math.abs(Number(first.replace(/[$,\s]/g, "")) - amount) < 0.005;
  };
  for (const anchor of new Set(anchors)) {
    for (let at = current.indexOf(anchor); at >= 0; at = current.indexOf(anchor, at + 1)) {
      const after = current.slice(at + anchor.length, at + anchor.length + 120);
      if (isPrice(after) || isPrice(after.replace(/\([^()]*\)/g, " "))) return true;
    }
  }
  return false;
}

/** The fee words `account-names.ts` appends to an account heading. */
const GENERIC_FEE_WORDS = /\s*\b(?:monthly\s+)?(?:maintenance|service)\s+(?:fee|charge)$|\s*\bmonthly\s+fee$/;

/**
 * The newer-copy verdict, with two guards from the first hand check (7 Oct, 19:00 UTC: 14 of
 * 20 first looks were still stated on the current page): a fee whose name the current page
 * still follows with its price is stated (`priceFollowsName`), and a
 * $0 row is never judged, since "FREE" carries no price to match.
 */
export function currentCopyVerdict(fee: CurrentCopyFeeRow, rawCurrentText: string, olderText: string): NewerCopyVerdict {
  const amount = fee.amount == null ? null : Number(fee.amount);
  if (amount != null && !(amount > 0)) return "unproven";
  const currentText = readableCurrentText(rawCurrentText);
  const verdict = layoutVerdict(fee, currentText, olderText);
  if (verdict === "still_stated" || verdict === "unproven" || amount == null) return verdict;
  // #2072: a glued column's prices neither state nor drop the fee.
  if (interleavedPriceWitness(fee.fee_name, amount, currentText)) return "unproven";
  // #2072: a fee-change notice's silence proves nothing; only a row of its own naming the fee at
  // another price does ("Money Orders | $2.00 | $5.00" makes a live $2 stale).
  if (isFeeChangeNotice(rawCurrentText) && listsFewerFees(currentText, olderText)) {
    const traced = checkFeeAgainstSource(currentText, fee.fee_name, amount, ".", fee.canonical_fee_key);
    if (!traced.ok && traced.reason === "name_not_in_text") return "unproven";
  }
  return verdict;
}

/**
 * #2072: a notice lists only what changes, so it prints clearly fewer priced lines than the full
 * schedule it amends: fewer than half the older copy's. A copy that reprints every fee (a full
 * schedule with "Current fee | New fee" columns) is a schedule, and its silence still drops a fee.
 * Pure.
 */
export function listsFewerFees(currentText: string, olderText: string): boolean {
  const priced = (text: string) => text.split("\n").filter((line) => /\$\s?\d/.test(line)).length;
  return priced(currentText) * 2 < priced(olderText);
}

/**
 * #2072 (hand check of 20 first looks, Oct 27: 11 really stale): the current copy's text as a
 * reader sees it. A line break kept as markup ("Debit Card*** | No Annual Fee<br>$10.00 Card
 * Replacement Fee") is a line break, and a price whose point the PDF spaced off its cents
 * ("$29. 00/eac h") is that price (`withDroppedDecimalPoints`, the source check's own repair), so
 * `priceFollowsName` reads $29.00 rather than $29. A change table's row is read at its newest
 * column (`newestColumnText`, Knox's reading), so "Money Orders | $2.00 | $5.00" never has
 * `priceFollowsName` find the old $2. Pure.
 */
export function readableCurrentText(text: string): string {
  return newestColumnText(withDroppedDecimalPoints(text.replace(/<br\s*\/?>/gi, "\n")));
}

/** A run of two or more prices glued with nothing between them: "$10.00$25.00", "$ 5.00$15.00". */
const GLUED_PRICE_RUN = /\$\s?\d[\d,]*\.\d{2}(?:\$\s?\d[\d,]*\.\d{2})+/g;

/**
 * #2072: a two-column PDF flattened row by row glues both columns' names onto one line and both
 * prices after them ("Courtesy Pay Fee (per transaction) ……Research & Reconcilement (per hour)…
 * $10.00$25.00", "Card Replacement ……Share Draft Protest …… $20.00$10.00", Access FCU). The order of
 * the prices is not the order of the names (`gluedPricePair`), so such a line neither states nor
 * drops a fee: when the fee's name is on the line, or on the line just above it, and its price is one
 * of the glued prices, its absence from the current copy is not proven.
 *
 * Guards from the review of the first version: the line above counts only when it has no price of
 * its own ("Card Replacement Fee $20.00" above "Share Draft Protest……Statement Copy…… $10.00$5.00"
 * prices the card at $20, so a live $10 stays stale); a piece of the name made only of generic fee
 * words ("Per Item" of "NSF Fee - Per Item", `GENERIC_WORDS`) never anchors; and a fee whose name the
 * page prices on a line of its own, outside any glued run, is judged by that line, not witnessed. Pure.
 */
export function interleavedPriceWitness(feeName: string, amount: number, currentText: string): boolean {
  const lines = currentText.split("\n");
  const anchors = nameAnchors(feeName);
  if (anchors.length === 0) return false;
  const names = (text: string) => {
    const squashed = squash(text);
    return anchors.some((anchor) => squashed.includes(anchor));
  };
  const glued = (line: string) => line.match(GLUED_PRICE_RUN);
  // Priced on a line of its own elsewhere: that line judges the fee.
  if (lines.some((line) => !glued(line) && /\$\s?\d/.test(line) && names(line))) return false;
  return lines.some((line, index) => {
    const runs = glued(line);
    if (!runs) return false;
    const prices = runs.flatMap((run) => run.match(/\d[\d,]*\.\d{2}/g) ?? []).map((price) => Number(price.replace(/,/g, "")));
    if (!prices.some((price) => Math.abs(price - amount) < 0.005)) return false;
    const above = lines[index - 1] ?? "";
    return names(line) || (!/\$\s?\d/.test(above) && names(above));
  });
}

/**
 * The pieces of a fee's name that can find its label on a page, squashed: the name without its
 * parentheses and each piece between separators, of 5 or more letters, holding at least one word
 * that is not generic fee vocabulary ("NSF Fee", not "Per Item"). Pure.
 */
function nameAnchors(feeName: string): string[] {
  const bare = feeName.replace(/\([^()]*\)/g, " ");
  const pieces = [bare, ...bare.split(/[:|–—]| - /)];
  const distinctive = (piece: string) => (piece.toLowerCase().match(/[a-z]{3,}/g) ?? []).some((word) => !GENERIC_WORDS.has(word));
  return [...new Set(pieces.filter(distinctive).map(squash).filter((piece) => piece.length >= 5))];
}

/**
 * #2072: a notice of changed fees lists only the fees that change ("General Fee Changes: The fees
 * highlighted below have been adjusted …", Jeanne D'Arc CU, doc 21764), so a fee missing from it is
 * not missing from the bank's schedule. Such a copy never proves a fee stale.
 *
 * Only a definite statement that fees changed counts ("The fees highlighted below have been
 * adjusted", "the following fees will change"), or a change table ("Fee through | Fee as of",
 * `hasFeeChangeTable`). A schedule's ordinary words do not: "subject to change without notice",
 * "updated annually", a "Fee Changes" heading over a change policy, "Notice of change in terms: see
 * your account agreement". Read from the opening of the text only. The caller also requires the
 * copy to list clearly fewer fees than the older one (`listsFewerFees`). Pure.
 */
export function isFeeChangeNotice(text: string): boolean {
  const head = text.slice(0, FEE_CHANGE_NOTICE_HEAD_CHARS);
  return FEE_CHANGE_NOTICE.some((pattern) => pattern.test(head)) || hasFeeChangeTable(head);
}

export const FEE_CHANGE_NOTICE_HEAD_CHARS = 1500;
const CHANGED = "(?:adjusted|changed|revised|increased|decreased|reduced|modified|raised|lowered)";
const FEE_CHANGE_NOTICE: readonly RegExp[] = [
  // "The fees highlighted below have been adjusted", "Prices shown below have been increased".
  new RegExp(String.raw`\b(?:fees?|charges?|prices?|pricing)\s+(?:(?:highlighted|marked|shown|listed|noted|bolded|shaded)\s+)?below\s+(?:have|has)\s+been\s+${CHANGED}\b`, "i"),
  // "the following fees will change", "The following fees have been increased".
  new RegExp(String.raw`\bthe\s+following\s+(?:fees?|charges?|prices?)\s+(?:will\s+(?:change|be\s+${CHANGED})|have\s+(?:changed|been\s+${CHANGED}))\b`, "i"),
];

/**
 * The newer-copy verdict, with the layout guards of the hand checks (`priceFollowsName`, the
 * shared source check). Pure.
 */
function layoutVerdict(fee: CurrentCopyFeeRow, currentText: string, olderText: string): NewerCopyVerdict {
  const amount = fee.amount == null ? null : Number(fee.amount);
  if (productKey(fee.product_name)) {
    const owner = primaryAncillaryProduct(currentText);
    if (!owner || !sameProduct(owner.productName, fee.product_name)) return "unproven";
    // Keep fallback name/price checks within the same positive ownership witness.
    const verdict = newerCopyVerdict(fee, currentText, olderText);
    currentText = owner.block;
    if (verdict === "still_stated" || verdict === "unproven" || verdict === "no_amount" || amount == null) return verdict;
    const traced = checkFeeAgainstSource(currentText, fee.fee_name, amount, ".", fee.canonical_fee_key);
    return priceFollowsName(fee.fee_name, amount, currentText) || traced.ok || traced.reason === "tiered_fee" ? "still_stated" : verdict;
  }
  const verdict = newerCopyVerdict(fee, currentText, olderText);
  if (verdict === "still_stated" || verdict === "unproven" || verdict === "no_amount" || amount == null) return verdict;
  if (priceFollowsName(fee.fee_name, amount, currentText)) return "still_stated";
  const traced = checkFeeAgainstSource(currentText, fee.fee_name, amount, ".", fee.canonical_fee_key);
  return traced.ok || traced.reason === "tiered_fee" ? "still_stated" : verdict;
}

/**
 * Pure: a retired document is judged only against the same page or a newer dated edition of the
 * same audience's schedule (`sameSchedule`, the change rule's test). The current link's newest
 * copy is not always the bank's newest schedule: the dry run (Oct 19) found Billerica Municipal
 * Employees FCU's link still on its Nov 2020 PDF while live fees came from the Aug 2023 one, and
 * Lookout FCU's on its 2021 file beside a 2023 one. An undated pair on two pages judges nothing,
 * and one page whose current file name is dated earlier than the retired one's judges nothing.
 */
export function retiredCopyIsNewer(fee: Pick<CurrentCopyFeeRow, "older_url" | "current_url">, currentText: string, olderText: string): boolean {
  const match = sameSchedule({ oldUrl: fee.older_url, newUrl: fee.current_url, oldText: olderText, newText: currentText });
  if (match !== "same_page") return match != null;
  // `feePageKey` ignores dates in a file name, so "Schedule-of-Fees-2023Aug.pdf" and
  // "Schedule-of-Fees-2020-Nov.pdf" are one page: a link whose file is dated earlier is not newer.
  const olderYear = linkYear(fee.older_url);
  const currentYear = linkYear(fee.current_url);
  return olderYear == null || currentYear == null || currentYear >= olderYear;
}

/** The latest year (1990-2099) a link's file name names, or null. Pure. */
export function linkYear(url: string | null | undefined): number | null {
  if (!url) return null;
  let path = url;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    // Not a full URL: read it as written.
  }
  // The file name only: a WordPress upload folder ("/uploads/2024/08/") dates the upload, not the schedule.
  const file = path.split("/").filter(Boolean).at(-1) ?? "";
  const years = [...file.matchAll(/(?<!\d)(?:199\d|20\d\d)(?!\d)/g)].map((m) => Number(m[0]));
  return years.length > 0 ? Math.max(...years) : null;
}

export function judgeAgainstCurrentCopy(fees: CurrentCopyFeeRow[], currentText: string, olderText: string): CurrentCopyDocument {
  const first = fees[0];
  const doc: CurrentCopyDocument = {
    olderDocumentId: Number(first.older_document_id),
    currentDocumentId: Number(first.current_document_id),
    institutionId: Number(first.institution_id),
    stated: 0,
    named: 0,
    dropped: 0,
    unproven: 0,
    recognized: false,
    retired: first.retired === true,
    failing: [],
    passing: [],
    notProven: [],
  };
  const suspect: CurrentCopyCandidate[] = [];
  for (const fee of fees) {
    // A verified current-copy row at the same category and amount restates it (refresh-copy moves it).
    const verdict: NewerCopyVerdict = fee.restated_row ? "still_stated" : currentCopyVerdict(fee, currentText, olderText);
    if (verdict === "still_stated") {
      doc.stated += 1;
      if (!fee.restated_row) doc.passing.push(Number(fee.fee_published_id));
      continue;
    }
    if (verdict === "still_named") doc.named += 1;
    else if (verdict === "dropped") doc.dropped += 1;
    else {
      doc.unproven += 1;
      doc.notProven.push(Number(fee.fee_published_id));
      continue;
    }
    suspect.push({
      feePublishedId: Number(fee.fee_published_id),
      feeVerifiedId: Number(fee.fee_verified_id),
      institutionId: Number(fee.institution_id),
      sourceDocumentId: Number(fee.older_document_id),
      currentDocumentId: Number(fee.current_document_id),
      canonicalFeeKey: fee.canonical_fee_key,
      feeName: fee.fee_name,
      amount: fee.amount == null ? null : Number(fee.amount),
      verdict,
      reason: `${CURRENT_COPY_REASON}:#${Number(fee.current_document_id)}`,
    });
  }
  const judged = doc.stated + doc.named + doc.dropped;
  doc.recognized = doc.stated >= NEWER_COPY_MIN_SHARED_FEES && judged > 0 && doc.stated / judged >= NEWER_COPY_MIN_SHARED_SHARE
    && (!doc.retired || retiredCopyIsNewer(first, currentText, olderText));
  if (doc.recognized) doc.failing = suspect;
  else doc.notProven.push(...suspect.map((candidate) => candidate.feePublishedId));
  return doc;
}

export interface CurrentCopyResult {
  documentsChecked: number;
  unrecognized: number;
  stated: number;
  failing: number;
  flagged: number;
  waiting: number;
  cleared: number;
  takenDown: CurrentCopyCandidate[];
  confirmLive: boolean;
  samples: CurrentCopyCandidate[];
  /** Fees the current copy states at their price by its text (not by a restated verified row), for UAT. */
  statedFeeIds: number[];
  /** Each judged copy: older and current document, and whether the current copy was recognized. */
  copies: Array<{ older: number; current: number; recognized: boolean; retired: boolean }>;
  /** Of `documentsChecked`, the retired documents (no longer a source) judged against the current link's copy. */
  retiredChecked: number;
  /** Of `failing`, fees on retired documents. */
  retiredFailing: number;
}

const EMPTY: CurrentCopyResult = {
  documentsChecked: 0,
  unrecognized: 0,
  stated: 0,
  failing: 0,
  flagged: 0,
  waiting: 0,
  cleared: 0,
  takenDown: [],
  confirmLive: CURRENT_COPY_CONFIRM_LIVE,
  samples: [],
  statedFeeIds: [],
  copies: [],
  retiredChecked: 0,
  retiredFailing: 0,
};

/**
 * Bayes's count for this strategy: every older/current document pair with a live fee the current
 * copy does not restate, split into pairs checked at this version, pairs the check will pick up,
 * and pairs it cannot read (no completed text on one side). Mirrors the selection in
 * `secondLookFeesNotOnCurrentCopy`; change both together.
 */
export async function countCurrentCopyPairs(db: SqlTag): Promise<{ pairs: number; done: number; queued: number; noText: number }> {
  const [row] = await db<Array<Record<string, number | string>>>`
    WITH live AS MATERIALIZED (
      SELECT fp.canonical_fee_key, fp.amount, fp.rate_percent, fp.institution_id, fr.product_name,
             fr.source_document_id AS older_document_id,
             sd.superseded_by_id, sd.companion_source_id, sd.document_url, inst.fee_schedule_url
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        JOIN source_documents sd ON sd.id = fr.source_document_id
        JOIN institution_sources inst ON inst.id = fp.institution_id
       WHERE fp.rolled_back_at IS NULL
    ), retired AS MATERIALIZED (
      ${retiredCopiesSql(db)}
    ), stale AS MATERIALIZED (
      SELECT live.canonical_fee_key, live.amount, live.rate_percent, live.product_name, live.older_document_id,
             COALESCE(NULLIF(live.superseded_by_id, live.older_document_id), retired.current_document_id) AS current_document_id
        FROM live
        LEFT JOIN retired ON retired.older_document_id = live.older_document_id
       WHERE (live.superseded_by_id IS NOT NULL AND live.superseded_by_id <> live.older_document_id)
          OR (live.superseded_by_id IS NULL AND retired.current_document_id IS NOT NULL)
    ), pairs AS (
      SELECT s.older_document_id, s.current_document_id
        FROM stale s
       WHERE NOT EXISTS (
         SELECT 1 FROM raw_fee_observations nr
           JOIN verified_fee_observations nv ON nv.fee_raw_id = nr.fee_raw_id
          WHERE nr.source_document_id = s.current_document_id
            AND ${db.unsafe(productKeySql("nr.product_name"))} = ${db.unsafe(productKeySql("s.product_name"))}
            AND nv.canonical_fee_key = s.canonical_fee_key
            AND nv.amount IS NOT DISTINCT FROM s.amount
            AND nv.rate_percent IS NOT DISTINCT FROM s.rate_percent
            AND nv.review_status IN ('verified', 'approved')
       )
       GROUP BY 1, 2
    ), judged AS (
      SELECT EXISTS (
               SELECT 1 FROM pipeline_attempts pa
                WHERE pa.stage = 'publish'
                  AND pa.strategy = ${CURRENT_COPY_STRATEGY.strategy}
                  AND pa.source_document_id = p.older_document_id
                  AND pa.input_fingerprint = ${`v${CURRENT_COPY_STRATEGY.version}:`} || p.older_document_id::text || ':' || p.current_document_id::text
             ) AS done,
             EXISTS (SELECT 1 FROM agent_source_texts t WHERE t.source_document_id = p.current_document_id AND t.status = 'completed' AND t.normalized_text IS NOT NULL)
               AND EXISTS (SELECT 1 FROM agent_source_texts t WHERE t.source_document_id = p.older_document_id AND t.status = 'completed' AND t.normalized_text IS NOT NULL)
               AS has_text
        FROM pairs p
    )
    SELECT COUNT(*) AS pairs,
           COUNT(*) FILTER (WHERE done) AS done,
           COUNT(*) FILTER (WHERE NOT done AND has_text) AS queued,
           COUNT(*) FILTER (WHERE NOT done AND NOT has_text) AS no_text
      FROM judged
  `;
  const n = (value: unknown) => Number(value ?? 0);
  return { pairs: n(row?.pairs), done: n(row?.done), queued: n(row?.queued), noText: n(row?.no_text) };
}

/**
 * Runs the current-copy check for one publish step, after refresh-copy. A dry run reports
 * and writes nothing. Never blocks the step it runs in.
 */
export async function secondLookFeesNotOnCurrentCopy(
  db: SqlTag,
  options: {
    runId: number;
    batchId: string;
    dryRun: boolean;
    institutionId?: number;
    stateCode?: string | null;
    documentLimit?: number;
    confirmLive?: boolean;
  },
): Promise<CurrentCopyResult> {
  const confirmLive = options.confirmLive ?? CURRENT_COPY_CONFIRM_LIVE;
  const limit = options.documentLimit ?? CURRENT_COPY_DOCUMENT_LIMIT;
  const pendingPrefix = secondLookDedupeKey(CURRENT_COPY_CHECK, 0).replace(/0$/, "");
  let fees: CurrentCopyFeeRow[];
  let texts: Map<number, string>;
  try {
    fees = await inSavepoint(db, (scope) => scope<CurrentCopyFeeRow[]>`
      WITH live AS MATERIALIZED (
        SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fp.canonical_fee_key, fp.fee_name,
               fp.amount, fp.rate_percent, fr.product_name, fr.source_document_id AS older_document_id,
               sd.superseded_by_id, sd.companion_source_id, sd.document_url, inst.fee_schedule_url
          FROM published_fee_records fp
          JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
          JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
          JOIN source_documents sd ON sd.id = fr.source_document_id
          JOIN institution_sources inst ON inst.id = fp.institution_id
         WHERE fp.rolled_back_at IS NULL
           AND (${options.institutionId ?? null}::bigint IS NULL OR fp.institution_id = ${options.institutionId ?? null}::bigint)
           AND (${options.stateCode ?? null}::text IS NULL OR upper(btrim(inst.state_code)) = ${options.stateCode ?? null}::text)
      ), retired AS MATERIALIZED (
        ${retiredCopiesSql(scope)}
      ), stale AS MATERIALIZED (
        SELECT live.fee_published_id, live.fee_verified_id, live.institution_id, live.canonical_fee_key, live.fee_name,
               live.amount, live.rate_percent, live.product_name, live.older_document_id,
               COALESCE(NULLIF(live.superseded_by_id, live.older_document_id), retired.current_document_id) AS current_document_id,
               retired.current_document_id IS NOT NULL AND live.superseded_by_id IS NULL AS retired
          FROM live
          LEFT JOIN retired ON retired.older_document_id = live.older_document_id
         WHERE (live.superseded_by_id IS NOT NULL AND live.superseded_by_id <> live.older_document_id)
            OR (live.superseded_by_id IS NULL AND retired.current_document_id IS NOT NULL)
      ), marked AS MATERIALIZED (
        SELECT stale.*,
               EXISTS (
                 SELECT 1 FROM raw_fee_observations nr
                   JOIN verified_fee_observations nv ON nv.fee_raw_id = nr.fee_raw_id
                  WHERE nr.source_document_id = stale.current_document_id
                    AND ${scope.unsafe(productKeySql("nr.product_name"))} = ${scope.unsafe(productKeySql("stale.product_name"))}
                    AND nv.canonical_fee_key = stale.canonical_fee_key
                    AND nv.amount IS NOT DISTINCT FROM stale.amount
                    AND nv.rate_percent IS NOT DISTINCT FROM stale.rate_percent
                    AND nv.review_status IN ('verified', 'approved')
               ) AS restated_row
          FROM stale
      ), docs AS (
        SELECT DISTINCT m.older_document_id, m.current_document_id
          FROM marked m
         WHERE NOT m.restated_row
           AND EXISTS (SELECT 1 FROM agent_source_texts t WHERE t.source_document_id = m.current_document_id AND t.status = 'completed' AND t.normalized_text IS NOT NULL)
           AND EXISTS (SELECT 1 FROM agent_source_texts t WHERE t.source_document_id = m.older_document_id AND t.status = 'completed' AND t.normalized_text IS NOT NULL)
           AND NOT EXISTS (
             SELECT 1 FROM pipeline_attempts pa
              WHERE pa.stage = 'publish'
                AND pa.strategy = ${CURRENT_COPY_STRATEGY.strategy}
                AND pa.source_document_id = m.older_document_id
                AND pa.input_fingerprint = ${`v${CURRENT_COPY_STRATEGY.version}:`} || m.older_document_id::text || ':' || m.current_document_id::text
           )
           -- A copy with a first look younger than the second-look wait sits out until it is due.
           AND NOT EXISTS (
             SELECT 1 FROM marked other
               JOIN pipeline_feedback f ON f.dedupe_key = ${pendingPrefix} || other.fee_published_id::text
              WHERE other.older_document_id = m.older_document_id
                AND f.kind = 'takedown_pending'
                AND (f.evidence->>'flagged_at')::timestamptz > NOW() - make_interval(mins => ${SECOND_LOOK_MIN_MINUTES})
           )
         ORDER BY m.older_document_id
         LIMIT ${limit}
      )
      SELECT m.fee_published_id, m.fee_verified_id, m.institution_id, m.older_document_id, m.current_document_id,
             m.canonical_fee_key, m.fee_name, m.amount, m.product_name, m.restated_row, m.retired,
             older_doc.document_url AS older_url, current_doc.document_url AS current_url
        FROM marked m
        JOIN docs ON docs.older_document_id = m.older_document_id AND docs.current_document_id = m.current_document_id
        LEFT JOIN source_documents older_doc ON older_doc.id = m.older_document_id
        LEFT JOIN source_documents current_doc ON current_doc.id = m.current_document_id
       ORDER BY m.older_document_id, m.fee_published_id
    `);
    if (fees.length === 0) return { ...EMPTY, confirmLive };
    const ids = Array.from(new Set(fees.flatMap((fee) => [Number(fee.older_document_id), Number(fee.current_document_id)])));
    const rows = await inSavepoint(db, (scope) => scope<{ source_document_id: number | string; normalized_text: string }[]>`
      SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
        FROM agent_source_texts
       WHERE source_document_id = ANY(${ids}::bigint[])
         AND status = 'completed'
         AND normalized_text IS NOT NULL
       ORDER BY source_document_id, id DESC
    `);
    texts = new Map(rows.map((row) => [Number(row.source_document_id), row.normalized_text]));
  } catch (error) {
    console.error("secondLookFeesNotOnCurrentCopy read failed:", error);
    return { ...EMPTY, confirmLive };
  }

  const byDocument = new Map<number, CurrentCopyFeeRow[]>();
  for (const fee of fees) {
    const id = Number(fee.older_document_id);
    byDocument.set(id, [...(byDocument.get(id) ?? []), fee]);
  }
  const documents = [...byDocument.values()].map((group) =>
    judgeAgainstCurrentCopy(group, texts.get(Number(group[0].current_document_id)) ?? "", texts.get(Number(group[0].older_document_id)) ?? ""),
  );
  const failing = documents.flatMap((doc) => doc.failing);
  const passing = documents.flatMap((doc) => doc.passing);
  const look = await secondLook(db, {
    check: CURRENT_COPY_CHECK,
    runId: options.runId,
    failing,
    passing,
    unjudged: documents.flatMap((doc) => doc.notProven),
    dryRun: options.dryRun,
    minMinutes: confirmLive ? SECOND_LOOK_MIN_MINUTES : Number.POSITIVE_INFINITY,
  });
  const result: CurrentCopyResult = {
    documentsChecked: documents.length,
    unrecognized: documents.filter((doc) => !doc.recognized).length,
    stated: documents.reduce((total, doc) => total + doc.stated, 0),
    failing: failing.length,
    flagged: look.flagged,
    waiting: look.waiting,
    cleared: look.cleared,
    takenDown: look.confirmed,
    confirmLive,
    samples: failing.slice(0, 20),
    statedFeeIds: passing.slice(0, 200),
    copies: documents.map((doc) => ({ older: doc.olderDocumentId, current: doc.currentDocumentId, recognized: doc.recognized, retired: doc.retired })),
    retiredChecked: documents.filter((doc) => doc.retired).length,
    retiredFailing: documents.filter((doc) => doc.retired).reduce((total, doc) => total + doc.failing.length, 0),
  };
  if (options.dryRun) return result;

  try {
    await inSavepoint(db, async (scope) => {
      if (look.confirmed.length > 0) {
        const updated = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET rolled_back_at = NOW(),
                 rolled_back_by_batch_id = ${options.batchId},
                 rolled_back_reason = v.reason
            FROM unnest(${look.confirmed.map((fee) => fee.feePublishedId)}::bigint[], ${look.confirmed.map((fee) => fee.reason)}::text[])
                 AS v(fee_published_id, reason)
           WHERE fp.fee_published_id = v.fee_published_id
             AND fp.rolled_back_at IS NULL
          RETURNING fp.fee_published_id
        `;
        const closed = new Set(updated.map((row) => Number(row.fee_published_id)));
        result.takenDown = look.confirmed.filter((fee) => closed.has(fee.feePublishedId));
        if (result.takenDown.length > 0) {
          await scope`
            UPDATE verified_fee_observations fv
               SET review_status = 'rejected',
                   outlier_flags = CASE
                     WHEN fv.outlier_flags ? ${CURRENT_COPY_FLAG} THEN fv.outlier_flags
                     ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${CURRENT_COPY_FLAG}::text)
                   END
             WHERE fv.fee_verified_id = ANY(${result.takenDown.map((fee) => fee.feeVerifiedId)}::bigint[])
               AND fv.review_status IN ('verified', 'approved')
          `;
        }
      }
      for (const doc of documents) {
        // A copy with a fee still under suspicion is checked again when its second look is due.
        if (doc.failing.length > 0) continue;
        await recordAttempt(scope, {
          institutionId: doc.institutionId,
          sourceDocumentId: doc.olderDocumentId,
          stage: "publish",
          strategy: CURRENT_COPY_STRATEGY.strategy,
          version: CURRENT_COPY_STRATEGY.version,
          fingerprint: currentCopyFingerprint(doc.olderDocumentId, doc.currentDocumentId),
          outcome: doc.recognized ? "ok" : "wrong_document",
          yieldCount: doc.stated,
          costMicrousd: 0,
          runId: options.runId,
          foldIntoPlaybook: false,
          detail: {
            current_document_id: doc.currentDocumentId,
            recognized: doc.recognized,
            retired: doc.retired,
            stated: doc.stated,
            named: doc.named,
            dropped: doc.dropped,
            unproven: doc.unproven,
          },
        });
      }
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.current_copy_check', 'completed',
          ${`Checked ${result.documentsChecked} superseded or retired cop(ies) (${result.retiredChecked} retired) against the current copy: ${result.stated} fee(s) restated, ${result.failing} not restated at their price (${result.flagged} flagged for a second look, ${result.waiting} waiting, ${result.takenDown.length} archived${confirmLive ? "" : "; confirmations off until the hand check"}), ${result.cleared} cleared, ${result.unrecognized} current cop(ies) not recognizably the same schedule`},
          ${JSON.stringify({
            batch_id: options.batchId,
            confirm_live: confirmLive,
            documents_checked: result.documentsChecked,
            unrecognized: result.unrecognized,
            stated: result.stated,
            failing: result.failing,
            flagged: result.flagged,
            waiting: result.waiting,
            cleared: result.cleared,
            taken_down: result.takenDown.length,
            retired_checked: result.retiredChecked,
            retired_failing: result.retiredFailing,
            stated_fee_ids: result.statedFeeIds,
            copies: result.copies,
            samples: result.samples.map((fee) => ({
              fee_published_id: fee.feePublishedId,
              institution_id: fee.institutionId,
              older_document_id: fee.sourceDocumentId,
              current_document_id: fee.currentDocumentId,
              canonical_fee_key: fee.canonicalFeeKey,
              fee_name: fee.feeName,
              amount: fee.amount,
              verdict: fee.verdict,
            })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("secondLookFeesNotOnCurrentCopy write failed:", error);
    return { ...result, takenDown: [] };
  }
  if (result.takenDown.length > 0) invalidatePublicReadCache();
  return result;
}
