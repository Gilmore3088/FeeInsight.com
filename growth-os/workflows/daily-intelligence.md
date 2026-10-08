# Daily intelligence loop (SHERLOCK, then DRAPER)

Follows the loop anatomy in `.agents/skills/marketing-loops/SKILL.md`.

| Part | This loop |
|---|---|
| Check cadence | Weekdays, once a day (proposed 13:00 UTC, after the pipeline's morning runs) |
| Acts when | SHERLOCK finds something new that our live data can answer |
| Purpose | A steady supply of sourced opportunities tied to a revenue KPI |
| Skills used | SHERLOCK: `competitors`, `competitor-profiling`, `customer-research`. DRAPER: `marketing-ideas`, `marketing-psychology` |
| Loop body | 1. SHERLOCK reads the last run file and open `growth` issues. 2. Searches its watch list (`agents/sherlock.md`). 3. For each candidate, queries prod for what our data supports. 4. Files 0 to 3 findings as `growth:new`. 5. DRAPER triages every `growth:new` issue: assign, backlog or close with a reason |
| Self-check | Each finding has a dated source, a live count with its time, and no fee-change claim. Duplicate search on open issues |
| State | The last run file in `growth-os/runs/` (what was searched and seen); open issues are the dedupe set; a source already filed in the last 30 days is skipped |
| Stop / bail-out | Fetch and search limits in `agents/sherlock.md`; 20 open `growth:new` stops filing; prod unreachable means findings wait; manual disable is removing the routine |
