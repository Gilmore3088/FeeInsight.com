# 2026-10-09: Live fee names cut from a sentence or a table
**What happened:** the 200-fee complete-record re-score (00:51 UTC) left 25 wrong names, and the
public sample report's own check (`audits/sample-report-check-2026-10-09.md`) found four more
(Ambler 51385 "to open the account. A Maintenance Service Charge of", Wells Fargo 68707 "Our
overdraft fee for Consumer checking accounts is", Customers Bank 84015, UEFCU 55904). A prod count
at 01:30 UTC found 1,125 live names with one of these shapes: a trailing connector word (564 at
412 banks), a glued column header ("Fee Wire Transfer In", "Charge Stop Payment Fee"), a list
bullet "+" (12), a condition clause after the name, a dangling "up to" / "per", a header cell cut to
its first letter ("... | F").
**Cause:** Knox reads the words before a price as the name. In prose schedules the words before
the price are a sentence ("You will be charged a monthly service fee of $5"); in tables a header
cell or the next column's first letters ride along. Retidy v1-v5 tidied joined cells and lead-in
words but kept a sentence as it was, and the release review held only v13/v16 fragment shapes.
**Fix:** retidy v6 (`knox/name-retidy.ts`, `repairCutoffName`) reads the fee's name out of the
sentence's last noun phrase and drops headers, bullets, conditions and dangling ranges; a dry
probe over the 1,125 names renamed 292 and left the rest for Knox to re-read. Release review v17
holds any held fee with one of these shapes (`isCutoffName`, hold reason `name_fragment`). Old
names stay in `pipeline_feedback` (`name_retidied`); no row is deleted. This PR; the renames land
over the following publish steps (40 institutions each).
**Lesson:** a rule that only recognises a bad shape (hold it) is half a fix; the live catalog
needs the repair side too, measured on prod before it ships.
