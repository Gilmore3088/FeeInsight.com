# 2026-10-17: moving a fee to another document kept the old document's link

**What happened:** #1744's link check counted 2,086 live dollar fees whose link opened another page
than their own `source_documents.document_url` (2,089 on a later read the same day, read-only).
Classified one by one against every stored document of the 143 institutions involved:

| Group | Fees | What it is |
|---|---|---|
| Same page, written differently | 587 | ":443" in the stored URL, or "%20" stored as a space. `documentLinkKey` did not set these aside. |
| (a) Another stored document of the same institution | 929 | All 929 point at a current copy; none at a superseded one. |
| (b) No stored document matches | 573 | |

Of (a) and (b), 1,453 links are exactly the page the document's stored text was read from
(`agent_source_texts.source_url`): Rosetta reads the schedule PDF a landing page links to, or a
redirect's target, and keeps that address on the text, and Knox copies it to the fee. Those links
are the fee's real source. Pointing them at the landing page would send a visitor to a page with
no prices on it (for example `pncu.com/fee-schedule/` instead of its fee PDF). The other 49 fees
(12 institutions, 13 documents, all imported `migration_v10` rows) had really drifted. Their raw
row had been moved to another document (by the source check's relink of an imported fee, or by the
identical-copy move in `refresh-copy.ts`), and the link at every tier still named the old document.

**Cause:** both moves set `raw_fee_observations.source_document_id` and never touched
`source_url` on the raw, verified or published row. The catalog reads the published row's link
first.

**Fix:** PR on `acct2/source-link-repair` (#1347). Both moves re-link the moved rows at every tier
in the same write (`pointFeeLinksAtDocument`). Every publish step re-points a drifted live link to
its own document when the fee traces in that document's text (`repairLinkDrift`, the shared
check); a fee that does not trace goes through the 12-hour second look and is archived.
`documentLinkKey` now treats a default port and "%20" as the same page, and Deming counts a link to
the read page apart (`read_page`). Dry run on Oct 17: 49 re-pointed, 0 to the second look. The
other 2,040 are left as they are.

**Lesson:** a fee's document has two addresses: the one Magellan stored and the one Rosetta read.
Compare a fee's link with both. Any step that moves a row to another document must move its link
too, in the same write.

**Agent lesson:** gutenberg/pr-1756-link-moves-with-row
