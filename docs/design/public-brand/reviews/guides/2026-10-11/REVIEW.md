# Guides review — 2026-10-11

Route: `/guides`  
PR: #1016  
Primary job: help a visitor choose a useful fee guide quickly.

## Copywriting skill

Source: `.agents/skills/copywriting/SKILL.md`

### Page purpose
Guide discovery, not product explanation.

### Primary action
Open a guide.

### Audience
Consumers looking up a fee or trying to understand a bank charge. Professional guides remain a separate secondary set.

### Message hierarchy
1. Understand bank fees.
2. Featured guides with live benchmark context.
3. More consumer guides.
4. Professional guides for bankers/consultants.

### Copywriting decisions
- Replaced the long data-coverage introduction with one sentence.
- Removed the monitored-institution count, observation count and freshness line from the hero.
- Removed the redundant "Explore More" navigation section because global navigation already provides those paths.
- Removed the professional-guide paragraph that explained the audience split before showing the guides.
- Kept live benchmark figures inside guide cards because they are useful proof, not explanatory copy.
- Preserved consumer-vs-professional separation without narrating it at length.
- Removed the serif editorial treatment so guide discovery matches the current public brand system.

## Copy-editing skill — Seven Sweeps

Source: `.agents/skills/copy-editing/SKILL.md`

### 1. Clarity
Before:
"Plain-language guides backed by live benchmark data from X institutions with published fees (of Y monitored). Free to read, and always will be."

After:
"Plain-language guides with live fee benchmarks from published bank and credit union schedules."

Result:
- one idea;
- no parenthetical count explanation;
- no unnecessary promise repeated in hero copy.

### 2. Voice and tone
- Removed mixed editorial-serif / product-sans voice.
- Kept plain, neutral wording.
- Consumer guide copy stays accessible without sounding promotional.

### 3. So What
- Retained benchmark figures inside cards because they help the reader decide which guide is relevant.
- Removed coverage statistics that did not help choose a guide.

### 4. Prove It
- Live benchmark numbers remain data-backed.
- No new trust claim, accuracy claim, customer proof or "always free" promise was added.
- CollectionPage structured data remains.

### 5. Specificity
- "live fee benchmarks from published bank and credit union schedules" replaces generic "live benchmark data."
- Guide-card medians remain category-specific.

### 6. Heightened emotion
No artificial emotional language added. This is a reference/discovery page; clarity is more useful than manufactured urgency.

### 7. Zero Risk
- Consumer and Pro guide groups remain visibly separated.
- No hidden pricing or forced conversion added.
- Guide links remain direct.
- No extra CTA competes with reading a guide.

## CRO / architecture

Before:
hero with coverage stats → featured guides → more guides → professional explainer → professional guides → Explore More navigation grid.

After:
short hero → featured guides → more guides → professional guides.

Removed:
- duplicate navigation section;
- redundant coverage metadata;
- redundant professional-audience explanation.

## SEO

Preserved:
- canonical URL;
- title and description;
- OpenGraph/Twitter metadata;
- CollectionPage JSON-LD;
- all guide URLs and internal links;
- fee/category terms on cards.

No route or slug changes.

## Visual system

Applied:
- Plus Jakarta Sans/public font hierarchy;
- shared rounded glass cards;
- fawn/parchment background glow;
- terracotta accents;
- shared numeric styling for medians;
- consistent hover/focus behavior.

## Implementation

- `22207fd3` — copy/CRO/brand simplification.
- `4356751c` — wrapper/compile cleanup.

## Approval status

Pending exact-head CI and new preview screenshot.
