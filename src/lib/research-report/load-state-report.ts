/**
 * Reads the State Index report data with the public state report's own cached readers.
 * A failed read throws (the report job is marked failed) rather than rendering a report
 * that would wrongly say the state has no data.
 */
import { getStateFeeIndexesCached, getStateStatsCached } from "@/lib/data-store/public-cached-reads";
import { STATE_TO_DISTRICT } from "@/lib/fed-districts";
import { getPublicNationalIndex, getPublicStatsSummary } from "@/lib/public-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { buildStateReportData, type StateReportData } from "./state-report-data";

export async function loadStateReportData(
  stateCode: string,
  options: { includeAllCategories?: boolean } = {},
): Promise<StateReportData> {
  const code = stateCode.toUpperCase();
  const stateName = STATE_NAMES[code];
  if (!stateName) throw new Error(`Unknown state code: ${stateCode}`);

  const [summary, stats, indexes, national] = await Promise.all([
    getPublicStatsSummary(),
    getStateStatsCached(code),
    getStateFeeIndexesCached(code),
    getPublicNationalIndex(),
  ]);

  return buildStateReportData({
    stateCode: code,
    stateName,
    district: STATE_TO_DISTRICT[code] ?? null,
    asOf: summary.refreshedOn,
    stats,
    indexes,
    national,
    includeAllCategories: options.includeAllCategories,
  });
}
