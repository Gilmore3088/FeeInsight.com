# Backlog coordination (superseded 2026-10-12)

This file described a multi-agent coordination setup: a coordinator thread, control issue #984,
work-in-progress caps per area, and intake checks that stopped parallel agents from colliding.
James replaced it on 2026-10-12 with one builder at a time, working from the Now list in issue
#1026 (`CLAUDE.md`, "How work runs"; `docs/project/DECISIONS.md`, 2026-10-12). The checks and
workflows it described were removed in #1046.

The full earlier text is in git history (`git log -- docs/project/BACKLOG.md`). What still holds
from it now lives in `CLAUDE.md`: one outcome, one branch, one PR; search before building; no branch
deletion, force-push or direct push to `main`; outreach stays parked.
