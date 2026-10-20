import { normalizeCanonicalInstitutionId } from "@/lib/hamilton/context-link";

export type HamiltonArtifactContextLookup =
  | { kind: "analysis"; artifactId: string }
  | { kind: "scenario"; artifactId: string }
  | { kind: "report"; artifactId: string };

// Saved analyses, scenarios and reports are keyed by Postgres uuid columns. Any other id text
// makes the query throw, so a hand-edited or truncated link must be caught before the read.
const SAVED_ARTIFACT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSavedArtifactId(value: string): boolean {
  return SAVED_ARTIFACT_ID_PATTERN.test(value);
}

function cleanArtifactId(value: string | null): string | null {
  const text = value?.trim();
  return text || null;
}

export function resolveArtifactContextInstitutionId(params: {
  urlInstitutionId?: string | null;
  artifactInstitutionId?: string | number | null;
  /** Saved-artifact views use the authorized record, never URL/default substitution. */
  preferArtifact?: boolean;
}): string | undefined {
  if (params.preferArtifact) {
    return normalizeCanonicalInstitutionId(params.artifactInstitutionId) ?? undefined;
  }
  if (params.urlInstitutionId) return params.urlInstitutionId;
  return normalizeCanonicalInstitutionId(params.artifactInstitutionId) ?? undefined;
}

export function shouldPersistUrlInstitutionSelection(
  urlInstitutionId?: string | null,
): boolean {
  return Boolean(urlInstitutionId);
}

export function getHamiltonArtifactContextLookup(params: {
  pathname: string;
  searchParams: URLSearchParams;
}): HamiltonArtifactContextLookup | null {
  if (params.pathname === "/pro/analyze") {
    const artifactId = cleanArtifactId(params.searchParams.get("analysis"));
    return artifactId ? { kind: "analysis", artifactId } : null;
  }
  if (params.pathname === "/pro/reports") {
    const reportId = cleanArtifactId(params.searchParams.get("report_id")) ?? cleanArtifactId(params.searchParams.get("report"));
    if (reportId) return { kind: "report", artifactId: reportId };
  }

  if (params.pathname === "/pro/simulate") {
    const artifactId =
      cleanArtifactId(params.searchParams.get("scenario_id")) ??
      cleanArtifactId(params.searchParams.get("scenario"));
    return artifactId ? { kind: "scenario", artifactId } : null;
  }

  // Report creation may be configured explicitly. Reopening a saved simulation,
  // analysis or report above always keeps the authorized artifact's institution.
  if (cleanArtifactId(params.searchParams.get("instId"))) return null;

  if (params.pathname === "/pro/reports") {
    const artifactId = cleanArtifactId(params.searchParams.get("scenario_id"));
    return artifactId ? { kind: "scenario", artifactId } : null;
  }

  return null;
}

/** A changed subject/artifact starts an isolated client state; edits within it do not. */
export function analyzeWorkspaceKey(params: {
  userId: number;
  institutionId?: string | number | null;
  analysisId?: string | null;
  question?: string | null;
  intent?: string | null;
  readOnly?: boolean;
}): string {
  return JSON.stringify([
    params.userId,
    normalizeCanonicalInstitutionId(params.institutionId),
    params.analysisId?.trim() || null,
    params.question ?? null,
    params.intent ?? null,
    Boolean(params.readOnly),
  ]);
}
