import { sql } from "./connection";
import type {
  Guide,
  GuideAudience,
  GuideAccessTier,
  GuideSection,
  GuideStatus,
} from "@/lib/guides/types";

/**
 * Postgres-backed guide storage.
 *
 * Signatures mirror `src/lib/guides/index.ts` so the public pages can move to this
 * module without changing shape. The typed catalog remains the seed source.
 */

export interface StoredGuide extends Guide {
  id: number;
  status: GuideStatus;
  generatedBy: string | null;
  agentRunId: number | null;
  regulatoryApprovedBy: string | null;
  regulatoryApprovedAt: string | null;
  staleSince: string | null;
  staleReason: string | null;
  viewCount: number;
  updatedAt: string;
}

interface GuideRow {
  id: number;
  slug: string;
  title: string;
  seo_title: string;
  description: string;
  primary_category: string;
  related_categories: string[];
  family: string;
  audience: GuideAudience;
  access_tier: GuideAccessTier;
  featured: boolean;
  status: GuideStatus;
  carries_regulatory_content: boolean;
  regulatory_approved_by: string | null;
  regulatory_approved_at: string | null;
  author: string;
  reviewed_at: string | null;
  published_at: string | null;
  methodology_href: string | null;
  related_slugs: string[];
  generated_by: string | null;
  agent_run_id: number | null;
  stale_since: string | null;
  stale_reason: string | null;
  view_count: number;
  updated_at: string;
}

interface SectionRow {
  guide_id: number;
  anchor: string;
  heading: string;
  position: number;
  blocks: GuideSection["blocks"];
}

function mapGuide(row: GuideRow, sections: GuideSection[]): StoredGuide {
  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    seoTitle: row.seo_title,
    description: row.description,
    primaryCategory: row.primary_category,
    relatedCategories: row.related_categories ?? [],
    family: row.family,
    audience: row.audience,
    accessTier: row.access_tier,
    featured: Boolean(row.featured),
    sections,
    author: row.author,
    reviewedAt: row.reviewed_at ?? "",
    publishedAt: row.published_at ?? "",
    methodologyHref: row.methodology_href ?? undefined,
    relatedSlugs: row.related_slugs ?? [],
    carriesRegulatoryContent: Boolean(row.carries_regulatory_content),
    status: row.status,
    generatedBy: row.generated_by,
    agentRunId: row.agent_run_id === null ? null : Number(row.agent_run_id),
    regulatoryApprovedBy: row.regulatory_approved_by,
    regulatoryApprovedAt: row.regulatory_approved_at,
    staleSince: row.stale_since,
    staleReason: row.stale_reason,
    viewCount: Number(row.view_count ?? 0),
    updatedAt: row.updated_at,
  };
}

async function sectionsByGuide(guideIds: number[]): Promise<Map<number, GuideSection[]>> {
  const byGuide = new Map<number, GuideSection[]>();
  if (guideIds.length === 0) return byGuide;

  const rows = (await sql`
    SELECT guide_id, anchor, heading, position, blocks
    FROM consumer_guide_sections
    WHERE guide_id = ANY(${guideIds})
    ORDER BY guide_id, position
  `) as unknown as SectionRow[];

  for (const row of rows) {
    const id = Number(row.guide_id);
    if (!byGuide.has(id)) byGuide.set(id, []);
    byGuide.get(id)!.push({
      id: row.anchor,
      heading: row.heading,
      blocks: Array.isArray(row.blocks) ? row.blocks : [],
    });
  }
  return byGuide;
}

async function hydrate(rows: GuideRow[]): Promise<StoredGuide[]> {
  const sections = await sectionsByGuide(rows.map((r) => Number(r.id)));
  return rows.map((row) => mapGuide(row, sections.get(Number(row.id)) ?? []));
}

export async function getPublishedGuides(): Promise<StoredGuide[]> {
  const rows = (await sql`
    SELECT * FROM consumer_guides
    WHERE status = 'published'
    ORDER BY featured DESC, published_at DESC NULLS LAST, title ASC
  `) as unknown as GuideRow[];
  return hydrate(rows);
}

export async function getGuideBySlug(
  slug: string,
  opts?: { includeUnpublished?: boolean },
): Promise<StoredGuide | null> {
  const rows = opts?.includeUnpublished
    ? ((await sql`SELECT * FROM consumer_guides WHERE slug = ${slug}`) as unknown as GuideRow[])
    : ((await sql`
        SELECT * FROM consumer_guides WHERE slug = ${slug} AND status = 'published'
      `) as unknown as GuideRow[]);
  if (rows.length === 0) return null;
  const [guide] = await hydrate(rows);
  return guide ?? null;
}

/**
 * Guides that explain a fee category. Closes the loop from `/fees/[category]` and
 * `/institution/[id]` back into the guides.
 */
export async function getGuidesForCategory(
  category: string,
  audience?: GuideAudience,
): Promise<StoredGuide[]> {
  const rows = (await sql`
    SELECT * FROM consumer_guides
    WHERE status = 'published'
      AND (primary_category = ${category} OR ${category} = ANY(related_categories))
      ${audience ? sql`AND audience = ${audience}` : sql``}
    ORDER BY (primary_category = ${category}) DESC, featured DESC, title ASC
  `) as unknown as GuideRow[];
  return hydrate(rows);
}

/** Admin listing — every guide in every state, newest activity first. */
export async function listGuidesForAdmin(): Promise<StoredGuide[]> {
  const rows = (await sql`
    SELECT * FROM consumer_guides ORDER BY updated_at DESC
  `) as unknown as GuideRow[];
  return hydrate(rows);
}

export async function getGuidesAwaitingReview(): Promise<StoredGuide[]> {
  const rows = (await sql`
    SELECT * FROM consumer_guides
    WHERE status IN ('draft', 'in_review', 'regulatory_review')
    ORDER BY
      CASE status WHEN 'regulatory_review' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,
      updated_at DESC
  `) as unknown as GuideRow[];
  return hydrate(rows);
}

export interface GuideUpsertInput extends Guide {
  status?: GuideStatus;
  generatedBy?: string | null;
  agentRunId?: number | null;
}

/**
 * Insert or update a guide and replace its sections.
 *
 * Never sets `published` — publishing is an explicit action through `publishGuide`, so
 * an agent draft cannot reach readers without a human. Editing a guide that carries
 * regulatory content clears any prior approval: approval attaches to the text that was
 * approved, and must never be inherited by a rewrite.
 */
export async function upsertGuide(input: GuideUpsertInput): Promise<StoredGuide> {
  const status: GuideStatus = input.status ?? "draft";
  if (status === "published") {
    throw new Error("upsertGuide cannot publish; use publishGuide()");
  }

  const [row] = (await sql`
    INSERT INTO consumer_guides (
      slug, title, seo_title, description,
      primary_category, related_categories, family,
      audience, access_tier, featured, status,
      carries_regulatory_content,
      author, reviewed_at, methodology_href, related_slugs,
      generated_by, agent_run_id, updated_at
    ) VALUES (
      ${input.slug}, ${input.title}, ${input.seoTitle}, ${input.description},
      ${input.primaryCategory}, ${input.relatedCategories}, ${input.family},
      ${input.audience}, ${input.accessTier}, ${input.featured}, ${status},
      ${Boolean(input.carriesRegulatoryContent)},
      ${input.author}, ${input.reviewedAt || null}, ${input.methodologyHref ?? null},
      ${input.relatedSlugs ?? []},
      ${input.generatedBy ?? null}, ${input.agentRunId ?? null}, NOW()
    )
    ON CONFLICT (slug) DO UPDATE SET
      title = EXCLUDED.title,
      seo_title = EXCLUDED.seo_title,
      description = EXCLUDED.description,
      primary_category = EXCLUDED.primary_category,
      related_categories = EXCLUDED.related_categories,
      family = EXCLUDED.family,
      audience = EXCLUDED.audience,
      access_tier = EXCLUDED.access_tier,
      featured = EXCLUDED.featured,
      status = EXCLUDED.status,
      carries_regulatory_content = EXCLUDED.carries_regulatory_content,
      author = EXCLUDED.author,
      reviewed_at = EXCLUDED.reviewed_at,
      methodology_href = EXCLUDED.methodology_href,
      related_slugs = EXCLUDED.related_slugs,
      generated_by = EXCLUDED.generated_by,
      agent_run_id = EXCLUDED.agent_run_id,
      -- A rewrite invalidates any prior sign-off. An agent never inherits a human's.
      regulatory_approved_by = NULL,
      regulatory_approved_at = NULL,
      stale_since = NULL,
      stale_reason = NULL,
      updated_at = NOW()
    RETURNING *
  `) as unknown as GuideRow[];

  const guideId = Number(row.id);
  await sql`DELETE FROM consumer_guide_sections WHERE guide_id = ${guideId}`;
  for (const [position, section] of input.sections.entries()) {
    await sql`
      INSERT INTO consumer_guide_sections (guide_id, anchor, heading, position, blocks)
      VALUES (
        ${guideId}, ${section.id}, ${section.heading}, ${position},
        ${sql.json(section.blocks)}
      )
    `;
  }

  const [hydrated] = await hydrate([row]);
  return hydrated;
}

/** Record a regulatory sign-off against the current text. */
export async function approveGuideRegulatoryContent(
  guideId: number,
  approver: string,
): Promise<StoredGuide | null> {
  const rows = (await sql`
    UPDATE consumer_guides
    SET regulatory_approved_by = ${approver},
        regulatory_approved_at = NOW(),
        updated_at = NOW()
    WHERE id = ${guideId}
    RETURNING *
  `) as unknown as GuideRow[];
  if (rows.length === 0) return null;
  const [guide] = await hydrate(rows);
  return guide;
}

/**
 * Publish a guide and snapshot it.
 *
 * The schema refuses a published regulatory guide without an approval, so a missing
 * sign-off fails here rather than reaching a reader.
 */
export async function publishGuide(
  guideId: number,
  actor: string,
  changeNote?: string,
): Promise<StoredGuide | null> {
  const rows = (await sql`
    UPDATE consumer_guides
    SET status = 'published',
        published_at = COALESCE(published_at, NOW()),
        reviewed_at = NOW(),
        stale_since = NULL,
        stale_reason = NULL,
        updated_at = NOW()
    WHERE id = ${guideId}
    RETURNING *
  `) as unknown as GuideRow[];
  if (rows.length === 0) return null;

  const [guide] = await hydrate(rows);
  await sql`
    INSERT INTO consumer_guide_revisions (
      guide_id, snapshot, changed_by, change_note, agent_run_id,
      regulatory_approved_by, regulatory_approved_at
    ) VALUES (
      ${guideId}, ${sql.json(JSON.parse(JSON.stringify(guide)))}, ${actor}, ${changeNote ?? null},
      ${guide.agentRunId}, ${guide.regulatoryApprovedBy}, ${guide.regulatoryApprovedAt}
    )
  `;
  return guide;
}

export async function setGuideStatus(
  guideId: number,
  status: Exclude<GuideStatus, "published">,
): Promise<void> {
  await sql`
    UPDATE consumer_guides
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${guideId}
  `;
}

/** Flag a guide for re-check after a benchmark move. Does not unpublish it. */
export async function markGuideStale(
  primaryCategory: string,
  reason: string,
): Promise<number> {
  const rows = (await sql`
    UPDATE consumer_guides
    SET stale_since = COALESCE(stale_since, NOW()),
        stale_reason = ${reason},
        updated_at = NOW()
    WHERE status = 'published'
      AND primary_category = ${primaryCategory}
      AND stale_since IS NULL
    RETURNING id
  `) as unknown as { id: number }[];
  return rows.length;
}

export async function getGuideRevisions(
  guideId: number,
  limit = 25,
): Promise<
  {
    id: number;
    snapshot: StoredGuide;
    changed_by: string;
    change_note: string | null;
    regulatory_approved_by: string | null;
    regulatory_approved_at: string | null;
    created_at: string;
  }[]
> {
  return (await sql`
    SELECT id, snapshot, changed_by, change_note,
           regulatory_approved_by, regulatory_approved_at, created_at
    FROM consumer_guide_revisions
    WHERE guide_id = ${guideId}
    ORDER BY created_at DESC
    LIMIT ${Math.max(1, Math.min(100, limit))}
  `) as never;
}

export async function incrementGuideView(slug: string): Promise<void> {
  await sql`
    UPDATE consumer_guides SET view_count = view_count + 1 WHERE slug = ${slug}
  `;
}
