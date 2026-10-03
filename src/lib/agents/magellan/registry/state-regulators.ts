import { sql } from "@/lib/data-store/connection";
import { STATE_REGULATORS } from "@/lib/regulatory/state-regulators";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step: keep the state_regulators registry in sync with the
 * reviewed constant, and fill the chartering agency for credit unions whose
 * charter type is known (federal -> NCUA, state -> State; NCUA insures both).
 */

export const STATE_REGULATORS_SOURCE = "state-regulators";
export const STATE_REGULATORS_PARTITION = "current";
const REFRESH_HOURS = 24 * 30;

export interface RegistryStateRegulatorsResult {
  source: string;
  partitionKey: string;
  agencies: number;
  creditUnionsTagged: number;
  dryRun: boolean;
}

export async function runRegistryStateRegulators(
  options: { runId?: number | null; dryRun?: boolean; db?: RegistryDb } = {},
): Promise<RegistryStateRegulatorsResult> {
  const db = options.db ?? sql;
  const result: RegistryStateRegulatorsResult = {
    source: STATE_REGULATORS_SOURCE,
    partitionKey: STATE_REGULATORS_PARTITION,
    agencies: STATE_REGULATORS.length,
    creditUnionsTagged: 0,
    dryRun: Boolean(options.dryRun),
  };
  if (options.dryRun) return result;

  const payload = JSON.stringify(
    STATE_REGULATORS.map((entry) => ({
      state_code: entry.stateCode,
      state_name: entry.stateName,
      agency_name: entry.agency,
      website_url: entry.website,
      credit_union_agency_name: entry.creditUnionAgency ?? null,
      credit_union_website_url: entry.creditUnionWebsite ?? null,
    })),
  );
  await db`
    INSERT INTO state_regulators
      (state_code, state_name, agency_name, website_url, credit_union_agency_name, credit_union_website_url, updated_at)
    SELECT r.state_code, r.state_name, r.agency_name, r.website_url, r.credit_union_agency_name, r.credit_union_website_url, NOW()
      FROM jsonb_to_recordset(${payload}::jsonb) AS r(
        state_code text, state_name text, agency_name text, website_url text,
        credit_union_agency_name text, credit_union_website_url text
      )
    ON CONFLICT (state_code) DO UPDATE SET
      state_name = EXCLUDED.state_name,
      agency_name = EXCLUDED.agency_name,
      website_url = EXCLUDED.website_url,
      credit_union_agency_name = EXCLUDED.credit_union_agency_name,
      credit_union_website_url = EXCLUDED.credit_union_website_url,
      updated_at = NOW()
  `;
  const tagged = await db`
    UPDATE institution_sources
       SET primary_regulator = 'NCUA',
           charter_agency = CASE WHEN cu_charter_type = 'state' THEN 'State' ELSE 'NCUA' END
     WHERE charter_type = 'credit_union'
       AND cu_charter_type IS NOT NULL
       AND (primary_regulator IS DISTINCT FROM 'NCUA'
            OR charter_agency IS DISTINCT FROM CASE WHEN cu_charter_type = 'state' THEN 'State' ELSE 'NCUA' END)
    RETURNING id
  `;
  result.creditUnionsTagged = [...tagged].length;

  await recordRegistryPartition(db, {
    source: STATE_REGULATORS_SOURCE,
    partitionKey: STATE_REGULATORS_PARTITION,
    status: "succeeded",
    rowCount: result.agencies,
    insertedCount: result.creditUnionsTagged,
    runId: options.runId ?? null,
    nextAttemptAfterHours: REFRESH_HOURS,
  });
  return result;
}
