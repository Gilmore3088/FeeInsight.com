# Fee Insight glossary

The words this project uses for its business, its data and its pipeline, so every session and
person means the same thing. Terms only; how things are built lives in the code, and why lives in
[DECISIONS.md](DECISIONS.md). The `domain-modeling` skill (`.claude/skills/domain-modeling/`)
keeps it current. Every entry below is taken from CLAUDE.md, DECISIONS.md or James's standing
rules in project memory.

## Brand and product

**Fee Insight**:
The company and the site (feeinsight.com), and the publisher named on every page and report.
_Avoid_: naming the site as the product

**Bank Fee Index**:
The product: the dataset and index of bank and credit union fees.

**Hamilton**:
The paid workspace a subscriber uses. Hamilton is Pro. The last pipeline agent, which publishes
verified fees, shares the name; call it "the Hamilton agent" when that is meant.
_Avoid_: Hamilton Pro

**Pro**:
Marks who has paid for Hamilton; never part of a product name.

**Competitive Fee Position Report**:
The paid report ("from $300"), a lead into Hamilton rather than the goal.

## Fee data

**Raw fee**:
A fee as Knox first extracted it from a bank's document (`raw_fee_observations`).

**Verified fee**:
A raw fee that passed Darwin's checks (`verified_fee_observations`).

**Published fee**:
A verified fee Hamilton published (`published_fee_records`); product, report, research and API
reads use `published_fee_catalog`.
_Avoid_: live fee for anything not yet published

**Rate fee**:
A fee stated as a rate ("1.1% of the transaction"), read from `published_fee_rate_catalog` and
never pooled with dollar amounts.

**Accuracy**:
The share of live published fees whose amount and category match the bank's own current fee
schedule, judged by `checkFeeAgainstSource`.

## Pipeline

**Pipeline agents**:
Atlas, Magellan, Rosetta, Knox, Darwin and Hamilton, in that order; each one's role is in its
`src/lib/agents/<agent>/AGENTS.md`. Customer-facing text never names them.

**Role lesson**:
A lesson added to an agent's `role-lessons.ts` when a PR fixes a root cause in that agent.

## Comparisons

**Local competitors**:
Institutions competing in the same local market; a median over them needs at least 5 publishing
the fee.

**Peer minimum**:
Every median other than local competitors needs at least 10 institutions; below it Hamilton names
the institutions and their prices without a median. Set 2026-10-25 for Hamilton; the public Index's own minimum
(`MIN_INSTITUTIONS_FOR_MEDIAN`) stays 5.
