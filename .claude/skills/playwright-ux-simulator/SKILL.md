---
name: playwright-ux-simulator
description: Execute frozen Fee Insight and Hamilton browser journeys against the exact local candidate and retain screenshots, console and request evidence.
---

# Playwright UX simulator

## Purpose

Execute the actual scoped journey and retain attributable browser evidence.

## When to use

Use for UI journey acceptance and Hamilton flow changes.

## Inputs

Read the journey contract and reuse the existing `tests/e2e/hamilton/` configuration and fixture server. The fixture database must be loopback-only and isolated from production. The existing server blanks provider, billing and email keys; keep that boundary. Use the pre-installed browser.

## Procedure

For exact-candidate evidence, force a fresh build and prohibit reuse of an unrelated server. Record commit SHA, build ID, test and fixture hashes, browser/toolchain version and viewport. Capture successful desktop/phone screenshots as well as failures, console/page errors, failed requests and HTTP error statuses without headers, cookies or request bodies. Preserve any expected failure's explicit test assertion and report unresolved errors.

Sanitize query strings and console/error text before retaining or sharing evidence; they can carry credentials or personal information even when headers are omitted. Prefer the isolated synthetic fixture environment. For cross-device persistence, record one saved artifact ID and reopen that same ID in a fresh phone context, including a different current-institution negative control.

Run the actual browser tests. A Vitest wrapper, authored PASS text or a screenshot without its journey does not establish browser success. Keep local evidence labeled local; authenticated Actions provenance and 90-day retention require the trusted workflow and collector.

Pair report exports with report reconciliation tests; a PDF download's name and signature do not establish its numbers.

## Output

Return the executed command, exit status, evidence paths, acceptance results and untested steps.

## When to abstain

Stop when the database is not loopback-only or the required browser/frozen source is unavailable.

## Boundaries

The existing isolated test harness owns fixture writes; this skill grants no database write authority. Never infer live data accuracy from the synthetic fixture database or activate a provider through a test.
