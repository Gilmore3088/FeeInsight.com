/**
 * The fee position fingerprint (#1894): one strip per fee category showing where the
 * institution's published fee falls among the peer group's, the saved peer set from Settings when
 * there is one (#1893), so the strips read the same group as Ask, Reports, My fees and Simulate.
 *
 * Every strip carries its own peer count, source and period. A featured category the institution
 * does not publish is shown as missing rather than left out. A median and percentile appear only
 * where enough peers publish the fee (MIN_PEERS_FOR_POSITION, or MIN_LOCAL_PEERS_FOR_POSITION for
 * local competitors); with fewer, the strip names the peers and their prices instead.
 * Descriptive only: it never says which fee to change. Pure builder plus one deterministic loader.
 */
import { countedAmounts } from "@/lib/data-store/counted-amounts";
import { getInstitutionOwnFees } from "@/lib/data-store/fee-index";
import { getRateFeesByInstitution } from "@/lib/data-store/rate-fees";
import { ownFeeLabel, type InstitutionOwnFee } from "@/lib/own-fee";
import { getActivePeerSet } from "./active-peer-set";
import { quantile } from "./fee-scenario";
import { FEATURED_FEES, feeName } from "./fee-workspace-data";
import { getEnginePeerGroup } from "./workspace/research";
import { minPeersForGroup, pricePosition } from "./workspace/scenario";
import type { PeerValue } from "./workspace/types";

export type FingerprintStatus =
  /** Enough peers: the strip shows the median, middle half and the institution's percentile. */
  | "placed"
  /** Some peers publish it, too few for a median: the strip names them and their prices. */
  | "few_peers"
  /** No peer in the group publishes it. */
  | "no_peers"
  /** The institution's schedule does not list this fee. */
  | "not_published"
  /** The schedule states several different amounts, so there is no one price to place. */
  | "several_amounts"
  /** The schedule states the fee as a rate ("1.1% of the transaction"): never placed among dollar amounts. */
  | "stated_as_rate";

export interface FingerprintStrip {
  feeCategory: string;
  feeName: string;
  status: FingerprintStatus;
  /** The institution's one published price; null when it publishes none or several. */
  current: number | null;
  /** How the schedule states it: "$35.00", or "$25.00 to $35.00" for several amounts. */
  currentLabel: string | null;
  /** Peers counted once each (sister charters of one schedule once), as the engine's band counts them. */
  peerCount: number;
  /** The counted peer amounts, lowest first: the gray marks on the strip. */
  peerAmounts: number[];
  /** Middle half and median; only for a placed strip. */
  band: { p25: number; median: number; p75: number } | null;
  /** The institution's percentile among the peers (0 to 100); only for a placed strip with a price. */
  percentile: number | null;
  /** Each peer and its price, lowest first; only when too few peers publish the fee for a median. */
  namedPeers: { institutionName: string; amount: number }[];
  /** Oldest and newest publish dates among the peers' fees (YYYY-MM-DD); null with no peers. */
  period: { from: string; to: string } | null;
}

export interface FeeFingerprint {
  institutionName: string;
  peerLabel: string;
  /** True when the group is the saved peer set from Settings. */
  saved: boolean;
  /** The fewest peers that get a median and percentile for this group. */
  minPeers: number;
  /** What every strip's figures come from. */
  source: string;
  strips: FingerprintStrip[];
}

export const FINGERPRINT_SOURCE =
  "Bank Fee Index, fees read from each institution's own published fee schedule";

const round = (n: number) => Math.round(n * 100) / 100;

function periodOf(peers: readonly PeerValue[]): FingerprintStrip["period"] {
  const dates = peers.map((p) => p.publishedAt?.slice(0, 10)).filter((d): d is string => Boolean(d)).sort();
  return dates.length > 0 ? { from: dates[0], to: dates[dates.length - 1] } : null;
}

/** The categories the fingerprint shows: the featured fees first (missing ones included), then every other fee the institution publishes. */
export function fingerprintCategories(ownCategories: Iterable<string>): string[] {
  const featured: string[] = [...FEATURED_FEES];
  const rest = [...new Set(ownCategories)].filter((c) => !featured.includes(c)).sort((a, b) => feeName(a).localeCompare(feeName(b)));
  return [...featured, ...rest];
}

/** One strip from the institution's own fee (absent when unpublished) and the group's peers for it. */
export function buildFingerprintStrip(
  feeCategory: string,
  own: Pick<InstitutionOwnFee, "price" | "low" | "high"> | undefined,
  peers: readonly PeerValue[],
  minPeers: number,
  /** How the schedule states the fee as a rate ("1.1% of the transaction"), when it has no dollar amount for it. */
  ownRateLabel: string | null = null,
): FingerprintStrip {
  const amounts = countedAmounts(peers);
  const enough = amounts.length >= minPeers;
  const current = own?.price ?? null;
  const status: FingerprintStatus = !own
    ? ownRateLabel
      ? "stated_as_rate"
      : "not_published"
    : own.price === null
      ? "several_amounts"
      : amounts.length === 0
        ? "no_peers"
        : enough
          ? "placed"
          : "few_peers";
  const band = enough
    ? { p25: round(quantile(amounts, 0.25) ?? 0), median: round(quantile(amounts, 0.5) ?? 0), p75: round(quantile(amounts, 0.75) ?? 0) }
    : null;
  return {
    feeCategory,
    feeName: feeName(feeCategory),
    status,
    current,
    currentLabel: own ? ownFeeLabel(own) : ownRateLabel,
    peerCount: amounts.length,
    peerAmounts: amounts,
    band,
    percentile: current !== null && enough ? pricePosition(current, amounts, minPeers) : null,
    namedPeers: !enough
      ? [...peers]
          .sort((a, b) => a.amount - b.amount || a.institutionName.localeCompare(b.institutionName))
          .map((p) => ({ institutionName: p.institutionName, amount: p.amount }))
      : [],
    period: periodOf(peers),
  };
}

export function buildFeeFingerprint(input: {
  institutionName: string;
  peerLabel: string;
  saved: boolean;
  ownFees: ReadonlyMap<string, Pick<InstitutionOwnFee, "price" | "low" | "high">>;
  peersByCategory: ReadonlyMap<string, readonly PeerValue[]>;
  /** Fees the schedule states as a rate, by category: label, e.g. "1.1% of the transaction". */
  ownRates?: ReadonlyMap<string, string>;
}): FeeFingerprint {
  const minPeers = minPeersForGroup(input.peerLabel);
  const rates = input.ownRates ?? new Map<string, string>();
  const strips = fingerprintCategories([...input.ownFees.keys(), ...rates.keys()]).map((category) =>
    buildFingerprintStrip(category, input.ownFees.get(category), input.peersByCategory.get(category) ?? [], minPeers, rates.get(category) ?? null),
  );
  return { institutionName: input.institutionName, peerLabel: input.peerLabel, saved: input.saved, minPeers, source: FINGERPRINT_SOURCE, strips };
}

/**
 * The fingerprint for one institution and one reader: the reader's saved peer set (the
 * workspace's default for this institution, else their own), else the default group the engine
 * picks. Null when the institution can't be read.
 */
export async function loadFeeFingerprint(params: { userId: number | string; institutionId: number }): Promise<FeeFingerprint | null> {
  const [ownFees, rateFees, peerSet] = await Promise.all([
    getInstitutionOwnFees(params.institutionId),
    // A fee stated as a rate is published, not missing; it is never pooled with dollar amounts.
    getRateFeesByInstitution(params.institutionId, "consumer"),
    getActivePeerSet({ userId: params.userId, institutionId: params.institutionId }).catch(() => null),
  ]);
  const ownRates = new Map<string, string>();
  for (const rate of rateFees) {
    if (!rate.fee_category || ownFees.has(rate.fee_category)) continue;
    const prior = ownRates.get(rate.fee_category);
    ownRates.set(rate.fee_category, prior ? `${prior}; ${rate.rate_label}` : rate.rate_label);
  }
  const categories = fingerprintCategories([...ownFees.keys(), ...ownRates.keys()]);
  const group = await getEnginePeerGroup(params.institutionId, categories, { peerSet });
  if (!group) return null;
  return buildFeeFingerprint({
    institutionName: group.institutionName,
    peerLabel: group.peerLabel,
    saved: group.saved,
    ownFees,
    ownRates,
    peersByCategory: new Map(group.fees.map((f) => [f.feeCategory, f.peers])),
  });
}
