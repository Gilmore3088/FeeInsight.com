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
