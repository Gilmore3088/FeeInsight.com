# 2026-11-01: the paid release review could not settle on the run ledger
**What happened:** Run 17912 (the Darwin release-review sample, #2846) started at 23:20 UTC on Nov 1, made 5 paid calls ($0.10) and failed with `Raw-owned source binding requires a transaction`. No verdict was recorded.
**Cause:** `run-store.ts` runs provider steps on the plain pool so that paid calls never sit inside a transaction. The release review and the adjudicator settle each fee with `inSavepoint`, which outside a transaction runs bare, and `withLockedCurrentRawSource` refuses to bind a source without one. The two-phase db test always wrapped the review in `db.begin`, so it never ran the ledger's real shape. `verify-paid` would have failed the same way the moment `DARWIN_RELEASE_ACTS` was turned on.
**Fix:** PR #2856: `inSavepointOrTransaction` opens a transaction per fee when the settlement has no savepoint; both settlements use it.
**Lesson:** Test a paid step the way the run ledger calls it: if the ledger gives provider steps no transaction, a settlement that needs one must open its own.
**Guard:** `src/lib/agents/savepoint-or-transaction.test.ts`
**Agent lesson:** darwin/paid-settlement-opens-its-own-transaction
