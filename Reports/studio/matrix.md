# Studio Matrix — the 25 report institutions

Selected 2026-08-15 from the 30 coverage-viable institutions (≥9 of 15 featured
categories in `published_fee_catalog`; see `coverage.sql`). Districts 1 (Boston),
3 (Philadelphia), 8 (St. Louis) have no viable institutions yet — matrix covers the
9 districts where data is rich. All institutions are community-tier: the exact
segment that lacks analytics staff and cares most about local fee position.

Dropped from the 30: Academic FCU, O&R Utilities FCU, New Covenant Dominion FCU
(NY district-2 overweight / closed-membership), F R B FCU (Fed Board employees —
closed membership), Angelina Savings (district-11 overweight, lowest coverage).

> **2026-08-17: Outreach kit rewritten after the executive-panel audit.** Drafts now use the
> Fee Insight sender identity, a neutral "Prepared for …" subject, a priced 15-minute ask,
> a hosted per-institution link (tokens rotated 2026-10-20 and kept out of the repo, see
> `docs/runbooks/hosted-report-tokens.md`; drafts carry `/r/NEW-TOKEN`) and a form-only
> variant for the 14 form-only contacts. Regenerate `email-preview.html` with `node preview.mjs`.
> The live institution count (1,183 on 2026-08-17) is baked into the drafts — re-fill before
> sending if it changes. Still required before any send: LinkedIn research for a direct
> marketing/product/retail lead per institution and the user's own review of each PDF.

Status flow: selected → pulled → written → rendered → reviewed → SENT

> **2026-08-15: ALL 25 at "rendered", NONE reviewed. User ruled the PDFs not ready
> to send; nothing sends until the user's review pass clears them (and never by
> Claude).** Reports re-rendered under Fee Insight brand architecture (Fee Insight =
> company, Bank Fee Index = product, printed domain feeinsight.com). Outreach is
> additionally blocked by email deliverability — see
> `docs/runbooks/dns-email-runbook.md` (SPF/DKIM fixes required first).

| # | ID | Institution | Charter | Tier | Dist | Loc | Cov | Status |
|---|----|-------------|---------|------|------|-----|-----|--------|
| 1 | 860 | Bank of the Pacific | bank | comm_large | 12 | Aberdeen WA | 14/15 | **PILOT** — DRAFT READY — review + send |
| 2 | 4802 | Georgia Heritage FCU | cu | comm_small | 6 | Savannah GA | 13/15 | DRAFT READY — review + send |
| 3 | 2813 | Riverside Bank of Dublin | bank | comm_small | 4 | Dublin OH | 12/15 | DRAFT READY — review + send |
| 4 | 8485 | First Credit Union (name corrected) | cu | comm_mid | 11 | Chandler AZ | 12/15 | DRAFT READY — review + send |
| 5 | 8434 | Bay Cities CU | cu | comm_small | 12 | Hayward CA | 12/15 | DRAFT READY — review + send |
| 6 | 1422 | PB&T Bank | bank | comm_mid | 10 | Pueblo CO | 12/15 | DRAFT READY — review + send |
| 7 | 2033 | Community Bank of Santa Maria | bank | comm_mid | 12 | Santa Maria CA | 12/15 | DRAFT READY — review + send |
| 8 | 303 | HomeTrust Bank | bank | comm_large | 5 | Asheville NC | 12/15 | DRAFT READY — review + send |
| 9 | 4401 | Tampa Bay FCU | cu | comm_mid | 6 | Tampa FL | 12/15 | DRAFT READY — review + send |
| 10 | 200 | Burke & Herbert Bank | bank | comm_large | 5 | Alexandria VA | 11/15 | DRAFT READY — review + send |
| 11 | 201 | Hanmi Bank | bank | comm_large | 12 | Los Angeles CA | 11/15 | DRAFT READY — review + send |
| 12 | 684 | Lawrence Bank | bank | comm_large | 6 | Nashville TN | 11/15 | DRAFT READY — review + send |
| 13 | 1675 | Redwood Capital Bank | bank | comm_mid | 12 | Eureka CA | 11/15 | DRAFT READY — review + send |
| 14 | 6217 | Lockport Schools & Community FCU | cu | comm_small | 2 | Lockport NY | 11/15 | DRAFT READY — review + send |
| 15 | 7349 | DFCU Financial FCU | cu | comm_large | 7 | Dearborn MI | 11/15 | DRAFT READY — review + send |
| 16 | 2466 | Gateway Bank | bank | comm_mid | 9 | Mendota Hts MN | 10/15 | DRAFT READY — review + send |
| 17 | 5759 | Coopers Cave FCU | cu | comm_small | 2 | Glens Falls NY | 10/15 | DRAFT READY — review + send |
| 18 | 6400 | Brockport FCU | cu | comm_small | 2 | Brockport NY | 10/15 | DRAFT READY — review + send |
| 19 | 7192 | Redwood CU | cu | comm_large | 12 | Santa Rosa CA | 10/15 | **HOLD** — institution name likely mislabeled (matches Redwood Credit Union); verify + fix in pipeline before send |
| 20 | 1391 | First Bank | bank | comm_mid | 11 | Burkburnett TX | 9/15 | DRAFT READY — review + send |
| 21 | 2050 | Kentland Bank | bank | comm_mid | 7 | Kentland IN | 9/15 | DRAFT READY — review + send |
| 22 | 8595 | Union Square CU | cu | comm_mid | 11 | Wichita Falls TX | 9/15 | DRAFT READY — review + send |
| 23 | 6185 | Peoples FCU | cu | comm_small | 4 | Nitro WV | 9/15 | DRAFT READY — review + send |
| 24 | 203 | Forbright Bank | bank | comm_large | 5 | Potomac MD | 9/15 | DRAFT READY — review + send |
| 25 | 8101 | Emblem CU | cu | comm_mid | 6 | Gadsden AL | 9/15 | DRAFT READY — review + send |

Spread: 13 banks / 12 CUs · districts 2,4,5,6,7,9,10,11,12 · tiers small/mid/large.

**Data-quality follow-ups for the pipeline:**
- 7192 and 8485 institution names appear mislabeled in institution_sources.
- Redwood Capital Bank (1675): suspicious $50 ATM fee datapoint (50x median) — verify against source document.
- Bank of the Pacific (860) appendix shows contradictory duplicate lines: "Notary $0.00 FREE" AND "Notary service $10.00" — likely one is notary-for-customers vs general; needs dedupe/labeling rule in Darwin/Hamilton. Audit other institutions for same pattern.
- 860 "Maximum overdraft/NSF fee $384.00 · daily" reads like an extraction error — it is the daily cap (12 × $32); frequency/terms phrasing should say "daily maximum" for cap-type lines.
- Registry names can arrive fully uppercase (FIDELITY BANK) — display-layer title-casing added in fill.mjs 2026-08-15; fix casing at source when convenient.
