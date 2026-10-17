# Fee Insight email program (MailerLite)

Fee Insight-only lifecycle email. Sends from the Fee Insight MailerLite account
(login hello@bankfeeindex.com). It must never share an account, sender, list or
template with any other brand.

## Files
- `data.mjs`: Bank Fee Index benchmark snapshot (from `published_fee_catalog`).
- `content.mjs`: copy and structure for every email. Every number comes from `data.mjs`.
- `build.mjs`: renders email-safe HTML and plain text into `out/`. Run `node Reports/studio/email-campaigns/build.mjs`.
- `out/index.html`: preview of every email. `out/<automation>/*.html|.txt` are the MailerLite bodies.

## Program (v2, James Oct 17; every automation inactive)
One lifecycle sequence per person. Highest intent wins: Pro customers, then report requests,
then followers, then free research subscribers. The app enforces it (`planLifecycleGroups` in
`src/lib/email/mailerlite.ts`): nobody joins a group while in one of equal or higher intent, and
joining a higher one removes the lower ones. In MailerLite each trigger skips people already in a
higher group (Welcome: Report requests, Watchers, Pro customers; Report requests: Pro customers;
Explorers: Report requests, Pro customers), and "exit when no longer matches" is on, so leaving the
trigger group should end the sequence (set Oct 17, not yet tested).

| Automation | Trigger group | Emails (day) | Sources |
|---|---|---|---|
| Welcome: free research subscribers | Fee Insight · Newsletter | where to find the data (0), one comparison (3), what Hamilton adds (7) | newsletter, capture_national_index |
| Report requests | Fee Insight · Report requests | your report `{$report_url}` (0), a finding from it `{$report_finding}` (4), your institution, from $300 (9) | report_national, report_district, capture_report_sample, capture_homepage |
| Explorers | Fee Insight · Watchers | what you follow `{$follow_url}` (0); then the monthly state or national edition | capture_state, capture_institution |
| Pro onboarding (automation 201539890376082752) | Fee Insight · Pro customers | confirm institution (1), choose peers (2), check a source (4), first report (7), invite colleagues (11) | Stripe webhook on a new active Pro subscription |
| Monthly Fee Pulse (broadcast) | national + state marketing groups | `out/pulse/01-fee-pulse.html` | n/a |

`library/` holds earlier material kept for later: the overdraft/NSF topic email (on request),
the quiet-fees Pulse feature, the benchmark-method guide draft (needs a guide page) and the fee
review kit (needs the worksheet and summary files before it is offered).

### Subscriber fields (set by the app on confirm, `src/lib/email/lifecycle-fields.ts`)
`report_name`, `report_url`, `report_finding` (the report's first key finding, read on confirm),
`follow_name`, `follow_url`. Each must exist as a text field in MailerLite. Every email has a
fallback for a subscriber without them.

## Before activating
1. Sender domain: authenticated (MailerLite reports `needs_domain_auth: false`, checked Oct 6).
2. **Set a real postal address** (CAN-SPAM). The footers leave the line out until then (James, Oct 6:
   waiting on the business registration). Rebuild with `MARKETING_MAILING_ADDRESS="..." node build.mjs`
   and re-upload every email.
3. Exclusion: the app keeps one lifecycle group per person (above); each automation's membership check ends a lower sequence.
4. **Wire the app (Vercel env):** `MAILERLITE_SYNC_ENABLED=true`, `MAILERLITE_API_KEY` from the Fee Insight account,
   `MAILERLITE_GROUP_ID=200322864366224433` (Newsletter), `MAILERLITE_REPORT_GROUP_ID=200322865521755984`
   (Report requests), `MAILERLITE_WATCHER_GROUP_ID=200322866720277972` (Watchers), `MAILERLITE_PRO_GROUP_ID=201539756945835754` (Pro customers). Only people who click the
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
