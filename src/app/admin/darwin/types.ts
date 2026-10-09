/**
 * Darwin's panel counters. Each comes from the shared ledgers (fee tiers, the run
 * ledger, the spend ledger), so scheduled lane work counts the same as a manual
 * repair; null means that read failed, never zero.
 */
export type DarwinStatus = {
  /** Knox rows with no verified row yet (includes rows Darwin rejected or holds). */
  pending: number | null;
  /** Verified rows created since UTC midnight. */
  today_promoted: number | null;
  /** Darwin provider spend for the UTC day, as Controls shows it. */
  today_cost_usd: number | null;
  circuit: { halted: boolean; reason?: string | null };
  /** The most recently finished Darwin step from any run. */
  last_step: { run_id: number; status: string; at: string } | null;
  /** When the counters were read; null when nothing could be read. */
  as_of: string | null;
};

export type BatchEvent =
  | { type: "batch_start"; size: number }
  | { type: "candidates_selected"; count: number }
  | { type: "cache_lookup_done"; hits: number; total: number }
  | { type: "llm_call_start"; size: number }
  | { type: "llm_call_done"; success: boolean; error?: string }
  | {
      type: "row_complete";
      fee_raw_id: number;
      fee_name?: string;
      amount?: number | null;
      outcome: "promoted" | "cached_low_conf" | "rejected" | "failure";
      key?: string | null;
      confidence?: number;
      error?: string;
    }
  | { type: "halted"; reason: string }
  | { type: "done"; result: BatchResult }
  | { type: "error"; message: string };

export type BatchResult = {
  processed: number;
  cache_hits: number;
  llm_calls: number;
  promoted: number;
  cached_low_conf: number;
  rejected: number;
  failures: number;
  cost_usd: number;
  duration_s: number;
  circuit_tripped: boolean;
  halt_reason: string | null;
};

export const BATCH_SIZES = [100, 500, 1000] as const;
export type BatchSize = (typeof BATCH_SIZES)[number];
