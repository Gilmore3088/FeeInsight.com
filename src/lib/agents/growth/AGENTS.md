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
| Weekly scores | `/api/admin/crew/growth-score`, **not scheduled** (planned Mondays 13:07 UTC) | `growth-score` | below |

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

**Not turned on.** The route exists and is on the publishing calendar as "not turned on yet";
there is no cron for it in `vercel.json`. Nothing runs on a schedule until James says go. An admin
can start it by hand meanwhile.

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
- No other tables for marketing results.
