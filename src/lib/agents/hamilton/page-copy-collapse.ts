import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { frequencyClass } from "@/lib/agents/hamilton/exact-duplicate";
import { DUPLICATE_COLLAPSE_REASON_PREFIX, type DuplicateCollapse } from "@/lib/agents/hamilton/duplicate-collapse";
import { feePageKey } from "@/lib/agents/hamilton/page-key";
import { effectiveDate, scheduleAudience, type ScheduleAudience } from "@/lib/agents/hamilton/schedule-edition";
import { linesApartOnPage, nearNames, printedAtPrice, printedInPersonalAndBusinessSchedules } from "@/lib/agents/hamilton/publish";

type SqlTag = typeof sql;

/**
 * Page-copy collapse (#1439): one schedule stored under several addresses ("?print=1", "www.",
 * "%20", a CDN mirror) is several documents, and the near-name collapse, the exact collapse and
 * the newer-copy check each stay inside one document or one exact URL, so a line of that
 * schedule went live once per copy (1,310 extra live rows, Oct 15). Rows of one institution,
 * category, variant and amount read from different documents of one page (`feePageKey`) under
 * the same or a near name are one fee: the copy from the latest edition stays.
 *
 * Shadow until James approves the dry-run counts: a step reports what it would close and
 * changes nothing. Set true to close the repeats.
 */
export const PAGE_COPY_COLLAPSE_LIVE = false;
/** Institutions read per publish step; the step's run id picks which, so steps cover them in turn. */
export const PAGE_COPY_COLLAPSE_INSTITUTIONS = 25;
export const PAGE_COPY_COLLAPSE_REASON_SUFFIX = " (copy of the page)";

export interface PageCopyRow {
  fee_published_id: number | string;
  institution_id: number | string;
  source_document_id: number | string;
  document_url: string | null;
  /** When the document was last read or re-confirmed (`GREATEST(last_checked_at, crawled_at)`). */
  crawled_at: string | Date | null;
  /** True when a newer copy of the document replaced it (`superseded_by_id` set). */
  superseded?: boolean | null;
  canonical_fee_key: string;
  variant_type: string | null;
  amount: number | string;
  fee_name: string | null;
  frequency: string | null;
  fee_audience: string | null;
}

export interface PageCopyCollapse extends DuplicateCollapse {
  keptFeeName: string;
  sourceDocumentId: number;
  keptSourceDocumentId: number;
}

export interface PageCopyResult {
  live: boolean;
  institutions: number;
  /** Rows paired with a copy of the same line from another document of the same page. */
  pairs: number;
  /** Kept apart: the kept copy prints both names as their own lines at the price. */
  apartOnPage: number;
  /** Kept: the kept copy has no stored text, or does not print the kept name at the price. */
  unproven: number;
  /**
   * Kept: the two documents share a page key but not their prices ("?id=101" and "?id=202",
   * "/docs/2041.pdf" and "/docs/3315.pdf" key alike), name two audiences, or one has no stored text.
   */
  otherDocument: number;
  collapses: PageCopyCollapse[];
  /** Set when the read failed, so a failed step does not read as "nothing found". */
  error?: string;
}

function sameLine(a: string | null, b: string | null): boolean {
  const [one, two] = [(a ?? "").trim().toLowerCase(), (b ?? "").trim().toLowerCase()];
  return (one !== "" && one === two) || nearNames(a, b);
}

const SAME_SCHEDULE_OVERLAP = 0.8;
// "$ | 50.00": a two-column PDF read with the dollar sign in its own cell (Dutch Point).
const PRICE = /\$\s*(?:\|\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)?)(?:\.(\d{1,3}))?(?!\d)/g;

const BUSINESS_WORDS = /\b(?:business|commercial|corporate|treasury)\b/gi;
const CONSUMER_WORDS = /\b(?:consumer|personal|retail|individual)\b/gi;

/**
 * The audience a schedule is for: named in its address path, else the one its text keeps naming
 * (three or more mentions, three times the other's). A menu or footer link ("Personal | Business
 * Fees") adds a mention or two to each and decides nothing; null when neither dominates.
 */
function audienceOf(url: string | null, text: string): ScheduleAudience {
  // "PersonalFeeSchedule.pdf" names its audience once its words are split.
  // "?type=business" names it too: the query's words join the path's.
  const named = scheduleAudience(url?.replace(/([a-z])([A-Z])/g, "$1-$2").replace("?", "/"));
  if (named) return named;
  // "two business days" is a deadline, not an audience.
  const business = text.replace(/\bbusiness\s+days?\b/gi, "").match(BUSINESS_WORDS)?.length ?? 0;
  const consumer = text.match(CONSUMER_WORDS)?.length ?? 0;
  if (business >= 3 && business >= 3 * consumer) return "business";
  if (consumer >= 3 && consumer >= 3 * business) return "consumer";
  return null;
}

/**
 * The edition a copy states: the latest "effective" date in its text that is not after it was
 * read. A later date is a change the page announces ("new fees effective January 1, 2027"), so
 * the copy keeps the edition it states before it.
 */
function editionDate(text: string | undefined, read: number): number | null {
  if (!text) return null;
  let best: number | null = null;
  for (const m of text.matchAll(/effective/gi)) {
    const date = effectiveDate(text.slice(m.index, (m.index ?? 0) + 60));
    const time = date ? new Date(date).getTime() : NaN;
    if (Number.isFinite(time) && time <= read && (best == null || time > best)) best = time;
  }
  return best;
}

function prices(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(PRICE)) {
    if (!m[1] && !m[2]) continue;
    out.add(Number(`${m[1].replace(/,/g, "") || 0}.${m[2] ?? 0}`).toFixed(3));
  }
  return out;
}

/**
 * Pure: do two stored texts read as copies of one schedule? They print mostly the same prices:
 * the distinct dollar amounts of each overlap at 0.8 or more (Jaccard). Prices survive what
 * wording does not: a two-column PDF read in another order (Dutch Point), a rendered page against
 * its structured data (IBC). A fee-change letter stored under the schedule's address prints only
 * the changed prices (JDCU), and stays apart.
 */
export function sameScheduleText(one: string, two: string): boolean {
  return pricesOverlap(prices(one), prices(two));
}

function pricesOverlap(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const price of a) if (b.has(price)) shared += 1;
  return shared / (a.size + b.size - shared) >= SAME_SCHEDULE_OVERLAP;
}

/**
 * Pure: the live rows that repeat a line of another copy of their page (`feePageKey`: scheme,
 * "www.", query string, `%20` and version words ignored). The row kept is the one read from the
 * latest edition: the effective date its text states, else when it was read (Brazos Star's
 * January edition was read after its July one). The kept row must be printed at the price in its
 * document's stored text, and the two documents must print mostly the same prices
 * (`sameScheduleText`). A pair the kept text prints as two lines, or under both a personal and a
 * business heading, stays two fees, as do rows whose stated frequencies or audiences differ. Rows
 * of one document are left to the near-name collapse.
 */
export function pageCopyRepeats(rows: PageCopyRow[], texts: Map<string, string>): Omit<PageCopyResult, "live" | "institutions"> {
  const result = { pairs: 0, apartOnPage: 0, unproven: 0, otherDocument: 0, collapses: [] as PageCopyCollapse[] };
  const priceSets = new Map<string, Set<string>>();
  const priceSet = (id: string) => {
    if (!priceSets.has(id)) priceSets.set(id, prices(texts.get(id) ?? ""));
    return priceSets.get(id)!;
  };
  const same = new Map<string, boolean>();
  // Two documents are copies when both have text, they are not for two audiences (a consumer and
  // a business schedule from one template print mostly the same prices), and their prices match.
  const copies = (one: PageCopyRow, two: PageCopyRow) => {
    const [x, y] = [String(one.source_document_id), String(two.source_document_id)];
    const key = [x, y].sort().join("|");
    if (!same.has(key)) {
      const [a, b] = [texts.get(x), texts.get(y)];
      const [p, q] = a != null && b != null ? [audienceOf(one.document_url, a), audienceOf(two.document_url, b)] : [null, null];
      same.set(key, a != null && b != null && (p == null || q == null || p === q) && pricesOverlap(priceSet(x), priceSet(y)));
    }
    return same.get(key)!;
  };
  const groups = new Map<string, PageCopyRow[]>();
  for (const row of rows) {
    const page = feePageKey(row.document_url);
    if (page == null) continue;
    const key = [row.institution_id, page, row.canonical_fee_key, row.variant_type ?? "", String(Number(row.amount))].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  // The kept copy is a current one (not superseded), then the latest edition: by the editions the
  // texts state when every copy in the group states one, else by when each was last read or
  // re-confirmed; equal editions fall to the later read.
  const read = (row: PageCopyRow) => new Date(row.crawled_at ?? 0).getTime();
  const stated = new Map<string, number | null>();
  const statedDate = (row: PageCopyRow) => {
    const id = String(row.source_document_id);
    if (!stated.has(id)) stated.set(id, editionDate(texts.get(id), read(row)));
    return stated.get(id)!;
  };
  for (const group of groups.values()) {
    if (new Set(group.map((row) => String(row.source_document_id))).size < 2) continue;
    const byStated = group.every((row) => statedDate(row) != null);
    const time = (row: PageCopyRow) => (byStated ? statedDate(row)! : read(row));
    // A copy a newer one replaced (`superseded_by_id`) is never the one kept over a current copy.
    const ordered = [...group].sort((a, b) => Number(a.superseded ?? false) - Number(b.superseded ?? false) || time(b) - time(a) || read(b) - read(a) || Number(b.source_document_id) - Number(a.source_document_id) || Number(b.fee_published_id) - Number(a.fee_published_id));
    const kept: PageCopyRow[] = [];
    for (const row of ordered) {
      const match = kept.find((keep) => {
        if (String(keep.source_document_id) === String(row.source_document_id) || !sameLine(keep.fee_name, row.fee_name)) return false;
        const [f1, f2] = [frequencyClass(keep.frequency), frequencyClass(row.frequency)];
        const [a1, a2] = [keep.fee_audience ?? "unknown", row.fee_audience ?? "unknown"];
        return (f1 == null || f2 == null || f1 === f2) && (a1 === "unknown" || a2 === "unknown" || a1 === a2);
      });
      if (!match) {
        kept.push(row);
        continue;
      }
      result.pairs += 1;
      const text = texts.get(String(match.source_document_id)) ?? null;
      if (!text || !printedAtPrice(text, match.fee_name ?? "", match.amount)) {
        result.unproven += 1;
        kept.push(row);
      } else if (!copies(row, match)) {
        result.otherDocument += 1;
        kept.push(row);
      } else if (
        ((row.fee_name ?? "").trim().toLowerCase() !== (match.fee_name ?? "").trim().toLowerCase() &&
          linesApartOnPage(text, row.fee_name ?? "", match.fee_name ?? "", row.amount)) ||
        printedInPersonalAndBusinessSchedules(text, [row.fee_name ?? "", match.fee_name ?? ""], row.amount)
      ) {
        result.apartOnPage += 1;
        kept.push(row);
      } else {
        result.collapses.push({
          feePublishedId: Number(row.fee_published_id),
          keptFeePublishedId: Number(match.fee_published_id),
          institutionId: Number(row.institution_id),
          canonicalFeeKey: row.canonical_fee_key,
          feeName: row.fee_name ?? "",
          keptFeeName: match.fee_name ?? "",
          amount: Number(row.amount),
          sourceDocumentId: Number(row.source_document_id),
          keptSourceDocumentId: Number(match.source_document_id),
        });
      }
    }
  }
  return result;
}

/**
 * Close live rows that repeat a line of the latest edition of their page (`pageCopyRepeats`), up to
 * `PAGE_COPY_COLLAPSE_INSTITUTIONS` institutions per step. While `PAGE_COPY_COLLAPSE_LIVE` is
 * false, or in a dry run, it reports and writes nothing. A closed row gets `duplicate of #<kept
 * id> (copy of the page)`; clearing `rolled_back_at` restores it.
 */
export async function collapsePageCopies(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number; live?: boolean },
): Promise<PageCopyResult> {
  const live = options.live ?? PAGE_COPY_COLLAPSE_LIVE;
  const empty: PageCopyResult = { live, institutions: 0, pairs: 0, apartOnPage: 0, unproven: 0, otherDocument: 0, collapses: [] };
  const params: Array<number | string> = [PAGE_COPY_COLLAPSE_INSTITUTIONS, String(options.runId)];
  let institutionFilter = "";
  if (options.institutionId) {
    params.push(options.institutionId);
    institutionFilter = `AND fp.institution_id = $${params.length}`;
  }
  let rows: PageCopyRow[];
  let texts: Map<string, string>;
  try {
    ({ rows, texts } = await inSavepoint(db, async (scope) => {
      // Live dollar rows of one institution, category, variant and amount read from two or more documents.
      const found = await scope.unsafe<PageCopyRow[]>(
        `WITH live AS (
           SELECT fp.fee_published_id, fp.institution_id, fr.source_document_id, sd.document_url,
                  GREATEST(sd.last_checked_at, sd.crawled_at) AS crawled_at, sd.superseded_by_id IS NOT NULL AS superseded,
                  fp.canonical_fee_key, fp.variant_type, fp.amount, fp.fee_name, fp.frequency, fp.fee_audience
             FROM published_fee_records fp
             JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
             JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
             JOIN source_documents sd ON sd.id = fr.source_document_id
            WHERE fp.rolled_back_at IS NULL
              AND fp.quarantined_at IS NULL
              AND fp.amount IS NOT NULL
              AND fp.rate_percent IS NULL
              ${institutionFilter}
         ), lines AS (
           SELECT institution_id, canonical_fee_key, COALESCE(variant_type, '') AS variant, amount
             FROM live
            GROUP BY 1, 2, 3, 4
           HAVING count(DISTINCT source_document_id) > 1
         ), picked AS (
           SELECT institution_id
             FROM (SELECT DISTINCT institution_id FROM lines) institutions
            ORDER BY md5(institution_id::text || $2)
            LIMIT $1
         )
         SELECT live.*
           FROM live
           JOIN lines ON lines.institution_id = live.institution_id
                     AND lines.canonical_fee_key = live.canonical_fee_key
                     AND lines.variant = COALESCE(live.variant_type, '')
                     AND lines.amount = live.amount
           JOIN picked ON picked.institution_id = live.institution_id`,
        params,
      );
      const documentIds = [...new Set(found.map((row) => Number(row.source_document_id)))];
      const stored = documentIds.length === 0 ? [] : await scope<{ source_document_id: number | string; normalized_text: string }[]>`
        SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
          FROM agent_source_texts
         WHERE source_document_id = ANY(${documentIds}::bigint[]) AND normalized_text IS NOT NULL
         ORDER BY source_document_id, id DESC
      `;
      return { rows: found, texts: new Map(stored.map((row) => [String(row.source_document_id), row.normalized_text])) };
    }));
  } catch (error) {
    console.error("collapsePageCopies failed:", error);
    return { ...empty, error: error instanceof Error ? error.message : String(error) };
  }

  const found = pageCopyRepeats(rows, texts);
  const result: PageCopyResult = { live, institutions: new Set(rows.map((row) => String(row.institution_id))).size, ...found };
  if (!live || options.dryRun || found.collapses.length === 0) return result;

  try {
    const closed = await inSavepoint(db, (scope) => scope<{ fee_published_id: number | string }[]>`
      UPDATE published_fee_records fp
         SET rolled_back_at = NOW(),
             rolled_back_by_batch_id = ${options.batchId},
             rolled_back_reason = ${DUPLICATE_COLLAPSE_REASON_PREFIX} || pick.kept::text || ${PAGE_COPY_COLLAPSE_REASON_SUFFIX}
        FROM unnest(${found.collapses.map((row) => row.feePublishedId)}::bigint[], ${found.collapses.map((row) => row.keptFeePublishedId)}::bigint[]) AS pick(id, kept)
       WHERE fp.fee_published_id = pick.id AND fp.rolled_back_at IS NULL
      RETURNING fp.fee_published_id
    `);
    const ids = new Set(closed.map((row) => Number(row.fee_published_id)));
    result.collapses = found.collapses.filter((row) => ids.has(row.feePublishedId));
  } catch (error) {
    console.error("page-copy collapse failed:", error);
    return { ...result, collapses: [] };
  }
  if (result.collapses.length > 0) {
    invalidatePublicReadCache();
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.page_copy_duplicates_collapsed', 'completed',
          ${`Closed ${result.collapses.length} published fee(s) that repeated a line of the latest edition of their page`},
          ${JSON.stringify({ batch_id: options.batchId, collapsed: result.collapses.length, samples: result.collapses.slice(0, 20) })}::jsonb
        )
      `);
    } catch (error) {
      console.error("page-copy collapse event failed:", error);
    }
  }
  return result;
}
