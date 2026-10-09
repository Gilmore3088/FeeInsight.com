# Pinnacle audience integrity repair

## Scope and current state

Working branch: `fix/pinnacle-fee-audience-integrity`, based on main `1b5de13cd5b2e61ff6ca64047222b6c90888d39b`.
This is a code/database-migration proposal. Production was read, not changed. Do not merge or apply the migrations until the rollout gates below pass. It is separate from the Hamilton reliability PR.

The diagnosed publications are Pinnacle Bank institution 47: NSF 97662 (verified 110743, raw 321488) and overdraft 97663 (verified 110744, raw 321489), source document 21164. The NSF source explicitly eliminated consumer NSF and reduced business NSF from $38 to $30, but the old extractor emitted one unscoped $30. The overdraft source reduced the fee from $38 to $30 for all clients. Source: https://www.pnfp.com/pinnacle-s-updated-overdraft-services-program/ and its stored /Overdraft page. The program took effect August 1, 2022; this repair is NOT an October 2026 bank fee change.

## Ordered repairs

1. **Extraction and recheck:** completed, unconditional NSF elimination statements produce independent scoped observations. New prices, not historical prices, are used. Future announcements, conditional waivers, contradictory clauses and unscoped held-row promotions are rejected. Cushion/daily-total amounts do not become per-item fees. The shared source checker remains the authority; it is not bypassed.
2. **Persistence and publication:** customer audience, evidence and fee treatment have separate fields in raw, verified and published tables. Product names are unchanged. Invoker triggers inherit through real lineage, and raw/Darwin/Hamilton deduplication keeps audiences distinct. Explicitly scoped business records are preserved instead of retired by the legacy business-schedule sweep.
3. **Confirmed-error containment:** an explicit publication quarantine is immediately excluded from both catalogs, independently of replacement coverage. Historical second-look confirmations are NOT treated as active quarantines. Migration 41 contains an optimistic, ID/source-guarded, idempotent Pinnacle containment; it preserves old amounts, records correction feedback, blocks the old raw rows, and leaves replacement verification to the existing pipeline. Pinnacle is on the priority reread list. No fabricated agent events or directly inserted verified $0.
4. **Consumer comparisons and display:** the central statistics filter requires consumer/both; the cache method version changes. Headline selection includes genuine $0 and excludes business/unknown. Institution tables label scope and elimination, and do not compare business/unknown rows to consumer medians. Rate fees also retain audience.
5. **Wider audit:** all 32 screening hits are accounted for below. Screening is NOT fresh source verification. No blanket price update or mass audience backfill is authorized by this file.

## Screening queue: 32 publications, 29 institutions

“Scope review” means review the cited source/own row and then re-extract through the pipeline; it does not assert that the currently stored dollar amount has been reverified. All remain pending source-level remediation unless covered by the Pinnacle migration.

| Published ID | Institution ID / name | Disposition |
|---|---|---|
| 10668 | 36 Webster | Business wording is explicit; separately review currency-order vs money-order category. Do not merely change audience. |
| 82133 | 47 Pinnacle | Courier: business-only scope review, separate from NSF repair. |
| 22081 | 81 Renasant | Multiple prices/neighboring returned-statement fee: bind the correct row before scope changes. |
| 63316 | 108 Trustmark | Returned deposit item: business-only scope review. |
| 80656 | 108 Trustmark | NSF: business-accounts-only scope review. |
| 84799 | 127 First Financial | Chargeback: business-accounts-only scope review. |
| 55008 | 132 OceanFirst | Sustained overdraft: business-only scope review; preserve daily frequency. |
| 103764 | 270 Orrstown | Continuous overdraft: business-only scope review; preserve nine-day condition. |
| 97726 | 291 Community Bank of Mississippi | Returned deposit item: business-only scope review. |
| 16701 | 338 Woori America | Priority source review: $30MM/$10MM deposit/withdrawal thresholds appear misread as a $10 incoming wire fee. Do not infer a replacement price. |
| 86171 | 425 Northwest | Own returned-deposit-item excerpt says business only; scope review. |
| 96049 | 480 Open Bank | MSB/check-cashing business restriction: preserve the narrower product restriction. |
| 25896 | 510 Wayne | Returned deposited item: business-only scope review. |
| 33470 | 555 Luana | Returned deposit item: business-only scope review; ignore next safe-deposit-box label. |
| 76513 | 570 Montecito | Returned item: business-only scope review, including category. |
| 97827 | 756 Watertown Savings | Returned deposited item: business-only scope review. |
| 93888 | 776 Greenfield Savings | Paper statement: business-only scope review. |
| 75569 | 844 Plains Commerce | Chargeback: business-only scope review. |
| 66354 | 1123 Legends | Chargeback: business-only scope review. |
| 61200 | 1484 NewBank | False-positive audience association: business scope belongs to neighboring monthly statement, not necessarily overdraft. Remain unknown pending own-row evidence. |
| 98549 | 1484 NewBank | Interim statement: business-only scope review. |
| 31695 | 1616 First Port City | Returned deposit item: business-only scope review. |
| 18821 | 1671 Commercial Bank | ACH origination: business-customer-only scope review; preserve monthly frequency. |
| 15540 | 1842 Southern Bank of Tennessee | Business NSF wording explicit, but neighboring $35 needs source/table review. |
| 100291 | 2710 Bank of Deerfield | Returned deposit item: business-only scope review. |
| 39478 | 2741 Wayne Bank and Trust | Returned deposited item: business-only scope review. |
| 70553 | 3212 Woodland | Deposit item return: business-only scope review. |
| 103573 | 4885 Fourleaf FCU | Returned deposited item: business-only scope review; preserve distinction from NSF. |
| 83732 | 6107 Heritage Grove FCU | Returned deposit item: business-only scope review. |
| 90460 | 6364 Lebanon FCU | “Credit Union Business Only” describes purpose, not a confirmed business-account audience. No automatic business label. |
| 90461 | 6364 Lebanon FCU | Same false positive for photocopies. |
| 61707 | 7285 Priority Trust FCU | Deposited check returned unpaid: own excerpt says business accounts only; scope review. |

## Rollout gates — not yet completed

- Apply and exercise migrations in a throwaway/staging database first; the draft PR includes real PostgreSQL assertions and preserves the ordinary pipeline E2E test. No live database application has occurred.
- Review schema/branch conflicts against current main before merge. Migration scaffolds were generated using Supabase CLI 2.120.0 and then renumbered to the repository's highest-version-plus-one convention (40, 41).
- **Coverage is a release blocker.** Existing audience defaults to unknown. Do not silently label old rows consumer to preserve counts. Run the existing current-copy extraction/verification/publication in staging, measure consumer/both coverage and report sample sizes, and agree acceptable coverage before exposing strict consumer benchmarks.
- Audit other benchmark/report/outreach consumers of the catalog for audience use; the central statistics filter and institution table are covered here, not every downstream generated asset. Regenerate/invalidate affected report and outreach artifacts after approved rollout. Do not send outreach using the old Pinnacle snapshot.
- Reconcile all 32 screening hits against current source documents. The queue above is triage, not 32 completed repairs. Woori, Webster, Renasant/NewBank and the two Lebanon entries particularly require bounded source review.
- Confirm Pinnacle shows consumer NSF $0 (eliminated), business NSF $30 and overdraft $30 for both, with complete source/evidence lineage and no new bank-change alert. Confirm a subsequent recheck cannot restore the quarantined observations.

A frontend-only preview against the unchanged production schema will not validate this branch: the additive migration is required first. Do not merge solely because TypeScript/unit tests pass.
