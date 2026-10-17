import { sql } from "@/lib/data-store/connection";
import { matchesPeerFilters, type PeerFilterSet } from "./fee-index";
import { STATS_SCHEDULE_KEYS, statsRowFilter, summarizeFeesBy, type FeeStatistics } from "./fee-stats";

/**
 * Server-only reads over the UBPR loader's tables (ubpr_bank_peer_groups,
 * ubpr_peer_group_averages). Never import from a client component.
 *
 * - Our fee medians by UBPR peer group: published_fee_catalog joined through
 *   institution_sources to each bank's peer group for one quarter, summarized with the shared
 *   statistics contract (summarizeFeesBy: one value per institution, minimum sample), so every
 *   median carries its institution count.
 * - Bank ratio medians (our computation from each bank's own UBPR ratio) by UBPR peer group,
 *   state, Fed district or asset-size tier. These are labelled computed; the regulator's
 *   published peer averages are read separately and never mixed in.
 * - Metro (CBSA) is not offered: institution_sources has no metro column on this branch.
 *
 * Peer filters reuse fee-index's PeerFilterSet and matchesPeerFilters, the same test the fee
 * index applies to a saved peer group.
 */

export const UBPR_RATIO_KEYS = [
  "noninterest_income_to_avg_assets",
  "service_charges_to_avg_assets",
  "efficiency_ratio",
  "roa",
  "nim",
  "net_charge_offs_to_avg_loans",
] as const;
export type UbprRatioKey = (typeof UBPR_RATIO_KEYS)[number];

export type UbprGroupDimension = "peer_group" | "state" | "fed_district" | "asset_tier";

export interface MedianWithCount {
  median: number | null;
  institution_count: number;
}

/** Below this many institutions a group gets a count but no median. */
export const MIN_UBPR_GROUP = 5;

/** Median of finite values with how many went in; null below `min`. */
export function medianWithCount(values: number[], min = MIN_UBPR_GROUP): MedianWithCount {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (s.length < min || s.length === 0) return { median: null, institution_count: s.length };
  const mid = Math.floor(s.length / 2);
  return { median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2, institution_count: s.length };
}

export interface UbprBankRow {
  institution_id: number | string | null;
  peer_group: string | null;
  ratios: Record<string, unknown> | null;
  state_code: string | null;
  fed_district: number | string | null;
  asset_size_tier: string | null;
  charter_type: string | null;
}

export function groupKey(row: UbprBankRow, dimension: UbprGroupDimension): string | null {
  const v =
    dimension === "peer_group" ? row.peer_group
      : dimension === "state" ? row.state_code
        : dimension === "fed_district" ? (row.fed_district == null ? null : String(row.fed_district))
          : row.asset_size_tier;
  return v === null || v === undefined || v === "" ? null : String(v);
}

export interface UbprRatioGroup {
  group: string;
  banks: number;
  ratios: Record<UbprRatioKey, MedianWithCount>;
}

/** Medians of each bank ratio per group. A bank without a value for a ratio adds nothing to it. */
export function ratioMediansBy(rows: UbprBankRow[], dimension: UbprGroupDimension, min = MIN_UBPR_GROUP): UbprRatioGroup[] {
  const groups = new Map<string, UbprBankRow[]>();
  for (const row of rows) {
    const key = groupKey(row, dimension);
    if (key === null) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups]
    .map(([group, members]) => {
      const ratios = {} as Record<UbprRatioKey, MedianWithCount>;
      for (const key of UBPR_RATIO_KEYS) {
        const values = members
          .map((m) => m.ratios?.[key])
          .filter((v) => v !== null && v !== undefined && v !== "")
          .map(Number);
        ratios[key] = medianWithCount(values, min);
      }
      return { group, banks: members.length, ratios };
    })
    .sort((a, b) => a.group.localeCompare(b.group, undefined, { numeric: true }));
}

/** The institution fields fee-index's peer test reads; a missing charter matches no charter filter. */
export function peerFields(row: {
  institution_id: number | string | null;
  charter_type: string | null;
  asset_size_tier: string | null;
  fed_district: number | string | null;
  state_code: string | null;
}) {
  return {
    institution_id: row.institution_id ?? undefined,
    charter_type: row.charter_type ?? "",
    asset_size_tier: row.asset_size_tier,
    fed_district: row.fed_district == null ? null : Number(row.fed_district),
    state_code: row.state_code,
  };
}

/** The newest quarter the loader wrote, or null when the table is empty. */
export async function getLatestUbprReportDate(): Promise<string | null> {
  const [row] = (await sql`SELECT MAX(report_date)::text AS d FROM ubpr_bank_peer_groups`) as { d: string | null }[];
  return row?.d ?? null;
}

async function bankRows(reportDate: string): Promise<UbprBankRow[]> {
  return (await sql`
    SELECT u.institution_id, u.peer_group, u.ratios, s.state_code, s.fed_district, s.asset_size_tier, s.charter_type
      FROM ubpr_bank_peer_groups u
      LEFT JOIN institution_sources s ON s.id = u.institution_id
     WHERE u.report_date = ${reportDate}::date
  `) as UbprBankRow[];
}

/** Bank ratio medians (computed by us) per group, for one quarter (the latest by default). */
export async function getUbprRatioMediansBy(
  dimension: UbprGroupDimension,
  options: { reportDate?: string; peers?: PeerFilterSet } = {},
): Promise<{ reportDate: string | null; groups: UbprRatioGroup[] }> {
  const reportDate = options.reportDate ?? (await getLatestUbprReportDate());
  if (!reportDate) return { reportDate: null, groups: [] };
  let rows = await bankRows(reportDate);
  const peers = options.peers;
  if (peers) rows = rows.filter((r) => r.institution_id !== null && matchesPeerFilters(peerFields(r), peers));
  return { reportDate, groups: ratioMediansBy(rows, dimension) };
}

export interface UbprPeerGroupSize {
  peer_group: string;
  banks: number;
  matched_banks: number;
  banks_with_fees: number;
}

/** How many banks each UBPR peer group holds, how many we know, and how many publish fees. */
export async function getUbprPeerGroupSizes(reportDate?: string): Promise<{ reportDate: string | null; groups: UbprPeerGroupSize[] }> {
  const date = reportDate ?? (await getLatestUbprReportDate());
  if (!date) return { reportDate: null, groups: [] };
  const rows = (await sql`
    SELECT u.peer_group,
           COUNT(*)::int AS banks,
           COUNT(u.institution_id)::int AS matched_banks,
           COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM published_fee_catalog p WHERE p.institution_id = u.institution_id))::int AS banks_with_fees
      FROM ubpr_bank_peer_groups u
     WHERE u.report_date = ${date}::date AND u.peer_group IS NOT NULL
     GROUP BY u.peer_group
  `) as UbprPeerGroupSize[];
  return { reportDate: date, groups: rows.sort((a, b) => a.peer_group.localeCompare(b.peer_group, undefined, { numeric: true })) };
}

export interface UbprPublishedAverage {
  peer_group: string;
  ratio_key: string;
  ratio_code: string | null;
  ratio_description: string | null;
  value: number;
}

/** The regulator's published peer-group averages for one quarter, as stored. */
export async function getUbprPublishedAverages(reportDate?: string): Promise<{ reportDate: string | null; averages: UbprPublishedAverage[] }> {
  const date = reportDate ?? ((await sql`SELECT MAX(report_date)::text AS d FROM ubpr_peer_group_averages`) as { d: string | null }[])[0]?.d ?? null;
  if (!date) return { reportDate: null, averages: [] };
  const rows = (await sql`
    SELECT peer_group, ratio_key, ratio_code, ratio_description, value::float8 AS value
      FROM ubpr_peer_group_averages
     WHERE report_date = ${date}::date
     ORDER BY peer_group, ratio_key
  `) as UbprPublishedAverage[];
  return { reportDate: date, averages: rows };
}

export interface UbprFeeMedian extends FeeStatistics {
  peer_group: string;
  fee_category: string;
}

interface FeeRow {
  institution_id: number;
  amount: number | null;
  fee_category: string;
  charter_type: string | null;
  peer_group: string;
  asset_size_tier: string | null;
  fed_district: number | null;
  state_code: string | null;
  schedule_keys: string[] | null;
  schedule_group: string | null;
}

/** Split "peer_group\u0000category" back apart. */
export function splitFeeKey(key: string): { peer_group: string; fee_category: string } {
  const at = key.indexOf("\u0000");
  return { peer_group: key.slice(0, at), fee_category: key.slice(at + 1) };
}

/**
 * Our live fee medians by UBPR peer group and category, under the shared statistics contract.
 * Optional: one category, and a saved peer group's filters to narrow the institutions first.
 */
export async function getFeeMediansByUbprPeerGroup(
  options: { reportDate?: string; category?: string; peers?: PeerFilterSet } = {},
): Promise<{ reportDate: string | null; medians: UbprFeeMedian[] }> {
  const reportDate = options.reportDate ?? (await getLatestUbprReportDate());
  if (!reportDate) return { reportDate: null, medians: [] };
  const params: unknown[] = [reportDate];
  let categoryClause = "";
  if (options.category) {
    params.push(options.category);
    categoryClause = `AND ef.fee_category = $${params.length}`;
  }
  let rows = (await sql.unsafe(
    `SELECT ef.institution_id, ef.amount, ef.fee_category, s.charter_type, u.peer_group,
            s.asset_size_tier, s.fed_district, s.state_code, ${STATS_SCHEDULE_KEYS}
       FROM published_fee_catalog ef
       JOIN institution_sources s ON s.id = ef.institution_id
       JOIN ubpr_bank_peer_groups u ON u.institution_id = s.id AND u.report_date = $1::date
      WHERE u.peer_group IS NOT NULL AND ef.fee_category IS NOT NULL AND ${statsRowFilter("ef")} ${categoryClause}`,
    params as never[],
  )) as FeeRow[];
  const peers = options.peers;
  if (peers) rows = rows.filter((r) => matchesPeerFilters(peerFields(r), peers));
  const medians: UbprFeeMedian[] = [];
  for (const [key, stats] of summarizeFeesBy(rows, (r) => `${r.peer_group}\u0000${r.fee_category}`)) {
    medians.push({ ...splitFeeKey(key), ...stats });
  }
  medians.sort((a, b) => a.fee_category.localeCompare(b.fee_category) || a.peer_group.localeCompare(b.peer_group, undefined, { numeric: true }));
  return { reportDate, medians };
}
