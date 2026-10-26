# Research completion must preserve its saved manifest

The first real PostgreSQL research acceptance run reproduced a completion failure: four data
and pilot checks passed, but verification left the job in `rendering`. The verifier changed
`research_verification` on the parsed manifest before comparing the selected JSON with the
stored JSON. The comparison therefore used the new value instead of the original preimage,
and PostgreSQL correctly updated no row.

Verification now builds a separate result object and compares against the untouched original.
The unit SQL fixture also returns independently deserialized reads and checks the manifest
comparison, so it no longer hides this bug by sharing objects with the simulated database.
The real PostgreSQL acceptance case passes after the fix.

The original refused connection was a stopped loopback test container, not evidence about
production availability. Restoring it established local integration access only. Production
source coverage still requires a connected production project.

**Guard:** `src/lib/research-database/run.test.ts` checks the unchanged JSON preimage;
`src/lib/research-database/research.db.test.ts` completes a real PostgreSQL report job.
