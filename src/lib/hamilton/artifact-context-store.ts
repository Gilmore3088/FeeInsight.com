import { sql } from "@/lib/data-store/connection";
import { normalizeCanonicalInstitutionId } from "@/lib/hamilton/context-link";
import { isSavedArtifactId, type HamiltonArtifactContextLookup } from "@/lib/hamilton/artifact-context";

export async function getHamiltonArtifactInstitutionId(params: {
  userId: number;
  lookup: HamiltonArtifactContextLookup | null;
}): Promise<string | null> {
  if (!params.lookup) return null;
  // A malformed id names no saved artifact; it is not a failed read.
  if (!isSavedArtifactId(params.lookup.artifactId)) return null;

  if (params.lookup.kind === "peer-research") {
    const rows = await sql`
      SELECT institution_id, response_json -> 'peerListSnapshot' AS peer_list_snapshot
      FROM hamilton_saved_analyses
      WHERE id = ${params.lookup.artifactId}
        AND user_id = ${params.userId}
        AND status = 'active'
      LIMIT 1
    `;
    const institutionId = normalizeCanonicalInstitutionId(rows[0]?.institution_id);
    const snapshot = rows[0]?.peer_list_snapshot;
    // The saved page's structural checks also govern the shell; an ordinary analysis is not peer research.
    if (!institutionId || !snapshot || snapshot.version !== 1 || snapshot.status !== "ready"
      || !snapshot.subject || String(snapshot.subject.institutionId) !== institutionId || !Array.isArray(snapshot.rows)) return null;
    return institutionId;
  }

  if (params.lookup.kind === "analysis") {
    const rows = await sql`
      SELECT institution_id
      FROM hamilton_saved_analyses
      WHERE id = ${params.lookup.artifactId}
        AND user_id = ${params.userId}
        AND status = 'active'
      LIMIT 1
    `;
    return normalizeCanonicalInstitutionId(rows[0]?.institution_id);
  }

  if (params.lookup.kind === "report") {
    const rows = await sql`
      SELECT institution_id
      FROM hamilton_reports
      WHERE id = ${params.lookup.artifactId}
        AND user_id = ${params.userId}
        AND status = 'generated'
      LIMIT 1
    `;
    return normalizeCanonicalInstitutionId(rows[0]?.institution_id);
  }

  const rows = await sql`
    SELECT institution_id
    FROM hamilton_scenarios
    WHERE id = ${params.lookup.artifactId}
      AND user_id = ${params.userId}
      AND status = 'active'
    LIMIT 1
  `;
  return normalizeCanonicalInstitutionId(rows[0]?.institution_id);
}
