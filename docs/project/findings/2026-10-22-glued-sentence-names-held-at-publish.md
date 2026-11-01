# 2026-10-22: Right reads held at publish because a sentence was glued onto the fee's name

Hamilton holds a verified fee whose name reads as cut from a sentence or a table (`publishNameHold`,
code `cutoff_name`, built on `isCutoffName`). The shadow lab charged 18 expected fees to that hold
(14 answer-key fees, 4 live-audit fees). Knox had read each one at the right category and price.
State key 7450's "Notary Service (excluding CU business)" at $10 is one of them.

**What happened:** every held name, its stored line and why the shape fires (a scratch probe over
every shadow-lab case, not committed). They fall into three groups.

1. Words glued onto a complete name (5 expected fees, plus 1 fee outside the keys). Only the two
   "will cost" fees publish after the review of 6dd3641; the glued words of the other three say
   something of their own, so they stay held (see Fix):
   - State key 3148, cashier's check $5: "(Per month some exclusions apply): Cashier’s Check (Per
     item)". The left column's footnote cell was joined in front ("apply" is a sentence verb).
   - State key 8240, overdraft transfer $10: "Company that is part of our Health Savings Program
     offered: Share-to-Share Overdraft Transfer Fee". The left column's sentence ("is", "our").
   - State key 11362, overdraft $32: "Overdraft Fee - An Overdraft Fee may be imposed for
     transactions made by check". The row's description after a dash ("may", "be").
   - Live audit 4993, check copy $5 and cashier's check $5: "Copy of a cancelled check will
     cost", "Each cashier check payable to someone other than the member making the check will
     cost" ("will"). The same text's "Copy of an account statement will cost" ($10) is a right fee
     outside the live audit's expected list.
2. A complete name whose own words trip the shape (7 expected fees). The name is the fee's;
   publish misreads it:
   - A parenthetical: 7450's "Notary Service (excluding CU business)" ("excluding"), 6820's
     "Temporary check (must have existing account)" ("must"), 3141's "Inactive Account Fee
     (Monthly until account is brought back active, closed or escheated)" ("is"), and 10279's
     "Paper Statement (Effective May 2022)", where the month "May" reads as the modal verb.
   - A condition the name needs: 11362's "ATM Fee - Cash withdrawal at ATMs we do not own or
     operate" ("we"), 11362's "Dormant Account Fee - Checking Accounts. A Checking account is
     dormant if for one" ("is", "if"), and 3141's "NSF (Non-Sufficient Funds) for each
     presentment, including if the same item is presented" ("including", "if").
3. A real sentence fragment, which the hold is right to stop (6 expected fees):
   - 1338's "5 Non-Ameris Bank ATM Usage: ATM withdrawl/transfer fee for Opportunity Checking
     account is".
   - 6730's "Monthly fee of account with aggregate balance of below"; the shared check finds no
     source line for the name as held.
   - 3981's "Savings Balance Less than", read as a minimum-balance fee at the $6 the key files
     as a monthly fee.
   - Texas key 2451's "per overdraft item will be reduced" ($5), on a PDF stored with its two
     columns interleaved (the Rosetta follow-up in #1026).
   - Live audit 2104-70d1a7a2's "Paper statements are available" ($2, "Paper statements are
     available for $2.00 per statement cycle.").
   - Live audit 554's "Account is dormant if for six months for Checking or Temporary checks" ($2).
     The right column's "Temporary checks" was run onto the left column's sentence with no cell
     break.

**Cause:** the hold is blunt by design. On Oct 15 `cutoff_name` matched 1,571 live fees, and about
two thirds were real fees with a qualifier (DECISIONS, 2026-10-15; #1443). Its tests and findings
hold sentence fragments that have no fee's name ("GUASFCU charges a", "Any replacement cards
whether lost, stolen, or damaged will be charged a", "ATM Withdrawal Fees, out of Network
(Surcharge Fees, fees accessed by other ATM proprietors, may still apply.)"). For group 1 the hold
is right about the name Knox gave it: Knox kept another column's cell, the row's description or the
sentence's verb. So the input is the thing to fix, not the hold.

**Fix:** Knox rules v104 (#2550).
- `withoutGluedSentence` (`src/lib/agents/knox/glued-sentence-name.ts`) runs on each read's name
  after the name tidy, only when `isCutoffName` fires. It tries three cuts:
  - the last cell, when the cell before it is another column's sentence or a wrapped parenthetical
    and says nothing;
  - the words before a dash, when the description after it says nothing the name does not;
  - the subject of "<what> will cost", without a leading conjunction ("and", "or", "but") or its
    "Each" or "A". Nothing of the subject is dropped.
- "Says nothing" is positive (`onlyFillerAndName`): every word of the dropped cell or description
  is filler (articles, auxiliaries, joining words, "fee", "charged", "imposed", "apply", "item") or
  one of the kept name's own words. Any other word keeps the name as read, and the fee held, as at
  base.
- The words left must also name the read's own category on their own (`classifyFeeText`), pass
  the category guard, no longer read as cut off, and drop no condition (`dropsCondition`).
- `isCutoffName`, its regexes and `dropsCondition` moved unchanged from `name-retidy.ts` to
  `src/lib/agents/knox/cutoff-shape.ts`. `name-retidy.ts` imports Knox's specialists, so Knox could
  not import them from there. `name-retidy.ts` re-exports both, and every caller is unchanged.
- Hamilton's hold and its tests are unchanged.

**Review of 6dd3641.** The first cut used `dropsCondition` as its only bar and accepted any
description with a verb. The review ran plausible schedule lines through the full pipeline at base
and at head. Base held every line below (`cutoff_name`, or Darwin's category check saw the
qualifier). The head published each as the general fee:
- "Card Replacement Fee - This fee is charged for rush delivery | $35" and "(Fee applies to
  expedited delivery) | Card Replacement Fee $35" as card_replacement;
- "Outgoing Wire Fee - This fee is charged for international transfers | $45" as
  wire_domestic_outgoing;
- overdraft fees "for the fourth and subsequent items", "for repeat overdrafts" and "for each item
  over $5" as plain overdraft;
- cashier's check, check cashing, coin counting and money order fees "charged to non-members" or
  "non-customers", in dash and parenthetical-cell forms, as the general fee;
- "(This fee is charged for business accounts) | Stop Payment Fee" as stop_payment, through
  `dropsCondition`'s account-heading exemption;
- a returned deposit item "for each foreign item returned unpaid", without "foreign".

The cause: the cut runs in Knox, before Darwin's category check, which then cannot see the
qualifier. `dropsCondition` was built for re-tidy's small trims and lists none of these words. The
positive rule replaces it as the bar for the cell and dash cuts, so the heading exemption no longer
decides a wrapped "(...)" cell. Every review line is a near-miss test through `runCase`, failing on
6dd3641. So are "waived for Premier members", which 6dd3641 also cut, and "Stop payments are $30
and a cashier's check will cost $8", which 6dd3641 named "And a cashier's check".

The cost: 3148's "(Per month some exclusions apply)" cell, 8240's "Company that is part of our
Health Savings Program offered" cell and 11362's "... made by check" description all carry words
of their own. They stay held, as at base, and the three ratchet lines this PR had locked for them
were removed before merge.

Read-and-publish diff against base b845c17, over 289 distinct texts: the 249 texts of the shadow
lab's cases (what the review counted) and 40 Texas and seven-state fixture texts that no lab case
uses. Three reads are renamed, with the same category and price, and each now publishes where it was
held as `cutoff_name`:
- 4993: check copy $5, "Copy of a cancelled check";
- 4993: cashier's check $5, "Cashier check payable to someone other than the member making the
  check";
- 4993: statement copy $10, "Copy of an account statement" (a right fee outside the live audit's
  expected list).

No other read, hold or publication moved. On the corpus and the review's lines the change only
admits fees.

Shadow lab, before -> after:
- Answer-key recall: 946 of 1,312, unchanged.
- Live-audit recall: 339 -> 341 of 431.
- All-expected recall: 1,308 -> 1,310 of 1,766.
- Known-wrong fees published: 34 of 160, unchanged.
- Names: 313 of 317 -> 315 of 319. Fees outside the keys: 35, unchanged.
- Held at publish as `cutoff_name`: 18 -> 16.
- Ratchet: 2 gained (4993's check copy and cashier's check), 0 lost.

Gates: categories and prices are unchanged, so the seven-state gate (909 right / 34 wrong) and
the Texas gate (590 / 11, held out 60 / 4) are unchanged. Their floors and ceilings already equal
the real counts.

Left out:
- Group 1's three fees (3148, 8240, 11362). A cell or description can only be dropped when Knox can
  show it belongs to another column or says nothing. Telling another column's footnote from the
  fee's own qualifier needs the layout (the column split), not the words; that belongs with the
  two-column reader work.
- Group 2 (7 fees). Knox cannot give these names more complete words. Cutting the parenthetical
  or clause would drop a condition, so the fix belongs in Hamilton's hold: a balanced trailing
  parenthetical with no figure, fee word or sentence end is not a cut, as the live twin already
  reads it (`PARENTHETICAL`, #1443). The month "May" also needs reading as a month. Settled rows
  are never re-decided unless `HAMILTON_PUBLISH_STRATEGY` moves from v3 to v4, and that bump
  re-decides every verified row. It needs its own PR and James's call.
- Group 3 (6 fees). Each needs its own reader fix: a "fee for <account> is" sentence, an
  "<X> are available for" sentence, Rosetta's interleaved two-column PDFs, the untraced 6730 line
  and the 3981 category.

Live documents get v104 on their next read. The stale-read floor stays at v97 and name re-tidy at
v26, so no live fee is renamed by this change.

**Lesson:** When a right read is held because its name reads as a sentence, fix the name Knox
gives it, not the hold. Cut glued words only when every one is filler or the name's own: a cut in
Knox hides a qualifier from every later check.

**Guard:** `src/lib/agents/knox/glued-sentence-name.test.ts`; the shadow lab ratchet baseline.
Agent lesson: knox/glued-sentence-name.
