import { sql } from "./connection";
import { matchesPeerFilters, type PeerFilterSet } from "./fee-index";
import { STATS_ROW_FILTER, STATS_SCHEDULE_KEYS, summarizeFees, type FeeStatistics, type StatsInputRow } from "./fee-stats";
import { STRUCK_DESIGNATIONS } from "./struck-sources";

/**
 * Reads over institution_designations (Magellan's designation-lists loader): how many
 * institutions carry a designation by state, Fed district, asset-size tier and charter, and
 * live fee medians for designated institutions against the rest. Server only.
 *
 * Fee medians use the shared statistics contract (summarizeFees over published_fee_catalog with
 * STATS_ROW_FILTER and approved rows), so every median carries its institution count and is
 * null below the minimum sample. Only matched rows (institution_id set) count; unmatched list
 * rows are in the partition detail, not here. A saved peer group narrows both sides through
 * matchesPeerFilters, the fee index's own peer test.
 */

export type DesignationDimension = "state" | "district" | "tier" | "charter";

export interface DesignationSelector {
  designation: string;
  /** One listed value (an MDI group, a specialty group, "mutual"); omitted means any value. */
  value?: string;
}

export interface InstitutionDimRow {
  institution_id: number | string;
  /** institution_sources.charter_type is NOT NULL. */
  charter_type: string;
  state_code: string | null;
  fed_district: number | null;
  asset_size_tier: string | null;
  designated: boolean;
}

export interface DesignationCount {
  dimension: DesignationDimension;
  key: string;
  designated: number;
  institutions: number;
  /** designated / institutions, 0-1; null when the group is empty. */
  share: number | null;
}

function keyOf(row: Pick<InstitutionDimRow, "charter_type" | "state_code" | "fed_district" | "asset_size_tier">, dimension: DesignationDimension): string | null {
  switch (dimension) {
    case "state":
      return row.state_code ?? null;
    case "district":
      return row.fed_district === null || row.fed_district === undefined ? null : String(row.fed_district);
    case "tier":
      return row.asset_size_tier ?? null;
    case "charter":
      return row.charter_type ?? null;
  }
}

/** Designated and total institutions per group; an institution with no value for the dimension is left out of it. */
export function countByDimension(rows: InstitutionDimRow[], dimension: DesignationDimension): DesignationCount[] {
  const groups = new Map<string, { designated: number; institutions: number }>();
  for (const row of rows) {
    const key = keyOf(row, dimension);
    if (key === null) continue;
    const g = groups.get(key) ?? { designated: 0, institutions: 0 };
    g.institutions += 1;
    if (row.designated) g.designated += 1;
    groups.set(key, g);
  }
  return [...groups]
    .map(([key, g]) => ({ dimension, key, designated: g.designated, institutions: g.institutions, share: g.institutions ? g.designated / g.institutions : null }))
    .sort((a, b) => b.designated - a.designated || a.key.localeCompare(b.key));
}

function designatedSql(sel: DesignationSelector) {
  // A struck list's rows (Bank On) may still be on prod; no institution counts as carrying it.
  if (STRUCK_DESIGNATIONS.includes(sel.designation)) return sql`FALSE`;
  return sel.value === undefined
    ? sql`EXISTS (SELECT 1 FROM institution_designations d WHERE d.institution_id = s.id AND d.designation = ${sel.designation})`
    : sql`EXISTS (SELECT 1 FROM institution_designations d WHERE d.institution_id = s.id AND d.designation = ${sel.designation} AND d.value = ${sel.value})`;
}

/** Counts by state, Fed district, asset-size tier and charter for one designation, among active institutions. */
export async function getDesignationCounts(
  sel: DesignationSelector,
  peers: PeerFilterSet | null = null,
): Promise<Record<DesignationDimension, DesignationCount[]> & { designated: number; institutions: number }> {
  const rows = (await sql`
    SELECT s.id AS institution_id, s.charter_type, s.state_code, s.fed_district, s.asset_size_tier,
           ${designatedSql(sel)} AS designated
      FROM institution_sources s
     WHERE COALESCE(s.regulatory_status, 'active') <> 'inactive'
  `) as unknown as InstitutionDimRow[];
  const scoped = peers ? rows.filter((r) => matchesPeerFilters(r, peers)) : [...rows];
  return {
    designated: scoped.filter((r) => r.designated).length,
    institutions: scoped.length,
    state: countByDimension(scoped, "state"),
    district: countByDimension(scoped, "district"),
    tier: countByDimension(scoped, "tier"),
    charter: countByDimension(scoped, "charter"),
  };
}

export interface DesignationValueCount {
  value: string;
  institutions: number;
}

/** The values a designation takes (MDI groups, specialty groups, FOM codes) with matched institution counts. */
export async function getDesignationValues(designation: string): Promise<DesignationValueCount[]> {
  if (STRUCK_DESIGNATIONS.includes(designation)) return [];
  const rows = (await sql`
    SELECT value, COUNT(DISTINCT institution_id)::int AS institutions
      FROM institution_designations
     WHERE designation = ${designation} AND institution_id IS NOT NULL
     GROUP BY value
     ORDER BY institutions DESC, value
  `) as unknown as Array<{ value: string; institutions: number }>;
  return rows.map((r) => ({ value: r.value, institutions: Number(r.institutions) }));
}

export type FeeRowWithDims = InstitutionDimRow &
  Pick<StatsInputRow, "amount" | "schedule_keys" | "schedule_group"> & {
    fee_category: string;
  };

export interface DesignationFeeComparison {
  fee_category: string;
  /** Group key for a grouped comparison (a state, district or tier); "national" otherwise. */
  group: string;
  designated: FeeStatistics;
  others: FeeStatistics;
  /** designated median minus others' median; null unless both medians exist. */
  median_gap: number | null;
}

/** Designated against the rest, per fee category and (optionally) per state, district or tier. */
export function compareDesignated(rows: FeeRowWithDims[], groupBy: DesignationDimension | "national" = "national"): DesignationFeeComparison[] {
  const buckets = new Map<string, { designated: FeeRowWithDims[]; others: FeeRowWithDims[] }>();
  for (const row of rows) {
    const group = groupBy === "national" ? "national" : keyOf(row, groupBy);
    if (group === null) continue;
    const k = `${row.fee_category}\u0000${group}`;
    const b = buckets.get(k) ?? { designated: [], others: [] };
    (row.designated ? b.designated : b.others).push(row);
    buckets.set(k, b);
  }
  const out: DesignationFeeComparison[] = [];
  for (const [k, b] of buckets) {
    const [fee_category, group] = k.split("\u0000");
    const designated = summarizeFees(b.designated);
    const others = summarizeFees(b.others);
    const gap = designated.median_amount !== null && others.median_amount !== null ? Number((designated.median_amount - others.median_amount).toFixed(2)) : null;
    out.push({ fee_category, group, designated, others, median_gap: gap });
  }
  return out.sort((a, b) => a.fee_category.localeCompare(b.fee_category) || a.group.localeCompare(b.group));
}

/** Live fee medians for institutions carrying a designation against the rest (optionally within a peer group). */
export async function getDesignationFeeMedians(
  sel: DesignationSelector,
  options: { categories?: string[]; groupBy?: DesignationDimension | "national"; peers?: PeerFilterSet | null } = {},
): Promise<DesignationFeeComparison[]> {
  const categories = options.categories?.length ? options.categories : null;
  const rows = (await sql`
    SELECT ef.fee_category, ef.amount, ef.institution_id, s.charter_type, s.state_code, s.fed_district,
           s.asset_size_tier, ${designatedSql(sel)} AS designated, ${sql.unsafe(STATS_SCHEDULE_KEYS)}
      FROM published_fee_catalog ef
      JOIN institution_sources s ON s.id = ef.institution_id
     WHERE ef.fee_category IS NOT NULL
       AND ef.review_status = 'approved'
       AND ${sql.unsafe(STATS_ROW_FILTER)}
       ${categories ? sql`AND ef.fee_category = ANY(${categories}::text[])` : sql``}
  `) as unknown as FeeRowWithDims[];
  const scoped = options.peers ? rows.filter((r) => matchesPeerFilters(r, options.peers!)) : [...rows];
  return compareDesignated(scoped, options.groupBy ?? "national");
}
