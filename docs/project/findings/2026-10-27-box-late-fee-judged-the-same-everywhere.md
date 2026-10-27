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
- The outlier restore no longer brings a fee back on its range alone. It was the one restore path
  that checked neither source nor category, so widening its range would have restored all 9 escheat
  candidates unchecked. It now takes the same steps as the others (`outlierRestoreVerdict`): the
  bank's current copy of the fee's source document (the lineage's document, followed through
  `superseded_by_id`) has completed stored text, the restore bar's category step passes on it
  (`restoreCategoryVerdict` with `restoreGuardContext`), and the shared source check finds the fee's
  name and amount there (`checkFeeAgainstSource`, `ok` only). A fee that fails any step stays down,
  and the restore event records how many were held and why.
- `verify.ts`: the attempt record and the learned-hold count pass the fee's name, and the group record
  keys a name range apart (`heldEnvelopeEntry`: "safe_deposit_box:late_fee", "dormant_account:escheat").
- The guard's behaviour does not change (the night deposit lookbehind and `RETURN_NAME_PATTERN` export
  were already done in #2688), so `CATEGORY_GUARD_VERSION` stays 100.

**Scope (read-only, Oct 27, prod):**
- Fold: of 859 live late_payment fees, 0 name a box, safe deposit box, SDB or rent at all, so the
  split moves 0 at base and 0 at head. Of 7,668 live safe_deposit_box fees, 0 name night, a
  depository, a drop box or a bag, so 0 split to night_deposit at base or head. 0 live fees change.
- Guard: no behaviour change; 0 live verdict changes or re-files.
- Outlier restore: of 705 outlier takedowns, base restores 0. The name-aware range takes 9, all
  escheat processing filed as dormant_account at $50-$100, taken down on Oct 4 before escheat had
  its own range, none with a live escheat fee at its bank. The restore steps bring back 3 and keep 6
  down:
  - 13567 ($100, "Escheat Fee", inst 6049): restored. Its document 3187 was replaced by 39199; that
    copy's text 37366 states "Escheat Fee: $100".
  - 14614 ($50, "Escheat Fee -", inst 5050): restored. Document 14309 was replaced by 28536; text
    25947 states "Escheat Fee - $50.00".
  - 14747 ($75, "Escheat Account", inst 7413): restored. Document 12977 was replaced by 38772; text
    36853 states "Escheat Account: $75.00".
  - 13758 ($50, inst 4589): stays down, `source_trace:amount_not_the_fee`. Its name is a cut-in
    sentence ("(Assessed in the month an inactive account is processed for escheatment) ACCOUNT
    RELATED FEES Courtesy Pay Fee‡ ..."); the bank's $50 line is "Abandoned Property Processing Fee",
    which a re-read, not a restore, should bring in.
  - 461 ($50, inst 200): stays down, `no_stored_text` (document 64 has no completed text).
  - 6459, 10946, 11613, 12148: stay down, `no_source_document` (no source document in their lineage).
  The verdicts were computed by running `outlierRestoreVerdict` and `checkFeeAgainstSource` on each
  current copy's stored text pulled read-only, with runs of three or more newlines folded to two
  (md5-checked against prod), from the restore's own candidate query run read-only on prod. 0 box
  late fees are down as outliers. The takedown's verdicts do not change (0 live rows sit where the old
  and new forms differ).

**Agent lesson:** darwin/issue-1912-record-the-range-you-judged
**Agent lesson:** hamilton/issue-1912-same-range-down-and-back
**Guard:** `src/lib/fee-fold.test.ts` (fold v20), `src/lib/agents/hamilton/outlier-rollback.test.ts`,
`src/lib/agents/darwin/verify.test.ts`
