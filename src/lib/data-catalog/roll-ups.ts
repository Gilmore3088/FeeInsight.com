import type { sql } from "@/lib/data-store/connection";
import type { AreaGeoType } from "@/lib/data-store/economy-aggregates";
import { ncuaCallMeasure } from "./ncua-call-measures";

/**
 * Roll-ups computed when they are read, over the tables that already hold the figures. Nothing is
 * stored: a peer group's median is one grouped query over area_statistics or
 * institution_call_report_items for the group's members, so there is no table to keep fresh and
 * no disk to grow.
 *
 * Every member counts once. A period where fewer than ROLLUP_MIN_INSTITUTIONS members have a
 * figure shows no median (null, never zero) and says why.
 */

/** Fewest institutions behind a median, the same floor the fee index and the national report use. */
export const ROLLUP_MIN_INSTITUTIONS = 5;

/** Area levels a peer's headquarters can be read at, finest first. */
const HQ_LEVELS: readonly AreaGeoType[] = ["county", "metro", "state"];

/** The finest level, of a source's levels, that a peer's headquarters can be placed in; null for a national-only source. */
export function hqLevelFor(servedGeoTypes: readonly AreaGeoType[]): AreaGeoType | null {
  return HQ_LEVELS.find((level) => servedGeoTypes.includes(level)) ?? null;
}

type Tx = typeof sql;

/**
 * An area period's last and first month as SQL over `a.period`, the same month rule as
 * periodMonths(). Constant SQL text; the bounds it is compared with are bound parameters.
 */
export const AREA_PERIOD_LAST_MONTH_SQL = `(CASE
  WHEN a.period ~ '^[0-9]{4}$' THEN a.period || '-12'
  WHEN a.period ~ '^[0-9]{4}Q[1-4]$' THEN left(a.period, 4) || '-' || lpad((substr(a.period, 6, 1)::int * 3)::text, 2, '0')
  WHEN a.period ~ '^[0-9]{4}-[0-9]{2}' THEN left(a.period, 7)
END)`;
export const AREA_PERIOD_FIRST_MONTH_SQL = `(CASE
  WHEN a.period ~ '^[0-9]{4}$' THEN a.period || '-01'
  WHEN a.period ~ '^[0-9]{4}Q[1-4]$' THEN left(a.period, 4) || '-' || lpad(((substr(a.period, 6, 1)::int - 1) * 3 + 1)::text, 2, '0')
  WHEN a.period ~ '^[0-9]{4}-[0-9]{2}' THEN left(a.period, 7)
END)`;

export interface RollupRow {
  period: string;
  unit: string;
  median: number | null;
  p25: number | null;
  p75: number | null;
  institution_count: number;
  source_url: string | null;
  fetched_at: string | Date | null;
}

export interface AreaRollupRow extends RollupRow {
  area_count: number;
}

export interface CallRollupRow extends RollupRow {
  period_basis: string | null;
  sources: string[] | null;
}

/**
 * One series of public data rolled up over a group of institutions: for each period, the median
 * of the figure for the area each member is headquartered in (county from
 * institution_hq_counties, metro and state from institution_sources). Members with no
 * headquarters on record at that level, or whose area has no figure, are left out of that
 * period's count.
 */
export async function areaPeerRollup(
  tx: Tx,
  args: { source: string; seriesKey: string; geoType: AreaGeoType; memberIds: number[]; from: string | null; to: string | null; limit: number; servedSql: string },
): Promise<AreaRollupRow[]> {
  const rows = await tx<AreaRollupRow[]>`
    WITH members AS (
      SELECT DISTINCT ON (s.id) s.id,
             CASE ${args.geoType}::text
               WHEN 'county' THEN lpad(h.county_fips::text, 5, '0')
               WHEN 'metro' THEN s.cbsa_code::text
               ELSE upper(s.state_code)
             END AS geo_code
        FROM institution_sources s
        LEFT JOIN institution_hq_counties h ON h.institution_id = s.id AND ${args.geoType}::text = 'county'
       WHERE s.id = ANY(${args.memberIds}::bigint[])
       ORDER BY s.id, h.basis
    )
    SELECT a.period, a.unit,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY a.value)::float8 AS median,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY a.value)::float8 AS p25,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY a.value)::float8 AS p75,
           count(DISTINCT m.id)::int AS institution_count,
           count(DISTINCT a.geo_code)::int AS area_count,
           max(a.fetched_at) AS fetched_at,
           (array_agg(a.source_url ORDER BY a.fetched_at DESC NULLS LAST))[1] AS source_url
      FROM members m
      JOIN area_statistics a ON a.geo_type = ${args.geoType} AND a.geo_code = m.geo_code
     WHERE a.source = ${args.source}
       AND a.series_key = ${args.seriesKey}
       AND a.value IS NOT NULL
       -- Struck rows (DECISIONS.md "No non-commercial data") never count.
       AND ${tx.unsafe(args.servedSql)}
       AND (${args.from}::text IS NULL OR ${tx.unsafe(AREA_PERIOD_LAST_MONTH_SQL)} >= ${args.from}::text)
       AND (${args.to}::text IS NULL OR ${tx.unsafe(AREA_PERIOD_FIRST_MONTH_SQL)} <= ${args.to}::text)
     GROUP BY a.period, a.unit
     ORDER BY a.period DESC, a.unit
     LIMIT ${args.limit}
  `;
  return [...rows];
}

/**
 * Value and unit of a call-report line in comparable terms: FFIEC dollar lines are filed in
 * thousands and NCUA's in whole dollars, so both become dollars; counts stay counts.
 */
const CALL_VALUE_SQL = `(CASE WHEN c.unit = 'thousands' THEN c.value * 1000 ELSE c.value END)`;
const CALL_UNIT_SQL = `(CASE WHEN c.unit = 'count' THEN 'count' ELSE 'USD' END)`;

/**
 * One call-report line rolled up over a group of institutions (null memberIds: every filer), one
 * row per report date: the median of the members' own filed values.
 */
export async function callPeerRollup(
  tx: Tx,
  args: { itemKey: string; rowSources: string[]; memberIds: number[] | null; from: string | null; to: string | null; limit: number },
): Promise<CallRollupRow[]> {
  const measure = ncuaCallMeasure(args.itemKey);
  const rowSources = measure ? args.rowSources.filter((source) => source === "ncua") : args.rowSources;
  const rows = await tx<CallRollupRow[]>`
    SELECT to_char(c.report_date, 'YYYY-MM-DD') AS period, ${tx.unsafe(CALL_UNIT_SQL)} AS unit,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY ${tx.unsafe(CALL_VALUE_SQL)})::float8 AS median,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY ${tx.unsafe(CALL_VALUE_SQL)})::float8 AS p25,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY ${tx.unsafe(CALL_VALUE_SQL)})::float8 AS p75,
           count(DISTINCT c.institution_id)::int AS institution_count,
           c.period_basis,
           array_agg(DISTINCT c.source) AS sources,
           max(c.fetched_at) AS fetched_at,
           (array_agg(c.source_url ORDER BY c.fetched_at DESC NULLS LAST))[1] AS source_url
      FROM institution_call_report_items c
      JOIN institution_sources identity ON identity.id = c.institution_id
        AND ((identity.charter_type = 'bank' AND c.source = 'ffiec')
          OR (identity.charter_type = 'credit_union' AND c.source = 'ncua'))
     WHERE c.item_key = ${args.itemKey}
       AND c.source = ANY(${rowSources}::text[])
       AND (${measure?.code ?? null}::text IS NULL OR c.item_code = ${measure?.code ?? null}::text)
       AND (${measure?.storedUnit ?? null}::text IS NULL OR c.unit = ${measure?.storedUnit ?? null}::text)
       AND (${measure?.periodBasis ?? null}::text IS NULL OR c.period_basis = ${measure?.periodBasis ?? null}::text)
       AND (${args.memberIds}::bigint[] IS NULL OR c.institution_id = ANY(${args.memberIds}::bigint[]))
       AND (${args.from}::text IS NULL OR to_char(c.report_date, 'YYYY-MM') >= ${args.from}::text)
       AND (${args.to}::text IS NULL OR to_char(c.report_date, 'YYYY-MM') <= ${args.to}::text)
     GROUP BY c.report_date, 2, c.period_basis, c.source
     ORDER BY c.report_date DESC, 2, c.period_basis, c.source
     LIMIT ${args.limit}
  `;
  return [...rows];
}

export interface CallInstitutionRow {
  period: string;
  item_code: string;
  item_description: string | null;
  schedule: string | null;
  value: number;
  unit: string;
  period_basis: string;
  source: string;
  source_url: string | null;
  fetched_at: string | Date | null;
}

/** One institution's own filed values for a call-report line, newest report date first. */
export async function callInstitutionSeries(
  tx: Tx,
  args: { itemKey: string; rowSources: string[]; institutionId: number; from: string | null; to: string | null; limit: number },
): Promise<CallInstitutionRow[]> {
  const measure = ncuaCallMeasure(args.itemKey);
  const rowSources = measure ? args.rowSources.filter((source) => source === "ncua") : args.rowSources;
  const rows = await tx<CallInstitutionRow[]>`
    SELECT to_char(c.report_date, 'YYYY-MM-DD') AS period, c.item_code, c.item_description, c.schedule,
           ${tx.unsafe(CALL_VALUE_SQL)}::float8 AS value, ${tx.unsafe(CALL_UNIT_SQL)} AS unit,
           c.period_basis, c.source, c.source_url, c.fetched_at
      FROM institution_call_report_items c
      JOIN institution_sources identity ON identity.id = c.institution_id
        AND ((identity.charter_type = 'bank' AND c.source = 'ffiec')
          OR (identity.charter_type = 'credit_union' AND c.source = 'ncua'))
     WHERE c.institution_id = ${args.institutionId}
       AND c.item_key = ${args.itemKey}
       AND c.source = ANY(${rowSources}::text[])
       AND (${measure?.code ?? null}::text IS NULL OR c.item_code = ${measure?.code ?? null}::text)
       AND (${measure?.storedUnit ?? null}::text IS NULL OR c.unit = ${measure?.storedUnit ?? null}::text)
       AND (${measure?.periodBasis ?? null}::text IS NULL OR c.period_basis = ${measure?.periodBasis ?? null}::text)
       AND (${args.from}::text IS NULL OR to_char(c.report_date, 'YYYY-MM') >= ${args.from}::text)
       AND (${args.to}::text IS NULL OR to_char(c.report_date, 'YYYY-MM') <= ${args.to}::text)
     ORDER BY c.report_date DESC
     LIMIT ${args.limit}
  `;
  return [...rows];
}
