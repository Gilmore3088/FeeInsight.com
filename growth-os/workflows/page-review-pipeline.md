# Public page review pipeline

This workflow is required for substantive customer-facing page redesigns. It turns the Marketing Skills library and GrowthOS team into a product/release review system, not just a growth engine.

## Goal

James should be able to review a redesigned public page from one email without manually hunting through preview links, taking phone screenshots, or reconstructing what changed.

Each page moves through:

**production before → team/skill review → implementation → team/skill re-review → matching screenshots → approval email → approve/revise**

## Roles

### DRAPER — page owner / synthesis
- Defines the page's single primary job.
- Resolves conflicts between specialists.
- Rejects sections that do not earn their place.
- Produces the final change summary and approval recommendation.

### SHERLOCK — customer and market evidence
Uses:
- `customer-research`
- `competitors`
- `competitor-profiling`
- `product-marketing`

Checks:
- buyer/user questions;
- language customers use;
- alternative solutions;
- proof required for claims;
- whether the page answers the actual job rather than internal product structure.

### ERNEST — SEO + copy
Uses:
- `seo-audit`
- `copywriting`
- `copy-editing`
- `content-strategy`
- `ai-seo` where appropriate;
- `schema` and `programmatic-seo` on templated/search pages.

Checks:
- search intent;
- title/meta/H1 hierarchy;
- copy density;
- duplication;
- internal links;
- structured data;
- AI-tell removal;
- clarity and specificity.

### NORMAN — CRO / UX
Uses:
- `cro`
- `signup` where account creation is part of the page;
- `ab-testing` only for hypotheses/measurement design, never silent traffic experiments.

Checks:
- one primary action;
- cognitive load;
- first-screen usefulness;
- section order;
- progressive disclosure;
- CTA competition;
- mobile usability;
- whether explanatory prose can be removed.

### NIELSEN — measurement
Uses:
- `analytics`
- `attribution`

Checks:
- page view and meaningful interaction measurement;
- CTA events;
- funnel continuity;
- whether the redesign creates or removes measurable conversion steps;
- uses existing Vercel Analytics/Postgres stack unless separately approved.

### EDISON — product-led simplification
Uses:
- `free-tools`
- `lead-magnets`
- `onboarding`
- `programmatic-seo` where relevant.

Checks:
- whether a calculator, filter, visualization, search, selector, table, or other interaction can replace paragraphs;
- whether the interaction is reusable elsewhere.

### CARNEGIE — institutional buyer review
Uses:
- `sales-enablement`
- `revops`
- `prospecting` only for persona/objection understanding, never page-driven outreach.

Checks:
- buyer objections;
- procurement/price ambiguity;
- whether institutional value is concrete;
- whether copy sounds like generic sales language.

### MURROW — message compression
Uses:
- `copywriting`
- `copy-editing`
- `marketing-psychology`

Checks:
- can the page's main message be repeated accurately in one sentence?
- are claims memorable without hype?
- does the copy sound human and specific?

### BERNAYS — public-claim/reputation check
Uses public-relations principles and editorial policy.

Checks:
- claims likely to be quoted externally;
- overstatement/reputational risk;
- evidence and attribution;
- naming/regulatory sensitivity.

## Page execution

### 1. Freeze the before state

Before changing a page:

- record production URL;
- record exact production/main commit when available;
- capture desktop screenshot at 1440px width;
- capture mobile screenshot at approximately 390px width;
- capture full-page shots, plus targeted section shots when necessary;
- save the original visible copy for diffing;
- inventory sections/components and the current primary CTA.

Screenshots belong in a page review artifact directory, not as ad-hoc phone captures.

Recommended path:

`docs/design/public-brand/reviews/<route-slug>/<date>/before-desktop.png`  
`docs/design/public-brand/reviews/<route-slug>/<date>/before-mobile.png`

If repository storage becomes inappropriate for image volume, use the review artifact store and link it from the page receipt instead of committing large binaries.

### 2. Run the first team pass

For every major section/component, produce:

| Field | Required |
|---|---|
| Reader job | What the visitor is trying to do |
| Decision | Keep / cut / combine / collapse / rewrite |
| One-sentence message | The only idea this section must communicate |
| Proof | Evidence required |
| Interaction/CTA | Primary action, if any |
| SEO obligation | Search intent/headings/structured data/internal links that must survive |
| Analytics | Event/measurement requirement |
| Visual pattern | Data/table/card/form/etc.; do not default to prose |
| Current words | Visible copy count |
| Target words | Expected revised copy count |

The default question is **should this section exist?**, not **how should we restyle it?**

### 3. Implement against current product contracts

- Start from current main/current application data contracts.
- Do not copy stale page implementations merely because their styling is attractive.
- Reuse the shared public design system.
- Preserve accessibility, source evidence and search/indexing behavior.
- Avoid hidden product behavior changes in a visual/copy PR.

### 4. Run the second team pass

Run the revised page through the same specialists.

Minimum exit criteria:
- one clear primary job;
- one clear primary CTA/interaction;
- no redundant sections;
- no repeated proof paragraph;
- copy-editing sweeps passed;
- no unsupported claims;
- metadata/H1/search intent coherent;
- structured data preserved/updated;
- mobile hierarchy works;
- figures aligned/readable;
- analytics events still meaningful;
- no known current-product contradiction.

### 5. Capture the after state

Capture the preview at the same widths and comparable scroll positions as the before state:

- desktop full page;
- mobile full page;
- targeted component images only where the full-page image is not enough.

Record exact preview commit and deployment URL.

### 6. Build the review packet

Create `REVIEW.md` for the page with:

- page/route;
- primary job;
- before URL/commit;
- after URL/commit;
- before and after screenshot references;
- sections cut;
- sections combined/collapsed;
- estimated visible-copy reduction;
- SEO changes;
- copy changes;
- CRO/UX changes;
- analytics changes;
- unresolved product/content questions;
- specialist results;
- recommendation: **Approve** or **Revise before review**.

### 7. Create the approval email

One email per page.

Subject:

`Fee Insight review: <page name> — before / after`

Body structure:

1. One-line page goal.
2. Side-by-side or sequential BEFORE and AFTER screenshots for desktop.
3. Side-by-side or sequential BEFORE and AFTER screenshots for mobile.
4. Five bullets maximum:
   - what was removed;
   - what was simplified;
   - what changed for SEO;
   - what changed for conversion/usability;
   - anything James should pay special attention to.
5. Preview link.
6. Response instruction:

`Reply APPROVE to accept this page, or reply with changes. You do not need to mark up screenshots unless you want to.`

The email must not require James to reconstruct the old page from memory.

### 8. Approval handling

- **APPROVE:** mark the page approved in the route ledger with the reviewed commit SHA.
- **Feedback:** DRAPER translates feedback into page changes; relevant specialists rerun; send a new revision email.
- Approval applies to the reviewed exact page/commit. Material page changes after approval require another review packet.

## Batch behavior

Pages may be processed sequentially while James reviews earlier pages.

Do not send a flood of emails at once by default. Recommended flow:
- first homepage packet validates the review format;
- after James approves the format, send pages individually as they clear the gate.

## Release

A site-wide redesign can merge only when:
- required pages are either approved or explicitly deferred;
- exact-head CI is green;
- preview is live;
- no unresolved product-fact contradiction is being published;
- route ledger identifies every approved SHA/page.

Page approval is evidence. A passing build alone is not.
