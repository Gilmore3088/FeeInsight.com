# 2026-10-09: Prod still read Congress bills in shadow mode after the live switch was set
**What happened:** James set FEDERAL_BILLS_TRACKER_LIVE=true in Vercel at about 00:42 UTC Oct 9.
Prod redeployed after that (merges at 01:09 and 04:10). Even so, the 04:47 run (agent run 3286,
step 15568) logged "stored 0 (shadow mode: nothing stored)" and recorded detail.shadow=true for
source 'federal-bills', with 18 fee bills found. The Federal Register switch, set the same way
at 22:29 Oct 8, works: its 03:27 run stored 156 rules.
**Cause:** not yet known. The code accepted only the exact string "true", so stray spaces,
quotes or capitals would turn the switch off. So would a variable scoped to Preview only.
**Fix:** this PR reads every *_TRACKER_LIVE switch through `flagOn`, which allows for spaces,
quotes and case. The Congress step now records `live_flag` (on, unset or not_true) in its
partition detail, so the next run shows which case it was without exposing the value.
**Lesson:** a switch that silently reads as off needs to say why in the run it affects. When
a flag doesn't take, check the run's detail before guessing.
