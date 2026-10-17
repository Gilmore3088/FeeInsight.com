import { sql } from "./connection";

/**
 * Reads over the CFPB Making Ends Meet survey shares Magellan loads into area_statistics (source
 * cfpb-making-ends-meet). Server only; nothing here fetches from outside.
 *
 * Every value is a weighted share of survey respondents, in percent, for one wave; each one
 * carries its unweighted respondent count from raw_json so a reader can see how many answers sit
 * behind it. A share the file could not support is absent, never zero. Changes between waves are
 * in percentage points.
 */

export const MAKING_ENDS_MEET_AREA_SOURCE = "cfpb-making-ends-meet";
/**
 * The citation the CFPB's terms ask for. Show it under any figure from this survey, and never use
 * CFPB branding or suggest the CFPB endorses the figure (our weighted shares are our own work).
 */
export const MAKING_ENDS_MEET_CITATION =
  "Consumer Financial Protection Bureau. Making Ends Meet Public Use File. https://www.consumerfinance.gov/data-research/making-ends-meet-survey-data/public-data/";
export const OVERDRAFT_SERIES = "mem_paid_overdraft_fee";
const PAYERS = "_among_od_payers";
const NONPAYERS = "_among_od_nonpayers";

export interface MemShareRow {
  series_key: string;
  period: string;
  value: number | null;
  note: string | null;
  respondents: number | null;
}

export interface WaveShare {
  period: string;
  share: number | null;
  respondents: number | null;
  note: string | null;
  /** Percentage points since the previous wave shown; null for the first wave or across a blank. */
  change_pp: number | null;
}

export interface ShareTrend {
  series_key: string;
  waves: WaveShare[];
  /** Latest wave minus earliest wave, percentage points. */
  change_since_first_pp: number | null;
  latest: WaveShare | null;
}

const pp = (a: number | null, b: number | null) => (a !== null && b !== null ? Math.round((a - b) * 100) / 100 : null);

/** Pure: one series' waves, oldest first, with wave-to-wave changes. */
export function buildTrend(seriesKey: string, rows: MemShareRow[]): ShareTrend {
  const list = rows.filter((r) => r.series_key === seriesKey).sort((a, b) => a.period.localeCompare(b.period));
  const waves = list.map((r, i) => ({
    period: r.period,
    share: r.value,
    respondents: r.respondents,
    note: r.note,
    change_pp: i === 0 ? null : pp(r.value, list[i - 1].value),
  }));
  return {
    series_key: seriesKey,
    waves,
    change_since_first_pp: waves.length > 1 ? pp(waves[waves.length - 1].share, waves[0].share) : null,
    latest: waves[waves.length - 1] ?? null,
  };
}

function rowsFrom(raw: Array<{ series_key: string; period: string; value: number | null; note: string | null; respondents: string | number | null }>): MemShareRow[] {
  return raw.map((r) => ({ series_key: r.series_key, period: r.period, value: r.value, note: r.note, respondents: r.respondents === null ? null : Number(r.respondents) }));
}

/**
 * Share of households paying overdraft fees, wave by wave, with the change across waves; plus the
 * same trend by income band and by Census region when the file carried them.
 */
export async function getOverdraftShareTrend(): Promise<{ national: ShareTrend; byIncome: ShareTrend[]; byRegion: ShareTrend[] }> {
  const raw = await sql<Array<{ series_key: string; period: string; value: number | null; note: string | null; respondents: string | null }>>`
    SELECT series_key, period, value::float8 AS value, note, raw_json->>'respondents' AS respondents
      FROM area_statistics
     WHERE source = ${MAKING_ENDS_MEET_AREA_SOURCE} AND geo_type = 'nation' AND geo_code = 'US'
       AND (series_key = ${OVERDRAFT_SERIES} OR series_key LIKE ${`${OVERDRAFT_SERIES}_by_%`})
  `;
  const rows = rowsFrom([...raw]);
  const keys = [...new Set(rows.map((r) => r.series_key))].sort();
  return {
    national: buildTrend(OVERDRAFT_SERIES, rows),
    byIncome: keys.filter((k) => k.startsWith(`${OVERDRAFT_SERIES}_by_income_`)).map((k) => buildTrend(k, rows)),
    byRegion: keys.filter((k) => k.startsWith(`${OVERDRAFT_SERIES}_by_region_`)).map((k) => buildTrend(k, rows)),
  };
}

export interface StressComparison {
  measure: string;
  period: string;
  payers: { share: number | null; respondents: number | null; note: string | null } | null;
  nonpayers: { share: number | null; respondents: number | null; note: string | null } | null;
  /** Payers minus non-payers, percentage points; null without both. */
  gap_pp: number | null;
}

/** Pure: pairs each "<measure>_among_od_payers" with its non-payer twin, per wave. */
export function pairStress(rows: MemShareRow[]): StressComparison[] {
  const byKey = new Map<string, StressComparison>();
  for (const r of rows) {
    const group = r.series_key.endsWith(PAYERS) ? "payers" : r.series_key.endsWith(NONPAYERS) ? "nonpayers" : null;
    if (!group) continue;
    const measure = r.series_key.slice(0, -(group === "payers" ? PAYERS : NONPAYERS).length);
    const k = `${measure}|${r.period}`;
    const c = byKey.get(k) ?? { measure, period: r.period, payers: null, nonpayers: null, gap_pp: null };
    c[group] = { share: r.value, respondents: r.respondents, note: r.note };
    byKey.set(k, c);
  }
  return [...byKey.values()]
    .map((c) => ({ ...c, gap_pp: pp(c.payers?.share ?? null, c.nonpayers?.share ?? null) }))
    .sort((a, b) => b.period.localeCompare(a.period) || a.measure.localeCompare(b.measure));
}

/**
 * Overdraft payers versus non-payers on the financial-stress measures (difficulty paying bills,
 * covering an emergency expense, emergency savings, payday and other alternative credit, late
 * fees, credit score band), each share with its respondent count. Latest wave unless one is named.
 */
export async function getOverdraftStressComparison(period?: string): Promise<StressComparison[]> {
  const raw = await sql<Array<{ series_key: string; period: string; value: number | null; note: string | null; respondents: string | null }>>`
    SELECT series_key, period, value::float8 AS value, note, raw_json->>'respondents' AS respondents
      FROM area_statistics
     WHERE source = ${MAKING_ENDS_MEET_AREA_SOURCE} AND geo_type = 'nation' AND geo_code = 'US'
       AND (series_key LIKE ${`%${PAYERS}`} OR series_key LIKE ${`%${NONPAYERS}`})
       AND period = COALESCE(${period ?? null}::text,
             (SELECT MAX(period) FROM area_statistics
               WHERE source = ${MAKING_ENDS_MEET_AREA_SOURCE} AND series_key LIKE ${`%${PAYERS}`}))
  `;
  return pairStress(rowsFrom([...raw]));
}

/** Every national headline share (no breakouts), wave by wave, for a survey overview. */
export async function getMakingEndsMeetHeadlines(): Promise<ShareTrend[]> {
  const raw = await sql<Array<{ series_key: string; period: string; value: number | null; note: string | null; respondents: string | null }>>`
    SELECT series_key, period, value::float8 AS value, note, raw_json->>'respondents' AS respondents
      FROM area_statistics
     WHERE source = ${MAKING_ENDS_MEET_AREA_SOURCE} AND geo_type = 'nation' AND geo_code = 'US'
       AND series_key NOT LIKE '%\\_by\\_%' AND series_key NOT LIKE '%\\_among\\_od\\_%'
  `;
  const rows = rowsFrom([...raw]);
  return [...new Set(rows.map((r) => r.series_key))].sort().map((k) => buildTrend(k, rows));
}
