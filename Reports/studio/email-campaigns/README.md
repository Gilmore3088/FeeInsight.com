# Fee Insight email program (MailerLite)

Fee Insight-only lifecycle email. Sends from the Fee Insight MailerLite account
(login hello@bankfeeindex.com). It must never share an account, sender, list or
template with any other brand.

## Files
- `data.mjs`: Bank Fee Index benchmark snapshot (from `published_fee_catalog`).
- `content.mjs`: copy and structure for every email. Every number comes from `data.mjs`.
- `build.mjs`: renders email-safe HTML and plain text into `out/`. Run `node Reports/studio/email-campaigns/build.mjs`.
- `out/index.html`: preview of every email. `out/<automation>/*.html|.txt` are the MailerLite bodies.

## Program (in the MailerLite account, created inactive)
The three automations (Welcome, Report requests, Explorers) carry no figures: every number lives
on the live pages. Only the monthly Pulse campaign quotes numbers, from `data.mjs`, which mirrors
`fee_index_cache` (the table the National report reads). No email states a price for the
institution report.

| Automation | Trigger group | Emails (day) | Lead sources |
|---|---|---|---|
| Fee Insight: Welcome, Fee Literacy series | Fee Insight · Newsletter | cheat sheet (0), overdraft/NSF (2), quiet fees (5), benchmark method (9), review kit + report offer (14) | newsletter, capture_homepage, capture_national_index, website |
| Fee Insight: Report requests (rewritten Oct 6, no figures) | Fee Insight · Report requests | read your free report (0), your state vs national (7), institution report, priced on request (14) | report_national, report_district, report, capture_report_sample (after they confirm) |
| Fee Insight: Explorers | Fee Insight · Watchers | what you'll hear (0), state vs national (4), go further (10) | capture_institution, capture_state |
| Monthly Fee Pulse (regular campaign) | all three groups | `out/pulse/01-fee-pulse.html` | n/a |

## Before activating
1. **Authenticate the sender domain** in MailerLite (Settings → Domains). MailerLite currently rejects the From address as unauthenticated.
2. **Set a real postal address** in `BRAND.mailingAddress` (CAN-SPAM), rebuild, and re-upload.
3. **Add exclusions** in the dashboard: the Welcome series excludes "Report requests", so nobody runs two sequences at once.
4. **Wire the app (Vercel env):** `MAILERLITE_SYNC_ENABLED=true`, `MAILERLITE_API_KEY` from the Fee Insight account,
   `MAILERLITE_GROUP_ID=200322864366224433` (Newsletter), `MAILERLITE_REPORT_GROUP_ID=200322865521755984`
   (Report requests), `MAILERLITE_WATCHER_GROUP_ID=200322866720277972` (Watchers). Only people who click the
   confirm link reach MailerLite (`src/app/api/leads/subscription/route.ts`).
5. Send a test of each automation to yourself, then enable.

## Refreshing the numbers (monthly, before the Pulse)
Read the national figures the public National report shows, so the email and the site agree:

```sql
SELECT fee_category, institution_count, p25_amount, median_amount, p75_amount, computed_at
FROM fee_index_cache ORDER BY fee_category;
```

Paste the rows into `data.mjs` (and its `asOf` date), then rebuild with
`node Reports/studio/email-campaigns/build.mjs`.
