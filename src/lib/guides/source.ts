import type { Guide, GuideAudience } from "./types";
import { guideCategories } from "./types";
import { CONSUMER_GUIDES } from "./catalog-consumer";
import { PROFESSIONAL_GUIDES } from "./catalog-professional";
import { relatedGuides as relatedFromList } from "./index";

/**
 * The guide read path used by server pages.
 *
 * Postgres is the source of truth once `consumer_guides` is migrated and seeded. Until
 * then — and if the table is ever unreachable — the typed catalog in `catalog-*.ts`
 * serves. That ordering is what makes the cutover a single deploy rather than a
 * coordinated one: ship the code, run the migration, seed, and the source flips with no
 * second deploy and no window where `/guides` is empty.
 *
 * A fallback never fails the page: a guide page failing to render because the guides table
 * does not exist yet would be a worse outcome than serving the seed content it was going to
 * be seeded with. A failed read is still logged, and `loadGuidesWithSource` reports it, so a
 * cached page can shorten its life instead of serving the seed list for an hour (#1811).
 */

const SEED_GUIDES: Guide[] = [...CONSUMER_GUIDES, ...PROFESSIONAL_GUIDES];

/** Whether the last read came from Postgres. Surfaced in admin, never to readers. */
export interface GuideSourceResult {
  guides: Guide[];
  source: "database" | "seed";
  /** True when the seed serves because the database read failed, not because it is unseeded. */
  readFailed: boolean;
}

interface DatabaseRead {
  /** Null when the read failed or the table is empty. */
  guides: Guide[] | null;
  failed: boolean;
}

async function readFromDatabase(): Promise<DatabaseRead> {
  try {
    const { getPublishedGuides } = await import("@/lib/data-store/guides");
    const stored = await getPublishedGuides();
    // An empty table means "migrated but not seeded yet", which is a seed case, not a
    // database case. Serving zero guides would blank the surface.
    return { guides: stored.length > 0 ? stored : null, failed: false };
  } catch (error) {
    console.error("[guides] published guides read failed; serving the seed guides", error);
    return { guides: null, failed: true };
  }
}

export async function loadGuidesWithSource(): Promise<GuideSourceResult> {
  const { guides, failed } = await readFromDatabase();
  return guides
    ? { guides, source: "database", readFailed: false }
    : { guides: SEED_GUIDES, source: "seed", readFailed: failed };
}

export async function loadGuides(): Promise<Guide[]> {
  return (await loadGuidesWithSource()).guides;
}

export async function loadConsumerGuides(): Promise<Guide[]> {
  return (await loadGuides()).filter((g) => g.audience === "consumer");
}

export async function loadProfessionalGuides(): Promise<Guide[]> {
  return (await loadGuides()).filter((g) => g.audience === "professional");
}

export async function loadGuide(slug: string): Promise<Guide | null> {
  try {
    const { getGuideBySlug } = await import("@/lib/data-store/guides");
    const stored = await getGuideBySlug(slug);
    if (stored) return stored;
  } catch {
    // Fall through to the seed.
  }
  return SEED_GUIDES.find((g) => g.slug === slug) ?? null;
}

/**
 * The guides for a fee, the guide written about that fee first (#1953: /fees/nsf linked the
 * overdraft guide, which only cites the NSF median). When the stored guides have none whose
 * primary fee this is, the seed's guide for it leads, as loadGuide serves seed guides too.
 */
export async function loadGuidesForCategory(
  category: string,
  audience?: GuideAudience,
): Promise<Guide[]> {
  const seed = primaryFirst(
    SEED_GUIDES.filter(
      (g) =>
        guideCategories(g).includes(category) &&
        (audience === undefined || g.audience === audience),
    ),
    category,
  );
  try {
    const { getGuidesForCategory } = await import("@/lib/data-store/guides");
    const stored = primaryFirst(await getGuidesForCategory(category, audience), category);
    if (stored.length > 0) {
      const seedPrimary = seed[0]?.primaryCategory === category ? seed[0] : null;
      if (stored[0].primaryCategory === category || !seedPrimary) return stored;
      return [seedPrimary, ...stored.filter((g) => g.slug !== seedPrimary.slug)];
    }
  } catch {
    // Fall through to the seed.
  }
  return seed;
}

function primaryFirst(guides: Guide[], category: string): Guide[] {
  return [...guides].sort(
    (a, b) => Number(b.primaryCategory === category) - Number(a.primaryCategory === category),
  );
}

export async function loadRelatedGuides(guide: Guide, limit = 4): Promise<Guide[]> {
  const all = await loadGuides();
  return relatedFromList(guide, limit, all);
}

/**
 * Slugs for `generateStaticParams`.
 *
 * Returns nothing when the database is unreachable, which is deliberate and matches how
 * `/fees/[category]` already behaves. Guide pages render live fee benchmarks, so a
 * prerender without a database cannot produce a correct page — it would either fail the
 * build or bake in an empty one. Returning `[]` prerenders nothing; `dynamicParams` is
 * enabled on the route, so every guide still renders on first request and is cached from
 * then on. A build with database access prerenders the full set as intended.
 */
export async function loadConsumerGuideSlugs(): Promise<string[]> {
  return guideSlugsForBuild("consumer");
}

export async function loadProfessionalGuideSlugs(): Promise<string[]> {
  return guideSlugsForBuild("professional");
}

async function guideSlugsForBuild(audience: GuideAudience): Promise<string[]> {
  try {
    const { hasData } = await import("@/lib/data-store/connection");
    if (!(await hasData())) return [];
  } catch {
    return [];
  }
  const { guides: stored } = await readFromDatabase();
  const source = stored ?? SEED_GUIDES;
  return source.filter((g) => g.audience === audience).map((g) => g.slug);
}

export { SEED_GUIDES };
