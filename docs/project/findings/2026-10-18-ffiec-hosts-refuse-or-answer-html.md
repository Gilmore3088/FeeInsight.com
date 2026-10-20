# 2026-10-18: FFIEC hosts refuse production or answer with the form page
**What happened:** Prod state read 2026-10-17 15:15 UTC (#1806). `ubpr-peer-groups` 2026Q2 failed
with "FFIEC returned text/html; charset=utf-8 instead of the UBPR bulk zip" from cdr.ffiec.gov, the
same host the call-report bulk loader downloads from. `nic-structure` and `fr-y9c` failed with HTTP
403 from www.ffiec.gov/npw. Each failure only said the request failed, not what the page wanted or
whether another source exists.
**Cause:** UBPR: not yet known. The product and period are found, but the final Download post
returns the form page; the page itself has never been read (the build sandbox cannot reach
cdr.ffiec.gov either). NIC and Y-9C: www.ffiec.gov refuses production's (Vercel's) requests.
**Fix:** #1806 PR on branch `claude/ubpr-nic-y9c-diagnostics`. UBPR's error now names the page's
title, visible messages and form fields, and posts the Download control the page names (parser v2,
so the failed quarter retries on the next tick). NIC and Y-9C record an empty partition with
`detail.missing_source` naming the host; NIC's says how far the FDIC BankFind RSSDHCR fallback
reaches (direct holding company only), and Y-9C's that there is no official second host. Both are
marked `missingSource` in their Hoovie contracts. The admin Data feeds panel no longer counts those
empty partitions as a pull; it shows the feed as blocked and names the host.
**Lesson:** when a publisher answers with a page instead of a file, record what the page says
before guessing at the form. A host that refuses production is a named gap in the contract and the
partition detail, never a repeated silent failure. Use no proxies or spoofed user agents to get
around it.

**Agent lesson:** hoovie/pr-1934-name-what-host-answered
