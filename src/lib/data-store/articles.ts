import { sql } from "./connection";
import { RESEARCH_IMPRINT } from "@/lib/constants";

export interface Article {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  content: string;
  category: string;
  tags: string | null;
  author: string;
  status: "draft" | "published" | "archived";
  generated_by: string | null;
  conversation_id: number | null;
  published_at: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  view_count: number;
}

export async function getArticles(opts?: {
  status?: string;
  category?: string;
  limit?: number;
  offset?: number;
}): Promise<{ articles: Article[]; total: number }> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts?.status) {
    conditions.push(`status = $${params.length + 1}`);
    params.push(opts.status);
  }
  if (opts?.category) {
    conditions.push(`category = $${params.length + 1}`);
    params.push(opts.category);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts?.limit || 50;
  const offset = opts?.offset || 0;

  const [countRow] = await sql.unsafe(
    `SELECT COUNT(*) as c FROM research_articles ${where}`,
    params,
  );

  const articles = await sql.unsafe(
    `SELECT * FROM research_articles ${where} ORDER BY updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  ) as Article[];

  return { articles, total: Number(countRow.c) };
}

export async function getArticleBySlug(slug: string): Promise<Article | null> {
  const [row] = await sql`SELECT * FROM research_articles WHERE slug = ${slug}`;
  return (row as Article) ?? null;
}

export async function getArticleById(id: number): Promise<Article | null> {
  const [row] = await sql`SELECT * FROM research_articles WHERE id = ${id}`;
  return (row as Article) ?? null;
}

export async function getPublishedArticles(limit = 20): Promise<Article[]> {
  return await sql`
    SELECT * FROM research_articles WHERE status = 'published' ORDER BY published_at DESC LIMIT ${limit}
  ` as Article[];
}

export async function createArticle(data: {
  slug: string;
  title: string;
  subtitle?: string;
  content: string;
  category: string;
  tags?: string[];
  author?: string;
  generated_by?: string;
  conversation_id?: number;
}): Promise<number> {
  const [row] = await sql`
    INSERT INTO research_articles (slug, title, subtitle, content, category, tags, author, generated_by, conversation_id)
    VALUES (
      ${data.slug},
      ${data.title},
      ${data.subtitle ?? null},
      ${data.content},
      ${data.category},
      ${data.tags ? JSON.stringify(data.tags) : null},
      ${data.author ?? RESEARCH_IMPRINT},
      ${data.generated_by ?? null},
      ${data.conversation_id ?? null}
    )
    RETURNING id
  `;
  return row.id;
}

export async function updateArticle(id: number, data: Partial<{
  title: string;
  subtitle: string | null;
  content: string;
  category: string;
  tags: string[];
  author: string;
  status: string;
}>): Promise<boolean> {
  const sets: string[] = ["updated_at = NOW()"];
  const params: (string | number | null)[] = [];

  if (data.title !== undefined) { sets.push(`title = $${params.length + 1}`); params.push(data.title); }
  if (data.subtitle !== undefined) { sets.push(`subtitle = $${params.length + 1}`); params.push(data.subtitle); }
  if (data.content !== undefined) { sets.push(`content = $${params.length + 1}`); params.push(data.content); }
  if (data.category !== undefined) { sets.push(`category = $${params.length + 1}`); params.push(data.category); }
  if (data.tags !== undefined) { sets.push(`tags = $${params.length + 1}`); params.push(JSON.stringify(data.tags)); }
  if (data.author !== undefined) { sets.push(`author = $${params.length + 1}`); params.push(data.author); }
  if (data.status !== undefined) {
    sets.push(`status = $${params.length + 1}`);
    params.push(data.status);
    if (data.status === "published") {
      sets.push("published_at = COALESCE(published_at, NOW())");
    }
  }

  params.push(id);
  const result = await sql.unsafe(
    `UPDATE research_articles SET ${sets.join(", ")} WHERE id = $${params.length}`,
    params,
  );
  return result.count > 0;
}

export async function deleteArticle(id: number): Promise<boolean> {
  const result = await sql`DELETE FROM research_articles WHERE id = ${id}`;
  return result.count > 0;
}

export async function incrementViewCount(slug: string): Promise<void> {
  await sql`
    UPDATE research_articles SET view_count = view_count + 1 WHERE slug = ${slug} AND status = 'published'
  `;
}

export interface ArticleSummary {
  slug: string;
  title: string;
  subtitle: string | null;
  category: string;
  /** ISO date string; text so it survives the JSON public cache. */
  published_at: string | null;
}

/** Newest published articles, without bodies, for listing on public pages. */
export async function getPublishedArticleSummaries(limit = 6): Promise<ArticleSummary[]> {
  return await sql`
    SELECT slug, title, subtitle, category, published_at::text AS published_at
    FROM research_articles
    WHERE status = 'published'
    ORDER BY published_at DESC NULLS LAST
    LIMIT ${limit}
  ` as ArticleSummary[];
}
