# State experts, Atlas, Deming, Bayes, learning core, Growth (2026-10-12)

Part of `docs/plans/pipeline-review-2026-10-12.md`. James asked what each of the newer or supporting
agents does, where it fits and what it costs. None of them makes paid model calls except Growth's
monthly email draft, which is switched off.

**Measured** = read-only production query, 2026-10-12. **Code** = `main` at `0a89d7ef`.

## Server time by agent, last 7 days (measured)

| Agent | Steps | Hours | Failed |
|---|---|---|---|
| Magellan | 6,127 | 50.6 | 46 |
| Hamilton (publishing and product) | 3,921 | 23.7 | 18 |
| Knox | 4,902 | 19.8 | 3 |
| Darwin | 4,974 | 7.6 | 0 |
| Rosetta | 3,557 | 6.8 | 0 |
| Growth | 102 | 0.2 | 0 |
| Atlas (including Deming, Bayes, scoreboard) | 809 | 0.1 | 1 |

State experts run inside each state lane's runs and are counted there.

## State experts

**What:** one memory per state (55): the regulator, the website platforms banks there use, which
search and reading methods worked there in the last 180 days, and price levels per fee and size
group (8 or more institutions). Plain database work.

**Where it fits:** step 2 of a state lane's full pass (monthly, more often while a state has many
banks without a fee link). Magellan reads it to order its searches; Darwin reads the price levels
for its peer hold; Hamilton uses it in report text.

**Gaps (code):** the "best reader" ranking is built for Rosetta, but Rosetta never reads it; the
platform list and regulator change no agent's behaviour; no admin page shows any expert (#1042).

## Atlas

**What:** the traffic controller. Every 5 minutes it clears stuck steps, picks the next state lanes
(at most 3 at a time), launches one-bank and one-state repair runs, and respects the pause switches.
Daily it runs the scoreboard, Deming, Bayes and the answer-key score, and emails the morning brief.

**How it picks states:** a lane overdue by 3 hours goes first; then by a priority score built from
open work, report demand, near-ready markets and uncovered market leaders.

**Gaps (code):** **nothing implements the coverage target James set** (30 per state and size group,
or 75%); Tennessee's priority research request expired on 2026-10-10 but is still configured, and a
Tennessee boost is hard-coded with no end date; much of Atlas's code lives outside its folder.

## Deming

**What:** the quality inspector. Daily it draws 200 live fees at random and checks each against the
bank's own stored schedule (amount, category, own document, real fee line, fee name). It also turns
every confirmed take-down into a permanent test case.

**Measured accuracy (fresh audit):** 99.5% on Oct 9, 94.0% on Oct 10, **92.0% on Oct 11** (184 of
200 right; 13 not from the bank's own schedule, 2 bad names, 1 amount not supported). The drop
follows stricter checks added on Oct 10 (own-schedule, name), so it is a truer number, not a
regression. This is the accuracy measure `CLAUDE.md` defines.

**Gaps (code):** results live only in step detail, not as dated records, so the trend depends on run
history; its guide does not mention the fresh audit; most regression cases cannot be replayed.

## Bayes

**What:** after a rule or reader version changes, it counts how much old work the new version still
has to redo, and flags a re-processing job that stops moving. It never reprocesses anything itself.

**Gaps (code):** no manifest for Rosetta's reader versions or Darwin's v3 rules, against its own rule
that every new version gets one.

## Learning core

**What:** the per-institution memory: every attempt logged, folded into a playbook (format, best
method, what not to retry), shown on the institution admin page.

**Gaps (code):** only Knox and Rosetta consult the router before acting (the guide says every stage
must); the guide's "not yet" list is out of date. The institution record (#1105) builds on this.

## Growth, content and marketing

**What:** drafts LinkedIn posts, monthly emails, outreach and follow-ups, press pitches and plans, and
gathers prospect contacts, into review queues for James. Parked with outreach.

**Cost and safety (code):** only the monthly email draft is paid, and its budget is seeded disabled.
Nothing sends without James's approval in admin; the morning brief is the only automatic email.
Several weekly growth jobs still run in dry or withdraw-only mode (0.2 hours a week).

**Gaps (code):** one content job is undocumented; pausing marketing also holds a send James already
approved (not documented). Review before marketing resumes.

## Changes

| # | Change |
|---|---|
| S1 #1117 | Atlas schedules state lanes toward James's coverage target (30 per state and size group, or 75%; district fallback), and the expired Tennessee settings come out |
| S2 #1118 | State memory changes behaviour: Rosetta reads the reader ranking, and the platform list feeds Knox's templates (#1101); experts shown in admin (#1042) |
| S3 #1119 | Deming's fresh audit is stored as dated results, its guide updated, and accuracy shown as a trend on the scorecard (#1040) |
| S4 #1120 | Bayes manifests for every versioned reader and rule (Rosetta, Darwin), with a CI check |
| S5 #1121 | Growth review before marketing resumes: document every job, decide whether a marketing pause should hold an approved send |
