import type { V1Caller } from "@/lib/api-v1-auth";
import { getInstitutionById } from "@/lib/data-store/core";
import { getSavedPeerSets, getSavedPeerSetById, type SavedPeerSet } from "@/lib/data-store/saved-peers";
import { getHamiltonWorkspaceContext } from "@/lib/hamilton/workspace-context";
import { loadHamiltonAccountContext } from "@/lib/hamilton/account-context-store";
import { getActivePeerSet, parseSavedPeerSetFilters } from "@/lib/hamilton/peer-index";

export class V1ContextError extends Error {
  constructor(
    public readonly status: 403 | 404 | 503,
    public readonly code: "account_context_required" | "not_found" | "context_unavailable",
    message: string,
  ) { super(message); }
}

/** A valid unmapped key must never borrow the browser's signed-in identity. */
export function v1ContextUserId(caller: V1Caller): number | null {
  const id = caller.auth.valid ? caller.auth.subscriberUserId : caller.user?.id;
  return id != null && Number.isSafeInteger(Number(id)) && Number(id) > 0 ? Number(id) : null;
}

export function requireV1ContextUserId(caller: V1Caller): number {
  const id = v1ContextUserId(caller);
  if (id === null) throw new V1ContextError(403, "account_context_required", "Use your personal Hamilton subscriber API key to access saved institution and peer settings.");
  return id;
}

export function contextUnavailable(): V1ContextError {
  return new V1ContextError(503, "context_unavailable", "Your saved Hamilton settings could not be loaded. Please try again.");
}

/** Saved research preference first; an unambiguous current account institution otherwise. */
export async function getV1HamiltonInstitution(userId: number): Promise<{
  institution: { id: number; name: string } | null;
  source: string;
}> {
  try {
    const saved = await getHamiltonWorkspaceContext(userId);
    if (saved?.selectedInstitutionId) {
      // Use the underlying reader so a failed read is not converted to "no selection".
      const institution = await getInstitutionById(saved.selectedInstitutionId);
      if (!institution) throw contextUnavailable();
      return { institution: { id: Number(institution.id), name: institution.institution_name }, source: saved.selectedSource };
    }
    const account = await loadHamiltonAccountContext({ id: userId });
    if (account.status === "unavailable") throw contextUnavailable();
    return { institution: account.institution, source: account.institution ? "account" : "none" };
  } catch { throw contextUnavailable(); }
}

/** Reuses Hamilton's default precedence and its current per-workspace membership checks. */
export async function getV1SavedPeerSet(userId: number, institutionId: number | null, setId?: number | null): Promise<SavedPeerSet | null> {
  try {
    const id = setId ?? (await getActivePeerSet({ userId, institutionId }))?.id;
    if (id == null) return null;
    const set = await getSavedPeerSetById(id, String(userId));
    if (!set) {
      if (setId == null) throw contextUnavailable();
      throw new V1ContextError(404, "not_found", "Saved peer set not found or unavailable to this account.");
    }
    return set;
  } catch (error) {
    if (error instanceof V1ContextError) throw error;
    throw contextUnavailable();
  }
}

export function v1SavedPeerSetFilters(set: SavedPeerSet) {
  const filters = parseSavedPeerSetFilters(set);
  return {
    ...(filters.charter_type ? { charter_type: filters.charter_type } : {}),
    ...(filters.asset_tiers ? { asset_tiers: filters.asset_tiers } : {}),
    ...(filters.fed_districts ? { fed_districts: filters.fed_districts } : {}),
    ...(filters.states ? { states: filters.states } : {}),
    ...(filters.institutionIds ? { institution_ids: filters.institutionIds } : {}),
  };
}

export async function getV1HamiltonContext(userId: number) {
  try {
    const selected = await getV1HamiltonInstitution(userId);
    const institutionId = selected.institution?.id ?? null;
    const [sets, active] = await Promise.all([
      getSavedPeerSets(String(userId), institutionId),
      getV1SavedPeerSet(userId, institutionId),
    ]);
    return {
      institution: selected.institution,
      institution_source: selected.source,
      peer_sets: sets.map((set) => ({
        id: set.id, name: set.name,
        scope: set.institution_id === null ? "personal" as const : "workspace" as const,
        workspace_institution_id: set.institution_id,
        is_default: set.is_default,
        filters: v1SavedPeerSetFilters(set),
      })),
      active_peer_set_id: active?.id ?? null,
    };
  } catch (error) {
    if (error instanceof V1ContextError) throw error;
    throw contextUnavailable();
  }
}

/** Private settings are read afresh, including after seat removal or a website edit. */
export function withPrivateV1Context<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Authorization, Cookie");
  response.headers.delete("ETag");
  return response;
}
