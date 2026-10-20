# 2026-10-19: the daily scoreboard sat queued all day behind state lanes
**What happened:** Atlas scoreboard run 9476 was queued at 12:17 UTC on Oct 19 and still had all
12 steps queued at 20:53 UTC. Its ledger shows 41 `step.deferred` events, each "score-answer-key
left queued: it needs about 150 s and the tick has 35-128 s left". The storage step
(`atlas-storage-retention`) is the run's last step, so the database measurement, the size
warnings and the three approved log trims did not run that day either. The trims have finished
only one run since they were switched on (Oct 18: 20,000 of 359,987 old event rows). The morning
brief stayed silent because it only reports a warning when a measurement exists.
**Cause:** #2174 (merged Oct 19, 09:54 UTC) set `score-answer-key`'s expected time to 150 s. On
Oct 17 and 18 the step itself took about 1 s. The scoreboard keeps a strict deadline, so it never
uses the first-run override, and it ranked behind idle state lanes. A fresh lane's first work is
about 185 s of the 270 s tick, so the scoreboard was never left 150 s.
**Fix:** this PR. A scoreboard run that has waited 15 minutes ranks right after report runs, so it
goes first in a tick and gets the whole tick. Lanes keep the first 15 minutes. When there is no
finished storage step in the last 36 hours, the morning brief now says so instead of saying
nothing.
**Lesson:** raising a step's expected time can starve a run that has a strict deadline. A run like
that needs a guaranteed slot, not whatever time is left. A missing measurement is a warning in
its own right.
**Guard:** `state-lane-budget.db.test.ts` ("gives the daily scoreboard the tick ahead of an idle
lane once it has waited 15 minutes" and the under-15-minutes case) and `daily-brief.test.ts`
("warns when Atlas has not measured the database within the window").
