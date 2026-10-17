import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { latestPublishableQuarter, parseQuarterKey, quarterKey, quartersNewestFirst, type Quarter } from "@/lib/regulatory/quarters";
import { fetchF2, USCOURTS_F2_URL_ENV } from "@/lib/regulatory/uscourts-bankruptcy";
import type { RegistryDb } from "./partitions";
import { HOURS, runRiskCostArea, type RiskCostRunResult } from "./risk-costs";

/**
 * Magellan registry step: US Courts Table F-2 bankruptcy filings, one quarter per partition,
 * newest first. District rows are summed to states (districts kept in raw); the table's TOTAL
 * row is the nation. Lands in area_statistics.
 */

export const USCOURTS_BANKRUPTCY_SOURCE = "uscourts-bankruptcy";
export const USCOURTS_BANKRUPTCY_PARSER_VERSION = 1;
export const USCOURTS_BANKRUPTCY_FIRST: Quarter = { year: 2018, quarter: 1 };
/** US Courts posts the F-2 tables some weeks after quarter end. */
export const USCOURTS_BANKRUPTCY_LAG_DAYS = 45;

export function uscourtsBankruptcyPartitions(now: Date): string[] {
  return quartersNewestFirst(USCOURTS_BANKRUPTCY_FIRST, latestPublishableQuarter(now, USCOURTS_BANKRUPTCY_LAG_DAYS)).map(quarterKey);
}

export interface RegistryUscourtsBankruptcyOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  env?: Record<string, string | undefined>;
}

export async function runRegistryUscourtsBankruptcy(options: RegistryUscourtsBankruptcyOptions): Promise<RiskCostRunResult> {
  const q = parseQuarterKey(options.partitionKey);
  if (!q) throw new Error(`Invalid quarter partition for ${USCOURTS_BANKRUPTCY_SOURCE}: ${options.partitionKey}`);
  const env = options.env ?? process.env;
  const fetched = await fetchF2(q, { ...options.fetchOptions, template: env[USCOURTS_F2_URL_ENV] });
  return runRiskCostArea(options, fetched, {
    source: USCOURTS_BANKRUPTCY_SOURCE,
    label: "US Courts F-2 bankruptcy filings",
    parserVersion: USCOURTS_BANKRUPTCY_PARSER_VERSION,
    refreshHours: HOURS.quarter,
    emptyRetryHours: HOURS.week,
    extraDetail: { f2: fetched.info },
  });
}
