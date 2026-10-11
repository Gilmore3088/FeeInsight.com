# For institutions review — 2026-10-11

Route: `/for-institutions`  
PR: #1016  
Primary job: show a banking team how Fee Insight helps them compare fees and choose the appropriate product/report path.

## Team decision

### DRAPER
The page should make one institutional argument, then show the actual report/product choices. Remove repeated persona and CTA sections.

### SHERLOCK
Buyer questions:
- can I compare my fees with named peers?
- can I inspect the evidence?
- can I turn the work into something usable internally?
- what are my report / Pro options?

The page does not need a separate section for every stakeholder role.

### ERNEST
Keep the bank-fee-benchmarking search intent and existing metadata. Shorten hero copy and remove repeated sales language. Do not repeat the unresolved legacy fixed-price report claim.

### NORMAN
Old top-level flow:
hero → report offer → Pro tools → comparison → four-persona grid → advisory upsell → final CTA.

New top-level flow:
hero → report options → Pro tools → comparison.

### NIELSEN
Hero Pro CTA remains explicitly tracked with placement `for_institutions_hero`. Report/product components keep their existing instrumentation.

### EDISON
Use the actual report/product modules instead of explaining the same value again in persona cards and closing sales sections.

### CARNEGIE
Institutional buying clarity improves by separating the two real choices: Pro and report options. Remove repeated generic sales pressure.

### MURROW
Page summary:
**Compare your fees with the market, then choose the report or Pro workflow you need.**

### BERNAYS
Removed legacy fixed-price language from the top-level page. No new claim about accuracy, savings or outcomes added.

## Structural decisions

| Surface | Decision |
|---|---|
| Hero | Rewrite / compress |
| Hero stats | Keep |
| Hero checklist | Cut |
| Report options | Keep |
| Pro tools | Keep |
| Comparison table | Keep |
| Persona/audience grid | Cut |
| Advisory upsell | Cut |
| Final repeated CTA | Cut |
| Fixed-price institution-report language | Cut from this page |

## Implementation

- `082ce480` — collapse repeated sales sections and lead with product value.

## Approval status

Pending exact-head CI and matched before/after screenshots.
