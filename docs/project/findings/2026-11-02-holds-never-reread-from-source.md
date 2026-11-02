# 2026-11-02: Darwin's range and peer holds were never cleared by reading the page again

**What happened:** the Pipeline wiring audit (Nov 2, gap 2) found that holds have no way back to
the bank's page. On Nov 2 prod held 5,551 raw fees for review because their amount was outside
the category's range (`outside_envelope`, 3,473) or far from state peers (`peer_outlier`, 2,078).
The median hold was 24 days old and the oldest dated from Oct 4. About 103 cleared in 7 days, none
by fetching or reading the document again.

**Cause:** three paths touch a hold, and none goes back to the source:
- The release pass (`darwin/release-held.ts`) judges each hold against the copy it was first read
  from, plus the newer copy only on a reject's second look. Its releases have been paused since
  Oct 8 (`DARWIN_RELEASE_ACTS`).
- Darwin's verify step re-decides a hold only when an envelope, peer or guard version moves.
- The one re-read channel (`knox_reread_requested`, read by `knox/reread-feedback.ts`) carries live
  fragment names from `darwin/live-fragment-check.ts`, not holds.

So a hold read from a stale copy, or misread by an older Knox rules version, stayed held.

**Fix (`darwin/hold-source-reread.ts`, `verify.hold_source_reread` v1, switch
`HOLD_SOURCE_REREAD_LIVE`, off):** a verify step, at most every 30 minutes, takes the 100 oldest
range and peer holds and routes each by the bank's current copy of its page:
- `refetch`: the current copy is over 30 days old. Darwin writes a `magellan_refetch_requested`
  row to `pipeline_feedback`; Magellan's live-source pass (`magellan/live-source-refetch.ts`)
  queues the page after every page live fees cite and fetches it on its usual retry waits.
- `no_text`: a fresh copy with no completed text. Counted.
- `reread`: Knox's free team reads the current text again. `confirmed` hands the hold back to the
  verify step once (`holdRereadRecheckSql`). `changed` and `recategorized` retire the held row
  (`superseded_by_reread`) and then insert today's read through Knox's insert path, in one
  savepoint (`replaceHeldWithReread`). A fee the page no longer names or prices
  (`name_not_in_text`, `amount_not_the_fee`) is archived after two looks 20 hours apart
  (`darwin_hold_not_on_current_copy`). The rest stay held, balance thresholds included.

**Review fixes (Nov 2):**
- The first version inserted the new read before retiring the held row. A recategorized read of the
  held row's own copy has the held row's raw key (document, name, amount), and Knox's ON CONFLICT
  takes over only a row without `needs_darwin_verification`, so the write did nothing, was read as
  "already read", and the held row was retired: the fee was lost (held raw 111826, $15 card reissue
  on document 10). Now the retire comes first, so Knox's take-over re-keys the held row under the
  new category (`knox_reread_took_over`, `knox_takeover_from:atm_non_network`) and sends it to
  Darwin. A write that leaves no row rolls the retire back unless another live or pending row
  already has the new key. `hold-source-reread.db.test.ts` runs this against Knox's real insert.
- The first version archived a hold whose amount the page prints only as a balance threshold. On a
  minimum-balance fee the threshold is the value (held raw 117384, $1,500), and on any other fee the
  amount is still on the page, so thresholds now stay held as `stated_unread`.

Every handled hold gets a `pipeline_attempts` row keyed on its current copy or text, and each
pass writes one `darwin.hold_source_reread` event. Off, the pass routes the batch, re-reads up to
10 texts and only reports.

**Count:** prod, read-only, Nov 2 (`holdRereadCountSql()` and the same routing on the oldest 100):

| | All holds | First run (oldest 100) |
|---|---|---|
| Stale copy: fresh fetch | 217 (90 documents) | 7 (3 documents) |
| Current copy: re-read | 5,154 (296 from a superseded copy) | 83 (49 texts, 34 from a superseded copy) |
| No stored text on the current copy | 180 | 10 (all superseded copies) |

**Sample:** 20 of the first run's re-reads, one per text, read by `judgeHoldReread` locally. Each
used a 700-character window of the stored text around the fee's name, not the whole text, so this
is an estimate.
- 5 `confirmed`: back to verify. 2 are real prices (Escheat Fee $40, Western Union money order $25).
  3 are not: a $2,500 minimum balance, and two overdraft charges filed under non-network ATM. Verify
  will likely hold them again.
- 4 `recategorized`, all right on the text: a card reissue $15 (card replacement), lien releases
  $2 and $6 (other lending fee), a stop payment $30 (stop payment).
- 1 `not_found_pending`: a $30 "Return Payment" price misfiled as a foreign transaction fee, so
  archiving the misfiled row is right but the price itself is real.
- 10 kept held: 8 `stated_unread` (4 of them the balance thresholds the first version would have
  archived: $1,000, $1,500, $2,500 x2), 1 `unconfirmed` (a $1,000 money order limit Knox still
  reads), 1 `refused` (a discontinued account).

The sample found no wrong replacement and no real fee archived on its own line.

**All 83 re-reads, whole text (SQL line check, not the judge):** the judge needs Knox's free read,
which runs only in the app, so the read-only SQL editor cannot give `judgeHoldReread` outcomes for
all 83. A SELECT over each current copy's whole newest text sorted the 83 by the lines that hold the
fee's name:

| Lines holding the fee's name | Holds | Likely outcomes |
|---|---|---|
| The held amount as a price | 41 | `confirmed`, `recategorized`, `stated_unread`, `unconfirmed` or `refused` |
| The held amount only next to threshold words | 39 | `stated_unread` (thresholds stay held), or `not_found_pending` when the source check finds no price |
| Another dollar amount, not the held one | 1 | `changed`, `ambiguous` or `refused` |
| No line holds the name | 2 | `not_found_pending` (archived on a second look) |

So with thresholds kept, few of the 83 can be archived: the 2 with no name line, plus any of the 39
whose amount the source check finds as no price at all (1 of the sample's 8 from that group). At
most 42 can be confirmed or replaced, and no first look archives anything (two looks, 20 hours apart). The threshold word test is broad (it counts "balance", "minimum" or
"over" within 30 characters of the amount), so some of the 39 are real prices; the sample's
115469 ($30 Return Payment) is one.

**Not measured:** `judgeHoldReread` outcomes for the 63 re-reads outside the sample, what the
verify step decides for `confirmed` holds under today's rules, and how many refetches return a new
copy.

**Lesson:** a hold is a question about the bank's page. Answer it from the current page, not only
from the copy it was first read from.

**Agent lesson:** darwin/issue-1115-a-hold-goes-back-to-the-page
**Guard:** `src/lib/agents/darwin/hold-source-reread.test.ts` (verbatim lines of held raw 111826,
115405, 117384 and 114751), `src/lib/agents/magellan/live-source-refetch.test.ts`

## v2 (Nov 2): a confirmation is not a release

**What happened:** a prod sample of 20 re-reads found every `recategorized` and `changed` outcome
right (5 of 5), but `confirmed` wrong in 5 of 12: today's reader repeated the first misread (a
$0.15 coin roll as a safe deposit box, express card delivery as an ATM fee, a $1,500 balance
threshold as maintenance, a $125 daily cap as overdraft, an IRA transfer fee as a money order).
`confirmed` handed the hold straight back to Darwin's verify step, so a wrong confirmation that
landed inside today's range would have published.

**Cause:** the re-read used today's reader as a second opinion, but it is the same reader. Agreeing
with itself says nothing about whether the first read was right; only the hold's own reason does.

**Fix (`verify.hold_source_reread` v2, switch still off):**
- A `confirmed` re-read hands the hold back only when its held reason no longer applies under
  today's rules (`holdReasonCleared`): for a range hold, the amount is inside `darwinEnvelopeFor`
  (hand or learned, by name, as verify reads it); for a peer hold, that and today's peer check
  (`peerCheck` + `holdsForPeerReview`, with the institution's state and asset tier, now selected
  with the hold). A failed range or peer read keeps it held.
- Otherwise the outcome is `confirmed_still_held`: an attempt on the hold's text key (outcome
  `unchanged`), so it is not read again until its current text changes, and no hand-back
  (`holdRereadRecheckSql` reads only `confirmed`).
- A confirmation whose amount its traced line or name gives as a limit stays held as
  `stated_unread` (`confirmedAmountLimit`, reusing Knox's `namesALimit` and `minBalanceFromExcerpt`,
  the live-fragment check's threshold and cap figures, and the source check's `statesDailyCap`).
- `recategorized` and `changed` are unchanged.
- The step detail counts `would_release`, `confirmed_still_held`, `confirmed_limit` and
  `would_replace` on every pass, switch on or off.

**Dry run (prod, read-only, Nov 2):** Knox's free read runs only in the app, so SQL cannot say which
holds the reader would confirm. This counts what the v2 gate would do with each of the 5,535
eligible holds if it were confirmed: a SQL replica of today's ranges (the hand table, the escheat
and box late fee name ranges, the learned ranges recomputed from `published_fee_catalog`) and of
the state peer check (from `state_memory.peer_levels`, tier then state-wide, 8+ institutions).

| Route | Held for | Would release if confirmed | Would stay held |
|---|---|---|---|
| Re-read (5,146) | range (3,229) | 655 inside today's range | 2,574 outside it |
| Re-read | peer (1,917) | 1,599 category no longer peer-held (v5), 18 inside today's state range | 252 still a state outlier, 48 outside the range |
| Fresh fetch (218) | range / peer | 26 / 86 | 97 / 9 |
| No text (171) | range / peer | 4 / 55 | 102 / 10 |
| All 5,535 | | 2,443 | 3,092 |

Of the 685 range holds inside today's range (all routes), 670 are escheat-named dormant account fees that
Darwin's escheat re-check (`ESCHEAT_HOLD_REREAD_LIVE`, on since Nov 2) re-decides on its own. The
1,599 peer holds clear only because v5 (#1112) no longer peer-holds their category; verify keeps
the ungraded v1/v2 holds held, so a confirmation is what would send them back. To match verify, v2
keeps any fee that is still a state outlier held whatever its category; only those of the 1,599 that
today's state levels no longer flag can go back. How many that is was not measured, so 2,443 is an
upper bound on what could release. Approximate: the
replica skips the learned range's cache window, the peer check's business-link test, and the
district and national fallbacks (none of which hold a fee), and does not apply the limit test.

**Not measured:** how many of the 5,535 the reader would confirm (12 of 20 in the Nov 2 sample, so
near half), and what verify then decides for the ones handed back.

**Agent lesson:** darwin/issue-1115-a-repeated-read-is-not-a-second-opinion
**Guard:** `src/lib/agents/darwin/hold-source-reread.test.ts` (`holdReasonCleared`,
`confirmedAmountLimit`, the off and on passes with a releasing and a still-held confirmation)
