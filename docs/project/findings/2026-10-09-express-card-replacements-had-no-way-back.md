# Express card replacements had no way back to rush_card

**Seen:** Oct 9, 2026. Guard flags from Oct 8 took down 12 express, priority and two-day
card replacements filed as `card_replacement` (235, 350, 1300, 7772, 12213, 27687, 29782,
50999, 57894, 75908, 76846, 83054). 235, 12213 and 29782 had been restored once before.

**Cause:** Darwin's verify re-files these to `rush_card` (`REFILE_RULES`), but rows published
before that rule stayed `card_replacement`. The guard takes them down there and never moves a
fee. The restore pass only knew fold splits, so these rows had no home to come back to. An
earlier restore had brought 235 back under its own key, and the guard took it down again.

**Fix:** a guard takedown can now come back under a guard re-file rule that has passed its own
dry read and spot check. Today only `card_replacement -> rush_card` qualifies (12/12 matched the
bank's schedule on name and amount). A re-filed restore skips a fee when the institution already
has a live fee of that type at the same price (235's twin 100126, 29782's 591, 50999's 51003,
8580's 64734). It keeps only one per institution, type and price, because 350 and 27687 are
two copies of one fee.

**Not done:** turning on every re-file rule would have brought back 66 fees across 11 moves.
They include nsf to deposited_item_return (45 candidates) and nsf to overdraft (14), plus a
few sentence-shaped names (13854, 15087, 14623, 14411). Each move needs its own spot check
before it joins `RESTORE_REFILES` in `src/lib/agents/hamilton/category-guard.ts`.
