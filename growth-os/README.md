# Fee Insight GrowthOS

The marketing team: one manager and six specialists that find banks and credit unions who need
fee benchmarking, earn their trust with sourced research, and turn interest into report requests
and Pro customers. Proposed by James on 2026-10-08; built in weekly stages.

The scoreboard is revenue, not content: qualified institutional visitors, report requests,
paid reports, Pro and institution plans, and agent cost per qualified lead
(`metrics/kpi-definitions.md`).

## The team

| Agent | Named after | Role | Status |
|---|---|---|---|
| DRAPER | Don Draper, the ad agency creative director in Mad Men | Chief marketing officer: priorities, assignments, review, weekly growth report | Defined, dry run only |
| SHERLOCK | Sherlock Holmes: finds evidence | Market intelligence: competitors, industry research, buyer questions | Defined, dry run only |
| ERNEST | Ernest Hemingway: short, plain sentences | Content and SEO | Week 2, not active |
| NORMAN | Don Norman, who coined "user experience" | Conversion and UX | Week 2, not active |
| NIELSEN | Nielsen, the audience measurement company | Growth analytics | Week 3, not active |
| EDISON | Thomas Edison: builds working things | Product-led growth tools | Week 3, not active |
| CARNEGIE | Dale Carnegie, How to Win Friends and Influence People | B2B outreach drafts | Week 4, not active |

Each name says the job. The manager is not ATLAS, as in the proposal: Atlas is already the pipeline's run orchestrator
(`AGENTS.md`). The pipeline team (Atlas, Magellan, Rosetta, Knox, Darwin, Hamilton) produces the
data; this team markets it and never writes fee data.

GUARD, the verification step, exists from day one as a rule rather than an agent:
`context/editorial-policy.md`.

## How it runs

- **Runtime:** scheduled Claude Code sessions (routines) on this repository. Each run reads this
  folder and `.agents/product-marketing.md`, loads the skills its agent definition allows, and
  writes its output as GitHub issues (the work queue) or a draft PR. The app's Vercel runtime
  has no GitHub access, and the team's whole output is issues and PRs, so this is the one place
  it can do its job. Production numbers come from read-only queries on prod.
- **Content that ships through the app** (LinkedIn drafts, monthly email) keeps using the
  existing workflows: `src/lib/agents/content/` (W1 to W8, the `content_drafts` queue at
  `/admin/customers/content`, the `unbackedNumbers` number guard) and
  `src/lib/agents/marketing/` (the monthly MailerLite drafts). GrowthOS plans and requests
  that work; it does not build a second content pipeline.
- **If a team step ever runs inside the app** (a paid model call from a cron), it bills to its
  own key slot, `ANTHROPIC_API_KEY_GROWTH`, added to `PROVIDER_AGENTS` in `src/lib/ai-provider.ts`
  in that PR, with a `agent:growth` budget policy inside the global $75/day, $500/month cap.
  Proposed cap: $5/day, $60/month. Nothing needs it in Week 1.
- **Schedule:** nothing runs on a schedule until James says go. Proposed cadence once live:
  SHERLOCK daily discovery (Mon to Fri) with a weekly findings issue; DRAPER daily triage of the
  queue and a Monday growth report.

## Autonomy

| Level | What | Who decides |
|---|---|---|---|
| Automatic | Research, analytics reads, internal reports, drafts, GitHub issues in the queue | The agent |
| Review required | Site changes, articles, offer wording, merging any PR | James merges (design work waits for his preview) |
| Explicit authorization | Any email or post to anyone outside, ad spend, pricing, fee data | James, in his own words, each time |

Outreach and social clips are held. MailerLite automations stay off. Never touch the AiBI
account (hello@aibankinginstitute.com).

## Files

- `agents/`: one definition per agent (objective, skills, tools, triggers, deliverables, stop rules).
- `context/editorial-policy.md`: the GUARD rules every public claim passes.
- `workflows/`: the work queue, daily intelligence and weekly growth review.
- `metrics/`: KPI definitions and the analytics inventory.
- `runs/`: dry-run outputs, kept so James can see what a run produces before it is scheduled.
- `SECURITY-REVIEW.md`: the scan of the copied skills and the rules that override them.
- `SKILLS.md`: which skills were copied from the Marketing Skills library, under its MIT license.
- `.agents/product-marketing.md`: the shared context every skill reads first.

## Build order

1. Week 1 (this folder): skills, context, DRAPER and SHERLOCK, analytics inventory, work queue. Dry run.
2. Week 2: ERNEST and NORMAN; SEO and conversion-path audits; first sourced article PR.
3. Week 3: NIELSEN and EDISON; qualified-lead and purchase events; an overdraft scenario tool.
4. Week 4: CARNEGIE drafts for one segment; review funnel and operating cost; decide what can be
   more autonomous.
