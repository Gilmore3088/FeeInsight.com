# 2026-10-09: Banks whose sites refuse the connection never reached the paid fetch
**What happened:** Centennial Bank (98, $24.6B, Arkansas) ranked fourth on the market-gap list
with no live fees. Its schedule link, my100bank.com's CEN-SOF.pdf, failed with `network_error`
four times between 3 and 7 Oct 2026, and Magellan has not fetched it since.
**Cause:** `selectBlockedLinks` sends a main link to the paid web fetch only when the plain fetch
was refused (`http_403`) or timed out twice in a row. A refused connection (`network_error`) is the
same wall seen from another side, but it was left out. 19 active banks sat there, none with live fees.
**Fix:** two `network_error` failures in a row count the same as two timeouts.
**Lesson:** when a list of blocked outcomes sends work to a fallback, check the outcomes it leaves
out against the banks stuck on them before calling the list complete.
