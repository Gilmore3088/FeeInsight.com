import { fetchOews } from "@/lib/regulatory/bls-oews";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import type { RegistryDb } from "./partitions";
import { HOURS, runRiskCostArea, yearsNewestFirst, type RiskCostRunResult } from "./risk-costs";

/**
 * Magellan registry step: BLS OEWS employment and wages for bank occupations (tellers, loan
 * officers, customer service reps, new accounts clerks, loan interviewers, financial managers,
 * credit analysts), nation + states + metros, one May estimate year per partition, newest first.
 * Lands in area_statistics.
 */

export const BLS_OEWS_SOURCE = "bls-oews";
export const BLS_OEWS_PARSER_VERSION = 1;
export const BLS_OEWS_FIRST_YEAR = 2019;

/** May estimates come out the following spring (late March or April); from May on, last year's are expected. */
export function latestOewsYear(now: Date): number {
  return now.getUTCMonth() >= 4 ? now.getUTCFullYear() - 1 : now.getUTCFullYear() - 2;
}

export function blsOewsPartitions(now: Date): string[] {
  return yearsNewestFirst(BLS_OEWS_FIRST_YEAR, latestOewsYear(now));
}

export interface RegistryBlsOewsOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
}

export async function runRegistryBlsOews(options: RegistryBlsOewsOptions): Promise<RiskCostRunResult> {
  const year = Number(options.partitionKey);
  if (!Number.isInteger(year) || year < 2000) throw new Error(`Invalid year partition for ${BLS_OEWS_SOURCE}: ${options.partitionKey}`);
  const fetched = await fetchOews(year, options.fetchOptions);
  return runRiskCostArea(options, fetched, {
    source: BLS_OEWS_SOURCE,
    label: "BLS OEWS bank-occupation wages",
    parserVersion: BLS_OEWS_PARSER_VERSION,
    refreshHours: HOURS.quarter,
    emptyRetryHours: HOURS.week,
    extraDetail: { oews: fetched.info },
  });
}
