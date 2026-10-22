# 2026-10-22: Knox read fees at the right price and held them for want of a name rule

When Knox reads a row at the right price but holds it unclassified, the reader worked and the name
rules did not. Those misses are fixed with wording rules, and only where the keys agree on the
category.

**What happened:** The shadow lab's extraction misses were listed by what Knox did with the
expected row. A scratch test (not committed) replayed every case with the per-document held caps
lifted. It kept the answer-key misses where Knox held a row unclassified at the key's own price,
under a name printed on the key's source line. That came to 49 answer-key rows across 24 documents,
plus 1 live-audit row.

**Cause:** No name rule knew the wording. Most were small variations on wordings Knox already files:
- "Bill Payer" for bill pay.
- "Cash Advanced Fee" for a cash advance.
- "Gift and Reloadable Travel Cards" for a gift card.
- "After balancing or research" for account research.

One was hidden by a label. In "Debit Card or PIN (Personal Identification Number) Expedited Order
(EFT Service Charge)", the "service charge" made the line read as monthly maintenance. The card
exclusion then left it unfiled.

**Fix:** Knox rules v101. `V101_HELD_VOCABULARY` in `src/lib/agents/knox/rules.ts` is tried after
every other name rule, the held-name rules included, so it only claims names nothing else files.

| Wording | Category | Miss it fixes (state key, price) |
|---|---|---|
| "bill payer" | bill pay | 7450 $0, 9308 $0 |
| "cash advanced" | cash advance | 3141 $0 |
| gift and/or/& ... cards | gift card purchase | 11477 $3 |
| ACH ... file / template | ACH origination | 1338 $15, 1338 $0.21 |
| balancing or research; account, records or special-request look-up | account research | 5703 $25, 4677 $10 |
| a bare "Account Closure" / "Account Closing" row (not a loan's or certificate's) | early closure | 60 $20, 12816 $5 |
| a refinance named first with its loan or line; a home equity line's early closure | other lending | 8034 $200, 8034 $100 |
| a parenthetical "(... Service Charge)" label on a card or loan line is read without the label | the name's own rule | 12752 $75 (rush card) |

Each rule has a near miss in `src/lib/agents/knox/held-vocabulary.test.ts` that must stay unfiled or
keep its own category:
- "Reloadable Travel Cards".
- "ACH File Returned" (an ACH return) and "ACH Debit Received".
- "Balance Look Up".
- "Loan Account Closure" and "Certificate Account Closure".
- "Early Account Closure" (stays a deposit account's early closure).
- A rate sheet's "Can be used for refinances or purchase loans".
- "Debit Card Monthly Service Charge".

The first cut also filed "Monthly Account Maintenance". At State key 3141 that row is a gift card's,
under its "Gift Card" heading. It scored one new wrong read in the seven-state gate, so the rule was
dropped.

**Left held on purpose (38 of the 49 rows; the other 11 are fixed above):**
- Named only by a heading, or a fragment for a name (18). Examples: "Incoming" and "Outgoing
  (Online) USD" under a wire heading, "Non-Customer", "Past Due After 30 Days", "There will be",
  "per day/Maximum 20 consecutive business days".
- Keys disagree, or the category is doubtful (13):
  - Printouts (3): research at one bank, copies at another.
  - "Monthly Account Maintenance" (1).
  - "Visa Over Limit Fee" (1): one key says lending, another leaves "Overlimit" unmapped.
  - "UCC Termination" (1): the fold files UCC filings as origination.
  - "Loan Extention Fee" (1): the key says origination, Knox's rule says other lending.
  - Reopened accounts (2): the keys say early closure, Knox's rule says not.
  - Bare "Expedited Delivery" (2): rush card at one bank, courier at another.
  - "Skip-a-Loan payment" (1).
  - A bare "Title Fee" (1).
- Earlier decisions kept (4): bare "Service Fee" and "Business Checking Fee" (v78), "Pin Number"
  (guard v80), and a credit-card-only "Credit Card Replacement".
- Account product names (3): "Checking Plus Annual Fee", "Direct Checking" and "Advantage Checking".

Category disagreements such as legal process vs garnishment are a separate item and were not
touched.

**Admit-only:** Every Texas, seven-state and shadow-lab text was read before and after the change
(a scratch comparison, not committed). No read was lost or re-filed. 22 reads were added: the 11
fixes above, once in the gate's copy of each text and once in the lab's. Some held rows got a
category but stay held: $0 bill payer and cash advance rows, Texas 2436's percentage "Refinance
Current CCU Loan", and one untraced "Account Closure" in the live audit. No dry-run count against
live stored texts was run (no database access in this session), so how many live held rows v101
files is not known. Hamilton's rules re-check re-reads each document once on the new signature; on
the fixtures, no fee it reproduces today stops reproducing.

Shadow lab, before -> after:
- Answer-key recall: 927 -> 940 of 1,312 (70.7% -> 71.6%).
- All-expected recall: 1,289 -> 1,302 of 1,766.
- Known-wrong fees published: 34 of 160, unchanged.
- Names: 313 of 317, unchanged. Fees outside the keys: 35, unchanged.
- Ratchet: 13 gained, 0 lost, locked in `ratchet-baseline.json`.

Gates, before -> after:
- Seven-state gate: 890 -> 903 right (CA 158 -> 161, FL 136 -> 137, GA 180 -> 185, MI 135 -> 138,
  MN 121 -> 122). 34 wrong, unchanged.
- Texas gate: 590 right / 11 wrong, unchanged. Held out: 60 / 4, unchanged.

The stale-read floor stays at v97 and name re-tidy at v26. Live documents get v101 on their next
read.

**Lesson:** A row read at the right price but held unclassified needs a name rule, not a reader
fix. Add the general wording last, so it only claims names nothing else files. Leave a wording held
when the keys file it differently at different banks, or only its heading can tell.

**Guard:** `src/lib/agents/knox/held-vocabulary.test.ts`; the seven-state gate floors (all 903); the
shadow lab ratchet baseline. Agent lesson: knox/held-vocabulary-from-misses.
