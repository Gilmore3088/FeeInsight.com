# 2026-10-07: Cloud sessions cannot open state legislature sites, and web search caps at 200 a turn
**What happened:** researching state fee laws for all 52 jurisdictions, every direct fetch of a
legislature or code site (leginfo.legislature.ca.gov, nysenate.gov, ilga.gov, malegislature.gov,
law.justia.com, law.cornell.edu and about 30 more) came back EGRESS_BLOCKED. Web search worked,
but the first pass of 8 parallel research agents stopped after 200 searches (the per-turn cap
shared by every agent), with 31 jurisdictions unsearched.
**Cause:** the project's cloud network policy allows few hosts; the search cap is per turn.
**Fix:** none for the network. The research reads official pages through search excerpts
restricted to official domains, and every rule records that (`verification`). Later passes
budgeted 6 to 7 searches per state and ran in separate turns.
**Lesson:** budget web searches per turn (about 200 across all agents) before fanning out research,
and treat anything read from a search excerpt as needing a check against the full text.
