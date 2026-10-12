# Admin redesign: the control room (2026-10-12)

James, 2026-10-12: "I don't want duplicate screens... start from scratch... guidance from a visual,
seamless integration standpoint so I can manage everything from the back end." Mockup:
https://claude.ai/artifact/3Fe6Xxpyk3a6HtvpjypRqH (private to James). Issue: #1122 (supersedes #1044).

## Today (code, 2026-10-12)

83 admin page files: about 57 real screens, 25 redirect stubs and 1 alias; 44 menu items in 6 rooms
(`src/lib/admin-rooms.ts`). Overlaps: "Verify" and "Knox" open the same screen; two different pages
are called "Quality"; approvals are split across three pages (Growth, Content, Marketing); the Atlas
command centre appears on three pages; fee statistics appear on four (Index, Peers, Districts, Fee
catalog); freshness appears on two. Older pages use a different heading style and some lack dark
mode. `hamilton/research` creates tables when its page loads, which `AGENTS.md` forbids.

## The design: seven rooms, one frame

Every room opens on the same frame: a question as the title, three to five numbers against targets,
the piles it owns (size, oldest, way out, state), then detail. Nothing appears in two rooms.

| Room | Question it answers | Replaces |
|---|---|---|
| **Today** | Is it healthy, and what needs me? Five numbers (accuracy, coverage cells, wrong-after-publish, spend, Darwin backlog), the "Needs you" list, and the pipeline strip | `/admin`, `/admin/agents`, `/admin/live`, `/admin/scoreboard`, the Atlas overview on three pages |
| **Pipeline** | How is each agent doing? One page per agent (Magellan, Rosetta, Knox, Darwin, Gutenberg, state experts, Atlas, Deming), all on the same template: target, cost, piles, recent runs, guide | `/admin/magellan*`, `/admin/rosetta`, `/admin/knox`, `/admin/darwin`, `/admin/states*`, `/admin/atlas/*`, `/admin/agents/health`, `/quality`, `/learning`, `/replay`, `/messages`, `/lineage` |
| **Your work** | What only James can do: fee-name labels, approvals (data changes, gated PRs), sample checks, answer-key checks, marketing approvals | `/admin/knox/labels`, `/admin/verify`, `/admin/answer-key*`, `/admin/customers/content`, `/admin/customers/marketing`, approvals on `/admin/growth` |
| **Data** | What do we hold? Institution search and the institution intelligence record (#1105); one Explore view for benchmarks, peers, districts, catalog and local markets; coverage map | `/admin/institutions`, `/admin/institution/[id]`, `/admin/fees/catalog*`, `/admin/index`, `/admin/peers*`, `/admin/districts*`, `/admin/market`, `/admin/data`, `/admin/quality`, `/admin/query` |
| **Hamilton** | Is the product ready for a paying customer? Customers and accounts, answer quality, reports and publishing, usage | `/admin/customers`, `/admin/leads`, `/admin/hamilton/*`, `/admin/publishing`, `/admin/api-keys` |
| **Growth** | What is marketing doing, and what waits for me? One board: plan, drafts, campaigns, leads, cost; parked state shown | `/admin/growth`, `/admin/agents/marketing` |
| **Settings** | Spend caps, pause switches, API keys, access | `/admin/controls`, `/admin/api-trust` |

About 57 screens become about 15: seven room homes, eight agent pages under Pipeline, and detail
pages (an institution, a run, a report) that open from them. The 25 redirect stubs and the alias are
deleted once nothing links to them.

## Design rules

- **Reuse the existing system:** the warm palette and tokens in `src/app/globals.css`, shadcn
  components, Geist for text and numbers, Newsreader for room titles. One heading style everywhere;
  dark mode on every page.
- **Every number has a source and a date**, and every pile shows owner, size, oldest and its way out.
- **State is shown in form, not only numbers:** good, warning, critical chips and stripes.
- **Works on a phone:** the menu becomes a top row; tables scroll inside their own box.
- **Nothing is read from legacy tables**, and no page creates tables when it loads.

## Growth: how it comes back

Growth stays parked (#1121) and returns in three steps, each gated on the product being ready:

1. **Data posts and the monthly fee pulse** (drafts from live data, approved by James): once the
   benchmarks are fixed (#1058) and accuracy holds 95% for a week.
2. **The monthly email to subscribers:** once the first report reconciles to live data (#1066).
3. **Outreach to banks and credit unions:** once Hamilton passes its quality bar (#1076, #1077,
   #1079) and has a paying-customer path.

Before step 1, #1121 documents every growth job, turns off jobs that do nothing while parked, and
James decides whether a marketing pause holds an approved send. Growth's approvals move into
"Your work"; its board lives in the Growth room.

## Build order

Do this after the scorecard (#1040), because the Today room shows its numbers, and before the new
screens it would otherwise duplicate (held-fee queue #1115, label queue #1102, institution record
#1105, state experts #1042). Steps: the frame and navigation; Today; Your work; Pipeline (one
template, then each agent); Data; Hamilton; Growth; Settings; delete redirects and legacy pages.
Customer-facing pages (Pro and public) are a separate review.
