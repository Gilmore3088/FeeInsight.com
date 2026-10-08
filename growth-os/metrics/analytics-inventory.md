# Analytics inventory (2026-10-08)

What is measured today, checked in the code and on prod at 02:32 UTC on 2026-10-08.

## Web analytics

- **Vercel Analytics is the only web analytics.** `<Analytics />` mounts in `src/app/layout.tsx`
  on Vercel. Custom events go through `trackEvent` (`src/lib/analytics.ts`, 24 browser events)
  and `trackServerEvent` (`src/lib/analytics-server.ts`: `pro_activated`,
  `hamilton_first_question`, `hamilton_first_report`).
- **GA4: not wired.** No gtag, Tag Manager or measurement ID anywhere in the code.
- **Search Console: no sign in the code.** No verification meta tag and no Google verification
  file in `public/`. It could still be verified by DNS, which the code can't show; James would
  know. `robots.ts` points crawlers at `/sitemap.xml`.
- **Not checked:** whether the Vercel plan records custom events (they need a paid Vercel plan)
  and what the Vercel dashboard shows. The cloud session can't reach vercel.com.

## Conversion events in the code

| Funnel step | Event | Fires |
|---|---|---|
| Free report opened | `benchmark_report_view` | Browser |
| Report request clicked / submitted | `request_report_click`, `request_report` (after the server accepts it) | Browser |
| Lead capture | `lead_capture_view`, `_submit`, `_success`, `_error` | Browser |
| Newsletter | `newsletter_signup` | Browser |
| Fee alerts | `fee_alert_signup`, `fee_alert_save`, `fee_alert_remove` | Browser |
| Account | `create_account` | Browser |
| Paid report | `report_pay_view`, `report_pay_complete` | Browser |
| Pro | `checkout_start`, `checkout_complete`, `upgrade_click`, `pro_activated` | Browser, server |
| Pro use | `hamilton_first_question`, `hamilton_first_report` | Server |
| Contact | `contact_sales` | Browser |

`book_walkthrough` still fires from "Book a 20-minute walkthrough" on `/subscribe`
(`src/app/subscribe/pricing-sections.tsx`). The link goes to `/contact`, but the wording is a
booking offer, which James retired; see the dry run.

## The same funnel in our own tables (prod, 02:32 UTC)

These are the counts SIGNAL can read without any analytics vendor.

| Measure | Source | Count |
|---|---|---|
| Lead rows ever | `leads` | 14 (8 created in the last 30 days) |
| Report request leads in the last 30 days | `leads.source` contains `report` | 6 |
| Quotes sent | `leads.quote_sent_at` | 0 |
| Paid institution reports | `leads.paid_at` | 0 |
| User accounts | `users` | 17 (1 created in the last 30 days) |
| Accounts marked Pro active | `users.subscription_status = 'active'` | 10, of which 3 have a Stripe customer |

How many of these are James's own tests is not known; the earlier revenue review judged most
active Pro accounts to be comp or test accounts. Revenue measured: $0.

## What SIGNAL needs (Week 3)

1. A "qualified" flag on a lead: institution email domain or a named institution, not a test.
2. A way to read Vercel Analytics events from a run, or a decision to count the funnel from our
   own tables only.
3. James's answer on Search Console. If it isn't verified, verifying by DNS is free and gives
   search impressions per page; that is the only search data we would have.
