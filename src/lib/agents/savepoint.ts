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

/**
 * Like `inSavepoint`, but outside a transaction it opens one (`db.begin`) instead of running
 * `work` bare. For work that must run in a transaction, such as a paid pass's settlement after
 * its model calls: provider steps run on the plain pool (run-store.ts), so the release review's
 * per-fee settlement there had no transaction, and `withLockedCurrentRawSource` refused every fee
 * ("Raw-owned source binding requires a transaction", run 17912, Nov 1) after the calls were paid.
 * A test double with neither `savepoint` nor `begin` runs `work` directly.
 */
export async function inSavepointOrTransaction<T>(db: SqlTag, work: (scope: SqlTag) => Promise<T>): Promise<T> {
  const savepoint = (db as unknown as { savepoint?: unknown }).savepoint;
  if (typeof savepoint === "function") return (savepoint as (callback: (scope: SqlTag) => Promise<T>) => Promise<T>).call(db, (scope) => work(scope));
  const begin = (db as unknown as { begin?: unknown }).begin;
  if (typeof begin === "function") return (begin as (callback: (scope: SqlTag) => Promise<T>) => Promise<T>).call(db, (scope) => work(scope));
  return work(db);
}
