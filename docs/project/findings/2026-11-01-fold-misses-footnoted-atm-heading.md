# 2026-11-01: The retired-category fold missed a footnoted ATM heading, and read some other banks' ATMs as the bank's own

**What happened:** Texas key 2416 (Texas Bank and Trust) prints:

```
TBT or Allpoint ATM:  no fee
Non-TBT or Non-Allpoint ATM1:
Balance inquiry:  $0.75
...
1Foreign ATM terminals may impose an additional surcharge
```

The $0.75 is what a customer pays at another network's ATM, so it is a non-network ATM fee
(`atm_non_network:75`). The top-50 fold (`RETIRED_CATEGORIES.balance_inquiry` in `src/lib/fee-fold.ts`)
places a bare "Balance inquiry" by the ATM heading above it (`ownAtmSection`). That heading pattern,
`(\S+)\s+(?:atms?|machines?)\s*:`, does not match "ATM1:", because the footnote digit sits between
the machine word and the colon. So the fold took "TBT or Allpoint ATM:" as the nearest heading,
read it as the bank's own ATM, and gave the fee no home (`balance_inquiry#3`).

The same pattern reads only one word before the machine, so it also took other banks' ATMs for the
bank's own: "Non TBT ATM:" (the word is "TBT"), "Non-Austin Bank ATM:" and "Other Bank ATM:" ("Bank"),
"Other Banks' ATMs:", "Out of Area ATM:". A note mark on the bank's own heading ("Regions ATM1:",
"MoneyPass® ATM:", "Regions¹ ATM:") went the other way: no heading was seen, and a bare inquiry there
was filed as a non-network ATM fee.

**Why it matters live:** production re-files through the same fold. Hamilton's fold step
(`hamilton/taxonomy-fold.ts`) re-files verified and live fees under a retired category, and
Hamilton's rules re-check (`reproducibleFees`) and Darwin's re-read check (`reread-category-check.ts`)
file Knox's reads with `refileCategory` and the section above them. A real non-network ATM fee under
a marked heading was lost, and an inquiry at the bank's own marked ATM could be published as one.

**Fix:** the heading read in `src/lib/fee-fold-atm-heading.ts`, behind `FOOTNOTED_ATM_HEADING_LIVE`
(off). Switched on, it:

- sees a note mark on the machine word: one footnote digit ("ATM1:", "ATMs1:"), superscripts
  ("ATM¹:", "ATM¹²:"), asterisks, daggers and a bracketed note ("ATM (1):", "ATM (a):");
- leaves product codes alone: "ATM10:", "ATM1A:", "ATM-1:" and "ATM1 Card:" are no headings;
- skips a marked heading whose word is a sentence's ("when you use an ATM*:"), so the heading above
  decides;
- reads a mark on the bank's name as that name ("Regions¹ ATM:", "MoneyPass® ATM:");
- reads another bank named in several words as another bank ("Non TBT", "Non-Austin Bank", "Non First
  Federal", "Other Bank", "Another Bank's", "Other Financial Institution", "Other Credit Union",
  "Out of Area"), but not a non-customer heading ("Non-Customer Regions ATM:") or a general heading over
  the bank's own ("Other Services" then "Regions ATM:");
- reads "In Network ATM:" as the bank's own, as main already reads "In-Network ATM:", and a negated
  heading as another network: "Not In Network ATM:", "NOT IN NETWORK ATM:", "ATMs not in network ATM:",
  "Non In-Network ATM:", "Not Our ATM:", "Out of Network ATM¹:", "Not a Regions ATM:", "Not at a Regions
  ATM:", "Not Owned by Regions ATM:", "Foreign Regions ATM:", "Except Regions ATM:", "Without Regions
  ATM:", "Nonproprietary ATM:", "NonRegions ATM:". "ATMs Not Owned by Regions:" and "ATMs outside our
  network:" are not "X ATM:" headings; they stay known gaps, read as main reads them;
- reads a heading's leading words from its own line only. While the switch is on, `foldContext` keeps
  the section's line breaks (`plainLines`, which lines up with `plain` character for character), so
  "Withdrawals at non-Regions ATMs" on the line above does not lead "Regions ATM:";
- skips a marked heading whose word names no bank ("Debit Card ATM1:", "Foreign Transaction Fees
  ATM*:"), so the heading above decides, as on main.

**Review of 634ce2e (#2892):** the first version read "Not In Network ATM:" as the bank's own, because
its "In Network" rule ran before any negation check, and its lead crossed into the line above. On
`reproducibleFees("ATM Fees\nRegions ATM:\nBalance Inquiry $0.00\nNot In Network ATM:\nBalance Inquiry $1.50\n")`
the switch turned a correct `atm_non_network:150` into `balance_inquiry:150`, which would have taken a
correct live fee down. Both are fixed, and every variant is a fixture.

Partner networks follow the existing rule: "Allpoint ATM:" and "MoneyPass ATM:" are the bank's own
when it names them so; "Non-Allpoint ATM¹:" is another network. A teller, phone or in-person inquiry
keeps no home under any heading, as before.

**Which path changes when:**

| Path | Switch off (default) | Switch on |
|---|---|---|
| Answer keys (Knox gates, shadow lab keys, Deming's miss replay; `keyCategory`) | marked read (always) | marked read |
| Knox reads in the gates and the lab (`reproducibleFees`, `refileCategory`) | main's read | marked read |
| Hamilton's fold step, rules re-check; Darwin's re-read check | main's read | marked read |

A key names the fee the bank's schedule prints, so it is folded with the marked read whatever the
switch says. The reads it is scored against follow the switch.

**Measured** (291 Texas, seven-state and lab texts; 0 provider calls):

- Main vs branch, switch off: every Knox read is the same, and every key fold but one. The one is
  Texas 2416's key, which leaves the exclusions: `balance_inquiry:75` with no home becomes
  `atm_non_network:75`.
- Switch off vs on: one read changes, Texas 2416's `balance_inquiry:75` to `atm_non_network:75`.
  Of 4,672 fee contexts in the texts, the heading read differs only in 2416's section. Of 2,899 Knox
  reads filed with their section (Darwin's verify, the rules re-check and the fold step file them so),
  only 2416's inquiry files differently. Checked by hand
  against the text above.
- Texas gate: main 586 right / 11 wrong, 583 of 786 key fees found, 19 keys left out. Branch, switch
  off: 586 / 11, 583 of 787, 18 left out (2416 now counts, read under its retired key). Switch on:
  587 / 11, 584 of 787. Held out 60 / 4 every way.
- Seven-state gate: 918 / 29, 918 of 1213, every way (main b72a24fee, with `DASH_LIST_ROWS_LIVE` and
  `DAILY_CAP_LINES_LIVE` on; 910 / 29 before it).
- Shadow lab (`npm run test:shadow-lab`, main and branch default, and `SHADOW_LAB_EXPERIMENT=footnoted-atm-heading`):
  answer-key recall 74.0% (964/1302), all expected fees 75.8% (1331/1756) on main b72a24fee, false publication 20.6%
  (33/160), the same each way. 2416 is a tuning key, and the lab replays held-out keys only.
- Ratchet: unchanged (the gate passes; no expectation met or lost).
- Golden-set receipt (`SWITCH_GATE_SWITCHES=FOOTNOTED_ATM_HEADING_LIVE`): pass, no member moved.
- The 91 near-miss cases (`src/lib/fee-fold-atm-heading.fixtures.ts`): the 61 main folds wrong are
  right with the switch on, and the 30 kept cases (two of them known gaps) fold as main either way.

**Live count:** section 5 of `npm run audit:switch-dry-runs` re-files every balance inquiry (Knox's
hint, or a verified or published balance_inquiry) against its document's newest text, switch off and
on, and counts the live and verified fees Hamilton's fold step would re-file into atm_non_network. For
the takedown count it reads every live atm_non_network fee Hamilton's rules re-check reads (its filters:
`fr.source = 'knox'`, not `knox_paid_extraction`, `amount_kind = 'flat'`), whatever Knox hinted. Each
fee is judged on the text whose `text_hash` it was read from (else the newest), switch off and on, by
the re-check's own pairing and verdict, now exported from `rules-recheck.ts` (`claimDocumentLines`,
`liveRowVerdict`): two live fees on one category and price share a read only as distinct lines, and a
fee the second look keeps (disputed) is counted apart. A fee that fails only with the switch on would
come down. It is read-only and runs on production by James. Its count is not known yet.

`FOLD_RULES_VERSION` stays 20 while the switch is off: off, every rule matches as before (the v17
pattern). It goes to 21 in the PR that turns the switch on. The category guard and source check
versions do not change.

**Lesson:** a heading pattern is only as good as the shapes it was written from. Footnote digits,
superscripts, asterisks and bracketed notes are printed on headings all the time, and a bank name has
more than one word. When a rule reads "the nearest heading", a heading it cannot see hands the decision
to the heading above it, which is often the opposite section. Test the near misses of each shape
before trusting an exclusion that rests on the rule.

**Guard:** `src/lib/fee-fold-atm-heading.test.ts` (91 near misses, the review's inputs, the switch's inertness, and the
fold step and rules re-check off and on), `src/lib/agents/knox/answer-key-gate.test.ts` (2416 scored as
`atm_non_network:75`; floors with the switch on) and
`src/lib/agents/deming/switch-dry-runs/atm-heading.test.ts`. Agent lesson:
hamilton/issue-1092-a-footnoted-heading-is-still-a-heading.
