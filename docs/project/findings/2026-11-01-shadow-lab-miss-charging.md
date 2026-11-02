# 2026-11-01: The shadow lab charged recall misses to the wrong cause, and its keys counted fees no one can find

**What happened:** The shadow lab (`src/lib/agents/deming/shadow-lab/`) charges every answer-key fee
that never publishes to the stage and reason where it was lost (`whereMissed` in `metrics.ts`).
Two of its rules for misses at Knox's read gave the wrong cause:

- A read Knox held with no category (`held:unclassified`) can never match a key, and the rule
  looked for holds only at the key's category. So when Knox read the key's own line at the key's
  price and held it unclassified, the miss showed up as `not_read`, `read_other_category` or
  `read_other_amount`.
- `read_other_category` needed only one shared word between the key's line and any read at the same
  price. Different lines at the same price passed: key 7450's "Cashier Checks 3 Free ..." was
  matched by "Bill Payer | Free".

Separately, the answer keys counted fees that can never be found. A key filed under a category the
top-50 fold retired (`RETIRED_CATEGORIES` in `src/lib/fee-fold.ts`), on a line the fold gives no
home, kept its retired category (`keyCategory` in `src/lib/agents/knox/answer-key-gate.ts` fell back
to the key's own category). Darwin always refuses a fee under a retired category
(`retired_category`), and James dropped fees with no home from the taxonomy on Oct 8 ("drop them --
the 248", DECISIONS). The Knox gate also gave credit for reads under retired categories when they
matched such a key, although those reads can never go live.

**Fix:**

- **Unclassified holds:** `whereMissed` charges a miss to `held_unclassified` when Knox held, with no
  category, a read at the key's price on the key's own line.
- **Same line:** `read_other_category` now needs the read's excerpt or its traced line to be the key's
  line (`isKeyLine`). That means the same text, or the same words in the same order once prices,
  punctuation and layout are set aside.
- **Same price, other line:** a read at the same price on another line is charged as
  `other_line_same_price`. A miss with no linked read is `not_read`. A key with no stored line (the
  live audit and the category cases) is still matched on price alone, as before.
- **Retired keys:** the gate's `keyCategory` returns no category when the fold gives a retired key no
  home, and a bare price line ("$125.00") is now named by the label printed above it, so key 12030's
  "Mortgage Modification $125.00" folds to `other_lending_fee`. `gateKeyExclusion` names each key the
  gate leaves out (`retired_category_no_home`). The shadow lab lists those keys in its report
  ("Answer-key fees left out"), and the Knox gates list them in `GateScore.excluded`.
- **Retired reads:** the Knox gates leave reads under a retired category out of `reads` and list them
  in `GateScore.retiredReads`.
- **Unchanged:** Knox, Darwin and Hamilton behave as before. Deming's daily replay of Knox's misses
  (`knox-misses.ts`) uses the same `gateKeyFor`, so it now marks these keys `not_scored`.

**Measured** (`npm run test:shadow-lab` on main eaf6bef and on this branch; 0 provider calls; the
same fees published):

| Measure | Before | After |
|---|---|---|
| Answer-key recall | 72.9% (956/1312) | 73.4% (956/1302) |
| All expected fees | 74.9% (1322/1766) | 75.3% (1322/1756) |
| Answer-key fees left out, listed by id | 0 | 10 (8 estatement_fee, 1 balance_inquiry, 1 od_line_of_credit) |

Answer-key misses (`missed_fees`) by stage and reason:

| Stage / reason | Before | After |
|---|---|---|
| extract / not_read | 125 | 46 |
| extract / read_other_category | 98 | 33 |
| extract / read_other_amount | 77 | 98 |
| extract / other_line_same_price | - | 87 |
| extract / held_unclassified | - | 31 (in 21 documents) |
| extract / held:untraced | 21 | 21 |
| extract / held:eligibility | 4 | 4 |
| verify / category_mismatch | 12 | 12 |
| verify / retired_category | 5 | 0 (the keys are left out) |
| verify / outside_envelope | 3 | 3 |
| publish_gate / name_hold:cutoff_name | 10 | 10 |
| publish_gate / category_guard:name_unsupported | 1 | 1 |

- **Live-audit misses:** unchanged. Their refs have no stored line.
- **`read_other_amount` grew by 21:** these misses have the key's category read at another price, and
  the old rule's shared word had charged them first as `read_other_category`.
- **Knox gates:** Texas all went from 589 right / 11 wrong (586 of 802 keys found) to 586 / 11 (583 of
  786), and held out stays 60 / 4. The seven states went from 915 / 30 (915 of 1223) to 910 / 29 (910
  of 1213). Every lost right read was a read under a retired category that Darwin refuses: Texas 2416
  and 2418 balance_inquiry and 2423 estatement_fee; states 7450, 5703, 3148, 3554 and 10279. The
  floors moved with that reason.
- **Ratchet baseline:** unchanged. No expectation was met or lost.

**Lesson:** a miss is charged to a cause only on evidence that ties the read to the key's own line.
Sharing a price or a word does not. A key the pipeline can never meet is left out of the
denominator by name, with its reason, never kept as a permanent miss and never dropped silently.

**Guard:** `src/lib/agents/deming/shadow-lab/metrics.test.ts` ("shadow lab miss charging"),
`src/lib/agents/knox/answer-key-gate.test.ts` and `src/lib/agents/knox/state-answer-key-gate.test.ts`
(each excluded key and retired read pinned). Agent lesson: deming/issue-2064-charge-a-miss-on-the-keys-own-line.
