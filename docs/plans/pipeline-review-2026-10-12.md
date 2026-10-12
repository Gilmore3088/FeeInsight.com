# Pipeline review: one agent at a time (started 2026-10-12)

James asked for a review of each pipeline agent before the pipeline is relied on again, so that
turning it back on does not lead, a week later, to the same data or the same spend problems. This
file is the master: why the review exists, what "done" means, what we found across the whole
pipeline, and how the work is tracked. Each agent has its own review file next to this one.

Every number below says where it came from. **Measured** means a read-only query on production
on 2026-10-12, between 00:30 and 03:30 UTC. **Code** means read from `main` at `fdd21bd7` and has
not been checked against production behaviour.

## What the business needs, in order

1. **The data layer.** The best fee database we can build: right document, right fee, right
   category, for enough banks and credit unions in every state and size tier to benchmark.
2. **Raw intelligence.** Benchmarks and peer comparisons built from that data.
3. **The intelligence layer.** Hamilton, on top of 1 and 2.

The first customers are most likely institutions under $10B, at around $150 a month, not the
largest banks. A $500M community bank compares itself with banks of its own size in its own
state. The coverage goal is set by that, not by asset size alone.

## What "done" means (A+ data layer)

The build-out phase ends when all of these hold. After that the pipeline runs in maintenance mode.

- **Coverage:** every state, in every asset tier, has enough covered institutions for a
  meaningful benchmark on the top 50 fees. The state experts already wait for 8 institutions
  per tier before showing peer levels (`src/lib/agents/state-expert/memory.ts`), so that number
  is the starting threshold; James may raise it.
- **Accuracy:** the share of live fees whose amount and category match the bank's own current
  schedule (`checkFeeAgainstSource`), measured on a dated sample, at or above a target James sets.
- **Trust:** fewer than 1% of fees published in a week are taken down as wrong in the same week.
- **Cost:** cost per newly covered institution is reported every week and is falling.

Exact targets are open decisions for James; they are listed in the master tracker issue.

## Spend: two separate pots

| | Pipeline (agents on Vercel) | Claude usage (coding sessions) |
|---|---|---|
| Limit | Enforced in code: `api_budget_policies` caps all provider spend at $75/day and $500/month, plus a monthly cap per agent | Whatever limit is set on the Claude account |
| October 1–12 (measured) | $264: Magellan $150 (at its cap since Oct 11), Knox $75, Rosetta $16, Darwin $13, Hamilton $9 | Most of the ~$1,000/week James saw |
| Lesson | The pipeline cannot run away; the question is whether its spend buys coverage | Scheduled routines on long sessions were the leak. They are off (2026-10-12) |

The notes on the budget rows are stale: they still say "$300/month, Magellan $60". The caps that
apply are the numbers above. Correcting them is a data change and needs James's approval.

## Cross-pipeline findings (measured)

### 1. Fees are being caught after they go live

In the 7 days to 2026-10-12, 47,800 published fee records were taken down
(`published_fee_records.rolled_back_reason`):

| Reason | Count | Reading |
|---|---|---|
| `refreshed by #…` | 31,410 | A newer copy of the same fee replaced it. Bookkeeping, not an error, but it inflates every "published" count |
| `rules_recheck_unreproduced` | 6,003 | Rule changes. 4,899 of these fees are live again under another row |
| `duplicate of #…` | 5,657 | Duplicates caught after publishing |
| Source check, category guard, product page, other bank's document, business-only, no category, not a fee | about 4,400 | Wrong fees that were public before a check took them down |

The checks work; they run too late. See `docs/project/findings/2026-10-12-fees-caught-after-publishing.md`.

### 2. Customer and admin fee submissions reach no agent (code)

`/submit-fees` accepts a URL only. It writes `community_fee_submissions`; accepting one in admin
overwrites the bank's main link and adds a `source_validation_queue` row that no agent reads.
The Oct 2 plan (phase 2B) planned to make these queue inputs; it was not built. See
`docs/project/findings/2026-10-12-fee-submissions-not-consumed.md`.

### 3. The self-improvement layer was planned and not built (code)

`docs/plans/pipeline-self-learning-plan-2026-10-02.md` designs five layers. L1 (attempt log),
L2 (per-institution playbook), L3 (strategy router) and L5 (error-to-test, as Deming) exist.
**L4, knowledge promotion, does not:** no `discovery_patterns`, `extraction_templates`,
`fee_name_aliases`, `host_policies` or `category_envelopes` table or code exists. L4 is the part
that turns a paid answer into a free rule, so the same work is never paid for twice. Magellan's
`platform-learning.ts` covers part of `discovery_patterns`. The rest is open.

### 4. The scorecard and the daily email do not measure the goal (code)

`/admin/scoreboard` shows six numbers; none is cost, take-downs or benchmark-ready coverage.
Freshness resets when a page is re-checked even if nothing was re-read; accuracy has no date on
the page. The daily email's "documents downloaded" is an all-time count of distinct stored files,
wrong pages included (`src/lib/data-store/pipeline-funnel.ts:40`).

### 5. Document storage is cheap but unmanaged (measured)

Files are in Cloudflare R2 (`src/lib/agents/document-vault.ts`), stored once per content hash.
16,760 files, 3.2 GB; 2.7 GB added in the last 7 days. 63% of the bytes are HTML pages of
100 KB to 1 MB (modern pages carry their scripts and styles inline), 24% are PDFs over 1 MB, and
the largest files include CRA public files and marketing flyers, not fee schedules. Nothing is ever
deleted. At R2's published rate (about $0.015 per GB-month, first 10 GB free) this is cents a
month, but storing wrong documents is waste and a sign of what discovery accepts.

### 6. State experts exist but are invisible (code)

`src/lib/agents/state-expert/` has 55 named experts that build a state memory (regulator, website
platforms, finder and reader rankings, peer price levels), read by Magellan, Darwin and Hamilton.
No admin page shows an expert, its memory or its progress. James has never seen them.

### 7. Coverage by size (measured)

| Assets | Institutions | With live fees |
|---|---|---|
| $10B+ | 184 | 150 (82%) |
| $1–10B | 1,339 | 821 (61%) |
| $250M–1B | 2,346 | 1,075 (46%) |
| $100–250M | 1,633 | 671 (41%) |
| Under $100M | 3,016 | 1,119 (37%) |

Total: 3,835 of 8,522 active institutions. `asset_size` is stored in thousands of dollars.

### 8. Pages for institutions without fees are hidden from search (code)

The public page renders with FDIC/NCUA data, but under 5 verified fees it is `noindex` and left
out of the sitemap (`src/app/(public)/institution/[id]/page.tsx:105`, `src/app/sitemap.ts:220`).
Whether to index pages that carry real financial data is a decision for James.

## How the review runs

**Stage 0, the foundation (#1047), comes first.** The repository's instructions are reset to how
work runs now, so every later session starts from the same, correct map.

Then one agent at a time. Magellan was reviewed first and is built first, because it drives most
of the pipeline's activity and paid spend. Hamilton is next in importance, then the agents in
between (Rosetta, Knox, Darwin), the state experts and Atlas. Each review:

1. Reads the agent's `AGENTS.md` and code, and the earlier plans, so nothing is rebuilt.
2. Measures what it did on production: spend, yield, repeats, what it hands downstream.
3. Writes `docs/plans/<agent>-review-YYYY-MM-DD.md`: facts, the expected run, and the changes.
4. Opens one tracker issue for the agent with every change as its own sub-issue, and names the
   existing issues it closes or merges. Infrastructure, documentation and process work that
   belongs to no agent goes under the Foundation tracker instead.

Reviews are documentation and issues only. Code changes happen afterwards, one issue and one
PR at a time.

## Keeping the work finite

- Every needed change is documented as an issue; nothing is left only in a conversation.
- #1026 starts with a **Now / Next / Later** list. Now holds at most three items, and nothing new
  starts until one closes. Each session starts from the top Now item.
- Only work that serves the A+ data layer goes in Now or Next; the rest is Later.
- James re-orders the list once a week (about ten minutes). That is the whole management job.

## Tracking in GitHub

- **Master tracker issue:** "Pipeline review: master tracker". Lists every agent tracker and every
  cross-pipeline issue as sub-issues, plus James's open decisions.
- **One tracker issue per agent**, as a sub-issue of the master, with its changes as sub-issues.
- **Cross-pipeline issues** (findings 1–8) are sub-issues of the master.
- Labels: `workspace:product`, the label the control issue's product queue already uses.
- A GitHub Projects board is optional. The available GitHub tools cannot create one; James can
  make one in the GitHub web interface and add the master tracker's sub-issues to it.

## Reviews

Master tracker: #1026; its Now / Next / Later list sets the order of work. Foundation tracker
(infrastructure, documentation and process work that belongs to no agent): #1048, with the
foundation reset #1047, the scorecard #1040, storage #1041, the indexing decision #1043, admin
structure #1044 and the code audit #1045.
Cross-pipeline issues: X1 #1037 (gate before publishing), X2 #1038
(priority intake), X3 #1039 (plan L4), X4 #1040 (scorecard), X5 #1041 (storage), X6 #1042
(state experts in admin), X7 #1043 (indexing decision), X8 #1044 (admin structure), X9 #1045
(stale and duplicate code).

| Agent | Review | Status |
|---|---|---|
| Magellan | `docs/plans/magellan-review-2026-10-12.md`, tracker #1027 | Written 2026-10-12 |
| Hamilton | Existing tracker #975 stays its home | Next review |
| Rosetta | | |
| Knox | | |
| Darwin | | |
| State experts | | |
| Atlas | | |
