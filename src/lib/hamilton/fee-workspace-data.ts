/**
 * Everything the Research and Model screens need for one bank and one fee, read once: the bank's
 * own published fees, every institution's value for the fee, the bank's local market, and the
 * layer summaries built from them. Missing pieces come back null rather than failing the page.
 */
import { unstable_cache } from "next/cache";
import { getInstitutionFeeValues } from "@/lib/data-store/fee-index";
import {
  getCategoryPeerAmounts,
  getInstitutionFeeEvidence,
  getLocalMarketBanks,
  type FeeEvidenceRow,
  type LocalMarket,
  type PeerAmount,
} from "@/lib/data-store/fee-research";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { plainFeeName } from "./briefing-observations";
import type { HamiltonSelectedInstitutionContext } from "./institution-context";
import { resolveHamiltonInstitutionContext } from "./workspace-context";
import { buildLayers, inLayer, type LayerInstitution, type LayerSummary } from "./research-layers";

/** Fees Hamilton leads with, in this order, when the bank publishes them. */
export const FEATURED_FEES = [
  "overdraft",
  "nsf",
  "monthly_maintenance",
  "atm_non_network",
  "wire_domestic_outgoing",
  "stop_payment",
  "card_foreign_txn",
  "paper_statement",
] as const;

/** One national read per fee, shared across banks for an hour. */
const getCachedPeerAmounts = unstable_cache(
  (category: string) => getCategoryPeerAmounts(category),
  ["hamilton-fee-peer-amounts"],
  { revalidate: 3600 },
);

export interface FeeWorkspace {
  institution: HamiltonSelectedInstitutionContext | null;
  /** The bank's published fees, featured fees first. */
  ownFees: { category: string; name: string; amount: number }[];
  fee: string;
  feeName: string;
  ownAmount: number | null;
  peers: PeerAmount[];
  local: LocalMarket | null;
  layers: LayerSummary[];
  /** The bank's own published rows for the fee, for the audit trail. */
  ownFeeRows: FeeEvidenceRow[];
  /** Set when a read failed, so the page can say so instead of showing zeros. */
  unavailable: string[];
}

export function feeName(category: string): string {
  return plainFeeName(getDisplayName(category));
}

export async function loadFeeWorkspace(params: {
  userId: number;
  instId?: string | null;
  fee?: string | null;
  intent: string;
}): Promise<FeeWorkspace> {
  const unavailable: string[] = [];
  const { institution } = await resolveHamiltonInstitutionContext({
    userId: params.userId,
    instId: params.instId ?? null,
    intent: params.intent,
  }).catch(() => ({ institution: null }));

  const ownValues = institution
    ? await getInstitutionFeeValues(institution.id).catch(() => {
        unavailable.push("your published fees");
        return new Map<string, number>();
      })
    : new Map<string, number>();

  const rank = (c: string) => {
    const i = (FEATURED_FEES as readonly string[]).indexOf(c);
    return i === -1 ? FEATURED_FEES.length : i;
  };
  const ownFees = [...ownValues.entries()]
    .map(([category, amount]) => ({ category, name: feeName(category), amount }))
    .sort((a, b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name));

  const fee = params.fee && /^[a-z0-9_]+$/.test(params.fee) ? params.fee : (ownFees[0]?.category ?? "overdraft");
  const ownAmount = ownValues.get(fee) ?? null;

  const [peers, local, ownFeeRows] = await Promise.all([
    getCachedPeerAmounts(fee).catch(() => {
      unavailable.push("market fees");
      return [] as PeerAmount[];
    }),
    institution
      ? getLocalMarketBanks(institution.id, fee).catch(() => {
          unavailable.push("your local market");
          return null;
        })
      : null,
    institution && ownAmount != null
      ? getInstitutionFeeEvidence(institution.id, fee).catch(() => {
          unavailable.push("your fee's source lines");
          return [] as FeeEvidenceRow[];
        })
      : ([] as FeeEvidenceRow[]),
  ]);

  const localAmounts = local
    ? local.banks.filter((b) => !b.isSelf && b.feeAmount != null).map((b) => b.feeAmount as number)
    : null;

  const layers = institution
    ? buildLayers(
        {
          id: institution.id,
          stateCode: institution.stateCode,
          charterType: institution.charterType,
          fedDistrict: institution.fedDistrict,
          assetTier: institution.assetTier,
        },
        peers,
        ownAmount,
        localAmounts,
      )
    : buildLayers({ id: -1, stateCode: null, charterType: null, fedDistrict: null, assetTier: null }, peers, null, null);

  return { institution, ownFees, fee, feeName: feeName(fee), ownAmount, peers, local, layers, ownFeeRows, unavailable };
}

/** Publish dates of the institutions in one layer, for the trail's "as of" range. */
export function layerDates(ws: FeeWorkspace, layer: LayerSummary): (string | null)[] {
  if (layer.key === "local") return [];
  return layerPeers(ws, layer).map((p) => p.publishedAt);
}

/** The institutions behind a non-local layer (the bank itself left out), matching buildLayers. */
export function layerPeers(ws: FeeWorkspace, layer: LayerSummary): PeerAmount[] {
  const inst = ws.institution;
  if (!inst) return layer.key === "national" ? ws.peers : [];
  const self: LayerInstitution = {
    id: inst.id,
    stateCode: inst.stateCode,
    charterType: inst.charterType,
    fedDistrict: inst.fedDistrict,
    assetTier: inst.assetTier,
  };
  return ws.peers.filter((p) => p.institutionId !== inst.id && inLayer(layer.key, self, p));
}
