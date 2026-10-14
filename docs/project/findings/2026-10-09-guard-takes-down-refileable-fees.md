# Category guard took down fees it should have re-filed

**Found:** Oct 9, 2026, 12:26 UTC (UAT, after PR 947).

The category guard took down live fees whose names belong to another type in the top 50: "Money Order Research Fee" filed as money_order, and "Bill Pay Stop Pay" filed as bill_pay. The guard's restore path could already bring such a fee back under the right type, but only after the fee had been taken down. Twice on Oct 9 a takedown beat the re-file meant for it: guard v57's ATM adjustments, and 95142, whose hand re-file (PR 947) only looks at live rows.

**Fix:** before a failing live fee goes to its second look, the guard asks `restoreTarget` where it belongs. The answer comes from a hand re-file, a fold split, or a checked re-file rule. If the target type is live and its guard accepts the name, the fee moves there in place (published and verified rows), logged as a fold. It is taken down only when no checked rule places it, or when the same fee is already live there. Eight of the 26 fees taken down at 12:26 traced to their page at their price under another type. They come back through `HAND_REFILES` in `category-guard.ts`.

**Still open:** an unchecked re-file rule (`REFILE_RULES` with no `RESTORE_REFILES` entry) still ends in a takedown. Each rule needs its own spot check before it can move fees.
