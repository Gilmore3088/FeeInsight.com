/** Reference identity only. Neither a profile label nor this snapshot grants access. */
export interface HamiltonAccountContext {
  status: "identified" | "unlinked" | "ambiguous" | "unavailable";
  institution: { id: number; name: string } | null;
  /** Self-reported profile text, never a canonical institution ID or membership. */
  profileLabel: string | null;
}

export interface HamiltonMembershipIdentity {
  userId: number;
  institutionId: number;
  institutionName: string;
  status: string;
}

export function accountProfileLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.replace(/\s+/g, " ").trim().slice(0, 160) || null;
}

/** No browsing/URL/preference input: those must never choose who 'we' means. */
export function accountContextFromMemberships(
  userId: number,
  memberships: readonly HamiltonMembershipIdentity[],
  profileLabel?: unknown,
): HamiltonAccountContext {
  const institutions = new Map<number, string>();
  for (const membership of memberships) {
    if (membership.userId !== userId || membership.status !== "active") continue;
    if (!Number.isSafeInteger(membership.institutionId) || membership.institutionId <= 0) continue;
    const name = accountProfileLabel(membership.institutionName);
    if (name && !institutions.has(membership.institutionId)) institutions.set(membership.institutionId, name);
  }
  if (institutions.size === 1) {
    const [id, name] = [...institutions][0];
    return { status: "identified", institution: { id, name }, profileLabel: null };
  }
  return {
    status: institutions.size > 1 ? "ambiguous" : "unlinked",
    institution: null,
    profileLabel: accountProfileLabel(profileLabel),
  };
}

/** Minimal historical reference snapshot; never reuse it as an authorization check. */
export function accountIdentitySnapshot(subjectInstitutionId: number | null, context: HamiltonAccountContext) {
  return {
    version: 1 as const,
    researchInstitutionId: subjectInstitutionId,
    accountInstitutionId: context.institution?.id ?? null,
    accountStatus: context.status,
  };
}
