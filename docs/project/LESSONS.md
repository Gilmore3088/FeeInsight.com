# Lessons and decisions

The one front door to what this project has learned and decided (James, 2026-10-20). A problem
becomes a finding (`findings/YYYY-MM-DD-slug.md`); the finding names what stops a repeat, a
**Guard** (test, CI guard, alarm) or an **Agent lesson** (`<agent>/<id>` in that agent's
`role-lessons.ts`); and it gets one line here. Each decision James makes is recorded in full in
`DECISIONS.md` and gets one line here too.

**To add one:** in the same PR as the finding file or the DECISIONS.md entry, add one line to the
right section below, newest first: `- date — the lesson or decision in plain words — link — what
enforces it`. `scripts/ci-guards.sh lessons-index-kill` fails a PR when a finding or a decision
entry has no line here, or when a line links a finding that does not exist.

Contents: [Decisions](#decisions) · [Lessons by theme](#lessons-by-theme) ·
[Agent role lessons](#agent-role-lessons) · [Before 2026-10-10](#before-2026-10-10)

## Decisions

191 entries, newest first. The full text, who decided and why are in [DECISIONS.md](DECISIONS.md).

- 2026-10-25 — Hamilton's peer minimum: a median needs 5 local competitors, or 10 peers for any other group. — [decision](DECISIONS.md#2026-10-25) — `MIN_PEERS_FOR_POSITION` and its tests
- 2026-10-22 — Data-quality work has an executive owner: its decisions, HOLD-class ones included, proceed after an independent exact-head review and green CI; CLAUDE.md hard limits still apply. — [decision](DECISIONS.md#2026-10-22)
- 2026-10-22 — The second wave: Knox reads every stored document once more with today's rules (stale-read floor v78 to v97). — [decision](DECISIONS.md#2026-10-22)
- 2026-10-21 — Targets of about 90% accuracy and 80% breadth; the shadow lab ratchet lets the pipeline move only one way. — [decision](DECISIONS.md#2026-10-21)
- 2026-10-20 — A cancelled account keeps read-only access to its own reports. — [decision](DECISIONS.md#2026-10-20)
- 2026-10-20 — Hosted report tokens are rotated and kept out of the repo. — [decision](DECISIONS.md#2026-10-20)
- 2026-10-20 — A seat member of a lapsed team sees a team-billing page, not /subscribe. — [decision](DECISIONS.md#2026-10-20)
- 2026-10-20 — Paid market-report links are tied to their payment. — [decision](DECISIONS.md#2026-10-20)
- 2026-10-20 — Institution pages with fewer than 5 verified fees stay out of search. — [decision](DECISIONS.md#2026-10-20)
- 2026-10-20 — Previews build only for PRs that change visible files. — [decision](DECISIONS.md#2026-10-20)
- 2026-10-20 — Newer-copy check v2 reopens every settled pair. — [decision](DECISIONS.md#2026-10-20)
- 2026-10-20 — One front door for decisions and lessons. — [decision](DECISIONS.md#2026-10-20)
- 2026-10-20 — Legacy event-log partitions are dropped, not trimmed. — [decision](DECISIONS.md#2026-10-20)
- 2026-10-20 — Call-report quarterly summaries are computed once per load. — [decision](DECISIONS.md#2026-10-20)
- 2026-10-20 — Main's peer-group widening rule wins over exact saved groups. — [decision](DECISIONS.md#2026-10-20)
- 2026-10-20 — The market report uses one comparison set. — [decision](DECISIONS.md#2026-10-20)
- 2026-10-20 — Institution page: one connected panel. — [decision](DECISIONS.md#2026-10-20)
- 2026-10-20 — HMDA matching repair merges with every release flag off. — [decision](DECISIONS.md#2026-10-20)
- 2026-10-20 — Hourly line check and hand-takedown returns merge on re-measured counts. — [decision](DECISIONS.md#2026-10-20)
- 2026-10-20 — Superseded PRs closed. — [decision](DECISIONS.md#2026-10-20)
- 2026-10-20 — Returned statements file as returned mail. — [decision](DECISIONS.md#2026-10-20)
- 2026-10-20 — A process fix switches on once its sample checks clean; James hears after. — [decision](DECISIONS.md#2026-10-20)
- 2026-10-20 — Issues become lessons for the agents, not only checks. — [decision](DECISIONS.md#2026-10-20)
- 2026-10-19 — Review findings become checklist lines, not new issues. — [decision](DECISIONS.md#2026-10-19)
- 2026-10-19 — Fix the input and the process, not the output. — [decision](DECISIONS.md#2026-10-19)
- 2026-10-19 — The Product menu is three cards, and Hamilton's card names it. — [decision](DECISIONS.md#2026-10-19)
- 2026-10-17 — The homepage carries no standalone report promotion. — [decision](DECISIONS.md#2026-10-17)
- 2026-10-16 — Admin fee corrections are new versions, admin-only, with source evidence. — [decision](DECISIONS.md#2026-10-16)
- 2026-10-16 — Agent trackers stay separate; the lanes keep them current. — [decision](DECISIONS.md#2026-10-16)
- 2026-10-16 — Fee Insight is not marketed as advisory. — [decision](DECISIONS.md#2026-10-16)
- 2026-10-16 — Free visitors keep each fee's national range. — [decision](DECISIONS.md#2026-10-16)
- 2026-10-16 — Night deposit is the service only; bag and key purchases are not scored. — [decision](DECISIONS.md#2026-10-16)
- 2026-10-16 — A few confirmed-wrong live fees come down without asking James. — [decision](DECISIONS.md#2026-10-16)
- 2026-10-16 — Confirmed-wrong live fees in batches under 20 come down, or go to a review log, without a per-batch approval. — [decision](DECISIONS.md#2026-10-16)
- 2026-10-15 — Darwin re-checks every live fee against today's rules. — [decision](DECISIONS.md#2026-10-15)
- 2026-10-15 — Batch similar fixes; push only when ready; merge `main` only when needed. — [decision](DECISIONS.md#2026-10-15)
- 2026-10-15 — Hamilton's redesign starts now, built on #1011. — [decision](DECISIONS.md#2026-10-15)
- 2026-10-15 — Subordination fees file as legal process, reversing Oct 8. — [decision](DECISIONS.md#2026-10-15)
- 2026-10-15 — Excess withdrawals and returned mail get their own fee types, out of account research. — [decision](DECISIONS.md#2026-10-15)
- 2026-10-15 — Four answer-key rows are keyed correctly. — [decision](DECISIONS.md#2026-10-15)
- 2026-10-15 — The site's goal is a Pro subscription; the paid report is a lead. — [decision](DECISIONS.md#2026-10-15)
- 2026-10-15 — The growth plans follow the same funnel. — [decision](DECISIONS.md#2026-10-15)
- 2026-10-15 — Data fixes are proven on the live row, not one function. — [decision](DECISIONS.md#2026-10-15)
- 2026-10-15 — #1334 covers all 8 cut-cents fees. — [decision](DECISIONS.md#2026-10-15)
- 2026-10-15 — #1283's corrected counts are approved. — [decision](DECISIONS.md#2026-10-15)
- 2026-10-15 — No pipeline pause. — [decision](DECISIONS.md#2026-10-15)
- 2026-10-14 — The Fee Insight design system is the site's brand; the header carries Fee Insight. — [decision](DECISIONS.md#2026-10-14)
- 2026-10-14 — Data-quality approvals (James, Oct 14 evening, builder session). — [decision](DECISIONS.md#2026-10-14)
- 2026-10-14 — Data quality comes before the Hamilton redesign. — [decision](DECISIONS.md#2026-10-14)
- 2026-10-14 — "Reviewed" means a submitted review of the exact head SHA; CI also runs on main. — [decision](DECISIONS.md#2026-10-14)
- 2026-10-13 — Supabase reads run without a prompt; writes still ask. — [decision](DECISIONS.md#2026-10-13)
- 2026-10-13 — Darwin's audience is the one published (#1059, option 1). — [decision](DECISIONS.md#2026-10-13)
- 2026-10-13 — Up to three builders at once, one per lane. — [decision](DECISIONS.md#2026-10-13)
- 2026-10-12 — Darwin carries the backend value; Hamilton carries the business value. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Accuracy target: 95% on Deming's daily audit, averaged over a week. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Darwin owns classification: Knox suggests, Darwin decides, Gutenberg asserts, Deming audits. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — James's maintenance is one Sunday email, about an hour a week. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Every institution has one intelligence record that all agents read and write. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — James labels 25 fee names a week; every label grows a lasting name library. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — A document's type picks the tool at every stage. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Rates and lending are in scope, if accurate. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Knox targets: 85% of fees found, 90% right. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Knox stays one agent; its specialists become separately measured skills. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Hamilton becomes the product only; publishing moves to its own internal agent. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Studies on the Pro briefing: two now, three held. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Price-change modelling stays small, labeled and data-limited. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — State fee law: an agent drafts, a person checks a sample. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Quality checks run inside the pipeline, not on demand. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Coverage target and benchmark threshold. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Publish benchmarks now; unlabeled fees count as consumer, marked with an asterisk. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Business fees are published and labeled, not dropped. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Monthly account fees are compared on the entry-level account. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Thin results mean the wrong document, not a small fee schedule. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Pay to transcribe scanned PDFs. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Foundation first, then Magellan, then Hamilton. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Review the pipeline one agent at a time before relying on it again. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Priority: data layer, then raw intelligence, then Hamilton. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Never abandon an institution that has not been found. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — State experts stay code-driven but must be visible and improve. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-12 — Up-front build-out spend is accepted; recurring session spend is not. — [decision](DECISIONS.md#2026-10-12)
- 2026-10-11 — One-time WIP exception for the directory fix. — [decision](DECISIONS.md#2026-10-11)
- 2026-10-10 — Clean, merge-ready PRs have standing merge authorization across FeeInsight chats. — [decision](DECISIONS.md#2026-10-10)
- 2026-10-09 — One queue, one implementation. — [decision](DECISIONS.md#2026-10-09)
- 2026-10-08 — No rollback; finish the work. — [decision](DECISIONS.md#2026-10-08)
- 2026-10-08 — Darwin's 11 critical eval rows come down now. — [decision](DECISIONS.md#2026-10-08)
- 2026-10-08 — A paying Pro buyer holds their bank's owner seat at checkout, before claim review. — [decision](DECISIONS.md#2026-10-08)
- 2026-10-08 — When an agent breaks, recovery fixes it without asking first. — [decision](DECISIONS.md#2026-10-08)
- 2026-10-08 — The institution report stays quoted on request; free instant reports lead to the paid offers. — [decision](DECISIONS.md#2026-10-08)
- 2026-10-08 — Pro moves to three tiers; the monthly brief stays free; banks and credit unions get equal weight. — [decision](DECISIONS.md#2026-10-08)
- 2026-10-08 — Eleven marketing gaps added; the admin stays simple. — [decision](DECISIONS.md#2026-10-08)
- 2026-10-08 — The taxonomy is the top 50 fee types, and every fee is fitted into them. — [decision](DECISIONS.md#2026-10-08)
- 2026-10-08 — One marketing loop, built from a 55-task plan. — [decision](DECISIONS.md#2026-10-08)
- 2026-10-08 — A second agent team for marketing: GrowthOS. — [decision](DECISIONS.md#2026-10-08)
- 2026-10-08 — Darwin releases held fees that pass Claude's review. — [decision](DECISIONS.md#2026-10-08)
- 2026-10-08 — Pro is described as one plan for up to 5 people, not per seat. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — Pro has three price tiers by institution size, each for up to 5 people. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — Outreach is founder-led: agents draft, James sends, after the site is launch-ready. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — Month one is a sales experiment; the free snapshot launches Oct 13. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — The paid report shows "From $300"; banks with no asset size pick their own Pro band. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — Darwin releases are paused, and a released fee counts as right only when the whole record is right. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — Small-metro banks are compared with their state. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — Outreach sells research, not a median gap, and every link must work. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — The Knox decisions queue is retired; admin layout is not design work. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — Build the Agentic OS PRD tooling: Deming for quality, Bayes for replay and recovery. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — Darwin's recheck archives a failing live fee in the same step, no 12-hour second look. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — A fee from the bank's own checking or savings page counts, unless its schedule prices it differently. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — SEO, copy and the website are builder work; Growth stays paused. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — Hamilton's answer check may spend on five paid answers a day. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — Hamilton shows quarterly changes; choosing an option and watches are removed. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — A Pro buyer's institution is linked by their business email, not by a claim. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — The accuracy target is 99.5%. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — The site chrome carries Fee Insight; Hamilton stays out of the header and footer. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — CFPB complaint peer comparisons use verified matches only, or are hidden. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — Routine commands run without a prompt; the hard limits are blocked outright. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — Back-end PRs skip the Vercel preview, and lanes batch their PRs. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — The API and Claude connector come with the $300 and $500 Pro plans. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — Every team seat on a $300 or $500 plan makes its own API key. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — The taxonomy may hold 52 types; the public site publishes only the top 50. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — Hamilton is the paid product; there is no "Hamilton Pro". — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — Four data fixes switched on. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — ATM surcharge takedowns switched on. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — API docs move with the API. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — Three state lanes side by side. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — Outreach in three waves of 15 from November 1. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — Public data gets its own agent, Hoovie, and the data comes first. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — No non-commercial data. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — PRs merge without James; accuracy comes from recorded reviews. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-08 — James's fee checking is one weekly live batch, nothing more. — [decision](DECISIONS.md#2026-10-08-1)
- 2026-10-07 — Hamilton gets the new market study and the merger screen. — [decision](DECISIONS.md#2026-10-07)
- 2026-10-07 — The 13,215 bad FFIEC rows leave the live call-report table. — [decision](DECISIONS.md#2026-10-07)
- 2026-10-07 — Every state report gets the Tennessee-style map and detail. — [decision](DECISIONS.md#2026-10-07)
- 2026-10-07 — Each state's 10 to 15 largest institutions come first. — [decision](DECISIONS.md#2026-10-07)
- 2026-10-07 — Taking a fee down is a last resort: a second look, a decision log, and a way back. — [decision](DECISIONS.md#2026-10-07)
- 2026-10-07 — The public sample report names a real bank. — [decision](DECISIONS.md#2026-10-07)
- 2026-10-07 — Scrapping a fee is a last resort: looked at more than once, logged, archived, never deleted. — [decision](DECISIONS.md#2026-10-07)
- 2026-10-07 — Held fees with no category fold into an existing one; nothing beyond the ~50 tracked categories gets its own. — [decision](DECISIONS.md#2026-10-07)
- 2026-10-07 — Nothing Knox sets aside is deleted. — [decision](DECISIONS.md#2026-10-07)
- 2026-10-06 — Value funnel answers. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — One marketing email a month per reader. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — Darwin's held-fee pass acts on rejects only; every release stays held. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — Darwin's held fees get a way out: release or reject against the bank's schedule. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — Institution reports may compare thin states against Fed district peers. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — The mailing address stays blank until the state registration comes through. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — Every agent gets the same fixed daily health check, compared with yesterday. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — Each state gets its own monthly edition for readers who pick it. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — A monthly marketing agent drafts the emails; James approves each month before anything sends. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — The institution report is paid by card through Stripe. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — Work keeps going overnight without Allow taps. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — Magellan's upgrade plan runs in full; its fee-page classifier learns continuously and starts in shadow. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — One Fee Insight header across the public site and Pro; Hamilton has four tabs. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — Every Hamilton output shows its audit trail; nothing is a black box. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — Threads push their own `claude/*` branches without asking. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — One shared learning store for every agent: `pipeline_feedback`. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — The admin becomes one console with six rooms, opening on a Needs-you list. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — Darwin is rebuilt as a full verification layer, with Claude as the last resort. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — Every agent gets its own Anthropic API key so spend is tracked and capped per agent. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — The site shows a bank only while it has at least 3 distinct live fees. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-06 — Hamilton is auditable: every output shows how it was built. — [decision](DECISIONS.md#2026-10-06)
- 2026-10-05 — Hamilton is a neutral research and modeling workspace, never a fee recommender. — [decision](DECISIONS.md#2026-10-05)
- 2026-10-05 — The institution report has no fixed price yet; the granular data stays paid. — [decision](DECISIONS.md#2026-10-05)
- 2026-10-05 — Free district and national reports use the state-report consulting format. — [decision](DECISIONS.md#2026-10-05)
- 2026-10-05 — No booking tool and no paid tools before the first sale; James emails clients directly. — [decision](DECISIONS.md#2026-10-05)
- 2026-10-05 — Atlas schedules by where the work is, and daily passes count only findable banks. — [decision](DECISIONS.md#2026-10-05)
- 2026-10-05 — Package all 16 years of call reports on institution pages, deeper for Pro. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — The API is invitation only: David Bressler (betteranalyst.com) gets everything, nobody else gets in. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — Hamilton is decision support, not a recommendation engine. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — Hamilton is a paid consultant, not a chatbot that restates the site. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — Free reports are instant; the institution report is paid and never promises a turnaround. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — Free discovery is never held to the monthly cadence. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — Every state runs a daily full pass until its links are found. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — Spend to fill the fee database now, then refresh cheaply. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — No Plausible. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — A bank's tiered overdraft counts at its highest (standard) tier. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — CLAUDE.md is kept current, and the project keeps a durable memory in `docs/project/`. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — Take down live fees that can't be traced to the bank's own schedule. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — Accuracy means live fees that match the bank's own current schedule. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — Daily full passes in Texas and California. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — No Firecrawl. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — Texas and California are the first markets to fill deeply. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — Upgrade the database to Medium. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — Turn on the Supabase GitHub link once migration history matches prod. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — SQL James runs by hand goes in numbered GitHub issues labeled `sql-to-run`. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — Fix PRs may merge once green; redesigns wait for James's review. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — The site must feel like a top-tier consulting experience. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — No heading or lead line may wrap one word onto its own line. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — Never fake logs, records or numbers. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — Agents never sit idle while there's a backlog, and failures are never silent. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-05 — Keep backend fixes minimal; UI work should be genuinely visual and clear. — [decision](DECISIONS.md#2026-10-05-1)
- 2026-10-04 — Build the pipeline complete, not in bits; target 90%+ accuracy. — [decision](DECISIONS.md#2026-10-04)
- 2026-10-04 — An institution publishes only with at least 3 distinct fees. — [decision](DECISIONS.md#2026-10-04)
- 2026-10-04 — Process one whole document at a time and move all its fees together. — [decision](DECISIONS.md#2026-10-04)
- 2026-10-04 — Crawl each state monthly with a quarterly re-check, with a state expert agent per state. — [decision](DECISIONS.md#2026-10-04)

## Lessons by theme

287 findings from `findings/`, grouped by where the problem was, newest first in each theme. Each line: date — the lesson (the finding's `**Lesson:**` line, or its title when it has none) — link — what enforces it.

### Extraction and fee reading (43)

- 2026-10-25 — A dot-leader row that ends in its own price word ("…FREE") is finished; on a two-column page the next cell's price is the other column's fee, so neither the reader nor the check may give it to the closed row's name. — [finding](findings/2026-10-25-free-row-takes-next-column-price.md) — Agent lesson: knox/issue-2477-free-word-closes-the-row, darwin/issue-2477-closed-row-owns-no-later-price
- 2026-10-25 — A better reader does not fix the texts it never re-reads; before re-reading thousands of stored documents, measure on a small sample what the current reader would change for their live fees, record-only. — [finding](findings/2026-10-25-pdf-texts-read-by-old-layout.md) — Guard: `src/lib/agents/rosetta/layout-recheck.test.ts`
- 2026-10-24 — Read every PDF a second, independent way and compare which price each fee name gets; a layout mistake no detector knows yet shows up as a name the two readings price differently. — [finding](findings/2026-10-24-pdf-second-reader.md) — Agent lesson: rosetta/pdf-second-reading
- 2026-10-22 — When a right read is held because its name reads as a sentence, fix the name Knox gives it, not the hold. Cut glued words only when every one is filler or the name's own: a cut in Knox hides a qualifier from every later check. — [finding](findings/2026-10-22-glued-sentence-names-held-at-publish.md) — Agent lesson: knox/glued-sentence-name
- 2026-10-22 — A cell of stacked names over a cell of stacked prices is one fee per name only when the names are one family of siblings, as many as the prices, and the price cell holds nothing else; otherwise read it as before. — [finding](findings/2026-10-22-stacked-cell-sibling-variants.md) — Agent lesson: knox/stacked-cell-variants
- 2026-10-22 — A two-column line is two rows, each under its own column's heading: name a bare pair only by its own column's heading, and only when it is a direction, customer type or size with no service of its own. — [finding](findings/2026-10-22-column-heading-names-second-fee.md) — Agent lesson: knox/column-heading-rows
- 2026-10-22 — A row read at the right price but held unclassified needs a name rule, not a reader fix: add the general wording last, and leave it held when the keys disagree or only its heading can tell. — [finding](findings/2026-10-22-held-unclassified-at-the-right-price.md) — Agent lesson: knox/held-vocabulary-from-misses
- 2026-10-22 — A row with one price cell per column is several fees on one line: read each column's price under its header, and treat a free cell beside priced ones as a perk, not a price. — [finding](findings/2026-10-22-tier-column-rows-read-first-cell-only.md) — Agent lesson: knox/tier-column-rows
- 2026-10-22 — A name that adds words its row does not print must still trace by the row's own words in every check that looks for it on the page. — [finding](findings/2026-10-22-box-sizes-named-by-size-alone.md) — Agent lesson: knox/issue-2064-box-size-names
- 2026-10-21 — When a reader has a per-document cap, a miss late in a long document is a cap, not a rule; a rules fix reaches most stored texts only through the stale-read floor. — [finding](findings/2026-10-21-flattened-schedules-cut-off.md) — Guard: `src/lib/agents/knox/rules.test.ts` (+1 more)
- 2026-10-20 — A reader fix must reach the live fees the old read published, and the shared check must refuse a neighbour's price. — [finding](findings/2026-10-20-reader-fixes-never-reach-live-fees.md) — Agent lesson: knox/issue-1827-each-row-keeps-its-own-price
- 2026-10-19 — One literal "NSF Paid/Returned" row publishes two events only when the source owns the pair; a separate overdraft or item price for the same audience holds it. — [finding](findings/2026-10-19-compressed-paid-returned-events.md) — Guard: `src/lib/custom-report/paid-returned-events.test.ts` (+2 more)
- 2026-10-19 — Wrapped fee bullets lost their title or their own price. — [finding](findings/2026-10-19-wrapped-fee-bullets.md) — Agent lesson: knox/pr-2162-wrapped-bullet-unit
- 2026-10-19 — A printed bound can be source-supported while the actual charge remains symbolic. — [finding](findings/2026-10-19-symbolic-lesser-of-charge.md) — Guard: The hash-bound full Woodlawn source has a retained functional OLD-red. Pure controls...
- 2026-10-19 — A queue that re-reads on every version bump needs a guarantee that untouched work still drains. — [finding](findings/2026-10-19-stale-reread-backlog-starved.md) — Guard: `extract.test.ts`
- 2026-10-19 — Re-run the repaired whole source through extraction, verification, publication, reader scope and live recheck. — [finding](findings/2026-10-19-stacked-service-price-ownership.md) — Guard: `stacked-price-ownership.test.ts` (+4 more)
- 2026-10-19 — Stacked PDF columns supplied another fee's price (#2219). — [finding](findings/2026-10-19-stacked-pdf-columns-borrow-prices.md) — Guard: `src/lib/agents/rosetta/pdf-layout.test.ts` (+1 more)
- 2026-10-19 — Compare the bytes actually loaded before attributing their converted output to a stored capture; normalized text hashes alone cannot prove that association. — [finding](findings/2026-10-19-rosetta-selected-byte-identity.md) — Guard: `src/lib/agents/rosetta/source-byte-identity.test.ts` (+4 more)
- 2026-10-19 — Rosetta repair artifact settlement (#2313). — [finding](findings/2026-10-19-rosetta-repair-survival.md) — Guard: `src/lib/agents/rosetta/pdf-repair-survival.test.ts` (+2 more)
- 2026-10-19 — Optional diagnostic capability may control evidence capture, but must not control whether the same primary artifact's subwrites commit together. — [finding](findings/2026-10-19-rosetta-artifact-subwrite-atomicity.md) — Guard: `src/lib/agents/rosetta/paid-read.db.test.ts` (+2 more); 1 more Guard line(s)
- 2026-10-19 — Repeated monthly prices lost their account owners. — [finding](findings/2026-10-19-repeated-monthly-account-owners.md) — Guard: `src/lib/agents/knox/monthly-account-owners.test.ts` (+2 more)
- 2026-10-19 — Exact normalized bytes, captured metadata and current bank applicability are separate claims. — [finding](findings/2026-10-19-normalized-witness-retention.md) — Guard: `normalized-witness.db.test.ts` (+1 more)
- 2026-10-19 — A generic account kind is still a printed ownership boundary. — [finding](findings/2026-10-19-nearer-generic-lineup-owner.md) — Guard: `lineup-nearest-owner.test.ts` (+1 more)
- 2026-10-19 — Literal charging units must survive the pipeline and the comparison boundary (#2248). — [finding](findings/2026-10-19-literal-fee-charging-units.md) — Guard: `own-fee-unit.test.ts` (+6 more)
- 2026-10-19 — Hourly units were attributed to another fee's price (#1456). — [finding](findings/2026-10-19-hourly-units-borrowed-from-neighbor.md) — Guard: `src/lib/agents/darwin/hourly-frequency-check.test.ts` (+2 more)
- 2026-10-19 — A combined "Overdraft/NSF" line kept only one fee. — [finding](findings/2026-10-19-combined-line-twin-dropped.md) — Agent lesson: knox/pr-2126-store-each-twin
- 2026-10-09 — A dot-leader fee name wrapped over several lines named no fee. — [finding](findings/2026-10-09-wrapped-leader-names.md) — Agent lesson: knox/pr-861-wrapped-leader-names
- 2026-10-09 — Untraced Knox holds were never re-checked. — [finding](findings/2026-10-09-untraced-holds-never-rechecked.md) — Agent lesson: knox/pr-882-recheck-untraced-holds
- 2026-10-09 — Two-column disclosures glue neighbouring cells into one fee. — [finding](findings/2026-10-09-two-column-glue.md) — no Guard or Agent lesson named
- 2026-10-09 — A dry read for a version bump must run the whole chain on every due institution, not only the rows the new rule targets: the bump re-runs every older rule on banks it had not reached. — [finding](findings/2026-10-09-retidy-trims-dropped-conditions.md) — Agent lesson: knox/pr-933-retidy-keeps-conditions
- 2026-10-09 — A resumable scan keyed on a version must also order by how recently each item was seen. — [finding](findings/2026-10-09-retidy-scan-restarts-on-version-bump.md) — Agent lesson: knox/pr-933-retidy-keeps-conditions
- 2026-10-09 — A re-read of the same document took down fees the bank still charges. — [finding](findings/2026-10-09-reread-takedowns.md) — Agent lesson: rosetta/pr-969-reread-keeps-better-text
- 2026-10-09 — A re-read dropped lines the new text still prints. — [finding](findings/2026-10-09-reread-retired-lines-blocked.md) — Agent lesson: knox/issue-1093
- 2026-10-09 — Frequent Knox bumps starved the rules re-check, and banks with a live overdraft were never re-read. — [finding](findings/2026-10-09-recheck-walk-starved.md) — Agent lesson: knox/pr-933-retidy-keeps-conditions
- 2026-10-09 — A $0 line counts only when it comes from the bank's schedule. — [finding](findings/2026-10-09-product-page-benefits-as-fees.md) — Agent lesson: rosetta/issue-1053
- 2026-10-09 — Text extraction should flag control characters in the text it extracts. — [finding](findings/2026-10-09-pdf-font-control-character-names.md) — Agent lesson: rosetta/pr-911-font-control-characters
- 2026-10-09 — Knox cut threshold figures out of fee names; rules fixes never reach stored names. — [finding](findings/2026-10-09-names-lost-their-thresholds.md) — Agent lesson: knox/pr-838-name-not-sentence, knox/pr-827-fix-reaches-stored-rows
- 2026-10-09 — Long table rows untraced, sentence fragments read as names. — [finding](findings/2026-10-09-long-table-rows-and-sentence-names.md) — Agent lesson: knox/pr-838-name-not-sentence
- 2026-10-09 — A Knox re-read cannot fix a wrong stored lineup value. — [finding](findings/2026-10-09-lineup-reread-keeps-wrong-values.md) — Agent lesson: knox/pr-827-fix-reaches-stored-rows
- 2026-10-09 — A dot-leader fee list beside a table was read into the table's rows. — [finding](findings/2026-10-09-leader-fee-list-beside-table.md) — Agent lesson: rosetta/pr-858-columns-read-apart
- 2026-10-09 — A rule that only recognises a bad shape (hold it) is half a fix; the live catalog needs the repair side too, measured on prod before it ships. — [finding](findings/2026-10-09-cut-off-fee-names.md) — Agent lesson: knox/pr-838-name-not-sentence, knox/pr-827-fix-reaches-stored-rows
- 2026-10-09 — A safe deposit box size in the next column became a fee's price. — [finding](findings/2026-10-09-box-size-cell-glue.md) — Agent lesson: knox/pr-872-side-by-side-cells
- 2026-10-09 — Box rents lose their period when "annual" is only in the column header. — [finding](findings/2026-10-09-box-rent-annual-header.md) — Agent lesson: knox/pr-880-table-header-period

### Provider calls and paid reads (10)

- 2026-10-20 — A refusal that describes the account (billing, quota) must never be recorded as a fact about the item. — [finding](findings/2026-10-20-billing-refusal-settled-paid-items.md) — Agent lesson: rosetta/issue-1056-billing-refusal-is-not-the-scan
- 2026-10-19 — Rosetta paid transcription response and cost contract. — [finding](findings/2026-10-19-rosetta-paid-response-policy.md) — Guard: `src/lib/agents/rosetta/paid-read.integration.test.ts`; 2 more Guard line(s)
- 2026-10-19 — Raw terminal callers accepted unfinished answers and omitted their incurred usage. — [finding](findings/2026-10-19-raw-terminal-completion-and-incurred-usage.md) — Guard: `src/lib/raw-terminal-response.integration.test.ts`; 3 more Guard line(s)
- 2026-10-19 — Raw SDK memory-helper safety, with Messages behavior preserved. — [finding](findings/2026-10-19-raw-anthropic-sdk-memory-helper.md) — Guard: `src/lib/anthropic-sdk-security.test.ts` (+5 more)
- 2026-10-19 — Provider bodies were unbounded by application policy; failed streams could save partial answers. — [finding](findings/2026-10-19-provider-response-budgets.md) — Guard: `src/lib/ai-response-budget.test.ts`; 3 more Guard line(s)
- 2026-10-19 — Moving a provider call outside a row's own write block is insufficient when an earlier batch in the same outer transaction already retained source/raw locks. — [finding](findings/2026-10-19-paid-review-locks-across-model-calls.md) — Guard: `paid-two-phase.test.ts` (+1 more)
- 2026-10-19 — AI SDK JSON response-reader patch. — [finding](findings/2026-10-19-ai-sdk-json-response-limits.md) — Guard: `src/lib/ai-sdk-json-response-limits.test.ts` (+1 more)
- 2026-10-17 — Test a skip against live fees before adding it. — [finding](findings/2026-10-17-zero-yield-paid-reads.md) — Agent lesson: knox/pr-1776-no-fee-page-skip
- 2026-10-09 — A provider refusal inside a streamed response never reaches the route's catch; map it in the stream's `onError`. — [finding](findings/2026-10-09-provider-limit-blank-answers.md) — Guard: `src/lib/ai-provider.test.ts` (+2 more)
- 2026-10-09 — The Console usage limit did not trip the provider stop, and the verdict score starved. — [finding](findings/2026-10-09-api-usage-limit-did-not-trip-provider-stop.md) — Guard: `src/lib/ai-provider-usage.test.ts` (+1 more)

### Categorisation and audience (21)

- 2026-10-19 — Applicability needs both the final existing decision and positive current source facts; an early negative-key exit cannot certify that no affected facts exist. — [finding](findings/2026-10-19-stale-nonwire-international-verification.md) — Guard: Preserve the full Family PDF OLD-red and green pure controls, actual common...
- 2026-10-19 — An exclusive audience on the fee's own price clause (#2342). — [finding](findings/2026-10-19-own-price-audience.md) — Guard: `own-price-audience.test.ts` (+2 more)
- 2026-10-19 — Re-extract the actual policy unit, retain every qualifying scope clause, and inspect downstream price selection before making a restricted price eligible. — [finding](findings/2026-10-19-nsf-policy-price-scope.md) — Guard: `nsf-policy-prices.test.ts` (+5 more)
- 2026-10-19 — Literal price support, source direction and safe mixed-history publication are three separate facts. — [finding](findings/2026-10-19-international-wire-source-direction.md) — Guard: Pure controls cover complete Family sources, valid incoming refile, own cells and...
- 2026-10-19 — A document refresh and lineup enrichment must preserve fee audience. — [finding](findings/2026-10-19-fee-audience-identity.md) — Agent lesson: knox/pr-2112-enrich-within-audience, gutenberg/pr-2112-refresh-same-audience
- 2026-10-19 — Preserve applicability in exact duplicate publishing and collapse. — [finding](findings/2026-10-19-exact-duplicate-audience.md) — Agent lesson: gutenberg/pr-2143-audience-in-exact-identity
- 2026-10-19 — Price support must not erase cap-first eligibility (#2304). — [finding](findings/2026-10-19-cap-first-paid-eligibility.md) — Guard: `cap-first-eligibility.test.ts` (+2 more)
- 2026-10-19 — Ancillary fees need their product applicability throughout the pipeline. — [finding](findings/2026-10-19-ancillary-product-ownership.md) — Guard: `src/lib/agents/knox/ancillary-product.test.ts` (+6 more)
- 2026-10-17 — A section heading is not the fee type. — [finding](findings/2026-10-17-guard-v72-intl-atm-addons-overdraft-wires.md) — Guard: `src/lib/fee-category-guard.test.ts:1811`
- 2026-10-16 — A hold that takes fees down for a publish policy is not a sign the fee is gone. — [finding](findings/2026-10-16-hold-revives-business-takedowns.md) — Agent lesson: gutenberg/pr-1676-held-fee-still-present
- 2026-10-14 — A row's category is a reading, not part of its key. — [finding](findings/2026-10-14-reread-stale-category-flag.md) — Agent lesson: knox/pr-1291-reread-replaces-hint
- 2026-10-10 — Pinnacle audience integrity repair. — [finding](findings/2026-10-10-pinnacle-audience-repair.md) — Agent lesson: knox/pr-986-scope-each-audience
- 2026-10-10 — Fee audience repair: completion ledger. — [finding](findings/2026-10-10-fee-audience-completion-ledger.md) — Agent lesson: knox/pr-986-scope-each-audience
- 2026-10-09 — A right amount is not a right record. — [finding](findings/2026-10-09-whole-record-product-and-business-name.md) — Agent lesson: knox/pr-841-account-name-from-heading, gutenberg/pr-841-business-named-fee
- 2026-10-09 — "free at the ATM" is usually the bank's own machine. — [finding](findings/2026-10-09-own-atm-free-line-as-non-network.md) — Agent lesson: darwin/pr-898-file-by-whose-item
- 2026-10-09 — Category guard took down fees it should have re-filed. — [finding](findings/2026-10-09-guard-takes-down-refileable-fees.md) — Agent lesson: gutenberg/pr-954-refile-before-takedown
- 2026-10-09 — A guard bump re-judges every live fee; a fee whose right type is a fold split should come back under that type, not stay down because the fold runs later or reads only live rows. — [finding](findings/2026-10-09-guard-catch-up-took-down-fold-moves.md) — Agent lesson: gutenberg/pr-954-refile-before-takedown
- 2026-10-09 — Prove a fold rule with a broad name search that is independent of the rule, such as every row in the source key that names the thing in any wording. — [finding](findings/2026-10-09-fold-rules-proven-with-own-patterns.md) — Agent lesson: gutenberg/pr-779-fold-proof
- 2026-10-09 — Express card replacements had no way back to rush_card. — [finding](findings/2026-10-09-express-card-replacements-had-no-way-back.md) — Agent lesson: gutenberg/pr-954-refile-before-takedown
- 2026-10-09 — A consumer comparison needs the payer checked as well as the category. — [finding](findings/2026-10-09-business-wire-as-consumer-price.md) — Agent lesson: darwin/pr-898-file-by-whose-item
- 2026-10-09 — Returned bonds and coupons were filed as NSF. — [finding](findings/2026-10-09-bond-return-filed-nsf.md) — Agent lesson: darwin/pr-898-file-by-whose-item

### Verification and publication (48)

- 2026-10-25 — A line skipped as identical to a fee later held as not yet in effect is decided again so today's schedule carries the fee, but only a schedule's line: a product page prices one account (#1915). — [finding](findings/2026-10-25-skipped-lines-behind-held-edition.md) — Agent lesson: hamilton/issue-1915-edition-hold-twins; Guard: `src/lib/agents/hamilton/publish-selection.db.test.ts`
- 2026-10-25 — A web page's first lines are often its menu, so a schedule's own edition line can sit further down; read it there only with guards, since most pages that date a future edition past the menu are current pages announcing the next one (T1). — [finding](findings/2026-10-25-edition-line-past-the-menu.md) — Agent lesson: hamilton/t1-edition-line-past-menu; Guard: `src/lib/agents/hamilton/schedule-edition-late.test.ts`
- 2026-10-25 — A benchmark compares one charging basis per category; give every category a basis and have the medians and the subject's own value read that one rule, never a second data-driven measure in one surface (#1901). — [finding](findings/2026-10-25-benchmarks-pool-charging-bases.md) — Agent lesson: darwin/issue-1901-one-basis-per-benchmark
- 2026-10-20 — A stored name carries the older copy's text layout; compare it against a newer layout only after undoing what that layout glued (#2477). — [finding](findings/2026-10-20-heading-row-glued-name-false-flag.md) — Guard: `src/lib/agents/hamilton/newer-copy-retire.test.ts`
- 2026-10-20 — Measure a takedown rule on prod before building it out: the dry run showed the rule reached none of the fees it was meant for (#2477). — [finding](findings/2026-10-20-superseded-copy-fees-stay-live.md) — Guard: `src/lib/agents/hamilton/newer-copy-retire.db.test.ts`
- 2026-10-20 — A fee found again on a newer document should cite the newer document. — [finding](findings/2026-10-20-live-fees-stay-on-moved-pages.md) — Agent lesson: hamilton/issue-1200-follow-moved-pages
- 2026-10-20 — Held rates kept Knox's 0.5 placeholder confidence after promotion (#1055). — [finding](findings/2026-10-20-held-rates-kept-placeholder-confidence.md) — Guard: `src/lib/agents/knox/held-rate-confidence.db.test.ts`
- 2026-10-20 — Agent checks could take down a fee an admin had corrected. — [finding](findings/2026-10-20-agent-checks-undo-admin-corrections.md) — Guard: `src/lib/fee-corrections.db.test.ts`
- 2026-10-19 — A narrow guard's ordinary exit must preserve the caller's selection contract. — [finding](findings/2026-10-19-stale-international-publication-selection.md) — Guard: The retained OLD-red and fixed actual PostgreSQL test use the full stale caller and...
- 2026-10-19 — Required publication evidence could fail open. — [finding](findings/2026-10-19-prepublication-evidence-unavailable.md) — Guard: src/lib/agents/hamilton/publish.test.ts...
- 2026-10-19 — Newer-copy fee identity and operator holds. — [finding](findings/2026-10-19-newer-copy-identity-holds.md) — Agent lesson: gutenberg/pr-2130-same-identity-witness
- 2026-10-19 — A held twin must block newer-copy restoration. — [finding](findings/2026-10-19-held-twin-blocks-newer-copy-restore.md) — Guard: `src/lib/agents/hamilton/newer-copy-retire.db.test.ts` (+2 more)
- 2026-10-19 — Darwin recheck could report effects that did not commit (#2072). — [finding](findings/2026-10-19-darwin-recheck-settlement.md) — Guard: `src/lib/agents/darwin/verified-recheck.db.test.ts` (+3 more)
- 2026-10-19 — Returned Darwin recheck reports were omitted from the saved classify receipt. — [finding](findings/2026-10-19-darwin-recheck-receipt.md) — Guard: `src/lib/agents/darwin/verified-recheck-receipt.test.ts` (+2 more)
- 2026-10-19 — Admin correction conditions were saved but absent from public fee reads. — [finding](findings/2026-10-19-admin-correction-conditions-not-public.md) — Guard: `src/lib/fee-corrections.db.test.ts`
- 2026-10-17 — Put the rule at the earliest stage that has its inputs. — [finding](findings/2026-10-17-takedowns-at-source.md) — Agent lesson: gutenberg/issue-1069, darwin/pr-1769-judge-owner-before-live, knox/pr-1769-no-paid-read-unshown
- 2026-10-17 — A fee's document has two addresses: the one Magellan stored and the one Rosetta read. — [finding](findings/2026-10-17-source-link-drift.md) — Agent lesson: gutenberg/pr-1756-link-moves-with-row
- 2026-10-17 — When a repair is hand-started, check every path that can bring a row back live (restores, re-reads, re-sources) and either run the repair's safe half on every step or make the path itself keep the... — [finding](findings/2026-10-17-restored-fees-without-link.md) — Agent lesson: gutenberg/pr-1739-fill-restored-links
- 2026-10-17 — Article pages as fee sources: three article rules, one used at publish. — [finding](findings/2026-10-17-article-sources.md) — Agent lesson: gutenberg/pr-1777-one-article-rule
- 2026-10-15 — "lineage" must mean a link a visitor can open to the bank's document. — [finding](findings/2026-10-15-live-fees-without-source-link.md) — Agent lesson: gutenberg/pr-1345-visitor-link
- 2026-10-15 — A duplicate check keyed on `source_document_id` misses the commonest repeat: the same page captured twice. — [finding](findings/2026-10-15-live-duplicates-across-page-copies.md) — Agent lesson: gutenberg/pr-1454-page-copy-repeats
- 2026-10-15 — When a fill and a check share a version, the fill must not write anything the check undoes. — [finding](findings/2026-10-15-frequency-fill-loop-hidden-by-dedupe.md) — Agent lesson: gutenberg/pr-1355-fill-fixed-point
- 2026-10-15 — A frequency fill v13 correction was written back by the next pass, and one write-back overwrote an old ledger row. — [finding](findings/2026-10-15-frequency-correction-written-back-next-pass.md) — Agent lesson: gutenberg/pr-1355-fill-fixed-point
- 2026-10-15 — The other-bank check trusted the stored website, so wrong-bank schedules went live. — [finding](findings/2026-10-15-document-owner-trusts-stored-website.md) — Agent lesson: darwin/pr-1489-document-names-the-bank
- 2026-10-14 — When a step's "what is due" test has exceptions, the scheduler and the health count must read the same test. — [finding](findings/2026-10-14-darwin-due-rows-never-wake-a-lane.md) — Agent lesson: darwin/pr-1313-one-due-test
- 2026-10-14 — Darwin did not judge a row again after Knox changed its category (#1295). — [finding](findings/2026-10-14-darwin-category-change-rejudge.md) — Agent lesson: darwin/issue-1295
- 2026-10-12 — Count fees added and fees taken down as wrong, never raw publishes. — [finding](findings/2026-10-12-fees-caught-after-publishing.md) — Agent lesson: gutenberg/issue-1069, gutenberg/issue-1068
- 2026-10-11 — Rules re-check treated distinct same-priced fees as copies. — [finding](findings/2026-10-11-rules-recheck-same-price-copies.md) — Agent lesson: gutenberg/pr-1022-recheck-claims-lines
- 2026-10-09 — The second look rewrote a fee's first-look row in place. — [finding](findings/2026-10-09-second-look-overwrote-first-looks.md) — Agent lesson: gutenberg/pr-830-append-each-event
- 2026-10-09 — SCCU's schedule lost 7 of its 18 priced fees between read and publish. — [finding](findings/2026-10-09-sccu-dropped-fees.md) — Agent lesson: darwin/pr-892-batch-key-own-line, knox/pr-892-sideways-box-table
- 2026-10-09 — Tracing a price to its line proves the text says it, not that the text is right. — [finding](findings/2026-10-09-scanned-schedule-dropped-decimals.md) — Agent lesson: darwin/pr-786-price-ceiling
- 2026-10-09 — A re-decision of old rows must be checked against the live catalog with the keys the rows have now, not the ones they had when first decided. — [finding](findings/2026-10-09-same-line-redecide-duplicates.md) — Agent lesson: gutenberg/pr-895-redecide-current-keys
- 2026-10-09 — Same-line check read box sizes as one line. — [finding](findings/2026-10-09-same-line-box-sizes.md) — Agent lesson: gutenberg/pr-920-what-sets-lines-apart
- 2026-10-09 — Before calling a takedown wrong, check whether the bank still shows the same category and price. — [finding](findings/2026-10-09-rules-recheck-12h.md) — Agent lesson: gutenberg/pr-897-recheck-second-look
- 2026-10-09 — A name retidy cleared takedowns on rows that were still wrong. — [finding](findings/2026-10-09-rename-clears-takedown.md) — Agent lesson: gutenberg/pr-864-rename-keeps-verdict
- 2026-10-09 — Every publish-time hold needs a live-row reading in the eval check (or the retidy), or a deploy that lands after a publish step leaves that step's rows wrong for good. — [finding](findings/2026-10-09-publish-hold-does-not-reach-live-rows.md) — Agent lesson: gutenberg/pr-801-live-twin-of-holds
- 2026-10-09 — A display cut at publish must be checked against names Knox composes, not only names copied from the page. — [finding](findings/2026-10-09-publish-cut-threshold-from-names.md) — Agent lesson: gutenberg/pr-864-rename-keeps-verdict
- 2026-10-09 — A price in a fee's name is usually not the fee's price. — [finding](findings/2026-10-09-price-in-name-rule-overfired.md) — Agent lesson: gutenberg/pr-814-dry-read-live-rule
- 2026-10-09 — "another page" is not "another product". — [finding](findings/2026-10-09-one-product-two-prices-two-pages.md) — Agent lesson: gutenberg/pr-867-edition-conflict
- 2026-10-09 — An older edition of a bank's schedule stays live beside the current one. — [finding](findings/2026-10-09-older-edition-stays-live.md) — Agent lesson: gutenberg/pr-867-edition-conflict
- 2026-10-09 — A `not_in_source` rejection was final. — [finding](findings/2026-10-09-not-in-source-rejections-never-re-read.md) — Agent lesson: darwin/pr-883-rule-version-recheck, darwin/pr-928-fee-own-cell
- 2026-10-09 — A "skipped as duplicate" decision depends on the row it matched. — [finding](findings/2026-10-09-identical-twin-never-republished.md) — Agent lesson: gutenberg/pr-767-rejudge-on-change
- 2026-10-09 — A dedupe key needs the fee's identity, not just its value. — [finding](findings/2026-10-09-identical-skip-ignored-name.md) — Agent lesson: gutenberg/pr-887-same-line-identity
- 2026-10-09 — A step that re-opens a row for another step has to check what that step's own selection reads, not only the row's status; and prove the hand-off on prod the same hour. — [finding](findings/2026-10-09-guard-requeue-blocked-by-publish-attempt.md) — Agent lesson: gutenberg/pr-767-rejudge-on-change
- 2026-10-09 — A check that changes with a version needs its own trigger. — [finding](findings/2026-10-09-guard-bump-waits-for-publish.md) — Agent lesson: gutenberg/pr-801-live-twin-of-holds
- 2026-10-09 — A same-page check written as exact URL equality misses exactly how banks publish changes: a new file at a new URL. — [finding](findings/2026-10-09-fee-moves-held-by-same-url-rule.md) — Agent lesson: gutenberg/pr-865-newer-edition-wins
- 2026-10-09 — Every hand-set rule Darwin holds on needs a re-check exception keyed to the rule's own value, as the guard version has, or a change to the rule is a change for new reads only. — [finding](findings/2026-10-09-envelope-change-never-reached-held-rows.md) — Agent lesson: darwin/pr-883-rule-version-recheck
- 2026-10-09 — When a fix changes how a fingerprinted check judges its input, bump that strategy's version in the same PR, or the fix only reaches input the check has never seen. — [finding](findings/2026-10-09-check-fingerprint-blocks-rejudge.md) — Agent lesson: gutenberg/pr-767-rejudge-on-change

### Sources and discovery (19)

- 2026-10-20 — Magellan's hub and crawl finders accepted product pages as fee schedules (#1051). — [finding](findings/2026-10-20-magellan-self-accepted-product-pages.md) — Guard: `src/lib/agents/magellan/discovery.test.ts`
- 2026-10-20 — A freshness check has to start from what is live. — [finding](findings/2026-10-20-live-fee-pages-never-refetched.md) — Agent lesson: magellan/issue-1200-refetch-live-fee-pages
- 2026-10-19 — A check that keys on "same address" misses every schedule that moves. — [finding](findings/2026-10-19-saved-link-never-fetched.md) — Agent lesson: magellan/pr-2074-fetch-saved-link-once, gutenberg/pr-2074-retired-documents
- 2026-10-18 — A fee link a person sets was never fetched. — [finding](findings/2026-10-18-person-fee-link-ignored.md) — Agent lesson: magellan/pr-1883-requested-link-fetched
- 2026-10-17 — An HTTP validator belongs to one address. — [finding](findings/2026-10-17-fetch-validators-from-another-page.md) — Agent lesson: magellan/pr-1752-validators-own-address
- 2026-10-15 — Before giving a strategy a fingerprint, ask whether its failure is a verdict on that input. — [finding](findings/2026-10-15-search-from-fingerprint.md) — Agent lesson: magellan/pr-1497-search-not-input-verdict
- 2026-10-14 — Read the `fetch.http` attempt and the paid attempt's `detail.note` before calling a fetch failure the bank's. — [finding](findings/2026-10-14-paid-fetch-errors-read-as-bank-502s.md) — Agent lesson: magellan/pr-1293-plain-fetch-outcome
- 2026-10-12 — Wrong-bank and non-fee documents reached publishing. — [finding](findings/2026-10-12-wrong-host-documents.md) — Agent lesson: magellan/issue-1033
- 2026-10-12 — A form that writes to a table is not intake until an agent consumes the table. — [finding](findings/2026-10-12-fee-submissions-not-consumed.md) — Guard: `src/app/admin/quality/actions.test.ts:50`
- 2026-10-09 — A refused fetch counted as a held schedule. — [finding](findings/2026-10-09-refused-fetch-counted-as-held-schedule.md) — Agent lesson: magellan/pr-850-held-means-readable
- 2026-10-09 — A wait that exists so new evidence can arrive needs something that fetches that evidence within the wait. — [finding](findings/2026-10-09-pending-takedown-never-refetched.md) — Agent lesson: magellan/pr-808-refetch-flagged-banks
- 2026-10-09 — When a list of blocked outcomes sends work to a fallback, check the outcomes it leaves out against the banks stuck on them before calling the list complete. — [finding](findings/2026-10-09-network-error-banks-never-reached-paid-fetch.md) — Agent lesson: magellan/pr-831-walled-off-outcomes
- 2026-10-09 — Moved hand-found schedule left the old copy current. — [finding](findings/2026-10-09-moved-hand-found-schedule-stays-current.md) — Agent lesson: magellan/pr-807-one-current-copy
- 2026-10-09 — A bank whose host refuses every path we have. — [finding](findings/2026-10-09-host-refuses-every-path.md) — Agent lesson: magellan/pr-831-walled-off-outcomes
- 2026-10-09 — A page a person found and checked is the surest link Magellan has. — [finding](findings/2026-10-09-hand-found-pages-wait-in-blocked-queue.md) — Agent lesson: magellan/pr-795-hand-found-first
- 2026-10-09 — Same-name bank, different domain. — [finding](findings/2026-10-09-hand-found-link-on-same-name-bank-site.md) — Agent lesson: magellan/issue-1033
- 2026-10-09 — A rule that fixes known-bad rows should reach them on the next pass, not the next time their state's lane comes around. — [finding](findings/2026-10-09-hand-found-fixes-waited-on-lanes-and-retries.md) — Agent lesson: magellan/pr-795-hand-found-first
- 2026-10-09 — A blank HTML page from a bank that blocks our fetcher is a wall, not a script page. — [finding](findings/2026-10-09-hand-found-bot-challenge-read-as-js.md) — Agent lesson: magellan/pr-850-held-means-readable
- 2026-10-09 — Two fee links our fetcher can't open but a Mac can. — [finding](findings/2026-10-09-fetcher-refused-where-a-browser-is-not.md) — Agent lesson: magellan/pr-1293-plain-fetch-outcome

### Public and regulatory data (12)

- 2026-10-25 — A one-off audit says nothing about next quarter's load: shown financials are now reconciled with the stored FFIEC and NCUA filing lines every day, with known causes counted apart (T3, #1925). — [finding](findings/2026-10-25-financials-reconciled-once-not-daily.md) — Guard: `src/lib/agents/deming/filings-reconcile.test.ts`
- 2026-10-25 — A bank's year-to-date line cannot be differenced into quarters without knowing about mergers and mid-year restarts; where BankFind's merger-adjusted quarter disagrees, show it (#2025). — [finding](findings/2026-10-25-bank-quarters-differenced-across-mergers.md) — Guard: `src/app/(public)/institution/[id]/quarterly-ledger.test.ts`
- 2026-10-20 — When a publisher's page answers silently with itself, try the other formats and products it offers: the format may be withdrawn (FFIEC serves the single-period UBPR file only as XBRL, #2473). — [finding](findings/2026-10-20-ffiec-ubpr-single-period-xbrl-only.md) — Guard: `src/lib/agents/magellan/registry/ubpr-peer-groups.test.ts` (+1 more)
- 2026-10-19 — NCUA credit union mergers never loaded: both addresses were dead. — [finding](findings/2026-10-19-ncua-merger-list-dead.md) — Guard: `src/lib/agents/magellan/registry/industry-events.test.ts`
- 2026-10-19 — Only rows actually loaded can show that data is there. — [finding](findings/2026-10-19-hoovie-finished-is-not-loaded.md) — Guard: `src/lib/regulatory/industry-events.test.ts` (+4 more)
- 2026-10-19 — Verify that a publisher still supplies the identity input before interpreting successful aggregate ingestion as institution readiness. — [finding](findings/2026-10-19-hmda-canonical-matching.md) — Guard: HMDA/FDIC/GLEIF parser, resolver, loader and manual-route tests, cron exclusion...
- 2026-10-19 — Any count by place name must fold spellings first. — [finding](findings/2026-10-19-city-spellings-split-markets.md) — Guard: `src/lib/geo/city-names.test.ts`
- 2026-10-18 — When a publisher answers with a page instead of a file, record what the page says before guessing at the form. — [finding](findings/2026-10-18-ffiec-hosts-refuse-or-answer-html.md) — Agent lesson: hoovie/pr-1934-name-what-host-answered
- 2026-10-18 — A loader that can back-fill years of history needs a size limit before its first run, and a warning has to reach someone to count. — [finding](findings/2026-10-18-data-size-guard.md) — Agent lesson: hoovie/pr-1849-size-budget-hold
- 2026-10-17 — When a source host is blocked here, write the check into the loader instead of trusting memory, and say "merged, not proven" until a prod run shows rows. — [finding](findings/2026-10-17-public-data-loaders-unverified-fields.md) — Agent lesson: hoovie/pr-1786-check-fields-against-file
- 2026-10-16 — CFPB complaints were filed under banks by stripped-name matches with non-bank companies. — [finding](findings/2026-10-16-cfpb-non-bank-matches.md) — Agent lesson: hoovie/pr-1627-non-bank-company-names
- 2026-10-09 — A switch that silently reads as off needs to say why in the run it affects. — [finding](findings/2026-10-09-congress-bills-flag-not-seen.md) — Guard: `src/lib/agents/magellan/registry/live-flag.test.ts` (+1 more)

### Database and performance (21)

- 2026-10-20 — A figure derived only from loaded regulator data is computed when the data loads, not when a page is read. — [finding](findings/2026-10-20-call-report-recompute.md) — Guard: `src/lib/data-store/call-report-quarters.db.test.ts` (+2 more)
- 2026-10-19 — Raising a step's expected time can starve a run that has a strict deadline. — [finding](findings/2026-10-19-scoreboard-starved-by-lanes.md) — Guard: `state-lane-budget.db.test.ts` (+1 more)
- 2026-10-19 — Daily scoreboard execution exceeds its request budget. — [finding](findings/2026-10-19-scoreboard-execution-budget.md) — Guard: `src/app/api/admin/crew/scoreboard/route.test.ts` (+2 more)
- 2026-10-19 — Background bookkeeping needs an explicit serverless request lifetime even when its promise has an error handler. — [finding](findings/2026-10-19-route-audit-lifecycle.md) — Guard: `route-wrapper-retention.test.ts` (+1 more)
- 2026-10-19 — An expired read budget could start another lazy read. — [finding](findings/2026-10-19-read-budget-terminal-deadline.md) — Guard: `src/lib/read-deadline.test.ts` (+2 more)
- 2026-10-19 — In a batch query, filter and pick on narrow columns first, and compute costly per-row reads only for the rows the batch keeps. — [finding](findings/2026-10-19-publish-eligibility-projection.md) — Guard: `src/lib/agents/hamilton/publish-selection.db.test.ts`
- 2026-10-19 — An early required error left pending siblings unretained. — [finding](findings/2026-10-19-public-required-read-abandonment.md) — Guard: Pure tests cover immediate/synchronous required errors, later entries in the same array...
- 2026-10-19 — A deadline must govern whether optional work starts, as well as how long the response waits. — [finding](findings/2026-10-19-public-read-lifecycle.md) — Guard: `page-deadline.test.tsx` (+3 more)
- 2026-10-18 — In SQL, write `ROUND((expr)::numeric, n)` whenever you round to places. — [finding](findings/2026-10-18-sql-round-double.md) — Guard: `src/lib/data-store/sql-round.test.ts:90`
- 2026-10-18 — A rule that changes what the statistics count must bump `STATS_METHOD_VERSION`. — [finding](findings/2026-10-18-public-cache-ignores-stats-rules.md) — Guard: `src/lib/data-store/public-read-cache.test.ts:89` (+2 more)
- 2026-10-18 — A page that reads the database on every request needs a deadline shorter than the function limit, or a pool stall turns into minutes of skeleton and cut-off responses. — [finding](findings/2026-10-18-institution-page-load.md) — Guard: `src/app/(public)/institution/[id]/page-deadline.test.tsx:131`
- 2026-10-18 — Convert a bigint column with `Number()` where the row is read, never at each comparison. — [finding](findings/2026-10-18-bigint-ids-arrive-as-text.md) — Guard: `src/lib/auth.test.ts:88` (+2 more)
- 2026-10-17 — A table that every run appends to needs a retention rule in the same PR that creates it. — [finding](findings/2026-10-17-unbounded-log-growth.md) — Guard: `src/lib/agents/atlas/storage-retention.test.ts:43`
- 2026-10-17 — Lane publish and discover steps spent about 30 s each on one read. — [finding](findings/2026-10-17-lane-publish-and-discover-reads.md) — Guard: `src/lib/agents/hamilton/publish.test.ts:870` (+1 more)
- 2026-10-17 — Darwin's classify step slowed twentyfold and now times out state lanes. — [finding](findings/2026-10-17-darwin-classify-step-slowdown.md) — Guard: `src/lib/agents/darwin/release-held.test.ts:116`
- 2026-10-15 — Postgres.js sends a JS boolean array as a scalar, so guard v62's re-files never ran. — [finding](findings/2026-10-15-postgres-js-boolean-array.md) — Guard: `src/lib/agents/hamilton/category-guard.test.ts:266`
- 2026-10-15 — Global scans in every lane and stale step budgets slowed lanes. — [finding](findings/2026-10-15-lane-tick-budget.md) — Agent lesson: knox/pr-1378-scope-to-lane, atlas/pr-1378-measured-budgets
- 2026-10-14 — A plain subquery over `published_fee_catalog` joined to a filtered institution list can go quadratic on a bad row estimate. — [finding](findings/2026-10-14-catalog-subquery-nested-loop.md) — Guard: `src/lib/agents/goal-scorecard.test.ts:458` (+3 more)
- 2026-10-09 — Every institution page recounted the whole catalog. — [finding](findings/2026-10-09-institution-pages-recounted-catalog.md) — Guard: `src/lib/data-store/public-cached-reads.test.ts:58`
- 2026-10-09 — A public page reads catalog aggregates through `public-cached-reads.ts`, never the uncached data-store functions. — [finding](findings/2026-10-09-guide-pages-skipped-public-cache.md) — Guard: `src/app/(public)/guides/[slug]/page.test.ts:22` (+1 more)
- 2026-10-09 — Each reference to published_fee_catalog recomputes the whole catalog. — [finding](findings/2026-10-09-catalog-view-recomputed-per-reference.md) — Guard: `src/lib/data-store/search.test.ts:267` (+2 more)

### Migrations, deploys and builds (17)

- 2026-10-20 — An ISR page that reads the database gives those reads a deadline during `next build` (`readOnRequest`, 15 s) and renders its short-lived fallback past it, so a busy database never holds a page past Next's 60-second limit. — [finding](findings/2026-10-20-isr-pages-build-time-db-reads.md) — Guard: `src/app/build-time-reads.test.ts` (+1 more)
- 2026-10-20 — A check whose exit 0 means "skip the build" must default to building; only an explicit skip decision may exit 0. — [finding](findings/2026-10-20-vercel-skip-check-fails-open.md) — Guard: `scripts/vercel-ignore-build.test.ts:158` (+3 more)
- 2026-10-20 — A page or route that reads the database must not be prerendered at build; render it on request and cache the data, so the database's load never decides whether a deploy succeeds. — [finding](findings/2026-10-20-sitemap-build-time-db-reads.md) — Guard: `src/app/sitemap-cache.test.ts` (+1 more)
- 2026-10-20 — A migration number is claimed when any open PR uses it, not when it reaches `main`, so check open PRs before taking one. — [finding](findings/2026-10-20-migration-number-collisions-across-open-prs.md) — Guard: Foundation tracker #1048 line "guard for migration numbers claimed by open PRs"; until then, merge `main` and re-run `migration-version-kill`
- 2026-10-20 — Agents never run deploy-capable `vc`/`vercel` commands and never write a Vercel token to disk. — [finding](findings/2026-10-20-vercel-env-run-deploys.md) — Guard: Foundation tracker #1048 line "ban deploy-capable vercel commands for agents"
- 2026-10-20 — Whether a preview builds should depend on the PR's own change against its merge-base, not on the last commit. — [finding](findings/2026-10-20-preview-build-queue-from-merge-main-pushes.md) — Guard: `scripts/vercel-ignore-build.test.ts:233` (+2 more)
- 2026-10-19 — Schema changes go in `supabase/migrations` with James's approval, never in request code. — [finding](findings/2026-10-19-runtime-schema-ddl.md) — Guard: `scripts/ci-guards.sh runtime-ddl-kill` (+3 more)
- 2026-10-19 — A required read on a prerendered page failed the deploy. — [finding](findings/2026-10-19-required-read-fails-build.md) — Guard: `src/app/(public)/institutions/directory-deadline.test.tsx:110`
- 2026-10-17 — Vercel usage: the agents tick is the compute bill. — [finding](findings/2026-10-17-vercel-usage-agents-tick.md) — Guard: `src/lib/vercel-config.test.ts:32` (+1 more)
- 2026-10-16 — On a page PR, make sure the last commit of each push touches non-test, non-doc code, or check the Vercel comment says "Ready" and not "Ignored" before sending preview links. — [finding](findings/2026-10-16-vercel-skip-last-commit-only.md) — Guard: `scripts/vercel-ignore-build.test.ts:96`
- 2026-10-16 — Vercel's preview skip check ran without a git repository and failed every preview. — [finding](findings/2026-10-16-vercel-skip-check-without-git.md) — Guard: `src/lib/vercel-config.test.ts:21` (+3 more)
- 2026-10-15 — Migration 048 was cancelled by its own 5-second lock timeout, then applied on retry. — [finding](findings/2026-10-15-migration-lock-timeout.md) — Guard: `scripts/ci-guards.sh migration-lock-kill` (+2 more)
- 2026-10-15 — Brand headings rendered in a system font, not Geist. — [finding](findings/2026-10-15-geist-font-variable-scope.md) — Guard: `src/app/layout-fonts.test.tsx:20` (+2 more)
- 2026-10-10 — H01 preview build: Google font parser failure. — [finding](findings/2026-10-10-next-font-build-reproduction.md) — Guard: `src/app/layout-fonts.test.tsx:28` (+2 more)
- 2026-10-09 — Branch preview builds held up the Vercel build queue. — [finding](findings/2026-10-09-vercel-preview-build-queue.md) — Guard: `scripts/vercel-ignore-build.test.ts:91` (+1 more)
- 2026-10-09 — Two PRs merged the same migration number. — [finding](findings/2026-10-09-parallel-migration-numbers.md) — Guard: `scripts/ci-guards.sh migration-version-kill` (+1 more)
- 2026-10-09 — Every deploy prerendered the ten guides against the production database. — [finding](findings/2026-10-09-builds-prerendered-guides-against-prod.md) — Guard: `src/app/(public)/guides/[slug]/page.test.ts:16` (+1 more)

### Security, auth and billing (22)

- 2026-10-19 — Uploaded financial tables could expand before a resource check. — [finding](findings/2026-10-19-uploaded-table-bounds.md) — Guard: `src/lib/hamilton/uploads/parse-bounds.test.ts:88` (+1 more)
- 2026-10-19 — Remove unused sanitizer dependencies while preserving the active parser. — [finding](findings/2026-10-19-unused-html-sanitizer-removal.md) — Guard: Existing `src/lib/agents/rosetta/html-dom.test.ts`...
- 2026-10-19 — Source-map indexed-map resource amplification. — [finding](findings/2026-10-19-source-map-js-security.md) — Guard: `src/lib/source-map-js-security.test.ts`
- 2026-10-19 — Source suitability is not socket safety. — [finding](findings/2026-10-19-safe-fee-source-fetch.md) — Guard: `src/lib/agents/fee-source-fetch.test.ts:50`
- 2026-10-19 — Development proxy-addr trust-subnet patch. — [finding](findings/2026-10-19-proxy-addr-development-security.md) — Guard: `src/lib/proxy-addr-security.test.ts:20`
- 2026-10-19 — Patch the Next runtime without hiding remaining security work. — [finding](findings/2026-10-19-next-runtime-security.md) — Guard: `src/lib/next-version-floor.test.ts:29` (+3 more)
- 2026-10-19 — City map runtime needed a patched MapLibre release. — [finding](findings/2026-10-19-maplibre-runtime-security.md) — Guard: `src/lib/geo/maplibre-runtime.test.ts:24`
- 2026-10-19 — Legacy password upgrades and atomic login sessions. — [finding](findings/2026-10-19-legacy-password-upgrade.md) — Guard: `src/lib/passwords.test.ts:29` (+2 more)
- 2026-10-19 — A function that creates tables has to set the same security as the tables it copies. pg_cron jobs belong in migrations so a cleanup can find them. — [finding](findings/2026-10-19-legacy-event-log-partitions-without-rls.md) — Guard: `src/lib/agents/legacy-event-log-rls.test.ts` (+1 more)
- 2026-10-19 — A public health endpoint needs a stable failure contract. — [finding](findings/2026-10-19-health-exception-disclosure.md) — Guard: `src/app/api/health/route.test.ts:55`
- 2026-10-19 — Browser-target mapping option errors must remain catchable. — [finding](findings/2026-10-19-baseline-browser-process-error-backport.md) — Guard: `src/lib/baseline-browser-security.test.ts`
- 2026-10-19 — AWS XML builders: verify bundled behavior as well as advisory versions. — [finding](findings/2026-10-19-aws-xml-builder-security.md) — Guard: `src/lib/aws-xml-builders.test.ts` (+1 more)
- 2026-10-19 — Enforce account lifecycle before authenticating. — [finding](findings/2026-10-19-auth-lifecycle-controls.md) — Guard: `src/app/(auth)/login/actions.test.ts:52` (+1 more)
- 2026-10-19 — Login compatibility must not create a bypass in a protected layout. — [finding](findings/2026-10-19-admin-route-authorization.md) — Guard: `src/app/admin/authorization.test.ts:167` (+1 more)
- 2026-10-18 — A layout gate never covers a server action. — [finding](findings/2026-10-18-server-actions-skip-pro-gate.md) — Guard: `tests/e2e/hamilton/billing-access.test.ts:132` (+1 more)
- 2026-10-18 — Public API routes let an anonymous caller run database work cheaply. — [finding](findings/2026-10-18-public-route-db-work.md) — Guard: `src/app/api/institutions/[id]/evidence/route.test.ts:45` (+2 more)
- 2026-10-18 — A page that reads by a URL id needs its own membership check before the read, not only before the write. — [finding](findings/2026-10-18-hamilton-customer-data-isolation-review.md) — Guard: `src/app/pro/(hamilton)/settings/page.team-isolation.test.tsx:84` (+2 more)
- 2026-10-10 — Payment confirmation and its delivery obligations commit together. — [finding](findings/2026-10-10-transactional-payment-delivery.md) — Guard: `src/lib/billing/payment-delivery.integration.test.ts:64` (+1 more)
- 2026-10-10 — Reconcile subscription access from current Stripe state. — [finding](findings/2026-10-10-stripe-authoritative-reconciliation.md) — Guard: `src/lib/stripe-webhook.test.ts:55`
- 2026-10-10 — Persist checkout intent before contacting Stripe. — [finding](findings/2026-10-10-persisted-checkout-intents.md) — Guard: `src/lib/billing/checkout.test.ts:33`
- 2026-10-09 — Sign out on the account page and admin used Server Actions that a redeploy breaks. — [finding](findings/2026-10-09-sign-out-server-action.md) — Guard: `src/app/api/auth/logout/route.test.ts:30`
- 2026-10-09 — A refunded report kept its paid status and its private link. — [finding](findings/2026-10-09-report-refund-not-handled.md) — Guard: `src/lib/stripe-webhook.test.ts` (+1 more)

### Hamilton workspace (26)

- 2026-10-25 — A save that takes an answer from the browser keeps only its prose; the binding, verdict and other evidence fields come only from the server, and a browser save gets a "not checked" verdict so readers fail closed. — [finding](findings/2026-10-25-fallback-save-trust.md) — Guard: `src/lib/hamilton/analyze-actions.test.ts`
- 2026-10-25 — When a view leaves a sentence out, the reply leaves out its text too: send the reason and the count, and keep the text only where it is saved and read server side. — [finding](findings/2026-10-25-omitted-text-payload.md) — Guard: `src/app/api/research/hamilton/route.omitted-payload.test.ts`, `src/lib/hamilton/written-answer-binding.test.ts`
- 2026-10-25 — An eval scores what the reader gets only with the gate that decides it, and a supported filing claim is tied to its live row, not accepted as the tools read it. — [finding](findings/2026-10-25-claim-eval-reads.md) — Guard: `src/lib/hamilton/answer-correctness-filings.test.ts`, `src/lib/data-store/filing-reread.test.ts`, `src/lib/hamilton/paid-answer-eval.test.ts`
- 2026-10-25 — When a checked answer is reused, save what the check decided (each sentence's outcome and its facts' values, versioned) and have the next surface read that record, never the prose. — [finding](findings/2026-10-25-claim-report-carry.md) — Guard: `src/lib/hamilton/claim-report-carry.test.ts`, `src/lib/hamilton/report-actions.test.ts`, `src/lib/hamilton/bound-export.pdf.test.tsx`
- 2026-10-25 — A rewrite of a failing answer is a paid call and a partial answer changes what a reader sees: build both behind one default-off switch and count each rewrite in the quota. — [finding](findings/2026-10-25-claim-repair-partial.md) — Guard: `src/lib/hamilton/output-gate-repair.test.ts`, `src/app/api/research/hamilton/route.gate-repair.test.ts`
- 2026-10-25 — Run one gate beside the gates it replaces on every path, recording both decisions in the run ledger, so switching it on is a choice about counted disagreements. — [finding](findings/2026-10-25-claim-unified-gate.md) — Guard: `src/lib/hamilton/output-gate.test.ts`, `src/app/api/research/hamilton/route.answer-gate.test.ts`
- 2026-10-25 — A figure the question asserts as an institution's own fee, or a change it states, needs a record; a question, comparison or threshold is not a premise, and a rule that could hold more answers ships in shadow first. — [finding](findings/2026-10-25-claim-premise-causation.md) — Guard: `src/lib/hamilton/claim-premise-causation.test.ts`, `src/lib/hamilton/claim-golden-set.test.ts`
- 2026-10-25 — A filing figure is supported only by a fact of the institution, metric, quarter and period basis the sentence states; a sentence whose owner or metric is unknown binds nothing. — [finding](findings/2026-10-25-claim-sentence-binding.md) — Guard: `src/lib/hamilton/claim-sentence-binding.test.ts`, `src/lib/hamilton/claim-golden-set.test.ts`
- 2026-10-25 — Give a filing figure a fact ID only through the validator that already reads it, with its period basis in the ID. — [finding](findings/2026-10-25-claim-fact-ids.md) — Guard: `src/lib/hamilton/claim-evidence.test.ts`
- 2026-10-25 — Before changing a check, record what it does today on cases built to break it and mark the ones it gets wrong (10 of 25 for Hamilton's answer checks). — [finding](findings/2026-10-25-claim-golden-set.md) — Guard: `src/lib/hamilton/claim-golden-set.test.ts` (recorded outcomes, held-out check)
- 2026-10-25 — Reuse a saved answer through its sentence binding and evidence verdict, never as its raw prose. — [finding](findings/2026-10-25-saved-answer-binding-in-reports.md) — Guard: `src/lib/hamilton/report-actions.test.ts`
- 2026-10-25 — The data a figure check traces figures to holds only what the server read itself; a reader's note or earlier model prose goes to the model as context, never into that data. — [finding](findings/2026-10-25-hamilton-question-trace.md) — Guard: `src/lib/hamilton/report-actions.test.ts` (reader findings stay out of DATA)
- 2026-10-19 — Saved simulations could borrow another institution's context. — [finding](findings/2026-10-19-hamilton-saved-scenario-identity.md) — Guard: `src/app/pro/(hamilton)/simulate/page.test.tsx` (+2 more)
- 2026-10-17 — Run the journey before calling any Hamilton change done. — [finding](findings/2026-10-17-hamilton-release-runbook.md) — no Guard or Agent lesson named
- 2026-10-17 — An answer branch draws its lead, figures, section headings, exhibits and sourced findings through the shared primitives below, never with local text classes. — [finding](findings/2026-10-17-hamilton-presentation-contract.md) — Guard: `src/components/hamilton/memo/answer-primitives.test.tsx:47`
- 2026-10-17 — A rating needs one owner per surface and one read-time policy for history. — [finding](findings/2026-10-17-hamilton-confidence-inventory.md) — Guard: `src/lib/hamilton/confidence-legacy.test.tsx:47`
- 2026-10-15 — Hamilton's CFPB complaint peer median counted unmatched institutions as zero complaints. — [finding](findings/2026-10-15-cfpb-unmatched-peers-as-zero.md) — Agent lesson: hamilton/pr-1526-verified-peers-only
- 2026-10-10 — Saved answers must retain their recorded research subject. — [finding](findings/2026-10-10-hamilton-saved-answer-subject.md) — Agent lesson: hamilton/pr-985-subject-not-account
- 2026-10-10 — H01 live preview acceptance and remaining blockers (#976). — [finding](findings/2026-10-10-hamilton-preview-acceptance.md) — Agent lesson: hamilton/pr-985-subject-not-account
- 2026-10-10 — Peer lists are a separate task, not an implicit fee report. — [finding](findings/2026-10-10-hamilton-peer-list-task.md) — Agent lesson: hamilton/pr-985-peer-list-task
- 2026-10-10 — Hamilton landing consumer integration (#982 / #993). — [finding](findings/2026-10-10-hamilton-landing-consumer.md) — Guard: `src/components/hamilton/landing/LandingResearchPicker.test.tsx:8`
- 2026-10-10 — H01 institution identity reconciliation (#976 / #985). — [finding](findings/2026-10-10-hamilton-h01-completion.md) — Agent lesson: hamilton/pr-985-subject-not-account
- 2026-10-10 — Hamilton needs record-bound evidence, not numerical-pool confidence. — [finding](findings/2026-10-10-hamilton-evidence-contract.md) — Agent lesson: hamilton/pr-995-record-bound-evidence
- 2026-10-10 — Browsing is not workspace selection. — [finding](findings/2026-10-10-hamilton-browse-is-not-workspace-selection.md) — Agent lesson: hamilton/pr-985-subject-not-account
- 2026-10-10 — Written answers need account identity as well as a research subject. — [finding](findings/2026-10-10-hamilton-account-versus-research-context.md) — Agent lesson: hamilton/pr-985-subject-not-account
- 2026-10-09 — Any comparison of one institution with a peer statistic must filter the institution's rows the same way the statistic filters its own. — [finding](findings/2026-10-09-pro-compared-unlike-fees.md) — Guard: `src/lib/hamilton/report-evidence.test.ts`

### Site, pages and copy (16)

- 2026-10-19 — `font-mono` and `font-sans` resolve to nothing on the public site. — [finding](findings/2026-10-19-font-mono-undefined-var.md) — Guard: none yet; #2166 adds a check for `globals.css` custom properties nothing defines
- 2026-10-19 — Named segment rows quote an institution median as a published fee. — [finding](findings/2026-10-19-segment-median-as-published-price.md) — Guard: `src/lib/data-store/segment-stated-prices.db.test.ts` (+7 more)
- 2026-10-19 — Public fee-index applicability and source attribution. — [finding](findings/2026-10-19-public-fee-index-applicability.md) — Guard: `src/lib/data-store/public-fee-applicability.db.test.ts` (+5 more); 1 more Guard line(s)
- 2026-10-19 — Read the query behind a public count before writing what the count means. — [finding](findings/2026-10-19-monitored-count-includes-closed.md) — Guard: `src/lib/public-stats.test.ts` (+1 more)
- 2026-10-19 — A post-hydration server action returning UI must be tested through the built client/server boundary. — [finding](findings/2026-10-19-institution-viewer-manifest.md) — Guard: Viewer-action tests require a JSON-round-trippable financial payload and no financial...
- 2026-10-18 — A number printed on more than one page gets one helper and one definition in `headline-counts.ts`; a page never re-derives it from a different read, and a different population (the institution page's... — [finding](findings/2026-10-18-headline-counts-drift.md) — Guard: `src/lib/headline-counts.test.ts:48`
- 2026-10-16 — Public pages render per request because each page opts in, not because of the header. — [finding](findings/2026-10-16-public-pages-render-per-request.md) — no Guard or Agent lesson named
- 2026-10-16 — A quote shown as evidence must print the number it supports; test that, not that a quote exists. — [finding](findings/2026-10-16-fee-evidence-quotes-the-name.md) — Guard: `src/lib/fee-evidence.test.ts:147`
- 2026-10-16 — The full fee-category detail passes Next's 2 MB cache limit for the largest categories. — [finding](findings/2026-10-16-fee-category-detail-over-2mb.md) — no Guard or Agent lesson named
- 2026-10-15 — A layout-level 404 trades a server-rendered body for a correct status. — [finding](findings/2026-10-15-layout-404-error-shell.md) — Guard: `src/app/(public)/not-found.test.tsx:17` (+2 more)
- 2026-10-14 — A route that must answer 404 does its existence check in a layout with no loading boundary above it. — [finding](findings/2026-10-14-loading-boundary-locks-200.md) — Guard: `src/app/not-found-status.test.ts:56`
- 2026-10-14 — A pattern over pipeline text needs a test against every live shape (query the distinct shapes first), and a field shared by pipeline and customers needs a test at the readers, not only at the helper. — [finding](findings/2026-10-14-knox-note-in-conditions.md) — Guard: `src/lib/data-store/customer-fee-conditions.test.ts:112`
- 2026-10-12 — Before a rule narrows what counts, measure how much data passes it. — [finding](findings/2026-10-12-benchmarks-consumer-filter.md) — Guard: `src/lib/data-store/fee-stats.test.ts:161`
- 2026-10-09 — A fee schedule with no monthly charge needs the account page too. — [finding](findings/2026-10-09-schedule-without-monthly-charge-needs-account-page.md) — no Guard or Agent lesson named
- 2026-10-09 — When an agent writes a link into a draft, check that the route exists on main. — [finding](findings/2026-10-09-outreach-snapshot-links-404.md) — Guard: `src/lib/agents/growth/norman.test.ts`
- 2026-10-09 — An outgoing side effect needs its own record in Postgres; don't rely on a provider's read API that needs broader credentials than sending. — [finding](findings/2026-10-09-no-sent-email-log.md) — Guard: `src/lib/email/resend.test.ts` (+1 more)

### CI, tests, tooling and PR workflow (15)

- 2026-10-25 — Every DB suite on the shared e2e database removes its own rows when it ends, and a suite that counts rows across the whole database isolates its fixture in its rolled-back transaction; vitest's file order is not the CLI order. — [finding](findings/2026-10-25-shared-test-database-leftover-fees.md) — Guard: `src/lib/agents/darwin/verified-recheck.db.test.ts`
- 2026-10-20 — Parallel agents write PR bodies to a unique `mktemp` file and re-read the body after every edit. — [finding](findings/2026-10-20-shared-scratch-file-overwrote-pr-body.md) — Guard: Foundation tracker #1048 line "agents use mktemp for PR bodies and verify the body after edit"
- 2026-10-20 — A push that drops scope while reconciling with `main` updates the PR title and body in the same push. — [finding](findings/2026-10-20-pr-descriptions-stale-after-reconcile.md) — Guard: the independent review of the exact head checks that the body matches the diff
- 2026-10-20 — A caught error is recorded where people look (a step warning or a logged error), never turned silently into an empty result. — [finding](findings/2026-10-20-swallowed-errors-hid-failures.md) — Guard: the `step.warning` added in #2414, and the #975 line for the `layout.tsx:94` lookup
- 2026-10-19 — Test-toolchain mock and Windows path guards. — [finding](findings/2026-10-19-test-toolchain-path-guards.md) — Guard: `src/lib/test-toolchain-security.test.ts`
- 2026-10-19 — Compatible schema, cache and filesystem tooling safety. — [finding](findings/2026-10-19-schema-cache-filesystem-tooling.md) — Guard: `src/lib/tooling-dependency-security.test.ts`
- 2026-10-19 — The Hamilton journeys ran on a schema missing everything added since 2026-10-04. — [finding](findings/2026-10-19-journey-schema-catch-up.md) — Guard: `tests/e2e/hamilton/schema-catch-up.test.ts`
- 2026-10-18 — `ReturnType<typeof postgres>` breaks typecheck when unrelated code changes. — [finding](findings/2026-10-18-postgres-returntype-in-db-tests.md) — Guard: `src/lib/data-store/db-test-handles.test.ts:20` (+2 more)
- 2026-10-16 — Main has no branch protection, though CI calls `app-tests` the required check. — [finding](findings/2026-10-16-main-branch-unprotected.md) — Guard: the GitHub ruleset on `main` (#1641, #1642 closed; read 2026-10-19 in...
- 2026-10-11 — Atlas registry and crew status: direct runtime import cycle removed. — [finding](findings/2026-10-11-atlas-crew-registry-import-cycle.md) — Guard: `src/lib/agents/crew-import-boundary.test.ts:19`
- 2026-10-10 — Report templates depend on primitives, not their public barrel. — [finding](findings/2026-10-10-report-template-import-boundary.md) — Guard: `src/lib/report-templates/import-boundary.test.ts:17`
- 2026-10-10 — A green pipeline test was hiding missing database columns. — [finding](findings/2026-10-10-pipeline-schema-false-green.md) — Guard: `src/lib/agents/pipeline.e2e.test.ts:342`
- 2026-10-10 — Peer SQL contract checks must tolerate formatting, not wrong mappings. — [finding](findings/2026-10-10-peer-sql-assertion-whitespace.md) — Guard: `src/lib/data-store/hamilton-peer-list.test.ts:51`
- 2026-10-09 — A shared log that every PR appends to at the same spot needs one file per entry. — [finding](findings/2026-10-09-findings-md-merge-conflicts.md) — Guard: `scripts/ci-guards.sh findings-file-kill`
- 2026-10-09 — Backlog Node checks were accidentally discovered by application Vitest. — [finding](findings/2026-10-09-backlog-node-test-discovery.md) — Guard: `src/lib/vitest-collection.test.ts:26` (+2 more)

### Agent process, learning and measurement (17)

- 2026-10-24 — Answer-key lines were compared to the bank's page as markup (table bars, HTML codes, dot leaders), so the same words and prices never matched. — [finding](findings/2026-10-24-answer-key-lines-compared-as-markup.md) — Agent lesson: deming/issue-2466-line-content-match
- 2026-10-22 — Replay each weekly live audit in the shadow lab: most live errors start at extraction, and wrong names pass every stage. — [finding](findings/2026-10-22-live-audit-replay.md) — Guard: `src/lib/agents/deming/shadow-lab/ratchet-gate.test.ts` (live_audit expectations in `ratchet-baseline.json`)
- 2026-10-21 — Before fixing a batch of live fees, replay the frozen sources and fix the stage where the failures start. — [finding](findings/2026-10-21-pipeline-shadow-lab-first-run.md) — Guard: `npm run test:shadow-lab`
- 2026-10-20 — A data-quality check has to use the same identity as the step that repairs the problem, or its alarm can never clear. — [finding](findings/2026-10-20-duplicate-check-counted-shared-prices.md) — Guard: `src/lib/agents/deming/data-quality.db.test.ts`
- 2026-10-20 — The answer-key eligibility gate admitted none of the 62 confirmed keys. — [finding](findings/2026-10-20-answer-key-eligibility-admits-none.md) — Agent lesson: deming/issue-2466-reference-binding
- 2026-10-19 — Define the weekly live sampling and repair protocol. — [finding](findings/2026-10-19-weekly-live-accuracy-plan.md) — no Guard or Agent lesson named
- 2026-10-19 — A learned takedown needs the same fee and original judged text. — [finding](findings/2026-10-19-takedown-lesson-identity.md) — Guard: `src/lib/agents/knox/takedown-lessons.test.ts` (+5 more)
- 2026-10-19 — A stored-copy support score cannot establish a current official schedule. — [finding](findings/2026-10-19-live-source-audit.md) — Guard: `src/lib/agents/deming/live-source-audit.test.ts` (+10 more)
- 2026-10-19 — Prospective corrective-source evidence. — [finding](findings/2026-10-19-deming-corrective-source-evidence.md) — Guard: `src/lib/agents/deming/corrective-source.test.ts` (+5 more)
- 2026-10-19 — Accuracy status needs independent units, a scoring series and a confidence gate. — [finding](findings/2026-10-19-audit-confidence-history.md) — Agent lesson: deming/pr-2119-bound-not-point
- 2026-10-19 — Preserve unknowns, the exact reference and its original receipt across every consumer. — [finding](findings/2026-10-19-answer-key-reference-eligibility.md) — Guard: `src/lib/data-store/answer-key-eligibility-policy.test.ts` (+5 more)
- 2026-10-18 — Anything the tick does before its step loop comes out of every step's budget, and the deadline logic cannot see it as a step. — [finding](findings/2026-10-18-tick-loses-budget-before-steps.md) — Agent lesson: atlas/pr-2017-lane-sync-own-step
- 2026-10-17 — Expected runtimes drift as steps gain work. — [finding](findings/2026-10-17-steps-overrun-tick-budget.md) — Agent lesson: atlas/pr-1844-price-at-p99, gutenberg/pr-1844-publish-time-box
- 2026-10-16 — A publish-policy takedown was logged as Knox and Darwin errors. — [finding](findings/2026-10-16-hold-feedback-learned-as-wrong-reads.md) — Guard: `src/lib/agents/learning/feedback.test.ts:196` (+1 more)
- 2026-10-14 — Before tuning a category against the answer key, split its misses by document. — [finding](findings/2026-10-14-answer-key-one-document-scope.md) — Agent lesson: atlas/pr-1324-score-key-document
- 2026-10-09 — A Knox rules fix waited for a queued state lane. — [finding](findings/2026-10-09-rules-fix-waits-for-queued-lane.md) — Agent lesson: atlas/pr-846-rules-version-reread
- 2026-10-09 — Darwin learned from its own holdout misses. — [finding](findings/2026-10-09-holdout-misses-fed-back-as-lessons.md) — Guard: `src/lib/agents/darwin/verdict-score.test.ts`

## Agent role lessons

Agent lessons are reviewed code, not prose: each pipeline agent keeps its own in
`role-lessons.ts`, `src/lib/agents/learning/lesson-registry.ts` gathers them, and every run of
that agent reads them. `lesson-kill` checks the files. They live there and are not copied here;
counts as of this index (191 in all).

| Agent | Lessons | File |
|---|---|---|
| atlas | 7 | [`src/lib/agents/atlas/role-lessons.ts`](../../src/lib/agents/atlas/role-lessons.ts) |
| magellan | 17 | [`src/lib/agents/magellan/role-lessons.ts`](../../src/lib/agents/magellan/role-lessons.ts) |
| hoovie | 10 | [`src/lib/agents/hoovie/role-lessons.ts`](../../src/lib/agents/hoovie/role-lessons.ts) |
| rosetta | 8 | [`src/lib/agents/rosetta/role-lessons.ts`](../../src/lib/agents/rosetta/role-lessons.ts) |
| knox | 54 | [`src/lib/agents/knox/role-lessons.ts`](../../src/lib/agents/knox/role-lessons.ts) |
| darwin | 27 | [`src/lib/agents/darwin/role-lessons.ts`](../../src/lib/agents/darwin/role-lessons.ts) |
| gutenberg | 40 | [`src/lib/agents/gutenberg/role-lessons.ts`](../../src/lib/agents/gutenberg/role-lessons.ts) |
| hamilton | 17 | [`src/lib/agents/hamilton/role-lessons.ts`](../../src/lib/agents/hamilton/role-lessons.ts) |
| deming | 11 | [`src/lib/agents/deming/role-lessons.ts`](../../src/lib/agents/deming/role-lessons.ts) |

## Before 2026-10-10

Findings up to 2026-10-09 were written into one file, [FINDINGS.md](FINDINGS.md), before each
finding got its own file. It is the archive and takes no new entries; read it for the earlier
lessons.
