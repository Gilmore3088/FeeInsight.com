# 2026-11-02: Agent lessons reached only the paid read, and free steps claimed them anyway

**What happened:** The pipeline wiring audit (Nov 2, Gap 11) traced where role lessons go. A prose
lesson in `src/lib/agents/<agent>/role-lessons.ts` reaches a run in one place: the paid model prompt
(`lessonsForModel`, `lessonsForDocument` in `src/lib/agents/learning/lesson-reader.ts`). Knox's free
extractor writes nearly every fee: 10,222 free reads in the 3 days to Nov 2 (prod, read-only), against
the paid reads' handful. It read no lesson text. The runner still tagged every finished step of an
agent with `lessons_applied` and every one of the agent's lesson ids (`withLessonsApplied` in
`run-store.ts`), free steps included. `agent_lessons` is a mirror for the admin pages (the daily
`atlas-lesson-sync`); no run reads it.

**Cause:** A lesson was only prose, and a rules engine cannot run prose. The lessons that did change
the free read did it through a code fix in the same PR, but nothing tied the lesson to that code. The
step tag assumed that a lesson for the agent was a lesson the step used.

**Not the same thing:** `KNOX_READ_LESSONS_LIVE` and `KNOX_AUDIENCE_LESSONS_LIVE` (#2062) are not role
lessons. They read other agents' `pipeline_feedback` rows about one document's earlier reads
(Hamilton's frequency fill, Darwin's hourly frequency check, confirmed business-schedule takedowns,
wrong-payer and duplicate takedowns) and replay that fix when Knox reads the same document again.
They never read `role-lessons.ts`. They are off because switching them on changes reads: the audit
counts 136 audience and 125 frequency reads a day. Turning them on needs the sampled-clean review
(DECISIONS, 2026-10-20) of the reads they would change, and a `KNOX_RULES_STRATEGY` bump so older
texts are read again (the `KNOX_AUDIENCE_LESSONS_VERSION` manifest note says so). Their values belong
to the plan thread; this change does not touch them.

**Fix:**
- A lesson can carry a machine-checkable part, `freePathRule` (`lesson-types.ts`): the id of a rule
  in `src/lib/agents/knox/free-path-lessons.ts`. Each rule is a shared predicate that already has a
  Darwin live twin, so the 2026-10-15 rule (a holding rule ships with its live re-check) is met by
  the twin: `rate_floor` (`rateFloorOf`, `darwin.rate_floor`), `loan_payment_example`
  (`loanPaymentExampleMatch`, `darwin.loan_payment_example`), `no_fee_sentence`
  (`noFeeSentenceMatch`, `darwin.no_fee_sentence`) and `maintenance_per_item` (Darwin's
  `maintenancePerItem`, `darwin.maintenance_frequency_check`). Four Knox lessons have one.
- The free extract step runs every lesson with a rule on every read it writes, and puts
  `free_path_lessons` on the step detail: the lessons it ran, the ones that fired with up to 20
  lines each, and the prose-only lessons it did not apply.
- `withLessonsApplied` no longer claims prose lessons on a free step (`lessonsAppliedDetail`). A free
  step's `lessons_applied` holds only lessons whose rule held a read; `lessons_checked`,
  `lessons_fired` and `lessons_prose_only` say the rest. Provider steps are unchanged.
- Behind `KNOX_FREE_PATH_LESSONS_LIVE` (off), the step only reports. On, a read a lesson fires on is
  written held for review (`knox_review:taken_down` under `knox.role_lesson:<id>`), not sent to Darwin.

**Dry run (prod, read-only, Nov 2):**
- Lessons with a machine part, after this change: Knox 4 of 117, every other agent 0. Prose only:
  the other 113 Knox lessons and all 327 of the other agents'. Of the 113 Knox lessons the free
  extract step reads, 4 run and 109 are prose only (the other 4 Knox lessons are for other steps,
  such as extract-paid). `agent_lessons` has no column for the part; the repo is the source.
- Sample: the 10,222 free Knox reads written in the 3 days to Nov 2 05:00 (931 documents). The
  rules' own prefilters (Darwin's twin prefilters, and per-item wording on monthly maintenance reads)
  keep 251 rows. Of those, 230 were written as reads with a category. The four rules, run on the
  stored excerpt, fire on none of them. The rate floor test matches 9 rows, all lines Knox had already
  held as unclassified (cash advance and balance transfer floors). So on this sample, switching on
  would change 0 reads. The fixes these lessons came with already stop such reads; the rules now
  catch any read that slips past them, and the step says so.

**Guard:** `src/lib/agents/knox/free-path-lessons.test.ts`, `src/lib/agents/knox/extract.test.ts`
("free-path lessons (Gap 11)"), `src/lib/agents/run-store.test.ts` ("never tags a free step with
prose lessons it did not apply"). Agent lesson: knox/gap-11-a-lesson-the-free-read-cannot-run-is-not-applied.

**Lesson:** A lesson changes the free read only through a part a rule can run; a step records a lesson
as applied only when it changed a read, and lists the rest as prose only.
