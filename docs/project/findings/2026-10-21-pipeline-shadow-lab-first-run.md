# 2026-10-21: Most wrong and missing fees start at extraction, and two checks run only as sweeps after publication

Replay frozen sources stage by stage before fixing fees one at a time: the stage that fails names
the process fix.

**What happened:** James asked why fixes land fifteen fees at a time without a firmer base. The
first shadow lab run (`npm run test:shadow-lab`, Knox extract.rules@96, Darwin verify.rules@3,
Hamilton publish.rules@3, category guard v80) replayed 235 frozen cases from committed fixtures
through today's pure stages, with no database and no provider calls (0 calls, $0). The output was
identical across three runs per variant. Today's pipeline:

| Measure | Current | `hourly-at-verify` |
|---|---|---|
| Recall: answer-key fees published | 69.4% (926/1335) | 69.4% (926/1335) |
| False publication: known-wrong fees published | 26.8% (34/127) | 19.7% (25/127) |
| Duplicate prevention | 70.0% (14/20) | 70.0% (14/20) |
| Source attribution | 99.6% (1211/1216) | 99.6% (1211/1216) |
| Document gate (URL cases) | 100.0% (24/24) | 100.0% (24/24) |

Each failure is charged to the first stage that got it wrong. Of 449 failures, 373 are at
extraction (370 missed fees and 3 same-dollar lines not read apart), 25 at verify, 17 at the
publish gate, and 34 known-wrong fees passed every stage.
- **Missed fees:** 347 of the 370 extraction misses are lines Knox never read at all; 19 were held
  untraced and 4 held for eligibility. Eleven of the 40 documents with a miss hold half of them.
- **Known-wrong fees:** the 34 that passed every stage are 16 not-a-fee readings, 9 hourly charges
  published as flat, 6 wrong categories and 3 limits.

**Cause:** Two of today's checks run only on live fees, after publication:
- Darwin's verify can read an hourly price from the fee's own line (`settledFrequency`'s `hourly`
  option) but leaves it off; the live hourly sweep sets hourly afterwards (#1456).
- Hamilton's publish-time limit guard reads only the fee name and amount; "Knox's excerpt is
  checked by the sweep" (`publish.ts` `publishSkipReason`). So "APPRAISAL | $450.00 & up" passes
  verify and publish today.

Recall is lost mostly at extraction, which no downstream check can repair.

**Fix:** The lab, in this PR. It changes no production path. Two experiments ran on the same
frozen inputs:
- `hourly-at-verify` took the hourly false publications from 9 to 0 and lost no recall.
- `excerpt-at-publish` (`SHADOW_LAB_EXPERIMENT=excerpt-at-publish`) caught 2 of the 34 known-wrong
  fees and lost no recall.

Switching either on in production is a separate PR with Darwin's live re-check and a dry-run count,
as the Standing rules require.

**Lesson:** Before fixing a batch of live fees, replay the frozen sources and fix the stage where
the failures start. A check that runs only as a sweep on live fees is an output fix. Where a pure
check can run at the stage itself, move it there and measure it in the lab first.

**Guard:** `npm run test:shadow-lab` (`src/lib/agents/deming/shadow-lab/`). It measures and does
not gate; `frozen-inputs.json` pins its inputs. The failures it cannot replay yet (#1908, #1909,
#1911 and #1915, which have no committed source text) are listed in its report under #2064.
