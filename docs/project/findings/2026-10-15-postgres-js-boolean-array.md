# postgres.js sends a JS boolean array as a scalar, so guard v62's re-files never ran

**Date:** 2026-10-15
**Found by:** the builder session, checking #1283 on prod after its catch-up

## What happened
- Guard v62 (#1283) re-files excess-activity fees in place. Its live-twin SQL passes one flag per move: `${moves.map((m) => m.excess)}::boolean[]`.
- postgres.js 3.4.8 infers an array's type from its first element (`node_modules/postgres/src/types.js`). It sends a JS array of booleans as a scalar `bool`.
- Postgres then raised `ERROR 42846: cannot cast type boolean to boolean[]`. This happened at 01:35:34 UTC on catch-up run 6503 and on every publish-step guard pass after that.
- `applyLiveRefiles` and `wouldRefile` catch the error, log it to the console and return an empty set. So `live_refiled_fees` was 0, and all 16 planned re-files fell through to the flag path. They were flagged `takedown_pending` and would have been taken down after the 12-hour second look, about 13:35 UTC.
- The unit tests use a fake `db` and check template text, so they never ran postgres.js serialization. The PR's dry run ran the pure functions locally, not the SQL.

## A trap in the obvious fix
Sending the flags as text and casting straight to `::boolean[]` does not raise an error, but it reads **every** flag as false. That would quietly apply the strict twin rule to the excess fees and block 3 of the 16 again (124670, 135850 and 142436).

`::text[]::boolean[]` reads the flags correctly. All of this was checked on Postgres 16 with postgres.js 3.4.8:

| Bound value | Cast | Result |
|---|---|---|
| `[true,false]` | `::boolean[]` | error |
| `["true","false"]` | `::boolean[]` | `[false,false]` |
| `["true","false"]` | `::text[]::boolean[]` | `[true,false]` |
| `sql.array([true,false], 16)` | none | `[true,false]` |

## Fix
`excessFlags()` sends the flags as text, and both queries cast them with `::text[]::boolean[]`.

On real Postgres, using the same twin SQL:
- an excess move next to an unrelated fee at the same price moves;
- a non-excess move with a same-price fee of the target type stays.

The unit test now fails if any bound value is a boolean array.

## For next time
- Never bind a JS boolean array. Send text and cast `::text[]::boolean[]`, or use `sql.array(values, 16)`.
- A catch that turns a failed write into "nothing to do" hides the failure. The run ledger should record it, not only the console.
- Rule 4 (data fixes proven end to end) covers this: the expected after-state was named, and the prod check caught the gap before the takedowns.
