# Two-column disclosures glue neighbouring cells into one fee (Oct 9, 2026)

City National Bank of Florida (institution 76) publishes its 2026 personal fee disclosure (doc 23020)
as a two-column PDF. The stored text joins each left-column line to the right-column line beside it
("Rate Information ... (APY) are available at any of ... banking | Cashier's Checks ... $0.00").
Knox then reads a fee from the joined line, so either the name carries the neighbour's prose, or the
amount comes from footnote prose or from a single account's column.

Hand check of the 27 live fees from doc 23020 against the PDF text:

- 4 wrong records:
  - 100157 is $10 "sufficient to cover both the full overdraft". The $10 is the overdraft-protection
    transfer fee, already live as 100151.
  - 100158 is $17 "... the check/item in the amount of". The $17 is a check amount in footnote 9's
    worked example.
  - 100161 is a $0 cashier's check. That price applies to one account only (CNB @ School); the
    schedule price is $30.
  - 100162 is a $0 incoming wire. Footnote 11's CNB-to-CNB exception is $0; the schedule price is $15.
- 1 already flagged: 100160, the $0 "to Avoid Monthly Maintenance Fee", is flagged by `waiver_sentence`.
- 6 with a glued name but the right amount and category: 100136, 100137, 100138, 100143, 100144 and
  100145. They stay live for the name pass.

Three more live fees at this bank (100123-100125, among them the commercial $37) came from a blog post
at `/post/...`. That path was not an article segment.

Fix in this PR:
- `hamilton/eval-verdicts.ts` gains `HAND_CHECKED_VERDICTS`: rows a person checked against the schedule.
  They take the usual 12-hour second look and only while the live record still reads as labelled.
  The rollback reason and Knox's lesson carry the extraction pattern (`two_column_glue`).
- `hamilton/article-page.ts` counts `/post/` and `/posts/` as article segments.

Not fixed yet: Knox still reads two-column lines as one. A rule that splits a line at the column
separator before reading a fee, or refuses a price that finishes a prose sentence ("in the amount of",
"will be"), belongs in Knox's rules with a version bump and an answer-key gate run.
