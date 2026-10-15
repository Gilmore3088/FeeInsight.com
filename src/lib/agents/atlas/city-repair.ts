import { sql } from "@/lib/data-store/connection";

type SqlTag = typeof sql;

/**
 * Atlas's city repair (#1213): NCUA's FOICU file cuts a credit union's city at 15 characters
 * ("Colorado Spring", "North Little Ro"), and the universe sync stored that cut on every credit
 * union inserted before #1317. The full name is the regulator's own: the credit union's office
 * city in NCUA's branch file (`credit_union_branches`, latest report), when exactly one longer
 * office city starts with the cut name (case ignored), title-cased where the file writes it in
 * capitals. The main office is not required; a
 * credit union whose offices offer two different longer names is left alone, as is a 15-letter
 * name no office extends (College Station, San Luis Obispo).
 *
 * A step in Atlas's daily scoreboard run. It writes only `institution_sources.city`, only where
 * the stored city is still the cut name, so a second run changes nothing. Every change (id,
 * old city, new city) goes in the step's ledger detail. A dry run lists them and changes nothing.
 * The cut city's public page redirects to the full name once no institution keeps the cut
 * (`fullCityForCut`, `src/lib/data-store/geographic.ts`).
 *
 * On by James's decision (Oct 15, 2026: "1213 needs to be fixed").
 */
export const CITY_REPAIR_LIVE = true;
/** The width NCUA's FOICU file cuts a city to. */
export const CITY_CUT_WIDTH = 15;
/** Changes listed in the ledger detail; the count is always whole. */
const LISTED = 200;

export interface CityRepairChange {
  institutionId: number;
  stateCode: string | null;
  oldCity: string;
  newCity: string;
}

export interface CityRepairResult {
  live: boolean;
  dryRun: boolean;
  /** Credit unions whose stored city is a cut name one office city extends. */
  candidates: CityRepairChange[];
  /** Credit unions with two different longer office cities: left for a person. */
  ambiguous: number;
  /** Rows written (0 on a dry run or while off). */
  repaired: CityRepairChange[];
}

interface CandidateRow {
  id: number | string;
  state_code: string | null;
  old_city: string;
  new_city: string;
  choices: number | string;
}

/**
 * The full name as a state page lists it: NCUA's branch file writes most cities in title case
 * ("North Little Rock") and a few in capitals ("DEFUNIAK SPRINGS"); capitals are title-cased so
 * one city reads the same on every row. Pure.
 */
export function displayCity(full: string): string {
  if (full !== full.toUpperCase()) return full;
  return full.toLowerCase().replace(/(^|[\s\-'.])([a-z])/g, (_, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`);
}

export async function runCityRepair(options: { db?: SqlTag; dryRun?: boolean; live?: boolean } = {}): Promise<CityRepairResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const live = options.live ?? CITY_REPAIR_LIVE;
  const rows = await db<CandidateRow[]>`
    WITH latest AS (SELECT max(report_date) AS d FROM credit_union_branches),
    offices AS (
      SELECT i.id, i.state_code, btrim(i.city) AS old_city, btrim(b.city) AS new_city
        FROM institution_sources i
        JOIN credit_union_branches b
          ON b.charter = i.ncua_charter_id::text AND b.report_date = (SELECT d FROM latest)
       WHERE i.charter_type = 'credit_union'
         AND length(btrim(i.city)) = ${CITY_CUT_WIDTH}
         AND length(btrim(b.city)) > ${CITY_CUT_WIDTH}
         AND upper(left(btrim(b.city), ${CITY_CUT_WIDTH})) = upper(btrim(i.city))
    )
    SELECT id, state_code, old_city, min(new_city) AS new_city,
           count(DISTINCT upper(new_city))::int AS choices
      FROM offices
     GROUP BY id, state_code, old_city
     ORDER BY state_code, old_city, id
  `;
  const candidates: CityRepairChange[] = [];
  let ambiguous = 0;
  for (const row of rows) {
    if (Number(row.choices) !== 1) {
      ambiguous += 1;
      continue;
    }
    candidates.push({ institutionId: Number(row.id), stateCode: row.state_code, oldCity: row.old_city, newCity: displayCity(row.new_city) });
  }
  const repaired: CityRepairChange[] = [];
  if (live && !dryRun && candidates.length > 0) {
    const payload = JSON.stringify(candidates.map((c) => ({ id: c.institutionId, old_city: c.oldCity, new_city: c.newCity })));
    const written = await db<{ id: number | string }[]>`
      WITH c AS (SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(id bigint, old_city text, new_city text))
      UPDATE institution_sources s SET city = c.new_city
        FROM c
       WHERE s.id = c.id AND btrim(s.city) = c.old_city
      RETURNING s.id
    `;
    const ids = new Set([...written].map((row) => Number(row.id)));
    for (const change of candidates) if (ids.has(change.institutionId)) repaired.push(change);
  }
  return { live, dryRun, candidates, ambiguous, repaired };
}

export function cityRepairDetail(result: CityRepairResult): Record<string, unknown> {
  const list = (changes: CityRepairChange[]) =>
    changes.slice(0, LISTED).map((c) => ({ id: c.institutionId, state: c.stateCode, old_city: c.oldCity, new_city: c.newCity }));
  return {
    live: result.live,
    dry_run: result.dryRun,
    candidates: result.candidates.length,
    ambiguous: result.ambiguous,
    repaired: result.repaired.length,
    changes: list(result.repaired.length > 0 ? result.repaired : result.candidates),
  };
}

export function summarizeCityRepair(result: CityRepairResult): string {
  const n = result.candidates.length;
  const ambiguous = result.ambiguous > 0 ? ` ${result.ambiguous} left for a person (two possible names).` : "";
  if (n === 0) return `Atlas found no credit union city cut at ${CITY_CUT_WIDTH} characters that the branch file can restore.${ambiguous}`;
  const noun = n === 1 ? "credit union city" : "credit union cities";
  if (result.repaired.length > 0) {
    return `Atlas restored ${result.repaired.length} of ${n} ${noun} cut at ${CITY_CUT_WIDTH} characters from NCUA's branch file.${ambiguous}`;
  }
  const why = result.dryRun ? "dry run" : "switched off";
  return `Atlas found ${n} ${noun} cut at ${CITY_CUT_WIDTH} characters that NCUA's branch file restores; changed none (${why}).${ambiguous}`;
}
