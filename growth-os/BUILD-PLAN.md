# Marketing loop build plan (2026-10-08)

Calls waiting on James:

- 1. Who owns press, events and partners? **New agent BERNAYS (recommended)** / DRAPER and CARNEGIE
- 2. LinkedIn posts a week for you to approve? 2 / **3 (recommended)** / 5
- 3. Where do agents that change code run? **Scheduled Claude Code sessions opening PRs (recommended)** / App only
- 4. Paid model budget for growth? **$5 a day, $60 a month (recommended)** / $10 and $150 / Free steps only
- 5. Follow-up emails after a free report? **3 drafts (recommended)** / Not yet
- 6. Infrastructure (phase 1) before agents (phase 2)? **Yes (recommended)** / Agents first
- 7. File every task below as a GitHub issue? **Yes (recommended)** / Keep it on this page

## Phase 0: Ship and prove the fixes

The errors from the dry run come first, as you asked.

| # | Task | Who | Waits on | Done when |
|---|---|---|---|---|
| 0.1 | Merge PR 476 (team, skills, buyer-path, SEO and caption fixes, "instant" copy) | James | CI green (it is) | Merged |
| 0.2 | Prove the fixes on the live site: paid-report buttons open the institution option, no booking line, "instant" wording, thin pages out of the sitemap, one uppercase state URL | Claude | 0.1 | Sitemap URL count before and after, plus 3 pages checked live |
| 0.3 | Find out whether Search Console is set up: open search.google.com/search-console and look for feeinsight.com | James | none | Yes or no |
| 0.4 | If not set up: add a verification tag through an environment setting, verify, and submit the sitemap | Claude + James | 0.3 | Search Console shows the sitemap as read |
| 0.5 | Source-check the lowest values behind the Kansas City and Boston posts before either is offered to you | Claude | none | Each low value matches the bank's own schedule, or is dropped |
| 0.6 | Fix credit union market counties picking 3 counties in no fixed order | Claude | none | Same counties on repeat runs; test added |
| 0.7 | Check whether any credit union's stored number collides with a bank's FDIC number | Claude | none | Count of collisions, fixed if any |
| 0.8 | Leave institution pages with fewer than 5 fees out of the sitemap (they are already noindexed) | Claude | 0.1 | Sitemap count drops by about 221 |
| 0.9 | Match the /reports closing line to its new button | Claude | 0.1 | Copy matches |
| 0.10 | Previews for you, not built until you approve: the paid option's locked look in the form, a bank path above the homepage fold | Claude, then James | none | Your yes on each preview |
| 0.11 | Your call on Pro pricing: "$5,000/yr per seat" or "up to five teammates" | James | none | One answer |

## Phase 1: Loop infrastructure

One marketing agent on the same run ledger as the data agents, with its own pause, queue, tracking and scoring.

| # | Task | Who | Waits on | Done when |
|---|---|---|---|---|
| 1.1 | Add a growth agent to the agent list, Live board, health checks and run narration | Claude | none | Growth shows on the Live board; tests pass |
| 1.2 | Give growth its own provider key slot and budget line, disabled until you set the cap | Claude | Call 4 | Budget row exists, off |
| 1.3 | Let growth write results and lessons to the shared lesson store | Claude | 1.1 | A test row written and read back |
| 1.4 | A marketing pause separate from the data pipeline pause, with a switch in admin | Claude | 1.1 | Pausing marketing leaves data runs going, and the reverse |
| 1.5 | Growth steps run from the 5-minute tick under the marketing pause only | Claude | 1.4 | A queued growth step finishes while the data pipeline is paused |
| 1.6 | Move the weekly LinkedIn drafts and the monthly email onto the growth agent | Claude | 1.1 | Next runs show agent growth in the ledger |
| 1.7 | Widen the content drafts table into one queue for every agent: agent, kind, skip reason, PR link, score | Claude | 1.1 | Migration applied; existing drafts unchanged |
| 1.8 | An intake route so scheduled Claude Code sessions can file their PRs and drafts into that queue | Claude | 1.7, Call 3 | A test item appears in the queue |
| 1.9 | /admin/growth: one approval page with approve, skip with a reason, edit, mark done, PR links and each agent's runs | Claude, preview to James | 1.7 | Your yes on the preview, then live |
| 1.10 | Record tracked-link visits (source, campaign, page; no personal data) | Claude | none | Visits from a test link counted on prod |
| 1.11 | Save each lead's first tracked source when the form is sent | Claude | 1.10 | New lead rows carry a source |
| 1.12 | Weekly scoring of every output: posts by visits and leads, emails by opens and clicks, PRs by before and after counts | Claude | 1.3, 1.10 | First weekly scores written |
| 1.13 | Your skip reasons become lessons the agent reads next time | Claude | 1.3, 1.9 | A skip shows up in that agent's next brief |
| 1.14 | Put the marketing schedules on the publishing calendar | Claude | 1.6 | Calendar test passes with marketing listed |
| 1.15 | Fix the marketing admin page saying it picks two formats (it picks one) | Claude | none | Copy matches the code |
| 1.16 | Docs: growth agent rules file, team roster in AGENTS.md, decision log | Claude | 1.1 | Merged with 1.1 |

## Phase 2: The agents on the loop

Each agent gets its steps, schedule, checks and score. All drafts land in /admin/growth; code changes come as PRs.

| # | Task | Who | Waits on | Done when |
|---|---|---|---|---|
| 2.1 | DRAPER: weekly plan from the last 8 weeks of scores | Claude | 1.12 | Plan written to the queue each Monday |
| 2.2 | DRAPER: Monday review page from the ledger | Claude | 2.1 | Review published each Monday |
| 2.3 | DRAPER: monthly retro (keep, stop, ask you before adding) | Claude | 2.1 | First retro at month end |
| 2.4 | SHERLOCK: daily market brief; rule changes routed to the regulation tracker | Claude | 1.8 | Brief in the queue each day |
| 2.5 | SHERLOCK: competitor profiles kept current (Moebs, MoneyRates, Curinos and others) | Claude | 2.4 | Profiles file updated monthly |
| 2.6 | MURROW: LinkedIn drafts at your chosen weekly count | Claude | Call 2, 1.6 | That many drafts each Sunday |
| 2.7 | MURROW: every low or high value source-checked before a draft is made | Claude | 0.5 | Guard rejects an unchecked low end in a test |
| 2.8 | MURROW: a use-case post series (pricing committee, board pack, marketing claim check) | Claude | 2.6 | First drafts in the queue |
| 2.9 | ERNEST: "Overdraft fees by state" article from the stats code | Claude | 1.7 | Draft in the queue with every number checked |
| 2.10 | ERNEST: weekly article or page draft | Claude | 2.9 | One per week |
| 2.11 | ERNEST: weekly SEO fix PR | Claude | 1.8 | One PR per week, CI green |
| 2.12 | ERNEST: llms.txt, link previews for state, district and buyer pages, fuller Organization data | Claude | none | Fix PR merged |
| 2.13 | ERNEST: link institution pages to their state and city pages (template change) | Claude, preview to James | none | Your yes, then live |
| 2.14 | ERNEST: Search Console numbers in the weekly score | Claude | 0.4 | Clicks and positions in the scoreboard |
| 2.15 | NORMAN: one conversion fix PR or preview per week | Claude | 1.8 | One per week |
| 2.16 | NORMAN: before and after counts for each fix, 4 weeks later | Claude | 1.11 | Counts reported, no percentages |
| 2.17 | NIELSEN: weekly scoreboard (leads by source, bank and credit union share, quotes, paid, visits) | Claude | 1.11 | Scoreboard in Monday review |
| 2.18 | EDISON: overdraft check tool, spec and preview | Claude, preview to James | none | Your yes |
| 2.19 | EDISON: build the tool on the stats code | Claude | 2.18 | Live, uses tracked |
| 2.20 | CARNEGIE: weekly segment with 5 outreach drafts, each passing the report check first | Claude | 1.9 | 5 drafts a week; you send |
| 2.21 | CARNEGIE: follow-up drafts 7 days after each first email | Claude | 2.20 | Drafts appear on day 7 |
| 2.22 | Follow-up email series after a free report: 3 MailerLite drafts | Claude | Call 5 | Drafts in MailerLite, automations off |
| 2.23 | Press, events and partners: pitch drafts, a quarterly events list, a partner list | Claude | Call 1 | First of each in the queue |
| 2.24 | Pricing and offer framing notes for the paid report and Pro (your decisions stay yours) | Claude | none | Note in the queue |

## Phase 3: Dry run, then go

Nothing turns on until you say go.

| # | Task | Who | Waits on | Done when |
|---|---|---|---|---|
| 3.1 | Two-week dry run of the whole loop on the ledger, nothing sent or posted | Claude | Phases 1 and 2 | Dry-run page with every output |
| 3.2 | Your review of the dry run | James | 3.1 | Go or changes |
| 3.3 | Turn on the schedules | Claude | Your go | First live week runs |
| 3.4 | Prove week one: outputs made, approved, scored | Claude | 3.3 | Counts from the ledger |
