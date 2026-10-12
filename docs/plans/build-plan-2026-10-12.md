# Build plan (from the 2026-10-12 pipeline review)

This is the single ordered path for building what the 2026-10-12 reviews found. A builder works
from the top: one issue, one branch, one PR, then the next. The reviews themselves are in
`docs/plans/*-review-2026-10-12.md`; decisions are in `docs/project/DECISIONS.md` (2026-10-12);
the master tracker is #1026.

## Two rules that shape every item

- **Classification belongs to Darwin** (DECISIONS, 2026-10-12): Knox suggests a category, audience
  and tier with evidence; Darwin decides; Gutenberg publishes Darwin's decision with one final check;
  Deming audits independently. Build #1059, #1069, #1102 and #1112 this way.
- **Targets:** accuracy 95% on Deming's daily audit (weekly average); Knox 85% found and 90% right
  on the answer key; coverage 30 per state and size group, or 75%.

## Rules for the builder

1. **One issue at a time, in this order.** Skip an item only if it is blocked; say why on the issue
   and take the next one.
2. **Before starting an item:** read the issue and its review section, search open PRs and `main`
   for the same work, and read the agent's `AGENTS.md`.
3. **Every code PR** names the issue, says what it changes, how it was verified, and, from #1106 on,
   the one scorecard number it should move. Run `npm run guard:legacy`, lint, typecheck and the
   changed packages' tests before pushing.
4. **Merge** only under the standing authorization in `CLAUDE.md`: exact head reviewed, CI green, no
   conflict, no unresolved blocking review, and none of the gates below.
5. **Gates: open the PR, do not merge, add it to James's list** when a PR:
   - adds or changes a migration (`supabase/migrations/`), or changes production data (restores,
     relabels, releases, backfills);
   - switches on a paid provider or raises a budget;
   - changes words or numbers a visitor or customer reads (pages, footnotes, emails): use the
     `copywriting` and `copy-editing` skills, add a copy-review note, and leave it for James to see on
     the Vercel preview;
   - deletes branches, force-pushes, or touches permissions or security settings (never do these).
6. **After each merge:** add one line to the day's checkpoint (`docs/project/checkpoints/`), what
   merged and what it should move, so James wakes up to a readable summary.
7. **Never:** push to `main`, use Firecrawl, add one-off data scripts, add scheduled Claude routines,
   or fake a number. If a count is not known, say so.
8. **A gated item does not stop the run.** Open its PR, list it for James, and continue with the next
   item that does not depend on it. Stop only when every remaining item is gated or blocked, or at the
   account's spend limit, and leave a short status comment on #1026.

## Phase 0: safety and quick wins (small, low risk)

| # | Issue | What | Gate |
|---|---|---|---|
| 1 | #1114 | Keep Darwin's internal review signals out of the Pro customer feed | — |
| 2 | #1113 | Guard against one row blocking a Darwin state lane | — |
| 3 | #1111 (step 1) | No paid Darwin verdicts while releases are off | — |
| 4 | #1117 (step 3) | Remove the expired Tennessee priority settings | — |
| 5 | #1081 | Stop reading `.claude/skills` into Pro prompts at runtime | — |
| 6 | #1080 | Count memo calls in the Pro quota; fail closed | — |

## Phase 1: measurement (everything after this is judged by it)

| # | Issue | What | Gate |
|---|---|---|---|
| 7 | #1058 | Benchmarks: count unlabeled fees as consumer with the asterisk and footnote James approved; methodology page | Customer-facing: James checks preview |
| 8 | #1040 | Scorecard and daily email that measure the goal | — |
| 9 | #1119 | Store Deming's daily audit as dated results; accuracy trend | Migration if a table is added |
| 10 | #1064 | Benchmark health check: sample sizes, ranges, alarm on collapse | — |
| 11 | #1106 | PR template "Should move" line; 7-day did-it-work check | Template now; check after #1040 |
| 12 | #1109, #1120 | CI guards: guides match version constants; Bayes manifests | — |
| 13 | #1073, #1096, #1116 | Bring the Hamilton, Knox and Darwin guides up to date | — |
| 13a | #1122 | Admin redesign: seven rooms replace about 57 screens (`docs/plans/admin-redesign-2026-10-12.md`); new screens below go into its rooms, never beside them | — |

## Phase 2: stop losing what we already have

| # | Issue | What | Gate |
|---|---|---|---|
| 14 | #1093 | Knox keeps fees on a re-read | Code: no. Restore of 1,646 fees: yes (data) |
| 15 | #1115 | One held-fee queue; every Darwin hold gets an exit and an age alarm (#1052) | — |
| 16 | #1102 | Knox held lines: publish percentages, group names, label queue | Data if existing rows change |
| 17 | #1104 | Sunday maintenance email for James | — |
| 18 | #1072 | One 3-fee count for publishing and the catalog view | Migration |
| 19 | #1071 | Confirm the re-check churn ended (read-only) | — |

## Phase 3: the right document, typed

| # | Issue | What | Gate |
|---|---|---|---|
| 20 | #1094 | Document type: Magellan sets it, Rosetta confirms, the type picks the tool | Migration if a column is added |
| 21 | #1053, #1033 | Reject product pages and wrong-bank documents at discovery and reading | — |
| 22 | #1051 | Send 1,235 thin institutions back to Magellan | — |
| 23 | #1078 | A Pro account's own institution comes first | — |
| 24 | #1059 | Knox labels audience from headings and sections | Relabel of existing rows: data |
| 25 | #1095 | One definition of a thin document and expected fee count | — |

## Phase 4: Gutenberg and publishing

| # | Issue | What | Gate |
|---|---|---|---|
| 26 | #1075 | Move publishing to Gutenberg (relabel first, then move code) | Migration (reporter check) |
| 27 | #1069 | Refuse at publish what a sweep would take down; one function per rule | — |
| 28 | #1068 | Refresh unchanged fees in place | — |
| 29 | #1070 | Move the 26 sweeps to one daily step | — |
| 30 | #1074 | Remove dead and duplicated publish code | — |

## Phase 5: getting better on its own

| # | Issue | What | Gate |
|---|---|---|---|
| 31 | #1112 | Darwin peer checks on unlabeled fees | — |
| 32 | #1117 (steps 1–2) | Atlas schedules lanes toward the coverage target | — |
| 33 | #1028, #1029 | Coverage target per state and size; state experts own their work lists | — |
| 34 | #1105 | Institution intelligence record and contradiction check | Migration if needed |
| 35 | #1098 | Knox targets on the answer key; prepare the answer-key batch for James | James confirms banks |
| 36 | #1099 | Learn from missed fees | — |
| 37 | #1100 | Weak-category specialists, monthly maintenance first | — |
| 38 | #1101 | Pay once: templates and name library (part of #1039) | Migration |
| 39 | #1118 | State memory changes Rosetta's reader and Knox's templates | — |
| 40 | #1065 | Daily data-quality step | — |
| 41 | #1107 | Monthly agent health report | — |
| 42 | #1108 | Every finding ends in a guard; every pile has an owner and alarm | — |

## Phase 6: Hamilton before the first paying customer

| # | Issue | What | Gate |
|---|---|---|---|
| 43 | #1076 | Fix the five standard questions that fail everywhere | — |
| 44 | #1077 | Answer the question asked | — |
| 45 | #1079 | Answer eval checks correctness and covers paid paths | Paid sample is capped |
| 46 | #981 | One evidence gate for every paid answer | — |
| 47 | #1082 | Prompts follow the no-advice rule; two studies shown, three held | Customer-facing |
| 48 | #1083 | Finish or hide unreachable workspace features | Customer-facing |
| 49 | #1084 | Local competitors, fee income vs peers, the reader's peer set | — |
| 50 | #1066 | Reconcile every report before delivery | — |
| 51 | #1060, #1062 | Account tiers and ranges; Personal and Business sections | Customer-facing; migration |
| 52 | #1090 | Regulatory Wire feeds Hamilton's regulation answers | — |

## Phase 7: Magellan's remaining changes

#1031 and #1032 (rolling cooldowns, "not published online"), #1030 and #1035 (re-aim and lighten the
big-bank search), #1036 (budget notes: needs James), #1034 (closes when #1094 lands).

## Parked (do not start)

#1085 and #1089 (price-change modelling, private submissions), #1103 (interest rates, after the fee
data is A+), #1086 (state fee law drafting), #1121 (Growth, until marketing resumes), #1039 L4 items
not listed above, #1038, #1041, #1043, #1044, #1045, #1054, #1055, #1056, #1067.

## James's own list

#1049 (delete branches, turn on auto-delete), #1091 (turn on Wire summaries), #1048 (account
setup), the gated PRs above, the answer-key batch (#1098), and from #1104 on, the Sunday email.

## Starting prompt for the builder account

> You are building Fee Insight from `docs/plans/build-plan-2026-10-12.md` in
> `Gilmore3088/FeeInsight.com`. Read `CLAUDE.md`, the latest file in `docs/project/checkpoints/`,
> and the build plan. Take the first item in the plan that is not done and not blocked. Follow the
> plan's "Rules for the builder" exactly: one issue, one branch, one PR; run the guards and tests;
> merge only clean, ungated PRs under the standing authorization; leave gated PRs open and list them
> for James; add one line per merge to today's checkpoint. Never push to main, never force-push or
> delete branches, never run production data changes or migrations without James, never add
> scheduled Claude routines. When you finish an item, take the next. A gated item does not stop you:
> open its PR, list it for James, and continue with the next item that does not depend on it. When
> every remaining item is gated or blocked, or you reach the spend limit, stop and leave a status
> comment on #1026 listing what merged, what is waiting for James, and what is next.
