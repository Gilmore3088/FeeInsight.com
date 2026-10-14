/**
 * Saved Hamilton analyses (hamilton_saved_analyses): the reader's history and the source
 * of "Add to report". The Ask engine files each storyline answer here once, and adds
 * Hamilton's memo to the same row when it is written.
 */

import { sql, withTransaction } from "./connection";
import type { AnalyzeResponse } from "@/lib/hamilton/types";
import { normalizeLegacyAnalyzeConfidence } from "@/lib/hamilton/evidence-contract";

/**
 * How long a save of the same question (same reader, institution and focus, same words after
 * case and spacing) updates the earlier row instead of adding another. Covers a double submit,
 * two tabs, or Try again after the browser lost an answer the server had already saved.
 */
export const DUPLICATE_SAVE_WINDOW_SECONDS = 120;

type SavedAnalysisInput = {
  userId: number;
  institutionId: string;
  title: string;
  analysisFocus: string;
  prompt: string;
  response: AnalyzeResponse;
  /**
   * Update a row saved for the same question within DUPLICATE_SAVE_WINDOW_SECONDS instead of
   * inserting a second one; the newer answer is kept. Off for saves that must stay immutable.
   */
  replaceRecentDuplicate?: boolean;
};

export async function insertSavedAnalysis(input: SavedAnalysisInput): Promise<string | null> {
  if (!input.replaceRecentDuplicate) return insertRow(sql, input);
  return withTransaction(async (tx) => {
    // One save at a time per reader and institution, so two answers finishing together
    // cannot both miss each other and insert two rows.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`hamilton_saved_analyses:${input.userId}:${input.institutionId}`}))`;
    const recent = await tx<{ id: string }[]>`
      SELECT id::text FROM hamilton_saved_analyses
       WHERE user_id = ${input.userId} AND institution_id = ${input.institutionId}
         AND analysis_focus = ${input.analysisFocus} AND status = 'active'
         AND lower(btrim(regexp_replace(coalesce(prompt, ''), '[[:space:]]+', ' ', 'g')))
             = lower(btrim(regexp_replace(${input.prompt}::text, '[[:space:]]+', ' ', 'g')))
         AND created_at > NOW() - make_interval(secs => ${DUPLICATE_SAVE_WINDOW_SECONDS}::double precision)
       ORDER BY created_at DESC
       LIMIT 1
    `;
    const existing = recent[0]?.id;
    if (!existing) return insertRow(tx, input);
    const rows = await tx<{ id: string }[]>`
      UPDATE hamilton_saved_analyses
         SET title = ${input.title}, response_json = ${JSON.stringify(input.response)}, updated_at = NOW()
       WHERE id::text = ${existing}
      RETURNING id::text
    `;
    return rows[0]?.id ?? null;
  });
}

async function insertRow(db: typeof sql, input: SavedAnalysisInput): Promise<string | null> {
  const rows = await db<{ id: string }[]>`
    INSERT INTO hamilton_saved_analyses (user_id, institution_id, title, analysis_focus, prompt, response_json, status)
    VALUES (${input.userId}, ${input.institutionId}, ${input.title}, ${input.analysisFocus}, ${input.prompt},
            ${JSON.stringify(input.response)}, 'active')
    RETURNING id::text
  `;
  return rows[0]?.id ?? null;
}

/** Atomically updates only an active saved answer owned by this user for this research subject. */
export async function updateSavedAnalysisResponse(userId: number, id: string, institutionId: string, response: AnalyzeResponse): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE hamilton_saved_analyses
       SET response_json = ${JSON.stringify(response)}, updated_at = NOW()
     WHERE id::text = ${id} AND user_id = ${String(userId)} AND institution_id::text = ${institutionId} AND status = 'active'
    RETURNING id::text
  `;
  return rows.length > 0;
}

export async function getSavedAnalysisResponse(userId: number, id: string, institutionId: string): Promise<AnalyzeResponse | null> {
  const rows = await sql<{ response_json: AnalyzeResponse | string }[]>`
    SELECT response_json FROM hamilton_saved_analyses
     WHERE id::text = ${id} AND user_id = ${String(userId)} AND institution_id::text = ${institutionId} AND status = 'active'
  `;
  const raw = rows[0]?.response_json;
  if (!raw) return null;
  const parsed = typeof raw === "string" ? (JSON.parse(raw) as AnalyzeResponse) : raw;
  return normalizeLegacyAnalyzeConfidence(parsed);
}
