# Fee index review — 2026-10-11

Route: `/fees`  
PR: #1016  
Primary job: let a visitor compare national fee benchmarks by category.

## Team decision

### DRAPER
Make the fee data the page. Remove explanatory sections that delay the benchmark tables.

### SHERLOCK
Visitors need:
- a category name;
- median / typical range;
- enough context to know the figure is sourced;
- a path to drill into a category.

They do not need repeated coverage counts, methodology prose, source lists and navigation choices before seeing the data.

### ERNEST
SEO/search intent retained:
- Bank Fee Index;
- bank fee benchmarks;
- credit union fee benchmarks;
- category pages and descriptive internal links.

Copy changes:
- headline simplified to the product name;
- one-sentence description;
- removed repeated source/coverage prose;
- removed duplicate methodology explanation;
- removed duplicate observation-count copy from each spotlight card;
- removed extra navigation-pills section.

### NORMAN
Old sequence:
hero → coverage metadata → sources → spotlight cards → methodology sentence → free/Pro explanation → four nav pills → tables.

New sequence:
hero → spotlight benchmarks → tables.

The sidebar and existing nav own secondary discovery.

### NIELSEN
No conversion or analytics event removed from the primary data interaction. Upgrade gate remains for gated categories.

### EDISON
Tables and benchmark cards are the product experience. Explanatory prose was removed instead of adding more cards.

### CARNEGIE
Pro is not pitched repeatedly before a visitor can inspect the public data. The existing upgrade gate remains the appropriate commercial boundary.

### MURROW
Page summary:
**Compare published bank and credit union fees by category.**

### BERNAYS
The page still states that figures come from institutions' published fee schedules. No new accuracy or market-superiority claim was introduced.

## Structural decisions

| Surface | Decision |
|---|---|
| Coverage/count metadata under hero | Cut |
| Separate source paragraph | Cut |
| Spotlight benchmark cards | Keep |
| Observation count repeated inside spotlight cards | Cut |
| Methodology explainer below cards | Cut |
| Free vs Pro explainer paragraph | Cut |
| Four navigation pills | Cut |
| Fee-family tables | Keep |
| Desktop sidebar | Keep for secondary navigation/context |
| Upgrade gate | Keep |

## Implementation

- `9a07e2e8` — cut duplicated explanation and move fee data to the front.
- Earlier visual-system commits remain in #1016 for shared glass surfaces, numeric alignment and typography.

## SEO notes

- Existing metadata remains intact.
- Dataset JSON-LD remains intact.
- Category links remain descriptive.
- No route or canonical change.

## Approval status

Pending exact-head CI and matched after screenshots.
