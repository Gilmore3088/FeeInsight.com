# Build plan (from the 2026-10-12 pipeline review)

This is the single ordered path for building what the 2026-10-12 reviews found. A builder works
from the top: one issue, one branch, one PR, then the next. The reviews themselves are in
`docs/plans/*-review-2026-10-12.md`; decisions are in `docs/project/DECISIONS.md` (2026-10-12);
the master tracker is #1026.

## Lanes (from 2026-10-13)

Up to three builders run at once, one per lane (DECISIONS, 2026-10-13). Each takes the first item
in **its own lane** that is not done and not blocked, in the order of the phases below. A builder
never takes another lane's item; if its lane is empty or every item is gated, it stops and leaves a
status comment on #1026.

| Lane | Owns (agents and code) | Items, in order |
|---|---|---|
| **A: Data pipeline** (the builder already running) | Rosetta, Knox, Darwin, Gutenberg and publishing, Deming, the learning core | #1059 first (holdout, then the migration and relabel for James), then #1093, #1052, #1051 (recover lost fees); then Phases 2–4 and 5 as before, except #1100 (Lane B), #1117, #1028/#1029 and #1078's Hamilton side |
| **B: Data quality, published fees** (Hamilton until 2026-10-14) | Published fee semantics at every customer reader: `conditions`, category and frequency fixes, publishing-quality tests | #1234 steps 1 and 3, #1100, #1196, #1067 (taken out of Parked). Then Hamilton correctness only (#1079, #981, #1066), never Hamilton UI or redesign |
| **C: Discovery and technical SEO** | Atlas, Magellan, the state experts, public-page metadata (titles, sitemap, JSON-LD) | Phase 7 (#1031, #1032, #1030, #1035; #1036 needs James), then #1117 steps 1–2, #1028/#1029; the technical-only items left in #1134's list (#1162–#1181) |

**Working side by side:**
- **Before merging:** merge the latest `main` into the branch and re-run the checks.
- **Files another lane owns:** a change that must touch one (for example `src/lib/agents/types.ts`)
  stays as small as it can.
- **Migrations:** take the next free number when the PR is opened, and check it again before merging.
  `migration-version-kill` refuses a duplicate.
- **Checkpoint:** each lane writes its merge lines under its own heading (`## Lane A`, `## Lane B`,
  `## Lane C`) in the day's checkpoint file.
- **No layout or redesign work** until James's design is ready.
- **No new copy preview** while five are waiting for James. Take the next non-copy item instead.

## Data quality first (from 2026-10-14)

James, 2026-10-14, after the quality gap audit (`FeeInsight_Quality_Gap_Audit_2026-10-14_v2`):
"The Hamilton redesign is not ready to go yet. I still think we need to focus on the data quality
and eventually we'll get to the redesign." Starting point (audit, 08:17 UTC Oct 14): dataset D+,
pipeline C-; answer key 87.7% right and 57.4% found; audience unknown on 99.7% of live fees; Knox's
internal note in `conditions` on 74,832 live fees; monthly maintenance 63.3% right and 47.3% found.

**Order:**
1. #1059: audience. A fresh, balanced holdout of fees from documents not used to tune the rules
   (consumer, business, both, unknown), then the migration and relabel plan for James.
2. #1234, #1100, #1196, #1067: what a published fee says. No internal notes in any customer
   output; monthly maintenance category and frequency; tests that stop bad categories publishing.
3. #1093, #1052, #1051: recover legitimate fees that were lost, and show recall rising on the
   answer key without precision falling.

**How a quality fix counts as done.** Merged code is only the first step:
1. code merged, with a source-line test;
2. a backfill or relabel plan with counts, a dry run, and rollback, sent to James (gated);
3. after James runs it, a before/after reading of the same frozen set of rows;
4. a check of the customer output (page, API, report).

A PR that changes no stored row or customer output says "code ready; dataset grade unchanged."

**Proof rules:**
- Never tune and grade on the same sample; a holdout uses documents the rules were not built on.
- Report "cannot determine" as its own count, never as a pass.
- Keep a before/after quality ledger in the checkpoint: metric, before, after, date, source.
- Keep legitimate business fees and account tiers. Fix labels; never delete real rows to move a
  number.

**Hamilton UI and redesign wait** until James says the design is ready: the redesign drafts #1011
and #1242 stay as drafts, and #1083 waits. Phase 6's other items (#1076, #1077, #1084, #1090, #1082,
#1060/#1062) have no lane for now and wait too. Hamilton PRs already open and out of draft (#1274,
#1275 and the copy PRs) finish under the normal rules.

**Baselines for the ledger.** Two readings of the `conditions` note exist: 75,101 of 76,848 live
fees (#1234, Oct 13) and 74,832 (the audit, Oct 14 08:17 UTC). The ledger uses the audit's reading
and counts as its baseline, and names the query and time for every later reading.

**Wrong after publish: what the ledger number is (2026-10-15).** The ledger and James's audit read
the daily scoreboard. That is `pipeline_scoreboard_snapshots.detail->'goal'->'wrongAfterPublish'`,
query name `goal.wrong_after_publish_7d`, written by Atlas's snapshot at about 12:17 UTC.
- Oct 13: 1,587 of 45,423 (3.49%).
- Oct 14: 1,133 of 36,592 (3.10%).

It is computed in `src/lib/agents/goal-scorecard.ts`, by `readWrongAfterPublish` (SQL) and
`summarizeWrongAfterPublish` (counting). This definition stays as it is.

- **Window:** rows of `published_fee_records` with `published_at` in the trailing 7 days at snapshot time.
- **Denominator (`published`):** those rows minus refresh copies. A refresh copy is a row named as the
  new copy (`#N`) in a `refreshed by #N` or `superseded by #N` takedown made in the same 7 days.
- **Numerator (`wrong`):** denominator rows that were rolled back for a reason whose key (the text
  before ":" or " #") is not in `HOUSEKEEPING_REASON_KEYS`. A new reason counts as wrong by default.
- **Housekeeping, never wrong:** `refreshed by`, `superseded by`, `duplicate of`,
  `same_line_duplicate`, `newer_copy_drops_fee`, `not_on_current_copy`, `companion_page_retired`,
  `rules_recheck_unreproduced`, `rules_recheck_restore`, `taxonomy_fold`, `closed_institution`.
- **Quarantine:** a row held with `quarantined_at` but not rolled back stays in the denominator and
  is never counted as wrong.
- **Old snapshots cannot always be re-derived.** Rows change after a snapshot: takedowns are added,
  restored or re-reasoned. Re-running the Oct 13 window during review on Oct 15 gave 1,608 of 45,785,
  against the stored 1,587 of 45,423. The stored snapshot is the number of record.

```sql
-- goal.wrong_after_publish_7d, as run by readWrongAfterPublish (window = 7 days)
WITH refresh_copy AS (
  SELECT substring(rolled_back_reason FROM '^[a-z]+ by #([0-9]+)')::bigint AS id
    FROM published_fee_records
   WHERE (rolled_back_reason LIKE 'refreshed by #%' OR rolled_back_reason LIKE 'superseded by #%')
     AND rolled_back_at >= NOW() - make_interval(days => 7)
)
SELECT CASE WHEN fp.rolled_back_at IS NULL THEN NULL ELSE COALESCE(fp.rolled_back_reason, 'no reason') END AS reason,
       COUNT(*)::int AS count
  FROM published_fee_records fp
 WHERE fp.published_at >= NOW() - make_interval(days => 7)
   AND NOT EXISTS (SELECT 1 FROM refresh_copy rc WHERE rc.id = fp.fee_published_id)
 GROUP BY 1;
-- published = sum(count); wrong = sum(count) for non-null reasons whose key
-- (split on ":" then " #") is not in HOUSEKEEPING_REASON_KEYS; rate = wrong / published.
```

**Why the raw read differs.** An advisor read on Oct 15 found 14,715 of 52,907 rows published in 7
days taken down, 2,922 of them for a quality reason (5.5%). The pieces were re-read at 01:14 UTC Oct 15,
all from one query at the same minute. The 7-day window then held 52,679 rows, and 14,581 of them were
taken down.

| Rows published in 7 days | All | Refresh copies | Left in the scorecard |
|---|---|---|---|
| Still live | 38,098 | 14,367 | 23,731 |
| `refreshed by` / `superseded by` | 7,048 | 4,568 | 2,480 (housekeeping) |
| `duplicate of` / `same_line_duplicate` | 4,760 | 180 | 4,580 (housekeeping) |
| Other housekeeping (mostly `rules_recheck_unreproduced`) | 1,676 | 842 | 834 (housekeeping) |
| Every other reason (errors) | 1,097 | 226 | **871 wrong** |
| Total | 52,679 | 20,183 | **32,496 published** |

Two things separate the raw 5.5% from the scorecard. The denominator drops 20,183 refresh copies.
The numerator drops `rules_recheck_unreproduced` and the other housekeeping reasons (1,676), which
the raw read counted as quality reasons, and it drops errors on rows that were themselves refresh
copies (226). At 01:14 the scorecard rule gave 871 of 32,496 (2.68%). That is not comparable to the
12:17 snapshots, because the window moves; the Oct 15 snapshot is the number for the ledger.

**Proposed separate series (not a replacement): `goal.wrong_after_publish_with_duplicates_7d`.** The
scorecard counts no duplicate as wrong. A second copy of a fee that was already live should never have
been published, so this series adds two things to the same denominator:
- Each pair closed as `duplicate of #N` or `same_line_duplicate` counts once, on the later-published copy.
  It counts when both copies come from the same document or from two different current documents.
  A pair from two captures of one page (one copy superseded by the other, or the same URL) is a fresh
  copy and does not count.
- A `rules_recheck_unreproduced` takedown counts when no live row has the same institution, category
  and amount.
- The denominator is close to the scorecard's but not the same. It leaves out refresh copies named
  by a refresh at any time, not only in the last 7 days, so the two can differ. At 01:07 UTC both
  gave 32,524. The 32,498 (01:08:40) and 32,496 (01:14) above were read at different minutes, so
  their gap is mostly the moving window.
- A row that is quarantined but not rolled back counts as wrong here, on its quarantine reason.

At 01:08:40 UTC on Oct 15, the SQL below gave 2,620 of 32,498 (8.06%). Of these, 903 are takedowns:
the scorecard's errors plus `rules_recheck_unreproduced` without a live replacement. The other 1,719
are duplicates: 1,011 from the same document and 708 from two different documents. Two rows are in
both groups. 3,589 pairs were left out because both copies come from captures of one page. Duplicates
are closed about 5 minutes after the later copy publishes (median over this week's `duplicate of`
pairs). So this series mostly measures repeat publishing, not what a customer sees, and the two
parts should be reported separately. Adding it to the scorecard is follow-up code work. The live
duplicates measured the same day are in
`docs/project/findings/2026-10-15-live-duplicates-across-page-copies.md`.

```sql
-- goal.wrong_after_publish_with_duplicates_7d (proposed, read-only)
WITH params AS (SELECT NOW() - INTERVAL '7 days' AS window_start),
rows AS (
  SELECT fp.fee_published_id, fp.published_at, fp.institution_id, fp.canonical_fee_key, fp.amount,
         fp.rate_percent, fp.rolled_back_at, fp.quarantined_at, fp.lineage_ref,
         btrim(split_part(split_part(COALESCE(fp.rolled_back_reason, fp.quarantine_reason, ''), ':', 1), ' #', 1)) AS reason_key,
         substring(fp.rolled_back_reason FROM '#([0-9]+)')::bigint AS other_id
    FROM published_fee_records fp),
refresh_copy AS (
  SELECT DISTINCT other_id AS fee_published_id FROM rows
   WHERE reason_key IN ('refreshed by', 'superseded by') AND other_id IS NOT NULL),
published AS (
  SELECT r.* FROM rows r, params p
   WHERE r.published_at >= p.window_start
     AND NOT EXISTS (SELECT 1 FROM refresh_copy rc WHERE rc.fee_published_id = r.fee_published_id)),
quality AS (
  SELECT fee_published_id, reason_key FROM published
   WHERE (rolled_back_at IS NOT NULL OR quarantined_at IS NOT NULL)
     AND reason_key NOT IN ('refreshed by', 'superseded by', 'newer_copy_drops_fee', 'not_on_current_copy',
       'companion_page_retired', 'closed_institution', 'taxonomy_fold', 'rules_recheck_restore',
       'duplicate of', 'same_line_duplicate', 'rules_recheck_unreproduced')
  UNION ALL
  SELECT p.fee_published_id, p.reason_key FROM published p
   WHERE p.reason_key = 'rules_recheck_unreproduced'
     AND NOT EXISTS (
       SELECT 1 FROM published_fee_records l
        WHERE l.rolled_back_at IS NULL AND l.quarantined_at IS NULL
          AND l.fee_published_id <> p.fee_published_id
          AND l.institution_id = p.institution_id AND l.canonical_fee_key = p.canonical_fee_key
          AND l.amount IS NOT DISTINCT FROM p.amount AND l.rate_percent IS NOT DISTINCT FROM p.rate_percent)),
dup_pairs AS (
  SELECT d.fee_published_id AS closed_id, k.fee_published_id AS kept_id,
         d.published_at AS closed_at, k.published_at AS kept_at,
         rd.source_document_id AS closed_doc, rk.source_document_id AS kept_doc
    FROM rows d
    JOIN published_fee_records k ON k.fee_published_id = d.other_id
    LEFT JOIN verified_fee_observations vd ON vd.fee_verified_id = d.lineage_ref
    LEFT JOIN raw_fee_observations rd ON rd.fee_raw_id = vd.fee_raw_id
    LEFT JOIN verified_fee_observations vk ON vk.fee_verified_id = k.lineage_ref
    LEFT JOIN raw_fee_observations rk ON rk.fee_raw_id = vk.fee_raw_id
   WHERE d.reason_key IN ('duplicate of', 'same_line_duplicate') AND d.rolled_back_at IS NOT NULL),
dup_class AS (
  SELECT CASE WHEN dp.kept_at > dp.closed_at THEN dp.kept_id ELSE dp.closed_id END AS fee_published_id,
         CASE WHEN dp.closed_doc = dp.kept_doc THEN 'same document'
              WHEN sc.superseded_by_id = sk.id OR sk.superseded_by_id = sc.id
                OR sc.superseded_by_id = sk.superseded_by_id
                OR lower(regexp_replace(sc.document_url, '[?#].*$', '')) = lower(regexp_replace(sk.document_url, '[?#].*$', ''))
                THEN 'two captures of one page'
              ELSE 'two different documents' END AS dup_kind
    FROM dup_pairs dp
    LEFT JOIN source_documents sc ON sc.id = dp.closed_doc
    LEFT JOIN source_documents sk ON sk.id = dp.kept_doc),
wrong AS (
  SELECT fee_published_id, 'quality' AS part FROM quality
  UNION
  SELECT d.fee_published_id, 'duplicate' FROM dup_class d JOIN published p USING (fee_published_id)
   WHERE d.dup_kind <> 'two captures of one page')
SELECT (SELECT COUNT(*) FROM published) AS published,
       (SELECT COUNT(DISTINCT fee_published_id) FROM wrong) AS wrong,
       (SELECT COUNT(*) FROM wrong WHERE part = 'quality') AS wrong_quality,
       (SELECT COUNT(*) FROM wrong WHERE part = 'duplicate') AS wrong_duplicate,
       ROUND(100.0 * (SELECT COUNT(DISTINCT fee_published_id) FROM wrong)
             / NULLIF((SELECT COUNT(*) FROM published), 0), 2) AS wrong_pct,
       NOW() AS read_at;
```

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
4. **Tests stay lean** (James, 2026-10-14: no test bloat). Extend the module's existing test file and
   prefer one table-driven test over many near-identical cases. A new test file only for a new module.
   Pin behaviour that matters (a reviewer's failing layout, a real source line), not every branch.
   CI runs each test once (`.github/workflows/test.yml`); a new step must not re-run tests a job
   already runs.
5. **Merge** only under the standing authorization in `CLAUDE.md`: exact head reviewed, CI green, no
   conflict, no unresolved blocking review, and none of the gates below.
6. **Gates: open the PR, do not merge, add it to James's list** when a PR:
   - adds or changes a migration (`supabase/migrations/`), or changes production data (restores,
     relabels, releases, backfills);
   - switches on a paid provider or raises a budget;
   - changes words or numbers a visitor or customer reads (pages, footnotes, emails): use the
     `copywriting` and `copy-editing` skills, add a copy-review note, and leave it for James to see on
     the Vercel preview;
   - deletes branches, force-pushes, or touches permissions or security settings (never do these).
7. **After each merge:** add one line to the day's checkpoint (`docs/project/checkpoints/`), what
   merged and what it should move, so James wakes up to a readable summary.
8. **Never:** push to `main`, use Firecrawl, add one-off data scripts, add scheduled Claude routines,
   or fake a number. If a count is not known, say so.
9. **A gated item does not stop the run.** Open its PR, list it for James, and continue with the next
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
| 7a | #1134 | Public site: SEO, copy and website. Review in `docs/plans/public-site-review-2026-10-13.md`; its build list is #1162–#1181, in that order | Pure technical SEO merges on green; copy and page changes wait for James on the preview; benchmark numbers wait on #1058 |
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
not listed above, #1038, #1041, #1043, #1044, #1045, #1054, #1055, #1056.

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

### Starting prompt for a lane builder (B or C)

> You are the **Lane B** (or **Lane C**) builder for Fee Insight in `Gilmore3088/FeeInsight.com`.
> Read `CLAUDE.md`, the latest file in `docs/project/checkpoints/`, and
> `docs/plans/build-plan-2026-10-12.md`, especially "Lanes" and "Rules for the builder". Take only
> your lane's items, in order, and follow the same rules as the starting prompt above. Another
> builder works the other lanes at the same time: merge the latest `main` into your branch before
> merging, keep changes to files another lane owns as small as possible, and write your checkpoint
> lines under your lane's heading. When your lane has nothing left that is not gated or blocked,
> stop and leave a status comment on #1026.
