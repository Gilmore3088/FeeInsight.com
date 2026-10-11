# Public-site redesign skill gate

PR #1016. This is the mandatory editorial, conversion, SEO and information-architecture gate for the Fee Insight public-site redesign.

The copied Marketing Skills library in `.agents/skills/` is an execution dependency for this redesign, not reference material. Every public page must pass the relevant skills before this PR can be marked ready for visual approval or merge.

## Shared context

Every review begins with `.agents/product-marketing.md` and `growth-os/context/editorial-policy.md`. Current product/release facts in the active codebase and issue tracker override stale statements in the marketing context; discrepancies must be flagged rather than silently copied into public copy.

## Mandatory skill sequence

Every public marketing or product-discovery page runs:

1. `product-marketing` — confirm audience, job-to-be-done, positioning, proof and conversion action.
2. `customer-research` — test the page against buyer language, questions, objections and information needs. Do not invent research.
3. `site-architecture` — confirm the page belongs, has one primary job, and does not duplicate another page.
4. `copywriting` — rewrite sections where the current message is structurally wrong or too verbose.
5. `copy-editing` — run all seven sweeps, especially Clarity, So What, Prove It and Specificity. Remove filler and repeated explanations.
6. `cro` — audit hierarchy, cognitive load, CTA priority, friction and progressive disclosure.
7. `seo-audit` — preserve search intent, metadata, headings, internal links, structured data and indexability while copy is compressed.

Additional skills:
- `pricing` for /subscribe and paid-offer sections.
- `schema` for pages with Dataset, Organization, FAQ, article or other structured data.
- `programmatic-seo` for templated fee, institution, state and district pages.
- `ai-seo` where answer-engine discoverability materially applies.

## Page rule

A page gets:
- one primary job;
- one primary CTA or interaction;
- one main idea per section;
- useful data or product interaction before explanatory prose whenever possible;
- progressive disclosure for methodology, provenance, definitions and secondary proof;
- no duplicated explanation already available on a dedicated page;
- no paragraph whose only job is to explain the UI below it;
- no repeated CTA phrased three different ways;
- no unsupported marketing claim.

## Visual rule

The editorial gate and visual gate run together. A page that has the correct font/palette but remains verbose, repetitive, badly aligned or structurally confusing is not redesigned.

The visual source of truth is the current /subscribe direction plus the approved landing-page direction:
- Plus Jakarta Sans;
- fawn/parchment/warm-neutral background;
- terracotta accent;
- rounded glass/shadow surfaces where a real grouping exists;
- consistent radius, spacing and control treatments;
- aligned tabular figures;
- avoid turning every sentence into a card or pill.

## Required route ledger

| Route/surface | Product/Research | Architecture | Copywriting | Copy-edit | CRO | SEO | Status |
|---|---|---|---|---|---|---|---|
| / | required | required | required | required | required | required | implemented; CI + screenshots pending |
| /subscribe | required | required | required | required | required | required + pricing | pending |
| /fees | required | required | required | required | required | required | implemented; CI + screenshots pending |
| /fees/[category] | required | required | required | required | required | required + programmatic | pending |
| /institutions | required | required | required | required | required | required + programmatic | pending |
| /institution/[id] | required | required | required | required | required | required + programmatic | implemented; CI + screenshots pending |
| /research | required | required | required | required | required | required | pending |
| /research/* | required | required | required | required | required | required + schema/programmatic where applicable | pending |
| /reports | required | required | required | required | required | required | pending |
| /reports/[slug] | required | required | required | required | required | required + schema | pending |
| /for-institutions | required | required | required | required | required | required | implemented; CI + screenshots pending |
| /guides | required | required | required | required | required | required | pending |
| /guides/* | required | required | required | required | required | required + schema | pending |
| /methodology | required | required | edit existing only | required | required | required | pending |
| /api-docs | required | required | edit existing only | required | required | required | pending |
| shared nav/footer/search/upgrade components | required | required | required | required | required | n/a except link semantics | pending |

## Per-section gate

For every section/component on every route, record:
- reader job;
- keep / cut / combine / collapse;
- one-sentence message;
- evidence required;
- CTA/interaction;
- SEO requirement if any;
- visual component pattern;
- final copy length versus current copy.

The default decision is not “restyle.” The default question is whether the section should exist at all.

## Release condition

#1016 stays draft until the ledger is complete and exact-head CI plus visual QA pass. “Font updated,” “palette updated,” “cards updated,” or “page compiles” are not completion evidence.
