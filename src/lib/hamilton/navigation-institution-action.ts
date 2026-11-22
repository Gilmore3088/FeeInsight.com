"use server";

import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { normalizeCanonicalInstitutionId } from "./context-link";
import { getHamiltonInstitutionContext } from "./institution-context";
import { resolveHamiltonInstitutionContext } from "./workspace-context";
import { institutionFacts } from "./institution-facts";
import { getHamiltonArtifactContextLookup } from "./artifact-context";
import { getHamiltonArtifactInstitutionId } from "./artifact-context-store";

/** Canonical public identity only; navigation never changes the user's research preference. */
export async function loadHamiltonNavigationInstitution(
  value: string | null,
): Promise<{ id: string; name: string; facts: string | null } | null> {
  try {
    const user = await getCurrentUser();
    if (!user || !canAccessPremium(user) || (value !== null && typeof value !== "string")) return null;
    const id = normalizeCanonicalInstitutionId(value);
    if (value !== null && !id) return null;

    const { institution } = id
      ? await getHamiltonInstitutionContext(id)
      : await resolveHamiltonInstitutionContext({ userId: user.id, persistUrlSelection: false });
    const resolvedId = normalizeCanonicalInstitutionId(institution?.id);
    const name = typeof institution?.name === "string" ? institution.name.trim() : "";
    if (!resolvedId || (id !== null && resolvedId !== id) || !name) return null;
    // State, charter and size, so the context bar says which institution this is (#2043).
    const facts = institutionFacts({ stateCode: institution?.stateCode, charterType: institution?.charterType, segment: institution?.assetTier });
    return { id: resolvedId, name, facts };
  } catch {
    return null;
  }
}

/** Re-resolve a retained shell's saved record under the current account, without preference fallback. */
export async function loadHamiltonArtifactNavigationInstitution(
  pathname: string,
  search: string,
): Promise<{ id: string; name: string; facts: string | null } | null> {
  try {
    if (typeof pathname !== "string" || pathname.length > 1024 || typeof search !== "string" || search.length > 8192) return null;
    const lookup = getHamiltonArtifactContextLookup({ pathname, searchParams: new URLSearchParams(search) });
    if (!lookup) return null;
    const user = await getCurrentUser();
    if (!user || !canAccessPremium(user)) return null;
    const id = await getHamiltonArtifactInstitutionId({ userId: user.id, lookup });
    if (!id) return null;
    const { institution } = await getHamiltonInstitutionContext(id);
    const resolvedId = normalizeCanonicalInstitutionId(institution?.id);
    const name = typeof institution?.name === "string" ? institution.name.trim() : "";
    if (resolvedId !== id || !name) return null;
    return { id, name, facts: institutionFacts({ stateCode: institution?.stateCode, charterType: institution?.charterType, segment: institution?.assetTier }) };
  } catch {
    return null;
  }
}
