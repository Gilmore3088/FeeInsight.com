# Public site brand refresh preview receipt

Date: October 11, 2026. Draft PR #1016, branch `fix/public-brand-refresh-consolidation`.

This branch consolidates the original FeeInsight public-site redesign onto current main. It is preview-only until James reviews the visual result. Hamilton redesign PR #1011 is separate and not included.

## Included

- Plus Jakarta Sans restored as the public sans face.
- Fawn/parchment/warm-neutral surfaces and terracotta accents.
- Shared /subscribe-style glass cards, buttons, links, spacing and motion.
- Landing page composition restored.
- Public fee index/detail, institution/search, reports/research, methodology, guides, API docs, for-institutions and market-report presentation restored from the original redesign.
- Current main remains the runtime/data base; no Growth, Hamilton workspace, payment, agent, migration or production-data changes are included.

## Preview deployment

The repository's Vercel policy skips ordinary branch builds. This receipt commit contains `[preview]` to opt this branch into a non-production review deployment using the existing repository policy. Do not change production aliases, environment values, preview protection, cron configuration or the production branch.

Keep PR #1016 draft until visual review and exact-head CI pass.


## Homepage simplification preview — 2026-10-11

Current review head includes executed structural passes for the homepage, /fees, institution profiles and /for-institutions. This receipt commit exists only to opt the branch into the repository's existing Vercel preview policy; it does not change production aliases, security settings, environment variables or product behavior.


## Verified preview trigger — 2026-10-11

Base implementation head before this no-op receipt: `0feb72bda07a85d6e87a6b752a964c953a0cb3d6`.
GitHub app tests and backlog intake were both green on that exact head.
This commit only opts the unchanged reviewed implementation into Vercel's existing preview policy.


## Preview trigger — guides + homepage samples — 2026-10-11

Base implementation head before this no-op receipt: `d71326a5de250e62331f5f34d8753d786c223177`.
This commit only opts that exact implementation into the existing Vercel preview policy.


## Preview trigger — restored four-example homepage hero — 2026-10-11

Base implementation head before this no-op receipt: `7e6b50c6ba030598f2d95e987d810cb3d0fe281f`.
The homepage hero again uses the shared Benchmark, Analyze, Monitor and Report rotating showcase.


## Preview trigger — exact restored homepage hero — 2026-10-11

Base implementation head before this no-op receipt: `e7a046439ff9c79218b01d01104214f6d831eb2c`.
This is the exact branch state with the Benchmark / Analyze / Monitor / Report rotating hero restored and the temporary static sample strip removed.


## Preview trigger — restored four-value homepage hero — 2026-10-11

Base implementation head before this no-op receipt: `92a3d4fff030c2ac76822f3e9ef787d00954630f`.
This preview restores the established Benchmark / Analyze / Monitor / Report rotating hero showcase while retaining the compact report proof section below.


## Preview trigger — value-led homepage hero — 2026-10-11

Base implementation head before this receipt: `2eafc35d267f570175f6425b4160ab735f61ad78`.
The homepage now leads with institutional value and the four rotating Benchmark / Analyze / Monitor / Report examples. Bank Fee Index search sits below the hero.


## Preview trigger — action-oriented rotating labels — 2026-10-11

Base implementation head before this receipt: `b530e437735d8ea602ec4eb5c5c5119fe29b67b2`.
The landing showcase now uses action-oriented labels inside each preview:
Benchmark with the Bank Fee Index; Analyze with Hamilton Intelligence; Monitor with Fee Insight Alerts; Report to your board with confidence.


## Preview trigger — homepage rail alignment — 2026-10-11

Homepage hero, Bank Fee Index, banking-team section, and coverage section now share the same 24px mobile content rail. The Bank Fee Index no longer uses a nested padded card that shifts its text farther right.


## Preview trigger — homepage rail alignment — 2026-10-11

Base implementation head before this receipt: `de0026ab587c5531a92a994c56553890cd1fcce0`.
This preview aligns the Bank Fee Index, banking-team and coverage sections to one shared mobile content rail and normalizes their vertical spacing.


## Preview trigger — aligned mobile homepage — 2026-10-11

Base implementation head before this receipt: `cfa9008a4f8ba2b19987b7646ccd4eb1ef9a81e0`.
This preview uses one shared mobile content rail for the Bank Fee Index, banking-team, and coverage sections and includes the action-oriented rotating showcase labels.


## Preview trigger — homepage mobile alignment — 2026-10-11

This preview standardizes the homepage hero, Bank Fee Index, banking-team section, and coverage section on one 24px mobile content rail.


## Preview trigger — national research hierarchy — 2026-10-11

This preview adds a first-class National data & research section to /research and places National in the research navigation before state and Federal Reserve district analysis.
