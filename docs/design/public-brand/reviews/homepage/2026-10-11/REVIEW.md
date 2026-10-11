# Homepage review — 2026-10-11

Route: `/`  
PR: #1016  
Primary job: show the public fee lookup immediately while demonstrating the four concrete ways Fee Insight Pro delivers value.  
Secondary job: let banking teams see the product before they are asked to buy.

## Before

Production route: https://feeinsight.com/

Captured:
- desktop: 1440px viewport, full page about 3,140px tall
- mobile: 390px viewport, full page about 4,272px tall

The original homepage asked visitors to choose among three paths before doing the core task, repeated report/product explanations, contained a full institutional report-request flow on the homepage, and repeated source/provenance details in several forms.

## Team / skill pass

### DRAPER — message hierarchy

Decision:
- Keep institution lookup immediately accessible.
- Preserve the four rotating value-delivery examples in the hero: Benchmark, Analyze, Monitor, Report.
- Use live/current data in the examples where available.
- Keep detailed pricing and report-request flows on dedicated pages.

Main message:
**See what your bank charges.**

Secondary institutional message:
**Compare your fees with the market.**

### SHERLOCK — customer / buyer evidence

Relevant user questions:
- What does my bank charge?
- Where did that number come from?
- How does that compare with the market?
- If I work at a bank, what can I do with this data?

The old page answered all four at once before the visitor completed the first job. Revised page answers the first two immediately, shows market context beside the search, and gives banking teams one concise next step.

No invented customer research or proof was added.

### ERNEST — SEO + copywriting + copy editing

Preserved search intent:
- bank fees
- credit union fees
- overdraft / ATM / wire / monthly fees
- Bank Fee Index
- institution lookup

Preserved:
- Organization structured data
- WebSite / SearchAction structured data
- descriptive metadata
- internal links to institution directory, fee pages and methodology

Copy decisions:
- cut the three-path tab labels from the hero;
- cut four Explore explainer cards;
- cut the three-item lookup checklist;
- cut the benchmark/report explanation and fixed-price language from the hero;
- cut the full report-request explanation, report checklist and "what happens next" steps from the homepage;
- cut the "most coverage" state list;
- compress provenance to one line.

Copy-editing result:
- one idea per major section;
- no UI narration before interaction;
- no repeated report CTA;
- no new unsupported claims;
- no use of the unresolved legacy institution-report price.

### NORMAN — CRO / UX

Old interaction:
1. read product explanation;
2. choose one of three tabs;
3. interpret selected panel;
4. then search / explore / benchmark.

New interaction:
1. understand the public lookup;
2. search an institution;
3. watch or choose among the four live Pro examples: Benchmark, Analyze, Monitor, Report.

Primary interaction: institution search plus product demonstration in the same hero.

Secondary CTA: See Fee Insight Pro.

Progressive disclosure:
- detailed report choices: moved off homepage;
- methodology detail: methodology page;
- full fee catalog: fee pages;
- institutional workflow/pricing: pricing / dedicated institutional pages.

### NIELSEN — measurement

Preserved or explicit measurable actions:
- institution search path remains the primary interaction;
- Pro click from the institutional section is explicitly tracked as `upgrade_click` with placement `homepage_banking_teams`;
- existing public navigation and page analytics remain intact.

No new analytics vendor or instrumentation stack added.

### EDISON — product-led simplification

Replaced explanatory copy with existing product interactions/data:
- institution search replaces tabbed instructions;
- live fee benchmark module remains visible beside search;
- coverage map remains the geographic proof/usefulness module.

No new tool was added because existing search, benchmark and map components already perform the job.

### CARNEGIE — institutional buyer clarity

The homepage no longer tries to explain or sell every report variant.

Institutional value is reduced to:
- named peers;
- fee evidence;
- market context;
- board-ready brief.

Detailed objections, plan choice and pricing belong on the dedicated institutional/pricing surfaces.

### MURROW — message compression

Homepage summary:
**Search a bank or credit union and see its published fees, with market context and source evidence.**

Institutional summary:
**Hamilton turns fee and peer research into a board-ready brief.**

### BERNAYS — claims / reputation

No new accuracy claim, customer proof, recommendation claim or revenue claim was added.

The old fixed-price institution-report language was removed from the homepage because the repository contains conflicting offer definitions.

## Sections

| Section | Decision | Result |
|---|---|---|
| Product intro | Rewrite | Short eyebrow + headline + one sentence |
| Three-path tabs | Cut | Search is primary |
| Lookup checklist | Cut | Search UI is self-explanatory |
| Explore cards | Cut | Navigation already provides discovery |
| National fee benchmark module | Keep | Useful data beside search |
| Full report request section | Cut from homepage | Detailed conversion belongs on dedicated page |
| Sample report proof | Keep, compressed | Three visual report pages with one full-sample link |
| "What happens next" steps | Cut | Removed workflow narration |
| Banking-team pitch | Rewrite + collapse | One compact section + one CTA |
| Coverage map | Keep | Visual proof and discovery |
| Top coverage list | Cut | Duplicated map/state picker |
| Provenance tags | Combine | One concise source line + methodology link |

## Implementation commits

- `bacfe5ef` — make institution search the single primary homepage job
- `21dcbe3f` — collapse institutional pitch to one concise Pro path
- `24620196` — cut redundant coverage/provenance copy
- `d92f6ad4` — remove the legacy report flow from the homepage call site
- `194114e6` — restore three visual sample-report pages as compact proof
- `e52352c9` — place the compact sample-work section back on the homepage
- `eee3b852` — restore the shared four-example rotating showcase
- `61121e15` — put the rotating showcase back into the homepage hero
- `d8a4e8d1` — drive Benchmark, Analyze and Monitor examples from current data and reuse the real Report preview

## After

Current implementation head at time of this receipt: `d92f6ad4f8cb10e4cc75f8173a3c9507b10cb584`.

After screenshots are not yet attached to this receipt because the Vercel preview is protected and the current automated browser receives the Vercel login page. Production before screenshots were captured successfully. Do not substitute a Vercel login screenshot for the redesigned page.

## Approval status

**Revise before owner approval:** wait for exact-head CI and a valid authenticated/authorized visual capture of the redesigned page.

The page should not be merged based on this receipt alone.
