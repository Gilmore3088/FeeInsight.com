import type { sql } from "@/lib/data-store/connection";
import { HAMILTON_PUBLISH_STRATEGY, normalizedFeeName } from "@/lib/agents/hamilton/publish";
import { editionAudience } from "@/lib/agents/hamilton/schedule-edition";
import { isProductPageUrl } from "@/lib/agents/learning/fee-page";
import { STATED_DATE_VERSION, TEXT_STATED_BASES } from "@/lib/agents/magellan/stated-date";

type SqlTag = typeof sql;

/**
 * #1945, Hamilton V5 R5: for one institution, audience and fee, at most one edition of the bank's
 * schedule is live, the latest one in force today, whatever its address and whenever it was read.
 *
 * Cedar Falls Community CU (7833) links its "Revised 03/2026" schedule (doc 31873, first read Oct 13)
 * from its homepage, but 21 live fees still came from its "Revised: 4/30/2024" schedule (doc 2671).
 * The heading rule (`editionTakesOver`) needs both headings to state an "Effective" date and the
 * newer copy read before that date, an edition announced ahead. Cedar's 2024 PDF prints
 * "Eff ective: 5/1/2024" (a broken ligature), the 2026 one prints only "Revised 03/2026" at its foot,
 * and it was read seven months after it took effect. Publish then skipped 15 of the 2026 lines as
 * "Identical fee already published" behind the 2024 ones, so the old document stayed the cited
 * source, and a price the bank changes in its next edition would sit live beside the new one.
 *
 * This rule dates each document by the date its own text states, as Magellan stores it
 * (`source_documents.stated_date`, `stated-date.ts`: an "Effective" date or a printed "Revised",
 * "Updated" or "current as of" date, never the address's year). The older document's line of a fee
 * comes down as `older_edition: #<newer doc> dated <date>` when (`datedEditionTakesOver`):
 *   - both documents state their date in their text, the newer date is later and in force today;
 *   - both name the same audience (business, consumer, or neither);
 *   - neither address is one account's or product's page (a money market, HSA or premium account
 *     schedule, a checking page): one bank's product schedules are not editions of each other
 *     (Oct 25 dry run: a bank's HSA, money market and premium account schedules, and KCB's money
 *     market and savings disclosures beside its fee page, all paired without this);
 *   - the two documents are one schedule: at least `EDITION_SHARED_NAMES` of the larger one's fee
 *     names (verified rows, as Knox names them) are on both, and at least `EDITION_MIN_SHARED`
 *     (Cedar 13 of 23; the HSA and money market schedules shared 8 of 13 and are stopped by the
 *     address rule; a 5-line account services sheet shared 1 of 38 with the fee page);
 *   - the newer document states the same fee line: same category, name (`normalizedFeeName`) and
 *     audience (or one side's audience not known, `sameAudience`), either live or skipped at publish
 *     as identical to this very line. A fee only the
 *     older edition lists (renamed, dropped or unread) is left live: a newer date alone never
 *     takes a line down.
 * The older verified row is rejected with the `older_edition` flag (as the heading rule does), and
 * Hamilton's publish selects the newer copy skipped behind it again (`OLDER_EDITION_RESELECT_SQL`,
 * only a row of the document the reason names), so the fee stays live from the current schedule.
 */
export const EDITION_SHARED_NAMES = 0.5;
export const EDITION_MIN_SHARED = 3;
/**
 * On by the sampled-clean rule (DECISIONS 2026-10-20). Off, Darwin's edition step reports what it
 * would retire (`would_retire_dated_edition`) and writes nothing for it.
 */
export const DATED_EDITION_TAKEOVER_LIVE = true;

/** Words in an address that name one account or product, not the bank's whole schedule. */
const ONE_PRODUCT =
  /\b(?:checking|savings|money market|hsa|health savings|ira|certificates?|premium|student|youth|teen|senior|kids|club|rewards|safe debit|prepaid|simple)\b/;

/** True when the address names one account or product (`ONE_PRODUCT`, or a product area: `isProductPageUrl`). Pure. */
export function namesOneProduct(url: string | null | undefined): boolean {
  if (!url) return false;
  if (isProductPageUrl(url)) return true;
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    path = url;
  }
  const words = ` ${path.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z]+/g, " ")} `;
  return ONE_PRODUCT.test(words);
}

export interface DatedDocument {
  url: string | null | undefined;
  /** The date the document's text states, YYYY-MM-DD. */
  statedDate: string | null | undefined;
  /** How it was read (`StatedDateBasis`); only a text-stated one counts. */
  statedBasis: string | null | undefined;
  /** The fee names its verified rows carry, normalized (`normalizedFeeName`). */
  names: ReadonlySet<string>;
}

/** True when the two documents' fee names make them one schedule (see the module note). Pure. */
export function oneSchedule(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  const larger = Math.max(a.size, b.size);
  if (larger === 0) return false;
  let shared = 0;
  for (const name of a) if (b.has(name)) shared += 1;
  return shared >= EDITION_MIN_SHARED && shared / larger >= EDITION_SHARED_NAMES;
}

/** True when `newer` is a later edition of `older`'s schedule, in force on `today` (see the module note). Pure. */
export function datedEditionTakesOver(older: DatedDocument, newer: DatedDocument, today: string): boolean {
  if (!older.url || !newer.url || !older.statedDate || !newer.statedDate) return false;
  if (!TEXT_STATED_BASES.has(older.statedBasis ?? "") || !TEXT_STATED_BASES.has(newer.statedBasis ?? "")) return false;
  if (!(older.statedDate < newer.statedDate && newer.statedDate <= today)) return false;
  if (editionAudience(older.url) !== editionAudience(newer.url)) return false;
  if (namesOneProduct(older.url) || namesOneProduct(newer.url)) return false;
  return oneSchedule(older.names, newer.names);
}

/** One verified row of a text-dated document at a bank with another such document live. */
export interface DatedEditionRow {
  fee_verified_id: number | string;
  /** Its live published record; null when it has none. */
  fee_published_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  fee_audience: string | null;
  source_document_id: number | string;
  document_url: string | null;
  stated_date: string | null;
  stated_date_basis: string | null;
  /** Not live: the live record its last publish attempt skipped it behind as identical. */
  behind_fee_published_id: number | string | null;
}

export interface DatedTakeover {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string | null;
  sourceDocumentId: number;
  reason: string;
}

function lineKey(row: DatedEditionRow): string {
  return [row.institution_id, row.canonical_fee_key ?? "", normalizedFeeName(row.fee_name)].join("|");
}

/**
 * The same audience, or one side not known. A copy skipped at publish keeps the verified row's
 * audience, often "unknown" until publish reads it (Cedar's 2026 lines), while the live line it
 * sat behind says "consumer"; a consumer line is never paired with a business one.
 */
function sameAudience(a: DatedEditionRow, b: DatedEditionRow): boolean {
  const known = (value: string | null) => (value && value !== "unknown" ? value : null);
  const left = known(a.fee_audience);
  const right = known(b.fee_audience);
  return left == null || right == null || left === right;
}

/**
 * Pure: the live lines a later dated edition of the same schedule takes over on `today` (see the
 * module note). `skip` holds live records another rule already acts on this step.
 */
export function judgeDatedEditions(rows: DatedEditionRow[], today: string, skip: ReadonlySet<number> = new Set()): DatedTakeover[] {
  const documents = new Map<string, DatedDocument>();
  for (const row of rows) {
    const id = String(row.source_document_id);
    const doc = documents.get(id) ?? { url: row.document_url, statedDate: row.stated_date, statedBasis: row.stated_date_basis, names: new Set<string>() };
    (doc.names as Set<string>).add(normalizedFeeName(row.fee_name));
    documents.set(id, doc);
  }
  const live = rows.filter((row) => row.fee_published_id != null);
  const partners = new Map<string, DatedEditionRow[]>();
  for (const row of live) partners.set(lineKey(row), [...(partners.get(lineKey(row)) ?? []), row]);
  const waiting = new Map<string, DatedEditionRow[]>();
  for (const row of rows) {
    if (row.fee_published_id != null || row.behind_fee_published_id == null) continue;
    const behind = String(row.behind_fee_published_id);
    waiting.set(behind, [...(waiting.get(behind) ?? []), row]);
  }
  const takeovers: DatedTakeover[] = [];
  for (const older of live) {
    const id = Number(older.fee_published_id);
    if (skip.has(id)) continue;
    const olderDoc = documents.get(String(older.source_document_id))!;
    const key = lineKey(older);
    const candidates = [
      ...(partners.get(key) ?? []),
      ...(waiting.get(String(older.fee_published_id)) ?? []).filter((row) => lineKey(row) === key),
    ];
    const newer = candidates.find((row) =>
      String(row.source_document_id) !== String(older.source_document_id) &&
      sameAudience(older, row) &&
      datedEditionTakesOver(olderDoc, documents.get(String(row.source_document_id))!, today));
    if (!newer) continue;
    takeovers.push({
      feePublishedId: id,
      feeVerifiedId: Number(older.fee_verified_id),
      institutionId: Number(older.institution_id),
      feeName: older.fee_name ?? "",
      amount: older.amount == null ? null : Number(older.amount),
      canonicalFeeKey: older.canonical_fee_key,
      sourceDocumentId: Number(older.source_document_id),
      reason: `older_edition: #${newer.source_document_id} dated ${newer.stated_date}`,
    });
  }
  return takeovers;
}

/**
 * Read-only: verified rows of every document whose text states a date in force by `today`, at banks
 * where another such document has a live fee, each with its live record or the live record its last
 * publish attempt skipped it behind. Prod, Oct 25: 701 dated documents, 124 paired, about 2.7 s.
 * Before Magellan's stated-date columns exist, callers skip it (`statedDateColumnsReady`).
 */
export function datedEditionRowsSql(db: SqlTag, options: { institutionId?: number; today: string }) {
  const scoped = options.institutionId != null;
  return db<DatedEditionRow[]>`
    WITH dated AS MATERIALIZED (
      SELECT sd.id, sd.institution_id, btrim(sd.document_url) AS document_url,
             to_char(sd.stated_date, 'YYYY-MM-DD') AS stated_date, sd.stated_date_basis
        FROM source_documents sd
       WHERE sd.stated_date_version = ${STATED_DATE_VERSION}
         AND sd.stated_date_basis = ANY(${[...TEXT_STATED_BASES]}::text[])
         AND sd.stated_date <= ${options.today}::date
         AND (${!scoped} OR sd.institution_id = ${options.institutionId ?? 0})
    ),
    rows AS MATERIALIZED (
      SELECT fv.fee_verified_id, own.fee_published_id, d.institution_id,
             COALESCE(own.fee_name, fv.fee_name) AS fee_name, COALESCE(own.amount, fv.amount) AS amount,
             COALESCE(own.canonical_fee_key, fv.canonical_fee_key) AS canonical_fee_key,
             COALESCE(own.fee_audience, fv.fee_audience) AS fee_audience,
             d.id AS source_document_id, d.document_url, d.stated_date, d.stated_date_basis
        FROM dated d
        JOIN raw_fee_observations fr ON fr.source_document_id = d.id
        JOIN verified_fee_observations fv ON fv.fee_raw_id = fr.fee_raw_id
        LEFT JOIN LATERAL (
          SELECT fp.fee_published_id, fp.fee_name, fp.amount, fp.canonical_fee_key, fp.fee_audience
            FROM published_fee_records fp
           WHERE fp.lineage_ref = fv.fee_verified_id AND fp.rolled_back_at IS NULL AND fp.quarantined_at IS NULL
           ORDER BY fp.fee_published_id DESC
           LIMIT 1
        ) own ON TRUE
       WHERE fv.review_status IN ('verified', 'approved')
    ),
    paired AS MATERIALIZED (
      SELECT DISTINCT r.source_document_id FROM rows r
       WHERE EXISTS (
         SELECT 1 FROM rows o
          WHERE o.fee_published_id IS NOT NULL AND o.institution_id = r.institution_id AND o.source_document_id <> r.source_document_id
       )
    )
    SELECT r.*, behind.fee_published_id AS behind_fee_published_id
      FROM rows r
      LEFT JOIN LATERAL (
        SELECT b.fee_published_id
          FROM (
            SELECT pa.outcome, NULLIF(pa.detail->>'previous_fee_published_id', '')::bigint AS prev
              FROM pipeline_attempts pa
             WHERE pa.input_fingerprint = 'verified:' || r.fee_verified_id::text
               AND pa.strategy = ${HAMILTON_PUBLISH_STRATEGY.strategy}
               AND pa.strategy_version = ${HAMILTON_PUBLISH_STRATEGY.version}
             ORDER BY pa.id DESC
             LIMIT 1
          ) last
          JOIN published_fee_records b ON b.fee_published_id = last.prev AND b.rolled_back_at IS NULL AND b.quarantined_at IS NULL
         WHERE last.outcome = 'unchanged' AND r.fee_published_id IS NULL
      ) behind ON TRUE
     WHERE r.source_document_id IN (SELECT source_document_id FROM paired)
     ORDER BY r.source_document_id, r.fee_verified_id
  `;
}
