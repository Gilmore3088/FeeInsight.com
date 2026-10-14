# Moved hand-found schedule left the old copy current (Regions, 9 Oct 2026)

**What happened.** PR 807 swapped Regions' (27) hand-found link from
`/virtualDocuments/Checking-Pricing-Schedule.pdf` to
`/-/media/pdfs/pricing-schedules/Checking-Pricing-Schedule.pdf`. The new link was fetched
through the paid companion fetch at 02:51 (document 23188, 659,927 bytes) and read at layout 3
at 03:07 (70 fee lines). But the old link's copy (document 21132) stayed current, because
one-current-copy-per-page only pairs the same address (or a respelling of it). So 34 live fees
still cited 21132, and Darwin's second-source check compared each new row against the stale copy
(13 `evidence_mismatch`).

The `fetch.http` `invalid_url` at 03:07 is unrelated. Regions has no main fee-schedule URL; every
refetch has logged it since 7 Oct, and the companions carry the schedule.

**Fix.** Magellan's fetch step runs `supersedeMovedHandFoundCopies`. When a bank's current
`OPERATOR_SCHEDULES` link has a readable copy, the current copy of an older hand-found link on
the same host with the same file name points at it (`superseded_by_id`). Hamilton's refresh then
moves the fees the new copy restates, and its current-copy check looks at the rest. Dry run on
prod: one pair, 21132 -> 23188.
