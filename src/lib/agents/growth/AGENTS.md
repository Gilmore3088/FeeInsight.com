# Growth

Growth is the marketing agent. It runs on the same run ledger as the data agents
(`agent_runs`, `agent_run_steps`, `agent_run_events`, agent name `growth`), so every marketing
run, step and result is visible on `/admin`, the Live board and the activity log. It never
writes fee data. James approved it on 2026-10-08 (`growth-os/BUILD-PLAN.md`, phase 1).

## What it runs

| Workflow | Cron | Steps | Rules |
|---|---|---|---|
| Weekly LinkedIn drafts | `/api/admin/crew/content`, Sundays 13:37 UTC | `content-market-spread`, `content-fee-depth` | `../content/AGENTS.md` |
| Monthly marketing email | `/api/admin/crew/marketing`, the 1st at 14:07 UTC | `marketing-score`, `marketing-write` (paid), `marketing-states` | `../marketing/AGENTS.md` |
| Approved send | `/api/admin/marketing/approve` (James only, never cron) | `marketing-send` | `../marketing/AGENTS.md` |
| Queue intake | `POST /api/admin/growth/intake` (cron secret or admin; never a cron) | `growth-intake` | below |
| Weekly scores | `/api/admin/crew/growth-score`, Mondays 13:07 UTC | `growth-score` | below |
| Prospect contacts (NIELSEN) | `/api/admin/crew/contacts?limit=60`, Mondays 12:37 UTC; CSV at `/api/admin/growth/contacts` (admins) | `growth-contacts` | below |
| First-email drafts (CARNEGIE) | `/api/admin/crew/outreach?limit=25`, Mondays 14:07 UTC | `growth-outreach` | below |
| What we learned (DRAPER) | `/api/admin/crew/learning`, Mondays 14:37 UTC | `growth-learning` | below |

### Prospect contacts (`contacts.ts`)

The same walk Magellan makes for fee schedules, aimed at people. For each prospect (assets
$100M to $5B, 10+ live fees, a website; biggest local markets first) it reads robots.txt, the
homepage, and up to three same-site leadership, about or contact pages, as `FeeInsightBot
(Growth)`. It keeps only addresses the institution publishes under its own domain, with the name
and title printed just before each one. Nothing is guessed from a name pattern, and nothing
sends: the contacts feed outreach drafts James sends himself. Rechecks after 30 days.

Each contact has a confidence (`contactConfidence`): high for a named person with a title in a
buying role, medium for a person's own address with a name or title, low for anything else or a
shared mailbox. `rankContacts` orders an institution's contacts (confidence, then marketing,
retail, executive, finance); the CSV marks the first as primary and the second as backup.

### First-email drafts (`outreach.ts`, `market-snapshot.ts`)

One draft per prospect ($500M to $2B first, then $100M to $500M) in James's template (15:39 UTC
Oct 8), linking to the prospect's free market snapshot at `/institution/<id>/market`. The
snapshot compares the institution's fees with the open institutions in its CBSA. A value counts
as verified only when every catalog row behind it passes `checkFeeAgainstSource`; anything else
is labeled unverified and left out of the local median, which needs `MIN_INSTITUTIONS_FOR_MEDIAN`
verified institutions. No draft is made when the prospect has no medium- or high-confidence
contact, its own overdraft fee doesn't verify, or too few competitors verify. Under the email
each draft carries an audit block (the schedule line and link behind every figure, the rows'
conditions, the peers left out) so James checks each comparison before he sends it himself.
Every draft ends with a postal-address placeholder James fills before sending (CAN-SPAM; the
site's mailing address stays blank) and an opt-out line. The same step drafts the plan's one
day-7 follow-up (`runOutreachFollowUps`) for each first email marked sent at least 7 days ago
with nothing recorded since: same link, no new figures, once per institution. Contacts are
re-read with today's rules (`normalizeContact`): lenders, branch staff and a vice president's
rank are not buyers, and labels printed where a name would be are not names. Nothing sends.

### The outreach journey (`src/lib/outreach-journey.ts`)

Five stages per institution (James, 15:39 Oct 8): email sent, snapshot opened, engaged with the
data, commercial interest, purchase. The snapshot page records first-party events
(`snapshot_events` via `POST /api/track/snapshot`: opened, source, fee, competitor, report click;
no personal data). Marking an outreach draft done records "sent"; James records what happened
next (replied, conversation, report requested, proposal, bought, declined with the reason) on the
done item in `/admin/growth` (`outreach_outcomes`). No email-open tracking. The team view shows
the funnel.

### What we learned (`learning.ts`)

DRAPER's weekly report (James, 15:33 Oct 8) for the Monday-to-Monday week just ended: outreach
drafted and sent, snapshot events, leads from outreach links, the outcomes James recorded with
his notes, every decline reason to date, and the plan's sales metrics to date (qualified
conversations per 100 contacts, share reaching a proposal, proposal to paid, median days from
email to purchase) against the month-one floor. Counts and James's own notes only; a metric with
no data says so. It lands in the queue as DRAPER's `brief` (channel `internal`), once per week.

### Queue intake (`intake.ts`)

A scheduled Claude Code session files a draft or a PR it opened with
`POST /api/admin/growth/intake` and the cron secret (`Authorization: Bearer $CRON_SECRET`):
`{ "agent", "kind", "title", "body", "pr_url"?, "subject_key"? }`.

- `agent` is one of the marketing agents (`GROWTH_AGENTS` in `roster.ts`); `kind` is one of
  `QUEUE_KINDS` (a `pull_request` needs its `pr_url`, a GitHub PR link).
- No personal data: those are the only fields (anything else is refused), and a title or body
  naming an email address outside our own domains (`CONTACT_EMAIL`'s and `SITE_DOMAIN` in
  `src/lib/constants.ts`) is refused.
- Each filing is a growth run with one `growth-intake` step, so it is on the run ledger and held
  by the marketing pause (the run stays queued and files when marketing is turned back on).
- The item lands in `content_drafts` as a draft (`workflow` `intake:<agent>`, `facts.source`
  `intake`, no card). The same agent, kind and subject filed again within 30 days is not queued
  twice.

### Weekly scores (`score.ts`)

The `growth-score` step scores each posted item with no score whose post date is at least 7
days old, over the 7 days after posting: tracked visits from `marketing_touches` (same
`utm_campaign` and `utm_content` as its link) and leads whose `first_utm_*` match. The score is
the visit count; leads sit beside it in the step result. Emails (opens and clicks are not read
into the app for queue items), PRs (no before-and-after count yet, BUILD-PLAN 2.16) and items with
no tagged link get no score: `scored_at` is set, `score` stays null, and the reason is in that
step's event. Nothing is estimated.

James turned the weekly schedules on (15:33 UTC Oct 8): scores and prospect contacts run each
Monday from `vercel.json`. Both are free steps; neither posts nor sends anything.

### Lessons from skip reasons (`lessons.ts`)

Skipping a queue item with a reason at `/admin/customers/content` writes a `pipeline_feedback`
row: `reported_by` growth, `about_stage` marketing, `about_strategy` the item's agent, signal
`wrong`, kind `skipped_by_james`, dedupe key `growth.skip:draft:<id>`. Sending it back to review
marks it `restored`. `recentLessons(db, agent)` returns the standing ones (90 days, newest 10):
the weekly content steps read MURROW's before drafting and list them in their step result, and a
scheduled session reads its own with `GET /api/admin/growth/intake?agent=<name>`.

These runs moved from Hamilton to growth on 2026-10-08. Their idempotency keys
(`hamilton:content:<day>`, `hamilton:marketing:<month>`, `hamilton:marketing-send:<month>`) and
`triggered_by` values (`hamilton.content`, `hamilton.marketing`) keep their old names, so a day or
month already run under Hamilton is not run or sent again.

## The approval page

`/admin/growth` (Customers room) is the one page for the whole queue: items grouped by status
(to review, approved, done, skipped), filterable by agent and kind, with approve, skip with a
reason, edit title and text (drafts only), mark done, and the PR link. It reuses the server
actions in `src/app/admin/customers/content/actions.ts`. Each roster agent has a section with its
newest growth steps from the run ledger and its standing lessons; a step is credited to an agent
only when its run or intake item names it, or it is a `content-*` step (MURROW). The monthly
email and the weekly scoring show under "Team work". The marketing pause and the `agent:growth`
budget row are shown read-only (`src/lib/data-store/growth-board.ts`).

## Nothing sends or posts on its own

- Content drafts wait in `content_drafts` (`/admin/customers/content`). James approves a draft,
  posts it on the company page himself, then marks it posted.
- Marketing emails are MailerLite drafts. Only `marketing-send`, started when James approves the
  month at `/admin/customers/marketing`, sends anything.

## The marketing pause

`automation_control` row `marketing` (`getMarketingControl` / `setMarketingEnabled` in
`src/lib/automation-control.ts`; a missing row means enabled). It is separate from the pipeline
pause:

- Growth's step keys (`MARKETING_STEP_KEYS` in `../types.ts`) obey the marketing control only.
  Every other step obeys the pipeline control, except the reporting steps in
  `PAUSE_EXEMPT_STEP_KEYS`.
- Pausing marketing leaves data runs going; pausing the pipeline leaves marketing runs going. The
  5-minute tick drains whichever side is running (`heldByPause`, and the `paused` option of
  `executeQueuedAgentRuns`). With the pipeline paused it schedules no new data runs.
- A held run stays queued and resumes on its own when its control is turned back on.
- The switch is the "Pause marketing" button beside "Pause pipeline" on `/admin`,
  `/admin/controls` and `/admin/atlas/details`. Each change writes an
  `automation_control_audit` row (`marketing_pause` / `marketing_resume`).

The provider (`global`) stop still blocks growth's paid step, `marketing-write`.

## Budget and key

- Paid calls go through `paidModelCall` with agent `growth`, so they bill
  `ANTHROPIC_API_KEY_GROWTH` (falling back to the shared `ANTHROPIC_API_KEY`) and count against the
  `agent:growth` budget policy.
- `agent:growth` caps: $5 a day and $60 a month (James, 2026-10-08). The row is seeded disabled
  (migration `20270110000023_growth_agent.sql`). Until James enables it, `marketing-write` makes
  no model call: the step completes and lists the month's format as not drafted, with the budget
  reason. The free steps still run.
- The daily agent health check reports growth's failed steps and its spend against the daily cap.

## Where results go

- Judgements and lessons go to the shared learning store, `pipeline_feedback`
  (`../learning/feedback.ts`). Growth may report as `growth` and judge `about_stage = 'marketing'`
  (migration `20270110000024`). The monthly email's existing rows still report as `hamilton`
  with their `hamilton.marketing:*` dedupe keys.
- Drafts from every growth agent go to `content_drafts`, one queue: each row has `agent` (default
  `murrow`), `kind` (default `linkedin_post`), and can carry `skip_reason` (from the Skip form),
  `pr_url` and `score` / `scored_at` (migration `20270110000025`). Scheduled sessions file into
  it through the intake route above.
- Prospect contacts go to `prospect_contacts` and `prospect_contact_checks` (migration
  `20270110000028`).
- Snapshot page events go to `snapshot_events`, and outreach outcomes to `outreach_outcomes`
  (migration `20270110000029`).
- No other tables for marketing results.
