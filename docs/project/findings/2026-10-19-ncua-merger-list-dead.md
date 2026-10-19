# NCUA credit union mergers never loaded: both addresses were dead

Issue: [#2306](https://github.com/Gilmore3088/FeeInsight.com/issues/2306), child of Hoovie tracker #1783.

The `industry-events` family `ncua-mergers` tried two NCUA addresses marked "unconfirmed" in
the code. Both return 404 (registry run 8051, 2026-10-17). The partition was recorded as
`empty`, source health counts an unblocked empty partition as a successful check, and the
source's other families kept it looking healthy. `institution_structure_events` held 0 NCUA
merger rows (2026-10-19 count: fdic-history 145,711; fed-orders 251; occ-merger-decisions 7;
ncua-liquidations 60). That is why no credit union deal, such as Randolph-Brooks absorbing
True Sky FCU, could appear anywhere.

Fix in this PR: `ncua-mergers` now reads NCUA's current Merger Activity and Insurance Report page
(one ZIP per quarter). A new family, `ncua-proposed-mergers`, reads NCUA's member-vote list
(checked 2026-10-19), with the merging credit union as the institution and the continuing credit
union's charter in `acquirer_cert`. Both names are matched exactly against credit union records only.

**Guard:** `src/lib/agents/magellan/registry/industry-events.test.ts` ("NCUA proposed mergers") pins
the page shape and the matching. A future dead address is still not caught. #2306 makes source
health treat an all-404 partition as failed.
