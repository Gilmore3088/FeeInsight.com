# Marketing skills in this repo

Copied from [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) at
commit `b9ba399dd88b082b926e261e8ccfb843d20aa066` (2026-10-08), MIT license, copyright 2025 Corey
Haines. The license travels with the copy: `.agents/skills/MARKETINGSKILLS-LICENSE`.

Each skill lives in `.agents/skills/<name>/` unchanged except that its `evals/` folder (the
library's own tests) was left out. Where a skill names a paid tool, a booking link or ad spend,
`.agents/product-marketing.md` section 8 overrides it.

To update: re-copy the same directories from a newer commit, keep the license file, and change
the commit above.

## Who uses what

| Agent | Skills |
|---|---|
| DRAPER | `product-marketing`, `marketing-ideas`, `launch`, `marketing-psychology`, `marketing-loops` |
| SHERLOCK | `competitors`, `competitor-profiling`, `customer-research`, `product-marketing` |
| ERNEST | `content-strategy`, `copywriting`, `copy-editing`, `seo-audit`, `ai-seo`, `schema`, `programmatic-seo` |
| MURROW | `social`, `copywriting`, `copy-editing`, `marketing-psychology` |
| NORMAN | `cro`, `signup`, `copywriting`, `ab-testing` |
| NIELSEN | `analytics`, `attribution`, `ab-testing` |
| EDISON | `free-tools`, `lead-magnets`, `programmatic-seo`, `onboarding` |
| CARNEGIE | `prospecting`, `cold-email`, `sales-enablement`, `revops` |

Names in James's proposal mapped to the library's directories: `launch-strategy` is `launch`;
`competitor-analysis` is `competitors`; `competitor-profiles` is `competitor-profiling`; there is
no `positioning` skill (positioning lives in `product-marketing`).

## Not copied

Left out because they don't fit the plan or need paid channels: `ads`, `ad-creative`, `aso`,
`churn-prevention`, `co-marketing`, `community-marketing`, `directory-submissions`, `emails`
(the monthly email already exists in `src/lib/agents/marketing/`), `events`,
`influencer-marketing`, `image`, `marketing-council`, `marketing-plan`, `offers`, `paywalls`,
`popups`, `pricing` (prices are James's decision), `public-relations`, `referrals`,
`site-architecture`, `sms`, `video`, and the library's `tools/` folder. Copy one later when an
agent needs it; `public-relations`, `co-marketing` and `events` are the likely next ones.

## In use

28 skills are copied. 16 are used by the four agents that start first (DRAPER, SHERLOCK,
ERNEST, MURROW). The other 12 wait for later agents: `cro`, `signup`, `ab-testing` (NORMAN);
`analytics`, `attribution` (NIELSEN); `free-tools`, `lead-magnets`, `onboarding` (EDISON);
`prospecting`, `cold-email`, `sales-enablement`, `revops` (CARNEGIE).
