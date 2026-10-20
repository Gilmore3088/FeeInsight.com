# Hamilton's CFPB complaint peer median counted unmatched institutions as zero complaints

**Date:** 2026-10-15
**Found by:** an independent read-only production audit, reported by James (#1523, under H06 #981)

## What happened
- `getComplaintBenchmark` (`src/lib/data-store/complaints.ts`) built the peer group from every active institution with the same charter and asset tier, then LEFT JOINed complaint records and read a missing record as 0.
- Only a peer whose CFPB identity link was under review was left out. A peer with no `cfpb_company` link at all counted as an institution with zero complaints.
- On Oct 15, 210 of the 8,497 institutions eligible for a complaint-peer comparison had an accepted CFPB identity match; 8,287 had neither a match nor complaint records. Peer medians were therefore set almost entirely by absent evidence, which pulls them toward 0 and makes a matched bank look worse than its peers.
- An unmatched target was also told it "had 0 CFPB fee complaints".

## Fix
- Only peers with an accepted CFPB identity match count (`peer_count`); every similar institution with deposits is still counted as `eligible_peer_count`, so coverage can be stated.
- The level widens state, then Fed district, then nation until there are at least `MIN_VERIFIED_PEERS` (10) verified peers. With fewer even nationwide, `peer_coverage` is `"insufficient"`, no peer rate is given, and Ask shows "Only N of M similar institutions have a verified CFPB match, too few to compare fee complaint rates." in place of the comparison.
- An institution with no verified match has an unknown count (`null`), not 0.

## Lesson
Missing evidence is not a zero. Any peer statistic built from a linked source (CFPB, call reports, identity links) must restrict its denominator to institutions whose link is verified, and say how many that is.

**Agent lesson:** hamilton/pr-1526-verified-peers-only
