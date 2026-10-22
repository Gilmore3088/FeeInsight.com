# 2026-10-21: Fee schedules flattened to one line were cut off, and the fix reaches stored texts only at large banks

A reader limit that silently stops partway through a document loses whole schedules. Measure it
on frozen sources, and say how the fix reaches the texts already stored.

**What happened:** The shadow lab (#2536) charged 30 of 373 missed answer-key fees to 3 documents
stored as one long line. Texas key 841 is a single line of 100,841 characters, with the fee
schedule at character 97,473, after the account agreement. Knox read 23 fees from it; the schedule's
cashier's check, card replacement, early closure, excess withdrawal, maintenance and overdraft rows
were never read.

**Cause:** Two limits in Knox's line rules (`rules.ts`):
- Knox stops after 150 priced segments a document (`MAX_SEGMENTS_PER_DOCUMENT`). The agreement's
  priced sentences used them all before the schedule began.
- The long-line splitter (`LONG_LINE_BREAK`) closes a dot-leader row only after a price with a
  leading digit. "Temporary checks ....$.40 each" did not close, so it ran into "Cashier’s
  checks ....$4.00" past the 280-character segment limit, and both were dropped.

**Fix:** Knox rules v97 (this PR) raises the cap to 1,000 and closes a row after a cents-only price
and its "each" / "per <unit>". Results:
- Texas gate: 578 -> 590 right, 11 wrong unchanged. Held out: 53 -> 60, 4 wrong unchanged.
- Seven-state gate: unchanged.
- Shadow lab: 902 -> 909 of 1,312 answer-key fees published, with no new failure and no new fee
  outside the keys.

A large bank's page is read again at each rules version. Every other bank's stored text is read
again only below the stale-read floor (v78), so this fix reaches other banks' stored one-line texts
only when that floor moves. That is a separate decision, because it re-reads every older text.

**Lesson:** When a reader has a per-document cap, a miss late in a long document is a cap, not a
rule. Check where the schedule starts before writing a rule for its rows. A rules fix reaches stored
texts at most banks only through the stale-read floor, so the PR should say whether the second wave
needs the floor moved.

**Guard:** `src/lib/agents/knox/rules.test.ts` ("v97: ends a leader row after a cents-only
price..."); the Texas answer-key gate floors (590 / 11, held out 60 / 4); the shadow lab ratchet
(#2537) once merged.
