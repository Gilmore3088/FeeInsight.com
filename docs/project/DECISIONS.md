# Decisions

Newest first. Each entry: date, what was decided, who, why, and what it means for the work.
Seeded 2026-10-05 from the project's working memory; earlier decisions were not recorded here.

## 2026-10-06

**Every agent gets the same fixed daily health check, compared with yesterday.** James, about
05:40 UTC ("a clear process to break this into manageable chunks that stay consistent so any new
or change is easy to spot"; chose "Build it" on the Atlas audit thread). Each agent's AGENTS.md has
a "Daily health check" table of rules, each tested by one number; `src/lib/agents/agent-health.ts`
reads them read-only with the daily scoreboard step and stores them in
`pipeline_scoreboard_snapshots.detail.agent_health`. The scoreboard step's summary names every
broken rule and every number that moved more than 25% since yesterday. A change to an agent's
selector or behaviour updates its table and the health check in the same PR.

**Hamilton is auditable: every output shows how it was built.** James, 00:08 UTC ("Auditing is
incredibly important... we don't want to hide behind a black box"). Every Briefing, Research view,
scenario and implementation plan carries its provenance: sources with links to the banks' own
schedule documents, data as-of dates, the peer group and its size, assumptions, evidence level,
and each client-given figure with who gave it and when. Saved decisions keep the provenance from
the moment they were made. The same message set out Hamilton's faces (fee verifier and
publisher, research publisher, industry expert, paid-client workspace); the Hamilton agent guide
describes all four. Built in PR 170.

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
