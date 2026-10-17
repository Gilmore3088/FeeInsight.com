# 2026-10-17: international ATM fees, add-ons, sustained overdrafts and incoming wires under the wrong type

**What happened:** James's sample-report review (Oct 17, 11:27 UTC) found four kinds of live fee
under the wrong type (#1788):
- An ATM fee charged abroad ("Non-PNC Bank ATM Fee (All Other Countries)") under the non-network
  ATM fee, where it raises the domestic median.
- An optional add-on ("ATM Freedom add-on ... for a monthly fee of $2.99", "Add ID Protect to your
  account for $5.00") under monthly maintenance, as if it were the account's own fee.
- A sustained overdraft ("Cont OD Charge", "7 Day Overdraft Processing Fee") under the per-item
  overdraft fee.
- An incoming wire ("Domestic Wire Transfer Fee – In Coming", "Domestic Wire-In fee") under an
  outgoing wire key.

**Cause:** The guard read "international", "outside the U.S.", "add-on", "continuous" and
"in coming" as nothing special. Knox files a line by its nearest heading. So a section headed "ATM",
"Monthly fee", "Overdraft" or "Wire transfers" carried every line under it into one type.

**Fix (guard v72):**
- `INTERNATIONAL_ATM`, `SUSTAINED_OVERDRAFT` and `INCOMING_WIRE` in `src/lib/fee-fold.ts` move these
  fees by three routes: the guard, the re-file rules and the fold split.
- "Foreign ATM" never counts as international. A row that also names domestic or in-the-U.S. ATMs
  keeps its type.
- An add-on fails monthly maintenance by its name or its own line. None of the 50 types holds an
  add-on, so it is taken down rather than re-filed.

**Dry run (Oct 17, SELECT-only, 17,915 live rows in the affected types):**
- 14 fees re-filed in place: 4 international ATM, 3 sustained overdraft and 7 incoming wire.
- 7 taken down after the second look: 5 add-ons, and 2 rows whose re-file a live twin at the same
  bank, type and amount blocks (14348, 98702).
- 5 hand takedowns.
- No batch reaches 20, so no switch holds them.

**Lesson:** A section heading is not the fee type. When a line names a place (another country), a
direction (in, out) or a duration (N days overdrawn), that word decides the type, even when the
heading says otherwise.
