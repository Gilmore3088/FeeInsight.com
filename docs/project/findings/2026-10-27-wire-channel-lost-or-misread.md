# 2026-10-27: a wire's channel was misread in its name, or never reached it
**What happened:** issue #1912's open line said a channel or premium wire price was used as the base
(Sound Community Bank, fee 15716) and that Knox never sets `variant_type`. Read-only checks on prod
(Oct 27) found:
- `variant_type` is set on no row of any tier: 0 verified and 0 published rows, and
  `raw_fee_observations` has no such column. Darwin inserts NULL and Hamilton copies it. Statistics
  rule 11 reads a wire's channel from its fee name (`wire-channel.ts`, #2730), so the name is the
  only carrier.
- The name rule misread three kinds of name:
  - "Wire Transfers: Outgoing Domestic - Not in Person" (15716, $60) read as general, because "in
    person" is a standard-channel word. Once Knox v130 reads the bank's $30 standard wire (#2741),
    the bank's value would be $45, not $30.
  - "Wire Transfer - Remote Outgoing" $40 and "...Remote Outgoing" $70 (institution 2521) read as
    general beside its $20 "Wire Transfer - Outgoing", so its domestic value was $40.
  - "Incoming Wire with Phone Notification" (129879, institution 6377) read as a phone-channel wire.
    It is the credit union's only incoming wire; the phone is how it tells the member.
- Knox dropped a channel printed after the price. "Outgoing Domestic Wire Transfer $30.00 - phone
  request" (110356) and "Outgoing Foreign Wire Transfer $55.00 - phone request" (110355, Dutrac,
  institution 7711) were named without it. They sit beside "$25.00 / $50.00 - in person or recurring
  agreement request", so the domestic value blends to $27.50. "Outgoing Domestic Wire fee | $15.00
  Recurring / $25.00 New" (71592, institution 4366) was read as a plain $15 wire.

**Cause:** the channel lives in the name, and two steps lost it. The shared name rule
(`namesWireChannel`) tested "in person" without its "not". Knox's readers stop a name at the price,
so words printed after the price never reach the name.

**Fix:**
- `wire-channel.ts` v2 (statistics method 29/30), with its SQL twin:
  - a negated standard channel ("not in person", "not in branch", "non-branch", "outside the branch",
    "other than in person") is a channel, and its "in person" or "branch" no longer counts as the
    standard word;
  - "remote" is a channel word;
  - a phone, fax, email or text notice, confirmation, advice or alert ("with Phone Notification",
    "Email or Fax Confirmation", "notice by phone") is removed before the channel test.
- Knox v135 (`wire-channel-clause.ts`, `withWireChannelReads`): a wire read whose own price is
  followed on its line by a short channel label gets that label in its name, as in "Outgoing
  Domestic Wire Transfer (phone request)" and "Outgoing Domestic Wire fee (Recurring)". The label
  must:
  - open with a channel word and be four words or fewer;
  - run to the end of the price's own cell: with another price after it, a slash, semicolon, comma
    or cell mark must end the label and the next price must follow that mark directly;
  - name no other service ("Online Banking", "BillPay", "Card", "Alerts"; allowed after "by", "via",
    "through" or "using") and no free word;
  - trace on the stored text with the shared source check, or the read keeps its old name.
- The fix sets no `variant_type`. Setting it would need a raw-tier column (a migration), and every
  identity key compares `COALESCE(variant_type, '')`, so a set value would split a re-read from its
  live copy in about fifteen dedupe and refresh paths. The name already carries the channel to rule 11.

**Dry run** (prod, read-only, Oct 27):
- Name rule: the v2 SQL twin, run over all 7,209 live wire rows, reclassifies 4: 15716 and 140285
  become channel rows, and so does 140286; 129879 stops being one. JS and PostgreSQL agree on all
  265 distinct live wire names that carry a channel, standard, negated or notice word stem
  (`__fixtures__/wire-channel-names-2026-10-27.ts`). One institution value moves today:
  - 2521, domestic outgoing: $40 to $20.
  - 978 still has only its $60 row live, so its value stays $60 until the $30 row arrives, then it is
    $30, not $45.
  - 6377's only incoming row stays its value.
- Knox: 187 live wire fees have a stored line that prints a channel word within 80 characters after
  a price. On those lines `wireChannelClause` names 3: 110356 "(phone request)", 110355 "(phone
  request)" and 71592 "(Recurring)". It names none of the six lines where the words are another
  service, a sentence or a condition: 24971, 47717, 89928, 147510, 128316 and 144913. Category and
  amount are unchanged, so the rules re-check's reproducible set is the same and no live fee
  comes down, changes value or re-files. No live name changes either: the publish step refuses a
  renamed re-read of the same printed line as a live fee (`same-line-read.ts`), so the three live
  rows keep their old names. That is the open line below.

**Open on #1912:**
- The three live names (110356, 110355, 71592) and 7711's $27.50 domestic value need a name
  refresh. That is a live-data change no pipeline step makes today.
- 4366's "$25.00 New" is still not read. The shared source check traces a price only after words
  that name it, and "$25.00 New" follows "Recurring /".
- 140286, "Wire Interna�onal Transfer-Remote Outgoing" $70, is an international wire filed as
  domestic. The lost "ti" ligature hides "International" from the category guard.

**Lesson:** a wire's channel has to reach its name, because the name is all that carries it. Read
"not in person" as the premium channel, not the standard one. Keep a channel printed after the price
as part of the name.

**Agent lesson:** knox/issue-1912-channel-after-price, hamilton/issue-1912-not-in-person-is-a-channel
**Guard:** `src/lib/wire-channel.test.ts`, `src/lib/agents/knox/wire-channel-clause.test.ts`, `src/lib/data-store/fee-stats.test.ts`
