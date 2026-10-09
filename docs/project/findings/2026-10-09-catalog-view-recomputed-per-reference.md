# Each reference to published_fee_catalog recomputes the whole catalog

At 08:50:35 to 08:50:44 UTC on 2026-10-09, 49 `/institutions?state=XX` directory reads ran at once,
one per state, each taking 11 to 17 s. The pooler then refused new clients ("too many clients").

The directory query (`searchQualityCte` in `src/lib/data-store/search.ts`) referenced
`published_fee_catalog` twice. The second reference, the "verified but not yet published"
anti-join, was planned as a hash anti-join over the entire view. That rebuilt the view's
depth check and takedown subplans for all ~66,500 live rows, whatever state the page asked for.
On a quiet database, Texas took 1,019 ms and touched 270,621 buffers.

Fix: read the view once per query into a materialized `scope_catalog` CTE and point both uses
at it. A published row always carries its verified row's institution (Hamilton copies it on
publish; 0 of 66,504 rows differ on prod), so the scoped rows answer the anti-join exactly.
Texas now takes 293 ms and touches 59,389 buffers. Before and after match on all 8,775
institutions on prod.

Lesson: when a query needs `published_fee_catalog` more than once, materialize the scoped rows
once. The planner does not push an institution filter into the view's depth check.
