# 2026-10-09: Two hand-found fixes waited on a state lane and a day-long retry
**What happened:** PR 795 merged at 02:12 UTC. By 02:35, UAT found Northern Trust's (25) hand-found
deposit fee PDF timed out once, and none of the four stored pages on another bank's website had been
retired.
**Cause:** a timed-out companion page reaches the paid fetch only after two timeouts, and the plain
retry waits 24 hours. Northern Trust's site times out on this network every time (35 times in 9
hours on 2026-10-07). The other-host retirement ran inside `reviewStoredCompanions`, scoped to the
lane's state, so First United (OK) and Cornerstone (ND) waited for their own states' lanes.
**Fix:** a hand-found page goes to the paid fetch after one timeout, and the other-host retirement
covers every state on each pass.
**Lesson:** a rule that fixes known-bad rows should reach them on the next pass, not the next time
their state's lane comes around. A page a person checked does not need a second failure as proof.
