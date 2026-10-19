/**
 * External Intelligence: full-text search and listing.
 *
 * Stores admin-curated external research (CFPB surveys, ABA studies,
 * industry reports, regulatory guidance) for Hamilton to reference.
 *
 * All queries use parameterized tagged templates via getSql() (T-27-01).
 */

import { getSql } from "./connection";

export interface ExternalIntelligence {
  id: number;
  source_name: string;
  source_date: string;
  category: string;
  tags: string[];
  content_text: string;
  source_url: string | null;
  created_at: string;
  created_by: string | null;
}

export interface IntelligenceSearchResult extends ExternalIntelligence {
  headline: string;
  rank: number;
}

/**
 * Full-text search against external_intelligence using tsvector.
 *
 * Uses plainto_tsquery for natural language matching.
 * Optional filters: category (exact match) and tags (array containment).
 * Returns up to 20 results ranked by ts_rank DESC.
 */
export async function searchExternalIntelligence(
  query: string,
  filters?: { category?: string; tags?: string[] }
): Promise<IntelligenceSearchResult[]> {
  const sql = getSql();
  const category = filters?.category ?? null;
  const tags = filters?.tags ?? null;

  const rows = await sql`
    SELECT
      id,
      source_name,
      source_date::TEXT AS source_date,
      category,
      tags,
      content_text,
      source_url,
      created_at::TEXT AS created_at,
      created_by,
      ts_headline(
        'english',
        content_text,
        plainto_tsquery('english', ${query}),
        'MaxWords=40, MinWords=20'
      ) AS headline,
      ts_rank(search_vector, plainto_tsquery('english', ${query})) AS rank
    FROM external_intelligence
    WHERE search_vector @@ plainto_tsquery('english', ${query})
      AND (${category}::TEXT IS NULL OR category = ${category})
      AND (${tags}::TEXT[] IS NULL OR tags @> ${tags}::TEXT[])
    ORDER BY rank DESC
    LIMIT 20
  ` as IntelligenceSearchResult[];

  return rows.map((r) => ({
    ...r,
    rank: Number(r.rank),
  }));
}

/**
 * List all external intelligence documents, ordered by source_date descending.
 * Returns paginated results with total count.
 */
export async function listIntelligence(
  limit = 50,
  offset = 0
): Promise<{ items: ExternalIntelligence[]; total: number }> {
  const sql = getSql();

  const rows = await sql`
    SELECT
      COUNT(*) OVER () AS count,
      id,
      source_name,
      source_date::TEXT AS source_date,
      category,
      tags,
      content_text,
      source_url,
      created_at::TEXT AS created_at,
      created_by
    FROM external_intelligence
    ORDER BY source_date DESC
    LIMIT ${limit}
    OFFSET ${offset}
  ` as (ExternalIntelligence & { count: string })[];

  if (rows.length === 0) {
    return { items: [], total: 0 };
  }

  const total = Number(rows[0].count);
  const items = rows.map(({ count: _count, ...rest }) => rest as ExternalIntelligence);

  return { items, total };
}
