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
  `pr_url` and `score` / `scored_at` (migration `20270110000025`).
- No other tables for marketing results.
