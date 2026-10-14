# 2026-10-09: Real fee moves were held because the bank published a new edition at a new URL
**What happened:** From Oct 7 to Oct 9, 2026, no `hamilton_fee_movement_detected` signal fired. The change rule held 13 movements in `hamilton_publication_completed.source_json.unconfirmed_movements`. All 13 paired two different URLs (read-only query of `hamilton_signals`, Oct 9).
- 8 paired a business schedule with the consumer one (Hoosier Hills, Directions, MutualOne, McClain, FFL).
- 5 were Jeanne D'Arc's changes notice read in its "fee through July 31" column, so each "decrease" was the old price.
- 1 was Tyndall's two schedules, which state the same effective date.
- 2 were real: UMassFive moved its business fee page and published a 2026 edition (levy $30 to $40, outgoing domestic wire $20 to $25).

**Cause:** `confirmFeeChange` required the exact same URL (`urlIdentity`). Publish, by contrast, flags like for like by `feePageKey`, which ignores dates and version words in a URL. A bank that publishes a new edition as "Fee-Schedule-2026.pdf", or moves the page, therefore never confirmed.

**Fix:** `src/lib/agents/hamilton/schedule-edition.ts` gives one rule that the change rule, the change log's like-for-like flag, the pairing pass and the movement check all share. Two schedules count as the same when they are on the same page (`feePageKey`). On different pages they count as the same only when both URLs name the same audience and the new text states a later effective date. The 11 non-changes stay held.

**Lesson:** A same-page check written as exact URL equality misses exactly how banks publish changes: a new file at a new URL. Before tightening or loosening a change rule, run it against the held movements on prod.
