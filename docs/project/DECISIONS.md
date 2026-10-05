# Decisions

Newest first. Each entry: date, what was decided, who, why, and what it means for the work.
Seeded 2026-10-05 from the project's working memory; earlier decisions were not recorded here.

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
