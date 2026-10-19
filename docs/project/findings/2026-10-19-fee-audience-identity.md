# A document refresh and lineup enrichment must preserve fee audience

Knox's raw identity includes document, name, price and audience, but its same-row lineup
enrichment omitted audience. Hamilton's current-copy refresh also paired equal names and prices
without audience, so its inherited lineage could turn a consumer fee into a business or unknown
fee. Those paths could alter account facts or benchmark eligibility without a price change.

Fixes #2108 (Knox, tracker #1092) and #2109 (Hamilton, tracker #975). Knox enrichment uses the
same audience `feeApplicability` supplied to its insert. Hamilton's selector and pure plan require
equal audiences, treating missing legacy values as unknown, and the final write rechecks both
rows' audience so an audience change committed between selection and writing leaves the
selected lineage unchanged.

PostgreSQL tests use loopback-only temporary tables to exercise actual selection and mutation:
same-name/price audience siblings retain their own lineup; matching refreshes still move; cross-
audience refreshes and audience changes after selection do not. Pure-plan and dry-run regressions
cover all four audiences and legacy unknown values. Existing v2 fingerprints remain closed:
the restriction only prevents future unsafe matches. The Hamilton guide and Bayes's existing
no-replay contract document why this does not bump a version or queue historical work.

No production correction, replay, takedown switch, migration or provider activation is included.
