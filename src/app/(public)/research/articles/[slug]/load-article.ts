import { cache } from "react";
import { getArticleBySlug, type Article } from "@/lib/data-store/articles";
import { PREVIEW_FIXTURE_ARTICLE, PREVIEW_FIXTURE_SLUG, previewFixtureEnabled } from "./preview-fixture";

/**
 * The published article, or null when it is missing or unpublished; read once per request and
 * shared by the layout, the metadata and the page. Read-only: the old per-render
 * ensureResearchTables() DDL is gone (the table exists on prod). A failed read still throws (500),
 * never a 404. The reserved preview slug answers the fixture on preview and in development only,
 * and never touches the database.
 */
export const loadPublishedArticle = cache(async (slug: string): Promise<Article | null> => {
  if (slug === PREVIEW_FIXTURE_SLUG) return previewFixtureEnabled() ? PREVIEW_FIXTURE_ARTICLE : null;
  const article = await getArticleBySlug(slug);
  return article && article.status === "published" ? article : null;
});
