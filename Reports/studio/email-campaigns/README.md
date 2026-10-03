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
| Automation | Trigger group | Emails (day) | Lead sources |
|---|---|---|---|
| Fee Insight: Welcome, Fee Literacy series | Fee Insight · Newsletter | cheat sheet (0), overdraft/NSF (2), quiet fees (5), benchmark method (9), review kit + report offer (14) | newsletter, capture_homepage, capture_national_index, website |
| Fee Insight: Report requests | Fee Insight · Report requests | read your sample (0), 3 findings (3), your own report (7) | capture_report_sample, report |
| Fee Insight: Explorers | Fee Insight · Watchers | what you'll hear (0), state vs national (4), go further (10) | capture_institution, capture_state |
| Monthly Fee Pulse (regular campaign) | all three groups | `out/pulse/01-fee-pulse.html` | n/a |

## Before activating
1. **Authenticate the sender domain** in MailerLite (Settings → Domains). MailerLite currently rejects the From address as unauthenticated.
2. **Set a real postal address** in `BRAND.mailingAddress` (CAN-SPAM), rebuild, and re-upload.
3. **Add exclusions** in the dashboard: the Welcome series excludes "Report requests", so nobody runs two sequences at once.
4. **Wire the app:** `MAILERLITE_API_KEY` must be a key from the Fee Insight account. `MAILERLITE_GROUP_ID` is the Newsletter group; report and watcher sources need routing to their groups (`src/lib/email/mailerlite.ts` sends to a single group today).
5. Send a test of each automation to yourself, then enable.

## Refreshing the numbers (monthly, before the Pulse)
Re-run the benchmark query (one headline amount per institution = lowest non-negative
published amount; percentiles by charter type with a ROLLUP for "all") against
`published_fee_catalog` joined to `institution_sources`. Paste the rows into `data.mjs`,
then rebuild. The query is the `inst_fees` step from `../pull-data.sql`, grouped by
`ROLLUP(charter_type), canonical_fee_key`.
