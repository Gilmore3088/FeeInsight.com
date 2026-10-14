"use server";

import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { normalizeCanonicalInstitutionId } from "./context-link";
import { getHamiltonInstitutionContext } from "./institution-context";
import { resolveHamiltonInstitutionContext } from "./workspace-context";

/** Canonical public identity only; navigation never changes the user's research preference. */
export async function loadHamiltonNavigationInstitution(
  value: string | null,
): Promise<{ id: string; name: string } | null> {
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
    return { id: resolvedId, name };
  } catch {
    return null;
  }
}
