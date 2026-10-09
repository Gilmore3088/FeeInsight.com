import { sql } from "@/lib/data-store/connection";
import { cachedPublicRead } from "@/lib/data-store/public-read-cache";
import { buildSnapshotFee, loadSnapshotRows, marketLabel, SNAPSHOT_MIN_PEERS } from "@/lib/agents/growth/market-snapshot";
import { median } from "@/lib/hamilton/fee-scenario";
import { VALID_US_CODES } from "@/lib/us-states";

/**
 * EDISON's free price check (`growth-os/agents/edison.md`): pick a state, an overdraft or NSF
 * fee and any price, including $0, and see how many institutions in that state charge less,
 * the same, or more. It only counts institutions whose figure traces to its own published
 * schedule (`checkFeeAgainstSource`, through the market snapshot's `institutionValue`), and every
 * one links to that schedule. It reports where a price sits and never suggests changing it.
 */

type SqlTag = typeof sql;

export const PRICE_CHECK_FEES = ["overdraft", "nsf"] as const;
export type PriceCheckFee = (typeof PRICE_CHECK_FEES)[number];

export const isPriceCheckFee = (value: unknown): value is PriceCheckFee =>
  typeof value === "string" && (PRICE_CHECK_FEES as readonly string[]).includes(value);

/** One institution's source-checked figure for the fee. */
export interface PricedInstitution {
  id: number;
  name: string;
  value: number;
  documentUrl: string | null;
  sourceLine: string | null;
  readAt: string | null;
  /** `bank` or `credit_union`, as the institution's charter record says. */
  charterType: string | null;
  city: string | null;
  cbsaName: string | null;
}

/** Every source-checked institution in a state for one fee, lowest first. */
export interface StatePrices {
  stateCode: string;
  fee: PriceCheckFee;
  institutions: PricedInstitution[];
  /** Institutions with a live figure that didn't trace to its schedule, left out of every count. */
  uncheckedCount: number;
}

export interface PriceCheck {
  price: number;
  /** Source-checked institutions counted. */
  count: number;
  lower: number;
  same: number;
  higher: number;
  /** Institutions charging $0 (counted in `lower` unless the price is $0). */
  zero: number;
  median: number;
  /** The share of counted institutions charging less than the price, rounded to a whole percent. */
  lowerShare: number;
}

const cents = (value: number) => Math.round(value * 100) / 100;

/** Where a price sits among a state's source-checked figures; null below the site's median floor. */
export function priceCheck(price: number, prices: Pick<StatePrices, "institutions">): PriceCheck | null {
  const values = prices.institutions.map((institution) => institution.value);
  if (!Number.isFinite(price) || price < 0 || values.length < SNAPSHOT_MIN_PEERS) return null;
  const at = cents(price);
  const lower = values.filter((value) => value < at).length;
  const same = values.filter((value) => value === at).length;
  return {
    price: at,
    count: values.length,
    lower,
    same,
    higher: values.length - lower - same,
    zero: values.filter((value) => value === 0).length,
    median: cents(median(values) ?? 0),
    lowerShare: Math.round((lower / values.length) * 100),
  };
}

/** Reads a typed price ("$35", "35.00", "0"); null for anything that isn't a dollar amount. */
export function parsePrice(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(cleaned)) return null;
  return cents(Number(cleaned));
}

/** The state's source-checked figures for one fee. Read uncached; public pages use the cached one. */
export async function loadStatePrices(stateCode: string, fee: PriceCheckFee, db: SqlTag = sql): Promise<StatePrices | null> {
  const state = stateCode.toUpperCase();
  if (!VALID_US_CODES.has(state) || !isPriceCheckFee(fee)) return null;
  const rows = await db`
    SELECT s.id, s.institution_name, s.charter_type, s.city, s.cbsa_name
      FROM institution_sources s
     WHERE s.state_code = ${state} AND s.closed_date IS NULL
       AND EXISTS (SELECT 1 FROM published_fee_catalog ef WHERE ef.institution_id = s.id AND ef.fee_category = ${fee})
  `;
  const text = (value: unknown) => (value === null || value === undefined || value === "" ? null : String(value));
  const names = new Map<number, string>(rows.map((row) => [Number(row.id), String(row.institution_name)]));
  const places = new Map(rows.map((row) => [Number(row.id), { charterType: text(row.charter_type), city: text(row.city), cbsaName: text(row.cbsa_name) }]));
  if (names.size === 0) return { stateCode: state, fee, institutions: [], uncheckedCount: 0 };
  const feeRows = await loadSnapshotRows(db, [...names.keys()], [fee]);
  // Subject 0 matches no institution, so every institution comes back as a peer.
  const snapshot = buildSnapshotFee(fee, 0, feeRows);
  const institutions = snapshot.peers
    .filter((peer) => peer.verified)
    .map((peer) => ({
      id: peer.institutionId,
      name: names.get(peer.institutionId) ?? `Institution ${peer.institutionId}`,
      value: peer.value,
      documentUrl: peer.documentUrl,
      sourceLine: peer.sourceLine,
      readAt: peer.readAt,
      charterType: places.get(peer.institutionId)?.charterType ?? null,
      city: places.get(peer.institutionId)?.city ?? null,
      cbsaName: places.get(peer.institutionId)?.cbsaName ?? null,
    }));
  return { stateCode: state, fee, institutions, uncheckedCount: snapshot.peers.length - institutions.length };
}

/** Where the price sits among one group of institutions, when the group is big enough to say. */
export interface GroupCheck {
  label: string;
  count: number;
  median: number;
  lower: number;
  same: number;
  higher: number;
}

function groupCheck(label: string, price: number, institutions: PricedInstitution[], min: number): GroupCheck | null {
  if (institutions.length < min) return null;
  const at = cents(price);
  const values = institutions.map((institution) => institution.value);
  const lower = values.filter((value) => value < at).length;
  const same = values.filter((value) => value === at).length;
  return { label, count: values.length, median: cents(median(values) ?? 0), lower, same, higher: values.length - lower - same };
}

/** Banks and credit unions apart; a side with fewer than `min` institutions is left out. */
export function charterChecks(price: number, prices: Pick<StatePrices, "institutions">, min = SNAPSHOT_MIN_PEERS): GroupCheck[] {
  const sides: Array<[string, string]> = [["bank", "Banks"], ["credit_union", "Credit unions"]];
  return sides
    .map(([key, label]) => groupCheck(label, price, prices.institutions.filter((institution) => institution.charterType === key), min))
    .filter((check): check is GroupCheck => check !== null);
}

/**
 * The state's local markets (metro area, or the city where an institution has none), largest
 * first, each with at least `min` source-checked institutions.
 */
export function marketChecks(price: number, prices: Pick<StatePrices, "institutions" | "stateCode">, min = 3, limit = 8): GroupCheck[] {
  const byMarket = new Map<string, PricedInstitution[]>();
  for (const institution of prices.institutions) {
    if (!institution.cbsaName && !institution.city) continue;
    const label = marketLabel({ cbsaName: institution.cbsaName, city: institution.city, stateCode: prices.stateCode });
    const list = byMarket.get(label);
    if (list) list.push(institution);
    else byMarket.set(label, [institution]);
  }
  return [...byMarket.entries()]
    .map(([label, list]) => groupCheck(label, price, list, min))
    .filter((check): check is GroupCheck => check !== null)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** Cached for public pages: a state's figures only move when Hamilton publishes. */
export const loadStatePricesCached = cachedPublicRead(
  "price-check-state-v2",
  (stateCode: string, fee: PriceCheckFee) => loadStatePrices(stateCode, fee),
);
