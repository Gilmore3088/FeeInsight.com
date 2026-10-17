import { fetchNfcs, NFCS_CODEBOOK_URL_ENV, NFCS_DATA_URL_ENV, NFCS_WAVES } from "@/lib/regulatory/finra-nfcs";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import type { RegistryDb } from "./partitions";
import { HOURS, runRiskCostArea, type RiskCostRunResult } from "./risk-costs";

/**
 * Magellan registry step: FINRA Foundation NFCS state-by-state survey, one wave (every three
 * years) per partition, newest first. Weighted state shares (with respondent counts) for the
 * checking, overdraft, emergency-savings and fragility questions found in the codebook. Lands in
 * area_statistics.
 */

export const FINRA_NFCS_SOURCE = "finra-nfcs";
export const FINRA_NFCS_PARSER_VERSION = 1;

/** Waves fielded by `now` (the state data come out the year after fielding). */
export function finraNfcsPartitions(now: Date): string[] {
  return NFCS_WAVES.filter((w) => w < now.getUTCFullYear()).map(String);
}

export interface RegistryFinraNfcsOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  env?: Record<string, string | undefined>;
}

export async function runRegistryFinraNfcs(options: RegistryFinraNfcsOptions): Promise<RiskCostRunResult> {
  const wave = Number(options.partitionKey);
  if (!Number.isInteger(wave) || wave < 2009) throw new Error(`Invalid wave partition for ${FINRA_NFCS_SOURCE}: ${options.partitionKey}`);
  const env = options.env ?? process.env;
  // Configured addresses are for the newest wave only; older waves are found on the page.
  const newest = String(NFCS_WAVES[0]) === options.partitionKey;
  const fetched = await fetchNfcs(wave, {
    ...options.fetchOptions,
    dataUrl: newest ? env[NFCS_DATA_URL_ENV] : undefined,
    codebookUrl: newest ? env[NFCS_CODEBOOK_URL_ENV] : undefined,
  });
  return runRiskCostArea(options, fetched, {
    source: FINRA_NFCS_SOURCE,
    label: "FINRA NFCS state survey",
    parserVersion: FINRA_NFCS_PARSER_VERSION,
    refreshHours: HOURS.quarter,
    emptyRetryHours: HOURS.month,
    extraDetail: { nfcs: fetched.info },
  });
}
