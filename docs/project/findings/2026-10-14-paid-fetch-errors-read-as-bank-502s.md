# 2026-10-14: the paid fetch's own refusals look like the bank's 502s
**What happened:** #1051's hand sample (13 Oct) said State Department FCU's `fees.pdf` was
failing with "HTTP 502 or network error since Oct 3". The bank never sent a 502. Its plain
fetches (`fetch.http`) failed with a network error on 3 and 4 Oct. The one paid fetch, on 9 Oct,
came back with `web fetch error: url_not_allowed`, and `responseFromWebFetch` (`blocked-fetch.ts`)
turns any web-fetch error other than `url_not_accessible`, `too_many_requests` and
`unsupported_content_type` into status 502. The bank's `failure_reason` then reads
`magellan_fetch_http_5xx`. Measured read-only on 14 Oct: paid fetches answered
`url_not_allowed` for 20 banks (7 to 10 Oct) and `url_not_accessible` for 20. Among the thin
banks with nothing live and a fetch failure, 12 carry `magellan_fetch_http_5xx` even though
their latest plain fetch was a 403 or a network error.

The same sample said Jonesboro State Bank's `/agreements-and-disclosures` page "links to PDFs".
Its stored copy (115,841 characters, three copies 2 to 13 Oct) is the Internet Banking agreement
printed in full, with no fee-schedule link in its text. Stored text keeps link labels but not
link addresses, so "an index page with PDF links in its stored text" can't be counted from
`agent_source_texts`. Only 6 of the 93 thin banks whose current copy is a disclosures or
agreements page have ".pdf" anywhere in that copy's text.

**Cause:** `failure_reason` and the attempt's `status_code` record the status our code gives the
response. For the paid route, that status is a stand-in for the tool's error. Stored text drops
`href`s by design.

**Fix:** #1051's Magellan PR. The plain fetch's own last outcome (`fetch.http`), not
`failure_reason`, decides which banks get the new free route (`address-variant-fetch.ts`). The
companion finder (version 4) checks every document a disclosures index links to, whatever its
link text says. The 502 mapping itself is unchanged.

**Lesson:** read the `fetch.http` attempt and the paid attempt's `detail.note` before calling a
fetch failure the bank's. To learn what a page links to, open the vault copy or a finder's
`detail.trail`, not the stored text.

**Agent lesson:** magellan/pr-1293-plain-fetch-outcome
