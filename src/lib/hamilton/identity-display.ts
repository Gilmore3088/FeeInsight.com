import type { HamiltonIdentitySnapshot } from "./account-context";

/** Read both minimal historical v1 records and current named snapshots. Never resolve from today's settings. */
export function readHamiltonIdentitySnapshot(value: unknown): HamiltonIdentitySnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const validId = (id: unknown) => id === null || (typeof id === "number" && Number.isSafeInteger(id) && id > 0);
  if (row.version !== 1 || !validId(row.researchInstitutionId) || !validId(row.accountInstitutionId)
    || !["identified", "unlinked", "ambiguous", "unavailable"].includes(String(row.accountStatus))) return null;
  const out: HamiltonIdentitySnapshot = {
    version: 1,
    researchInstitutionId: row.researchInstitutionId as number | null,
    accountInstitutionId: row.accountInstitutionId as number | null,
    accountStatus: row.accountStatus as HamiltonIdentitySnapshot["accountStatus"],
  };
  for (const key of ["researchInstitutionName", "accountInstitutionName", "researchSelectionSource", "peerBaselineLabel", "peerBaselineSource", "peerBaselineFallbackReason", "peerGroupCoverage"] as const) {
    if (row[key] === null || typeof row[key] === "string") out[key] = row[key] as string | null;
  }
  if (validId(row.peerSetId)) out.peerSetId = row.peerSetId as number | null;
  return out;
}

/** How the peer group was chosen, in words; the default group needs no note. How the subject was picked stays in the record. */
function peerSourceNote(source: string | null | undefined): string {
  if (source === "saved-peer-set" || source === "saved_peer_set") return " (saved peer group)";
  if (source === "national") return " (national index)";
  return "";
}

export function hamiltonIdentityLines(snapshot: HamiltonIdentitySnapshot | null | undefined): string[] {
  if (!snapshot) return [];
  const name = (label: string | null | undefined, id: number | null) => label || (id ? `Institution ${id}` : "Not selected");
  return [
    `Research institution: ${name(snapshot.researchInstitutionName, snapshot.researchInstitutionId)}`,
    `Account institution: ${snapshot.accountStatus === "identified" && snapshot.accountInstitutionId
      ? name(snapshot.accountInstitutionName, snapshot.accountInstitutionId)
      : snapshot.accountStatus === "ambiguous" ? "Multiple memberships; not selected" : snapshot.accountStatus === "unavailable" ? "Could not be verified" : "Not linked"}`,
    `Peer baseline: ${snapshot.peerBaselineLabel || "Not recorded"}${peerSourceNote(snapshot.peerBaselineSource)}${snapshot.peerGroupCoverage ? `. ${snapshot.peerGroupCoverage}` : ""}`,
    ...(snapshot.peerBaselineFallbackReason ? [`Peer baseline note: ${snapshot.peerBaselineFallbackReason}`] : []),
  ];
}
