# Decisions

Newest first. Each entry: date, what was decided, who, why, and what it means for the work.
Seeded 2026-10-05 from the project's working memory; earlier decisions were not recorded here.

## 2026-10-20

**Hosted report tokens are rotated and kept out of the repo.** James, 2026-10-20, on #2001 (found
in the #1922 customer data isolation review; tracker #975): rotate the `/r/<token>` prospect report
tokens and move them out of the repository. The committed `Reports/studio/hosted-reports.json` is
deleted. Tokens now come only from the `HOSTED_REPORT_TOKENS` environment variable (a JSON object,
token to record), compared in constant time; missing or malformed config resolves no token, so
every link 404s rather than opening. A token must be 32 to 64 hex characters, so none of the old
16-character tokens resolve once this deploys. James issues new tokens by the steps in
`docs/runbooks/hosted-report-tokens.md`; no token value goes in a PR, issue or file in the repo.

**Previews build only for PRs that change visible files.** James, 2026-10-20: previews build only
for PRs that change visible files (src/app, src/components, styles, public, build config,
dependencies); a build failure in a non-visible PR surfaces at the production deploy, which keeps
the last good version. The allowlist is `isVisiblePath` in `scripts/vercel-ignore-build-lib.mjs`;
production, a missing merge-base and any error still build. CLAUDE.md's "Vercel builds a preview
for every PR" line changed to match, with James's approval.

**Newer-copy check v2 reopens every settled pair.** James, 2026-10-20: "complete all steps and
clean up data". Hamilton's newer-copy check judges every pair it decided under v1 again under the
current guards (#2477). Prod dry run before merge, read-only: 772 pairs, 8 live fees retired at 2
institutions, 0 restores; a proposed re-price rule was dropped after it retired 0 in the same dry
run and review found it could take down prices a page still states. Retired fees keep the existing restore path. **Reverted the same day before any fee retired:** a hand check
showed Jeanne D'Arc FCU's current copy is a fee-changes notice page whose full schedule is a linked PDF, and
two of the six fees v2 would retire there (64221, 93814) are still charged; v1 pairs stay closed again.

**One front door for decisions and lessons.** James, 2026-10-20: "we need one central doc". One
front door, `docs/project/LESSONS.md`, indexes every decision and lesson: one line per entry here,
one per finding in `findings/`, and a pointer to each agent's `role-lessons.ts`. DECISIONS.md stays
the full record of decisions. `scripts/ci-guards.sh lessons-index-kill` keeps the index complete:
it fails a PR when a finding or a decision entry has no line in LESSONS.md, or when LESSONS.md links
a finding that does not exist.

**Legacy event-log partitions are dropped, not trimmed.** James, 2026-10-19; migration approved 2026-10-20. Atlas drops expired
legacy `agent_events` partitions through a migration function instead of deleting rows (#2453,
migration 072). Dry run 04:19 UTC: partitions `_2026_04` to `_2026_07`, about 386 MB.

**Call-report quarterly summaries are computed once per load.** James, 2026-10-20. Hoovie stores
each filing's standalone quarter when filings load and the readers read that summary; the raw
filings are kept unchanged (#2459, migration 073).

**Main's peer-group widening rule wins over exact saved groups.** James, 2026-10-20. #1785 was
closed: a saved group widens when too few peers publish a fee. Its new filters (asset size
range, regulator, CU charter, holding company) are to be ported onto `main`, tracked on #975.

**The market report uses one comparison set.** James, 2026-10-20. #1736 reads every rank and
median from `main`'s #2353 comparison and drops its own separate share cohort.

**Institution page: one connected panel.** James, 2026-10-20, approved #1864's plan: `main`'s
#1984 `ConnectedPanel` stays the only panel and is fed from #1864's call-report data; #1864's own
panel is removed.

**HMDA matching repair merges with every release flag off.** James, 2026-10-20. #2253 merged
with all four HMDA release flags false, accepting that new HMDA lender rows are not linked to an
institution until the release is approved.

**Hourly line check and hand-takedown returns merge on re-measured counts.** James, 2026-10-20.
#2436 merged after a re-measure at 04:13 UTC (2,013 fees changed at 1,578 banks; 9 takedowns),
with its CLAUDE.md self-exception removed: a PR does not widen its own merge authority.

**Superseded PRs closed.** James, 2026-10-20. #1011 (Hamilton preview) and #1575 (API docs)
closed as superseded.

**Returned statements file as returned mail.** James, 2026-10-20 03:51 UTC, decision card "File
returned statements under returned mail instead of keeping them held?": "File them". On Oct 7 (v26)
he had kept them held because no category fit; the returned-mail type made on Oct 15 (#1398) covers
"returned or undeliverable mail or statements". Knox v90 files them there, the held re-check sends
the held ones to Darwin (246 held lines at 126 banks match the name; 231 of them passed the release checks in the Oct 20 dry run), and live ones already sit under returned mail.

**A process fix switches on once its sample checks clean; James hears after.** James, 2026-10-20
01:53 UTC, on a decision card in the "Resolve issues 981 and 982" thread, after asking at 01:52 why
built fixes were not on. Fixes that change live fees were shipping switched off with a dry-run count
and waiting for his yes, which only the morning digest asked for: the hourly line check (#1456,
2,077 live fees at 1,619 banks), the hand-takedown returns (6 fees) and eight more switches sat off,
so the live score could not move. He chose "Both on, and a new rule": those two go on now
(`HOURLY_LINE_LIVE`, `HAND_TAKEDOWN_RETURNS_LIVE`), and from now on a switch for a process fix that
has a dry-run count turns on by PR once an automatic sample of that dry run checks clean against the
bank's own document. James is told after, in the digest (count, sample result, score change), not
asked first. At 01:54 he applied it to the eight waiting accuracy switches ("all eight with rules"):
`DARWIN_RECHECK_OLDER_LIVE`, `DARWIN_RECHECK_SECOND_LOOK_LIVE`, `DARWIN_TAKEOVER_CATEGORY_PROOF_LIVE`,
`KNOX_HELD_NAME_RULES_LIVE`, `RANGE_BAND_SET_ASIDE_LIVE`, `SAVED_LINK_FETCH_LIVE`,
`PRODUCT_PAGE_CONFLICT_LIVE` and `READER_LOSS_RESTORES_ON`; for the last two the automatic sample
replaces their hand checks. Storage and speed switches, migrations, deletions and spend still need
his yes.

**Issues become lessons for the agents, not only checks.** James, 2026-10-20: "I don't want a
check, I want a lesson for the agents so they get better at their roles. This is the whole point
of the recursive agent architecture." Until then the pipeline agents learned only per institution
(the playbook), so a closed issue taught the agent nothing about its role. New rule: a PR that
closes an issue whose root cause is in a pipeline agent adds a lesson to that agent's
`src/lib/agents/<agent>/role-lessons.ts` in the same PR. Lessons are reviewed code; Atlas's daily
`atlas-lesson-sync` step copies them into `agent_lessons` (a lesson removed from the repo is retired,
never deleted), every step records the lessons that shaped it as `lessons_applied`, model-calling
steps send them as instructions (at most ten, newest first), and each agent page lists "What this
agent has learned". `scripts/ci-guards.sh lesson-kill` checks the files. It is in CLAUDE.md "How
work runs" and AGENTS.md "How work runs".

## 2026-10-19

**Review findings become checklist lines, not new issues.** James, 2026-10-19 17:01 UTC, on a
decision card in the backlog thread, after asking at 16:48 how to start closing issues "we have
ballooned to nearly 300". GitHub REST on Oct 19: 295 open issues. A sort of all 295 closed 41 as
fixed, duplicate, obsolete or folded into a parent, merged PRs closed more, and new issues kept
arriving; GitHub REST at 17:04 UTC showed 242 open. About 180 issues were opened on Oct 19
against about 105 closed, and
most were single findings from one review or one PR. New rule:
- A finding the PR under review can fix is fixed in that PR before it merges.
- Any other finding is a checklist line on the issue for its root cause, or on the agent's or
  Foundation tracker if no such issue exists.
- A new issue is opened only for a new root cause.
This replaces the Oct 12 "every change a review finds is documented as its own issue, with no cap"
entry below. Every finding is still tracked, and the open count now reflects root causes. It is in
CLAUDE.md "How work runs" and AGENTS.md "How work runs".

**Fix the input and the process, not the output.** James, 2026-10-19 04:04 UTC, in the project
chat: "we don't fix the output, we fix the input and the process. And only then do we validate and
fix the output ... if we fix one and this is a problem for others, that means we're just gonna have
to fix one at a time." When a fee error is found, the first fix goes to the pipeline step that
caused it: discovery and document capture (Magellan), text conversion (Rosetta), extraction or
categorisation (Knox) or verification and classification (Darwin). That fixes the whole class of
error. Then the affected institutions are re-run and the output is validated. A one-off data fix
(an admin correction, hold or re-file) is allowed only as the last step after the process fix,
never instead of it. This sits beside the 2026-10-15 rule that a holding or re-filing rule ships
with its Darwin live re-check. It is in CLAUDE.md "Standing rules" and
AGENTS.md "How work runs".

**The Product menu is three cards, and Hamilton's card names it.** James, 2026-10-19, in the
"Product menu" thread: "Every fee" overclaimed ("it wont be possible to get every fee"), and the
workspace is called Hamilton. He picked three cards: Bank Fee Index (Find your institution,
National index), Market Benchmarks (state and district data, Reports) and a navy Hamilton card
with "See plans" and "Ask for a demo", with no "Pro workspace" label. This narrows the 2026-10-15
rule below: Hamilton's name, in text and without its mark, appears on its Product menu card and in
the phone drawer. It still never appears as a top-level header item or in the footer, and its mark
stays inside the workspace. `src/components/nav-items.test.ts` pins it.

## 2026-10-17

**The homepage carries no standalone report promotion.** James, 2026-10-17 18:16, reviewing the
homepage cuts (#1826): the Report example "promotes a standalone report 'from $300,' which
competes with your primary goal." The homepage (`/`) has no Competitive Fee Position Report link
or price, so Hamilton Pro (`/subscribe`) is its only paid path, next to the demo request. The
paid report is still offered on `/reports` (its request form, `REPORT_OFFER`) and
`/for-institutions` (`ReportOfferSection`). Don't restore the `request_report_click` link on the
homepage from the money thesis; the report stays a lead into Pro from those pages.

## 2026-10-16

**Admin fee corrections are new versions, admin-only, with source evidence.** James, 2026-10-16,
answering the four H03-T02 questions on #978: a correction is a new version (the old published
value is kept and marked superseded, never overwritten; this takes a new table); only an admin may
correct, while analysts and admins can still hold; a correction needs the source document, an
excerpt and where it sits, plus a reason; and a hold or correction rebuilds Hamilton's national
index (`fee_index_cache`) straight away. The lifecycle is `docs/plans/hamilton-h03-corrections.md`.

**Agent trackers stay separate; the lanes keep them current.** James, 2026-10-16 04:03 UTC, when
asked whether to fold the per-agent trackers into #1026: "I'd rather keep them separate ... the data
quality thread can just update those agent trackers accordingly." #1026 stays the master tracker.
The Data quality lane keeps #1027 (Magellan), #1050 (Rosetta), #1092 (Knox), #1110 (Darwin) and
#1048 (Foundation) current. The Hamilton lane does the same for #975. The same day, work moved to
four lanes (Website, Page templates, Data quality, Hamilton) that run from the second-account
roadmap on branch `claude/project-thread-awcc9c`. CLAUDE.md "How work runs" now says so.

**Fee Insight is not marketed as advisory.** James, 2026-10-16 (#1174): "Fee insight advisory was
scrapped many times ago so we should not add it back. I'm happy to have demos and phone
conversations but we should not market the product as advisory." No page, form or offer names a
"Fee Insight Advisory" service; demos and calls stay. Custom data and API work is "Data licensing".

**Free visitors keep each fee's national range.** James, 2026-10-16 (#1449): free visitors see the
range on the national index ("consumer facing high-level data").

**Night deposit is the service only; bag and key purchases are not scored.** James, 2026-10-16,
option A on #1099's night deposit misses: `night_deposit` stays the night depository service, and a
bag or key bought for it stays out, as the v60 category guard has it. A lost or replaced bag or
key, and an annual or service fee, stay night deposit. The answer key followed the old reading, so
its 28 confirmed bag and key purchase lines at 11 banks, 6 prefilled ones and one receptacle-key deposit leave scoring (`canonical_key = 'unmapped'`, which the
answer-key score and Deming's Knox replay leave out), through Atlas's answer-key relabels, run by the score step
(`src/lib/agents/atlas/answer-key-relabels.ts`) in the scoreboard run, with every line in its ledger.

**A few confirmed-wrong live fees come down without asking James.** James, 2026-10-16, approving
#1496 (Barksdale FCU's two fax fees that took a price from the next column): fixes like this
should not wait for him. A small number of live fees (up to about 25), each confirmed wrong on
amount or category against its bank's own stored text and checked by a reviewer, come down through
the normal tracked takedown path without a per-fee approval. A ledger line goes on #1026. Category
or policy questions, large batches, migrations and switches still go to him. The path is Hamilton's
hand-takedown list (`src/lib/agents/hamilton/hand-takedowns.ts`): one entry per fee, with the issue
that holds the evidence and the reason (`source_mismatch: #<issue>`); a row comes down only while it
still reads as listed, its verified row is rejected, and the publish step's run ledger names it.

**Confirmed-wrong live fees in batches under 20 come down, or go to a review log, without a
per-batch approval.** James, 2026-10-16 03:37 UTC, saying yes to roadmap item 3.8 (#1512, #1513):
"If they're incorrect they need to come down or getting placed into a review log. I don't want to
be nickel and dimed every time we have a problem with less than 20 fees." He does not want to be
asked about fewer than 20 incorrect fees. Each fee is still confirmed wrong against its bank's own
stored text and goes through a tracked path with run-ledger visibility: the hand-takedown list, or
a hand rename or re-file (`HAND_REFILES` in `src/lib/agents/hamilton/taxonomy-fold.ts`) when the
price is right for another name or category. Larger batches, category or policy questions,
migrations and switches still go to him. The limit is per batch, not a total for the list: on the
hand-takedown list a batch is the entries filed under one issue, and each holds fewer than 20
(`HAND_TAKEDOWN_BATCH_LIMIT`, 19). This replaces the earlier "up to about 25" total for the list
(#1613, 2026-10-16), since a running total would bring every later small batch back to him.

## 2026-10-15

**Darwin re-checks every live fee against today's rules.** James, 2026-10-15 ("This needs to be
with Darwin. This is his job."), after the 1st Community FCU (5314) $0 fee: "or take advantage of
both options to reduce your monthly fee to" went live on Oct 6, three days before
`publishNameHold` (#797, #803) would have held it, and no live re-check runs that hold.
Publish-time rules only gate rows that are not yet live. Today four partial re-checks exist (Knox's
rules re-check, Darwin's `verify.recheck` with its takedown off, Hamilton's eval-verdict twin for
some name rules, Deming's sampled audit), and none applies every rule. Two rules follow:
- **Every new rule ships with its live re-check in the same PR.** That covers any rule that holds,
  rejects or re-files a fee at Knox, Darwin or publish. The PR adds the rule to Darwin's live
  re-check and reports a dry-run count of the live fees it would take down, with a sample, before
  any takedown is switched on. A rule too blunt for live rows (on Oct 15, `cutoff_name` matched
  1,571 live fees and roughly two thirds were real fees with a qualifier) gets a narrower live
  twin, or no takedown.
- **Darwin owns the backlog.** Darwin re-reads every live fee against today's rules, a share each
  step, through the shared second look, with every takedown on the run ledger. The first pass is a
  dry run over all live fees, and James sees the counts by rule before any takedown is switched on.

**Batch similar fixes; push only when ready; merge `main` only when needed.** James, Oct 15, after
the advisor counted 124 CI runs in 9½ hours (about 16 billed minutes each) against a $50 GitHub
Actions budget. If the budget runs out, CI stops and no PR can merge. "One issue, one PR" becomes
one outcome, one PR: a PR may close several issues of the same kind in the same agent or files, and
rule changes that bump the same version go out together (each Knox bump re-reads thousands of
texts and re-queues the priority banks, as v67 and v68 did on Oct 15). Never batch across lanes,
gated with ungated, or a migration with unrelated code. A branch is pushed when its PR is ready for
review, after the local checks. `main` is merged into a branch only for a conflict or a change the
PR depends on (a version number, a shared check its gates use), and always for a PR that adds a
migration, which re-runs `migration-version-kill` before merging (a clashing number shows no
conflict); main's CI run tests each merge commit. A new push still needs a new review of its
exact head (Oct 14). Rules: `CLAUDE.md` ("How work runs") and the build plan ("Rules for the
builder", "Working side by side").

**Hamilton's redesign starts now, built on #1011.** James, Oct 15, after opening
/pro/research?fee=overdraft: "This is not the Hamilton experience I've been asking for", then "We
already have the design base, the left nav" and "The images were just examples of rich dashboard".
This lifts the Oct 14 hold for Hamilton's screens; the data lanes keep their order. #1011's unified
workspace (docs/design/hamilton-rebuild/) is the design base, ported onto current main in per-screen
PRs on the Fee Insight design system's navy and brick, not merged as its stale branch. The new work
is making it rich: charts, maps, peer tables and evidence across the five lenses in the design
brief, and the product review's findings (docs/plans/hamilton-product-review-2026-10-12.md).

**Subordination fees file as legal process, reversing Oct 8.** James, 02:59 UTC Oct 15 (#1026
comment 6183387204, item 1), on Pacific Service FCU's "Subordination | $125 per loan": a
subordination fee pays for drafting and executing a legal agreement that changes the lien priority
recorded with the county; it is not an operational loan fee, and PSCU lists it under Real Estate
Fees, apart from its general loan fees. From now on subordination fees file as `legal_process`
(taxonomy, Knox, category guard v64, fold v15). Live and verified fees filed as `other_lending_fee`
before the change move by the fold's switched re-file (`SUBORDINATION_REFILE_LIVE`), switched on
the same day at James's go ("proceed with your recs", Audit thread; "Switch it on", Data quality
thread). The answer-key row seeded at institution 4875 under `other_lending_fee` is aligned to
`legal_process` by its own migration. A lien release stays other lending (Oct 8).

**Excess withdrawals and returned mail get their own fee types, out of account research.** James,
14:32 UTC Oct 15 (#1398, decision card in the Data quality thread: "Add both"). The Oct 7 fold
(Knox v26, `fee-fold.ts`) had filed excess-activity fees and returned mail, returned statement and
bad-address fees under account research; about 2,321 of its 5,268 live rows were not research, and
their per-item price (typically $5) pulled research's $25 median down. The taxonomy gains
`excess_withdrawal` ("Excess Withdrawals": a per-item charge for withdrawals or transfers past a
savings or money market account's monthly limit) and `returned_mail` ("Returned Mail": returned or
undeliverable mail or statements, a bad or incorrect address, an address locator), both in Account
Maintenance, so the taxonomy will have 52 types. The change ships dark behind one switch
(`RESEARCH_SPLIT_LIVE` in `fee-fold.ts`), off until James says go: while it is off the two types are
not listed, and every rule that would file a fee there (fold v17's splits and e-statement rule,
category guard v65's line re-file, the hand re-files, the taxonomy aliases) still files it under
account research exactly as before, and each publish step reports what the research split would
move. Both versions stay at 16 and 64 while it is off, so the re-reads they cost run once, at
switch-on. Turning it on files new reads there and moves live and verified account research fees by name; Knox's own rules
re-point in that PR (Knox's rules version is batched with other bumps). Account research keeps
research, reconciliation, balancing, charge-off and ATM adjustment charges.

**Four answer-key rows are keyed correctly.** James, same comment, items 2 to 5: 4Front FCU (7273,
$25 for the first 2 a day, $0 after), Texhillco (5643, first check free, $5 each after), Schools
FCU (4770, free on Platinum, $25 on Gold, Silver+, Silver and College) and Liberty Savings (1175,
coin counting free up to $250 a day, 1% above) stay as keyed. Schools FCU's free and $25 prices are
two product-specific fees, never one blended amount, in the key and in live fees (#1060, account
tiers).

**The site's goal is a Pro subscription; the paid report is a lead.** James, Oct 15, after a
site review again ranked its findings around the $300 report: "The goal is not to get a paid report.
That's just a high value lead. The goal is to get them on pro pricing so they're paying monthly or
annual." The site's main call to action, reviews and copy aim at Hamilton Pro (/subscribe). The
Competitive Fee Position Report stays on sale as the step for buyers not ready to subscribe; free
reports and alerts capture leads for Pro. CLAUDE.md's "Money thesis" and the CTA line in
`.agents/product-marketing.md` now say so.

**The growth plans follow the same funnel.** James, Oct 15: "update the growth plans so we dont focus
on the $300 and go with the plan we discussed today." The funnel is a free sample report, then the
paid report as a lead, then Pro, either because the buyer wants it regularly or because the report
sparks a Pro demo request. GrowthOS (README, agent objectives, KPI order) and the site v3 brief now
rank work by Pro subscriptions and Pro demo requests; report requests count as leads.

**Data fixes are proven on the live row, not one function.** James, Oct 15, after #1334's review
found that #1310's merged cut-cents fix never reached the site. Knox's self-check uses
`checkFeeAgainstSource`, which still rejected $29.95 and $1.50. #1310's test ran only the first read.
From now on, a data fix's test follows the row's whole path. The PR names the live rows and the
after-state expected for each, and the builder confirms them on prod after deploy (build plan rule 4).

**#1334 covers all 8 cut-cents fees.** James, Oct 15: "yes. approved. fix it." The 8 fees are 49175,
29166 and 141772 (approved Oct 14) plus 97435, 61650, 61934, 79234 and 79237, found when the shared
check was fixed. The work:
- fix the shared check;
- stop the verified twins with wrong amounts (113133, 112658, and any others found) from publishing;
- re-read the documents with a Knox version bump;
- confirm the correct amounts on prod.

**#1283's corrected counts are approved.** James, Oct 15 ("im fine with 1283"): 16 re-files (the
15 approved Oct 14, plus 142567), the same 12 second looks, and institution 3919's 9 fees entering
the catalog.

**No pipeline pause.** James, Oct 15 (relayed by his advisor session): "I don't want to pause. Keep
working." A migration or step that needs a lock retries with a longer lock_timeout or runs in
smaller batches. It does not pause the `pipeline` control.

## 2026-10-14

**The Fee Insight design system is the site's brand; the header carries Fee Insight.** James, Oct 14.
The package (Oxford Navy and brick on parchment, Geist, the box-plot I) lives in `src/brand/`,
`public/brand/` and `Branding/fee-insight-design-system/`. The feeinsight.com header uses the Fee
Insight one-line logo; Bank Fee Index's lockup goes on its data pages and the footer; Hamilton's
wordmark on /pro. This is the "James's own design" the layout hold waited for. It ships in staged
PRs: the package first, then the public site, then Hamilton, admin, reports and email, each
reviewed by James on the Vercel preview before merge.

**Data-quality approvals (James, Oct 14 evening, builder session).** Answering the "what do you
need from me" list:
- **#1059 audience: approved.** The gate is 0 opposite-audience errors on unseen holdouts (a business
  fee called consumer or both, or a consumer fee called business); 95% exact agreement is the aim, not
  the gate. Holdout 6 met the gate (0 of 225). The migration (verified tier keeps Darwin's audience)
  and the relabel go ahead. The relabel runs as a Darwin step in the run ledger, with counts, a dry
  run and a rollback, and leaves undecided fees unknown.
- **#1283 guard v62: approved as written** (15 in-place re-files; the 12 flagged rows go through
  Hamilton's second look).
- **#1299, #1301, #1304 and #1310's 3 wrong amounts: approved.**
- **#1234 step 2 (move Knox's note out of stored `conditions`): approved**, migration included.
- **#1291's re-file restore pass: revalidate before it is switched on.**
- **#1316's near-name collapse: validate first; once the check confirms it, it is approved.**
- **Magellan's paid cap stays as it is.** Improve the data and Magellan's process with what is already
  stored, so the work is better when paid discovery resumes.
- **#1280: yes**, the answer-key scorer starts a new versioned series.
- Not decided: the 216 step-2 rows from #1093, and the older items (#1275, #1274, the copy PRs,
  #1238).

**Data quality comes before the Hamilton redesign.** James, Oct 14, after his quality gap audit:
"The Hamilton redesign is not ready to go yet. I still think we need to focus on the data quality
and eventually we'll get to the redesign." Lane B moves from Hamilton to published-fee quality
(#1234, #1100, #1196, #1067). Lane A takes #1059, then recall (#1093, #1052, #1051). Hamilton UI and
redesign work waits. A quality fix counts only once stored rows or customer output change, measured
before and after on the same rows. The order and proof rules are in
`docs/plans/build-plan-2026-10-12.md` ("Data quality first").

**"Reviewed" means a submitted review of the exact head SHA; CI also runs on main.** James, Oct 14,
after an auditor found merged PRs with no submitted review and no CI run on main's merge commits.
A PR merges under the standing authorization only when a separate reviewer agent (not the builder
that wrote it) has posted a submitted GitHub review of the PR's exact head SHA, naming that SHA,
with a "no blockers" verdict, plus green CI on that SHA. A new push needs a new review. The reviews
are COMMENT reviews, because the account that opens every PR can't approve its own. CI also runs on
every push to main (`.github/workflows/test.yml`), and is never cancelled there, so each merge commit
gets its own result. A red main run is fixed before other work. "Merged" or "deployed" is never
called customer acceptance: signed-in, two-user, mobile, save-and-reopen and PDF checks are stated
as untested until someone runs them.

## 2026-10-13

**Supabase reads run without a prompt; writes still ask.** James, Oct 13. Builders were asking
James to approve every read-only query. `.claude/settings.json` now allows the Supabase SQL and
read tools, and keeps a prompt on migrations, branches, edge functions and project changes. The
rule is unchanged: production data changes go through typed agent modules and a PR, never raw SQL
from a session.

**Darwin's audience is the one published (#1059, option 1).** James, Oct 13. Knox writes its audience
suggestion and the evidence (the document's address or title, the section heading, or a general schedule
with no business wording) without setting the published label. Darwin sets the audience on the verified
row, and the published row takes Darwin's value. Today the trigger from
`20270110000040_fee_audience_integrity.sql` copies Knox's raw label to every tier, so this needs a small
migration, which goes to James. Relabelling existing fees is a production data change and also waits for
James: business fees leave the personal benchmarks, so medians customers see can move.

**Up to three builders at once, one per lane.** James, Oct 13. Usage has room (about 7% of the
4-hour window, 12% of the week), so the build plan runs in three lanes instead of one queue: data
pipeline, Hamilton, and discovery plus technical SEO. Each lane owns its agents' code, so builders
rarely touch the same files. The plan's order is kept within each lane; nothing moves between
lanes without a note on #1026. Website layout waits for James's own design, so no lane takes
layout or redesign work, and no lane opens a new copy preview while five are waiting for James.

## 2026-10-12

**Darwin carries the backend value; Hamilton carries the business value.** James, Oct 12. Darwin's
decisions are what make the data correct, so his rules, his held-fee queue and his audit score get
first attention on the data side; Hamilton is what customers pay for, so his answers get first
attention on the product side. Every other agent serves one of the two.

**Accuracy target: 95% on Deming's daily audit, averaged over a week.** James, Oct 12 (#1119). The
audit draws 200 live fees a day and checks each against the bank's own schedule; it read 92.0% on
Oct 11.

**Darwin owns classification: Knox suggests, Darwin decides, Gutenberg asserts, Deming audits.**
James asked which arrangement is most accurate (Oct 12); recommendation accepted. Knox finds the
fee line and amount and suggests a category, audience and tier with its evidence. Darwin is the one
authority on what a fee is (category, personal or business, tier, valid or not), using Knox's
evidence, the fee-name library James labels, the page's headings and peer comparison. Gutenberg
publishes only Darwin's decision, with one final check. Deming, independent of all three, audits
live fees daily. Why: today the category is set or re-set in three places, which is why about 7,900
fees a week are taken down within days of publishing; one decider means one place to fix, one
score, and the auditor stays separate from the agent it grades. Affects #1059, #1069, #1102, #1112.

**James's maintenance is one Sunday email, about an hour a week.** James, Oct 12 (#1104): the 25
fee-name labels, approvals waiting, samples to check, the week's five scorecard numbers and anything
stuck, built by a deterministic step, never a Claude routine. More than an hour rolls to next week.

**Every institution has one intelligence record that all agents read and write.** James, Oct 12
(#1105): where its fees live (each document, its type and format, right or wrong and why), what
worked, what went wrong, what people decided, and what its state expert knows. It grows the existing
learning playbook, and a daily check flags a record that contradicts itself.

**James labels 25 fee names a week; every label grows a lasting name library.** James, Oct 12
(#1102). Names are grouped before they reach the queue (one row covers every variant of, say, an NSF
fee), a label maps the whole group at every bank and every future read, and the library
(`fee_name_aliases`, #1039) is versioned and never deleted. The queue shows the groups that cover the
most fees first.

**A document's type picks the tool at every stage.** James, Oct 12 (#1094). Magellan sets format and
type; Rosetta picks the reader from it (layout reader, Tesseract OCR then paid transcription, browser
fallback, table reader); Knox picks the extractor (tables and rules, account-table reader, agreement
prose, rate reader; product pages go back to Magellan). Each step records the tool it used.

**Rates and lending are in scope, if accurate.** James, Oct 12 (#1103): it puts Fee Insight in
direct competition with rate-comparison sites. Percentage fees and lending fees come first, inside
the fee product; interest rates (APY, APR) are a second data product with its own freshness rules,
planned after the fee data layer meets its targets. Order (James, Oct 12): savings, CDs, money
market, auto, mortgage. Rates wait until the fee data layer is A+, and may become a standalone
product and consumer-facing site.

**Knox targets: 85% of fees found, 90% right.** James, Oct 12 (#1098). Measured on the answer key,
counting only banks where the right document was read. Growing the answer key to about 200 banks is
a one-time batch: an agent prepares each bank, James confirms it. After that, checking is not a
regular job; a bank is re-checked only when its schedule changes.

**Knox stays one agent; its specialists become separately measured skills.** James asked whether
Knox should be split for focus (Oct 12). Recommendation recorded: keep one agent, but score each
specialist (rules, tables, the fee families, paid pass, and the new ones in #1100) on the answer key
on its own, so each can be improved independently. Deciding a document's type moves earlier: Magellan
makes the first call when it finds the link (format: PDF, HTML, script-built page; and kind: fee
schedule, disclosure, agreement, product page), Rosetta confirms it from the content, and a
disagreement goes back to Magellan (James, Oct 12; #1094). Knox's held lines (about 38,000) get an
owner and a way out (#1102).

**Hamilton becomes the product only; publishing moves to its own internal agent.** James, Oct 12
("Yes split"), on the Hamilton product review (`docs/plans/hamilton-product-review-2026-10-12.md`).
A new deterministic agent takes Darwin-verified fees, decides which go live, and keeps the live
catalog correct (duplicates, refreshes, take-downs, restores, re-checks, source checks). It is not
merged into Darwin, so one agent checks and another publishes. Hamilton keeps Ask, memos, written
answers, simulate, reports, studies, briefing, alerts, digest and decisions. Persisted `hamilton.*`
check names stay as they are. Work order and steps: #1075. The new agent is named **Gutenberg**
(James, Oct 12).

**Studies on the Pro briefing: two now, three held.** James, Oct 12 (#1082). Fee dependence and
inferred overdraft and NSF items paid are shown to Pro readers, each with a note on how it was
calculated. Local income, market concentration and fee income vs prices stay off until reviewed:
their effects are weak and a reader could take them as what a change would do.

**Price-change modelling stays small, labeled and data-limited.** James, Oct 12 (#1085). Public
data has the fee and the fee income (mostly overdraft and NSF), but not total items, paid versus
returned items or pay ratios; some credit unions split lines in NCUA or state reporting. So this is
not a main focus. Hamilton may show a rough high-to-low range for a change such as "drop the fee by
$5", labeled as an estimate from the data we have, and say plainly that the range tightens with more
data. The way to a better model is institutions submitting their own figures, kept private and never
shared, used only to build the models, then triangulated with call reports, NCUA data and third
parties (#1089).

**State fee law: an agent drafts, a person checks a sample.** James, Oct 12 (#1086). An agent reads
each state's statutes and regulator pages, records each rule with its citation, link and date read,
and an automatic check confirms every citation and quote. It is shown as a research summary, not
legal advice, and James or a compliance contact checks a sample before it is first shown. It must be
extremely tight; scope can expand later. The Regulatory Wire, which already tracks federal and state
agencies and bills, is part of this pipeline: a new state item sends that state's rules back for a
re-check, and Hamilton's regulation answers cite it (#1090).

**Quality checks run inside the pipeline, not on demand.** James, Oct 12: "I don't want to be
responsible for calling all of these on demand; they need to be built into the process." The
fee-quality skills (`fee-benchmarking` with new statistical checks, `data-quality-audit`,
`audit-data`, `source-evidence-audit`, `report-reconciliation`, `fee-taxonomy-regression`,
`adversarial-document-testing`) become deterministic Deming steps in the daily scoreboard run,
a required step in the report job, or CI gates. They are built the way growth was built in (typed
agent steps), never as scheduled Claude routines, and report to the scorecard with alerts on
failure. Each skill stays as the written method. Tracked in #1063 (#1064–#1067).

**Coverage target and benchmark threshold.** James, Oct 12. Under $10B, each state and size
group (under $300M, $300M–$1B, $1–10B) is covered when it has 30 institutions with live fees, or
75% of the group when it has fewer than 40. A benchmark shows from 10 institutions, marked
"limited sample" below 30. Below 10 it falls back to the Federal Reserve district at the same
size, then to the state across all sizes, matching the 10-institution peer minimum in the
`fee-benchmarking` skill. Banks over $10B are compared nationally and by district, never by
state. Why: with 8 institutions the 95% range around a median runs from roughly the cheapest
bank to the priciest; at 30 it narrows to about the middle third; and covering most of a small
group is close to a census. Measured the same day: 64 of 161 state and size groups under $10B
meet the target, and about 524 more covered institutions would close the gap (75% in every group
would need about 2,654). Only 6 states have 30 or more covered $1–10B institutions, while all 12
districts do, so that tier leans on the district fallback. Full coverage stays the long-term goal
for the consumer hub.

**Publish benchmarks now; unlabeled fees count as consumer, marked with an asterisk.** James,
Oct 12 (#1058): a fee with no clear personal-or-business signal is treated as consumer and shown
with an asterisk and footnote beside its source link: "Audience not stated on the bank's
schedule; treated as personal. Fees may differ for business or commercial accounts." The
methodology page explains the rule. Knox works the backlog down from documents already stored,
with no new searching (#1059), so the asterisked share should fall toward zero. Statistical
significance across thousands of institutions matters more than perfection.

**Business fees are published and labeled, not dropped.** James, Oct 12: some banks and credit
unions are business-focused, so business and commercial fees (one value, `business`) stay visible
on institution pages and in their own clearly labeled business comparisons. They are kept out of
consumer medians only so the two are never mixed; every figure says which audience it covers.

**Monthly account fees are compared on the entry-level account.** James, Oct 12 (#1060): plus the
share of peers offering a free account; a free checking account counts on the consumer side.
Long-term direction: a consumer-facing hub where someone shopping for a local bank compares every
bank's fees in their state or county and asks Hamilton what a fee means. The data layer comes
first.

**Thin results mean the wrong document, not a small fee schedule.** James, Oct 12: a real fee
schedule (the disclosure Truth in Savings requires) lists far more than one or two fees, so an
institution with only one or two fee types almost certainly has the wrong document: a checking
product page, a savings page, a CRA file. The data agrees: of the 1,235 institutions held by the
3-fee minimum, 1,041 sit on product or account pages by URL, and 496 have only a monthly
maintenance fee (`docs/plans/rosetta-review-2026-10-12.md`). The 3-fee minimum stays. Those
institutions go back to Magellan as priority targets for the real schedule, and a fee from a
product page is never published as if it were the schedule. (James first said a sourced fee is
worth publishing even when it is one of two; on seeing the documents he corrected it the same
day.)

**Pay to transcribe scanned PDFs.** James, Oct 12: yes to paid reads for scans that free OCR
cannot read, inside the provider caps.

**Foundation first, then Magellan, then Hamilton.** James, Oct 12: "lay the foundation of this new
system first." Before any agent work, the repository is reset to how work runs now (#1047, PR
#1046):
- one builder at a time, starting from the Now list in #1026;
- the multi-agent coordination checks and workflows are removed, and `BACKLOG.md` is superseded;
- the site-copy marketing skills are linked so sessions find them;
- Vercel previews are built for every PR.

(Replaced 2026-10-19: findings are now checklist lines on their root-cause issue; see that entry.)
Every change a review finds is documented as its own issue, with no cap (James, Oct 12: "if
Magellan has nine, we need to document all nine"). Work that belongs to no agent
(infrastructure, documentation, process) has its own Foundation tracker. What keeps the work
manageable is order, not a cap: #1026 holds at most three Now items, each review names the issues
it closes, and James re-orders the list weekly (about ten minutes).

**Review the pipeline one agent at a time before relying on it again.** James, Oct 12, in a
Claude Code session. Each agent gets a written review with production measurements and a GitHub
tracker issue with one sub-issue per change (narrowed 2026-10-19: a change is a checklist line
on the tracker unless it is a new root cause), under one master tracker
(`docs/plans/pipeline-review-2026-10-12.md`). Order: Magellan, Rosetta, Knox, Darwin, Hamilton,
state experts, Atlas. Reviews are documents and issues; code follows one issue and one PR at a time.

**Priority: data layer, then raw intelligence, then Hamilton.** James, Oct 12. The first customers
are expected to be institutions under $10B at around $150 a month, so coverage is aimed at
benchmark-ready counts in every state and asset tier, not at the largest banks alone.

**Never abandon an institution that has not been found.** James, Oct 12. Search for a fee
schedule, then a Truth in Savings disclosure or account agreement; if nothing is published online,
re-try on a longer interval instead of every month. Once found, do not search again for about a
quarter.

**State experts stay code-driven but must be visible and improve.** James, Oct 12. They should
own their state's coverage and show their memory and progress in admin.

**Up-front build-out spend is accepted; recurring session spend is not.** James, Oct 12. He will
spend $500–$1,000 or more to bring the database to an A+ level, but not $1,000 a week on Claude
routines. Scheduled Claude routines for Fee Insight were paused the same day.

## 2026-10-11

**One-time WIP exception for the directory fix.** James, Oct 11 (`docs/project/BACKLOG.md`,
issues #1012 and #984). Only PR #1017 could go over the three-PR correctness cap. The exception was
limited to that PR, issue, branch and base, and expires 2026-10-14T00:00:00Z
(`.github/backlog-policy.json`). Every other intake check still applied. The default cap stays at 3.

## 2026-10-10

**Clean, merge-ready PRs have standing merge authorization across FeeInsight chats.** James,
10 Oct 2026, told the GitHub workstreams that his authorization to merge clean, merge-ready work
applies across all chats. A routine code PR no longer waits for another per-PR approval when its
exact current head is reviewed, required checks are green, it is conflict-free, blocking reviews
and active-owner overlaps are resolved, and no separate release dependency remains. This does not
silently authorize database migrations or production-data changes, permission/security-setting
changes, paid-provider activation, outreach sending, force-pushes, branch deletion, or other
explicitly gated production actions. Those retain their own approval/evidence requirements.
Merge receipts must still distinguish merged, deployed and production-verified states.

## 2026-10-09

**One queue, one implementation.** Recorded 2026-10-09 UTC in `docs/project/BACKLOG.md`, with
control issue #984 and the checks in #987. Each piece of work has one canonical issue, one
implementer and one draft PR. Every new PR carries an intake block (work item, owner, area, scope,
duplicate search, overlap, verification, rollback). Each area has at most three open
implementation PRs. Outreach and marketing are on hold. The priority order is correctness and data
trust, then customer journeys and payments, then maintainability.

## 2026-10-08

**No rollback; finish the work.** James, 22:44 UTC, Rollback thread: "i dont want rollback. i want
the fucking work done." He had asked about going back to Oct 4 or Oct 5; the cost check is in
`/mnt/project-files/audits/rollback-oct4-oct5-2026-10-08.md`. Work is reported per ask as live,
built not live, or missing, and only the UAT thread marks an ask done.

**Darwin's 11 critical eval rows come down now.** James, 23:18 UTC, Darwin thread ("please resolve
each of thes. all of them"), answering Hide or Guard for the 11 critical rows and Split or Pool for
the taxonomy. #714 archives the 11 on the first publish step, with the eval label as the audit
record; nothing is deleted. Collection Items split out (#701); the other four pooled groups wait on
the Top 50 card.

**A paying Pro buyer holds their bank's owner seat at checkout, before claim review.** James, 13:44
UTC ("Grant at checkout" on the decision card). The plan sells 5 seats, so they work the moment the
buyer pays. The claim is still filed for James to review, and rejecting it revokes that seat
(`src/lib/pro-checkout-institution.ts`, `rejectInstitutionClaim`). The other option was to unlock
seats only after review.

**When an agent breaks, recovery fixes it without asking first.** James, 12:26 UTC ("Fix" on the
recovery card), after a deploy broke every Hamilton publish at 12:06 ("Hamilton is blocked. We
need a way to automate resolution when this happens"). A scheduled recovery check finds the break,
opens a fix PR, merges it on green, proves the failed work reran, and tells James after. Revert-only
and alert-only were the other options. What it may and may not do is in `.claude/skills/recover/SKILL.md`.
It never touches data with SQL, never deletes, and never makes paid calls.

**The institution report stays quoted on request; free instant reports lead to the paid offers.**
James, 11:55 UTC: "I'm fine with quotes for request" (no published $300, no "from $300" anchor), and
"I'd like to give a free instant report to upsells". Quotes keep running through /admin/leads and
/pay/report. Which free report carries the upsell (the existing national and district reports, a new
own-bank snapshot, or both) is the open choice in the marketing thread. Small banks sit on the $1,500
Pro tier.

**Pro moves to three tiers; the monthly brief stays free; banks and credit unions get equal weight.**
James, 11:35 UTC, after the pricing and competitive strategy pages. Pro becomes three tiers at
$1,500, $3,000 and $5,000 a year ("If we need to bump prices later we can. 5k for an on demand
consultant isn't a lot"). The Stripe payments thread owns `src/app/subscribe/pricing.ts`, the Stripe
prices, and the open tier questions (asset breakpoints, a monthly option, how the tier is picked).
Marketing copy and the plan follow its answers. The free Fee Pulse monthly email stays free and is
positioned against Moebs's paid news product (task 2.27). Marketing gives banks and credit unions equal
weight. The report price is still open: it stays "Priced on request" until James answers.

**Eleven marketing gaps added; the admin stays simple.** James, 08:57 UTC. After the pricing and
competitive strategy research, he added tasks 2.25-2.35 to `growth-os/BUILD-PLAN.md`: lead follow-up,
pricing rollout, Fee Pulse positioning, a method and accuracy page, a live sample report, a first
case study, comparison pages, a credit union campaign, association partners, email scores and sales
in the scoreboard. "Just ensure cleanness on the admin side. Simplicity": every admin screen for
marketing lives inside /admin/growth, which opens on items to review with everything else in tabs.
No new admin pages for marketing.

**The taxonomy is the top 50 fee types, and every fee is fitted into them.** James, Oct 7 ("Fold
into existing", no new categories) and Oct 8 (the About page said 61: "do the top 50 and
try to fit everything there"; "Use extensive and comprehensive text matching"), 09:05 UTC ("Merge
caps": the NSF daily cap joins the overdraft daily cap, and International ATM stays one of the
50). Fifteen categories left `FEE_FAMILIES`; `src/lib/fee-fold.ts` re-files each of their fees by
its own wording, and a bare name by the schedule section above it. At 09:47 UTC he chose to keep
Appraisal as its own type (folding it into loan origination would move that median), and at
11:44 UTC picked Mortgage Lien Release (with reconveyance) to fold into Other Lending Fee in its
place. He also asked to see the fees with no home before any
are archived, so Hamilton's fold step flags them but keeps them live
(`TAXONOMY_FOLD_ARCHIVE_NO_HOME` is off) until he decides. At 15:42 UTC, after seeing the list
of 248, he said "drop them -- the 248", so the switch is on: they are archived (rolled back with
reason `taxonomy_fold:`, logged) once their 12-hour second look passes. Nothing is deleted.
Around 16:00 UTC he gave collection items their own type ("Own type": about 1,000 check
cashing fees with a $20 median beside check cashing's $5 move to `collection_item`), and picked
Foreign Card to give up a spot for it. Foreign Transaction and International ATM became one type,
International ATM & Card. It keeps the `card_foreign_txn` key, which holds the 277 rate fees,
the spotlight and the consumer guide, and the 59 International ATM fees fold into it.

**One marketing loop, built from a 55-task plan.** James, 04:23 to 07:20 UTC. Marketing is one
automated loop that extends the existing content and email workflows and runs on the same run
ledger as the data agents (`growth-os/BUILD-PLAN.md`). Approvals happen in an admin page and on
GitHub. Free reports are described as "instant". At 07:20 he approved the plan with its
recommended answers: a new agent, BERNAYS, owns press, events and partners; 3 LinkedIn drafts a
week; agents that change code run as scheduled Claude Code sessions that open PRs; the growth
budget is $5 a day and $60 a month; 3 follow-up email drafts after a free report; loop
infrastructure is built before the agents; and each task is a GitHub issue labeled `growth`.
Nothing is scheduled until he says go after a two-week dry run. Lesson for Claude: ask him when a
choice changes scope, rather than picking a default.

**A second agent team for marketing: GrowthOS.** James, 02:26 UTC, proposed a marketing team built
from the Marketing Skills library (MIT, copied into `.agents/skills/`). Week 1 is in `growth-os/`:
the manager is DRAPER (Atlas is already the pipeline orchestrator), SHERLOCK does market
intelligence, GitHub issues labeled `growth` are the work queue, and nothing is scheduled until
James says go. The team runs as Claude Code routines because its output is GitHub issues and PRs;
any app-side paid step gets its own `ANTHROPIC_API_KEY_GROWTH` slot and `agent:growth` budget.
Every public number passes `growth-os/context/editorial-policy.md`. James asked (04:20 UTC) where
SEO and social were: ERNEST (SEO) moved up to start with the first run, and MURROW (social) was
added to own LinkedIn through the existing content workflow, not a second pipeline.

**Darwin releases held fees that pass Claude's review.** James, 02:16 UTC, tapped "Turn on" on the
held-fees card. The bar he set was his own word plus at least 19 of 20 passes right in a hand
check; review v10 met it (19 right, 1 arguable; earlier rounds 17, 18, 18). Released fees carry the
`darwin_released_hold` flag so the release can be found and rolled back; a fee taken down later
is archived, never deleted.

## 2026-10-07

**Hamilton gets the new market study and the merger screen.** James, 07:24 UTC ("Go on market",
"Go on merger") after the previews. The Improving Hamilton thread builds both; open PRs 441 and
447 carry them.

**The 13,215 bad FFIEC rows leave the live call-report table.** James, 07:18 UTC, typed "Archive
the 13,215 FFIEC financial rows." Written by an old loader on Aug 10, their service charges were
about a million times too large and most duplicated good FDIC and NCUA rows. They move to a
restorable archive table; readers use only `fdic` and `ncua` rows (#440). Bank overdraft income now
comes from the FFIEC bulk call report step instead (#369, #386).

**Every state report gets the Tennessee-style map and detail.** James, 07:11 UTC ("I love the state
map... Need that for every state"). Open PR 436 carries it.

**Each state's 10 to 15 largest institutions come first.** James, 03:07 UTC: find all fees for the
largest institutions in every state, which likely hold over half the deposits and have pricing
power. A shared ranking of each state's top 15 (#355) now goes first in Magellan's search (#356)
and Atlas's state order (#359).

**Taking a fee down is a last resort: a second look, a decision log, and a way back.** James,
01:20 UTC (Live board cleanup thread): "we need to constantly learn from fees we pass or scrap...
It needs to be last case decision, picked over multiple times, decision log. And it's never
deleted, just archive and can always be revisited." A Hamilton check that fails a live fee logs
it as `takedown_pending` in `pipeline_feedback` and leaves it live; only a later run (at least
12 hours on) that fails it again takes it down (`hamilton/second-look.ts`). A fee that passes
in between is logged `takedown_cleared`. Takedowns stay soft (`rolled_back_at` plus the reason),
every takedown and restore is synced to `pipeline_feedback`, and a check that is fixed brings
back the fees it now passes. Started with the source check and the category guard. The rules
re-check, outlier range and off-taxonomy checks follow.

**The public sample report names a real bank.** James, 01:00 UTC, in the value funnel thread.
The sample is a live report for one real community bank and its named competitors, with the
source link on every fee, rather than an anonymized copy without links. Every figure on it is
already public on the institution pages. James approved the previews and said to move forward
at 01:37 UTC, so links to the sample show across the site whenever a sample market qualifies.

**Scrapping a fee is a last resort: looked at more than once, logged, archived, never deleted.**
James, 01:20 UTC ("we need to constantly learn from fees we pass or scrap ... It needs to be last
case decision, picked over multiple times, decision log. And it's never deleted, just archive and
can always be revisited"). Every pass or scrap feeds `pipeline_feedback`. Darwin's held-fee pass
(`verify.release` v4) now takes two looks at least 20 hours apart, the second against the bank's
current copy, before a reject is final; a fee later found on the schedule gets a `restored` note.

**Held fees with no category fold into an existing one; nothing beyond the ~50 tracked
categories gets its own.** James, 01:18 UTC, chose "Fold into existing" on the Knox held-lines
card, then: "do our best to match fees to the right category, but at some point we just need to
stop caring about anything beyond the top 50." Knox rules v26 (`FOLDED_PATTERNS` in
`knox/rules.ts`) file returned mail, bad address, fax and excess-withdrawal fees under account
research, collection items and foreign checks under check cashing, and loan cancellation, credit
report and UCC fees under loan origination, as the taxonomy and answer keys already map them.
Groups with no right home (membership, phone transfers, credit card, uncollected funds,
returned statements) stay held rather than skew a featured fee.

**Nothing Knox sets aside is deleted.** James, 01:20 UTC: "We can't just aimless toss. It needs
to be last case decision, picked over multiple times, decision log. And it's never deleted, just
archive and can always be revisited." A held line is set aside (`knox_set_aside`) only after three
rules versions have read it; every read is logged in `pipeline_feedback`
(`knox.held:raw:<id>`, versions checked, outcome), the row stays, and every later rules version
re-reads it.

## 2026-10-06

**Value funnel answers.** James, 23:49 UTC, in the value funnel thread.
1. The report rule falls back to Fed district peers when a state has too few (PR 302).
2. No "from $300" anchor on the report offer.
3. Pro pricing stays as it is ($499.99/mo or $5,000/yr per seat); no per-institution plan.
4. Fee-change alerts on a followed institution are free; Pro is sold on Hamilton, not alerts.
5. Every paid report ends with "Track this market in Hamilton", linking to the Pro plans.

**One marketing email a month per reader.** James, 17:53 UTC. A reader who picked a state gets
that state's edition instead of the national email; everyone else (and readers in a state too
thin for its own edition) gets one national email. Product and site updates ride in a one-line
"What's new" in that email, never as their own sends. Built in `src/lib/agents/marketing/`.

**Darwin's held-fee pass acts on rejects only; every release stays held.** James, 16:49 UTC,
chose "Reject only" on the Darwin thread's card after the v1 spot check found 12 of 20 releases
right. Held fees the bank's schedule doesn't state leave the held pile with a `not_on_schedule`
note (`verify.release` v3). Releases stay a dry run until the stricter Claude review passes its
own spot check (at least 19 of 20 right), and switching them on needs James's word.

**Darwin's held fees get a way out: release or reject against the bank's schedule.** James, 13:20
UTC ("i need you to close all those gaps with the agents"), taken as the go-ahead on the
held-fees card's recommended option. Each fee Darwin holds (outside its range or far from peers)
is checked with the shared accuracy check: not stated is rejected with the reason; stated and held
only as a peer outlier is released; stated but outside the hand-set range stays for a person,
since Hamilton's publish gate uses that range. It runs as a dry run on live data first
(`verify.release` v1 records verdicts only) and acts only after the dry run is reported.

**Institution reports may compare thin states against Fed district peers.** James picked "District
fallback" on the decision card at 14:34 UTC: when a state has too few peers with rich fee data, the
report compares against same-charter peers in the bank's Fed district, labelled as such. Only 6 of
109 state markets passed the state-only rule (card context, 14:11 UTC). The build is question 1 of
the funnel thread's plan and waits for his answers there.

**The mailing address stays blank until the state registration comes through.** James, 13:03 UTC
("its blank for right now. im waiting on the state"). `MARKETING_MAILING_ADDRESS` is not set and
nobody asks him for it; until it exists no marketing email can send, which is the intended state.

**Every agent gets the same fixed daily health check, compared with yesterday.** James, about
05:40 UTC ("a clear process to break this into manageable chunks that stay consistent so any new
or change is easy to spot"; chose "Build it" on the Atlas audit thread). Each agent's AGENTS.md has
a "Daily health check" table of rules, each tested by one number; `src/lib/agents/agent-health.ts`
reads them read-only with the daily scoreboard step and stores them in
`pipeline_scoreboard_snapshots.detail.agent_health`. The scoreboard step's summary names every
broken rule and every number that moved more than 25% since yesterday. A change to an agent's
selector or behaviour updates its table and the health check in the same PR.

**Each state gets its own monthly edition for readers who pick it.** James, 07:42 UTC ("50 different
emails based on the states"). Readers choose a state at signup or on the confirm page and join that
state's MailerLite group; the marketing run drafts one edition per state with readers, from data
alone (no model call), sent with the month's approval. Monthly rather than weekly, because
published fee schedules barely change week to week (Claude's default; one setting to change).
Drafts no longer need the postal address: the send step adds it (James, 07:23 UTC).

**A monthly marketing agent drafts the emails; James approves each month before anything sends.**
James, 07:02 and 07:03 UTC ("approve each month"). Hamilton's marketing run on the 1st scores last
month's campaigns, picks two formats not used in three months (readers tire of the same email),
writes them from live data, and drafts each as an A/B subject test in MailerLite. One approval in
/admin/customers/marketing sends the month. Results and lessons go to `pipeline_feedback`.

**The institution report is paid by card through Stripe.** James, 07:21 UTC ("pay should be via
stripe"). James types the quoted price on a report request in /admin/leads, which gives a private
pay link (`/pay/report/<signed token>`). The requester pays on Stripe Checkout; the price comes from
the request row, never the link. The Stripe webhook marks the request Paid, alerts James, and emails
the requester their private report link. A quote is saved only when the report check says "ready to
quote", so no one pays for a report built on thin data. The report stays "priced on request".

**Work keeps going overnight without Allow taps.** James, 07:13 UTC ("i dont want it to stop because
i have to check allow"). Threads skip any step that needs a tap and use a safe alternative (no
force-push, reset or push to main; after a merge, merge `origin/main` and push normally). Reviews,
merges to main, database and production changes wait in a list for him.

**Magellan's upgrade plan runs in full; its fee-page classifier learns continuously and starts in
shadow.** James, 05:41 UTC, on the Magellan Upgrade Plan
(https://claude.ai/code/artifact/12c7e165-b7af-4aee-a356-cc0c4f5c15a8): tighten the main-link
check and re-search (agreed), a $250 paid-find trial (yes), classifier weights kept in a table that
a Magellan run step retrains ("Yes. Consistently reinforced"), no further plan upgrades, and the
thread runs it. The classifier (`magellan_page_classifier`) only records its opinion until James
reviews it; letting it decide is his call.

**One Fee Insight header across the public site and Pro; Hamilton has four tabs.** James,
00:22-00:33 UTC, on a decision card. Pro no longer swaps in its own header: the site header stays,
and for Pro users its links are Hamilton's tabs, This month, My fees, Try a price and Reports ("a
banker doesn't wake up wanting to model or watch"). The bank and its data, all changes, the
reference pages, Admin and sign out sit in the account menu. No sidebar. Built in PR 89.

**Every Hamilton output shows its audit trail; nothing is a black box.** James, 00:08 UTC. For
regulatory work a figure has to be defensible. Each Briefing, Research, Model and Plan screen has a
"How this was built" panel listing every source with its date, the method, every assumption
(including figures the bank typed in) and whether it rests on market data alone. The bank's own fee
lines link to its schedule with their publish date and verification record, and a CSV lists every
institution behind a comparison with its source. The CEO one-pager and committee packet carry the
same panel as an appendix. Built in PR 89; the stored audit record belongs to the Hamilton engine.

**Threads push their own `claude/*` branches without asking.** James, 06:35 UTC, before two weeks
abroad: `.claude/settings.json` moves `git push` from "ask" to "allow" for `claude/*` branches.
Force-pushes, pushes to main, Supabase db pushes and Vercel production commands still ask. Merges
still need green CI, and anything that can take down live fees still gets a dry run first.

**One shared learning store for every agent: `pipeline_feedback`.** Agreed by the Knox, Magellan
and Darwin threads at 05:50 UTC, following James's "knowledge flow through to other agents, to and
from" (05:41 UTC). One row is one judgement about one agent's output (a takedown, a Darwin
category reject, an answer-key fee, a link's live-fee count), upserted on `dedupe_key`. No agent
keeps its own copy. Fields and keys: `src/lib/agents/learning/AGENTS.md`.

**The admin becomes one console with six rooms, opening on a Needs-you list.** James, 05:57 UTC,
answering the console brainstorm (https://claude.ai/artifact/9xib8VUnETMBh1u4txabzW). /admin opens
on Today: everything waiting on a person, with the button that clears it. Every other screen
lives in one of six rooms: Agents, Data, Customers, Publishing (reports, briefs and monthly
updates; James asked where published content lives) and Controls (spend, stop switches, launch
checklist). The morning brief emails the same list at 7am Central to hello@bankfeeindex.com, with
jlgilmore2@gmail.com copied. Every room works on a phone. James said to "run without me": the
console pieces are built and merged when CI is green without waiting for his review.

**Darwin is rebuilt as a full verification layer, with Claude as the last resort.** James, 05:29
UTC ("i want to build the entire Darwin layer. But the API call should be last result"). Free
methods run first: reading the schedule as rows, a learned category model, learned price ranges,
peer checks and the shared source check. Only fees those methods disagree on go to a Claude
call, and only within Darwin's own budget. An internal validation team (the "solutions team")
may be added to grade Darwin against an answer key. Knowledge flows to and from every agent
(James, 05:41 UTC): Darwin's learning reads and writes the same shared corrections store Knox and
Magellan use, never a Darwin-only copy. The build plan is in the Darwin v2 design
artifact (https://claude.ai/artifact/Ta2Nv3YRVCZ55orVTsNMjL).

**Every agent gets its own Anthropic API key so spend is tracked and capped per agent.** James,
05:29 UTC. `src/lib/ai-provider.ts` reads `ANTHROPIC_API_KEY_<AGENT>` (ATLAS, MAGELLAN, ROSETTA,
KNOX, DARWIN, HAMILTON) and falls back to the shared `ANTHROPIC_API_KEY`, so nothing stops while
the keys are being added. Every model call names the agent it bills to. The Atlas details page
shows which key each agent is using.

**The site shows a bank only while it has at least 3 distinct live fees.** James, 05:50 UTC, after
the Hamilton publish audit found 163 banks left with 1 or 2 live fees by takedowns (120 of them)
or from before the rule (82). `published_fee_catalog` hides such a bank's fees and shows them
again on their own once it has 3; nothing is deleted. This replaces "already-live thin
institutions stay live" from 2026-10-04.

**Hamilton is auditable: every output shows how it was built.** James, 00:08 UTC ("Auditing is
incredibly important... we don't want to hide behind a black box"). Every Briefing, Research view,
scenario and implementation plan carries its provenance: sources with links to the banks' own
schedule documents, data as-of dates, the peer group and its size, assumptions, evidence level,
and each client-given figure with who gave it and when. Saved decisions keep the provenance from
the moment they were made. The same message set out Hamilton's faces (fee verifier and
publisher, research publisher, industry expert, paid-client workspace); the Hamilton agent guide
describes all four. Built in PR 170.

## 2026-10-05

**Hamilton is a neutral research and modeling workspace, never a fee recommender.** James,
23:27-23:39 UTC. Hamilton follows the same path every time: research, compare, model any price
the bank wants to test, refine with the bank's own figures, plan the change, then build the
report. It never tells a bank to raise or change a fee. It gives an opinion only when asked, and
then names the objective it assumes. Dollar totals rest on the bank's own volume. Implementation
is its own step: approvals, customer notice (30 days for an increase under Reg DD, none for a
decrease), systems, the Reg E opt-in notice, the effective date and monitoring.

The nav is Briefing, Research, Model, Reports, Watch and Data. Ask Hamilton is a docked bar on
every screen; its work lands on the page, not in a chat log. Overdraft is the flagship example.
The look follows James's "living memo" option, rendered in the Fee Insight brand.
Mockup: https://claude.ai/artifact/Cjx5VmTFS2zhpi6bM7YQv1. Built in PR 89.

**The institution report has no fixed price yet; the granular data stays paid.** James, 23:31 UTC
Oct 5 and 00:15 UTC Oct 6. It will be a $300 report once it is ready, but for now a request is
quoted by hand. Free reports give value away (national and district medians only); per-bank fees
and named competitors are never in a free report. PR 107 was reshaped to match: a request tells
James whether that bank's report can be built and gives him a private link to send after the
requester agrees. There is no checkout, and nothing is sent to the requester automatically.

**Free district and national reports use the state-report consulting format.** James approved
PR 166 at 23:44 UTC Oct 5, after calling the old St. Louis district report "the worst type of
report I've ever seen". Each report shows key findings, headline-fee ranges, the district vs
national, banks vs credit unions, and a locked "your institution" section that leads to the paid
report.

**No booking tool and no paid tools before the first sale; James emails clients directly.**
James, 00:57 UTC Oct 6 ("I don't need to book 15 minutes to talk to somebody ... I can just
email them"). He uses Outlook and is already paying for several small services with no revenue
yet. Pages offer an email link, never a scheduler; PR 178 changed the private report page's
"Book 15 minutes" button to "Email us about this report". Any new paid service waits until a
report has sold.

**Atlas schedules by where the work is, and daily passes count only findable banks.** James,
13:20 UTC ("i need you to close all those gaps with the agents", on the agent audits). Each
state lane is ranked by its banks with open work or a recent error, and the busiest due lane
goes first. A state stays on daily full passes only while more than 50 of its banks still have
no link and could be found by a search. Dead ends wait for the quarterly re-check. A state with
paid-find targets or banks with no website still due a website search also stays daily, so
those paid steps keep running inside the paid caps (coordinator, 13:39 UTC).

## 2026-10-05

**Package all 16 years of call reports on institution pages, deeper for Pro.** James, 22:25 and
22:38 UTC ("Go: phases 1 and 2"). Phase 1 shows the stored-but-hidden figures plus growth, peer
rank and outliers. Phase 2 widens the FDIC and NCUA pulls (overdraft-related service charges and
other deposit-fee lines) and re-pulls all 66 quarters as visible runs. Only figures the source
reports: no overdraft/NSF split unless a filing reports one. Phases 3 (a Pro institution
workspace) and 4 (free page tune-up) wait for his go-ahead.

**The API is invitation only: David Bressler (betteranalyst.com) gets everything, nobody else
gets in.** James, 23:28 UTC ("nobody else should have access to API"). Every `/api/v1` request
needs a key Fee Insight issued by hand; there is no free self-serve tier. David's key is
Enterprise (all categories, institution detail, call reports, complaints, CSV, no limit). The
site's own signed-in download buttons keep working without a key. Built in PR 161.

**Hamilton is decision support, not a recommendation engine.** James, 23:27 UTC, correcting his
23:08 direction: Hamilton surfaces what is worth investigating and what the market says, models
the prices the bank asks about (roughly from published revenue, precisely from figures the bank
enters) and plans implementation with real constraints such as 30 days' notice for an increase.
It never says "raise your fee" or "approve recommendation"; it gives an opinion only when asked,
naming the objective it assumed. Prompts carry this from voice v3.2.0; the plan is "Hamilton as a
fee consultant" (https://claude.ai/code/artifact/ff42ee75-db64-4c54-aa04-5c17553255e8).

**Hamilton is a paid consultant, not a chatbot that restates the site.** James, 22:57 UTC: "A
consultant finds the actionable insights, the peer data, the qualitative and the quantitative, and
packages it in an easy to understand and concise, valuable package." Hamilton's voice (v3.2.0),
the Pro prompt and Analyze now forbid answering by repeating what the public pages show and ask
for the "so what": peer gap, revenue at stake, trend or outlier, and the decision it raises.

**Free reports are instant; the institution report is paid and never promises a turnaround.**
James, 21:41-22:20 UTC. The request form becomes a picker: a National report (email only) and a
Fed district report (email plus district) are free and open at once; a report on one institution
against named competitors is the paid step, shown grayed out as the hook. Never promise "48 hours"
for anything free, because that puts unpaid work on James. This replaces the earlier "the report
is free" (J1) for the institution report. Built in PR 150.

**Free discovery is never held to the monthly cadence.** James, 22:32 UTC ("if it doesn't
require money, why are we limited in it?"). Every state's hourly backlog run now searches banks
that are due a free search, and a discovery step takes up to 50 banks within its time budget.
Shipped in PR 154.

**Every state runs a daily full pass until its links are found.** James, 22:28 UTC. Daily passes
used to be Texas and California only; now any state with more than 50 active institutions lacking
a fee link runs daily, then drops back to monthly on its own. Shipped in PR 154.

**Spend to fill the fee database now, then refresh cheaply.** James, 22:19 UTC. He added $500
of API credit and said yes to raising the in-app caps: fill the database, then drop to a monthly
or quarterly refresh that costs little, paid for by Hamilton subscriptions. Caps go to $75/day and
$500/month for the whole app, with Knox $200, Magellan $150 and Rosetta $150 a month; Hamilton
stays at $5/day and $50/month. The SQL is issue 153. Sized from prod spend: paid steps cost
$13.67 for 356 institutions on Oct 5 (about $0.04 each, about $80 a day at full speed). After
the fill the caps come back down; paid steps skip text they already read, so a refresh only pays
for changed schedules.

**No Plausible.** James, 20:51 UTC. He doesn't use it; dormant Plausible code led a session to
ask him to set up a Plausible goal. Its script, CSP host, env var and docs are removed and
`plausible-kill` keeps them out. `trackEvent` stays as the one hook for a future provider; page
views come from Vercel Analytics and report requests are leads in /admin/leads.

**A bank's tiered overdraft counts at its highest (standard) tier.** James, 19:45 UTC, on a
decision card. Each tier stays its own live fee with its band in the name, and a real $0 fee
counts. Medians, percentiles, peer positions and reports use the bank's highest overdraft
amount; other categories keep the median. Shipped in PR 132 (`institutionValue` in
`src/lib/data-store/fee-stats.ts`).

**CLAUDE.md is kept current, and the project keeps a durable memory in `docs/project/`.**
James, 18:51 UTC. CLAUDE.md had gone stale (it said the 25 reports were ready to send).
Daily checkpoints, findings, decisions and a changelog now live in this folder.

**Take down live fees that can't be traced to the bank's own schedule.** James, 18:26 UTC.
Texar FCU showed a $50.01 overdraft fee that was really a balance threshold. Fees are relinked to
a stored schedule first; failures are taken down (reversible, logged), Texas and California first,
then nationwide, in small batches. Public counts must come from live data. Shipped in PR 119.

**Accuracy means live fees that match the bank's own current schedule.** James, ~18:11 UTC.
Accuracy is the share of live published fees whose amount and category match the bank's own
document, measured on fresh random live samples. Offline holdout scores don't count. The one
shared check is `checkFeeAgainstSource` in `src/lib/custom-report/source-check.ts`.

**Daily full passes in Texas and California.** James, 18:16 UTC. They run daily while more than
50 active institutions there lack a fee link. Shipped in PR 117; widened to every state in PR 154.

**No Firecrawl.** James, ~17:24 UTC. It bills an account he didn't set up for this project.
Use plain fetches, Vercel previews, or a Remote Control session on his Mac.

**Texas and California are the first markets to fill deeply.** James, 17:48 UTC. They come
before any report is sent; every report stays on hold until its market passes the readiness gate.

**Upgrade the database to Medium.** James, ~17:05 UTC. Cost went from about $10 to about $60
a month. Revisit whether Small is enough once the pipeline cap and caching have settled.

**Turn on the Supabase GitHub link once migration history matches prod.** 2026-10-05. After it is
on, merging a migration file runs it on prod, so a PR must say if its SQL changes data. History was
aligned by PR 112 and issue 113; the link itself is James's step in Supabase settings.

**SQL James runs by hand goes in numbered GitHub issues labeled `sql-to-run`.** James, 14:40 UTC.
Each issue has a "1. Run this" block and a "2. Then check" block.

**Fix PRs may merge once green; redesigns wait for James's review.** James, 2026-10-05.

**The site must feel like a top-tier consulting experience.** James, 14:15 UTC.

**No heading or lead line may wrap one word onto its own line.** James, 17:02 UTC. PR 105 added
the global rule and the `heading-wrap-kill` guard; pages don't add their own rule.

**Never fake logs, records or numbers.** James, 06:32 UTC. Top priority. Status answers use
live database counts and a read-only query James can run himself.

**Agents never sit idle while there's a backlog, and failures are never silent.** James, 2026-10-05.

**Keep backend fixes minimal; UI work should be genuinely visual and clear.** James, 06:06 UTC.

## 2026-10-04

**Build the pipeline complete, not in bits; target 90%+ accuracy.** James, 20:12 UTC. The target
was later raised to 95% under the live-fee definition above.

**An institution publishes only with at least 3 distinct fees.** James. Shipped in PR 66.
Already-live thin institutions stay live but stay queued for re-review.

**Process one whole document at a time and move all its fees together.** James.

**Crawl each state monthly with a quarterly re-check, with a state expert agent per state.** James.
Built in PR 75 (state experts, monthly full pass, quarterly re-check).

## 2026-10-08

**Pro is described as one plan for up to 5 people, not per seat.** James, 08:19 UTC, Stripe
thread. One checkout ($499.99 a month or $5,000 a year) already gives an institution account 5
logins (`WORKSPACE_SEAT_LIMIT`), so the site now says "for up to 5 people" instead of "per
seat". Prices and Stripe are unchanged. Answers build-plan task 0.11.

**Pro has three price tiers by institution size, each for up to 5 people.** James, 11:35 and
11:47 UTC, marketing and Stripe threads. Under $500M in assets $1,500 a year, $500M to $2B
$3,000, over $2B $5,000. Monthly is offered too; annual equals about 10 monthly payments, so
monthly is $150 / $300 / $500 (James 12:03: "10 at 150"). A bank's tier comes
from its own assets (`institution_sources.asset_size`), worked out again at checkout; with no
asset size on file, the buyer is asked to email. Consultants and other non-banks pay the middle
tier (James 12:03: "consultants should have 3k"), with a monthly cap of Hamilton reports
(James chose a report cap 12:04; `CONSULTANT_MONTHLY_REPORTS`, 10 a month, James 12:10); past it they move
to the $5,000 price, which has no cap (`src/lib/hamilton/report-cap.ts`). The site sets up its own Stripe prices by lookup key (James 12:53: "you can do
everything in stripe"; `src/lib/stripe-prices.ts`); a Vercel variable per tier only overrides
(`src/lib/pro-tiers.ts`).

**Outreach is founder-led: agents draft, James sends, after the site is launch-ready.** 2026-10-08.
James chose "Yes, 75 a week" (15:15 UTC) for personal outreach emails that the agents draft and
he sends from Outlook; "agents DRAFT, never send these" (15:14). Sends start only once the site
passes the launch-ready check in the Q4 go-to-market plan (James 15:16: "ONCE we get the site
ready to launch"). Contacts come from the same process as fee schedules, aimed at executive
emails the institution publishes (`src/lib/agents/growth/contacts.ts`); nothing is guessed.

**Month one is a sales experiment; the free snapshot launches Oct 13.** 2026-10-08. James's two
reviews of the go-to-market plan (about 15:25 and 15:33 UTC) replaced 75 emails a week with 25 to
40 personalized emails, scaling only on qualified replies. The Nov 6 floor is 5 qualified
conversations and 2 explicit purchase discussions (10 is the stretch). Every number in outreach
and paid deliverables is checked against the bank's current schedule for value, account type,
effective date and conditions, and a person audits each comparison in the first 25 to 40 emails.
The market report and annual Pro are separate products. Consultants may share reports with
clients with Fee Insight attribution; white-label is a separate premium offer; reselling the
database is not allowed. Founding customers get a two-year price lock; Pro trials are 14 days by
hand; LinkedIn is 2 posts a week; growth budget $0; free channels only. The weekly growth
schedules (scores, prospect contacts) are on. Gates: a free snapshot needs the source and
contact checks; charging also needs checkout, security, legal and data quality.

**The paid report shows "From $300"; banks with no asset size pick their own Pro band.** James,
15:24 to 15:25 UTC 8 Oct, UAT thread, agreeing with the executive and marketing teams' picks on
calls A to E and choosing $300 on the card. Each report is still quoted per institution
(`REPORT_OFFER.fromPriceUsd`). "Free" no longer describes the paid report. For a bank with no
asset size on file, the buyer picks the size band at checkout; the subscription carries
`tier_picked_by_buyer` and the Customers room's "Plans to check" lists it. Assets on file always
set the tier when they exist. Also agreed: a pay-by-invoice option for the report, and the Pro
price picker first on phones (design, waits for James's review).

**Darwin releases are paused, and a released fee counts as right only when the whole record is right.**
James, 21:30 and 21:50 UTC 8 Oct, Darwin thread. He chose "Pause" after the v13 hand check, then
set the standard: name, amount, frequency, who pays and category must all match the bank's
schedule. A fee filed under the right category with the wrong frequency is wrong. On that measure
v13 scored 16 of 20. Darwin's autonomy does not grow until a stronger evaluation passes. That means
about 200 labelled fees across fee types, scored separately for amount, category, payer and
frequency, plus critical errors per 1,000 newly published fees. The 20-fee check is a smoke test,
not the bar. `DARWIN_RELEASE_ACTS` stays false until then. Immediate takedown of a demonstrably
corrupted amount, without the 12-hour second look, still needs his explicit yes.

**Small-metro banks are compared with their state.** James, 21:31 UTC 8 Oct, Marketing thread card:
when a prospect's metro has fewer than 5 verified competitors with an overdraft fee, the first
email compares it with the verified institutions across its state and says so ("across Nebraska").
The same source check and 5-institution minimum apply statewide. Local stays first whenever it has enough.

**Outreach sells research, not a median gap, and every link must work.** James, 22:23 and 22:34 UTC
8 Oct, Marketing thread (feedback, then a full audit grading the campaign C-). Fee Insight does not
advise institutions to change their fees; being above or below a median is not a sales reason; a
statewide group is not a prospect's competitors; every email needs a verified, working destination
that delivers what it promises. The first emails are a 30-prospect pilot in three campaigns: A
research efficiency (no figures, no link), B personalized research (names local institutions, no
figures, no link), C one tier-A comparison with a link checked live. James approves every first
email. This supersedes the 21:31 statewide fallback. The 21 single-fee drafts from run 3157 were held
and are withdrawn by the next run. Plan: https://claude.ai/code/artifact/64c3e9d5-ac6c-431e-a96f-bf16acbf941c

**The Knox decisions queue is retired; admin layout is not design work.** James, 06:50 UTC 9 Oct,
Admin audit fixes thread: "Retire it" and "This is an admin audit so no customer is going to see the
admin." The queue's screens, actions, badge and data-trust state are gone; old links land on
/admin/knox. Its rows stay in agent_messages and knox_overrides (726 of 746 were from the August
import, and an override could never publish because it needed a recent Darwin accept). Admin-only
layout changes are fixes that merge on green; public, Pro and Hamilton screens still wait for his review.

**Build the Agentic OS PRD tooling: Deming for quality, Bayes for replay and recovery.** James,
08:15-08:16 UTC 9 Oct, Agentic OS PRD thread: "we clearly need the extra tooling the prd is asking
for", then picked the names Deming (quality and evaluation) and Bayes (replay and recovery). Order:
Deming's test-case store and takedown-to-regression gate, then Bayes's impact manifest and replay
ledger, then Atlas's truthful status, then the PRD's in-house skills; outside skills are trialled
one at a time and kept only with a measured benefit. Both start as deterministic Atlas steps with
no paid model calls. PRD: /mnt/project-files/plans/agentic-os-prd-v1.md.

**Darwin's recheck archives a failing live fee in the same step, no 12-hour second look.** James,
11:55 UTC 9 Oct, Darwin thread: "stop waiting 12 hours. go", on the `verify.recheck` pass (#928)
that re-reads verified rows under the retired-type, conditional-$0 and name-rule checks. A live
record the recheck fails is rolled back at once with the reason (batch `darwin-recheck-<run>`),
the verified row rejected with the same flag; nothing is deleted and a rollback is reversible.
The takedown spot-check still applies first: the pass flags until UAT has hand-checked 10 of the
rows it would take down and found at least 9 right, then the switch
(`DARWIN_RECHECK_SAME_STEP_TAKEDOWN`) turns on by PR. Hamilton's other takedowns keep their 12-hour
second look unless James says otherwise.

**A fee from the bank's own checking or savings page counts, unless its schedule prices it
differently.** James, 2026-10-13 (builder loop, answering the question on #1026): "Yes: a fee from
the bank's own checking or savings page counts, unless the bank's fee schedule states a different
price for the same fee. Then the schedule wins and the product-page fee comes down." Deming's audit
(v4) counts a product-page fee as a miss only in that case. Hamilton's matching takedown
(`hamilton.product_page_conflict`) starts off, logging first looks, and goes on by PR after a hand
check of 10 flagged conflicts finds at least 9 right. Fees priced per account (monthly maintenance,
minimum balance, paper statements) and categories that hold several items (safe deposit box sizes,
account research, document copies) are not judged until the account or item is matched. Hamilton's
$0 product-page benefit takedown (Oct 9) is unchanged.

**SEO, copy and the website are builder work; Growth stays paused.** James, 2026-10-12 (#1134):
"The biggest thing for me is SEO, and copy, and website." Growth OS stays paused (#1121); the
public site is built by the builder from the review in `docs/plans/public-site-review-2026-10-13.md`.
James, 2026-10-12 evening (builder loop, before leaving for the day): pure technical SEO (sitemap,
metadata plumbing, structured data, no visible wording change) merges on green; copy and page
changes wait as open PRs for him on the Vercel preview; no layout work until he says what his design
updates cover.

**Hamilton's answer check may spend on five paid answers a day.** James, 2026-10-15 (#1079,
decision card "Allow a daily paid sample so Hamilton's answer check can grade written answers,
memos and reports?": "5 a day"). The paid sample (`hamilton/paid-answer-eval.ts`) is capped at five
in code, runs as a provider step under the global provider stop and the memo's budget line, and
never raises its own cap.

**Hamilton shows quarterly changes; choosing an option and watches are removed.** James,
2026-10-15 (#1083, decision card "What should happen to the four Hamilton features built but never
shown to readers?": "Show quarterly changes"). The monthly briefing shows what changed since last
quarter's stored copy. Recording the option management chose (with its plan, dollar effect and
watches) is removed from code, the ledger and the deliverables; the unused deliverables API went in
#1393. The database columns stay, unread.

**A Pro buyer's institution is linked by their business email, not by a claim.** James,
2026-10-15 (#1405): "When you sign up for pro, you say what institution you are at, prove it with a
real email (business email), and that's how we associate the data with Hamilton." There is no claim
for the buyer to file. Pro checkout for a bank or credit union refuses a personal address (Gmail and
the like); the owner seat is granted once the email is confirmed and its host is exactly the bank's
website (`src/lib/pro-institution-link.ts`). Anything else waits for the admin check in the Data
Trust queue while Pro works at once (James, 09:17 UTC, decision card "Hold or block a Pro buyer
whose email doesn't match their bank?": "Hold for review"). Any Pro reader may still research any
institution.

**The accuracy target is 99.5%.** James, 2026-10-15 ("99.5", in reply to the Audit thread on the
#1026 targets). Accuracy is the share of a dated random sample of live fees whose amount and
category match the bank's own document, measured by Deming's audits with `checkFeeAgainstSource`.
The target replaces 95%; the daily grade states it and whether it is met (`ACCURACY_TARGET`,
`src/lib/accuracy-target.ts`).

**The site chrome carries Fee Insight; Hamilton stays out of the header and footer.** James,
2026-10-15, on the compact footer (#1423): "I don't like that Bank. The index is the primary brand
when it's fee insight ... Hamilton never gets displayed in the header or footer but it does have
places where the mark is used which is in-experience." Fee Insight, the parent brand, is the logo in
the header, footer, sign-in screens and report chrome. The Bank Fee Index is named where its data is:
the index pages, data credits and the API attribution. Hamilton's name and mark appear on the pages
that sell it (/for-institutions, /subscribe, Pro buttons in page bodies) and inside the workspace,
never in the header or footer; the header calls it "Pro workspace" and "Pro plans".

**CFPB complaint peer comparisons use verified matches only, or are hidden.** James, 2026-10-15
(decision card "CFPB complaint benchmarks": "Hide"; #1523, under H06 #981). Institutions without an
accepted CFPB identity match are left out of complaint peer groups, since missing evidence is not
zero complaints. When fewer than 10 similar institutions have a verified match even nationwide, the
peer rate is not shown and a coverage note says how many of how many are verified. Keeping the old
numbers with a warning was rejected.

**Routine commands run without a prompt; the hard limits are blocked outright.** James, 2026-10-15
("Add the allow-list to .claude/settings.json"), so threads stop stalling on prompts overnight and
while he travels. `.claude/settings.json` now allows git work on `claude/*` branches, opening,
reviewing and merging PRs, the lint, build, test and guard commands, read-only shell commands, edits
under `src`, `docs`, `growth-os`, `.agents`, `public` and `Reports`, and Vercel preview and log reads.
GitHub issue, PR, review and merge writes are allowed too. Force pushes (including `+` refspecs),
pushes to main (including `refs/heads/main`), remote branch deletion (`--delete`, `-d` and empty-source
`:branch` refspecs), `--all`, `--prune`, `--mirror`, `gh repo delete`,
`gh api` DELETE and `gh pr merge --admin` are denied, so a thread gets an immediate refusal and
keeps working. `apply_migration`, edits under `supabase/migrations/`, Supabase project changes,
production deploys and direct GitHub file commits still ask. Supabase `execute_sql` stays allowed
(Oct 13 decision), so the rule that production data changes never go through raw SQL from a
session still rests on the session, not on a prompt.

**Back-end PRs skip the Vercel preview, and lanes batch their PRs.** James, 2026-10-16 (Hamilton
thread, 03:51 and 04:05 UTC). Open PRs went from under 10 to about 40 in two hours, and each preview
was queueing 30 to 45 minutes. He uses previews only to check how pages look, so a PR that changes
no page merges on green CI without waiting for one. `vercel.json` `ignoreCommand` skips a preview
build when the newest commit changes only `docs`, `supabase`, `src/lib/agents`, `scripts`,
`.github`, `.claude`, `handoff`, Markdown or test files; production builds always run. Each lane
also puts its next several items on one branch and opens one PR, instead of one PR per item.

**The API and Claude connector come with the $300 and $500 Pro plans.** James, 2026-10-16 (API and
MCP planning thread, 05:54 to 14:56 UTC). The $300 and $500 plans, consultants included, get the
API and the Claude connector; the $150 plan gets neither. Each paying subscriber makes their own key
on the account page; it works while Pro is active or inside the past-due grace window, stops when
the subscription ends, and is revoked if the plan moves to $150. No free keys unless James makes one
himself in `/admin/api-keys`; researchers pay like everyone else. No data license (bulk downloads,
republishing) until someone asks. Planning notes: `/mnt/project-files/api-mcp/planning-notes.md`.

**Every team seat on a $300 or $500 plan makes its own API key.** James, 2026-10-17 00:36 UTC
(decision card in the API and MCP planning thread, after his /subscribe review said the payer may be
finance and the user an analyst). The payer and each active seat on their workspace (up to 5
people) make one key each on the account page. All keys draw on the plan's one allowance of 10,000
calls a month. A seat's key stops when the seat is removed, and every key stops when the plan ends.

**The taxonomy may hold 52 types; the public site publishes only the top 50.** James, 2026-10-17
(approving the account research split, #1398). Public pages and API listings that list fee types
show at most 50: the top 50 by institution count, the national index's own order
(`publicFeeTypes` in `src/lib/fee-taxonomy.ts`, applied to the shared public snapshot in
`src/lib/public-stats.ts`). Internal, admin and Pro views keep all 52.

**Hamilton is the paid product; there is no "Hamilton Pro".** James, 2026-10-17 08:27 UTC (Website
thread): "there is no Hamilton and Hamilton pro. Hamilton is 'pro'. Pro is just a term to
distinguish who has paid or not." Visitor copy names the subscription Hamilton ("See Hamilton
plans", "Your Hamilton subscription"), never "Hamilton Pro", "Fee Insight Pro" or "the Pro
workspace". "Pro" may still mark paid status (a Pro badge, `isPro`). The 2026-10-15 rule still
holds: the header and footer name the workspace generically ("Workspace", "Plans").

**Four data fixes switched on.** James, 2026-10-17 10:47 UTC (decision card "Switch on these four
data fixes as recommended?", option "All four"). `CARD_PRODUCT_TAKEDOWN_LIVE` (#1766, guard v70):
62 card-product fees come down after the second look (39 non-network ATM, 22 dormant account, and
Navy Federal 122350 by hand). `COUNT_SHARED_SCHEDULE_ONCE` (#1764, #1441): sister charters that
publish one schedule count once in statistics (126 institution values, 285 rows; no fee moves).
`PAGE_COPY_COLLAPSE_LIVE` (#1764, #1439): 499 live page copies close as "duplicate of #… (copy of
the page)" and 27 kept rows take the fuller name. Knox rules v78 (#1770) ships in its own PR. Each
switch can be turned back off; the page-copy closes undo by clearing `rolled_back_at` on rows whose
reason ends "(copy of the page)".

**ATM surcharge takedowns switched on.** James, 2026-10-17 11:28 UTC (decision card "Take down 28
ATM surcharges that banks charge only non-customers?", option "Take down").
`ATM_SURCHARGE_TAKEDOWN_LIVE` (#1775, guard v71): 28 live non-network ATM rows come down as hand
takedowns: 13 surcharges non-customers pay at the bank's own ATMs (#1772) and 15 lines that are not
the fee (#1773). All 28 were live on the dry read (SELECT-only, 11:35 UTC). Archived, never deleted;
set the switch false to stop, and restore by clearing `rolled_back_at`.

**API docs move with the API.** James, 2026-10-17 11:37 UTC (API & MCP thread): "any update to the
API automatically triggers documentation update." Every route, query parameter and connector tool
must be in the OpenAPI spec and on /api-docs (`src/lib/api-docs-sync.test.ts`), and a PR that
changes API code must bump `API_VERSION` in `src/lib/api-v1.ts`, which the spec and the connector
both report (`scripts/ci-guards.sh api-docs-kill`).

**Three state lanes side by side.** James, 2026-10-17 13:08 UTC (speed audit thread): "Run 3 at a
time." The tick advances up to `PARALLEL_STATE_LANES` (3) lane runs at once
(`executeQueuedAgentRuns`, `src/lib/agents/run-store.ts`); other runs still go one after another.
Lanes take turns at publish steps, which share one database lock. The earlier stop (lanes held the
database, Oct 2026) predates the read fixes in #1793 and #1798. Set the constant to 1 to go back.

**Outreach in three waves of 15 from November 1.** James, 2026-10-17 15:04-15:05 UTC (Sales
thread): "we should Target 15 to over 2 weeks. Let's just say starting maybe November 1st. And then
middle of November we roll out the next and then December 1st we roll out another. And hopefully we
can get four paying clients by the end of the year." Until then "we aren't ready to send": outreach
stays parked. He approved all three ways to reach more buyers (same thread, "All three should be
done"): keep named leaders printed without an address, widen the contact finder to every
comparison-ready institution, and add rural institutions with a statewide comparison. On Oct 17
only 11 of 256 comparison-ready $500M-$2B metro institutions had a decision-maker contact
(`/mnt/project-files/sales/contact-gap-2026-10-17.md`); the three waves need 45.

**Public data gets its own agent, Hoovie, and the data comes first.** James, 2026-10-17 (Public
data loaders thread). At 17:40 UTC: "I think they should have their own agent", and "we need a play
for all data, and easy future connections". At 17:51 UTC: "It's an internal name, so call him
Hoovie", "we need to map it so it's used in the site and in Hamilton", and "Let's get the data first".

Hoovie owns the registry loaders: collect, validate, link, store, roll up, serve and monitor.
Magellan keeps bank fee schedules. The play is one contract per source (`src/lib/agents/hoovie/`),
so that a new connection needs only a contract and a parser.

Work order: first get the data (unblock the failing sources, collect faster, and add a health check
so failures show), then map it into the site and Hamilton. Hoovie is internal only and never appears
to customers.

**No non-commercial data.** James, 2026-10-17 19:11 UTC (Public data loaders thread): "No finra
data. No non-commercial data. Strike it if it violated that." Fee Insight is a paid product, so a
source whose terms allow only non-commercial, academic, personal or research use is never loaded,
held or shown; its loader is removed, not paused. The FINRA Foundation's National Financial
Capability Study (terms: "ONLY for your academic research and publication for non-commercial
purposes") was removed; it had loaded no rows. Every new source's terms are read before its loader
is built.
The same day's licence audit struck these too (loader or part removed; rows already on prod are
left in place and no reader returns them): Nacha ACH volumes (personal, non-commercial use only);
the Kansas City Fed small business lending survey and the Atlanta Fed payment choice tables
(reproduction "not for private gain"); the Fed Small Business Credit Survey (CC BY-NC 4.0); the
frbservices.org FedNow and Fed check pages and the frbservices.org FedACH page (Federal Reserve
Financial Services need written permission for commercial use; FedACH is now read from the Federal
Reserve Board's own page); the Zelle, FedNow and RTP participant lists; the FHLBank advance-rate
pages (several banks say noncommercial informational use only, Chicago needs written permission,
the rest unchecked); the Bank On certified-accounts list ("solely for your own noncommercial use");
CourtListener fee lawsuits (personal, educational or research use); Florida's qualified public
depository list (CFO site: "educational, personal, or training purposes"); and FRED's UMCSENT
(University of Michigan consumer sentiment needs a licence for a sold product). World Bank
Remittance Prices Worldwide is held: its code stays, no partition is scheduled and no reader returns
its rows until James confirms its terms.
Round 2, 2026-10-18 (licence audit addendum,
`api-mcp/loader-notes/licence-audit-2026-10-17.md`): struck the Philadelphia Fed large-bank credit
card series (RCCCBAPRAVGPCTGP, RCCCBBALTOT, RCCCBUTILAVGPCT, RCCCBPMTMINPCT, RCCCBPMTFULLPCT;
"informational, educational, and research purposes only") and Freddie Mac PMMS (MORTGAGE30US,
MORTGAGE15US; freddiemac.com/terms: "may not redistribute ... or commercially exploit Data") from
national-series; the New York (DFS: "for non-commercial purposes"), North Carolina (nc.gov: "for
non-commercial use") and Florida regulator sites from state-reg-news and state-enforcement, so
wire-research no longer reads their posts (New Jersey and the other states stay). Google News press
(state-bill-news) is held: its terms are unread and reported as non-commercial, nothing is
scheduled and no reader returns its rows. Released: World Bank Remittance Prices Worldwide (CC BY
4.0; attribution "The World Bank: Remittance Prices Worldwide") and Urban Institute Debt in America
(ODC-By 1.0; attribution "Braga et al., Debt in America, Urban Institute"), each carrying its
attribution on every stored row and read. Rows already loaded from struck sources stay on prod and
no reader returns them (`src/lib/data-store/struck-sources.ts`).
FRED replaced by the original publishers, 2026-10-18 (James, card answer "Use publishers"): "Same
series, fetched from BLS, Treasury and the Fed Board; FRED is no longer used." FRED's terms bar
commercial use without the St. Louis Fed's written consent and bar storing FRED content in a
database; most series we read through FRED are public-domain federal data. registry-fred now reads
BLS (CPI, unemployment, payrolls, each state's LAUS and CES series), BEA NIPA (real GDP, the GDP
price index, the saving rate; BEA_API_KEY) and the Fed Board's H.15 package (fed funds), keeping our
series ids; national-series reads the Board's H.8 package (Z.1, about 592 MB, not yet), its charge-off and delinquency
table and the SLOOS chart data. Dropped, with no publisher file confirmed: the FDIC national deposit
rates (SNDR, ICNDR, MMNDR, NDR12MCD), the FDIC QBP service-charge series (QBPQYTNIYSRVDP) and
DRCBLACBS. FRED-era rows stay on prod (none deleted) and are retired per series, so a publisher
parser that fails cannot blank a chart: a series keeps showing its FRED-era values until its
first row from the publisher lands, then only publisher rows are served
(`fedIndicatorServedSql`, from `publisher_cutover_at`; `areaRowServedSql`, a national-series key
with a Board row). Struck and dropped series, and series no publisher loads, are hidden at once.
registry-fred names the series "still on FRED-era values" in its step output.

**PRs merge without James; accuracy comes from recorded reviews.** James, 2026-10-18 06:40-06:43 UTC
(project thread "Triage open GitHub issues", after a PR pipeline review that proposed these rules):
"i jsut want the most accurate but autonomous way", "i cant merge every PR how quickly we are
shipping them", then "yes, make the rule change". Page PRs, redesigns included, no longer wait for
his review or typed yes. This replaces the 2026-10-05 entry ("redesigns wait for James's review"),
the Oct 8 Pro price picker's wait for his review, the Oct 9 entry ("public, Pro and Hamilton screens
still wait for his review"), the 2026-10-12 entry ("copy and page changes wait as open PRs"), the
Oct 13 limit ("no lane opens a new copy preview while five are waiting for James"), the Oct 14
design-system rollout's review on the Vercel preview, and the Oct 17 coordinator hold after #1815,
which lived in project memory, not here. A page PR merges when three verdicts are on the PR: the
growthOS review approves its desktop and phone screenshots; an independent reviewer finds no
blockers on the exact head; CI is green. The growthOS review is the page lane's walkthrough of the
screens against the site brief (#1294) in the roles of growth-os/agents/ (NORMAN, DRAPER, ERNEST,
SHERLOCK), posted as a PR comment. James asked for it on 2026-10-15 (project memory: the growthOS
team approves the whole user experience). The #1121 pause covers the growth agents' own marketing
work, not this review. Every merge gets a receipt comment with the head SHA and both review
verdicts, on top of the Oct 14 "Reviewed" rule. Batch to at most one PR per page or area a day. The
day's merges go to him as one digest with screenshots, and he can ask for a revert. GitHub REST
counts for Oct 15 05:00 to Oct 18 06:40 UTC: 318 PRs merged (`pulls?state=closed`, by `merged_at`),
a median of 21 minutes from open to merge, and 1,123 CI workflow runs (`actions/runs?created=...`,
`total_count`). Of 21 merged PRs sampled on Oct 18 (#1883, #1847, #1834, #1804, #1791, #1766, #1752,
#1729, #1700, #1564, #1624, #1647, #1631, #1629, #1589, #1558, #1529, #1506, #1486, #1461, #1429),
15 had no submitted GitHub review, which the Oct 14 "Reviewed" rule requires. Migrations,
production-data changes and the other gated actions in CLAUDE.md still need his yes.

**James's fee checking is one weekly live batch, nothing more.** James, 2026-10-19 03:48-03:49 UTC
(project thread "James's to-do checklist"): "I'm fucking chasing my tail trying to validate individual
fees every fucking day", "I gave you four live batches of data yesterday. How is that not good
enough?", then "I'm happy to do a live batch of a hundred every week, but I don't wanna then be asked
to do ten more." At 03:52 he asked for whatever size is statistically sound, sampled across areas,
sizes and institutions; at 03:53 he rejected a few fees per institution ("We have fifty fees that
we track"), and at 03:54 he set the size at 50 institutions a week. His only recurring check is a
weekly Claude in Chrome live batch of 50 whole institutions, run as five prompts of 10: every
published fee on each page against the bank's own current schedule, plus any of the 50 tracked
categories on the schedule but missing from the page. The 50 are a fresh random draw each week
across big banks, community banks and credit unions and the four Census regions (about 750 fees,
roughly +/-3-4 points at 65% accuracy). The data quality lane supplies the draw and takes every miss
with its error type; James sees the score, not the misses.
That batch is the accuracy measurement against the 99.5% target, and the data
quality lane works from what it finds. No lane asks him to confirm answer
keys, press Confirm on rows, or check more fees by hand on top of it. A person's bank-level Confirm
on an answer key covers every row on it (`feeCheckedBy` in `src/lib/data-store/answer-key.ts`), so
he is never asked to re-press it.
