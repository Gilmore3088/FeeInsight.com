/**
 * Guide catalog and helpers.
 *
 * The catalog is a typed seed. When guides move to Postgres it becomes the seed source
 * for `consumer_guides`, and these accessors keep the same signatures so the pages do
 * not change on cutover.
 */

import { CONSUMER_GUIDES } from "./catalog-consumer";
import { PROFESSIONAL_GUIDES } from "./catalog-professional";
import type { Guide, GuideAccessTier, GuideBlock } from "./types";
import { guideCategories } from "./types";

export type {
  Guide,
  GuideSection,
  GuideBlock,
  GuideAudience,
  GuideAccessTier,
  GuideStat,
  GuideStatus,
} from "./types";
export { guideCategories, REQUIRED_CONSUMER_SECTIONS } from "./types";
export {
  resolveTokens,
  resolveTokensToText,
  parseTokens,
  isValidStat,
  escapeHtml,
} from "./tokens";
export type { ParsedToken, ResolveResult } from "./tokens";

export const GUIDES: Guide[] = [...CONSUMER_GUIDES, ...PROFESSIONAL_GUIDES];

export { CONSUMER_GUIDES, PROFESSIONAL_GUIDES };

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

/** Guides a reader at this tier may read in full. Consumer guides are always public. */
export function guidesForTier(tier: GuideAccessTier): Guide[] {
  if (tier === "pro") return GUIDES;
  return GUIDES.filter((g) => g.accessTier !== "pro");
}

export function canReadGuide(guide: Guide, isPro: boolean): boolean {
  return guide.accessTier !== "pro" || isPro;
}

/**
 * Related guides, ranked. Explicit `relatedSlugs` wins; otherwise fall back to guides
 * sharing a family, then to the same audience. Capped so the reader gets a choice, not
 * a directory.
 */
export function relatedGuides(guide: Guide, limit = 4, pool_?: Guide[]): Guide[] {
  const pool = (pool_ ?? GUIDES).filter(
    (g) => g.slug !== guide.slug && g.audience === guide.audience,
  );

  const explicit = (guide.relatedSlugs ?? [])
    .map((slug) => pool.find((g) => g.slug === slug))
    .filter((g): g is Guide => Boolean(g));

  if (explicit.length >= limit) return explicit.slice(0, limit);

  const chosen = new Set(explicit.map((g) => g.slug));
  const sameFamily = pool.filter(
    (g) => g.family === guide.family && !chosen.has(g.slug),
  );
  for (const g of sameFamily) chosen.add(g.slug);

  const rest = pool.filter((g) => !chosen.has(g.slug));
  return [...explicit, ...sameFamily, ...rest].slice(0, limit);
}

/** Guides that cite a fee category. Lets `/fees/[category]` link back into the guides. */
export function guidesForCategory(category: string, audience?: Guide["audience"]): Guide[] {
  return GUIDES.filter(
    (g) =>
      guideCategories(g).includes(category) &&
      (audience === undefined || g.audience === audience),
  );
}

/** Every text fragment in a block, for word counts and token validation. */
export function blockText(block: GuideBlock): string[] {
  switch (block.type) {
    case "paragraph":
      return [block.text];
    case "list":
      return block.items;
    case "callout":
      return [block.text];
    case "benchmark":
      return block.rows.flatMap((r) => [r.condition, r.meaning]);
    case "comparison":
      return block.caption ? [block.caption] : [];
  }
}

/** Every text fragment in a guide, in reading order. */
export function guideText(guide: Guide): string[] {
  return guide.sections.flatMap((s) => s.blocks.flatMap(blockText));
}

/** Prose word count. Tokens count as the single figure they resolve to. */
export function guideWordCount(guide: Guide): number {
  return guideText(guide)
    .join(" ")
    .replace(/\{\{\s*[a-z0-9_]+\s*\.\s*[a-z0-9_]+\s*\}\}/g, "X")
    .split(/\s+/)
    .filter(Boolean).length;
}
