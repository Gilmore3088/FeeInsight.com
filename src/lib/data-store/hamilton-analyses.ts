/**
 * Saved Hamilton analyses (hamilton_saved_analyses): the reader's history and the source
 * of "Add to report". The Ask engine files each storyline answer here once, and adds
 * Hamilton's memo to the same row when it is written.
 */

import { sql } from "./connection";
import type { AnalyzeResponse } from "@/lib/hamilton/types";
import { normalizeLegacyAnalyzeConfidence } from "@/lib/hamilton/evidence-contract";

export async function insertSavedAnalysis(input: {
  userId: number;
  institutionId: string;
  title: string;
  analysisFocus: string;
  prompt: string;
  response: AnalyzeResponse;
}): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO hamilton_saved_analyses (user_id, institution_id, title, analysis_focus, prompt, response_json, status)
    VALUES (${input.userId}, ${input.institutionId}, ${input.title}, ${input.analysisFocus}, ${input.prompt},
            ${JSON.stringify(input.response)}, 'active')
    RETURNING id::text
  `;
  return rows[0]?.id ?? null;
}

/** Replaces the saved response of one of the reader's own analyses; false when it is not theirs. */
export async function updateSavedAnalysisResponse(userId: number, id: string, response: AnalyzeResponse): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE hamilton_saved_analyses
       SET response_json = ${JSON.stringify(response)}, updated_at = NOW()
     WHERE id::text = ${id} AND user_id = ${String(userId)} AND status = 'active'
    RETURNING id::text
  `;
  return rows.length > 0;
}

export async function getSavedAnalysisResponse(userId: number, id: string): Promise<AnalyzeResponse | null> {
  const rows = await sql<{ response_json: AnalyzeResponse | string }[]>`
    SELECT response_json FROM hamilton_saved_analyses
     WHERE id::text = ${id} AND user_id = ${String(userId)} AND status = 'active'
  `;
  const raw = rows[0]?.response_json;
  if (!raw) return null;
  const parsed = typeof raw === "string" ? (JSON.parse(raw) as AnalyzeResponse) : raw;
  return normalizeLegacyAnalyzeConfidence(parsed);
}
