# Darwin did not judge a row again after Knox changed its category (#1295)

**Found:** 2026-10-14, Lane A, read-only SQL on production.

**Problem.** Darwin does not select a raw row twice at one `verify.rules` version, apart from the
version-bump exceptions (category guard, source check, envelope, batch key). A row rejected under
one category stayed rejected after Knox re-read it under another. Raw 126752, "Wire Transfer -
International" $45 (institution 7114, document 7699), was rejected as `category_mismatch` under
`overdraft` on every run from Oct 5 to Oct 14, although the re-read filed it `wire_intl_outgoing`.

**Second problem: old decisions do not say what Knox's category was.** A decision records the
category Darwin judged (`canonical_fee_key`), which is Knox's category after Darwin's own re-file.
Darwin's re-file changes with the guard, so a judged category that differs from Knox's today does
not prove Knox changed it: raw 132922, "Collection Items (plus any bank fees)" $20, a take-over
filed `collection_item`, was judged `check_cashing` on Oct 7, and today's `refileCategory` keeps
`collection_item`. Decisions now record `knox_category`; an older one counts as a Knox change only
with proof from the row's flags (a `knox_refiled_from:` or `knox_stale_hint_repaired` marker, or
the judged category among the row's other `canonical_hint:` flags).

**Measured (Oct 14):**
- The 216 rows #1093 step 2 sent back that Darwin had rejected earlier: 0 carry a category
  different from the one they were rejected under (every decision's `canonical_fee_key` against
  the first `canonical_hint:` flag). Reasons: 91 `category_mismatch`, 73 `outside_envelope`, 55
  `peer_outlier`, 4 `duplicate_in_batch` (a row can have more than one). Step 2 only restores a
  row read today with the same category, so these need another way out, not this rule.
- Retired free-pass rows on a current copy, not verified, not live by name and amount, with a
  Darwin decision: 1,216 rows (#1291 counted 668 with its own, narrower definition). Their stored
  category equals the category judged on all but 4 rows, and those 4 are Darwin's own re-file.
  Their category changes only when #1291's re-file pass writes today's category.
- Rows flagged for Darwin, unverified, decided, with no decision under their first flag: 87; 86
  carry no Knox marker and are Darwin's own re-file. The one marked row is 132922 (above).
- Candidates under the rule after #1291 merged: 0. No row yet carries `knox_refiled_from:` or
  `knox_stale_hint_repaired`; #1291's repair and re-file run inside its switched-off pass. The 8
  take-over rows whose stale flag is first qualify once that repair runs.

**Fix.** `src/lib/agents/darwin/category-change.ts`, shipped off; the read runs in a savepoint so
a failed count never aborts the verify step's transaction.

**Agent lesson:** darwin/issue-1295
