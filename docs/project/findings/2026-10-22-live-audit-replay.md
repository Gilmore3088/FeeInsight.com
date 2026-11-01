# 2026-10-22: The W43 live audit, replayed: most live errors start at extraction, and wrong names pass every stage

**Lesson:** Replay each weekly live audit in the shadow lab: most live errors start at extraction,
and wrong names pass every stage.

**What happened:** James's W43 live accuracy audit (1,201 published fees from 50 institutions,
checked against each bank's own schedule) sat as a local CSV. It could tell us what was wrong on
the live site that week, but not whether a later pipeline change would fix it or bring it back
(#2064: confirmed live errors become replayed cases). Its `schedule_quote` column holds no quoted
text: every row reads "Reference only: ...", naming a saved source file. So the rows were tied to
the saved source text they name. 43 saved schedule texts cover 575 rows. The other 626 are listed
as not replayable, by verdict and reason (445 cite only a saved PDF or HTML page, 111 cite no saved
text, and 96 are verdicts a text cannot show: stale source, wrong document, audience, can't verify).

Replayed through today's stages (`npm run test:shadow-lab`; Knox extract.rules@97, Darwin
verify.rules@3, Hamilton publish.rules@3, category guard v81; 0 provider calls), the 39 live-audit
cases give:

| Measure (live_audit, current pipeline) | Result |
|---|---|
| Recall: audited fees published at their category and price | 78.4% (338/431) |
| False publication: audited wrong fees published again | 27.3% (9/33) |
| Names: published fees whose name matches the schedule | 90.5% (287/317) |

Each of the 132 failures is charged to the first stage that got it wrong:
- **Extraction, 82 of the 93 missed fees:** 52 read under another category, 24 not read, 3 read
  at another price, 3 held by Knox (2 untraced, 1 eligibility).
- **Verify, 6:** all `category_mismatch`.
- **Publish gate, 5:** all `name_hold:cutoff_name`.
- **Passed every stage, 39:**
  - 9 wrong fees published again. 7 are wrong categories: a mobile-payment stop filed as
    `stop_payment`, a box late fee as `late_payment`, a night-deposit lost key as a box fee, a
    mortgage payoff fax and a $3 statement printout as `account_research`, a check copy as
    `document_reproduction`, and a credit-card replacement as a debit-card one. One is a $5 rush
    fee the schedule prices at $25. One is Morton's research fee, published without its
    half-hour unit.
  - 30 fees at the right category and price under a wrong name. 26 are safe deposit box sizes
    ("10x10 Annual Fee", "3 x 5") that never say safe deposit box.

**Cause:** Most live errors start at Knox's read. A misfiled or missing line can't be repaired
downstream: verify and the publish gate only remove fees. The wrong names come from Knox's read too
(the size cell of a box table without its heading). No later stage checks that a name says what
the fee is, so they publish. The 24 audited wrong fees that today's pipeline no longer publishes
show the rules added since the live reads (Knox v97, guard v81) already stop most of that class.

**Fix:** `src/lib/agents/deming/__fixtures__/live-audit-2026-w43.json` keeps the replayable rows,
the saved texts and the counts. It has no notes or local paths. The `live_audit` scenario
(`shadow-lab/live-audit.ts`) maps each verdict to expectations. The rules are in its tests and in
the Deming guide. A new name score (`shadow-lab/names.ts`) reports "Names: published fees whose
name matches the schedule" in the headline. The 351 live-audit expectations today's pipeline meets
are in `ratchet-baseline.json`, so a change that loses one fails the quality gates.

**Guard:** `src/lib/agents/deming/shadow-lab/ratchet-gate.test.ts` (in `npm run test:quality-gates`)
holds the 351 expectations. `live-audit.test.ts` and `names.test.ts` pin the verdict and name rules.

**Not done here:** no pipeline rule changes. The next fixes the replay points to are Knox's
box-size names and its category reads (52 misfiles), each in its own PR with Darwin's live re-check.
