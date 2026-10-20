# Financial-record storage budget

Issue: #2205. Parent: #2196 / #1783 / #1048.

Read-only production measurement on October 19, 2026, approximately 07:25 Pacific:

| Component | Bytes |
|---|---:|
| Heap | 1,081,057,280 |
| Indexes | 142,770,176 |
| Total including TOAST | 1,224,163,328 |

The total is 1,167.45 MiB, matching the October 18 storage receipt's rounded 1,167.5 MB.
The existing watch labels MiB as MB; this budget uses the same unit and includes indexes/TOAST.
The measured total is stable between that receipt and this check.

FDIC holds 386,056 rows and NCUA 382,278: 768,334 rows total. Each source has 66 report
dates from 2010-03-31 through 2026-06-30. The newest quarter has 4,313 FDIC and 4,299 NCUA
filers, 8,612 total. Keep all existing history hot: this change alters no retention policy.

At today's measured total bytes per row, eight more quarters at that filer count cost about
104.7 MiB. Applying 25% headroom for wider rows, index and maintenance growth to the existing
history plus that two-year reserve gives about 1,590 MiB. The explicit cap is **1,600 MB**
in the watch's current units. This is a capacity estimate, not a claim of observed future growth;
the daily measurements should be rechecked after a new quarterly release.

The existing shared-table guard holds every writer once a recorded size exceeds the cap:
`fdic-financials`, `ncua-financials` and `ffiec-overdraft`. Exactly the cap still runs. That also
holds NCUA roster synchronization because it shares its financial step; the daily warning must
name the held sources, and a capacity review must precede a further increase. Do not bypass
the guard for a roster step that also writes this table.

No rows are deleted, exported or moved cold. No new storage service, migration, paid provider
or database setting is introduced. Existing daily storage measurements and warning/hold
receipts provide the operational check; deterministic tests exercise the actual writers at
the measured size and both sides of the cap.
