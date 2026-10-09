# 2026-10-09: Hand-found pages waited behind larger banks in the paid fetch queue
**What happened:** PR 763 added Bridgewater Bank's (276) and Dacotah Bank's (295) checking pages,
found by hand in the Mac browser. Magellan stored both at 01:23 UTC, but the plain companion fetch
got http_403 from both sites. UAT rated the PR missing because neither page produced a document.
**Cause:** a 403 sends a companion page to the paid web fetch, which runs only in Magellan's paid
step and takes two companion pages per step. `selectBlockedCompanions` ordered that queue by asset
size, so 6 and 9 larger banks' blocked pages sat ahead of these two. With a paid step every few
hours, they would have waited most of a day. The `invalid_url` rows from the same minutes were
main-link fetches for banks with no main link, not these pages.
**Fix:** `selectBlockedCompanions` puts pages found by `discover.operator_schedule` first, then
orders the rest by asset size.
**Lesson:** a page a person found and checked is the surest link Magellan has. When it is
blocked, it goes to the front of the paid queue, not into the asset-size line.
