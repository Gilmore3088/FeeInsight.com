# Hamilton in depth: the product (2026-10-12)

James, 2026-10-12: "Hamilton is the recurring revenue base. So he needs to be robust, capable,
and possess depth of skill, or we need to break off parts so Hamilton is external and someone
else handles the internal role."

This review covers Hamilton as the paid product: Ask, written answers, memos, the Pro workspace,
reports and studies. The publisher, its internal role, is in `hamilton-review-2026-10-12.md`.
Existing tracker #975 (H01–H07) stays the home; this review names where it overlaps.

**Measured** = read-only production query, 2026-10-12, 05:00–05:40 UTC. **Code** = `main` at
`2f973bf9`.

## The answer in one paragraph

Hamilton has a wide surface (14 things a Pro user can do) but shallow, uneven depth, and it is
judged mostly on form, not on whether its numbers are right. Its own quality test passes 87 of 154
standard answers and 8 of 22 real questions asked in Pro. Five of the fourteen standard questions
fail at every institution tested. When the reader's own bank has no published fees, most answers
collapse to "Hamilton has 0 of your published fees on file". The internal publishing role is a
separate job with separate risks, and it should move to its own agent so Hamilton is only the
product.

## Who uses it (measured)

- `subscriptions` has no rows and `pro_checkout_intents` has none: **no paying subscriber yet.**
  Eleven `users` rows carry `subscription_status = 'active'` (premium role), three of them with a
  Stripe customer id; these are comped or test accounts. Payment reliability work (#991) merged on
  Oct 11.
- In the last 30 days one user had Hamilton conversations (14 messages). The 22 Pro questions in
  the 90-day replay read as internal testing (Space Coast FCU, Texas National Bank of
  Jacksonville, Angelina Savings Bank).
- Pro paid-model spend in October: $9.41 (research streams $3.54, report sections $2.32, chat
  $1.80, memos $0.94, report theses $0.78).

There is time to fix the product before the first customer depends on it.

## What a Pro user can do today (code)

| Capability | Paid model call? |
|---|---|
| Ask bar (`/api/hamilton/ask`): position, peers, trend, regulation, local market, peer lists | No |
| Memo written over each Ask answer (`/ask/memo`) | Yes, fired automatically |
| Written answer on Analyze (`/api/research/hamilton`, streamed, up to 4 tool steps) | Yes |
| "Try a price" (`/pro/simulate`) | Yes |
| Implementation plan, briefing, competitor alerts, fee alerts and Monday digest, decisions, deliverables, uploads of the bank's own figures, studies, Regulatory Wire, market, districts, categories, data pages | No |
| Reports (`/pro/reports`) | Yes |
| Chat | Yes, admin and analyst only |

Data it draws on: the live fee catalog and rate catalog, call reports (RIAD H032) and NCUA 5300,
fee change records, FDIC branch deposits, state economy and Beige Book, regulators, CFPB
complaints, account lineups and studies. Regulation encoded: Reg E overdraft opt-in, Reg DD and
NCUA 707, FDIC FIL-40-2022, CFPB Circular 2022-06, notice periods. Fee-income trend work in
reports uses real econometrics.

## How good the answers are (measured, `hamilton-answer-eval`, 2026-10-12 04:50 UTC)

Fourteen standard questions asked of 11 institutions (one per charter and size group), through the
free Ask path:

| Question | Passed |
|---|---|
| How does our overdraft fee compare? Who are our overdraft competitors? Overdraft income trend? Why is our overdraft fee where it is? What should the board know? | 11 of 11 each |
| NSF fee vs peers; monthly maintenance nationally; stop payment; non-network ATM | 8 of 11 each (failures are sentence-length style rules on the regulator line) |
| **Where do we stand on every fee?** | **0 of 11**: no figure in the answer |
| **Is our wire transfer fee in line with the market?** | **0 of 11**: headline carries no number |
| **What is the trend in overdraft fees in our state?** | **0 of 11**: does not name the state |
| **What if we charged $35 for overdraft?** | **0 of 11**: asks "what do you charge today?" instead of using the fee it already holds |
| **What regulation applies to our overdraft fee?** | **0 of 11**: flagged for not naming the regulator, although the answer does name it ("The OCC charters and supervises you"). The check, the answer or both need fixing |

Real Pro questions replayed (22; 8 met the bar). The pattern:
- **It answers a different question.** "Talk to me about $5B and up in Florida: fee pricing,
  revenue, complaints" and "Which credit unions in the top 25 of the $1–10B tier run a fee share
  below 4%?" both came back as "Your overdraft fee is not in the index yet; 13 peers' median is
  $25." The Ask path parses intent with regular expressions (`workspace/ask.ts:87–121`) and falls
  back to an overdraft template.
- **It has nothing to say about the reader's own bank** when that bank has no published fees: six
  answers were "Hamilton has 0 of your published fees on file". Space Coast FCU had none. A
  customer's own fees are the first thing the data layer must hold.
- **It asks back** instead of answering ("Which fee do you want to look at?" for a question about
  service-fee income).

The eval checks form (a number, a source, a peer count, sentence length, no advice). It does not
check that the numbers are right, and it never tests the paid paths: written answers, memos,
reports or simulate.

## Gaps in depth (code)

- **Two answer engines with different guardrails.** The free Ask path is checked. The paid
  streamed written answer is not gated: its figures are checked only afterwards, to set a
  confidence label (`answer-save.ts:27`); the citation gate is never switched on.
- **No customer-response modelling.** "What happens if we cut NSF?" gets arithmetic on today's
  volume; nothing models attrition, opt-in changes or offsetting revenue. There is no elasticity
  anywhere in `src/lib/hamilton`.
- **The written answer cannot see local competitors or fee income vs peers**: the model has no
  `getLocalCompetitors`, `queryFeeRevenueCorrelation`, `queryDistrictData` or `queryStateData`
  tools, and does not see the reader's saved peer set.
- **No state fee law** (empty until legal review).
- **No overdraft program design** (opt-in rates, daily caps, de minimis, grace periods).
- **Built but unreachable:** choosing an option and moving a decision (`/api/hamilton/decisions/[id]`)
  have no UI, so watch conditions never trip; quarterly briefing changes are stored and never
  shown; `/api/hamilton/deliverables` has no caller.
- **Trust leaks:** memo calls check the Pro daily quota but never count toward it, and their spend
  is filed under the admin chat route (`memo.ts:29`); the quota allows requests when it cannot read
  the count (`quota.ts:41`). Skill files are read from `.claude/skills` at runtime and offered to
  the model (`skills.ts:12`), including developer skills and a `competitive-intelligence` skill
  that tells it to write "Recommendations", against the no-advice rule. The admin prompt asks for
  a "clear directive — what institutions must do" (`agents.ts:56`); the simulate prompt calls the
  reader's tested price a "Proposed fee".

## Split the publisher out (recommendation)

Yes. Publishing and policing the catalog is a different job with different risks: it is
deterministic, runs every 5 minutes, and is judged on accuracy and take-downs. The product is
judged on answers and is used by customers. Mixed together, the product's budget, health page and
guide also carry the publisher's work, and neither gets full attention.

- **Into a new internal agent, not Darwin.** Darwin verifies; keeping the publisher separate keeps
  "one checks, another publishes". Darwin should still take over the pure checks that only need the
  verified row (product page, limit, amount envelope, retired category), as flags at verify time,
  with publishing keeping a final assertion (HR2, #1069).
- **What moves:** 27 publisher files in `src/lib/agents/hamilton/` (~13,000 lines), the `publish`
  and repair step handlers, `public-diagnose`, scheduler and Atlas callers, labels, health and the
  docs. **What stays frozen:** the persisted `hamilton.*` check names (history and dedupe keys),
  the advisory lock name, and the `hamilton_*` product tables.
- **Order, lowest risk first:** (1) add the new agent name everywhere it is read, and let readers
  accept both names; widen the `pipeline_feedback` reporter check (a migration); (2) switch the
  writers; (3) move the code; (4) move the pure checks to Darwin; (5) docs. No database rows change
  meaning.
- **When:** before HR1–HR3 (#1068–#1070), so those fixes land in the new home instead of being
  moved twice.

James chooses the name. Hamilton keeps Ask, memos, written answers, simulate, reports, studies,
briefing, alerts, digest and decisions.

## What "robust, capable, deep" means for Hamilton

For a product manager at a bank under $10B paying about $150 a month:
1. **Answers the question asked**, about their own bank, with numbers that tie to the catalog, or
   says plainly what is missing and when it will be there.
2. **One engine, one gate**: every answer, free or paid, passes the same evidence checks before
   it is shown.
3. **Measured on correctness**, on the free and paid paths, against real questions, every day.
4. **Depth where the buyer's decisions are**: local competitors, fee income vs peers, the effect
   of a price change with sourced assumptions, regulation including state law.
5. **Nothing half-built shown to a customer**: finish it or hide it.

## Changes (sub-issues of #975, #1075–#1086)

Overlaps: H04 #979 (one composer) and H06 #981 (evidence and claim attribution) already cover
parts of HP3 and the evidence gate; the evidence-gate finding is added to #981 rather than filed
again. HP5 reuses `report-reconciliation` (#1066).

| # | Change |
|---|---|
| HP1 #1075 | Move the publisher to its own internal agent (James names it), in the order above |
| HP2 #1076 | Fix the five standard questions that fail everywhere: every-fee position, wire headline, state trend names the state, "what if $35" uses the fee on file, regulation check vs answer |
| HP3 #1077 | Answer the question asked: replace the overdraft fallback with "here is what I can and cannot answer", and route free-form questions to one evidence-bound path |
| HP4 #1078 | A Pro account's own institution comes first: when it has no published fees, Hamilton says so and Magellan gets it as a priority target the same day |
| HP5 #1079 | The answer eval checks correctness (numbers tie to the catalog) and covers the paid paths: written answers, memos, simulate and reports |
| HP6 #1080 | Count memo calls in the Pro quota under their own route, and make the quota fail closed |
| HP7 #1081 | Stop reading `.claude/skills` into Pro prompts at runtime; give the model a fixed, reviewed product knowledge set |
| HP8 #1082 | Align prompts with the no-advice rule (admin "clear directive", simulate "Proposed fee") |
| HP9 #1083 | Finish or hide the unreachable workspace features: decision options and watches, quarterly briefing changes, the deliverables API |
| HP10 #1084 | Give the written answer local competitors, fee income vs peers, district and state tools, and the reader's saved peer set |
| HP11 #1085 | Model the effect of a price change with stated, sourced customer-response ranges (needs James: which sources count) |
| HP12 #1086 | State fee law data, after legal review |
