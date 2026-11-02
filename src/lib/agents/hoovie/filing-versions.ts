import type { RegistryDb } from "@/lib/agents/magellan/registry/partitions";

/**
 * Filing versions (#2613, R9): an amended FDIC or NCUA quarter keeps what was filed before.
 *
 * The registry loaders update a filing row only when a reported value changed. In that same
 * statement they add a row to `registry_filing_versions` with the changed values as
 * [as stored before, as refetched]. Readers keep reading the main tables (the latest version).
 * Postgres runs every part of one statement against the same snapshot, so the versions CTE reads
 * the row as it stood before the upsert in that statement changes it.
 *
 * Until the migration has run, `filingVersionsReady` is false and the loaders write as before,
 * saying so in the partition detail. No load fails because the table is missing.
 */

export const FILING_VERSIONS_TABLE = "registry_filing_versions";

/** Reported values whose change is an amendment. Not raw_json, the source URL or the cert: those are provenance. */
export const FDIC_RECORD_VALUE_KEYS = [
  "total_assets", "total_deposits", "total_loans", "total_equity", "total_securities", "net_income",
  "net_interest_income", "other_noninterest_income", "noninterest_expense", "provision_for_losses",
  "service_charge_income", "net_charge_offs", "noncurrent_loans", "loans_real_estate", "loans_commercial",
  "loans_consumer", "loans_credit_card", "loans_auto", "loans_agricultural", "core_deposits",
  "brokered_deposits", "uninsured_deposits", "total_revenue", "fee_income_ratio", "roa", "roe",
  "net_interest_margin", "efficiency_ratio", "net_charge_off_rate", "noncurrent_loan_rate",
  "leverage_ratio", "tier1_capital_ratio", "total_capital_ratio", "employee_count", "branch_count",
] as const;

export const NCUA_RECORD_VALUE_KEYS = [
  "total_assets", "total_deposits", "total_loans", "total_equity", "net_income", "service_charge_income",
  "overdraft_revenue", "nsf_revenue", "net_charge_offs", "noninterest_expense", "total_revenue",
  "fee_income_ratio", "noncurrent_loans", "loans_real_estate", "loans_consumer", "loans_credit_card",
  "loans_auto", "tier1_capital_ratio", "roa", "net_charge_off_rate", "noncurrent_loan_rate", "member_count",
] as const;

/** A call-report line is amended when its value, unit or period basis changes; a relabel is not. */
export const CALL_ITEM_VALUE_KEYS = ["value", "unit", "period_basis"] as const;

const ready = new WeakMap<object, Promise<boolean>>();

/**
 * Whether the versions table exists on this database. A yes is remembered per connection; a no is
 * asked again next time, so a warm instance starts versioning as soon as the migration has run.
 */
export async function filingVersionsReady(db: RegistryDb): Promise<boolean> {
  const key = db as unknown as object;
  const known = ready.get(key);
  if (known && (await known)) return true;
  const asked = (async () => {
    const rows = await db<{ ok: boolean }[]>`SELECT to_regclass('registry_filing_versions') IS NOT NULL AS ok`;
    return Boolean(rows[0]?.ok);
  })().catch(() => false);
  ready.set(key, asked);
  return asked;
}

/** Forget the cached answer (tests that create the table mid-run). */
export function resetFilingVersionsReady(db: RegistryDb): void {
  ready.delete(db as unknown as object);
}

/** The partition-detail entry a loader records about versioning. */
export function filingVersionsDetail(write: { amended: number | null; versioning: boolean }): Record<string, unknown> {
  if (!write.versioning) return { amended_rows: null, reason: "registry_filing_versions not created yet" };
  return write.amended === null ? { amended_rows: null, counted_in: FILING_VERSIONS_TABLE } : { amended_rows: write.amended };
}

/** One versions row as stored, for readers and tests. */
export interface FilingVersionRow {
  table_name: string;
  row_id: number;
  institution_id: number;
  source: string;
  report_date: string;
  item_key: string | null;
  changed: Record<string, [unknown, unknown]>;
  prior_agent_run_id: number | null;
  superseded_by_run_id: number | null;
  superseded_at: string;
}
