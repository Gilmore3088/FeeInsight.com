# 2026-11-02: a tier schedule's $0 was taken down without reading the bank's general schedule

**What happened:** James's sampled-clean rule (DECISIONS 2026-10-20) had the tier-rule cohort
(`DARWIN_RECHECK_TIER_RULE_LIVE`, PR #2744, #1397) sampled before it went on. Read-only on prod,
Nov 2: the cohort held 12 live $0s at 3 institutions. All 12 were judged against the stored texts.
- Wrong: 135960, Main Street Bank (683), "Online Banking/Bill Payment" $0 (`bill_pay`) on its
  `BankOn_Summary_of_Fees.pdf`. The bank's general `Retail_Summary_of_Fees.pdf` (document 18254)
  prints the same line: "Online Banking/Bill Payment | No Fee". That $0 is every account's price.
- Can't be judged: HSBC (26), 28131-28134. The only stored text for that bank is its
  `hsbc_premier_tcs.pdf`, saved three times (documents 15400, 34307, 41056). Nothing shows what a
  non-Premier customer pays, so nothing shows a perk.
- Right: Main Street's other six Bank On $0s (money order, dormant, NSF, overdraft transfer,
  returned deposit item, stop payment). Its general summary prices each one.

**Cause:** `tierPerkZero` decided from the tier's own document alone: a $0 read from a tier's
schedule was the tier's perk unless that same schedule said the bank charges nobody the fee. It
never read the bank's general schedule, so it could not tell a perk from a price every account
pays. It also took down a tier $0 when no general price was on file at all.

**Fix (tier-perk rule v3, `TIER_PERK_RULE_VERSION` 2 to 3):**
- `generalSchedulePrice` (`src/lib/agents/darwin/tier-perk.ts`) reads the institution's other
  stored documents that are not tier schedules. For each, it takes the price printed right after
  the fee's own name ("No Fee", "Free", "None", "$0.00", or a figure). It confirms that price with
  the shared source check (`checkFeeAgainstSource`).
  - When a general schedule prints the same $0, the result is `same_zero` and the $0 stays.
  - When one prints a price, the result is `charged`.
  - When none prints the fee, the result is `none` and the $0 stays: there is no general price to
    compare against.
- Main Street's Retail Summary prints prices with the decimal point dropped and no dollar sign
  ("- Money Order | 3 00"). The shared check's own repair reads only "$3 00", so such a cell is
  written "$3.00" before the general schedule is read.
- The recheck (`verified-recheck.ts`) fails a $0 read from a tier's own schedule only when the
  result is `charged`. A $0 named for a tier's account ("BankOn Checking Account Overdraft Fee")
  fails as before. The main path, the older-live shadow and the due shadow all read the general
  texts. When that read fails, the batch defers instead of judging a tier $0 without them.
- The version bump makes the cohort read again every live tier-schedule $0 that it read at v2.

**Re-run, prod read-only, Nov 2 (the cohort's SQL at v3):** 13 live $0s at 3 institutions. 28130,
HSBC's Premier NSF, joins the 12 because it was read at v2. All 13 are judged right:
- 6 fail and go through the shared 12-hour second look: 135954, 135955, 135956, 135957, 135958 and
  135959. Main Street's general schedule prints $3, $5, $32, $8, $6.84 and $32 for them.
- 7 stay:
  - 135960: the general schedule prints the same "No Fee".
  - 152915, First Fed's (1170) Bank On overdraft "NO FEE": the general Fee Schedule has no overdraft
    fee line, only "Bank On | No Overdraft fee".
  - HSBC's 28130-28134: no general schedule is on file. 28130 also passes because the bank charges
    no NSF fee.

The switch goes on under the sampled-clean rule.

**Not changed:** verify's own tier test on new rows (`verify.ts`) still holds a tier $0 without
reading the general schedule. A hold does not take a live fee down, but a new Bank On "No Fee" line
that the general schedule also prints is held. That is a follow-up line on #1397.

**Lesson:** a perk is a difference between two prices. Read both before deciding. When only one
of them is on file, there is no difference to show.

**Agent lesson:** darwin/issue-1397-tier-zero-against-general-schedule
**Guard:** `src/lib/agents/darwin/tier-perk.test.ts` (on the prod texts, byte for byte, in
`src/lib/agents/darwin/__fixtures__/tier-general-schedule-live-2026-11-02.json`),
`src/lib/agents/darwin/verified-recheck.test.ts`, `src/lib/agents/darwin/verified-recheck.db.test.ts`
