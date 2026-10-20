import type { RegistryDb } from "./partitions";

/** Shared by state ingestion and scoped repair; callers must already be in a transaction. */
export const HMDA_YEAR_LOCK_NAMESPACE = 2253;

export async function lockHmdaYear(tx: RegistryDb, year: number): Promise<void> {
  if (!Number.isInteger(year) || year < 2018 || year > 2100) throw new Error("Invalid HMDA lock year");
  await tx`SET LOCAL lock_timeout = '2s'`;
  await tx`SELECT pg_advisory_xact_lock(${HMDA_YEAR_LOCK_NAMESPACE}::int, ${year}::int)`;
}
