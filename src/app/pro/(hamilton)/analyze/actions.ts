"use server";

import { sql } from "@/lib/data-store/connection";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { getInstitutionById } from "@/lib/data-store";
import { loadHamiltonAccountContext } from "@/lib/hamilton/account-context-store";
import { accountIdentitySnapshot } from "@/lib/hamilton/account-context";
import { readHamiltonIdentitySnapshot } from "@/lib/hamilton/identity-display";
import { normalizeCanonicalInstitutionId } from "@/lib/hamilton/context-link";
import { normalizeLegacyAnalyzeConfidence } from "@/lib/hamilton/evidence-contract";
import { savedOutputChangeNotice } from "@/lib/hamilton/saved-output-notice";
import { collectFeeRefs, type SavedOutputNotice } from "@/lib/saved-output-corrections";
import { recordSavedOutputFeeRefs } from "@/lib/data-store/saved-output-fee-refs";
import type { AnalyzeResponse } from "@/lib/hamilton/types";
import { recentQuestions, type RecentQuestion, type SavedAnalysisRow } from "@/lib/hamilton/recent-analyses";

export interface LoadedAnalysisRecord {
  id: string;
  responseJson: AnalyzeResponse;
  institutionId: string | null;
  analysisFocus: string | null;
  /** The question the answer was asked with. */
  prompt: string | null;
  /** When the answer was first saved; a fee change after it gets a notice (H03-T09). */
  savedAt?: string | null;
  /** This institution's fee data changed after the answer was saved; the answer itself is unchanged. */
  changeNotice?: SavedOutputNotice | null;
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
  // Server actions receive caller-controlled values even when TypeScript declares a string.
  // A malformed explicit subject must not become an unscoped saved artifact.
  if (typeof params.institutionId !== "string") {
    return { error: "Select a valid research institution." };
  }
  const requestedId = params.institutionId.trim();
  const canonicalId = requestedId ? normalizeCanonicalInstitutionId(requestedId) : null;
  if (requestedId && !canonicalId) {
    return { error: "Select a valid research institution." };
  }
  const institutionId = canonicalId ?? "";

  try {
    const institution = institutionId ? await getInstitutionById(Number(institutionId)) : null;
    if (institutionId && !institution) return { error: "Selected institution not found" };
    // The normal answer path saves on the server at generation time. This fallback
    // captures membership at SAVE time, never treats browser metadata as authority,
    // and does not silently substitute today's peer baseline for the original one.
    const account = await loadHamiltonAccountContext(user);
    // Saved claims come only from the server's own save (#1077 step 6); a report reads them as
    // what the answer's records support, so a browser copy is never kept.
    const { claims: _browserClaims, ...browserResponse } = params.responseJson;
    void _browserClaims;
    const responseJson: AnalyzeResponse = {
      ...browserResponse,
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
    // H03-T09: the fee rows the saved answer names, so a later correction finds it.
    await recordSavedOutputFeeRefs(sql, "analysis", id, collectFeeRefs(responseJson));
    return { id };
  } catch (err) {
    // Do not return raw SQL/driver messages to an authenticated browser action; log them here.
    console.error("[hamilton-analyze] saving the analysis failed", err);
    return { error: "Could not save this analysis. Please try again." };
  }
}

/**
 * List saved analyses for the current user.
 * Used for left rail and in-page refresh after saving.
 */
export async function listSavedAnalyses(limit = 10): Promise<RecentQuestion[]> {
  // Callable server actions must not permit an unbounded history query.
  const boundedLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 50) : 10;
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) return [];

  try {
    // Read a few extra so repeats of the same answer don't leave the list short.
    const rows = await sql<SavedAnalysisRow[]>`
      SELECT a.id::text, a.title, a.prompt, a.institution_id, inst.institution_name, a.updated_at::text
      FROM hamilton_saved_analyses a
      LEFT JOIN institution_sources inst ON inst.id::text = a.institution_id
      WHERE a.user_id = ${user.id} AND a.status = 'active'
      ORDER BY a.updated_at DESC
      LIMIT ${boundedLimit * 3}
    `;
    return recentQuestions(rows, boundedLimit);
  } catch {
    return [];
  }
}

function savedAtIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isFinite(at.getTime()) ? at.toISOString() : null;
}

export async function loadAnalysisRecord(id: string): Promise<LoadedAnalysisRecord | null> {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) return null;

  try {
    const rows = await sql<Array<{ id: string; response_json: string; institution_id: string | null; analysis_focus: string | null; prompt: string | null; created_at?: Date | string | null }>>`
      SELECT id::text, response_json::text, institution_id, analysis_focus, prompt, created_at
      FROM hamilton_saved_analyses
      WHERE id = ${id}::uuid
        AND user_id = ${user.id}
        AND status = 'active'
      LIMIT 1
    `;
    if (!rows[0]) return null;
    // Display-only: older "high" ratings predate record-bound evidence; storage is never rewritten.
    const responseJson = normalizeLegacyAnalyzeConfidence(
      JSON.parse(rows[0].response_json) as AnalyzeResponse,
    ) as AnalyzeResponse & { hamiltonIdentity?: unknown };
    // Older server-written answers stored the same version-1 snapshot under this alias.
    const snapshot = readHamiltonIdentitySnapshot(responseJson.identityContext ?? responseJson.hamiltonIdentity);
    if (snapshot) responseJson.identityContext = snapshot;
    const institutionId = normalizeCanonicalInstitutionId(rows[0].institution_id);
    const savedAt = savedAtIso(rows[0].created_at);
    return {
      id: rows[0].id,
      responseJson,
      institutionId,
      analysisFocus: rows[0].analysis_focus,
      prompt: rows[0].prompt,
      savedAt,
      // H03-T09: a fee row this answer used (or, for an older answer, a fee at its institution)
      // changed after it was saved; the answer itself is unchanged.
      changeNotice: await savedOutputChangeNotice({ kind: "analysis", id: rows[0].id, institutionId, savedAt, noun: "answer" }),
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
