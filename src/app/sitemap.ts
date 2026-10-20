import type { MetadataRoute } from "next";
import { unstable_cache } from "next/cache";
import { FEE_FAMILIES, publicFeeTypes } from "@/lib/fee-taxonomy";
import { STATE_CODES } from "@/lib/us-states";
import {
  getDataFreshness,
  getInstitutionIdsWithFeeDates,
  getStatesWithFeeData,
  getTopCitiesByState,
} from "@/lib/data-store";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { getStateMarketCitiesCached } from "@/lib/data-store/public-cached-reads";
import { canonicalCityName, cityPath } from "./(public)/fees/city/[state]/[city]/city-address";
import { getPublicFeeTypes, getPublicSnapshot } from "@/lib/public-stats";
import { loadGuides } from "@/lib/guides/source";
import { getSql } from "@/lib/data-store/connection";
import { SITE_URL } from "@/lib/constants";
import { sampleReportAvailable } from "@/lib/custom-report/sample-report";
import { MIN_VERIFIED_FEES_FOR_OFFER } from "./(public)/institution/[id]/profile-copy";
import { SAMPLE_REPORT_HREF } from "./landing-shared";

// Rendered on request, never at build: prerendering it read the database during `next build`,
// and a busy database failed whole deployments (findings/2026-10-20-sitemap-build-time-db-reads.md).
// The finished sitemap is cached for an hour and refreshed in the background, since a full
// render takes ~6 s (Google Search Console reported "Couldn't fetch" when it ran per request).
export const dynamic = "force-dynamic";
const SITEMAP_CACHE_SECONDS = 3600;

const BASE_URL = SITE_URL;
/** City pages below this many verified institutions are noindexed and left out of the sitemap. */
const MIN_INDEXABLE_CITY_INSTITUTIONS = 3;
const TOP_CITIES_PER_STATE = 20;
const FED_DISTRICT_COUNT = 12;
const REPORTS_PRIORITY_WITH_CONTENT = 0.9;
const REPORTS_PRIORITY_WHILE_EMPTY = 0.5;

type Entry = MetadataRoute.Sitemap[number];
type ChangeFrequency = NonNullable<Entry["changeFrequency"]>;

/** Set when a secondary read failed, so the result is served but not cached. */
type ReadHealth = { degraded: boolean };

/** A sitemap built with a failed read: returned to the caller, never stored in the cache. */
class PartialSitemap extends Error {
  constructor(readonly entries: MetadataRoute.Sitemap) {
    super("partial sitemap is not cached");
  }
}

/** `lastModified` is left out when the page has no real change date: "now" on every rebuild teaches crawlers to ignore it. */
function entry(
  path: string,
  lastModified: Date | undefined,
  changeFrequency: ChangeFrequency,
  priority: number,
): Entry {
  return { url: `${BASE_URL}${path}`, ...(lastModified ? { lastModified } : {}), changeFrequency, priority };
}

/** One entry per URL, the first kept. Two stored spellings of a city once mapped to the same address. */
function dedupeEntries(entries: Entry[]): Entry[] {
  const seen = new Set<string>();
  return entries.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function toDate(value: string | Date | null | undefined, fallback: Date): Date;
function toDate(value: string | Date | null | undefined, fallback: Date | undefined): Date | undefined;
function toDate(value: string | Date | null | undefined, fallback: Date | undefined): Date | undefined {
  if (!value) return fallback;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/** Published research articles (drafts and archived ones stay out). A failed read lists none. */
async function loadPublishedArticles(health: ReadHealth): Promise<Array<{ slug: string; published_at: string | null; updated_at: string | null }>> {
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
    health.degraded = true;
    return [];
  }
}

async function loadPublishedReports(health: ReadHealth): Promise<Array<{ slug: string; published_at: string }>> {
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
    health.degraded = true;
    return [];
  }
}

/**
 * Fee categories with at least MIN_INSTITUTIONS_FOR_MEDIAN institutions, from the public
 * snapshot. Null when the counts can't be read, so the caller lists every category as before.
 */
async function loadIndexableCategories(health: ReadHealth): Promise<Set<string> | null> {
  try {
    const { categories } = await getPublicSnapshot();
    if (categories.length === 0) return null;
    return new Set(
      categories
        .filter((c) => c.institution_count >= MIN_INSTITUTIONS_FOR_MEDIAN)
        .map((c) => c.fee_category),
    );
  } catch {
    health.degraded = true;
    return null;
  }
}

/** States with at least MIN_INSTITUTIONS_FOR_MEDIAN institutions with published fees; null when unreadable. */
async function loadIndexableStates(health: ReadHealth): Promise<Set<string> | null> {
  try {
    const rows = await getStatesWithFeeData();
    if (rows.length === 0) return null;
    return new Set(
      rows.filter((r) => r.institution_count >= MIN_INSTITUTIONS_FOR_MEDIAN).map((r) => r.state_code),
    );
  } catch {
    health.degraded = true;
    return null;
  }
}

async function loadCityPages(dataUpdated: Date, health: ReadHealth): Promise<Entry[]> {
  const listedStates = new Set<string>(STATE_CODES);
  try {
    const cities = (await getTopCitiesByState(MIN_INDEXABLE_CITY_INSTITUTIONS, TOP_CITIES_PER_STATE)).filter((c) =>
      listedStates.has(c.state_code),
    );
    // Each city under the address the city layout keeps (#2092): the directory's spelling when the
    // state directory lists it, else the headquarters spelling. Any other spelling would 301. A
    // state whose directory read failed is left out of this build rather than listed under a name
    // the layout may not keep; that build is not cached, so the next request lists it.
    const states = [...new Set(cities.map((c) => c.state_code))];
    const directories = new Map(
      await Promise.all(states.map(async (state) => [state, await getStateMarketCitiesCached(state).catch(() => {
        health.degraded = true;
        return null;
      })] as const)),
    );
    const paths = cities.flatMap((c) => {
      const directory = directories.get(c.state_code);
      if (!directory) return [];
      return [cityPath(c.state_code, canonicalCityName(c.city, directory, c.city) ?? c.city)];
    });
    return [...new Set(paths)].map((path) => entry(path, dataUpdated, "weekly", 0.6));
  } catch {
    health.degraded = true;
    return [];
  }
}

/**
 * Builds the sitemap. With `dbAvailable`, a failed institution read throws, so a background
 * refresh keeps serving the last full cached copy. Without it, only the static and taxonomy URLs
 * are listed, skipping dozens of reads that would each time out against a down database.
 */
async function buildSitemap(dbAvailable: boolean, health: ReadHealth): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  let institutions: Awaited<ReturnType<typeof getInstitutionIdsWithFeeDates>> = [];
  let dataUpdated = now;
  if (dbAvailable) {
    institutions = await getInstitutionIdsWithFeeDates();
    const freshness = await getDataFreshness().catch(() => {
      health.degraded = true;
      return null;
    });
    dataUpdated = toDate(freshness?.last_fee_extracted_at, now);
  } else {
    health.degraded = true;
  }

  const publishedReports = dbAvailable ? await loadPublishedReports(health) : [];
  const publishedArticles = dbAvailable ? await loadPublishedArticles(health) : [];
  const reportsPriority =
    publishedReports.length > 0 ? REPORTS_PRIORITY_WITH_CONTENT : REPORTS_PRIORITY_WHILE_EMPTY;

  const staticPages: Entry[] = [
    entry("", dataUpdated, "daily", 1.0),
    entry("/for-institutions", dataUpdated, "weekly", 0.9),
    entry("/for-consumers", undefined, "monthly", 0.8),
    entry("/subscribe", undefined, "monthly", 0.8),
    entry("/about", undefined, "monthly", 0.7),
    entry("/methodology", undefined, "monthly", 0.8),
    entry("/institutions", dataUpdated, "weekly", 0.9),
    entry("/check", dataUpdated, "weekly", 0.8),
    entry("/fees", dataUpdated, "weekly", 0.9),
    entry("/research", dataUpdated, "weekly", 0.7),
    entry("/contact", undefined, "yearly", 0.5),
    entry("/api-docs", undefined, "monthly", 0.5),
    entry("/submit-fees", undefined, "monthly", 0.4),
    entry("/privacy", undefined, "yearly", 0.3),
    entry("/terms", undefined, "yearly", 0.3),
  ];

  // Individual report pages are noindex until they carry an on-page summary; the catalog
  // and the sample stay listed.
  const reportPages: Entry[] = [
    entry("/reports", dataUpdated, "weekly", reportsPriority),
    ...((await sampleReportAvailable()) ? [entry(SAMPLE_REPORT_HREF, dataUpdated, "monthly", 0.7)] : []),
  ];

  // Category and state pages below the median floor are noindexed (thin), so they stay out
  // of the sitemap. When the counts can't be read, every page is listed as before.
  const [indexableCategories, indexableStates] = dbAvailable
    ? await Promise.all([loadIndexableCategories(health), loadIndexableStates(health)])
    : [null, null];

  // The public site lists the top 50 fee types by institution count (James, Oct 17 2026); with no
  // counts, the tier order decides (`publicFeeTypes`).
  const publicTypes = dbAvailable
    ? await getPublicFeeTypes().catch(() => {
        health.degraded = true;
        return publicFeeTypes([]);
      })
    : publicFeeTypes([]);
  const categoryPages: Entry[] = Object.values(FEE_FAMILIES)
    .flat()
    .filter((category) => publicTypes.has(category))
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
    entry("/research/data-sources", undefined, "monthly", 0.5),
    ...publishedArticles.map((a) =>
      entry(`/research/articles/${a.slug}`, toDate(a.updated_at ?? a.published_at, undefined), "monthly", 0.7),
    ),
  ];

  // Consumer guides live at /guides/[slug]. Professional guides (/guides/pro/[slug]) show
  // crawlers only a title and an upgrade gate, so they are noindexed and left out.
  const allGuides = await loadGuides();
  const guidePages: Entry[] = [
    entry("/guides", undefined, "monthly", 0.7),
    ...allGuides
      .filter((g) => g.audience !== "professional")
      .map((g) => entry(`/guides/${g.slug}`, toDate(g.reviewedAt, undefined), "monthly", 0.7)),
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

  const cityPages = dbAvailable ? await loadCityPages(dataUpdated, health) : [];

  return dedupeEntries([
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
  ]);
}

/** The cache stores JSON, so dates are stored as the ISO strings the sitemap prints anyway. */
function withIsoDates(entries: MetadataRoute.Sitemap): MetadataRoute.Sitemap {
  return entries.map((item) =>
    item.lastModified instanceof Date ? { ...item, lastModified: item.lastModified.toISOString() } : item,
  );
}

/**
 * The full sitemap, cached for SITEMAP_CACHE_SECONDS. A stale copy is served while it refreshes
 * in the background, and a failed refresh keeps the last good copy. A build with a failed read
 * throws PartialSitemap so it is never cached.
 */
const cachedFullSitemap = unstable_cache(
  async () => {
    const health: ReadHealth = { degraded: false };
    const entries = withIsoDates(await buildSitemap(true, health));
    if (health.degraded) throw new PartialSitemap(entries);
    return entries;
  },
  ["sitemap", "v1"],
  { revalidate: SITEMAP_CACHE_SECONDS },
);

function isMissingIncrementalCache(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Invariant: incrementalCache missing");
}

/** No cached copy and the institution read failed: list the URLs that need no database read. */
async function databaseFreeSitemap(error: unknown): Promise<MetadataRoute.Sitemap> {
  console.error("sitemap: full build failed; serving the database-free sitemap uncached", error);
  return buildSitemap(false, { degraded: true });
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    return await cachedFullSitemap();
  } catch (error) {
    if (error instanceof PartialSitemap) return error.entries;
    if (!isMissingIncrementalCache(error)) return databaseFreeSitemap(error);
    // Outside a Next request (tests) there is no cache; build directly.
    try {
      return await buildSitemap(true, { degraded: false });
    } catch (directError) {
      return databaseFreeSitemap(directError);
    }
  }
}
