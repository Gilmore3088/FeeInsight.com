import type { MetadataRoute } from "next";
import { FEE_FAMILIES } from "@/lib/fee-taxonomy";
import { STATE_CODES } from "@/lib/us-states";
import {
  getDataFreshness,
  getInstitutionIdsWithFeeDates,
  getStatesWithFeeData,
  getTopCitiesByState,
} from "@/lib/data-store";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { getPublicSnapshot } from "@/lib/public-stats";
import { loadGuides } from "@/lib/guides/source";
import { getSql } from "@/lib/data-store/connection";
import { SITE_URL } from "@/lib/constants";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { MIN_VERIFIED_FEES_FOR_OFFER } from "./(public)/institution/[id]/profile-copy";


// Serve a cached copy and rebuild it in the background at most once an hour. Rendered per
// request it took ~6 s (Google Search Console reported "Couldn't fetch").
export const dynamic = "force-static";
export const revalidate = 3600;

const BASE_URL = SITE_URL;
const SAMPLE_REPORT_PATH = "/reports/sample-competitive-fee-position";
/** City pages below this many verified institutions are noindexed and left out of the sitemap. */
const MIN_INDEXABLE_CITY_INSTITUTIONS = 3;
const TOP_CITIES_PER_STATE = 20;
const FED_DISTRICT_COUNT = 12;
const REPORTS_PRIORITY_WITH_CONTENT = 0.9;
const REPORTS_PRIORITY_WHILE_EMPTY = 0.5;

type Entry = MetadataRoute.Sitemap[number];
type ChangeFrequency = NonNullable<Entry["changeFrequency"]>;

function entry(
  path: string,
  lastModified: Date,
  changeFrequency: ChangeFrequency,
  priority: number,
): Entry {
  return { url: `${BASE_URL}${path}`, lastModified, changeFrequency, priority };
}

function toDate(value: string | Date | null | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/** Published research articles (drafts and archived ones stay out). A failed read lists none. */
async function loadPublishedArticles(): Promise<Array<{ slug: string; published_at: string | null; updated_at: string | null }>> {
  try {
    const sql = getSql();
    return await sql<Array<{ slug: string; published_at: string | null; updated_at: string | null }>>`
      SELECT slug, published_at, updated_at
      FROM research_articles
      WHERE status = 'published'
      ORDER BY published_at DESC NULLS LAST
      LIMIT 500
    `;
  } catch {
    return [];
  }
}

async function loadPublishedReports():Promise<Array<{ slug: string; published_at: string }>> {
  try {
    const sql = getSql();
    return await sql<Array<{ slug: string; published_at: string }>>`
      SELECT slug, published_at
      FROM published_reports
      WHERE is_public = true
      ORDER BY published_at DESC
      LIMIT 500
    `;
  } catch {
    // No published_reports table yet or DB unavailable
    return [];
  }
}

/**
 * Fee categories with at least MIN_INSTITUTIONS_FOR_MEDIAN institutions, from the public
 * snapshot. Null when the counts can't be read, so the caller lists every category as before.
 */
async function loadIndexableCategories(): Promise<Set<string> | null> {
  try {
    const { categories } = await getPublicSnapshot();
    if (categories.length === 0) return null;
    return new Set(
      categories
        .filter((c) => c.institution_count >= MIN_INSTITUTIONS_FOR_MEDIAN)
        .map((c) => c.fee_category),
    );
  } catch {
    return null;
  }
}

/** States with at least MIN_INSTITUTIONS_FOR_MEDIAN institutions with published fees; null when unreadable. */
async function loadIndexableStates(): Promise<Set<string> | null> {
  try {
    const rows = await getStatesWithFeeData();
    if (rows.length === 0) return null;
    return new Set(
      rows.filter((r) => r.institution_count >= MIN_INSTITUTIONS_FOR_MEDIAN).map((r) => r.state_code),
    );
  } catch {
    return null;
  }
}

async function loadCityPages(dataUpdated: Date): Promise<Entry[]> {
  const listedStates = new Set<string>(STATE_CODES);
  try {
    const cities = await getTopCitiesByState(MIN_INDEXABLE_CITY_INSTITUTIONS, TOP_CITIES_PER_STATE);
    return cities
      .filter((c) => listedStates.has(c.state_code))
      .map((c) => {
        const citySlug = encodeURIComponent(c.city.toLowerCase());
        return entry(`/fees/city/${c.state_code.toLowerCase()}/${citySlug}`, dataUpdated, "weekly", 0.6);
      });
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  // If the DB is unreachable at build, emit static + taxonomy URLs only and skip the
  // remaining per-state/report queries — otherwise one outage means dozens of connect
  // timeouts that blow the page's render budget.
  let dbAvailable = true;
  let institutions: Awaited<ReturnType<typeof getInstitutionIdsWithFeeDates>> = [];
  let dataUpdated = now;
  try {
    institutions = await getInstitutionIdsWithFeeDates();
    const freshness = await getDataFreshness().catch(() => null);
    dataUpdated = toDate(freshness?.last_fee_extracted_at, now);
  } catch (error) {
    // At runtime, fail the background rebuild so the last full cached copy keeps serving
    // instead of being replaced by a partial sitemap. At build, emit the partial one.
    if (process.env.NEXT_PHASE !== "phase-production-build") throw error;
    dbAvailable = false;
  }

  const publishedReports = dbAvailable ? await loadPublishedReports() : [];
  const publishedArticles = dbAvailable ? await loadPublishedArticles() : [];
  const reportsPriority =
    publishedReports.length > 0 ? REPORTS_PRIORITY_WITH_CONTENT : REPORTS_PRIORITY_WHILE_EMPTY;

  const staticPages: Entry[] = [
    entry("", now, "daily", 1.0),
    entry("/for-institutions", now, "weekly", 0.9),
    entry("/subscribe", now, "monthly", 0.8),
    entry("/about", now, "monthly", 0.7),
    entry("/methodology", now, "monthly", 0.8),
    entry("/institutions", dataUpdated, "weekly", 0.9),
    entry("/fees", dataUpdated, "weekly", 0.9),
    entry("/research", dataUpdated, "weekly", 0.7),
    entry("/contact", now, "yearly", 0.5),
    entry("/api-docs", now, "monthly", 0.5),
    entry("/submit-fees", now, "monthly", 0.4),
    entry("/privacy", now, "yearly", 0.3),
    entry("/terms", now, "yearly", 0.3),
  ];

  // Individual report pages are noindex until they carry an on-page summary; the catalog
  // and the sample stay listed.
  const reportPages: Entry[] = [
    entry("/reports", now, "weekly", reportsPriority),
    ...((await sampleReportAvailable()) ? [entry(SAMPLE_REPORT_PATH, now, "monthly", 0.7)] : []),
  ];

  // Category and state pages below the median floor are noindexed (thin), so they stay out
  // of the sitemap. When the counts can't be read, every page is listed as before.
  const [indexableCategories, indexableStates] = dbAvailable
    ? await Promise.all([loadIndexableCategories(), loadIndexableStates()])
    : [null, null];

  const categoryPages: Entry[] = Object.values(FEE_FAMILIES)
    .flat()
    .filter((category) => !indexableCategories || indexableCategories.has(category))
    .map((category) => entry(`/fees/${category}`, dataUpdated, "weekly", 0.8));

  const statePages: Entry[] = STATE_CODES.filter(
    (code) => !indexableStates || indexableStates.has(code),
  ).map((code) => entry(`/research/state/${code}`, dataUpdated, "weekly", 0.7));

  const districtPages: Entry[] = Array.from({ length: FED_DISTRICT_COUNT }, (_, i) =>
    entry(`/research/district/${i + 1}`, dataUpdated, "weekly", 0.7),
  );

  const researchPages: Entry[] = [
    entry("/research/national-fee-index", dataUpdated, "weekly", 0.9),
    entry("/research/data-sources", now, "monthly", 0.5),
    ...publishedArticles.map((a) =>
      entry(`/research/articles/${a.slug}`, toDate(a.updated_at ?? a.published_at, now), "monthly", 0.7),
    ),
  ];

  // Consumer guides live at /guides/[slug]; professional guides at /guides/pro/[slug],
  // where the body is gated. Both are indexable — the professional pages show title,
  // description and an upgrade prompt — but the free ones carry the higher priority.
  const allGuides = await loadGuides();
  const guidePages: Entry[] = [
    entry("/guides", now, "monthly", 0.7),
    ...allGuides.map((g) =>
      g.audience === "professional"
        ? entry(`/guides/pro/${g.slug}`, toDate(g.reviewedAt, now), "monthly", 0.4)
        : entry(`/guides/${g.slug}`, toDate(g.reviewedAt, now), "monthly", 0.7),
    ),
  ];

  // Profiles with fewer than MIN_VERIFIED_FEES_FOR_OFFER verified fees are noindexed (thin), so
  // they stay out; a profile whose count can't be read is listed as before. lastmod is the
  // latest observation.
  const institutionPages: Entry[] = institutions
    .filter((inst) => inst.verified_fee_count == null || inst.verified_fee_count >= MIN_VERIFIED_FEES_FOR_OFFER)
    .map((inst) => entry(`/institution/${inst.id}`, toDate(inst.last_fee_at, dataUpdated), "weekly", 0.6));

  const stateCityDirPages: Entry[] = STATE_CODES.map((code) =>
    entry(`/fees/city/${code.toLowerCase()}`, dataUpdated, "weekly", 0.7),
  );

  const cityPages = dbAvailable ? await loadCityPages(dataUpdated) : [];

  return [
    ...staticPages,
    ...reportPages,
    ...categoryPages,
    ...statePages,
    ...districtPages,
    ...researchPages,
    ...institutionPages,
    ...guidePages,
    ...stateCityDirPages,
    ...cityPages,
  ];
}
