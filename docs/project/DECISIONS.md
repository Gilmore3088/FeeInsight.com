# Decisions

Newest first. Each entry: date, what was decided, who, why, and what it means for the work.
Seeded 2026-10-05 from the project's working memory; earlier decisions were not recorded here.

## 2026-10-06

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

**Magellan's upgrade plan runs in full; its fee-page classifier learns continuously and starts in
shadow.** James, 05:41 UTC, on the Magellan Upgrade Plan
(https://claude.ai/code/artifact/12c7e165-b7af-4aee-a356-cc0c4f5c15a8): tighten the main-link
check and re-search (agreed), a $250 paid-find trial (yes), classifier weights kept in a table that
a Magellan run step retrains ("Yes. Consistently reinforced"), no further plan upgrades, and the
thread runs it. The classifier (`magellan_page_classifier`) only records its opinion until James
reviews it; letting it decide is his call.

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
