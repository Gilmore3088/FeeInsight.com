# 2026-10-20: a live fee stays on a page the bank moved away from
**What happened:** #1200 found live fees citing documents months old. #2460 now re-fetches the
pages live fees cite. But when a bank has moved its schedule to another address, re-fetching the
old page brings nothing back, and the live fees kept citing it even though a newer document of
the same bank prints the same line. On prod (read-only, Oct 20), 86 live fees at 17 banks cited a
page with no copy in 30 days while a newer current document had a verified, never-published line
with the same category, amount, audience, product and name. A random 20 of them were checked
against the newer document's stored text, and all 20 were printed there on the fee's own line.
**Cause:** Hamilton skips a line it finds again on a newer document as "Identical fee already
published" (`decidePriorFee`, `hamilton/publish.ts`) and keeps the live fee on its old lineage.
Only `refreshFeesFromCurrentCopy` moves a live fee to a newer document, and it followed only
`superseded_by_id`, which links copies of one address. A page that moved never gets superseded.
**Fix:** this PR. `refresh-copy.ts` also selects documents whose page Magellan's live-source pass
has tried and that still have no copy under 30 days old (`selectMovedPageDocuments`). Their live fees
move in place to the newest current document of the bank read after them that states the same line,
under the same publish rules and once-per-pair attempt record as a superseded copy. Switched on
under the sampled-clean rule. Nothing moves until the live-source pass has tried a page.
**Still open (on #1200):** Synergy FCU's newer document has the same 22 lines, but their audience
is still `unknown` while the live fees are consumer, so they do not pair. Moving them would make the
fees' audience unknown. Partner Colorado, Railway, Bank of Ontario and Self-Reliance have newer
documents that Knox has not read (no fee rows). The current-copy check's retired-document pairing
(`retiredCopiesSql`) still keys on `fee_schedule_url` rather than the address the plain fetch asks
for.
**Lesson:** a fee found again on a newer document should cite the newer document. Following only
newer copies of the same address leaves fees behind whenever a bank moves its schedule.

**Agent lesson:** hamilton/issue-1200-follow-moved-pages
