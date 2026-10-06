import type { MetadataRoute } from "next";
import { FEE_FAMILIES } from "@/lib/fee-taxonomy";
import { STATE_CODES } from "@/lib/us-states";
import {
  getCitiesInState,
  getDataFreshness,
  getInstitutionIdsWithFeeDates,
} from "@/lib/data-store";
import { loadGuides } from "@/lib/guides/source";
import { getSql } from "@/lib/data-store/connection";
import { SAMPLE_REPORT_LIVE, SITE_URL } from "@/lib/constants";

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

async function loadPublishedReports(): Promise<Array<{ slug: string; published_at: string }>> {
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

async function loadCityPages(dataUpdated: Date): Promise<Entry[]> {
  const pages: Entry[] = [];
  for (const code of STATE_CODES) {
    try {
      const cities = await getCitiesInState(code);
      const indexable = cities
        .filter((c) => c.with_fees >= MIN_INDEXABLE_CITY_INSTITUTIONS)
        .slice(0, TOP_CITIES_PER_STATE);
      for (const c of indexable) {
        const citySlug = encodeURIComponent(c.city.toLowerCase());
        pages.push(entry(`/fees/city/${code.toLowerCase()}/${citySlug}`, dataUpdated, "weekly", 0.6));
      }
    } catch {
      // Skip states with no data
    }
  }
  return pages;
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
  } catch {
    dbAvailable = false;
  }

  const publishedReports = dbAvailable ? await loadPublishedReports() : [];
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
    ...(SAMPLE_REPORT_LIVE ? [entry(SAMPLE_REPORT_PATH, now, "monthly", 0.7)] : []),
  ];

  const categoryPages: Entry[] = Object.values(FEE_FAMILIES)
    .flat()
    .map((category) => entry(`/fees/${category}`, dataUpdated, "weekly", 0.8));

  const statePages: Entry[] = STATE_CODES.map((code) =>
    entry(`/research/state/${code}`, dataUpdated, "weekly", 0.7),
  );

  const districtPages: Entry[] = Array.from({ length: FED_DISTRICT_COUNT }, (_, i) =>
    entry(`/research/district/${i + 1}`, dataUpdated, "weekly", 0.7),
  );

  const researchPages: Entry[] = [
    entry("/research/national-fee-index", dataUpdated, "weekly", 0.9),
    entry("/research/data-sources", now, "monthly", 0.5),
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

  // Only institutions with at least one verified fee; lastmod is the latest observation.
  const institutionPages: Entry[] = institutions.map((inst) =>
    entry(`/institution/${inst.id}`, toDate(inst.last_fee_at, dataUpdated), "weekly", 0.6),
  );

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
