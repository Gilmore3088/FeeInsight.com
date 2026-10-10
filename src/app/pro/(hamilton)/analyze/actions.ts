"use server";

import { sql } from "@/lib/data-store/connection";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { getInstitutionById } from "@/lib/data-store";
import { loadHamiltonAccountContext } from "@/lib/hamilton/account-context-store";
import { accountIdentitySnapshot } from "@/lib/hamilton/account-context";
import { readHamiltonIdentitySnapshot } from "@/lib/hamilton/identity-display";
import { normalizeCanonicalInstitutionId } from "@/lib/hamilton/context-link";
import type { AnalyzeResponse } from "@/lib/hamilton/types";
import { recentQuestions, type RecentQuestion, type SavedAnalysisRow } from "@/lib/hamilton/recent-analyses";

export interface LoadedAnalysisRecord {
  id: string;
  responseJson: AnalyzeResponse;
  institutionId: string | null;
  analysisFocus: string | null;
  /** The question the answer was asked with. */
  prompt: string | null;
}

/**
 * Save a completed analysis to hamilton_saved_analyses.
 * Only accessible to premium/admin users (enforced server-side).
 * Auto-derives title from prompt if not provided.
 * Returns the new analysis ID on success.
 */
export async function saveAnalysis(params: {
  institutionId: string;
  title?: string;
  analysisFocus: string;
  prompt: string;
  responseJson: AnalyzeResponse;
}): Promise<{ id: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) {
    return { error: "Active subscription required" };
  }

  // Derive title: use explicit title, or first 60 chars of the prompt
  const title =
    params.title?.trim() ||
    params.responseJson.title ||
    params.prompt.slice(0, 60).trim() + (params.prompt.length > 60 ? "…" : "");
  const institutionId = normalizeCanonicalInstitutionId(params.institutionId) ?? "";

  try {
    const institution = institutionId ? await getInstitutionById(Number(institutionId)) : null;
    if (institutionId && !institution) return { error: "Selected institution not found" };
    // The normal answer path saves on the server at generation time. This fallback
    // captures membership at SAVE time, never treats browser metadata as authority,
    // and does not silently substitute today's peer baseline for the original one.
    const account = await loadHamiltonAccountContext(user);
    const responseJson: AnalyzeResponse = {
      ...params.responseJson,
      identityContext: accountIdentitySnapshot(institution?.id ?? null, account, {
        researchInstitutionName: institution?.institution_name ?? null,
        researchSelectionSource: "Captured at save; generation-time account and peer context unavailable",
        peerBaselineLabel: null,
        peerBaselineSource: null,
        peerSetId: null,
        peerBaselineFallbackReason: "Original peer baseline was not authenticated in the fallback save.",
      }),
    };
    // Browser snapshots never choose the account institution.
    const rows = await sql<{ id: string }[]>`
      INSERT INTO hamilton_saved_analyses (
        user_id,
        institution_id,
        title,
        analysis_focus,
        prompt,
        response_json,
        status
      ) VALUES (
        ${user.id},
        ${institutionId},
        ${title},
        ${params.analysisFocus},
        ${params.prompt},
        ${JSON.stringify(responseJson)},
        'active'
      )
      RETURNING id::text
    `;

    const id = rows[0]?.id;
    if (!id) return { error: "Failed to save analysis" };
    return { id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    return { error: message };
  }
}

/**
 * List saved analyses for the current user.
 * Used for left rail and in-page refresh after saving.
 */
export async function listSavedAnalyses(limit = 10): Promise<RecentQuestion[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  try {
    // Read a few extra so repeats of the same answer don't leave the list short.
    const rows = await sql<SavedAnalysisRow[]>`
      SELECT id::text, title, prompt, institution_id, updated_at::text
      FROM hamilton_saved_analyses
      WHERE user_id = ${user.id} AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT ${limit * 3}
    `;
    return recentQuestions(rows, limit);
  } catch {
    return [];
  }
}

export async function loadAnalysisRecord(id: string): Promise<LoadedAnalysisRecord | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  try {
    const rows = await sql<Array<{ id: string; response_json: string; institution_id: string | null; analysis_focus: string | null; prompt: string | null }>>`
      SELECT id::text, response_json::text, institution_id, analysis_focus, prompt
      FROM hamilton_saved_analyses
      WHERE id = ${id}::uuid
        AND user_id = ${user.id}
        AND status = 'active'
      LIMIT 1
    `;
    if (!rows[0]) return null;
    const responseJson = JSON.parse(rows[0].response_json) as AnalyzeResponse & { hamiltonIdentity?: unknown };
    // Older server-written answers stored the same version-1 snapshot under this alias.
    const snapshot = readHamiltonIdentitySnapshot(responseJson.identityContext ?? responseJson.hamiltonIdentity);
    if (snapshot) responseJson.identityContext = snapshot;
    return {
      id: rows[0].id,
      responseJson,
      institutionId: normalizeCanonicalInstitutionId(rows[0].institution_id),
      analysisFocus: rows[0].analysis_focus,
      prompt: rows[0].prompt,
    };
  } catch {
    return null;
  }
}

/**
 * Load a single saved analysis by ID for the current user.
 * Scoped by user_id — cannot load another user's analysis (T-51-02).
 * UUID cast on id rejects malformed strings before they reach the DB (T-51-03).
 * Returns the stored AnalyzeResponse or null if not found or unauthorized.
 */
export async function loadAnalysis(id: string): Promise<AnalyzeResponse | null> {
  const record = await loadAnalysisRecord(id);
  return record?.responseJson ?? null;
}
