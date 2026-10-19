import { sql } from "@/lib/data-store/connection";
import { DISTRICT_NAMES, FDIC_TIER_LABELS, FDIC_TIER_ORDER, getTierForAssets } from "@/lib/fed-districts";

/**
 * Read model for FR Y-9C holding-company lines (holding_company_y9c_items) and NIC structure
 * (nic_relationships, nic_entities). Server only.
 *
 * Holding-company figures are consolidated: they include every bank and nonbank the company
 * owns, so they are never pooled with bank call-report figures. Income lines are year to date
 * as filed, so only same-quarter figures are compared. Dollar values are thousands as filed.
 *
 * A holding company's state is the one on its own Y-9C filing. Its Fed district and metro are
 * those of its largest bank we track (institution_sources.holding_company_rssd); a company with
 * no tracked bank has neither. Every median carries the number of companies behind it; a value
 * a company did not report is left out, never counted as zero.
 */

export interface Y9cFilerFacts {
  rssd: string;
  name: string | null;
  state: string | null;
  fedDistrict: number | null;
  cbsaCode: string | null;
  cbsaName: string | null;
  totalAssets: number | null;
  serviceCharges: number | null;
  noninterestIncome: number | null;
  netIncome: number | null;
  interchange: number | null;
  /** Domestic + foreign deposits, only when both domestic lines were reported. */
  deposits: number | null;
  /** Charge-offs minus recoveries, only when both were reported. */
  netChargeOffs: number | null;
}

export type Y9cDimension = "state" | "asset_tier" | "fed_district" | "cbsa";

export interface Y9cMedian {
  median: number | null;
  count: number;
}

export interface Y9cGroup {
  dimension: Y9cDimension;
  key: string;
  label: string;
  holdingCompanies: number;
  totalAssets: Y9cMedian;
  serviceCharges: Y9cMedian;
  noninterestIncome: Y9cMedian;
  netIncome: Y9cMedian;
  interchange: Y9cMedian;
  deposits: Y9cMedian;
  netChargeOffs: Y9cMedian;
  /** Service charges on deposit accounts as a share of noninterest income (0..1), per company. */
  serviceChargeShareOfNoninterestIncome: Y9cMedian;
}

export function medianOf(values: readonly (number | null | undefined)[]): Y9cMedian {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return { median: null, count: 0 };
  const mid = Math.floor(xs.length / 2);
  return { median: xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2, count: xs.length };
}

/** FDIC size tier from Y-9C total assets (thousands as filed). */
export function y9cAssetTier(totalAssetsThousands: number | null): string | null {
  return totalAssetsThousands === null ? null : getTierForAssets(totalAssetsThousands * 1_000);
}

function dimensionKey(f: Y9cFilerFacts, dimension: Y9cDimension): { key: string; label: string } | null {
  switch (dimension) {
    case "state":
      return f.state ? { key: f.state, label: f.state } : null;
    case "asset_tier": {
      const tier = y9cAssetTier(f.totalAssets);
      return tier ? { key: tier, label: FDIC_TIER_LABELS[tier] ?? tier } : null;
    }
    case "fed_district":
      return f.fedDistrict ? { key: String(f.fedDistrict), label: DISTRICT_NAMES[f.fedDistrict] ?? String(f.fedDistrict) } : null;
    case "cbsa":
      return f.cbsaCode ? { key: f.cbsaCode, label: f.cbsaName ?? f.cbsaCode } : null;
  }
}

/** Group filer facts by one dimension; companies with no value for the dimension are left out. */
export function groupY9cFilers(filers: readonly Y9cFilerFacts[], dimension: Y9cDimension): Y9cGroup[] {
  const groups = new Map<string, { label: string; rows: Y9cFilerFacts[] }>();
  for (const f of filers) {
    const k = dimensionKey(f, dimension);
    if (!k) continue;
    const g = groups.get(k.key) ?? { label: k.label, rows: [] };
    g.rows.push(f);
    groups.set(k.key, g);
  }
  const out = [...groups.entries()].map(([key, { label, rows }]) => ({
    dimension,
    key,
    label,
    holdingCompanies: rows.length,
    totalAssets: medianOf(rows.map((r) => r.totalAssets)),
    serviceCharges: medianOf(rows.map((r) => r.serviceCharges)),
    noninterestIncome: medianOf(rows.map((r) => r.noninterestIncome)),
    netIncome: medianOf(rows.map((r) => r.netIncome)),
    interchange: medianOf(rows.map((r) => r.interchange)),
    deposits: medianOf(rows.map((r) => r.deposits)),
    netChargeOffs: medianOf(rows.map((r) => r.netChargeOffs)),
    serviceChargeShareOfNoninterestIncome: medianOf(
      rows.map((r) => (r.serviceCharges !== null && r.noninterestIncome !== null && r.noninterestIncome > 0 ? r.serviceCharges / r.noninterestIncome : null)),
    ),
  }));
  const tierRank = (k: string) => (FDIC_TIER_ORDER as readonly string[]).indexOf(k);
  return out.sort((a, b) =>
    dimension === "asset_tier" ? tierRank(a.key) - tierRank(b.key) : dimension === "fed_district" ? Number(a.key) - Number(b.key) : a.key.localeCompare(b.key),
  );
}

export async function latestY9cReportDate(): Promise<string | null> {
  const [row] = await sql<{ report_date: string | null }[]>`
    SELECT MAX(report_date)::text AS report_date FROM holding_company_y9c_items WHERE item_key = 'total_assets'
  `;
  return row?.report_date ?? null;
}

interface FilerFactsRow {
  rssd: string;
  name: string | null;
  state: string | null;
  fed_district: number | null;
  cbsa_code: string | null;
  cbsa_name: string | null;
  total_assets: string | null;
  service_charges: string | null;
  noninterest_income: string | null;
  net_income: string | null;
  interchange: string | null;
  dep_dom_nib: string | null;
  dep_dom_ib: string | null;
  dep_for_nib: string | null;
  dep_for_ib: string | null;
  charge_offs: string | null;
  recoveries: string | null;
}

const toNum = (v: string | number | null) => (v === null || v === undefined ? null : Number(v));

export function filerFactsFromRow(r: FilerFactsRow): Y9cFilerFacts {
  const domNib = toNum(r.dep_dom_nib);
  const domIb = toNum(r.dep_dom_ib);
  const deposits = domNib !== null && domIb !== null ? domNib + domIb + (toNum(r.dep_for_nib) ?? 0) + (toNum(r.dep_for_ib) ?? 0) : null;
  const co = toNum(r.charge_offs);
  const rec = toNum(r.recoveries);
  return {
    rssd: r.rssd,
    name: r.name,
    state: r.state,
    fedDistrict: r.fed_district,
    cbsaCode: r.cbsa_code,
    cbsaName: r.cbsa_name,
    totalAssets: toNum(r.total_assets),
    serviceCharges: toNum(r.service_charges),
    noninterestIncome: toNum(r.noninterest_income),
    netIncome: toNum(r.net_income),
    interchange: toNum(r.interchange),
    deposits,
    netChargeOffs: co !== null && rec !== null ? co - rec : null,
  };
}

/** One row per Y-9C filer for a quarter, with its lines pivoted and its lead bank's district and metro. */
export async function loadY9cFilerFacts(reportDate: string, onlyRssd: string | null = null): Promise<Y9cFilerFacts[]> {
  const rows = await sql<FilerFactsRow[]>`
    WITH v AS (
      SELECT holding_company_rssd AS rssd,
             MAX(value) FILTER (WHERE item_key = 'total_assets') AS total_assets,
             MAX(value) FILTER (WHERE item_key = 'service_charges_deposit_accounts_ytd') AS service_charges,
             MAX(value) FILTER (WHERE item_key = 'noninterest_income_ytd') AS noninterest_income,
             MAX(value) FILTER (WHERE item_key = 'net_income_ytd') AS net_income,
             MAX(value) FILTER (WHERE item_key = 'interchange_fees_ytd') AS interchange,
             MAX(value) FILTER (WHERE item_key = 'deposits_domestic_noninterest_bearing') AS dep_dom_nib,
             MAX(value) FILTER (WHERE item_key = 'deposits_domestic_interest_bearing') AS dep_dom_ib,
             MAX(value) FILTER (WHERE item_key = 'deposits_foreign_noninterest_bearing') AS dep_for_nib,
             MAX(value) FILTER (WHERE item_key = 'deposits_foreign_interest_bearing') AS dep_for_ib,
             MAX(value) FILTER (WHERE item_key = 'charge_offs_total_ytd') AS charge_offs,
             MAX(value) FILTER (WHERE item_key = 'recoveries_total_ytd') AS recoveries
        FROM holding_company_y9c_items
       WHERE report_date = ${reportDate}::date
         AND (${onlyRssd}::text IS NULL OR holding_company_rssd = ${onlyRssd}::text)
       GROUP BY holding_company_rssd
    ), lead AS (
      SELECT DISTINCT ON (s.holding_company_rssd) s.holding_company_rssd AS rssd, s.fed_district, s.cbsa_code, s.cbsa_name
        FROM institution_sources s
       WHERE s.holding_company_rssd IN (SELECT rssd FROM v) AND s.source = 'fdic'
       ORDER BY s.holding_company_rssd, s.asset_size DESC NULLS LAST, s.id
    )
    SELECT v.rssd, f.legal_name AS name, f.state_code AS state, lead.fed_district, lead.cbsa_code, lead.cbsa_name,
           v.total_assets::text, v.service_charges::text, v.noninterest_income::text, v.net_income::text, v.interchange::text,
           v.dep_dom_nib::text, v.dep_dom_ib::text, v.dep_for_nib::text, v.dep_for_ib::text,
           v.charge_offs::text, v.recoveries::text
      FROM v
      LEFT JOIN holding_company_y9c_filers f ON f.holding_company_rssd = v.rssd AND f.report_date = ${reportDate}::date
      LEFT JOIN lead ON lead.rssd = v.rssd
  `;
  return rows.map(filerFactsFromRow);
}

/** Holding-company size and fee income by state, asset tier, Fed district or metro for one quarter (latest by default). */
export async function y9cAggregates(dimension: Y9cDimension, reportDate?: string): Promise<{ reportDate: string | null; groups: Y9cGroup[] }> {
  const date = reportDate ?? (await latestY9cReportDate());
  if (!date) return { reportDate: null, groups: [] };
  return { reportDate: date, groups: groupY9cFilers(await loadY9cFilerFacts(date), dimension) };
}

export interface ParentLink {
  parentRssd: string;
  parentName: string | null;
  entityType: string | null;
  state: string | null;
  startDate: string;
  endDate: string | null;
  relationshipLevel: number | null;
  pctEquity: number | null;
  /** Steps above the bank: 1 = direct parent. Only set for the open chain. */
  depth: number | null;
}

export interface InstitutionParent {
  institutionId: number;
  rssd: string | null;
  /** institution_sources.holding_company_rssd as synced from FDIC. */
  recordedHoldingCompanyRssd: string | null;
  /** NIC open links above the bank, nearest first. */
  currentChain: ParentLink[];
  /** The highest open parent in the chain (no open parent of its own), or null. */
  topTier: ParentLink | null;
  /** Every direct link NIC has for the bank, newest start first, open or closed. */
  history: ParentLink[];
  /** Latest Y-9C facts for the recorded holding company, else the top-tier parent, when it files. */
  y9c: (Y9cFilerFacts & { reportDate: string; filerRssd: string }) | null;
}

interface LinkRow {
  parent_rssd: string;
  legal_name: string | null;
  entity_type: string | null;
  state_code: string | null;
  start_date: string;
  end_date: string | null;
  relationship_level: number | null;
  pct_equity: string | null;
  depth: number | null;
}

const toLink = (r: LinkRow): ParentLink => ({
  parentRssd: r.parent_rssd,
  parentName: r.legal_name,
  entityType: r.entity_type,
  state: r.state_code,
  startDate: r.start_date,
  endDate: r.end_date,
  relationshipLevel: r.relationship_level,
  pctEquity: toNum(r.pct_equity),
  depth: r.depth,
});

/** The deepest open link above the bank (rows arrive ordered by depth, then equity share). */
export function topTierOf(chain: readonly ParentLink[]): ParentLink | null {
  const maxDepth = Math.max(0, ...chain.map((l) => l.depth ?? 0));
  return maxDepth === 0 ? null : (chain.find((l) => l.depth === maxDepth) ?? null);
}

/** The parent of any bank: recorded holding company, NIC's current chain to the top-tier parent, link history, and Y-9C facts. */
export async function parentOfInstitution(institutionId: number): Promise<InstitutionParent | null> {
  const [inst] = await sql<{ rssd_id: string | null; holding_company_rssd: string | null }[]>`
    SELECT rssd_id, holding_company_rssd FROM institution_sources WHERE id = ${institutionId}
  `;
  if (!inst) return null;
  const rssd = inst.rssd_id;
  let chain: ParentLink[] = [];
  let history: ParentLink[] = [];
  if (rssd) {
    const chainRows = await sql<LinkRow[]>`
      WITH RECURSIVE up AS (
        SELECT r.parent_rssd, r.offspring_rssd, r.start_date, r.end_date, r.relationship_level, r.pct_equity, 1 AS depth,
               ARRAY[r.offspring_rssd, r.parent_rssd] AS path
          FROM nic_relationships r
         WHERE r.offspring_rssd = ${rssd} AND r.end_date IS NULL
        UNION ALL
        SELECT r.parent_rssd, r.offspring_rssd, r.start_date, r.end_date, r.relationship_level, r.pct_equity, up.depth + 1,
               up.path || r.parent_rssd
          FROM nic_relationships r JOIN up ON r.offspring_rssd = up.parent_rssd
         WHERE r.end_date IS NULL AND up.depth < 10 AND NOT r.parent_rssd = ANY(up.path)
      )
      SELECT up.parent_rssd, e.legal_name, e.entity_type, e.state_code, up.start_date::text, up.end_date::text,
             up.relationship_level, up.pct_equity::text, up.depth
        FROM up LEFT JOIN nic_entities e ON e.rssd = up.parent_rssd
       ORDER BY up.depth, up.pct_equity DESC NULLS LAST, up.parent_rssd
    `;
    chain = chainRows.map(toLink);
    const historyRows = await sql<LinkRow[]>`
      SELECT r.parent_rssd, e.legal_name, e.entity_type, e.state_code, r.start_date::text, r.end_date::text,
             r.relationship_level, r.pct_equity::text, NULL::int AS depth
        FROM nic_relationships r LEFT JOIN nic_entities e ON e.rssd = r.parent_rssd
       WHERE r.offspring_rssd = ${rssd}
       ORDER BY r.start_date DESC, r.parent_rssd
    `;
    history = historyRows.map(toLink);
  }
  const topTier = topTierOf(chain);

  let y9c: InstitutionParent["y9c"] = null;
  for (const filerRssd of [inst.holding_company_rssd, topTier?.parentRssd].filter((v): v is string => Boolean(v))) {
    const [latest] = await sql<{ report_date: string }[]>`
      SELECT MAX(report_date)::text AS report_date FROM holding_company_y9c_items WHERE holding_company_rssd = ${filerRssd}
    `;
    if (!latest?.report_date) continue;
    const facts = (await loadY9cFilerFacts(latest.report_date, filerRssd))[0];
    if (facts) {
      y9c = { ...facts, reportDate: latest.report_date, filerRssd };
      break;
    }
  }
  return { institutionId, rssd, recordedHoldingCompanyRssd: inst.holding_company_rssd, currentChain: chain, topTier, history, y9c };
}
