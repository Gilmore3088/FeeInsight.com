# Knox cut threshold figures out of fee names; rules fixes never reach stored names

**Found:** 2026-10-09, whole-record samples (ADMIN thread, rows 101115 and 102568). Owner: Data inventory thread.

**Problem:** `nameFrom` removed every dollar figure from a name, including a threshold that
belongs to it. "Cashier's Checks ($10,000.01 and Over)" was stored as "Cashier's Checks ( and Over)",
and "(balance below $1,000)" was cut to "(balance below". On 2026-10-09, about 340 live names had
a gap where a figure was cut out, and 9 more ended on a cut threshold. Maple FCU's 19 live names
began with the schedule's "Name" column label. A Knox rules version bump does not re-read current
copies (`KNOX_STALE_READ_BELOW_VERSION` is 26), so Knox v57 and v60 change new reads only.

**Fix:**
- Knox v60 keeps a figure that sits in a threshold parenthetical, drops a "Name" label, and no
  longer turns "In addition to the Card Replacement Fee" into "To the Card Replacement Fee".
- Name-retidy v7 applies the same tidy to stored live names. It also puts a cut figure back from
  the fee's own stored text. Each rename is logged as `name_retidied`, renames happen only while
  the name still traces, and nothing is deleted.
- The dry run on the 352 matching live names (each checked against its own schedule line) gave
  209 renames. Leading-sentence names that are still sentences are left as they are.

**Rule:** a Knox name-rule fix ships with a retidy version, or it only reaches new reads.
