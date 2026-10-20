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
`report_finding_title` and `report_finding_cta` (set only with a finding; without them report email 2
reads "How to read your fee report" / "Open your report"), `follow_name`, `follow_url`. Each must exist as a text field in MailerLite. Every email has a
fallback for a subscriber without them.

`monthly_offer_text`, `monthly_offer_cta`, `monthly_offer_url` are set only for Pro customers
(`syncProCustomerToMailerLite`, `src/lib/email/monthly-offer.ts`). The monthly edition's report
offer is written as these merge fields with the free wording as defaults, so a Pro customer keeps
the monthly digest and reads a Hamilton line instead of the report upsell.

### Routing tests
`src/lib/email/lifecycle-routing.test.ts` runs the cases James listed (Oct 17) against a stateful
fake MailerLite: free subscriber requests a report; report subscriber becomes Pro; duplicate
confirm and duplicate Stripe activation; finding unavailable; Pro customer keeps the monthly
digest with no report offer; an unsubscribed Pro customer stays unsubscribed. Not covered in code:
what MailerLite does with emails already queued when someone leaves a group mid-sequence
(`exit_when_no_longer_matches`). That needs one automation switched on for test addresses James
names, and waits for his typed yes.

## Before activating
1. Sender domain: authenticated (MailerLite reports `needs_domain_auth: false`, checked Oct 6).
2. Postal address (CAN-SPAM): every footer carries Fee Insight LLC's Spokane address, the same one as
   the MailerLite account footer (`MAILING_ADDRESS` in `src/lib/constants.ts`). `MARKETING_MAILING_ADDRESS`
   overrides it; rebuild and re-upload every email if it changes.
   Plain text: upload each `out/<automation>/*.short.txt` (whole message and button, under MailerLite's
   1,000-character cap). Campaign plain text (the Pulse) is pasted in the dashboard.
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
