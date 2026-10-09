import { getUserInstitutionMemberships } from "./institution-membership";
import { accountContextFromMemberships, accountProfileLabel, type HamiltonAccountContext } from "./account-context";
import type { HamiltonRequestContract } from "./request-contract";

type AccountUser = { id: number; institution_name?: string | null };

/** Read only the authenticated user's current memberships; do not cache across requests. */
export async function loadHamiltonAccountContext(user: AccountUser): Promise<HamiltonAccountContext> {
  try {
    const memberships = await getUserInstitutionMemberships(user.id);
    return accountContextFromMemberships(user.id, memberships, user.institution_name);
  } catch {
    // A failed read is not proof that no membership exists. Never fall back to the
    // research subject, a browser ownership claim, or a string-matched profile name.
    return { status: "unavailable", institution: null, profileLabel: accountProfileLabel(user.institution_name) };
  }
}

/** Enrich a parsed request on the server. Client-supplied context cannot win this merge. */
export async function withHamiltonAccountContext(
  contract: HamiltonRequestContract,
  user: AccountUser,
): Promise<HamiltonRequestContract & { serverAccountContext: HamiltonAccountContext }> {
  const serverAccountContext = await loadHamiltonAccountContext(user);
  return {
    ...contract,
    // With no explicit research subject, one unambiguous account institution may
    // provide the default. This does not write the saved research preference.
    institutionId: contract.institutionId ?? serverAccountContext.institution?.id ?? null,
    serverAccountContext,
  };
}
