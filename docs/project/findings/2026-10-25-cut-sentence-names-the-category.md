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
cell ends in "a/an <X> fee of" (`FEE_OF_SENTENCE`, shared with name re-tidy), the fee is the phrase's:
its category is the phrase's and its name is the phrase ("NSF fee"). The read stays as before when:
- the phrase is generic ("a monthly fee of", "a service charge of", "an inactivity fee of"): the words
  before say what the charge is for ("Paper statements will have a monthly fee of", a Bill Pay
  inactivity fee). The first, ungated draft re-filed 11 live fees from these to monthly maintenance or
  dormant account in the dry run, all wrong, which is why the gate exists;
- the words before the phrase name a fee of their own ("... an appropriate Overdraft Fee or a
  Non-Sufficient Funds Fee of");
- no rule reads the line as a fee at all (a held mortgage "early closure fee of $750" stays held);
- cutting the words before would drop a condition (`dropsCondition`): the category follows the
  phrase, the name stays as read.
A combined "NSF/Overdraft Fee (per item)" has no such phrase and stays overdraft (v16, v82).
**Scope (read-only, Oct 25):** 972 live fees whose raw name or excerpt carries the phrase. Old and new
rules were run on each stored excerpt: 914 are read at their live amount, 222 of those come out
differently, all with the phrase as the name. 190 of the 222 already match the live name (re-tidy
had named them so); 32 at 31 institutions would show a new name ("There is a Replacement Card Fee" →
"Replacement Card Fee"). Two reads change category, both to the category the live fee already has
(66159 document_reproduction, 146953 minimum_balance). None leaves its live category. With the glyph
repaired, Reliance's fee is a third: overdraft under the old rules, nsf under the new. Each of the
three was checked against its document's newest completed text.
**Agent lesson:** knox/priced-noun-phrase-names-the-fee
