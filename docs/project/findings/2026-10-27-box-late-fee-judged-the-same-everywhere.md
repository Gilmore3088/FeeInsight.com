# 2026-10-27: a box late fee was judged one way by the guard and another by the fold, the restore and the run record
**What happened:** guard v90 and v96 (#2639, #2688) taught the category guard and Darwin's hold
decision how to read a box late fee: a late charge named for the safe deposit box re-files from
late_payment to safe_deposit_box, a night depository's box is never a safe deposit box however its
words are spaced ("Night Drop Deposit Box", "Night  Deposit Box"), and a box late fee has its own $1
floor (`BOX_LATE_FEE_ENVELOPE`) instead of the box's $5 rent floor. #2688's review found three other
places that still read the old way (#1912):
- The fold's late_payment split (`BOX_RENT` in `fee-fold.ts`) sent any name with "box" in it to
  safe_deposit_box, a night deposit box late fee included, though the safe deposit box guard refuses
  it. Its safe_deposit_box -> night_deposit split allowed one space only (`night (deposit|drop)`), and
  its SQL pre-filter the same.
- `restoreOutliersNowInRange` (Hamilton's outlier restore) read category ranges only, while the
  takedown beside it read escheat processing and box late fees by their own ranges. A box late fee
  taken down at $1-$4, or escheat processing taken down above the $30 monthly dormant ceiling, stayed
  down after its own range arrived.
- Darwin's attempt record (`amount_envelope`) and the run's group record (`amount_envelopes`) called
  `darwinEnvelopeFor` without the name, so a held box late fee was recorded under the box's $5-$1,500
  rent range. The decision itself was right.

**Cause:** a name-aware range or name rule was added at the place that decides, and not at every
place that reads the same thing: the fold's split, the restore and the records each kept their own
copy of the older, category-only reading.

**Fix:**
- Fold v20: the night depository's words are one shared pattern (`NIGHT_DEPOSIT_WORDS`, read by the
  guard's `NIGHT_DEPOSIT_NAME` too, so the guard is unchanged). The late_payment split refuses a
  night depository's bag, box or drop box, and the safe_deposit_box split and its SQL pre-filter read
  the night words however spaced or joined. Tests check the fold and the guard agree on each name.
- `outlier-rollback.ts`: one name-aware range table (`NAME_ENVELOPES`, one SQL `CASE` from
  `inNameAwareEnvelopeSql`) serves both the takedown and the restore, and the takedown's reason text
  names the fee's own range.
- `verify.ts`: the attempt record and the learned-hold count pass the fee's name, and the group record
  keys a name range apart (`heldEnvelopeEntry`: "safe_deposit_box:late_fee", "dormant_account:escheat").
- The guard's behaviour does not change (the night deposit lookbehind and `RETURN_NAME_PATTERN` export
  were already done in #2688), so `CATEGORY_GUARD_VERSION` stays 100.

**Scope (read-only, Oct 27, prod):**
- Fold: of 859 live late_payment fees, 0 name a box, safe deposit box, SDB or rent at all, so the
  split moves 0 at base and 0 at head. Of 7,668 live safe_deposit_box fees, 0 name night, a
  depository, a drop box or a bag, so 0 split to night_deposit at base or head. 0 live fees change.
- Guard: no behaviour change; 0 live verdict changes or re-files.
- Outlier restore: of 705 outlier takedowns, base restores 0 and head restores 9, all escheat
  processing filed as dormant_account at $50-$100, taken down on Oct 4 before escheat had its own
  range: 461, 6459, 10946, 11613, 12148, 13567, 13758, 14614, 14747. None has a live escheat twin at its
  bank; each passes the category guard and Darwin's range on its name. 13758's name is a cut-in
  sentence ("(Assessed in the month an inactive account is processed for escheatment) ACCOUNT RELATED
  FEES Courtesy Pay Fee‡ ...") and 4 of the 9 (6459, 10946, 11613, 12148) have no source document in
  their lineage; the restore does not re-trace a fee to its source. 0 box late fees are down as
  outliers. The takedown's verdicts do not change (0 live rows sit where the old and new forms differ).

**Agent lesson:** darwin/issue-1912-record-the-range-you-judged
**Agent lesson:** hamilton/issue-1912-same-range-down-and-back
**Guard:** `src/lib/fee-fold.test.ts` (fold v20), `src/lib/agents/hamilton/outlier-rollback.test.ts`,
`src/lib/agents/darwin/verify.test.ts`
