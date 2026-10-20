"use server";

import type { ReactNode } from "react";
import { getInstitutionPeerSetsCached, getPeerExplorerSetCached } from "@/lib/data-store/public-cached-reads";
import { FEE_FAMILIES } from "@/lib/fee-taxonomy";
import { isHomeMetroKey } from "@/lib/peer-explorer";
import { createReadBudget } from "@/lib/read-deadline";
import { PAGE_READ_BUDGET_MS } from "./profile-budget";
import { PeerExplorerSection, peerSetHrefs } from "./peer-explorer-section";

/**
 * The peer explorer for a set, fee, view or peer other than the cached page's default (#1811).
 * The institution page is cached and never reads its query string, so `?peers=`, `?peer=`,
 * `?pfee=` and `?pview=` are read in the browser (peer-explorer-island.tsx), which asks here.
 * Public data only, from the same cached reads as the page: no per-request database read on a
 * warm cache.
 */

const TAXONOMY = new Set<string>(Object.values(FEE_FAMILIES).flat());
/** A query value as the explorer accepts it: short, or nothing. */
const value = (raw: unknown, max = 40): string | null => (typeof raw === "string" && raw.length > 0 && raw.length <= max ? raw : null);

export async function loadPeerExplorerSection(input: {
  institutionId: number;
  peers?: string | null;
  peer?: string | null;
  pfee?: string | null;
  pview?: string | null;
  fee?: string | null;
}): Promise<ReactNode> {
  const { institutionId } = input;
  if (typeof institutionId !== "number" || !Number.isInteger(institutionId) || institutionId <= 0) return null;
  const budget = createReadBudget(PAGE_READ_BUDGET_MS, "Institution peer explorer");
  const sets = await budget.optional(() => getInstitutionPeerSetsCached(institutionId, value(input.peers)), "peer sets", null);
  if (!sets) return null;
  const set = await budget.optional(
    () => getPeerExplorerSetCached(institutionId, sets.selectedFilters, isHomeMetroKey(sets.selected.key)),
    "peer explorer",
    null,
  );
  if (!set) return null;
  const fee = value(input.fee, 80);
  return (
    <PeerExplorerSection
      sets={sets}
      set={set}
      hrefFor={peerSetHrefs(institutionId, fee && TAXONOMY.has(fee) ? fee : null)}
      initial={{ peer: value(input.peer, 12), fee: value(input.pfee), view: value(input.pview) }}
    />
  );
}
