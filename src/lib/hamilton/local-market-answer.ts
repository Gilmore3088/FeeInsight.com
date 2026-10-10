/**
 * "Who are my local competitors and where are they?" answered from data, not prose: the
 * institutions with branches in the bank's market (FDIC Summary of Deposits counties, or the
 * headquarters city for a credit union), each one's branches and deposits there, what they
 * publish for the main fees beside the bank's own, and where the bank's own branches are.
 * Deterministic: Postgres reads only, no provider calls.
 */
import { sql } from "@/lib/data-store/connection";
import { statsRowFilter } from "@/lib/data-store/fee-stats";
import { getLocalMarketCompetitors } from "@/lib/data-store/local-market";
import { getBranchesForInstitution, getMarketBranchFootprint } from "@/lib/data-store/branches";
import { getMarketStudyData } from "@/lib/data-store/market-study";
import { getBranchlessIds, getLiveFeeFacts, summarizeMarketCoverage, type MarketCoverage } from "@/lib/data-store/competitor-coverage";
import { bankStyles, footprintLegend, footprintMap, responsive } from "@/lib/hamilton/studies-exhibits/market";
import { branchNetworkMap, type NetworkCity } from "@/lib/hamilton/branch-network-map";
import { geoContains } from "d3-geo";
import { countyFeature } from "@/lib/geo/counties";
import { DEFAULT_LOCAL_MARKET_CATEGORIES, resolveLocalMarketCategories, selectMarketFees } from "./local-market-request";

/** The fees compared across the market, in reading order. */
export const MARKET_FEES = DEFAULT_LOCAL_MARKET_CATEGORIES;

export { isLocalMarketQuestion } from "./local-market-question";

export interface MarketCompetitor {
  institutionId: number;
  name: string;
  charterType: string | null;
  /** Branches in the market; credit unions counted by city (NCUA has no county code). */
  branches: number | null;
  /** Deposits held in the market's branches, whole dollars; null for credit unions (NCUA reports none by branch). */
  deposits: number | null;
  /** Median published amount per requested fee category. */
  fees: Record<string, number>;
  evidenceUrl?: string | null;
  evidenceDate?: string | null;
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
    cities: NetworkCity[];
    fees: Record<string, number>;
  };
  /** Bank deposits across the market's branches, whole dollars (FDIC SOD). */
  marketDeposits: number | null;
  marketBranches: number | null;
  competitors: MarketCompetitor[];
  categories: string[];
  sources: { label: string; asOf: string | null }[];
  /**
   * The market's main county drawn as the report footprint map (trusted SVG built by
   * studies-exhibits/market.ts from escaped data), with its legend; null when it can't be drawn.
   */
  map: { html: string; legend: string } | null;
  /** Every branch city on one map with the market shaded (trusted SVG from branch-network-map.ts); null when none has a location. */
  network: string | null;
  /** Branches with no location on file, so left off the network map. */
  unmapped: number;
  /** Each institution's map colour, so the table beside the map uses the same one. */
  colours: Record<number, string>;
  /** How many of the market's competitors show live fees, and their share of its bank deposits. */
  coverage?: MarketCoverage | null;
}

/** The footprint map for the county that holds most of the market, in the report look. */
function marketMap(
  institutionId: number,
  found: Awaited<ReturnType<typeof getMarketStudyData>>,
  own: BranchPoint[],
): Pick<LocalMarketAnswer, "map" | "colours"> {
  if (!found) return { map: null, colours: {} };
  // Credit unions are not in the SOD; draw their own NCUA branch locations in the county as the bank's rings.
  const county = countyFeature(found.county_fips);
  const d =
    found.branches.some((b) => b.institution_id === institutionId) || found.subject_branches.length > 0
      ? found
      : {
          ...found,
          branches: [
            ...found.branches,
            ...own
              .filter((b) => b.latitude != null && b.longitude != null && county !== null && geoContains(county, [b.longitude, b.latitude]))
              .map((b) => ({ institution_id: institutionId, cert: 0, branch_name: null, city: b.city, county_fips: found.county_fips, latitude: b.latitude!, longitude: b.longitude!, deposits: 0 })),
          ],
        };
  const styles = bankStyles(d);
  const html = responsive((size) => footprintMap(d, styles, size));
  const colours: Record<number, string> = {};
  for (const st of styles.values()) if (st.key > 0) colours[st.key] = st.colour;
  return { map: html ? { html, legend: footprintLegend(d, styles) } : null, colours };
}

const MAX_COMPETITORS = 20;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

type BranchPoint = { city: string | null; state: string | null; latitude?: number | null; longitude?: number | null };

/** The bank's branches grouped by city, most first, each placed at the mean of its located branches. */
export function citiesOf(rows: BranchPoint[]): NetworkCity[] {
  const byCity = new Map<string, NetworkCity & { n: number; latSum: number; lonSum: number }>();
  for (const r of rows) {
    if (!r.city || !r.state) continue;
    const city = r.city.trim().replace(/\b\w+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
    const key = `${city}|${r.state}`;
    const entry = byCity.get(key) ?? { city, state: r.state, branches: 0, lat: null, lon: null, n: 0, latSum: 0, lonSum: 0 };
    entry.branches += 1;
    if (r.latitude != null && r.longitude != null) {
      entry.n += 1;
      entry.latSum += r.latitude;
      entry.lonSum += r.longitude;
    }
    byCity.set(key, entry);
  }
  return [...byCity.values()]
    .map(({ n, latSum, lonSum, ...c }) => ({ ...c, lat: n ? latSum / n : null, lon: n ? lonSum / n : null }))
    .sort((a, b) => b.branches - a.branches || a.city.localeCompare(b.city));
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

async function ownFees(institutionId: number, categories: readonly string[]): Promise<Record<string, number>> {
  const rows = await sql`
    SELECT c.fee_category,
           CASE WHEN c.fee_category = 'overdraft' THEN MAX(c.amount)
                ELSE PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY c.amount) END AS amount
      FROM published_fee_catalog c
     WHERE c.institution_id = ${institutionId}
       AND c.review_status = 'approved'
       AND c.amount IS NOT NULL AND c.amount >= 0
       AND ${sql.unsafe(statsRowFilter("c"))}
       AND c.fee_category = ANY(${[...categories]})
     GROUP BY c.fee_category`;
  const out: Record<string, number> = {};
  for (const r of rows) {
    const amount = num(r.amount);
    if (amount !== null) out[String(r.fee_category)] = Math.round(amount * 100) / 100;
  }
  return out;
}

/** Null when no market can be located for the institution. */
export async function getLocalMarketAnswer(
  institutionId: number,
  options: { categories?: readonly string[]; charter?: "all" | "bank" | "credit_union" } = {},
): Promise<LocalMarketAnswer | null> {
  const categories = resolveLocalMarketCategories(options.categories);
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
    categories: [...categories],
    limit: 60,
  });
  if (!market) return null;

  // Every read runs at once; the county map only needs the study data and the bank's own branches.
  const mainCounty = market.county_fips.map(String)[0];
  const [footprint, ownBranches, fees, study] = await Promise.all([
    getMarketBranchFootprint(market.county_fips.map(String), market.sod_year).catch(() => null),
    getBranchesForInstitution(institutionId, { limit: 500, offset: 0 }).catch(() => null),
    ownFees(institutionId, categories).catch(() => ({})),
    mainCounty ? getMarketStudyData(institutionId, mainCounty).catch(() => null) : Promise.resolve(null),
  ]);
  let drawn: Pick<LocalMarketAnswer, "map" | "colours">;
  try {
    drawn = marketMap(institutionId, study, ownBranches?.rows ?? []);
  } catch {
    drawn = { map: null, colours: {} };
  }
  const cities = citiesOf(ownBranches?.rows ?? []);
  const marketCounties = market.county_fips.map((f) => String(f).padStart(5, "0"));

  const feeBy = new Map(market.competitors.map((c) => [c.institution_id, c]));
  const ids = new Set<number>([...feeBy.keys(), ...Object.keys(footprint?.byInstitution ?? {}).map(Number)]);
  ids.delete(institutionId);
  const names = ids.size
    ? await sql`SELECT id, institution_name, charter_type FROM institution_sources WHERE id = ANY(${[...ids]}::int[])`
    : [];
  const competitors = rankCompetitors(
    names.filter(row => !options.charter || options.charter === "all" || row.charter_type === options.charter).map((row) => {
      const id = Number(row.id);
      const spot = footprint?.byInstitution[id];
      return {
        institutionId: id,
        name: String(row.institution_name),
        charterType: row.charter_type ? String(row.charter_type) : null,
        branches: spot?.branches ?? null,
        deposits: spot?.deposits ?? null,
        fees: selectMarketFees(feeBy.get(id)?.fees ?? {}, categories),
        evidenceUrl: feeBy.get(id)?.document_url ?? null,
        evidenceDate: feeBy.get(id)?.document_date ?? null,
      };
    }),
  );

  const own = footprint?.byInstitution[institutionId];
  const footprintIds = Object.keys(footprint?.byInstitution ?? {}).map(Number).filter((id) => id !== institutionId);
  const coverage = footprint
    ? await Promise.all([getLiveFeeFacts(footprintIds), getBranchlessIds(footprintIds)])
        .then(([live, branchless]) => summarizeMarketCoverage(footprint.byInstitution, institutionId, live, branchless))
        .catch(() => null)
    : null;
  return {
    institutionId,
    institutionName: String(inst.institution_name),
    charterType,
    market: { label: market.label, basis: market.basis, sodYear: market.sod_year, countyCount: market.county_fips.length },
    you: {
      branches: ownBranches?.total ?? 0,
      branchesInMarket: own?.branches ?? null,
      depositsInMarket: own?.deposits ?? null,
      cities,
      fees: selectMarketFees(fees, categories),
    },
    marketDeposits: footprint?.totalDeposits ?? null,
    marketBranches: footprint?.totalBranches ?? null,
    competitors,
    categories: [...categories],
    sources: [
      { label: "FDIC Summary of Deposits", asOf: `${market.sod_year}-06-30` },
      { label: "NCUA credit union branch file", asOf: null },
      { label: "Bank Fee Index, published fee schedules", asOf: null },
    ],
    map: drawn.map,
    network: responsive((size) => branchNetworkMap(cities, marketCounties, size)),
    unmapped: (ownBranches?.rows ?? []).filter((b) => b.latitude == null || b.longitude == null).length,
    colours: drawn.colours,
    coverage,
  };
}
