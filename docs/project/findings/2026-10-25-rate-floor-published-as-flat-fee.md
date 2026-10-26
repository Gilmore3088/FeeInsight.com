# 2026-10-25: the floor of a percentage charge was published as a flat fee

**Lesson:** "$5.00 or 3% of each cash advance, whichever is greater" costs the percentage; the
dollar figure is the least the charge can be. Read it as the rate with the figure as its
`rate_min_amount`, never as a flat fee. The figure traces to the page, so the shared source check
alone could never catch it: the reading rule has to.

**What happened (#1615):** Knox's specialists read the first dollar figure on a line as the fee's
price. On a greater-of line that figure is the floor. Patriot FCU's "Late payment fees of 5% of the
monthly payment or $35.00 whichever is greater may apply" went live as a flat $35 twice (144352,
114273, taken down by hand in #1613) beside its own rate fee 114271. On Oct 25, 58 live flat fees
had a stored line with greater-of wording and a percentage; 53 of them, at 48 institutions, are such
floors: cash advance fees ("Cash Advance | Either $5.00 or 3% of the amount of each cash advance,
whichever is greater"), check cashing ("Non-member Check Cashing | $35.00 or 10.00% whichever is
greater"), loan late fees ("Loan Late Payment | $15 or 5% of payment due, whichever is greater"),
coin counting and a few others. Only 2 sat beside a live rate fee at the same percentage. Knox's rate
reader (`rateFeeFromHeld`) already read a floor, but only when the dollar figure came after the rate,
and nothing stopped the specialists' flat read of the same line.

**Cause:** no rule told a floor from a price. The flat read was admitted at extraction and passed
every later check because its figure is on the page.

**Fix:**
- `src/lib/rate-floor.ts` (`rateFloorOf`) decides: the fee's own figure joined by "or" to a
  percentage, with "whichever is greater/higher/more" in the same clause or "greater of" before it.
  The figure is the fee's own: the first at its amount after the fee's name, so another fee's floor on
  the same line ("ATM NSF Fee + | $29.50 | - 2% of each transfer or $20.00 whichever is greater" keeps
  its $29.50; "Cash advance $10 or 3%, whichever is greater | Overdraft $10" keeps the overdraft's
  $10) keeps the read. A lesser-of phrase or a sentence end before the greater-of words also keeps it.
- Knox v118 holds such a read as the percentage, so the rate pass files the rate fee with the floor
  as `rate_min_amount` where the category publishes rates, and keeps it held elsewhere.
  `rateFeeFromHeld` now reads a "$Y or X%" floor (or lesser-of cap) stated before the rate.
- Darwin's `rate-floor-check.ts` re-checks live flat fees with the same rule and reports whether the
  rate fee is live. Its switch (`RATE_FLOOR_TAKEDOWN_LIVE`) is off until a sample is read clean
  (sampled-clean rule, DECISIONS 2026-10-20); a takedown never adds a rate fee, which comes from
  Knox's v118 re-read of the bank's text.

**Dry run (prod, read-only, Oct 25):** the check's prefilter selects 58 live flat fees at 53
institutions; 53 at 48 institutions are floors, 2 beside the live rate fee (13406, 68415). Kept:
20404, 53988, 83788 and 132118 (another fee's floor on the line). Missed: 80150 is a floor (stored
text 242, "C a sh Adva nce. ......$5.00 or 2% whichever is great er"), missed for a misaligned
excerpt and spaced OCR text. The rows are in `src/lib/agents/darwin/__fixtures__/rate-floor-live-2026-10-25.json`.
The Knox answer-key gates are unchanged.

**Not covered:** a floor Knox stored with a misaligned excerpt whose text is spaced by OCR ("great
er", 80150), and the categories that publish no rates (legal process, loan payment by
card): their rate stays held for review rather than published.

**Guard:** `src/lib/rate-floor.test.ts`, `src/lib/agents/knox/rate-floor-read.test.ts`,
`src/lib/agents/darwin/rate-floor-check.test.ts`. **Agent lesson:**
knox/issue-1615-rate-floor-is-no-flat-fee, darwin/issue-1615-rate-floor-recheck.
