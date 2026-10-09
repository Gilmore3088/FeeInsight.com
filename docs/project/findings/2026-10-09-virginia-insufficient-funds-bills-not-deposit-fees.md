# 2026-10-09: Virginia's 15 "insufficient funds" bills are not deposit-fee bills

**What happened:** Open States returns no Virginia fee bills, so the Mac searched Virginia LIS directly (2026 Regular Session, failed bills included). "overdraft" matched 0 bills and "insufficient funds" matched 15. The Mac fetched all 15 bill pages (branch claude/state-law-sources, commit 1c2ddc7, fixtures/va-bills/), and each LIS summary was read.

**Cause:** The phrase appears in the bills' full text, not in what they are about. From each LIS summary:
- Residential landlord and tenant law (10): HB15, HB95, HB379, HB519, HB1252, HB1259, HB1408, SB48, SB349, SB585.
- College savings and scholarships (3): HB1001, SB174, SB375.
- HB177, "Fee for passing bad checks to localities" (Chapter 86, effective 7/1/2026): a fee a locality charges a taxpayer whose check or electronic payment is not honored. It is not a bank fee.
- HB1309, "Consumer finance companies; additional charges" (Chapter 464, effective 7/1/2026): GAP waiver and insurance charges on consumer finance loans. It is not a deposit fee.

**Fix:** None of the 15 is tagged. Virginia had no 2026 bill on bank deposit-account fees in this search.

**Lesson:** For a state that Open States holds as titles only, a full-text "insufficient funds" search mostly finds landlord and payment-to-government bills. Read each bill's summary before tagging it.
