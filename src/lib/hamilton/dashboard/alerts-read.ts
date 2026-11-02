/**
 * Server read behind the Alerts and watches dashboard: like-for-like fee changes confirmed
 * nationally over the alert feed's weeks, through the same read the briefing, the monthly pulse
 * and the Command center use (loadConfirmedFeeChanges). The state's 180 days come from the Command
 * center's own read (readStateChanges). Read-only and deterministic: no writes, no provider call.
 * A failed read returns null and the page says so; it never takes the page down.
 */

import { unstable_cache } from "next/cache";
import { sql } from "@/lib/data-store/connection";
import { loadConfirmedFeeChanges } from "@/lib/report-assemblers/monthly-pulse";
import type { AlertChangeInput } from "./alerts-dashboard";
import { windowStart } from "./command-center-read";

/**
 * Confirmed changes in every state since `since`, cached for an hour per day and per newest change
 * record, so a change recorded (or removed) since the last read is never hidden behind the cache.
 */
const cachedNationalChanges = unstable_cache(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `newestRecord` is part of the cache key only.
  async (since: string, newestRecord: string): Promise<AlertChangeInput[]> => {
    const { changes } = await loadConfirmedFeeChanges(since, null);
    return changes.map((c) => ({
      institution_id: c.institution_id,
      institution_name: c.institution_name,
      state_code: c.state_code,
      fee_category: c.fee_category,
      display_name: c.display_name,
      old_amount: c.old_amount,
      new_amount: c.new_amount,
      direction: c.direction,
      changed_at: String(c.changed_at).slice(0, 10),
    }));
  },
  ["hamilton-alerts-national-changes-v1"],
  { revalidate: 3600 },
);

/** Like-for-like changes confirmed in every state in the last `days` days; null on a failed read. */
export async function readNationalChanges(days: number, now = new Date()): Promise<AlertChangeInput[] | null> {
  try {
    const [row] = await sql`SELECT COALESCE(MAX(id), 0)::text AS newest FROM fee_change_records`;
    return await cachedNationalChanges(windowStart(days, now), String(row?.newest ?? "0"));
  } catch {
    return null;
  }
}
