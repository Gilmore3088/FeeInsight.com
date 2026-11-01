# 2026-10-25: Knox filed a sentence's price by the words cut before its priced phrase
**What happened:** Reliance State Bank's live fee 140283 (document 31383) is named
"Overdra�s an NSF fee" (the � is the replacement character) at $30 and filed as nsf. The schedule line is "... to cover overdrafts an
NSF fee of $30.00 per item may also apply". It reads as nsf only because the PDF text garbles the
"ft" glyph of "overdrafts". The pending Rosetta glyph repair (`repairUnmappedGlyphs`) reads the word,
and with it Knox would name the fee "Overdrafts an NSF fee" and file the $30 NSF fee as overdraft.
**Cause:** Knox's rules pass named a price by the words before it on its cell ("overdrafts an NSF fee
of") and classified that name. The first fee pattern to match wins, and overdraft is listed before
nsf (on purpose, so a combined "NSF/Overdraft Fee" stays overdraft), so the fragment's "overdrafts"
decided the category. The phrase that actually prices the line, "an NSF fee of", was never read on its
own. Name re-tidy already names such a sentence by its last noun phrase (`FEE_OF_SENTENCE`), but only
the name, after the category was set.
**Fix:** Knox rules v114 (`pricedNounPhrase` in `src/lib/agents/knox/rules.ts`). When the price's own
cell ends in "a/an <X> fee of" (`FEE_OF_SENTENCE`, shared with name re-tidy), the phrase decides:
- Category: the phrase re-files the read only between overdraft and nsf, the pair this class
  misfiles. Any other disagreement keeps the read's category and name, because the words before are
  then the more specific fee. The independent review of #2637 found the general version filing
  "For incoming international wires, an incoming wire fee of $15.00" as a domestic wire, "Deposited
  items returned unpaid ... a returned item fee of $10" as NSF, "Garnishments and levies: a legal
  processing fee of $100" as legal process and "Subpoenas/Summons A Copy Fee of" as a plain copy fee.
  Its re-review found the overdraft-to-nsf re-file breaking Knox's paid-NSF-is-overdraft rules
  (v19, v34, v42, v43): "NSF items paid: an NSF fee of", "Courtesy Pay overdrafts an NSF fee of" and
  "Overdraft privilege items an NSF fee of" went to nsf. The re-file now skips words that say the
  bank paid or honored the item or name an overdraft program, reusing those rules' own patterns.
- Name: the phrase ("NSF fee"), unless the words cut before it carry a condition (`dropsCondition`)
  or a family qualifier (`FAMILY_QUALIFIER`: international, abroad, deposited, garnishment,
  subpoena, business, personal, non-customers, online, phone, same-day, money market and the like).
The read stays as before when:
- the phrase is generic ("a monthly fee of", "a service charge of", "an inactivity fee of"): the words
  before say what the charge is for ("Paper statements will have a monthly fee of", a Bill Pay
  inactivity fee). The first, ungated draft re-filed 11 live fees from these to monthly maintenance or
  dormant account in the dry run, all wrong, which is why the gate exists;
- the words before the phrase name a fee of their own ("... an appropriate Overdraft Fee or a
  Non-Sufficient Funds Fee of");
- no rule reads the line as a fee at all (a held mortgage "early closure fee of $750" stays held).
A combined "NSF/Overdraft Fee (per item)" has no such phrase and stays overdraft (v16, v82).
**Scope (read-only, Oct 25):** 972 live fees whose raw name or excerpt carries the phrase. Old and new
rules were run on each stored line, taking the candidate at the live amount whose old name is the raw
row's own (a line can price two fees the same). 914 are read at their live amount; 217 of those come
out differently, all with the phrase as the name and none in another category. 187 of the 217 already
match the live name (re-tidy had named them so); 30 at 29 institutions would show a new name ("There
is a Replacement Card Fee" → "Replacement Card Fee", "Overdraft occurs" → "Overdraft fee"), each
checked against its line. With the glyph repaired, Reliance's fee is the only category change:
overdraft under the old rules, nsf under the new, which its document's newest completed text bears out.
**Agent lesson:** knox/priced-noun-phrase-names-the-fee
