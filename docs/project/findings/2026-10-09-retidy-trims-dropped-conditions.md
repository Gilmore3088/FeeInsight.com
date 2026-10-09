# 2026-10-09: name-retidy trims dropped conditions, and a second rename overwrote the logged old name
**What happened:** UAT rated PR 924 (retidy v14) PARTLY. The v14 dry read expected 26 renames.
Prod logged 98 new `name_retidied` rows between 10:46 and 11:16 UTC, plus 7 older rows that were
overwritten in the same window. About 72 of the extras were trims that cut a real condition off
the name. Examples: 105070 lost "(after 1st one)", 47474 became plain "ATM Fee", and 92155 and
79717 lost their dormancy terms.
**Cause:** there were two causes.
- A version bump re-scans every institution. v14 reached banks that earlier passes had not, and
  there it ran the old v6/v11 trims (a condition parenthetical, a " - description" tail, a sentence
  name's head). The v14 dry read covered only the account-name rows, so the other trims it would
  make were never counted.
- `name_retidied` feedback used one dedupe key per live fee. A second rename of the same fee
  overwrote the first row's `old_name` and kept the first row's `about_version`. The original name
  survived only in the run event's first 20 samples, and version counts under-counted renames.
**Fix:** PR 933 (retidy v15).
- `dropsCondition` blocks any trim of a name's own words that drops a figure, an account limit, a
  period or basis, dormancy, a balance, or whose ATM it is.
- The renames logged since v14's first write that dropped one get it back from the logged old name
  (`restoredName`). A dry read finds 53 of 88.
- Each rename now has its own feedback row, keyed on the name it replaced.
**Lesson:** a dry read for a version bump must run the whole chain on every due institution, not
only the rows the new rule targets: the bump re-runs every older rule on banks it had not reached.
A log that holds the old value must never be keyed so that a later write replaces it.
