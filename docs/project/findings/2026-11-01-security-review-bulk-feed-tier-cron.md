# 2026-11-01: a Pro key could copy the whole fee catalog; checkout tier and cron secret gaps

**What happened:** a security review of `main` (thread "Run a security review", James's /security-review)
found no high-severity issue, and three gaps:
- `GET /api/v1/institutions?view=fees` (200 rows a page, no filter required) and `/api/v1/rate-fees`
  let any Hamilton key page through every published fee, and `updated_since` kept the copy current.
  About 500 calls, well inside the 10,000-a-month allowance, rebuilt the cleaned catalog. Looping
  `?id=` over every institution, or paging a fee ranking, did the same. This broke the "never allow
  bulk download of the cleaned database" rule.
- Checkout prices Pro by the bank the buyer picks. "Plans to check" already flagged an email that did
  not match the picked bank's website, but not a buyer on the other-organization plan, and it never
  named the buyer's own (larger) bank.
- `BFI_REVALIDATE_TOKEN`, meant only for `/api/revalidate`, was also accepted as a cron secret, so a
  leaked page-refresh token could start agent ticks, outreach and digests.

**Cause:** the API grew a sync feed for partners (`view=fees`) under the same paid check as Hamilton keys,
and nothing counted how many institutions one key read. The cron secret kept a legacy fallback.

**Fix:** `src/lib/api-v1-bulk-guard.ts`. Fee rows across every institution are for Enterprise keys only
(`enterprise_required`); a Hamilton key or Pro session reads fees for up to 250 different institutions a
calendar month (`institution_limit`, counted from `usage_events`, institutions already read stay open);
a fee ranking stops at its first 50 rows below Enterprise. The plan watch list names the buyer's own bank by
email domain when it is priced above the plan paid for, including the other-organization plan. Checkout
still blocks nothing (James, 8 Oct 2026). `matchesConfiguredCronSecret` accepts only `CRON_SECRET` and
`REPORT_CRON_SECRET`; Hamilton's report call sends one of those.

**Not changed:** public institution pages still put every fee in the HTML and the sitemap lists every
institution, a search-ranking choice that is James's to make.

**Guard:** `src/lib/api-v1-bulk-guard.test.ts`, `src/app/api/v1/institutions/route.test.ts`,
`src/lib/pro-plan-watch.test.ts`, `src/lib/cron-secret.test.ts`
