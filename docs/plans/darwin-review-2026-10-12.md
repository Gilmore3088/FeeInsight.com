# Darwin review (2026-10-12)

Part of `docs/plans/pipeline-review-2026-10-12.md`. Darwin judges each fee Knox extracted
(`raw_fee_observations`) and writes the ones that pass to `verified_fee_observations`, which the
publisher (Gutenberg, today Hamilton) puts live (`src/lib/agents/darwin/AGENTS.md`).

**Measured** = read-only production query, 2026-10-12, 06:25–06:45 UTC. **Code** = `main` at
`0a89d7ef`.

## What Darwin does (code)

- Steps: `classify` (free; also runs as `verify`, same code) and `verify-paid`, scheduled in each
  state lane.
- **Selection:** Knox rows flagged `needs_darwin_verification` with no verified row and no decision
  at the current rules version (v3), whole documents oldest first, up to 500 per step. Four cases
  are re-read after a rule change (category guard, source check, amount range, batch key).
- **Checks, in order:** category refile, missing category or name, category guard, lineage, rate
  checks, amount (a $0 needs Knox's zero flag), amount range (hand-set, else learned, else
  $0.01–$2,500), held categories, source check (`checkFeeAgainstSource`), retired category,
  conditional $0, name rules, in-batch duplicate; then the state peer check and a second-source
  check (consumer rows only); then insert.
- **After:** a re-check of up to 200 verified rows, a release pass for held rows, and an NSF refile.
- **Paid (Haiku 4.5, at most 10 calls of 25 fees per step):** a release review of held fees and an
  adjudicator for disputed categories.

## What it did (measured)

- **October 1–12:** 141,447 rows verified at 5,495 institutions; 16,234 rejected at 3,484. Most
  "rejected" rows were rejected after publishing by the publisher's sweeps writing back (rules
  re-check 7,172, cut-off name 2,946, source check 1,473, category guard 1,351, product page 745).
- **Spend:** $13.00 (release review $9.02 on 812 calls, adjudicator $3.98 on 778 calls).
- **Server time, last 7 days:** `classify` 3,379 steps (4.4 hours), `verify-paid` 1,234 (3.2 hours).
- **Backlog:** 15,137 Knox rows at 4,080 institutions have no Darwin decision; 1,674 are older than
  7 days, the oldest from Aug 23.

## Problems

### 1. Darwin pays for verdicts that change nothing (code + measured)

Releases of held fees are switched off in code (`DARWIN_RELEASE_ACTS = false`, paused 2026-10-08),
and the adjudicator is shadow only. Both still run on every held or disputed fee once per version:
$13.00 in October for no effect. The guide still says releases are on. If releases are switched
back on, released rows skip the post-source checks and are never re-checked.

### 2. Most fees skip the peer checks (code)

Only rows labeled `consumer` or `both` get the state peer check and the second-source check;
`unknown` and `business` skip both. With about 97% of new rows `unknown` (Knox review), the peer
check almost never runs. Only a state-level outlier holds a fee; district and national comparisons
are recorded only.

### 3. Fees get stuck with no way out (code + measured)

- `conditional_zero` and `category_lesson_pending` are "needs review", but the release pass only
  looks at range and peer holds, so these never leave.
- A release "keep" is never revisited.
- Rows due a re-read after a rule change do not wake a state lane and do not count in the health
  metric, so the re-read can wait indefinitely.
- That is part of the 15,137-row backlog (#1052).

### 4. One bad row can block a state lane (code)

A row carrying both `needs_darwin_verification` and `audience_correction_required` would make the
database trigger raise an error on insert; the step runs in one transaction, so it rolls back with
no record, and oldest-first selection picks the same document next time. The repair scripts remove
the first flag, so it should not happen, but no query guards against it.

### 5. The same checks run three times (code)

The source check runs in Knox, in Darwin and again in the publisher's sweep; the category guard and
amount range run in Knox, Darwin and the publisher. Darwin adds its own: conditional $0, learned
ranges, the peer hold, in-batch duplicates, the second source, frequency settling. That belongs with
HR2 (#1069): one rule, one function, a clear owner per check.

### 6. No usable admin page; internal signals reach customers (code)

`/admin/darwin` reads tables current code no longer writes, counts held and rejected rows as
"pending", has stub actions, and offers no held-fee queue. Meanwhile
`darwin_verification_needs_review` signals appear in the **Pro Monitor feed** (`SignalFeed.tsx:144`),
which customers see.

### 7. Guide out of date (code)

Release review v17 (guide says v13 and "releases on"), peer range v3 (guide v2), batch key v4
(guide v2), category guard v60 (guide notes stop at v42), the held-category list is empty (guide
lists one), the adjudicator is not Darwin's only paid call, and `percent_not_publishable` is
missing from the guide.

## What works

- Every decision is logged with a typed reason; nothing is silent.
- Verification is cheap: $13 a month, almost all deterministic.
- Re-reads after rule changes are targeted, not wholesale.

## Changes (tracker #1110)

Feeds: **#1052** (backlog, problem 3), **#1069** (one owner per check, problem 5), **#1059**
(audience, problem 2), **#1108** (every pile has an owner), **#1109** (guide drift guard).

| # | Change |
|---|---|
| D1 #1111 | Stop paid verdicts that change nothing; make released rows go through the same checks and re-check; measure the release review on the answer key before turning releases back on (needs James) |
| D2 #1112 | Run peer checks on unlabeled fees, counting `unknown` as consumer as for benchmarks (#1058); district fallback under 8 peers |
| D3 #1113 | Guard against one row blocking a state lane |
| D4 #1114 | Keep Darwin's internal review signals out of the Pro customer feed |
| D5 #1115 | Replace `/admin/darwin` with one held-fee queue; every hold gets an exit and an age alarm; due re-reads count in the backlog |
| D6 #1116 | Bring `darwin/AGENTS.md` up to date |
