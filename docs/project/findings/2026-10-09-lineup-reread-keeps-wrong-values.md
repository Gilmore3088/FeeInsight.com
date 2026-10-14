# A Knox re-read cannot fix a wrong stored lineup value

**Found:** 2026-10-09, Data inventory thread (UAT check of PR 820).

**Problem:** Knox writes a monthly fee's lineup fields (`product_name`, `min_balance_to_avoid`,
`min_opening_deposit`, `waiver_text`) with `COALESCE`, so a re-read only fills empty fields. A
value read from a neighbour before a rules fix stays wrong after the fix: AllSouth FCU (5886)
Basic Checking kept the next account's $500 balance (raw 267602), Washington Trust (231) kept
$25,000 from another account's clause of one footnote line (raw 321960), and AllSouth's Money
Market fee (raw 267604, live 71912) kept the fee heading "Early (Share) Savings Account Closing"
as its account name.

**Fix:** Knox v55 stops reading from neighbours (`src/lib/agents/knox/lineup.ts`), and
`knox.lineup_correct` (`src/lib/agents/knox/lineup-correct.ts`) corrects stored values in place
during the publish step, from the stored text, with no model call. It changes a field only when
the v55 read differs and the stored value is explained as a leak (stated on a neighbouring line
or clause, not the fee's own); each change is a `lineup_corrected` row in `pipeline_feedback` with
the old and new values. Values it cannot explain stay as stored; correcting those needs a paid
Knox re-read.

**Rule:** a rules fix to a field written with `COALESCE` needs its own logged correction step for
rows already stored, or the fix only reaches new rows.
