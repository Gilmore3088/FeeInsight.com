# 2026-10-09: A guard bump reached live rows only when some lane next published
**What happened:** guard v52 (price ceilings, PR 786) merged at 01:41 and v53 (business wires,
PR 792) at 01:51. At 02:00 UAT still saw no flags from either, and Westerra 37416 still read
annual. The last guard sweep on prod ran at 01:48 in Montana's publish step, at guard 51
(`agent_run_events.detail.category_guard_version`). No publish step ran between then and 02:01:
the queue was busy with paid read steps.
**Cause:** the category guard and the frequency fill re-check every live fee, but only inside a
publish step. A version bump waited for the deploy and then for the next lane to reach publish.
**Fix:** the agent tick starts a "Re-check live fees" run (`hamilton/guard-catch-up.ts`) once per
category-guard and frequency-fill version pair. It runs a category guard pass and a frequency
fill over every live fee on the first tick after the deploy. Both are free steps, and the run
waits while the pipeline is paused. This PR.
**Lesson:** a check that changes with a version needs its own trigger. Riding another step means
it runs only when that step does.
