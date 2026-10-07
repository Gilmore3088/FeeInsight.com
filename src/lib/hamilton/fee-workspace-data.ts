/**
 * Everything the Research and Model screens need for one bank and one fee, read once: the bank's
 * own published fees and the Hamilton engine's research for the fee (every market layer, the
 * local market and its named competitors, filings and rules), so each figure on screen has one
 * source. Missing pieces come back empty rather than failing the page.
 */
import { getInstitutionFeeValues } from "@/lib/data-store/fee-index";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { plainFeeName } from "./briefing-observations";
import type { HamiltonSelectedInstitutionContext } from "./institution-context";
import { resolveHamiltonInstitutionContext } from "./workspace-context";
import { layersFromEngine, summarizeLayer, type LayerSummary } from "./research-layers";
import { getFeeResearch } from "./workspace/research";
import type { FeeResearch, LocalMarketInfo, OwnFeeRow, PeerValue } from "./workspace/types";

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

/** The bank's local market as the engine draws it, with the competitors that publish this fee. */
export interface WorkspaceLocal extends LocalMarketInfo {
  /** Largest market deposits first; deposits are null for credit unions outside the Summary of Deposits. */
  competitors: PeerValue[];
}

export interface FeeWorkspace {
  institution: HamiltonSelectedInstitutionContext | null;
  /** The bank's published fees, featured fees first. */
  ownFees: { category: string; name: string; amount: number }[];
  fee: string;
  feeName: string;
  ownAmount: number | null;
  /** The engine's research for this fee; null without an institution or when it couldn't load. */
  research: FeeResearch | null;
  local: WorkspaceLocal | null;
  layers: LayerSummary[];
  /** The bank's own published rows for the fee, for the audit trail. */
  ownFeeRows: OwnFeeRow[];
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

  const research = institution
    ? await getFeeResearch(institution.id, fee).catch(() => {
        unavailable.push("market fees");
        return null;
      })
    : null;
  const ownFeeRows = research?.ownRows ?? [];

  const local: WorkspaceLocal | null =
    research?.localMarket ? { ...research.localMarket, competitors: research.localCompetitors ?? [] } : null;
  const layers = research
    ? layersFromEngine(research.layers, ownAmount, research.localMarket)
    : [summarizeLayer("national", "National", "Every institution with this fee published", [], null)];

  return { institution, ownFees, fee, feeName: feeName(fee), ownAmount, research, local, layers, ownFeeRows, unavailable };
}

/** Every member's publish date, so the trail's "as of" spans oldest to newest; the engine's date otherwise. */
export function layerDates(_ws: FeeWorkspace, layer: LayerSummary): (string | null)[] {
  const dates = (layer.members ?? []).map((m) => m.publishedAt);
  return dates.some(Boolean) ? dates : [layer.asOf ?? null];
}
