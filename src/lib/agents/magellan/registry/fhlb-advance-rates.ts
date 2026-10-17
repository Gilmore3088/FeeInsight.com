import { sql } from "@/lib/data-store/connection";
import { checkAreaStats, dedupeAreaStats, type AreaStatChecks } from "@/lib/regulatory/economy";
import { FHLB_BANKS, fetchFhlbAdvanceRates, fhlbBank, type FhlbFetch } from "@/lib/regulatory/fhlb-advance-rates";
import type { RegistryFetchOptions } from "@/lib/regulatory/http";
import { upsertAreaStats } from "./economy";
import { recordRegistryPartition, type RegistryDb } from "./partitions";

/**
 * Magellan registry step `fhlb-advance-rates`: one FHLBank per partition (boston, new-york, ...).
 * Reads the bank's public rate page and stores each posted rate in area_statistics as a nation
 * row, series fhlb_<bank>_<product>_<term>, period = the date the bank says the rates were
 * posted. A bank whose rates are members-only, images only or not found is recorded empty with
 * that reason in the partition detail (never failed), and looked at again later.
 */

export const FHLB_ADVANCE_RATES_SOURCE = "fhlb-advance-rates";
export const FHLB_ADVANCE_RATES_PARSER_VERSION = 1;

const HOURS = { day: 24, week: 24 * 7, month: 24 * 30 };

/** One partition per FHLBank, in district order. Rates are posted daily, so every bank is "current". */
export function fhlbAdvanceRatesPartitions(now: Date): string[] {
  void now;
  return FHLB_BANKS.map((b) => b.key);
}

export interface RegistryFhlbAdvanceRatesOptions {
  runId?: number | null;
  partitionKey: string;
  dryRun?: boolean;
  db?: RegistryDb;
  fetchOptions?: RegistryFetchOptions;
  env?: Record<string, string | undefined>;
}

export interface RegistryFhlbAdvanceRatesResult {
  source: string;
  partitionKey: string;
  sourceUrl: string | null;
  postedDate: string | null;
  rows: number;
  writtenRows: number;
  missingFields: string[];
  checks: AreaStatChecks | null;
  dryRun: boolean;
  empty: boolean;
  emptyReason: string | null;
  /** True when the bank publishes nothing machine-readable (login, images) rather than a fetch failing. */
  skipped: boolean;
  summary: string;
  detail: Record<string, unknown>;
}

function retryHours(fetched: FhlbFetch): number {
  if (fetched.verdict === "member_login" || fetched.verdict === "images_only") return HOURS.month;
  if (fetched.verdict === "no_rate_table") return HOURS.week;
  return HOURS.day;
}

export async function runRegistryFhlbAdvanceRates(options: RegistryFhlbAdvanceRatesOptions): Promise<RegistryFhlbAdvanceRatesResult> {
  const db = options.db ?? sql;
  const bank = fhlbBank(options.partitionKey);
  if (!bank) throw new Error(`Unknown FHLBank partition: ${options.partitionKey}`);
  const dryRun = Boolean(options.dryRun);
  const fetched = await fetchFhlbAdvanceRates(bank, options.fetchOptions, options.env ?? process.env);
  const baseDetail = {
    parser_version: FHLB_ADVANCE_RATES_PARSER_VERSION,
    fhlbank: bank.key,
    district: bank.district,
    verdict: fetched.verdict,
    pages_tried: fetched.tried,
    missing_fields: fetched.missingFields,
    unread_term_labels: fetched.unreadTerms.slice(0, 20),
  };
  const base: RegistryFhlbAdvanceRatesResult = {
    source: FHLB_ADVANCE_RATES_SOURCE,
    partitionKey: options.partitionKey,
    sourceUrl: fetched.url,
    postedDate: fetched.rows[0]?.period ?? null,
    rows: 0,
    writtenRows: 0,
    missingFields: fetched.missingFields,
    checks: null,
    dryRun,
    empty: false,
    emptyReason: null,
    skipped: false,
    summary: "",
    detail: baseDetail,
  };

  if (fetched.rows.length === 0) {
    const reason = fetched.emptyReason ?? "no rates read";
    const skipped = fetched.verdict === "member_login" || fetched.verdict === "images_only";
    if (!dryRun) {
      await recordRegistryPartition(db, {
        source: FHLB_ADVANCE_RATES_SOURCE,
        partitionKey: options.partitionKey,
        status: "empty",
        rowCount: 0,
        sourceUrl: fetched.url,
        runId: options.runId ?? null,
        nextAttemptAfterHours: retryHours(fetched),
        detail: { ...baseDetail, reason, skipped },
      });
    }
    return { ...base, empty: true, emptyReason: reason, skipped, summary: `${bank.name}: no rates stored. ${reason}${dryRun ? " (dry run)" : ""}.`, detail: { ...baseDetail, reason, skipped } };
  }

  const checks = checkAreaStats(fetched.rows);
  const rows = dedupeAreaStats(fetched.rows);
  const detail = {
    ...baseDetail,
    posted_date: rows[0].period,
    rows: rows.length,
    blank_cells: rows.filter((r) => r.value === null).length,
    products: [...new Set(rows.map((r) => String(r.raw.product_label)))].slice(0, 30),
    series: rows.length,
    blank_by_series: checks.blankBySeries,
    duplicate_keys: checks.duplicateKeys,
    duplicate_examples: checks.duplicateExamples,
    flagged_values: checks.flagged,
  };
  if (dryRun) {
    return { ...base, rows: rows.length, checks, summary: `${bank.name}: read ${rows.length} posted rates for ${rows[0].period} (dry run).`, detail };
  }
  const written = await upsertAreaStats(db, FHLB_ADVANCE_RATES_SOURCE, rows, fetched.url, options.runId ?? null);
  await recordRegistryPartition(db, {
    source: FHLB_ADVANCE_RATES_SOURCE,
    partitionKey: options.partitionKey,
    status: "succeeded",
    rowCount: rows.length,
    insertedCount: written,
    sourceUrl: fetched.url,
    runId: options.runId ?? null,
    nextAttemptAfterHours: HOURS.day,
    detail: { ...detail, written_rows: written },
  });
  return {
    ...base,
    rows: rows.length,
    writtenRows: written,
    checks,
    summary: `Magellan loaded ${written} ${bank.name} advance rates posted ${rows[0].period}.`,
    detail: { ...detail, written_rows: written },
  };
}
