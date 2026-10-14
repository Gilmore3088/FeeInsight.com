# Each retidy version bump restarted the scan from the lowest institution id

**Found:** 2026-10-09, while tracing the 47 live names that still read "to avoid" after PR 851.

The name-retidy scan works through about 100 messy institutions per publish step, in
institution-id order, and skips an institution once it holds a `v{version}:{max_fee_id}`
attempt. A version bump makes every institution due again, so the scan went back to id 1.
On Oct 9, v7 through v10 shipped within about 90 minutes. v8 reached institution 3699 before
v9 replaced it, and v10 had reached about 2,900 when this was found.

The result was that institutions above about 3,700 had not been looked at since v6. That included
7317, 5855, 4772 and 6338, whose "to avoid" names the v8 rule already cuts correctly.

**Fix:** the scan now orders due institutions by when retidy last looked at them, with
never-seen ones first. After a bump, the scan carries on where the last pass stopped. The
first-institution list still goes ahead of everything else.

**Lesson:** a resumable scan keyed on a version must also order by how recently each item was
seen. Otherwise, frequent bumps starve the tail.
