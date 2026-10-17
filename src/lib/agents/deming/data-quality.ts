import { sql } from "@/lib/data-store/connection";
import { FEE_FAMILIES } from "@/lib/fee-taxonomy";
import { BENCHMARK_SHOW_FROM, COLLAPSE_KEEPS_BELOW } from "@/lib/agents/deming/benchmark-health";
import { inSavepoint } from "@/lib/agents/savepoint";
import { documentLinkKeySql } from "@/lib/document-link-key";

export { documentLinkKey, documentLinkKeySql } from "@/lib/document-link-key";

/**
 * Deming's daily data-quality checks (#1065): the SQL checks the `data-quality-audit` and
 * `audit-data` skills describe, run every day in Atlas's scoreboard run instead of on request.
 * Read-only and deterministic; no model calls. The sampled source trace is `fresh-audit.ts`.
 *
 * Each check runs over the live dollar fees (`published_fee_catalog`) and, apart, over the live
 * rate fees (`published_fee_rate_catalog`); a rate is never pooled with a dollar amount
 * (`percent-fees.ts`). Each number names its query (`DATA_QUALITY_QUERIES`).
 *
 *   duplicates     rows beyond the first for the same institution, category and amount (or rate)
 *   stale          live fees whose document was last fetched or checked over 90 days ago (the
 *                  scoreboard's freshness clock)
 *   no category    live fees with no category; a category outside the 50-type taxonomy is
 *                  counted beside it, not graded
 *   no source      live fees with no source link; no stored document is counted beside it
 *   link mismatch  live fees whose link opens a different page from their stored document's URL
 *                  (#1347), counted, not graded. Two links to one page are not a mismatch: the
 *                  scheme, "www.", case, a default port (":443"), a space written "%20", a
 *                  trailing slash, a fragment and print or tracking parameters ("?print=1",
 *                  "utm_*") are set aside (`documentLinkKey`); those are counted apart as URL
 *                  variants. A link to the page the document's stored text was read from (a
 *                  schedule PDF linked from the stored landing page, or a redirect's target) is
 *                  the fee's real source, not a mismatch; it is counted apart as `read_page`
 *   category share each category's share of live institutions against its median over the
 *                  previous checks: an alarm when it falls below 70% of that or rises above 150%
 *
 * Thresholds are the skills' own (PASS / WARN / FAIL): duplicates 1% / 3%, uncategorized
 * 3% / 8%, stale 15% / 30%. The skills give none for a missing source link; it takes the
 * duplicate thresholds. A check at FAIL is named as an ALARM in the step summary, as the
 * benchmark health check does.
 */

type SqlTag = typeof sql;

export const DATA_QUALITY_VERSION = 1;
/** A live fee is stale when its document was last fetched or checked longer ago than this. */
export const STALE_AFTER_DAYS = 90;
/** A catalog with fewer live fees than this reports its counts but is not graded. */
export const DATA_QUALITY_MIN_FEES = 100;
/** Previous checks a category's normal share is the median of. */
export const SHARE_BASELINE_CHECKS = 7;
/** A category's share is out of line above this multiple of its normal share. */
export const SHARE_RISES_ABOVE = 1.5;
/** Up to this many examples per check in the step detail. */
export const DATA_QUALITY_SAMPLE = 20;

export const DATA_QUALITY_QUERIES = {
  duplicates: "deming.dq_duplicates",
  stale: "deming.dq_stale_fees",
  noCategory: "deming.dq_no_category",
  noSource: "deming.dq_no_source",
  categoryShare: "deming.dq_category_share",
} as const;

export type GradedCheck = "duplicates" | "stale" | "noCategory" | "noSource";
export type CheckStatus = "pass" | "warn" | "fail" | "too_few" | "no_baseline";
export type Catalog = "dollar" | "rate";

/** PASS below `warn`, WARN up to `fail`, FAIL above it (shares of live fees). */
export const DATA_QUALITY_THRESHOLDS: Record<GradedCheck, { warn: number; fail: number }> = {
  duplicates: { warn: 0.01, fail: 0.03 },
  stale: { warn: 0.15, fail: 0.3 },
  noCategory: { warn: 0.03, fail: 0.08 },
  noSource: { warn: 0.01, fail: 0.03 },
};

const TAXONOMY_KEYS: string[] = Object.values(FEE_FAMILIES).flat();

export interface CatalogCounts {
  liveFees: number;
  institutions: number;
  duplicates: number;
  stale: number;
  noCategory: number;
  /** A category not in the 50-type taxonomy (counted, not graded). */
  offTaxonomy: number;
  noSource: number;
  /** No stored source document (counted, not graded). */
  noDocument: number;
  /** #1347: the link opens another page than the fee's own document (counted, not graded). */
  linkMismatch: number;
  /** #1347: the link differs from the document's URL only in how the same page is written. */
  linkUrlVariant: number;
  /** #1347: the link is the page the document's stored text was read from, not the document's own URL. */
  linkReadPage: number;
  linkMismatchSample: number[];
  samples: Record<GradedCheck, number[]>;
  /** Institutions with a live fee per category. */
  categories: Array<{ category: string; institutions: number }>;
}

export interface GradedResult {
  query: string;
  count: number;
  rate: number | null;
  status: CheckStatus;
}

export interface ShareDrift {
  category: string;
  normalShare: number;
  share: number;
  institutions: number;
  direction: "down" | "up";
}

export interface CategoryShareResult {
  query: string;
  status: CheckStatus;
  /** Previous checks the normal share came from. */
  baselineChecks: number;
  drifts: ShareDrift[];
  shares: Array<{ category: string; institutions: number; share: number }>;
}

export interface CatalogQuality {
  catalog: Catalog;
  liveFees: number;
  institutions: number;
  checks: Record<GradedCheck, GradedResult>;
  offTaxonomy: number;
  noDocument: number;
  linkMismatch: number;
  linkUrlVariant: number;
  linkReadPage: number;
  linkMismatchSample: number[];
  samples: Record<GradedCheck, number[]>;
  categoryShare: CategoryShareResult;
}

export interface DataQualityResult {
  version: number;
  dollar: CatalogQuality;
  rate: CatalogQuality;
  /** Checks at FAIL, as "catalog.check": the alarm. */
  failing: string[];
  warning: string[];
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}

/** Pure: a check's status from its count against its thresholds. */
export function gradeCheck(check: GradedCheck, count: number, liveFees: number): GradedResult {
  const rate = ratio(count, liveFees);
  const { warn, fail } = DATA_QUALITY_THRESHOLDS[check];
  const status: CheckStatus = liveFees < DATA_QUALITY_MIN_FEES || rate == null ? "too_few"
    : rate > fail ? "fail"
    : rate >= warn ? "warn" : "pass";
  return { query: DATA_QUALITY_QUERIES[check], count, rate, status };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Pure: each category's share of live institutions against its median share over `history`
 * (previous checks, any order). Only categories with BENCHMARK_SHOW_FROM institutions in a
 * previous check are judged; a category gone today counts as a share of 0.
 */
export function categoryShares(
  now: { institutions: number; categories: Array<{ category: string; institutions: number }> },
  history: Array<{ institutions: number; categories: Array<{ category: string; institutions: number }> }>,
): CategoryShareResult {
  const shares = now.categories
    .map((row) => ({ category: row.category, institutions: row.institutions, share: ratio(row.institutions, now.institutions) ?? 0 }))
    .sort((a, b) => b.institutions - a.institutions || a.category.localeCompare(b.category));
  const usable = history.filter((check) => check.institutions > 0);
  if (usable.length === 0 || now.institutions < BENCHMARK_SHOW_FROM) {
    return { query: DATA_QUALITY_QUERIES.categoryShare, status: usable.length === 0 ? "no_baseline" : "too_few", baselineChecks: usable.length, drifts: [], shares };
  }
  const current = new Map(shares.map((row) => [row.category, row]));
  const past = new Map<string, number[]>();
  const judged = new Set<string>();
  for (const check of usable) {
    for (const row of check.categories) {
      const list = past.get(row.category) ?? [];
      list.push(row.institutions / check.institutions);
      past.set(row.category, list);
      if (row.institutions >= BENCHMARK_SHOW_FROM) judged.add(row.category);
    }
  }
  const drifts: ShareDrift[] = [];
  for (const category of judged) {
    // A check where the category was absent counts as a share of 0 there.
    const values = [...(past.get(category) ?? []), ...Array(usable.length - (past.get(category)?.length ?? 0)).fill(0)];
    const normalShare = median(values) ?? 0;
    if (normalShare <= 0) continue;
    const today = current.get(category);
    const share = today?.share ?? 0;
    const direction = share < normalShare * COLLAPSE_KEEPS_BELOW ? "down" : share > normalShare * SHARE_RISES_ABOVE ? "up" : null;
    if (direction) {
      drifts.push({ category, normalShare: Math.round(normalShare * 10_000) / 10_000, share, institutions: today?.institutions ?? 0, direction });
    }
  }
  drifts.sort((a, b) => b.normalShare - a.normalShare || a.category.localeCompare(b.category));
  // A share that falls is lost data and fails; one that rises is usually coverage growth or a
  // fold rule landing, so it is a warning to watch, not an alarm (#1579).
  const status: CheckStatus = drifts.some((drift) => drift.direction === "down") ? "fail" : drifts.length > 0 ? "warn" : "pass";
  return { query: DATA_QUALITY_QUERIES.categoryShare, status, baselineChecks: usable.length, drifts, shares };
}

/** Pure: one catalog's counts into graded checks and its category shares. */
export function catalogQuality(catalog: Catalog, counts: CatalogCounts, history: Array<{ institutions: number; categories: Array<{ category: string; institutions: number }> }>): CatalogQuality {
  return {
    catalog,
    liveFees: counts.liveFees,
    institutions: counts.institutions,
    checks: {
      duplicates: gradeCheck("duplicates", counts.duplicates, counts.liveFees),
      stale: gradeCheck("stale", counts.stale, counts.liveFees),
      noCategory: gradeCheck("noCategory", counts.noCategory, counts.liveFees),
      noSource: gradeCheck("noSource", counts.noSource, counts.liveFees),
    },
    offTaxonomy: counts.offTaxonomy,
    noDocument: counts.noDocument,
    linkMismatch: counts.linkMismatch,
    linkUrlVariant: counts.linkUrlVariant,
    linkReadPage: counts.linkReadPage,
    linkMismatchSample: counts.linkMismatchSample,
    samples: counts.samples,
    categoryShare: categoryShares(counts, history),
  };
}

const GRADED: GradedCheck[] = ["duplicates", "stale", "noCategory", "noSource"];

/** Pure: the checks at FAIL and at WARN, as "catalog.check". */
export function alarms(catalogs: CatalogQuality[]): { failing: string[]; warning: string[] } {
  const failing: string[] = [];
  const warning: string[] = [];
  for (const quality of catalogs) {
    for (const check of GRADED) {
      const status = quality.checks[check].status;
      if (status === "fail") failing.push(`${quality.catalog}.${check}`);
      if (status === "warn") warning.push(`${quality.catalog}.${check}`);
    }
    if (quality.categoryShare.status === "fail") failing.push(`${quality.catalog}.categoryShare`);
    if (quality.categoryShare.status === "warn") warning.push(`${quality.catalog}.categoryShare`);
  }
  return { failing, warning };
}

/**
 * The check's one read per catalog. `catalog` is one of the two view names, never user input;
 * `amountColumn` is `amount` for dollar fees and `rate_percent` for rate fees.
 * $1 the stale age in days, $2 the taxonomy keys, $3 the sample size. Exported for the SQL test.
 */
export function dataQualitySql(catalog: "published_fee_catalog" | "published_fee_rate_catalog"): string {
  const amountColumn = catalog === "published_fee_catalog" ? "amount" : "rate_percent";
  return `
      WITH live AS (
        SELECT c.fee_published_id, c.institution_id, NULLIF(btrim(c.fee_category), '') AS category, c.${amountColumn} AS value,
               NULLIF(btrim(c.source_url), '') AS source_url, c.source_document_id,
               NULLIF(btrim(sd.document_url), '') AS document_url,
               -- #1347: the page the document's stored text was read from (one text per document).
               NULLIF(btrim(ast.source_url), '') AS read_url,
               COALESCE(sd.last_checked_at, sd.crawled_at, c.created_at) AS evidence_at,
               row_number() OVER (
                 PARTITION BY c.institution_id, NULLIF(btrim(c.fee_category), ''), c.${amountColumn}
                 ORDER BY c.fee_published_id
               ) AS copy
          FROM ${catalog} c
          LEFT JOIN source_documents sd ON sd.id = c.source_document_id
          LEFT JOIN agent_source_texts ast ON ast.source_document_id = c.source_document_id
      ), keyed AS (
        SELECT live.*, ${documentLinkKeySql("source_url")} AS link_key, ${documentLinkKeySql("document_url")} AS document_key,
               ${documentLinkKeySql("read_url")} AS read_key
          FROM live
      ), flags AS (
        SELECT fee_published_id, institution_id, category, source_document_id,
               (copy > 1 AND category IS NOT NULL AND value IS NOT NULL) AS duplicate,
               (evidence_at < NOW() - make_interval(days => $1::int)) AS stale,
               (category IS NULL) AS no_category,
               (category IS NOT NULL AND NOT (category = ANY($2::text[]))) AS off_taxonomy,
               (source_url IS NULL) AS no_source,
               -- #1347: the link and the document's URL, each as the page they open. A link to the
               -- page the document's text was read from is the fee's real source (read_page).
               (source_url IS NOT NULL AND document_url IS NOT NULL AND link_key <> document_key
                 AND read_key IS DISTINCT FROM link_key) AS link_mismatch,
               (source_url IS NOT NULL AND document_url IS NOT NULL AND source_url <> document_url
                 AND link_key = document_key) AS link_url_variant,
               (source_url IS NOT NULL AND document_url IS NOT NULL AND link_key <> document_key
                 AND read_key = link_key) AS link_read_page
          FROM keyed
      )
      SELECT COUNT(*)::int AS live_fees,
             COUNT(DISTINCT institution_id)::int AS institutions,
             (COUNT(*) FILTER (WHERE duplicate))::int AS duplicates,
             (COUNT(*) FILTER (WHERE stale))::int AS stale,
             (COUNT(*) FILTER (WHERE no_category))::int AS no_category,
             (COUNT(*) FILTER (WHERE off_taxonomy))::int AS off_taxonomy,
             (COUNT(*) FILTER (WHERE no_source))::int AS no_source,
             (COUNT(*) FILTER (WHERE source_document_id IS NULL))::int AS no_document,
             (COUNT(*) FILTER (WHERE link_mismatch))::int AS link_mismatch,
             (COUNT(*) FILTER (WHERE link_url_variant))::int AS link_url_variant,
             (COUNT(*) FILTER (WHERE link_read_page))::int AS link_read_page,
             (array_agg(fee_published_id ORDER BY fee_published_id) FILTER (WHERE link_mismatch))[1:$3] AS link_mismatch_sample,
             (array_agg(fee_published_id ORDER BY fee_published_id) FILTER (WHERE duplicate))[1:$3] AS duplicates_sample,
             (array_agg(fee_published_id ORDER BY fee_published_id) FILTER (WHERE stale))[1:$3] AS stale_sample,
             (array_agg(fee_published_id ORDER BY fee_published_id) FILTER (WHERE no_category))[1:$3] AS no_category_sample,
             (array_agg(fee_published_id ORDER BY fee_published_id) FILTER (WHERE no_source))[1:$3] AS no_source_sample,
             (SELECT COALESCE(jsonb_agg(jsonb_build_object('category', category, 'institutions', institutions)), '[]'::jsonb)
                FROM (SELECT category, COUNT(DISTINCT institution_id)::int AS institutions
                        FROM flags WHERE category IS NOT NULL GROUP BY category) per_category) AS categories
        FROM flags
    `;
}

type CountsRow = Record<string, unknown>;

function countsFrom(row: CountsRow | undefined): CatalogCounts {
  const num = (key: string) => Number(row?.[key] ?? 0);
  const sample = (key: string): number[] => (Array.isArray(row?.[key]) ? (row[key] as unknown[]).map(Number).filter(Number.isFinite) : []);
  const raw = row?.categories;
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return {
    liveFees: num("live_fees"),
    institutions: num("institutions"),
    duplicates: num("duplicates"),
    stale: num("stale"),
    noCategory: num("no_category"),
    offTaxonomy: num("off_taxonomy"),
    noSource: num("no_source"),
    noDocument: num("no_document"),
    linkMismatch: num("link_mismatch"),
    linkUrlVariant: num("link_url_variant"),
    linkReadPage: num("link_read_page"),
    linkMismatchSample: sample("link_mismatch_sample"),
    samples: {
      duplicates: sample("duplicates_sample"),
      stale: sample("stale_sample"),
      noCategory: sample("no_category_sample"),
      noSource: sample("no_source_sample"),
    },
    categories: (Array.isArray(parsed) ? parsed : [])
      .map((entry) => entry as { category?: unknown; institutions?: unknown })
      .filter((entry) => typeof entry.category === "string")
      .map((entry) => ({ category: String(entry.category), institutions: Number(entry.institutions ?? 0) })),
  };
}

type ShareHistory = Array<{ institutions: number; categories: Array<{ category: string; institutions: number }> }>;

/** The previous checks' per-catalog institution counts per category, newest first, from the ledger. */
async function previousShares(db: SqlTag): Promise<Record<Catalog, ShareHistory>> {
  const rows = await db<Array<{ detail: unknown }>>`
    SELECT e.detail
      FROM agent_run_events e
      JOIN agent_run_steps s ON s.id = e.step_id
     WHERE s.step_key = 'deming-data-quality'
       AND e.event_type = 'step.finished'
       AND e.status = 'completed'
     ORDER BY e.created_at DESC
     LIMIT ${SHARE_BASELINE_CHECKS}
  `;
  const history: Record<Catalog, ShareHistory> = { dollar: [], rate: [] };
  for (const row of rows) {
    const detail = (typeof row.detail === "string" ? JSON.parse(row.detail) : row.detail) as Record<string, unknown> | null;
    if (Number(detail?.version) !== DATA_QUALITY_VERSION) continue;
    for (const catalog of ["dollar", "rate"] as const) {
      const part = detail?.[catalog] as { institutions?: unknown; category_share?: { shares?: unknown } } | undefined;
      const shares = Array.isArray(part?.category_share?.shares) ? (part.category_share.shares as Array<{ category?: unknown; institutions?: unknown }>) : null;
      if (!shares || !Number.isFinite(Number(part?.institutions))) continue;
      history[catalog].push({
        institutions: Number(part?.institutions),
        categories: shares
          .filter((entry) => typeof entry.category === "string")
          .map((entry) => ({ category: String(entry.category), institutions: Number(entry.institutions ?? 0) })),
      });
    }
  }
  return history;
}

export async function runDataQuality({ db = sql }: { db?: SqlTag } = {}): Promise<DataQualityResult> {
  // Its own savepoint: a failed history read must not abort the run's transaction.
  const history = await inSavepoint(db, previousShares).catch((error) => {
    console.error("Data quality: the previous checks could not be read", error);
    return { dollar: [], rate: [] } as Record<Catalog, ShareHistory>;
  });
  const params = [STALE_AFTER_DAYS, TAXONOMY_KEYS, DATA_QUALITY_SAMPLE];
  const [dollarRow] = await db.unsafe<CountsRow[]>(dataQualitySql("published_fee_catalog"), params);
  const [rateRow] = await db.unsafe<CountsRow[]>(dataQualitySql("published_fee_rate_catalog"), params);
  const dollar = catalogQuality("dollar", countsFrom(dollarRow), history.dollar);
  const rate = catalogQuality("rate", countsFrom(rateRow), history.rate);
  return { version: DATA_QUALITY_VERSION, dollar, rate, ...alarms([dollar, rate]) };
}

const CHECK_TEXT: Record<GradedCheck | "categoryShare", string> = {
  duplicates: "duplicates",
  stale: `fees older than ${STALE_AFTER_DAYS} days`,
  noCategory: "fees with no category",
  noSource: "fees with no source link",
  categoryShare: "categories out of line with their normal share",
};

const pct = (value: number | null) => (value == null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const label = (key: string) => {
  const [catalog, check] = key.split(".") as [Catalog, GradedCheck | "categoryShare"];
  return `${catalog === "rate" ? "rate fees: " : ""}${CHECK_TEXT[check]}`;
};

export function summarizeDataQuality(result: DataQualityResult): string {
  const d = result.dollar;
  const parts = [
    `${d.checks.duplicates.count.toLocaleString("en-US")} duplicates (${pct(d.checks.duplicates.rate)})`,
    `${d.checks.stale.count.toLocaleString("en-US")} stale (${pct(d.checks.stale.rate)})`,
    `${d.checks.noCategory.count.toLocaleString("en-US")} with no category`,
    `${d.checks.noSource.count.toLocaleString("en-US")} with no source link`,
    d.categoryShare.status === "no_baseline"
      ? "category shares recorded (first check, nothing to compare)"
      : `${d.categoryShare.drifts.length} categories out of line with their normal share`,
  ];
  const alarm = result.failing.length === 0
    ? "no check failed its threshold"
    : `ALARM: ${result.failing.map(label).join("; ")}`;
  const watch = result.warning.length > 0 ? `; watch: ${result.warning.map(label).join("; ")}` : "";
  return `Deming checked ${d.liveFees.toLocaleString("en-US")} live dollar fees and ${result.rate.liveFees.toLocaleString("en-US")} rate fees: ${parts.join(", ")}; ${alarm}${watch}.`;
}

function catalogDetail(quality: CatalogQuality) {
  return {
    live_fees: quality.liveFees,
    institutions: quality.institutions,
    checks: quality.checks,
    off_taxonomy: quality.offTaxonomy,
    no_document: quality.noDocument,
    link_mismatch: { count: quality.linkMismatch, url_variants: quality.linkUrlVariant, read_page: quality.linkReadPage, sample: quality.linkMismatchSample },
    samples: quality.samples,
    category_share: {
      query: quality.categoryShare.query,
      status: quality.categoryShare.status,
      baseline_checks: quality.categoryShare.baselineChecks,
      drifts: quality.categoryShare.drifts,
      shares: quality.categoryShare.shares,
    },
  };
}

export function dataQualityDetail(result: DataQualityResult) {
  return {
    version: result.version,
    stale_after_days: STALE_AFTER_DAYS,
    thresholds: DATA_QUALITY_THRESHOLDS,
    failing: result.failing,
    warning: result.warning,
    dollar: catalogDetail(result.dollar),
    rate: catalogDetail(result.rate),
  };
}
