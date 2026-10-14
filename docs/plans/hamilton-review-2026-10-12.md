# Hamilton review (2026-10-12)

Part of `docs/plans/pipeline-review-2026-10-12.md`. Hamilton is the last agent: it publishes
Darwin-verified fees to `published_fee_records` and keeps the live catalog honest, and it is also
the research publisher, the question-answering expert and the Pro workspace
(`src/lib/agents/hamilton/AGENTS.md`, "Hamilton's faces").

This review covers the first face, **the publisher**, because the data layer comes first
(`DECISIONS.md`, 2026-10-12). The other three faces stay under the existing Hamilton tracker #975
(H01–H07), whose work is reviewed there; a summary of where they stand is at the end.

**Measured** = read-only production query, 2026-10-12, 05:00–05:30 UTC. **Code** = `main` after
#1057.

## What the publisher does (code)

One handler runs the `publish` step (also reachable as `publish-index` and `publish-context`,
which run the same code; `src/lib/agents/run-store.ts:842`). The `/api/admin/agents/tick` cron
starts it every 5 minutes inside state-lane and priority runs. Each `publish` step:

1. **Runs about 26 sweeps over fees that are already live** (`run-store.ts:852–1067`): restore
   outliers and taxonomy fees, fold retired categories, roll back outliers, off-taxonomy fees,
   limits, business-schedule fees, same-line duplicates, other-bank documents, evaluation
   verdicts, article and product pages, cross-page conflicts, the category guard (100 per step),
   duplicate collapse, frequency fill, newer-copy retire, identical-copy moves, refresh from the
   current copy, second looks, the rules re-check (state or institution steps only), name tidying,
   change pairing and more.
2. **Publishes** (`publish.ts:1640`): Darwin-verified rows not yet live, whole documents oldest
   first, held by the 3-fee minimum, then per row the category guard, a name hold, the re-check
   twin test and `publishSkipReason` (flags, key, retired category, lineage, Darwin event,
   article or product page, amount envelope, $0 rule, limit guard, confidence ≥ 0.8).
3. **Then sweeps again**: the source check (`takeDownUntraceableFees`), import twins, feedback
   sync, and the benchmark cache refresh.

A newer copy of a fee is published as a **new row** and the old row is closed ("refreshed by
#…"); nothing is updated in place (`refresh-copy.ts:214`). A real price change takes the same
path with "superseded by #…" and also writes `fee_change_records`.

Every module in `src/lib/agents/hamilton/` is deterministic: **publishing makes no paid model
calls.**

## What it did (measured)

- **Live:** 76,749 live rows of 129,793 ever written. The last 10 days wrote 126,052 rows for
  61,739 distinct institution-and-fee pairs.
- **Work:** 3,382 `publish` steps in 7 days (8 failed), averaging 23 seconds, 90th percentile 64
  seconds: **20.7 hours of server time a week**. Vercel's charge for that is not visible from
  here; it is on Vercel's usage page.
- **Spend:** Hamilton's paid calls in the last 30 days were **$9.41, all from faces 2–4** (research
  streams $3.54, report sections $2.32, chat $1.80, memos $0.94, report theses $0.78), none from
  publishing. Its cap is $20/day, $300/month.

### Take-downs in the 7 days to 2026-10-12, excluding "refreshed by"

| Reason | Fees | Average time live | Reading |
|---|---|---|---|
| Rules re-check could not reproduce | 7,019 | 36 h | A rule churn: 2,833 on Oct 5, 1,578 on Oct 10, 1,196 on Oct 11, **2 on Oct 12** after #1022 kept distinct fees that share a category and price. 570 fee amounts were taken down this way twice or more |
| Duplicate of another live fee | 5,943 | 106 h | 4,010 on Oct 10 alone. Duplicates are collapsed after publishing, not refused before |
| Category guard: name contradicts category | 1,137 | 35 days | Old rows caught by a newer guard: backlog cleanup, working as intended |
| Source check: amount, name or text not found | 2,398 | 12–100 days | Mostly old rows caught by the source check |
| Product page | 745 | 73 h | The publish check and the later sweep disagree on the same rule |
| Other bank's document, unconfirmed host | 832 | 3–5 days | Same: caught days later by a sweep |
| Business schedule | 366 | 95 h | Same |

Two kinds of take-down are mixed here. **Old rows caught by a new rule** (live for weeks) are the
checks working through history. **Fees caught within hours or days by a rule that already
existed at publish time** (duplicates, product pages, other-bank documents, business schedules)
should never have gone live. That second group is about 7,900 fees a week.

### Refresh churn

Re-reading a page publishes a new row and closes the old one even when nothing changed: 32,556
"refreshed by" closures in 7 days, and 11,994 institution-fee-amount combinations with three or
more rows (1,678 with five or more, one with 35). Every "published" count, the daily email and
the take-down rate are inflated by this bookkeeping.

## What works

- Publishing is deterministic and cheap in model spend.
- The checks are thorough: the reason list above is long because the catalog is policed.
- The rules re-check churn stopped after #1022.
- #1024 (merged) lets an operator hold and release a published fee without SQL.

## Changes (sub-issues of #975)

Existing issues this review feeds rather than duplicates:
- **#1037** (gate fees before publishing; refresh in place): the numbers above are its evidence.
  HR1–HR3 below are its parts.
- **#1055** (19 institutions with 3+ fee types never published): HR5 is the likely cause.
- **#1045** (stale and duplicate code): HR7 lists Hamilton's part.

| # | Change |
|---|---|
| HR1 #1068 | Refresh in place: when a newer copy carries the same fee at the same amount, update the source on the live row instead of writing a new row. Removes ~32,500 rows a week of bookkeeping |
| HR2 #1069 | Refuse at publish what a sweep would take down: duplicates, product pages, other-bank documents, business schedules (about 7,900 fees a week). One rule, one function, called by both the publish check and the sweep |
| HR3 #1070 | Split the 26 sweeps out of every `publish` step into one daily maintenance step, so a publish step only publishes. Measure server time before and after |
| HR4 #1071 | Confirm #1022 ended the re-check churn, and list the re-check take-downs from Oct 5–11 that are not live again under another row, to see whether real fees were lost |
| HR5 #1072 | Make the publish-time 3-fee count match the catalog view's: publish counts pending verified rows and ignores quarantine, the view excludes quarantined rows and counts percent fees, so a bank can publish and still not appear |
| HR6 #1073 | Update `hamilton/AGENTS.md`: publish rules are version 3 (it says 2); the marketing loop now runs as Growth; the paid `/ask/memo` route; the cron runs every 5 minutes; the sweeps and their order |
| HR7 #1074 | Remove dead or duplicated code: the `publish-index` and `publish-context` aliases, the `peer_brief` render branch the legacy policy blocks, and the two near-identical insert-then-close paths |

## Faces 2–4 (research, questions, Pro workspace): where they stand

- **Reports:** 19 report jobs have completed, all internal (11 national index, 4 Monthly Pulse,
  4 state index); 0 are in `published_reports`. Publishing a report is a manual admin step. No
  customer competitive fee report has been produced. (The 2026-10-12 checkpoint said "0 report jobs
  completed"; that count was wrong, and is corrected here.)
- **Pro workspace and questions:** most builders are deterministic; paid calls are the chat,
  research, memo, simulate and Pro report routes, gated by the Pro quota and provider guard. In the
  last 7 days `pro.thesis` failed 6 of 11 runs and `pro.report` 2 of 7.
- **#975:** H01 and H02 (#985, #988) and H06 support (#995, #996) merged on Oct 11; H03 step 1
  (#1024) merged on Oct 12. H04, H05 and H07 are open, and the preview draft #1011 is waiting on
  James's visual review.
