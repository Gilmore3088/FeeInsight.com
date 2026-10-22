# 2026-10-21: Most missing fees are lost at extraction, and two checks run only as sweeps after publication

Replay frozen sources stage by stage before fixing fees one at a time: the stage that fails names
the process fix.

**What happened:** James asked why fixes land fifteen fees at a time without a firmer base. The
first shadow lab run (`npm run test:shadow-lab`, Knox extract.rules@96, Darwin verify.rules@3,
Hamilton publish.rules@3, category guard v80) replayed 235 frozen cases from committed fixtures
through today's pure stages, with no database and no provider calls (0 calls, $0). The output was
identical across three runs per variant. Today's pipeline:

| Measure | Current | `hourly-at-verify` |
|---|---|---|
| Recall: answer-key fees published | 68.8% (902/1312) | 68.8% (902/1312) |
| False publication: known-wrong fees published | 26.8% (34/127) | 19.7% (25/127) |
| Duplicate prevention | 82.4% (14/17) | 82.4% (14/17) |
| Source attribution | 99.6% (1210/1215) | 99.6% (1210/1215) |
| Document gate (URL cases) | 100.0% (24/24) | 100.0% (24/24) |

Each failure is charged to the first stage that got it wrong. Of 450 failures:
- **Extraction, 376:** 373 missed fees, and 3 same-dollar lines Knox read more times than the page
  prints them.
- **Verify, 25.**
- **Publish gate, 15.**
- **Passed every stage, 34:** 16 not-a-fee readings, 9 hourly charges published as flat,
  6 wrong categories and 3 limits.

The 373 extraction misses, by what Knox did with the line:
- **164 were not read at all.**
- **105 were read under another category:** a read at the same price that shares a distinctive
  word with the answer key's line.
- **78 were read at another price:** the right category at a different price, or the same price
  on an unrelated line.
- **The other 26:** 19 were held as untraced, 4 were held for eligibility, and 3 are same-dollar
  cases Knox never read.

The split between misfiled and mispriced is a heuristic: it depends on which words count as
distinctive (a stricter word list gives 185, 63 and 99). "Most are never read" holds either way.
The split between misfiled and mispriced is a heuristic: it depends on which words count as
distinctive (a stricter word list gives 185, 63 and 99). "Most are never read" holds either way.
No single category dominates. The largest are monthly maintenance (12 not read) and deposited item
return (11 misfiled). Twelve of the 43 documents with an extraction miss hold half of them.

**Cause:**
- **Extraction:** most missing fees are lost here, mostly as lines Knox never reads, then as
  misfiled or mispriced reads. No downstream check can repair either.
- **Checks that run only as sweeps:** two of today's checks run only on live fees, after
  publication.
  - Darwin's verify can read an hourly price from the fee's own line (`settledFrequency`'s
    `hourly` option) but leaves it off; the live hourly sweep sets hourly afterwards (#1456).
  - Hamilton's publish-time limit guard reads only the fee name and amount; "Knox's excerpt is
    checked by the sweep" (`publish.ts` `publishSkipReason`). So "APPRAISAL | $450.00 & up" passes
    verify and publish today.

**Fix:** The lab, in this PR. It changes no production path. Two experiments ran on the same
frozen inputs:
- `hourly-at-verify` took the hourly false publications from 9 to 0 and lost no recall.
- `excerpt-at-publish` (`SHADOW_LAB_EXPERIMENT=excerpt-at-publish`) caught 2 of the 34 known-wrong
  fees and lost no recall.

Switching either on in production is a separate PR with Darwin's live re-check and a dry-run count,
as the Standing rules require. The next step is the unread lines, document by document, starting
with the twelve documents that hold half the misses.

**Lesson:** Before fixing a batch of live fees, replay the frozen sources and fix the stage where
the failures start. A check that runs only as a sweep on live fees is an output fix. Where a pure
check can run at the stage itself, move it there and measure it in the lab first.

**Guard:** `npm run test:shadow-lab` (`src/lib/agents/deming/shadow-lab/`). It measures and does
not gate; `frozen-inputs.json` pins its inputs. The failures it cannot replay yet (#1908, #1909,
#1911 and #1915, which have no committed source text) are listed in its report under #2064.
