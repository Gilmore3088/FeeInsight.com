# Institution profile review — 2026-10-11

Route: `/institution/[id]`  
PR: #1016  
Primary job: show what one institution charges, with source-backed benchmark context.

## Team decision

### DRAPER
The page should answer "what does this institution charge?" before selling reports or explaining every secondary dataset.

### SHERLOCK
Core questions:
- what fees are published?
- how do they compare?
- when were they collected?
- where is the source?
- what additional context exists if I need it?

### ERNEST
Keep institution-specific search intent, metadata, title, description and structured data. Remove prose that repeats what the fee table already communicates.

### NORMAN
Reduce simultaneous visible modules. Secondary financial/regulatory material is useful but should not compete with the fee schedule.

### NIELSEN
No primary fee-table interaction or alert interaction removed. Existing account/report routes remain available.

### EDISON
The fee table is the product experience. Keep it visible. Put secondary context behind disclosure instead of adding explanatory sections.

### CARNEGIE
Remove repeated sales pressure. The page previously had a peer-rank report teaser, an offer band, a Pro-next-step card and a Pro sidebar card. Keep one clear Pro path rather than several overlapping pitches.

### MURROW
Page summary:
**See this institution's published fees first. Open financial and regulatory context when you need it.**

### BERNAYS
No new recommendation or competitive-superiority claim added. Source/status notices remain.

## Structural decisions

| Surface | Decision |
|---|---|
| Institution header | Keep, restyled |
| Publication status notice | Keep |
| Published fee table | Keep first |
| Peer-rank teaser | Keep |
| Narrative fee-profile summary | Cut |
| Metric row | Keep |
| Fee alerts / verification | Keep |
| Institution report offer band | Cut |
| Main-column Pro-next-step | Keep as the single visible Pro path for free users |
| Sidebar Pro sales card | Cut |
| Financial context | Collapse |
| Financial/regulatory deep context | Collapse into same disclosure |
| Regulator facts in sidebar | Keep |

## Implementation

- `96e3a614` — cut repeated promotion and collapse secondary context.
- `58bdf7f6` — remove obsolete narrative dependency.
- Earlier #1016 commits apply the shared rounded/glass visual system to the header, metrics and sidebar.

## SEO

- Existing institution metadata retained.
- Existing robots behavior for thin profiles retained.
- Existing Institution JSON-LD retained.
- No route or canonical change.

## Approval status

Pending exact-head CI and matched before/after screenshots.
