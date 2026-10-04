import type { sql } from "@/lib/data-store/connection";

type SqlTag = typeof sql;

/**
 * Run `work` inside a SAVEPOINT when `db` is a transaction.
 *
 * Agent steps run inside the run-ledger transaction. A failed statement there aborts
 * the whole transaction, so catching the error in JavaScript is not enough: every
 * later statement in the step fails too. A savepoint rolls back only the failed part
 * and lets the caller decide whether that failure is fatal. Outside a transaction (or
 * with a test double) `work` runs directly.
 */
export async function inSavepoint<T>(db: SqlTag, work: (scope: SqlTag) => Promise<T>): Promise<T> {
  const savepoint = (db as unknown as { savepoint?: unknown }).savepoint;
  if (typeof savepoint !== "function") return work(db);
  return (savepoint as (callback: (scope: SqlTag) => Promise<T>) => Promise<T>).call(db, (scope) => work(scope));
}
