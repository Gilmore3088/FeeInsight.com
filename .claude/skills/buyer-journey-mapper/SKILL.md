---
name: buyer-journey-mapper
description: Map a Fee Insight visitor or Hamilton subscriber journey into observable steps and acceptance checks before changing a product flow.
---

# Buyer journey mapper

## Purpose

Define observable acceptance for one visitor or subscriber task.

## When to use

Use before implementing or reviewing a product flow.

## Inputs

Start with the person's task, entry URL, account role and selected institution. Read the affected route and existing journey before proposing a new flow. Use canonical numeric institution IDs and preserve evidence-policy and source labels across Hamilton navigation.

## Procedure

Record each step as user action, destination or request, expected visible result, failure or empty state, and test/artifact reference. Include sign-in and subscription boundaries, the return destination after sign-in, and save/reopen or export when the task uses them. A missing fee must remain missing rather than become zero; a provisional figure must retain its label.

Exercise the actual institution picker when selection is part of the task. For cross-device work, reopen the same desktop-created artifact in a fresh authenticated phone context. Distinguish a saved board brief (`report_id`, saved figures) from the Reports builder's share link (layout/context, current data); one cannot prove persistence of the other.

Reuse `tests/e2e/hamilton/` and the H07 acceptance matrix in `docs/plans/hamilton-h07-acceptance-matrix.md`. Distinguish synthetic journey checks from the matrix's live acceptance cases. For a UI change, hand the frozen journey to `ux-ui-auditor` and `playwright-ux-simulator`; screenshots alone cannot verify fee calculations or source authority.

## Output

Return the journey map, scoped acceptance IDs and unresolved decisions.

## When to abstain

Keep the task unresolved when its user, objective or source authority cannot be established.

## Boundaries

Mapping a journey does not authorize sending outreach, activating billing or changing live data.
