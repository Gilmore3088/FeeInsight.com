# 2026-10-09: A bot challenge on a hand-found fee page was read as a JavaScript page
**What happened:** Arvest Bank (78, $28B) still has no live fees. Its hand-found fee page
(arvest.com/personal/fee-schedule, companion 2452) was fetched on 8 Oct as 928 bytes of HTML,
stored as document 22917 and read blank. Rosetta rejected it as "built by JavaScript... handed
to Magellan's paid finder". Discovery had already judged Arvest's homepage a `bot_challenge`, and
on 5 Oct the paid web search read the real "Schedule of Fees and Charges" at that same address.
**Cause:** the companion fetch only knew one kind of bot wall, a PDF link answered with a web
page. A challenge page at an HTML address was stored as the document. No step picks up the
"handed to Magellan's paid finder" note for a companion page, and the paid finder had already
run for Arvest this month.
**Fix:** the companion fetch checks the page with `looksLikeBotChallenge`, as discovery does
for homepages, and records `blocked_bot` instead of storing it. The paid companion fetch also
takes a hand-found page Rosetta rejected as built by JavaScript, so Arvest's page is asked for
from Anthropic's network on the next paid step. This PR.
**Lesson:** a blank HTML page from a bank that blocks our fetcher is a wall, not a script page.
Check for the wall before storing.
