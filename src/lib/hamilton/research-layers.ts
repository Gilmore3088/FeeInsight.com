/**
 * The market layers Hamilton's Research and Model screens move across: the bank's own local
 * market, its state, its Fed district, its peer group (charter and asset size) and the nation.
 * Every layer comes from the Hamilton engine (`getFeeResearch(...).layers`), so the screens and
 * the engine show the same institutions. Descriptive only: positions and spreads, never a
 * suggested price.
 */
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/fee-stats";
import { median, peerPosition, quantile } from "./fee-scenario";
import type { LocalMarketInfo, MarketLayer, MarketLayerScope, PeerValue } from "./workspace/types";

export const LAYER_KEYS = ["local", "state", "district", "peers", "national"] as const;
export type LayerKey = (typeof LAYER_KEYS)[number];

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
  /** Newest publish date among the layer's institutions, from the engine. */
  asOf?: string | null;
  /** The institutions behind the layer, lowest amount first, from the engine (the CSV's rows). */
  members?: PeerValue[];
}

export function parseLayer(value: string | undefined | null): LayerKey {
  return (LAYER_KEYS as readonly string[]).includes(value ?? "") ? (value as LayerKey) : "state";
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

const ENGINE_KEYS: Record<MarketLayerScope, LayerKey> = {
  local: "local",
  state: "state",
  fed_district: "district",
  charter_size: "peers",
  national: "national",
};

function scopeFor(layer: MarketLayer, local: LocalMarketInfo | null): string {
  switch (layer.scope) {
    case "local":
      return local?.basis === "hq_city"
        ? `Institutions headquartered in ${local.places.join("; ")}`
        : `Institutions with branches in ${local?.places.join("; ") ?? "your counties"}`;
    case "state":
      return `Banks and credit unions headquartered in ${layer.label}`;
    case "fed_district":
      return `Banks and credit unions in ${layer.label}`;
    case "charter_size":
      return `${layer.label}, nationwide`;
    default:
      return "Every institution with this fee published";
  }
}

function labelFor(layer: MarketLayer): string {
  if (layer.scope === "local") return "Your market";
  if (layer.scope === "charter_size") return "Peer group";
  return layer.label;
}

/**
 * The engine's market layers as the screens show them, nearest first: your market, state, Fed
 * district, peer group, nation. The bank's own amount is never in its own comparison.
 */
export function layersFromEngine(
  layers: readonly MarketLayer[],
  ownAmount: number | null,
  local: LocalMarketInfo | null,
): LayerSummary[] {
  return layers
    .map((l) => ({ ...summarizeLayer(ENGINE_KEYS[l.scope], labelFor(l), scopeFor(l, local), l.amounts, ownAmount), asOf: l.asOf, members: l.members }))
    .sort((a, b) => LAYER_KEYS.indexOf(a.key) - LAYER_KEYS.indexOf(b.key));
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
