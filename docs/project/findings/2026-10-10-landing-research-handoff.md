# Landing task-to-output handoff — PR #989 continuation

Owner: ChatGPT, shared transport/test adapter. Tracks #982 under #975.
Status: implemented contract; destination integration and authenticated acceptance NOT complete.
Base read: 468403ef3923c7641e99827190130ba9866120a3.

## Implemented

`src/lib/hamilton/landing-research-handoff.ts` holds versioned, public selections for
compare and board-report tasks. It preserves national/all-50-state/DC/local scope,
canonical categories and bank/CU filter. Local scope needs an explicit canonical
institution ID. Omitted categories use the four approved homepage categories equally.
Explicit empty or unknown selections fail closed. Extra scope fields are rejected.

URLSearchParams encodes these into the existing Analyze/Reports destinations. The
payload contains no private account facts, free-form prompt, grants, prices, snapshot
assertions or caller-supplied return URL. Decoding is strict and size-bounded. This
is transport, not authorization or evidence: every destination must validate again.
The local adapter refuses state/national/type-filtered/report requests instead of
misrepresenting them as a successful local comparison. It uses #989's existing API
request shape, not a second endpoint. No auto-send or report-generation flag is set.

## Verified locally

99 checks passed using actual transpiled source and the test bodies with a small
Node assertion runner; taxonomy keys populated from the fetched canonical list.
The copied local-market-request dependency hashes to the read Git blob:
09604464d2549aec0cc4516e08a758218ff0937e.
Source-only strict TypeScript check passed with the taxonomy import's declared
Record<string,string[]> boundary. This is NOT the repository typecheck or Vitest run.

Checks include each state/DC round-tripping through nested login/subscription return
URLs; malformed and duplicate payloads; invalid institution/category/scope values;
unsupported privilege/evidence fields; preservation of category order; no automatic
report action; and refusal to send unsupported research through the local API.

## Required integration (existing owners, no overwrite)

- #977 / H02: parse `research` at the existing Ask destination and pass only
  `localRequestFromLanding()` to the local market route. Invalid payloads get an
  explicit recoverable error, never default research. Use one existing composer.
- #985 / Analyze context owner: preserve the complete return URL through actual
  login/subscription transitions; treat the research institution as a transient
  subject, not account ownership. Verify matching home-vs-subject behavior.
- #986 / H06: provide the governed state/national/category/charter reader and fresh
  evidence at execution. Serialization of a state is NOT state-query implementation.
- Existing report owner: parse board-report selection, show scope for confirmation,
  invoke existing generation, save/reopen/export with matching evidence. A link is
  NOT a report. Persist server-side idempotency before offering auto-run behavior.
- #982: authenticated browser tests including refresh/back/duplicate-submit and
  missing data; report export inspection and exact-head complete CI.

Do NOT expose the generated CTA until its destination consumer is wired and tested.
This patch does not change Analyze/StructuredAsk, the homepage, subscription UI,
publication rules, pricing, database schema, providers, or production.
Rollback: revert these new adapter/test/doc files; no data migration required.

## Better Analyst reference: borrow the demonstration, not the identity

Primary source reviewed: https://betteranalyst.com/ (public homepage).
It presents task prompts, distinct output previews (charts/spreadsheets/reports),
workflow consolidation and inspectable generated-code examples. These are observed
marketing patterns, not independently established conversion performance or tests
of its application. No revenue/success figures are inferred.

Keep Fee Insight's approved pricing/UX typography, colors and current layout. In the
existing demo area use three tasks, not another feature grid or open-ended composer:

1. Compare local competitors -> sourced map, peer names/asset dates, selected fees.
2. Explore state vs national -> all states/DC, equal category defaults, charter filter.
3. Create a board draft -> saved/reopenable report with citations and export.

Show the output early in each short clip. Separate "Watch example" (labeled sample)
from "Use these selections in Hamilton" (only after live acceptance). Evidence reveal
is Fee Insight's analogue of code transparency: source passage, comparison cohort,
conditions and review date. Do not copy testimonials, social proof, pricing, a free
plan, uptime/security claims, or speed promises. No unsupported time-savings counter,
no AI-comparison gimmick, no giant connector wall, and no new third-party demo platform.
Overdraft/NSF are not homepage defaults or featured messaging. The headline remains
"Your next fee review doesn't need to take weeks."
