# 2026-11-01: names the taxonomy already places stayed held for want of a name rule

**What happened:** a read-only lab analysis on main eaf6bef sorted the shadow lab's 356 answer-key
misses by cause. One group, 34 rows across 19 documents, were clean "Name | $X" rows (or a name and
its price on the next line) that Knox either held as `unclassified` or did not read at all, although
the taxonomy, its aliases or DECISIONS already say where the fee goes: "Skip-a-Loan payment | $25",
"Title Fee | $18.00", "DMV Documentation and Transfer | $20.00", "Mortgage Payoff Processing Fee |
$25.00", "Foreign check acceptance $10.00", "Immigration letter $20.00".

**Cause:** Knox only files a name some rule's wording matches, and these wordings sat just outside
every rule. "skip-a-pay" and "skip payment" were read but "skip-a-loan-payment" and "Loan Skip Pay"
were not, although the guard's shared `SKIP_A_PAY` (#1335; James's Oct 17 call as recorded in PR #1766) and the taxonomy's skip-a-pay aliases
already say other lending. v75 and v101 had left several of these held on purpose because one key
disagreed at the time; the keys and DECISIONS now settle most of them. A name with no fee word ("Title
Fee" has one; "Skip-a-Loan payment" does not) was not even held, so the held pile undercounts these.

**Fix (Knox v161, `V161_HELD_NAME_VOCABULARY` in `src/lib/agents/knox/held-name-vocabulary.ts`):**
a list tried after every other name rule, so it only classifies a name that classifies as nothing
today: a skipped loan payment (other lending; not a late charge or a credit card's), a re-amortization
(the fold's mortgage modification, other lending), a payoff's processing (other lending), a foreign check's acceptance (collection item, DECISIONS 2026-10-08 "Own type"), an immigration letter, proof of funds
and a verification of funds or of a mortgage (account verification), a title the name ties to a vehicle and a DMV filing (vehicle title). A bare title fee or title transfer stays held as on main (see below).

Left held, each for a stated reason: a wire with no direction (the taxonomy has none, v75), a lone PIN
(guard v80 refuses it as card replacement), printouts (the keys split between research and copies),
UCC termination (DECISIONS v26 files UCC fees as origination, but a termination releases the lien and a
lien release stays other lending, Oct 8), a reopened account (the taxonomy's alias and Knox's rule
disagree), "Loan Extention" (the one key files that spelling as origination, Knox files "loan
extension" as other lending), credit card, phone transfer and over-limit fees (DECISIONS, Oct 7), a
plain amortization schedule (a category question for James, #1099, pinned in `rules.test.ts`), and
"Mortgage Modification": the fold would file it as other lending, but its one key row (State key
12030) is a bare "$125.00" under the retired mortgage_modification type, which the gates cannot fold
without the name, so the read would score as wrong in the seven-state gate and the golden set.

**Measured (all on frozen texts; no database), on main b72a24fee (DASH_LIST_ROWS_LIVE and DAILY_CAP_LINES_LIVE on, #2885) with this branch merged, the
vocabulary off (main's reading) against on:**

| Measure | Main | v161 |
|---|---|---|
| Shadow lab answer-key recall | 964 / 1,302 | 972 / 1,302 |
| Shadow lab all expected fees | 1,331 / 1,756 | 1,340 / 1,756 |
| Shadow lab false publication | 33 / 160 | 33 / 160 |
| Shadow lab published fees outside the keys | 32 | 32 |
| Texas gate (all; held out) | 586 right / 11 wrong; 60 / 4 | 586 / 11; 60 / 4 |
| Seven-state gate | 918 right / 29 wrong | 926 / 29 |
| Golden set recall | 1,331 / 1,766 | 1,340 / 1,766 |
| Golden set precision | 1,375 / 1,440 (65 wrong) | 1,386 / 1,451 (65 wrong) |
| Golden set known-wrong refused | 254 / 287 | 254 / 287 |

The lab's 11 new publications were each read against their own line: Loan Skip Pay $35 (11470),
Proof of Funds Letter $10 (12752), Immigration
letter $20 (3515), Year round skip-a-loan-payment $20 and Foreign check acceptance $10 (7114),
Skip-a-Loan payment $25 and Verification of mortgage $10 (8034), DMV Documentation and Transfer $20
(8036), Reamortization schedule $250 and Mortgage Payoff Processing Fee $25 (8085), and live audit
554's Immigration letter $10 (a two-column PDF: the left column prints "Immigration letter .... $10.00").

**Admit-only by construction and by test:** the list is read through `heldNameVocabularyKey` after
every other rule; with it off the free team's reading of all 333 frozen texts was byte-identical to
main eaf6bef's, and with it on every read and categorised hold main makes is kept and 11 are added
(`held-name-vocabulary-admit.test.ts`, which pins them).

**Live effect:** a new read only adds raw rows, and new fees publish through Darwin as usual, with
two limits from the reviews of #2888. A bare "Title Fee" or "Title transfers" is never placed. Whose
title it is (a mortgage's or a car's) only the section it sits in can say, and Knox has no section
structure to read: the same root cause #2872 stopped on. The first review's list of real estate
headings let "1st Mortgage Fees", "Escrow Services", "Deed and Title Services" and "Property Loans"
through; the second review's rule asking for a vehicle on the line or nearest heading was fooled by the
next row's "Auto Loan Payoff" and by a dated "Mortgage Fees (2026)" heading it skipped. After that
inversion it recovered no fee at all, so it was dropped: State key 3141's "Title Fee | $18.00" (keyed
vehicle title) and Texas key 38's "Title transfers – $25.00" stay held, as on main, for that reason.
`bare-title-held.test.ts` keeps every reviewer input and proves each reads as main. A read only the vocabulary names never
publishes onto a printed line a live fee already holds, in any category (`selectLiveFeeOnLine` in
Hamilton's publish): the same-line refusal before it is scoped to the read's own category, so without
this a vocabulary read could go live beside another category's fee of the same line and Darwin's
line-conflict check would then retire one of the two.

Hamilton's rules re-check reads with the vocabulary, so a fee it publishes stays reproduced and it
takes down no fee it keeps today; its restore of fees an earlier re-check took down reads with the
vocabulary too, so a taken-down fee the vocabulary now reads can come back over the restore bar.

Five paths change a fee already live and could turn an added read into a re-file, rename or twin
takedown: Knox's re-read of Darwin's requests (`decideRereads`), Darwin's re-read category check,
its overdraft-transfer and protection-item re-files, the live name re-tidy (`planLiveRetidy`, whose
read cache now keys on the vocabulary's state) and Hamilton's live name refresh
(`judgeLiveNameRefresh`, on through `LIVE_NAME_REFRESH_LIVE`). Each reads without the vocabulary while
`HELD_VOCABULARY_RELABEL_LIVE` is off (the default) and acts exactly as on main
(`held-vocabulary-live-paths.test.ts`). Their switch-on upper bound is section 6 of `npm run
audit:switch-dry-runs`, not yet run (it needs the production read). So no live fee is re-filed,
renamed or taken down by the vocabulary itself; two standing rules still apply to any new
publication, as to any recall gain: a newer document's read of a live fee's own name at a new price
supersedes it, and Darwin's live checks judge the new fee like any other.

Every other caller of `classifyFeeText`, `classifyPatternKey`, `publishedFeeName` and
`publishNameHold` admits (Knox's extraction readers, the held and superseded re-checks that send
rows to Darwin, Hamilton's publish and its guard re-queue) or only reports (the shadow lab, the
switch dry runs, Deming's error classes).

**Guard:** `src/lib/agents/knox/held-name-vocabulary.test.ts` (15 positives, 51 look-alikes, the
next-line cap), `bare-title-held.test.ts`, `held-vocabulary-live-paths.test.ts` (the five gated
paths), `src/lib/agents/hamilton/vocabulary-line.test.ts`, `held-name-vocabulary-admit.test.ts`, the
raised Texas and seven-state floors and the ratchet baseline. **Agent lesson:** knox/issue-1092-name-what-the-taxonomy-already-places.
