# HAMILTON V2 — STRATEGY ENGINE UPGRADE SPEC

## Objective
Upgrade Hamilton from:
→ Section-based report writer

To:
→ System-level strategy engine capable of producing McKinsey-grade insights

## Status: Draft — needs discussion before planning

## Core Problems Identified
1. No global narrative layer (sections generated independently)
2. Over-constrained output (75 words, 3 sentences, 1 stat)
3. Narrow context per section (no cross-sectional reasoning)
4. Pricing overweighted vs revenue
5. No insight hierarchy or tension model
6. Macro data (FRED, Beige Book) underutilized

## Proposed Architecture
1. Add generateGlobalThesis() pass before section generation
2. Expand section input to include global + macro + revenue context
3. Loosen constraints (think 5-8, output 2-3)
4. Add priority rule: revenue > competitive dynamics > pricing
5. Upgrade editor pass to validate thesis alignment

## Open Questions
- How does this affect chat Hamilton (agents.ts) vs report Hamilton (voice.ts)?
- Should tension model be per-section rule or inherited from global thesis?
- What's the right token budget? Current: 500. Proposed: 1000+?
- How to test quality? Side-by-side comparison of current vs V2 output?
- Does the global thesis pass add too much latency for on-demand reports?
