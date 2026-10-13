import { sql } from "@/lib/data-store/connection";

type SqlTag = typeof sql;

/**
 * The Data room's numbers (#1122 step 5): what we hold, and the data piles that only a data change
 * clears. Read-only, one query; about 0.8 s on production (2026-10-13).
 */
export interface DataRoomCounts {
  liveInstitutions: number;
  liveFees: number;
  liveRateFees: number;
  /** Live dollar fees at institutions marked inactive or with a closed date (#1200). */
  closedInstitutionFees: number;
  closedInstitutions: number;
  /** Institutions whose city is exactly 15 characters, the cut-off width (#1213); some are real names. */
  cityAtLimit: number;
}

/** The Atlas source field width that cut city names ("Colorado Spring"). */
export const CITY_CUT_WIDTH = 15;

export async function readDataRoomCounts(db: SqlTag = sql): Promise<DataRoomCounts> {
  const [row] = await db<Record<string, number>[]>`
    WITH closed AS (
      SELECT pc.institution_id
        FROM published_fee_catalog pc
        JOIN institution_sources inst ON inst.id = pc.institution_id
       WHERE COALESCE(inst.status, 'active') <> 'active' OR inst.closed_date IS NOT NULL
    )
    SELECT
      (SELECT COUNT(DISTINCT institution_id) FROM published_fee_catalog)::int AS live_institutions,
      (SELECT COUNT(*) FROM published_fee_catalog)::int AS live_fees,
      (SELECT COUNT(*) FROM published_fee_rate_catalog)::int AS live_rate_fees,
      (SELECT COUNT(*) FROM closed)::int AS closed_fees,
      (SELECT COUNT(DISTINCT institution_id) FROM closed)::int AS closed_institutions,
      (SELECT COUNT(*) FROM institution_sources WHERE length(btrim(city)) = ${CITY_CUT_WIDTH})::int AS city_at_limit
  `;
  return {
    liveInstitutions: Number(row?.live_institutions ?? 0),
    liveFees: Number(row?.live_fees ?? 0),
    liveRateFees: Number(row?.live_rate_fees ?? 0),
    closedInstitutionFees: Number(row?.closed_fees ?? 0),
    closedInstitutions: Number(row?.closed_institutions ?? 0),
    cityAtLimit: Number(row?.city_at_limit ?? 0),
  };
}
