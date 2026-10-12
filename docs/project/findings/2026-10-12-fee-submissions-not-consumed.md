# 2026-10-12: fee submissions reach no agent

**What happened:** Read from code at `fdd21bd7`. `/submit-fees` (`src/app/submit-fees/actions.ts`)
accepts a URL only, no PDF, and writes `community_fee_submissions` with status `pending`. Pro
settings link to the same form with no priority. Accepting a submission in admin
(`acceptSourceSubmission`, `src/app/admin/quality/actions.ts`) overwrites the institution's
`fee_schedule_url` and adds a `source_validation_queue` row marked `manual_validation_needed`.
No agent reads `source_validation_queue` or `community_fee_submissions`; the only reader of the
queue is a count in `src/lib/data-store/admin-queries.ts`. An accepted link waits for the state
lane's next scheduled pass. Hand-found schedules for admins are hard-coded in
`src/lib/agents/magellan/operator-schedules.ts`, so adding one needs a deploy. The "Extract"
command on the admin institution page does run the whole pipeline at once.

**Cause:** The Oct 2 plan (`docs/plans/pipeline-self-learning-plan-2026-10-02.md`, phase 2B)
planned to make submissions queue inputs. It was not built.

**Fix:** Not yet. Tracked in #1038 under the pipeline review master tracker #1026 (finding 2): one priority intake
for a URL or a PDF, from an admin or a customer, added as a companion source rather than replacing
the link, run through the whole pipeline within the hour, with status shown to the submitter.

**Lesson:** A form that writes to a table is not intake until an agent consumes the table. Check
for a reader before calling a flow done.
