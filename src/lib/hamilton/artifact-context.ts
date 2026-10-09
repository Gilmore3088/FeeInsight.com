import { normalizeCanonicalInstitutionId } from "@/lib/hamilton/context-link";

export type HamiltonArtifactContextLookup =
  | { kind: "analysis"; artifactId: string }
  | { kind: "scenario"; artifactId: string }
  | { kind: "report"; artifactId: string };

function cleanArtifactId(value: string | null): string | null {
  const text = value?.trim();
  return text || null;
}

export function resolveArtifactContextInstitutionId(params: {
  urlInstitutionId?: string | null;
  artifactInstitutionId?: string | number | null;
  /** Saved-answer views use the authorized record, never URL/default substitution. */
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

  // An explicit institution may configure a scenario/report. It cannot retarget a
  // saved analysis; that lookup above is always authorized and resolved first.
  if (cleanArtifactId(params.searchParams.get("instId"))) return null;

  if (params.pathname === "/pro/simulate") {
    const artifactId =
      cleanArtifactId(params.searchParams.get("scenario_id")) ??
      cleanArtifactId(params.searchParams.get("scenario"));
    return artifactId ? { kind: "scenario", artifactId } : null;
  }

  if (params.pathname === "/pro/reports") {
    const reportId =
      cleanArtifactId(params.searchParams.get("report_id")) ??
      cleanArtifactId(params.searchParams.get("report"));
    if (reportId) return { kind: "report", artifactId: reportId };

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
