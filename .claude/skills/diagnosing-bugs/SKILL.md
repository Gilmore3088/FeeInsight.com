---
name: diagnosing-bugs
description: Diagnosis loop for hard bugs, wrong fees and performance regressions. Use when the user says "diagnose"/"debug this", reports something broken/throwing/failing/slow, or a published fee is wrong and the pipeline step that caused it must be found.
---

# Diagnosing Bugs

A discipline for hard bugs. Skip phases only when explicitly justified.

Adapted for Fee Insight from Matt Pocock's skills (github.com/mattpocock/skills, MIT; see `LICENSE`).
CLAUDE.md wins wherever this file and it differ.

Before exploring, read `docs/project/GLOSSARY.md` (if it exists) for the project's terms, and
`docs/project/LESSONS.md` for decisions and past findings in the area you're touching. For a
pipeline agent, also read its `src/lib/agents/<agent>/AGENTS.md` and `role-lessons.ts`.

## Fee errors: find the step, not the fee

When the bug is a wrong published fee (amount, category, or a fee that should not be live), the
bug is in a pipeline step: discovery (Magellan), document capture (Magellan/Rosetta), reading
(Rosetta), extraction (Knox), categorisation (Knox) or verification (Darwin). The goal of this
skill is to name that step and fix it so the whole class of error is fixed (CLAUDE.md, "Fix the
input and the process, not the output"). An admin correction, hold or re-file of the one fee
comes last, after the process fix, never instead of it.

- Judge "wrong" with `checkFeeAgainstSource` in `src/lib/custom-report/source-check.ts`, the one
  shared check, not a new one.
- The best loop is usually a failing vitest test at that agent's seam, fed the stored document
  text (`agent_source_texts`) or a minimal fixture copied from it.
- Read the tier tables in order (`raw_fee_observations` -> `verified_fee_observations` ->
  `published_fee_records`) to see where the fee first went wrong; never the archived fee tables.

## Redact

This skill has you show commands, outputs and captured artifacts. **Redact every secret first**: write `<REDACTED>` in its place. Build loops against env vars, so the credential stays in the environment rather than in what you show. Captured artifacts carry auth headers: quote only the lines that carry the signal.

If the redacted output is not enough to diagnose the bug, say so and ask the user.

## Phase 1: Build a feedback loop

**This is the skill.** Everything else is mechanical. If you have a **tight** pass/fail signal for the bug (one that goes red on _this_ bug), you will find the cause; bisection, hypothesis-testing, and instrumentation all just consume it. If you don't have one, no amount of staring at code will save you.

Spend disproportionate effort here. **Be aggressive. Be creative. Refuse to give up.**

### Ways to construct one, in roughly this order

1. **Failing test** at whatever seam reaches the bug: unit, integration, e2e (vitest; Playwright for journeys).
2. **Curl / HTTP script** against a running dev server.
3. **CLI invocation** with a fixture input, diffing stdout against a known-good snapshot.
4. **Headless browser script** (the pre-installed Playwright Chromium) that drives the UI and asserts on DOM/console/network.
5. **Replay a captured trace.** Save a real payload, document text or event log to a fixture; replay it through the code path in isolation.
6. **Throwaway harness.** Spin up a minimal subset of the system (one module, mocked deps) that exercises the bug code path with a single function call.
7. **Property / fuzz loop.** If the bug is "sometimes wrong output", run 1000 random inputs and look for the failure mode.
8. **Bisection harness.** If the bug appeared between two known states (commit, dataset, version), automate "boot at state X, check, repeat" so you can `git bisect run` it.
9. **Differential loop.** Run the same input through old-version vs new-version (or two configs) and diff outputs.
10. **A captured artifact from the user.** Last resort. If only James can see the symptom (a live page, an email, a bank site the cloud can't reach), ask for one specific redacted artifact: a screenshot with its URL, the fee schedule PDF, or the page's text. Turn it into a fixture so the loop runs without him.

Never put a paid provider call inside the loop. Mock the model at `src/lib/ai-provider.ts` and
loop on the deterministic code around it.

Build the right feedback loop, and the bug is 90% fixed.

### Tighten the loop

Treat the loop as a product. Once you have _a_ loop, **tighten** it:

- Can I make it faster? (Cache setup, skip unrelated init, narrow the test scope.)
- Can I make the signal sharper? (Assert on the specific symptom, not "didn't crash".)
- Can I make it more deterministic? (Pin time, seed RNG, isolate filesystem, freeze network.)

A 30-second flaky loop is barely better than no loop; a 2-second deterministic one is tight, a debugging superpower.

### Non-deterministic bugs

The goal is not a clean repro but a **higher reproduction rate**. Loop the trigger 100×, parallelise, add stress, narrow timing windows, inject sleeps. A 50%-flake bug is debuggable; 1% is not, so keep raising the rate until it's debuggable.

### When you genuinely cannot build a loop

Stop and say so explicitly. List what you tried. Ask the user for: (a) access to whatever environment reproduces it, (b) a redacted captured artifact (log dump, document, screenshot with timestamps), or (c) permission to add temporary production instrumentation, which needs James's typed yes. Do **not** proceed to hypothesise without a loop, and never report a cause you have not reproduced.

### Completion criterion: a tight loop that goes red

Phase 1 is done when the loop is **tight** and **red-capable**: you can name **one command** (a script path, a test invocation, a curl) that you have **already run at least once** (show the invocation and its output, redacted), and that is:

- [ ] **Red-capable**: it drives the actual bug code path and asserts the **user's exact symptom**, so it can go red on this bug and green once fixed. Not "runs without erroring"; it must be able to _catch this specific bug_.
- [ ] **Deterministic**: same verdict every run (flaky bugs: a pinned, high reproduction rate, per above).
- [ ] **Fast**: seconds, not minutes.
- [ ] **Agent-runnable**: you can run it unattended.

If you catch yourself reading code to build a theory before this command exists, **stop: jumping straight to a hypothesis is the exact failure this skill prevents.** No red-capable command, no Phase 2.

## Phase 2: Reproduce + minimise

Run the loop. Watch it go red as the bug appears.

Confirm:

- [ ] The loop produces the failure mode the **user** described, not a different failure that happens to be nearby. Wrong bug = wrong fix.
- [ ] The failure is reproducible across multiple runs (or, for non-deterministic bugs, reproducible at a high enough rate to debug against).
- [ ] You have captured the exact symptom (error message, wrong output, slow timing) so later phases can verify the fix actually addresses it.

### Minimise

Once it's red, shrink the repro to the **smallest scenario that still goes red**. Cut inputs, callers, config, data, and steps **one at a time**, re-running the loop after each cut, and keep only what's load-bearing for the failure.

Why bother: a minimal repro shrinks the hypothesis space in Phase 3 (fewer moving parts left to suspect) and becomes the clean regression test in Phase 5.

Done when **every remaining element is load-bearing**: removing any one of them makes the loop go green.

Do not proceed until you have reproduced **and** minimised.

## Phase 3: Hypothesise

Generate **3–5 ranked hypotheses** before testing any of them. Single-hypothesis generation anchors on the first plausible idea.

Each hypothesis must be **falsifiable**: state the prediction it makes.

> Format: "If <X> is the cause, then <changing Y> will make the bug disappear / <changing Z> will make it worse."

If you cannot state the prediction, the hypothesis is a vibe: discard or sharpen it.

**Show the ranked list to the user before testing**, in plain words. They often have domain knowledge that re-ranks instantly ("we just deployed a change to #3"), or know hypotheses they've already ruled out. Cheap checkpoint, big time saver. Don't block on it; proceed with your ranking if the user is away.

## Phase 4: Instrument

Each probe must map to a specific prediction from Phase 3. **Change one variable at a time.**

Tool preference:

1. **Debugger / REPL inspection** if the env supports it. One breakpoint beats ten logs.
2. **Targeted logs** at the boundaries that distinguish hypotheses.
3. Never "log everything and grep".

**Tag every debug log** with a unique prefix, e.g. `[DEBUG-a4f2]`. Cleanup at the end becomes a single grep. Untagged logs survive; tagged logs die.

**Perf branch.** For performance regressions, logs are usually wrong. Instead: establish a baseline measurement (timing harness, `performance.now()`, profiler, query plan), then bisect. Measure first, fix second.

## Phase 5: Fix + regression test

Write the regression test **before the fix**, but only if there is a **correct seam** for it.

A correct seam is one where the test exercises the **real bug pattern** as it occurs at the call site. If the only available seam is too shallow (single-caller test when the bug needs multiple callers, unit test that can't replicate the chain that triggered the bug), a regression test there gives false confidence.

**If no correct seam exists, that itself is the finding.** Note it. The codebase architecture is preventing the bug from being locked down. Record it as a `docs/project/findings/` file (below).

If a correct seam exists:

1. Turn the minimised repro into a failing test at that seam.
2. Watch it fail. If you forced the red by mutating code or a fixture, `diff` against a pristine copy to prove the mutation landed before you trust it.
3. Apply the fix.
4. Watch it pass.
5. Re-run the Phase 1 feedback loop against the original (un-minimised) scenario.

For a pipeline fix, the same PR also carries what CLAUDE.md requires:

- A lesson in that agent's `src/lib/agents/<agent>/role-lessons.ts` when the PR closes an issue whose root cause is in that agent.
- When the fix holds, rejects or re-files fees: its live re-check in Darwin and a dry-run count of the live fees it would take down. Real counts only; if a count isn't known, say so.
- A `docs/project/findings/YYYY-MM-DD-slug.md` file and its `LESSONS.md` line when the cause was structural.

## Phase 6: Cleanup

Required before declaring done:

- [ ] Original repro no longer reproduces (re-run the Phase 1 loop)
- [ ] Regression test passes (or absence of seam is documented)
- [ ] All `[DEBUG-...]` instrumentation removed (`grep` the prefix)
- [ ] Throwaway prototypes deleted (no one-off scripts left in `scripts/`)
- [ ] The hypothesis that turned out correct is stated in the commit / PR message, so the next debugger learns
