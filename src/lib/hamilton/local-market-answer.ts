/**
 * "Who are my local competitors and where are they?" answered from data, not prose: the
 * institutions with branches in the bank's market (FDIC Summary of Deposits counties, or the
 * headquarters city for a credit union), each one's branches and deposits there, what they
 * publish for the main fees beside the bank's own, and where the bank's own branches are.
 * Deterministic: Postgres reads only, no provider calls.
 */
import { sql } from "@/lib/data-store/connection";
import { getLocalMarketCompetitors } from "@/lib/data-store/local-market";
import { getBranchesForInstitution, getMarketBranchFootprint } from "@/lib/data-store/branches";

/** The fees compared across the market, in reading order. */
export const MARKET_FEES = ["overdraft", "nsf", "monthly_maintenance", "atm_non_network", "wire_domestic_outgoing"] as const;

export { isLocalMarketQuestion } from "./local-market-question";

export interface MarketCompetitor {
  institutionId: number;
  name: string;
  charterType: string | null;
  /** Branches in the market; credit unions counted by city (NCUA has no county code). */
  branches: number | null;
  /** Deposits held in the market's branches, whole dollars; null for credit unions (NCUA reports none by branch). */
  deposits: number | null;
  /** Median published amount per fee in MARKET_FEES. */
  fees: Record<string, number>;
}

export interface LocalMarketAnswer {
  institutionId: number;
  institutionName: string;
  charterType: string | null;
  market: { label: string; basis: "branch_counties" | "hq_city"; sodYear: number; countyCount: number };
  you: {
    /** Every branch on file for the bank. */
    branches: number;
    /** The bank's branches in the market, from the same count as the competitors'. */
    branchesInMarket: number | null;
    depositsInMarket: number | null;
    /** Where the bank's branches are, most first. */
    cities: { city: string; state: string; branches: number }[];
    fees: Record<string, number>;
  };
  /** Bank deposits across the market's branches, whole dollars (FDIC SOD). */
  marketDeposits: number | null;
  marketBranches: number | null;
  competitors: MarketCompetitor[];
  categories: string[];
  sources: { label: string; asOf: string | null }[];
}

const MAX_COMPETITORS = 20;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The bank's branches grouped by city, most first. */
export function citiesOf(rows: { city: string | null; state: string | null }[]): { city: string; state: string; branches: number }[] {
  const byCity = new Map<string, { city: string; state: string; branches: number }>();
  for (const r of rows) {
    if (!r.city || !r.state) continue;
    const city = r.city.trim().replace(/\b\w+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
    const key = `${city}|${r.state}`;
    const entry = byCity.get(key) ?? { city, state: r.state, branches: 0 };
    entry.branches += 1;
    byCity.set(key, entry);
  }
  return [...byCity.values()].sort((a, b) => b.branches - a.branches || a.city.localeCompare(b.city));
}

/**
 * Orders the market by branches there, the one count banks and credit unions share (credit
 * unions report no deposits by branch), then by deposits. Institutions with no branch count and
 * no fee on file are left out, since nothing about them can be shown.
 */
export function rankCompetitors(list: MarketCompetitor[]): MarketCompetitor[] {
  return list
    .filter((c) => (c.branches ?? 0) > 0 || Object.keys(c.fees).length > 0)
    .sort(
      (a, b) =>
        (b.branches ?? 0) - (a.branches ?? 0) ||
        (b.deposits ?? -1) - (a.deposits ?? -1) ||
        Object.keys(b.fees).length - Object.keys(a.fees).length ||
        a.name.localeCompare(b.name),
    )
    .slice(0, MAX_COMPETITORS);
}

async function ownFees(institutionId: number): Promise<Record<string, number>> {
  const rows = await sql`
    SELECT fee_category, PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount) AS amount
      FROM published_fee_catalog
     WHERE institution_id = ${institutionId}
       AND review_status = 'approved'
       AND amount IS NOT NULL
       AND fee_category = ANY(${[...MARKET_FEES]})
     GROUP BY fee_category`;
  const out: Record<string, number> = {};
  for (const r of rows) {
    const amount = num(r.amount);
    if (amount !== null) out[String(r.fee_category)] = Math.round(amount * 100) / 100;
  }
  return out;
}

/** Null when no market can be located for the institution. */
export async function getLocalMarketAnswer(institutionId: number): Promise<LocalMarketAnswer | null> {
  const [inst] = await sql`
    SELECT id, institution_name, charter_type, cert_number, city, state_code
      FROM institution_sources WHERE id = ${institutionId}`;
  if (!inst) return null;
  const charterType = inst.charter_type ? String(inst.charter_type) : null;
  const market = await getLocalMarketCompetitors({
    institutionId,
    // A credit union's charter number is NCUA's, not an FDIC certificate; it must never match the SOD.
    certNumber: charterType === "credit_union" ? null : (inst.cert_number as string | null),
    city: inst.city as string | null,
    stateCode: inst.state_code as string | null,
    categories: [...MARKET_FEES],
    limit: 60,
  });
  if (!market) return null;

  const [footprint, ownBranches, fees] = await Promise.all([
    getMarketBranchFootprint(market.county_fips.map(String), market.sod_year).catch(() => null),
    getBranchesForInstitution(institutionId, { limit: 500, offset: 0 }).catch(() => null),
    ownFees(institutionId).catch(() => ({})),
  ]);

  const feeBy = new Map(market.competitors.map((c) => [c.institution_id, c]));
  const ids = new Set<number>([...feeBy.keys(), ...Object.keys(footprint?.byInstitution ?? {}).map(Number)]);
  ids.delete(institutionId);
  const names = ids.size
    ? await sql`SELECT id, institution_name, charter_type FROM institution_sources WHERE id = ANY(${[...ids]}::int[])`
    : [];
  const competitors = rankCompetitors(
    names.map((row) => {
      const id = Number(row.id);
      const spot = footprint?.byInstitution[id];
      return {
        institutionId: id,
        name: String(row.institution_name),
        charterType: row.charter_type ? String(row.charter_type) : null,
        branches: spot?.branches ?? null,
        deposits: spot?.deposits ?? null,
        fees: feeBy.get(id)?.fees ?? {},
      };
    }),
  );

  const own = footprint?.byInstitution[institutionId];
  return {
    institutionId,
    institutionName: String(inst.institution_name),
    charterType,
    market: { label: market.label, basis: market.basis, sodYear: market.sod_year, countyCount: market.county_fips.length },
    you: {
      branches: ownBranches?.total ?? 0,
      branchesInMarket: own?.branches ?? null,
      depositsInMarket: own?.deposits ?? null,
      cities: citiesOf(ownBranches?.rows ?? []),
      fees,
    },
    marketDeposits: footprint?.totalDeposits ?? null,
    marketBranches: footprint?.totalBranches ?? null,
    competitors,
    categories: [...MARKET_FEES],
    sources: [
      { label: "FDIC Summary of Deposits", asOf: `${market.sod_year}-06-30` },
      { label: "NCUA credit union branch file", asOf: null },
      { label: "Bank Fee Index, published fee schedules", asOf: null },
    ],
  };
}
