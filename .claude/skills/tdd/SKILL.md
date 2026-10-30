---
name: tdd
description: Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", wants integration tests, or a session changes a pipeline agent rule (Knox, Darwin, Rosetta, Magellan) that decides which fees go live.
---

# Test-Driven Development

TDD is the red → green loop. This skill is the reference that makes that loop produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle: consult them before and during the loop, not after.

Adapted for Fee Insight from Matt Pocock's skills (github.com/mattpocock/skills, MIT; see `LICENSE`).
CLAUDE.md wins wherever this file and it differ.

When exploring the codebase, read `docs/project/GLOSSARY.md` (if it exists) so test names and interface vocabulary match the project's domain language, and respect the decisions in `docs/project/LESSONS.md` for the area you're touching.

## In this repo

- Tests are vitest files next to the code (`*.test.ts`); journeys are Playwright. CI runs every
  vitest file, so a new test file needs no registration.
- Never skip, disable or quarantine a test to get green.
- A rule that decides which fees go live (Knox extraction or categorisation, Darwin checks) starts
  with a failing test built from a real case: the stored document text or a minimal fixture copied
  from it, with the expected amount and category from the bank's own schedule. That is an
  independent source of truth; the rule's own output is not.

## What a good test is

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test reads like a specification: "overdraft fee in a two-column table is read as $35" tells you exactly what capability exists, and it survives refactors because it doesn't care about internal structure.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidelines.

## Seams: where tests go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals.

**Test only at stated seams.** Before writing any test, write down the seams under test, each with a one-line note on what it catches and what it misses, and put that list in the thread or PR. If the user is around, confirm it; if not, proceed with your list and say which you chose. You can't test everything, so naming the seams up front is how testing effort lands on the critical paths and complex logic instead of every edge case.

For a pipeline agent the seam is usually the agent's exported step function or rule set (for
example `src/lib/agents/knox/rules.ts`), not the database tables it writes.

## Anti-patterns

- **Implementation-coupled**: mocks internal collaborators, tests private methods, or verifies through a side channel (querying the database instead of using the interface). The tell: the test breaks when you refactor but behavior hasn't changed.
- **Tautological**: the assertion recomputes the expected value the way the code does (`expect(add(a, b)).toBe(a + b)`, a snapshot derived by hand the same way, a constant asserted equal to itself), so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth: a known-good literal, a worked example, the bank's fee schedule, the spec.
- **Horizontal slicing**: writing all tests first, then all implementation. Bulk tests verify _imagined_ behavior: you test the _shape_ of things rather than user-facing behavior, the tests go insensitive to real changes, and you commit to test structure before understanding the implementation. Work in **vertical slices** instead: one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last cycle taught you.

## Rules of the loop

- **Red before green.** Write the failing test first and watch it fail, then only enough code to pass it. Don't anticipate future tests or add speculative features.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactoring is not part of the loop.** It belongs to the review stage (`/code-review`, `/simplify`), not the red → green implementation cycle.
