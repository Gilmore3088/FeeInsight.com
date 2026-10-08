# Growth marketing

Growth's monthly marketing loop (it ran as Hamilton until 2026-10-08; see `../growth/AGENTS.md`). It owns the Fee Insight marketing emails sent through
MailerLite: planning, writing, A/B testing, scoring and learning. It never sends on its own.

## Run (cron `/api/admin/crew/marketing`, the 1st of each month)

1. `marketing-score` (free): reads every sent campaign named `FI Agent <YYYY-MM> · <format> · ...`
   from MailerLite, scores it (`scoreCampaign`: 0.3 × opens + 2 × clicks − 10 × unsubscribes,
   0 to 100) and upserts one `pipeline_feedback` row per campaign (`kind = campaign_result`,
   `about_strategy = marketing.<format>`). Sends under 100 recipients get weight 0.1. It also
   stores this month's national figures (`kind = market_snapshot`); next month the writer gets only
   last month's institution counts, labeled as coverage, never last month's medians (a median
   that differs mostly reflects which institutions were added, not a price move).
2. `marketing-write` (paid, `PROVIDER_STEP_KEYS`, Growth's key and `agent:growth` budget): `planMonth` picks
   one format (`CAMPAIGNS_PER_MONTH`) from `MARKETING_FORMATS` that have not run in the last three months, best past
   score first. National facts come from `getNationalIndexCached` (as the public report shows,
   with its freshness and method-version checks); bank vs credit union and one state come from
   `published_fee_catalog` under the `fee-stats.ts` contract (sourced rows, one value per
   institution), 20+ institutions each.
   The model writes copy and two subjects; tables are rendered from the facts, never by the
   model. Every number in the copy must be in the facts (`unbackedNumbers`), and banned phrases
   ("raise your fee", turnaround promises, the product name outside the footer) reject the
   copy. One retry with the reasons, then the format is reported as not drafted. Each passing
   email becomes an A/B subject-test draft in MailerLite. A month already drafted is skipped.
   The national email goes to the "Fee Insight · Monthly · National" group (readers with no
   state) plus the state groups whose state is too thin for its own edition (`nationalAudience`);
   `MAILERLITE_MARKETING_GROUP_ID` replaces the national group when set (a test list).
3. `marketing-states` (free): one state edition per state whose MailerLite group ("Fee Insight ·
   State · XX") has readers. Fixed wording built from the state's medians against the national
   ones (fees with 10+ institutions in the state; 3+ such fees or the state waits), drafted as a
   regular campaign to that state group. Readers pick a state in the footer signup or on the
   confirm page; it rides on `leads.use_case` as `state=XX` and joins them to the state group.
   The lead sync (`src/lib/email/mailerlite.ts`) keeps each reader in exactly one of: one state
   group, or the national group. So every reader gets one marketing email a month: their state's
   edition, or the national email when they have no state or their state is too thin.
4. `marketing-send` (free): only from `/api/admin/marketing/approve`, when James approves the
   month at `/admin/customers/marketing`. Refused while `MARKETING_MAILING_ADDRESS` is unset.
   Drafts are written whether or not the address is set (the footer leaves that line out, so
   James can review and show them); before each send the step puts the address in the footer.

## What's new

Both emails carry one short "What's new" line above the footer when something reader-facing
went live the month before: a new state edition, a new free report, a new Hamilton feature, or a
methodology change. A PR that ships one adds a dated line to `WHATS_NEW` in `whats-new.ts`. No
figures in those lines (a test enforces it); bug fixes and internal agent work don't qualify.

## Rules

- Nothing sends without James's approval of that month (decision 2026-10-06).
- One marketing email a month per reader (decision 2026-10-06): never draft a second national
  email, and never send the national email to a reader whose state has its own edition.
- Never invent a number; never tell an institution to raise a fee; no turnaround promises.
- Header says Fee Insight only; the Bank Fee Index is named once, in the footer.
- Results and lessons live in `pipeline_feedback` only; no new tables.

## Health

- The run on the 1st finishes with both steps completed.
- `marketing-write` drafts the planned format; a format not drafted is listed with its reason.
- A month's drafts that wait more than 10 days for approval are mentioned in the morning brief
  (not built yet).
