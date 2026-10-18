import type { AreaFetch } from "@/lib/regulatory/economy";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { fetchErsFarmIncome, fetchNassCashRents, NASS_KEY_ENV, USDA_FARM_INCOME_URL_ENV } from "@/lib/regulatory/usda-farm";
import type { RegistryDb } from "./partitions";
import { HOURS, runRiskCostArea, yearsNewestFirst, type RiskCostRunResult } from "./risk-costs";

/**
 * Magellan registry step: USDA farm economy, one year per partition, newest first. Each run reads
 * ERS state farm income and wealth (net farm income, net cash income, cash receipts, debt) and,
 * when NASS_API_KEY is set, NASS cash rents per acre by county, state and nation. Without the key
 * the cash-rent half is recorded as skipped with "no NASS_API_KEY set" in the detail; the ERS half
 * still loads. Lands in area_statistics.
 */

export const USDA_FARM_SOURCE = "usda-farm";
export const USDA_FARM_PARSER_VERSION = 2;
/** Years kept: ERS revises recent years at each release and publishes a forecast for the current one. */
export const USDA_FARM_YEARS = 10;

export function usdaFarmPartitions(now: Date): string[] {
  const year = now.getUTCFullYear();
  return yearsNewestFirst(year - USDA_FARM_YEARS + 1, year);
}

export interface RegistryUsdaFarmOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  env?: Record<string, string | undefined>;
}

export async function runRegistryUsdaFarm(options: RegistryUsdaFarmOptions): Promise<RiskCostRunResult & { nassSkippedNoKey: boolean }> {
  const year = Number(options.partitionKey);
  if (!Number.isInteger(year) || year < 1990) throw new Error(`Invalid year partition for ${USDA_FARM_SOURCE}: ${options.partitionKey}`);
  const env = options.env ?? process.env;
  const ers = await fetchErsFarmIncome(year, { ...options.fetchOptions, url: env[USDA_FARM_INCOME_URL_ENV] });
  const nass = await fetchNassCashRents(year, env[NASS_KEY_ENV], options.fetchOptions);
  const rows = [...ers.rows, ...nass.rows];
  const reasons = [ers.emptyReason && `ERS: ${ers.emptyReason}`, nass.emptyReason && `NASS: ${nass.emptyReason}`].filter(Boolean);
  const combined: AreaFetch = {
    url: ers.url ?? nass.url,
    rows,
    missingFields: [...ers.missingFields, ...nass.missingFields],
    skipped: { ...Object.fromEntries(Object.entries(ers.skipped).map(([k, v]) => [`ers:${k}`, v])), ...Object.fromEntries(Object.entries(nass.skipped).map(([k, v]) => [`nass:${k}`, v])) },
    emptyReason: rows.length === 0 ? reasons.join("; ") || `No USDA farm values for ${year}` : null,
  };
  const r = await runRiskCostArea(options, combined, {
    source: USDA_FARM_SOURCE,
    label: "USDA farm income and cash rents",
    parserVersion: USDA_FARM_PARSER_VERSION,
    refreshHours: HOURS.month,
    emptyRetryHours: HOURS.week,
    extraDetail: {
      ers: { url: ers.url, rows: ers.rows.length, empty_reason: ers.emptyReason, ...ers.info },
      nass: { url: nass.url, rows: nass.rows.length, empty_reason: nass.emptyReason, skipped_no_key: nass.skippedNoKey, ...nass.info },
    },
  });
  return { ...r, nassSkippedNoKey: nass.skippedNoKey };
}
