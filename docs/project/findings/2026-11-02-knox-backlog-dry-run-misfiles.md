# 2026-11-02: The re-read backlog's dry run found Knox misfiling notices, service charges and reactivations

**What happened:** before turning on `KNOX_REREAD_BACKLOG_LIVE` (gap 10: current texts last read
below today's rules version get re-read, behind live fees first), a read-only dry run took 42 texts
at random from the first 600 the switch would pick. On prod (Nov 2) the backlog held 14,192 current
texts, 7,097 of them behind live fees. Each sampled text was read with main's Knox (`currentVariant`,
which wraps `runFreeSpecialists`), passed through the Darwin verify and Hamilton publish checks that
can be replayed, and compared with the live fees on its document and its older copies (877 live fees).

Today's rules would send 115 new rows to Darwin from 31 of the 42 texts. All 115 traced to their own
line with `checkFeeAgainstSource`. The switch's own path takes no live fee down: a read only adds rows,
and `retireRowsFromOlderText` touches unverified rows only. Five of the new rows were wrong against the
bank's own stored text, so the dry run was not clean and the switch stayed off:

- Intercredit Bank (institution 827, doc 7822): "‐Incoming Wire Transfer Email Notification ... No Fee"
  and "‐Outgoing Wire Transfer Email Notification ... No Fee" were filed as the incoming and outgoing
  wire fees at $0. The same page prints the wires themselves at $15 and $50.
- Intercredit: "‐Hold Mail – monthly fee (refer to agreement) ... No Fee" was filed as `monthly_maintenance` $0.
- BAC Community Bank (1265, doc 7830): "Mobile Banking Monthly Service Charge ... No Fee" was filed as
  `monthly_maintenance` $0.
- Midwest Heritage Bank (1839, doc 25885): "Account Reactivation (check or savings closed for less than
  3 months) ... $10.00/occurrence" was filed as `early_closure`.

**Why (root cause, in Knox's reading rules):**

- Wire rules match the words "incoming/outgoing wire" anywhere in a name. No rule asked whether the
  row's subject was the wire or the notice the bank sends about it. `wire-channel.ts` already knew
  that a notice names no channel, but only for channel rows.
- `SERVICE_MONTHLY_CHARGE_NAME` (guard v102, Knox v149) lists the named services whose own monthly
  charge is not monthly maintenance. Its list had online, internet and text banking but not mobile
  banking or hold mail, so both rows fell to the generic "monthly service/fee" pattern. Open PR #2953
  holds such a fee by the *heading* above it; these rows name the service themselves, so that PR does
  not cover them.
- Knox's dormant rule read only "reactivation fee", and it comes after the short-window early closure
  rule. The note "closed for less than 3 months" matched early closure first.

**Fix (Knox v166, guard v106; v165 is #2953's):**

- `src/lib/wire-notification.ts` (`WIRE_NOTIFICATION_NAME`): a wire row whose subject is a
  notification or alert is held by Knox and refused by every wire type in the guard. No type holds a
  notice, so a match is never re-filed. A wire priced with its notice ("Incoming Wire with Phone
  Notification") stays a wire. The scope is the wire types only: elsewhere a notice is usually the fee
  itself (escheat, dormancy and garnishment notices).
- `SERVICE_MONTHLY_CHARGE_NAME` v2 adds mobile banking and hold mail. Knox holds their monthly charge
  and the guard refuses it under monthly maintenance.
- `src/lib/account-reactivation.ts` (`ACCOUNT_REACTIVATION_NAME`): when "reactivat…" comes before any
  closing word, Knox files the row as `dormant_account`, and the guard refuses it under early closure
  and re-files it there (`REFILE_RULES`, plus Hamilton's `RESTORE_REFILES`). These stay early closure:
  one price for a reactivation or a closure ("Reactivate/Close Draft Account (within 1 year)", 153083)
  and a card's reactivation.

**Live fees (read-only dry run, Nov 2):** 57 live fees have a name that says notification, alert,
reactivat, mobile banking or hold mail. Under guard v106 (Hamilton's guard re-check on the version bump):

- 4 live incoming wires fail and come down. Each was read on its stored line:
  - 45083 "Incoming Wire Notification" $5, beside the bank's own "Wire Transfer Fee (Incoming) $15.00".
  - 32466 "Incoming Wire Notification or Special Handling" $10.
  - 104525 and 158510 at Citizens Business Bank, whose wires print per wire.
- 1 is moved to `dormant_account` and comes down as a twin: 64514 "Reactivate Closed Account Fee" $5.
  The bank's live "Dormant Fee" $5 (53021) counts as its twin by the move's same-bank-and-price test.
- 0 monthly maintenance fees fail.
- The other 51 pass, as they did under guard v105.

**Re-run after the fix (same 42 texts):**

- 116 new rows: 65 added, 42 renamed (same category and amount, publish sees an identical value), 9
  with a new spelling of a live name.
- All 116 trace to their own line.
- None of the five wrong reads remains. The reactivation is now read as `dormant_account` $10.
- The other changes come from Knox v164 (#2952, merged in between). That PR renamed Steel Valley's
  glued names (text 12240).

Still open, not fixed here (each is a checklist line, not a blocker found wrong):

- Two doubtful reads remain:
  - "Line of Credit - Advance in exact amount of overdraft" $0 (Elements Financial, 6604) is filed as
    `other_lending_fee`. It is probably an overdraft-protection transfer.
  - "Penalty for closing within 12 month or non-return of scanner" $250 (institution 1754) is filed
    as `early_closure`. It is a remote deposit scanner charge.
- One garbled name, with the right amount and category: Marquette's "and over 2.50% Returned
  statement fee" $3.
- A wrong live fee with no current read behind it: Intercredit's "Account Research – per hour or
  fraction Min" $2 (14338). Its line reads "Min. $50.00". The backlog read does not take it down;
  retiring a live fee whose line a current read no longer finds is the wiring audit's work.

**Lesson:** a switch that sends a text through today's rules again shows what today's rules get
wrong, and that is the time to fix them. A dry run that is not clean against the bank's own lines
points at the reading rule to fix, not at the switch.

**Guard:** `src/lib/backlog-misfiles.test.ts` (Knox reads, guard refusals and re-files for each class, on the stored lines).
**Agent lesson:** knox/backlog-dry-run-2026-11-02-notice-service-reactivation
