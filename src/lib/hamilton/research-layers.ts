/**
 * The market layers Hamilton's Research and Model screens move across: the bank's own local
 * market, its state, its Fed district, its peer group (charter and asset size) and the nation.
 * Built from one national read of a fee's per-institution values, so switching layers costs no
 * extra queries. Descriptive only: positions and spreads, never a suggested price.
 */
import type { PeerAmount } from "@/lib/data-store/fee-research";
import { DISTRICT_NAMES, FDIC_TIER_LABELS } from "@/lib/fed-districts";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/fee-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { median, peerPosition, quantile } from "./fee-scenario";

export const LAYER_KEYS = ["local", "state", "district", "peers", "national"] as const;
export type LayerKey = (typeof LAYER_KEYS)[number];

export interface LayerInstitution {
  id: number;
  stateCode: string | null;
  charterType: string | null;
  fedDistrict: number | null;
  assetTier: string | null;
}

export interface LayerSummary {
  key: LayerKey;
  label: string;
  /** Plain description of who is in the layer. */
  scope: string;
  n: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  zeroCount: number;
  /** Peers above, at and below the bank's own amount (excludes the bank). Null without its amount. */
  position: { more: number; same: number; less: number } | null;
  /** True when the layer has too few institutions for a median we'd publish. */
  thin: boolean;
  amounts: number[];
}

export function parseLayer(value: string | undefined | null): LayerKey {
  return (LAYER_KEYS as readonly string[]).includes(value ?? "") ? (value as LayerKey) : "state";
}

function charterWord(charter: string | null): string {
  return charter === "credit_union" ? "credit unions" : "banks";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function summarizeLayer(
  key: LayerKey,
  label: string,
  scope: string,
  amounts: number[],
  ownAmount: number | null,
): LayerSummary {
  const sorted = [...amounts].sort((a, b) => a - b);
  const pos = ownAmount == null ? null : peerPosition(sorted, ownAmount);
  return {
    key,
    label,
    scope,
    n: sorted.length,
    median: median(sorted),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
    zeroCount: sorted.filter((a) => a === 0).length,
    position: pos ? { more: pos.more, same: pos.same, less: pos.less } : null,
    thin: sorted.length < MIN_INSTITUTIONS_FOR_MEDIAN,
    amounts: sorted,
  };
}

/**
 * Every non-local layer for one fee. `peers` is the national read; the bank itself is left out of
 * its own comparison. `localAmounts` comes from the local market reader (banks in its counties).
 */
export function buildLayers(
  institution: LayerInstitution,
  peers: readonly PeerAmount[],
  ownAmount: number | null,
  localAmounts: number[] | null,
): LayerSummary[] {
  const others = peers.filter((p) => p.institutionId !== institution.id);
  const pick = (f: (p: PeerAmount) => boolean) => others.filter(f).map((p) => p.amount);
  const layers: LayerSummary[] = [];
  if (localAmounts) {
    layers.push(summarizeLayer("local", "Your market", "Banks with branches in your counties", localAmounts, ownAmount));
  }
  if (institution.stateCode) {
    const name = STATE_NAMES[institution.stateCode] ?? institution.stateCode;
    layers.push(
      summarizeLayer("state", name, `Banks and credit unions headquartered in ${name}`, pick((p) => p.stateCode === institution.stateCode), ownAmount),
    );
  }
  if (institution.fedDistrict != null) {
    const name = DISTRICT_NAMES[institution.fedDistrict] ?? `District ${institution.fedDistrict}`;
    layers.push(
      summarizeLayer("district", `${name} district`, `Institutions in the Federal Reserve Bank of ${name} district`, pick((p) => p.fedDistrict === institution.fedDistrict), ownAmount),
    );
  }
  if (institution.charterType && institution.assetTier) {
    const tier = FDIC_TIER_LABELS[institution.assetTier] ?? institution.assetTier;
    layers.push(
      summarizeLayer(
        "peers",
        "Peer group",
        `${capitalize(charterWord(institution.charterType))} in the ${tier} asset tier, nationwide`,
        pick((p) => p.charterType === institution.charterType && p.assetTier === institution.assetTier),
        ownAmount,
      ),
    );
  }
  layers.push(summarizeLayer("national", "National", "Every institution with this fee published", others.map((p) => p.amount), ownAmount));
  return layers;
}

/** "above 31 of 48" style sentence for a layer, without judging whether that's good or bad. */
export function describePosition(layer: LayerSummary, ownAmount: number | null): string | null {
  if (ownAmount == null || !layer.position || layer.n === 0) return null;
  const { more, same, less } = layer.position;
  const parts = [`${less} of ${layer.n} charge less`];
  if (same) parts.push(`${same} charge the same`);
  parts.push(`${more} charge more`);
  return parts.join(", ");
}
