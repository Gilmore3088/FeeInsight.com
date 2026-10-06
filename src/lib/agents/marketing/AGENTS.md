# Hamilton marketing

Hamilton's monthly marketing loop. It owns the Fee Insight marketing emails sent through
MailerLite: planning, writing, A/B testing, scoring and learning. It never sends on its own.

## Run (cron `/api/admin/crew/marketing`, the 1st of each month)

1. `marketing-score` (free): reads every sent campaign named `FI Agent <YYYY-MM> · <format> · ...`
   from MailerLite, scores it (`scoreCampaign`: 0.3 × opens + 2 × clicks − 10 × unsubscribes,
   0 to 100) and upserts one `pipeline_feedback` row per campaign (`kind = campaign_result`,
   `about_strategy = marketing.<format>`). Sends under 100 recipients get weight 0.1. It also
   stores this month's national figures (`kind = market_snapshot`) so next month can say what moved.
2. `marketing-write` (paid, `PROVIDER_STEP_KEYS`, Hamilton's key and budget): `planMonth` picks
   two formats from `MARKETING_FORMATS` that have not run in the last three months, best past
   score first. Facts come only from `fee_index_cache` (national, as the public report shows)
   and `published_fee_catalog` (bank vs credit union and one state, 20+ institutions each).
   The model writes copy and two subjects; tables are rendered from the facts, never by the
   model. Every number in the copy must be in the facts (`unbackedNumbers`), and banned phrases
   ("raise your fee", turnaround promises, the product name outside the footer) reject the
   copy. One retry with the reasons, then the format is reported as not drafted. Each passing
   email becomes an A/B subject-test draft in MailerLite. A month already drafted is skipped.
3. `marketing-states` (free): one state edition per state whose MailerLite group ("Fee Insight ·
   State · XX") has readers. Fixed wording built from the state's medians against the national
   ones (fees with 10+ institutions in the state; 3+ such fees or the state waits), drafted as a
   regular campaign to that state group. Readers pick a state in the footer signup or on the
   confirm page; it rides on `leads.use_case` as `state=XX` and joins them to the state group.
4. `marketing-send` (free): only from `/api/admin/marketing/approve`, when James approves the
   month at `/admin/customers/marketing`. Refused while `MARKETING_MAILING_ADDRESS` is unset.
   Drafts are written whether or not the address is set (the footer leaves that line out, so
   James can review and show them); before each send the step puts the address in the footer.

## Rules

- Nothing sends without James's approval of that month (decision 2026-10-06).
- Never invent a number; never tell an institution to raise a fee; no turnaround promises.
- Header says Fee Insight only; the Bank Fee Index is named once, in the footer.
- Results and lessons live in `pipeline_feedback` only; no new tables.

## Health

- The run on the 1st finishes with both steps completed.
- `marketing-write` drafts both planned formats; a format not drafted is listed with its reason.
- A month's drafts that wait more than 10 days for approval are mentioned in the morning brief
  (not built yet).
