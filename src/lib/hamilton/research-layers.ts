/**
 * The market layers Hamilton's Research and Model screens move across: the bank's own local
 * market, its state, its Fed district, its peer group (charter and asset size) and the nation.
 * Every layer comes from the Hamilton engine (`getFeeResearch(...).layers`), so the screens and
 * the engine show the same institutions. Descriptive only: positions and spreads, never a
 * suggested price.
 *
 * Hamilton's median rule (James, 2026-10-25): a median, middle half or percentile needs 5
 * institutions in the bank's local market and 10 in every other layer. Below that a layer is
 * `thin`: its median and middle half are null, and the screens show the count and name the
 * institutions instead. This is stricter than the public index's minimum
 * (MIN_INSTITUTIONS_FOR_MEDIAN), which stays as it is.
 */
import { median, peerPosition, quantile } from "./fee-scenario";
import type { LocalMarketInfo, MarketLayer, MarketLayerScope, PeerValue } from "./workspace/types";
import type { DatasetStamp } from "@/lib/dataset-stamp";
import { LOCAL_COMPETITORS_GROUP, minPeersForGroup } from "./workspace/scenario";
import { statedFeeText } from "@/lib/own-fee";

export const LAYER_KEYS = ["local", "state", "district", "peers", "national"] as const;
export type LayerKey = (typeof LAYER_KEYS)[number];

export interface LayerSummary {
  key: LayerKey;
  label: string;
  /** Plain description of who is in the layer. */
  scope: string;
  n: number;
  /** Institutions this layer needs before it shows a median: 5 for the local market, else 10. */
  minPeers: number;
  /** Null when the layer is thin. */
  median: number | null;
  p25: number | null;
  p75: number | null;
  zeroCount: number;
  /** Peers above, at and below the bank's own amount (excludes the bank). Null without its amount. */
  position: { more: number; same: number; less: number } | null;
  /** True when the layer has fewer than `minPeers` institutions: no median, middle half or percentile. */
  thin: boolean;
  amounts: number[];
  /** Newest publish date among the layer's institutions, from the engine. */
  asOf?: string | null;
  /** The institutions behind the layer, lowest amount first, from the engine (the CSV's rows). */
  members?: PeerValue[];
  /** The data behind the layer's figures, from the engine (#1924); none for the local market. */
  stamp?: DatasetStamp;
}

/**
 * True when a layer has too few institutions for Hamilton to print a middle price or seed a
 * tested price from it: 5 for the local market, 10 for every other layer (James, 2026-10-25).
 */
export function belowPeerMinimum(layer: Pick<LayerSummary, "key" | "n">): boolean {
  return layer.n < minPeersForLayer(layer.key);
}

/** The fewest institutions a layer needs for a median: 5 for the local market, 10 for every other layer. */
export function minPeersForLayer(key: LayerKey): number {
  return minPeersForGroup(key === "local" ? LOCAL_COMPETITORS_GROUP : key);
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
  const minPeers = minPeersForLayer(key);
  const thin = belowPeerMinimum({ key, n: sorted.length });
  return {
    key,
    label,
    scope,
    n: sorted.length,
    minPeers,
    median: thin ? null : median(sorted),
    p25: thin ? null : quantile(sorted, 0.25),
    p75: thin ? null : quantile(sorted, 0.75),
    zeroCount: sorted.filter((a) => a === 0).length,
    position: pos ? { more: pos.more, same: pos.same, less: pos.less } : null,
    thin,
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
  stamps: Partial<Record<MarketLayerScope, DatasetStamp>> = {},
): LayerSummary[] {
  return layers
    .map((l) => ({
      ...summarizeLayer(ENGINE_KEYS[l.scope], labelFor(l), scopeFor(l, local), l.amounts, ownAmount),
      asOf: l.asOf,
      members: l.members,
      ...(stamps[l.scope] ? { stamp: stamps[l.scope] } : {}),
    }))
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What a thin layer shows in place of its median, worked out once per layer: a plain note (how
 * many institutions publish the fee and how many a median needs) and, when the engine listed
 * every institution behind the count, each one by name with its stated price, lowest first
 * ("Bayside Bank $25; Harbor CU $30"), as the Peer group page lists them. An institution whose
 * schedule states several fees shows that range and each fee by name, never the median the
 * statistics count it at. Sister charters sharing one schedule count once in `n` but are each
 * named, and the note says so. Null for a layer with a median, or with no institutions.
 */
export function thinLayerText(
  layer: Pick<LayerSummary, "n" | "thin" | "minPeers" | "members">,
  money: (n: number) => string,
): { note: string; names: string | null } | null {
  if (!layer.thin || layer.n === 0) return null;
  const members = layer.members ?? [];
  const counted = new Set(members.map((m) => m.countedAs ?? m.institutionId)).size;
  const complete = members.length > 0 && counted >= layer.n;
  let note = `Only ${plural(layer.n, "institution publishes", "institutions publish")} this fee here, fewer than the ${layer.minPeers} needed for a median.`;
  if (complete && members.length > layer.n) {
    note += ` Institutions that share one fee schedule count once, so ${members.length} are named.`;
  }
  const names = complete
    ? [...members]
        .sort((a, b) => a.amount - b.amount || a.institutionName.localeCompare(b.institutionName))
        .map((m) => `${m.institutionName} ${statedFeeText(m.amount, m.several, money)}`)
        .join("; ")
    : null;
  return { note, names };
}

/**
 * The layer a screen opens on when the reader hasn't picked one: the peer group (charter and
 * asset size) first, then the state, district and nation, skipping any too thin for a median.
 * The local market stays one tap away; a handful of hometown institutions is a thin yardstick
 * for a large bank (James, 2026-10-07: "Your market (7)" for a $9B credit union).
 */
export function defaultLayer(layers: readonly Pick<LayerSummary, "key" | "thin">[]): LayerKey {
  for (const key of ["peers", "state", "district", "national"] as const) {
    if (layers.some((l) => l.key === key && !l.thin)) return key;
  }
  return layers.find((l) => !l.thin)?.key ?? layers[layers.length - 1]?.key ?? "state";
}
