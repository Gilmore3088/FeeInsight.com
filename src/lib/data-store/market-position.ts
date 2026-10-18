import { sql } from "./connection";
import { institutionDisplayName } from "@/lib/institution-display-name";
import { buildMetroMap, type MetroMap, type MetroPoint } from "@/lib/geo/metro-market-map";
import {
  assetBandIndex,
  isExcludedName,
  sharesByYear,
  subjectHistory,
  topShares,
  type CertYearRow,
  type HistoryPoint,
  type ShareEntry,
} from "@/lib/market-position";

/**
 * The institution profile's market position section, for a bank's largest metros: deposit
 * share and rank (FDIC Summary of Deposits, every loaded year), the offices of every bank and
 * credit union in the metro for the map, and the credit unions there (NCUA branch file) kept
 * apart from the bank deposit share. Read only; see src/lib/market-position.ts for definitions.
 */

/** Metros carried to the page (largest by the bank's own deposits). */
export const MARKET_POSITION_METROS = 4;
/** Named institutions in each share chart. */
export const SHARE_CHART_ROWS = 8;
/** Offices sent for one metro's map; a larger metro shows the largest institutions' offices. */
const MAX_MAP_OFFICES = 900;

export interface MarketInstitution {
  /** Display name; null for an FDIC certificate not matched to an institution. */
  name: string | null;
  kind: "bank" | "credit_union";
  /** Index into ASSET_BANDS; -1 when total assets are not on file. */
  band: number;
}

export interface MetroCreditUnions {
  offices: number;
  institutions: number;
  /** Quarter-end date of the NCUA branch file, YYYY-MM-DD. */
  reportDate: string | null;
}

export interface MetroPosition {
  code: number;
  name: string;
  /** The metro holding most of the bank's offices (the peer module's metro set). */
  isHome: boolean;
  year: number;
  /** All SOD deposits in the metro, thousands of dollars. */
  totalDeposits: number;
  /** FDIC-insured institutions with offices there (ranked). */
  institutions: number;
  subject: Pick<ShareEntry, "sharePct" | "rank" | "branches" | "deposits"> | null;
  shares: Array<Pick<ShareEntry, "name" | "sharePct" | "rank" | "branches" | "subject">>;
  history: HistoryPoint[];
  creditUnions: MetroCreditUnions;
  institutionsOnMap: MarketInstitution[];
  /** Index of the subject in institutionsOnMap; -1 when its offices have no coordinates. */
  subjectIndex: number;
  map: MetroMap | null;
  /** Offices in the metro with no coordinates on file (left off the map). */
  unmappedOffices: number;
}

export interface MarketPosition {
  /** Newest SOD year loaded (June 30). */
  latestYear: number;
  /** Oldest SOD year in any metro's history here. */
  firstYear: number;
  metros: MetroPosition[];
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function getMarketPosition(institutionId: number): Promise<MarketPosition | null> {
  const [latest] = await sql<Array<{ year: number | null }>>`
    SELECT MAX(year)::int AS year FROM institution_branch_deposits WHERE institution_id = ${institutionId}`;
  const year = latest?.year ?? null;
  if (!year) return null;

  const metros = await sql<Array<{ msa_code: number; msa_name: string | null; branches: number; deposits: string }>>`
    SELECT msa_code::int AS msa_code, MAX(msa_name) AS msa_name, COUNT(*)::int AS branches, COALESCE(SUM(deposits), 0) AS deposits
      FROM institution_branch_deposits
     WHERE institution_id = ${institutionId} AND year = ${year} AND msa_code IS NOT NULL AND msa_code > 0
     GROUP BY msa_code
     ORDER BY 4 DESC, 1
     LIMIT ${MARKET_POSITION_METROS}`;
  if (metros.length === 0) return null;
  const codes = metros.map((m) => Number(m.msa_code));
  // The peer module's home metro: most offices, ties to the lower code (peer-markets.ts getHomeMarket).
  const home = [...metros].sort((a, b) => b.branches - a.branches || a.msa_code - b.msa_code)[0].msa_code;

  const [history, offices, countyRows, cuOffices] = await Promise.all([
    sql<Array<CertYearRow & { msa_code: number }>>`
      SELECT msa_code::int AS msa_code, year::int AS year, cert::int AS cert, MAX(institution_id)::int AS institution_id,
             COALESCE(SUM(deposits), 0)::float8 AS deposits, COUNT(*)::int AS branches
        FROM institution_branch_deposits
       WHERE msa_code = ANY(${codes}::int[])
       GROUP BY 1, 2, 3`,
    sql<Array<{ msa_code: number; cert: number; institution_id: number | null; latitude: number; longitude: number }>>`
      SELECT msa_code::int AS msa_code, cert::int AS cert, institution_id::int AS institution_id, latitude::float8 AS latitude, longitude::float8 AS longitude
        FROM institution_branch_deposits
       WHERE msa_code = ANY(${codes}::int[]) AND year = ${year}`,
    sql<Array<{ msa_code: number; county_fips: number }>>`
      SELECT DISTINCT msa_code::int AS msa_code, county_fips::int AS county_fips
        FROM institution_branch_deposits
       WHERE msa_code = ANY(${codes}::int[]) AND year = ${year} AND county_fips IS NOT NULL`,
    // Credit union offices in the cities the metro's bank offices sit in (peer-markets.ts),
    // from the newest NCUA branch file only.
    sql<Array<{ msa_code: number; institution_id: number | null; name: string | null; asset_size: string | null; latitude: number | null; longitude: number | null; report_date: unknown }>>`
      WITH places AS (
        SELECT DISTINCT msa_code::int AS msa_code, state, UPPER(city) AS city
          FROM institution_branch_deposits
         WHERE msa_code = ANY(${codes}::int[]) AND year = ${year} AND city IS NOT NULL
      ), latest AS (SELECT MAX(report_date) AS d FROM credit_union_branches)
      SELECT p.msa_code, c.institution_id::int AS institution_id, COALESCE(s.institution_name, c.cu_name) AS name,
             s.asset_size, c.latitude::float8 AS latitude, c.longitude::float8 AS longitude, c.report_date
        FROM credit_union_branches c
        JOIN places p ON c.state = p.state AND UPPER(c.city) = p.city
        LEFT JOIN institution_sources s ON s.id = c.institution_id
       WHERE c.report_date = (SELECT d FROM latest)`,
  ]);

  const bankIds = [...new Set([...history.map((r) => r.institution_id), ...offices.map((r) => r.institution_id)].filter((id): id is number => id !== null))];
  const info = new Map<number, { name: string; asset_size: number | null }>();
  if (bankIds.length > 0) {
    for (const r of await sql<Array<{ id: number; institution_name: string; asset_size: string | null }>>`
      SELECT id::int AS id, institution_name, asset_size FROM institution_sources WHERE id = ANY(${bankIds}::bigint[])`) {
      info.set(Number(r.id), { name: institutionDisplayName(r.institution_name), asset_size: num(r.asset_size) });
    }
  }
  const names = new Map([...info].map(([id, v]) => [id, v.name]));

  let firstYear = year;
  const out: MetroPosition[] = [];
  for (const m of metros) {
    const code = Number(m.msa_code);
    const rows = history
      .filter((r) => Number(r.msa_code) === code)
      .map((r) => ({ year: Number(r.year), cert: Number(r.cert), institution_id: num(r.institution_id), deposits: Number(r.deposits), branches: Number(r.branches) }));
    const years = sharesByYear(rows, institutionId, names);
    const current = years.find((y) => y.year === year);
    if (!current) continue;
    const own = current.entries.find((e) => e.subject) ?? null;
    const series = subjectHistory(years);
    if (series.length > 0) firstYear = Math.min(firstYear, series[0].year);

    // The map: every bank office (excluded names dropped) and credit union office with coordinates.
    const institutions: MarketInstitution[] = [];
    const indexOf = new Map<string, number>();
    const add = (key: string, inst: MarketInstitution) => {
      const known = indexOf.get(key);
      if (known !== undefined) return known;
      institutions.push(inst);
      indexOf.set(key, institutions.length - 1);
      return institutions.length - 1;
    };
    const points: MetroPoint[] = [];
    let unmapped = 0;
    const rankOf = new Map(current.entries.map((e) => [e.id === null ? null : e.id, e.rank]));
    const metroOffices = offices
      .filter((o) => Number(o.msa_code) === code)
      .filter((o) => !isExcludedName(o.institution_id === null ? null : names.get(Number(o.institution_id))))
      // Largest institutions first, so a cap drops the smallest ones' offices.
      .sort((a, b) => (rankOf.get(num(a.institution_id)) ?? 1e6) - (rankOf.get(num(b.institution_id)) ?? 1e6));
    for (const o of metroOffices) {
      if (o.latitude == null || o.longitude == null) {
        unmapped += 1;
        continue;
      }
      const id = num(o.institution_id);
      const meta = id === null ? null : info.get(id);
      const inst = add(id === null ? `c${o.cert}` : `i${id}`, { name: meta?.name ?? null, kind: "bank", band: assetBandIndex(meta?.asset_size) });
      points.push({ latitude: Number(o.latitude), longitude: Number(o.longitude), inst });
    }
    const cus = cuOffices.filter((c) => Number(c.msa_code) === code && !isExcludedName(c.name));
    for (const c of cus) {
      if (c.latitude == null || c.longitude == null) {
        unmapped += 1;
        continue;
      }
      const inst = add(c.institution_id === null ? `n${c.name}` : `i${c.institution_id}`, {
        name: c.name ? institutionDisplayName(c.name) : null,
        kind: "credit_union",
        band: assetBandIndex(num(c.asset_size)),
      });
      points.push({ latitude: Number(c.latitude), longitude: Number(c.longitude), inst });
    }
    const capped = points.slice(0, MAX_MAP_OFFICES);
    const map = buildMetroMap(
      countyRows.filter((r) => Number(r.msa_code) === code).map((r) => String(r.county_fips).padStart(5, "0")),
      capped,
    );
    const reportDate = cus.map((c) => (c.report_date instanceof Date ? c.report_date.toISOString().slice(0, 10) : c.report_date ? String(c.report_date).slice(0, 10) : null)).find(Boolean) ?? null;

    out.push({
      code,
      name: m.msa_name ?? `Metro ${code}`,
      isHome: code === Number(home),
      year,
      totalDeposits: current.totalDeposits,
      institutions: current.institutions,
      subject: own ? { sharePct: own.sharePct, rank: own.rank, branches: own.branches, deposits: own.deposits } : null,
      shares: topShares(current, SHARE_CHART_ROWS).map((e) => ({ name: e.name, sharePct: e.sharePct, rank: e.rank, branches: e.branches, subject: e.subject })),
      history: series,
      creditUnions: {
        offices: cus.length,
        institutions: new Set(cus.map((c) => c.institution_id ?? c.name)).size,
        reportDate,
      },
      institutionsOnMap: institutions,
      subjectIndex: indexOf.get(`i${institutionId}`) ?? -1,
      map,
      unmappedOffices: unmapped + (points.length - capped.length),
    });
  }
  if (out.length === 0) return null;
  return { latestYear: year, firstYear, metros: out };
}
