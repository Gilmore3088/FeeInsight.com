/**
 * The saved-answer read, server side (#1077 step 6 review). Not a "use server" module, so nothing
 * here can be called from the browser: `readSavedAnalysisRecord` returns the stored response whole,
 * saved claims included, for server code that needs them (the report basket). Everything a browser
 * receives goes through `loadAnalysisRecord` / `loadAnalysis` in `analyze/actions.ts`, which drop
 * the claims (`withoutSavedClaims`).
 */

import { sql } from "@/lib/data-store/connection";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { readHamiltonIdentitySnapshot } from "@/lib/hamilton/identity-display";
import { normalizeCanonicalInstitutionId } from "@/lib/hamilton/context-link";
import { normalizeLegacyAnalyzeConfidence } from "@/lib/hamilton/evidence-contract";
import { savedOutputChangeNotice } from "@/lib/hamilton/saved-output-notice";
import type { SavedOutputNotice } from "@/lib/saved-output-corrections";
import type { AnalyzeResponse } from "@/lib/hamilton/types";

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

function savedAtIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isFinite(at.getTime()) ? at.toISOString() : null;
}

/** The saved answer with its claims dropped: what a browser may receive. */
export function withoutSavedClaims<T extends AnalyzeResponse>(response: T): T {
  if (!("claims" in response)) return response;
  const { claims: _claims, ...rest } = response;
  void _claims;
  return rest as T;
}

/** One saved answer of the current user, whole (saved claims included). Server code only. */
export async function readSavedAnalysisRecord(id: string): Promise<LoadedAnalysisRecord | null> {
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
