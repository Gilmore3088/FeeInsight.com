# KPI definitions

Every KPI is read from its source at report time, with the time. If the source can't be read,
the report says "not measured". Nothing is estimated.

| KPI | Definition | Source today |
|---|---|---|
| Qualified institutional visitors | Visits from a bank or credit union network or that open an institution-facing page and then a report or `/for-institutions` | Not measurable yet (needs NIELSEN, Week 3) |
| Free report requests | Free national or district reports opened | `benchmark_report_view` (Vercel Analytics); report leads in `leads` |
| Qualified report requests | Institution report requests from an institution email domain or a named institution, tests excluded | `leads` (needs a qualified flag) |
| Quotes sent | Requests James priced | `leads.quote_sent_at` |
| Paid report orders | Institution reports paid by card | `leads.paid_at` |
| Pro subscriptions | Accounts with an active Pro subscription and a Stripe customer, tests excluded | `users.subscription_status`, `stripe_customer_id` |
| Institution plans | $5,000 a year plans sold | Not built as a separate record yet |
| Agent cost per qualified lead | Team spend in the period divided by qualified report requests | Routine runs carry no API cost; app-side spend under `agent:growth` once it exists |
| Content shipped | Drafts approved and posted, articles live | `content_drafts` status; live pages |

Content shipped is reported last on purpose: it is activity, not an outcome.
