"use server";

import { sql } from "@/lib/data-store/connection";
import { requireAuth } from "@/lib/auth";

export interface SearchResult {
  institutions: {
    id: number;
    name: string;
    state: string | null;
    charter: string;
  }[];
  categories: {
    fee_category: string;
    count: number;
  }[];
  feeNames: {
    fee_name: string;
    count: number;
  }[];
  conversations: {
    id: number;
    agent_id: string;
    title: string;
    updated_at: string;
  }[];
}

export async function searchDashboard(query: string): Promise<SearchResult> {
  await requireAuth("operate");
  if (!query || query.length < 2) {
    return { institutions: [], categories: [], feeNames: [], conversations: [] };
  }

  const pattern = `%${query}%`;

  const institutions = await sql`
    SELECT id, institution_name as name, state_code as state, charter_type as charter
    FROM institution_sources
    WHERE institution_name ILIKE ${pattern}
    ORDER BY asset_size DESC NULLS LAST
    LIMIT 8
  `;

  const categories = await sql`
    SELECT fee_category, COUNT(DISTINCT institution_id) as count
    FROM published_fee_catalog
    WHERE fee_category ILIKE ${pattern}
    AND fee_category IS NOT NULL
    GROUP BY fee_category
    ORDER BY count DESC
    LIMIT 8
  `;

  const feeNames = await sql`
    SELECT fee_name, COUNT(*) as count
    FROM published_fee_catalog
    WHERE fee_name ILIKE ${pattern}
    GROUP BY fee_name
    ORDER BY count DESC
    LIMIT 8
  `;

  let conversations: SearchResult["conversations"] = [];
  try {
    const rows = await sql`
      SELECT id, agent_id, title, updated_at
      FROM research_conversations
      WHERE title ILIKE ${pattern}
      ORDER BY updated_at DESC
      LIMIT 5
    `;
    conversations = [...rows] as unknown as SearchResult["conversations"];
  } catch {
    // Table may not exist yet
  }

  return {
    institutions: [...institutions] as unknown as SearchResult["institutions"],
    categories: [...categories] as unknown as SearchResult["categories"],
    feeNames: [...feeNames] as unknown as SearchResult["feeNames"],
    conversations,
  };
}
