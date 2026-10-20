# Accuracy status needs independent units, a scoring series and a confidence gate

Issue #2071, related to Foundation #1048 and Deming's existing quality work. The automated stored-copy audit pooled rolling events across retries/checker versions and declared its 99.5% target met from a point estimate. A scoring change could look like data improvement, and the short window did not provide a persistent weekly trend.

The fix records complete per-fee verdict receipts and all scoring versions, deduplicates repeated daily draws and fee IDs, separates series, and requires the unrounded 95% Wilson lower bound to reach the diagnostic target. It requests 500 automated checks daily and requires at least 3,400 unique scorable fees for a target decision; unknowns and insufficient samples remain visible.

Calendar-week history is reconstructed from the existing scoreboard snapshots' dated receipts. Copies of rolling windows do not add evidence. Legacy totals remain labelled and never acquire inferred versions or a confidence claim. Change-outcome checks cannot credit a scorer change as a pipeline improvement.

This is an automated diagnostic of published dollar fees against stored documents. Correlated sources, shared validators, source currency, missing fees and rate fees limit what it establishes. James's separate weekly live batch of 50 whole institutions remains the launch accuracy measurement and requires no additional manual confirmations. This change does not close #1923, #1862 or #2061.

Verification includes full and focused unit suites, a real loopback PostgreSQL history query in CI, checker/receipt/rounding boundary cases and operator authorization. It introduces no migration, fee mutation, new service or provider activation. Data accuracy has not been declared 99.5% by merging this reporting fix.

**Agent lesson:** deming/pr-2119-bound-not-point
