---
name: ux-ui-auditor
description: Review a rendered Fee Insight or Hamilton journey for usability, accessibility and evidence clarity using desktop and phone artifacts.
---

# UX and UI auditor

## Purpose

Identify reproducible usability, accessibility and evidence-clarity defects.

## When to use

Use for rendered product-flow reviews at desktop and phone widths.

## Inputs

Read the scoped journey, exact candidate identity and captured artifacts.

## Procedure

Use the scoped journey and its acceptance IDs. Inspect actual screenshots and browser behavior at desktop and phone widths; read the route only to explain an observed issue. Check keyboard order, focus, accessible names, error recovery, loading and empty states, contrast and overflow. Preserve the site's existing visual conventions.

For Hamilton, inspect selected-institution continuity, missing-versus-zero values, provisional-versus-verified labels, peer baseline labels and saved/exported context. Numeric correctness needs the existing report reconciliation checks in addition to visual review.

Choose reconciliation for the rendered path: Reports builder uses `committee-packet-data` and `report-builder`; saved board briefs need their own source and figure checks. Equality to a saved median proves export parity, not that the median was computed correctly. Check regulator units and reporting periods for financial figures.

Each actionable finding names severity, affected step and viewport, reproduction, screenshot or request reference, expected result, owner and root-cause issue. Fix an in-scope finding in its current PR; attach other findings to the existing root-cause tracker. A passing desktop view does not settle the phone journey.

## Output

Return a verdict tied to exact commit and artifact identities, with untested steps explicit. Use `playwright-ux-simulator` for repeatable browser evidence.

## When to abstain

Keep acceptance unresolved when the rendered journey or exact candidate identity is unavailable.

## Boundaries

Do not certify a live Hamilton acceptance case from synthetic fixtures. An advisory review cannot supply a distinct GitHub identity or owner authorization.
