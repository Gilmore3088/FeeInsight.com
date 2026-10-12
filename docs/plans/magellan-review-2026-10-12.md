# Magellan review (2026-10-12)

Part of `docs/plans/pipeline-review-2026-10-12.md`. Magellan finds and fetches each institution's
fee documents (`src/lib/agents/magellan/AGENTS.md`). Everything downstream depends on it, so it
was reviewed first.

**Measured** = read-only production query, 2026-10-12, 7 days back unless stated.
**Code** = `main` at `fdd21bd7`, not checked against production.

## What Magellan does today (code)

Every institution goes through free methods first, in this order (`AGENTS.md`, finder table):

1. Free, pass 1: links on pages Rosetta ruled out, the previous link, homepage links, the
   sitemap (robots.txt `Sitemap:`, `/sitemap.xml`, sitemap indexes), one hop through
   Disclosures / Rates & Fees / Documents pages, learned paths for the bank's website platform,
   then guessed common paths.
2. Free, pass 2: paths that worked at banks on the same platform nationally, a same-site crawl
   (40 requests at most), the companion finder for second documents, and the bank's own site
   search ("fee schedule", rotating "account agreement" and others).
3. Paid, only when everything free failed: `paid_pick` (one cheap call choosing among homepage
   links), then `paid_web_search`.

Three more paid searches run in the `discover-paid` step:

- `schedule_search`: $10B+ banks, report requesters and state market leaders whose link is not
  the full consumer schedule, plus a second lane of up to 10 banks of any size that show fewer
  than 3 live fee categories.
- `website_find`: institutions with no website on file (5 per run).
- `blocked_fetch`: a paid fetch for pages that refuse plain requests, at most every 7 days.

**Every paid try is limited to once per calendar month per bank** (`date_trunc('month', NOW())`
in `paid-find.ts` and `schedule-search.ts`). Selection is national: requesters, then market
leaders, then largest assets first.

The learning core (`src/lib/agents/learning/`) records every attempt and never repeats a known
failure; state memory (`src/lib/agents/state-expert/memory.ts`) feeds strategy hints.

## What it did (measured)

**Spend.** Magellan reached its $150 monthly cap on 2026-10-11 and has made no paid calls since.
Daily: Oct 7 $51.56, Oct 8 $20.04, Oct 9 $23.41, Oct 10 $23.46, Oct 11 $6.12, Oct 12 $0.

**Paid search, last 7 days:**

| Search | Institutions | Searched twice or more | New document within 2 h | Cost | Per new document |
|---|---|---|---|---|---|
| `paid_find` | 1,182 | 2 | 108 (9%) | $60.27 | $0.56 |
| `schedule_search` | 1,135 (1,093 already had a document) | 4 | 109 (10%) | $70.03 | $0.64 |
| `website_find` | 382 | 13 | n/a | $16.54 | see below |

- Each paid search reads about 27,000 input tokens of search results (about 5 cents a call).
- `website_find` over 30 days: 382 searched, 67 now have a website, 44 a fee link, **26 live
  fees**, about $0.64 per institution that went live. It earns its keep.
- "Within 2 hours" undercounts documents stored by a later step, so the hit rates are a floor.

**Repeat work is not the problem.** Magellan almost never pays twice for the same institution in a
month. Knox, downstream, extracted 2,619 distinct texts in 7 days and only 97 twice ($7.26 of $75).

**Feedback from downstream works.** 496 of the institutions sent to `paid_find` already had a
document that a later stage had judged wrong, so the judgement does reach Magellan.

**Wrong documents still get through.** 815 published fees were taken down in 7 days because the
document belonged to another bank or an unconfirmed host (`other_bank_document`,
`unconfirmed_document_host`). The largest stored files include CRA public files and a marketing
flyer.

**Coverage (measured).** 3,835 of 8,522 active institutions have live fees. Of the 25 largest
institutions in each state (1,276), 454 have none; of the 100 largest (4,172), about 2,000 have
none. Coverage falls with size, from 82% at $10B+ to 37% under $100M.

## Where it falls short

1. **The goal is not encoded.** Selection is national by assets. Nothing aims for every state and
   size tier to reach a benchmark-ready count, so small institutions in small states wait longest.
2. **`schedule_search` looks in the wrong place.** 96% of its targets already had a document; it
   fills gaps (no overdraft price, a business-only link) for covered banks rather than finding
   anything for big banks that have nothing. James wants: for banks we do not have, look for
   everything (fee schedule, Truth in Savings disclosure, account agreement).
3. **Cooldowns reset on the 1st.** Found or not, every institution becomes due again at the start
   of each month. James wants: found, leave it 90 days; not found, try again later, never give up.
4. **No "not published online" state.** An institution that never publishes is searched, paid,
   every month forever.
5. **Wrong-bank documents pass discovery** and are only caught after publishing.
6. **The state experts do not steer.** They hint at strategies but do not own their state's
   coverage target or decide who is searched next.
7. **The budget notes are stale** ("Magellan $60"; the cap is $150).

## The expected run: "Magellan, let's start"

Assume the institution list does not change. When the pipeline is switched on:

**Phase 0, preflight (no spend).**
- Compute the coverage gap for every state and asset tier against the benchmark threshold.
- Each state expert produces its state's ordered work list: the tiers furthest below target
  first, and within a tier the institutions most likely to be found (website on file, known
  platform, larger first).
- The scorecard is live, so every wave is measured.

**Phase 1, build-out (waves).**
- Work through the lists in waves across all states, so every state moves together.
- For each institution: all free methods, then paid search for the fee schedule, then paid search
  for a Truth in Savings disclosure or account agreement.
- Found: no searching for 90 days. Missed twice by paid search: "not published online", re-tried
  every 90 to 180 days, never dropped.
- After each wave, the scorecard shows found, gone live and cost per new institution. Paid search
  stops for a tier whose hit rate falls below a floor James sets.

**Phase 2, maintenance.**
- Covered institutions are re-checked for free every quarter. Downstream runs only if the
  content changed.
- Paid search only for new gaps, requesters and customers.

**Rough cost, from last week's rates (an estimate, not a promise):** $0.56 of paid search per
document found, plus about $0.03 of Knox extraction per document. Finding documents for several
hundred to a thousand of the missing institutions is a few hundred dollars, inside existing caps.

## Changes (each is a GitHub issue under the Magellan tracker, #1027)

| # | Issue | Change | Kind |
|---|---|---|---|
| M1 | #1028 | Coverage target: benchmark-ready count per state and asset tier, computed and stored | Code |
| M2 | #1029 | State experts own their state's work list; Magellan's paid passes select from those lists, round-robin across states | Code |
| M3 | #1030 | Re-aim `schedule_search`: institutions without live fees first; look for fee schedule, Truth in Savings disclosure and account agreement | Code |
| M4 | #1031 | Rolling cooldowns: 90 days after a find, 30 days after a miss, counted from the attempt, not the calendar month | Code |
| M5 | #1032 | Escalation ladder and a "not published online" state, re-tried every 90–180 days | Code + migration |
| M6 | #1033 | Stop wrong-bank and non-fee documents before they are stored (host check, CRA files, flyers) | Code |
| M7 | #1034 | Check that Knox extracts fees from Truth in Savings disclosures and account agreements before M3 searches for them | Test |

Two smaller items are checklist lines in #1027 instead of issues (at most five issues per review,
#1047): lighter paid searches (was #1035, rides with M3), and correcting the stale budget notes
and setting Magellan's build-out cap (was #1036, needs James).

**Dependencies:** M1 before M2. M7 before M3. M4 and M5 together. The scorecard rebuild (master
tracker) should land before the first wave, so the waves are measured.

## Open decisions for James

- Benchmark threshold per state and tier (starting at 8).
- Paid-search hit-rate floor at which a tier stops being searched.
- Magellan's monthly cap during the build-out.
