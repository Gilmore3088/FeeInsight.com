# CFPB complaints were filed under banks by stripped-name matches with non-bank companies

Found 2026-10-16 while checking why 47 institutions with an accepted CFPB match had no 2025
complaint records (H06 follow-up to #1526).

## What the 47 are
All 47 links were accepted before the 2025 partition loaded (2026-10-08 16:12 UTC), and the
partition lists every company with a 2025 complaint (3,968 companies). So a correct match with no
2025 rows is a real zero. But most of the 47 are not correct matches: Progressive National Bank is
linked to "Progressive Financial Services, Inc." (a debt collector), Focus Bank to "Focus Holding
Company", Lake City Bank to "LAKELAND BANCORP, INC." (a different bank's parent in New Jersey).
Their zero says nothing about the bank.

## Why
`normalizeCompanyName` (`src/lib/regulatory/cfpb.ts`) strips "Financial", "Services", "Group",
"Holdings", "Bank" and similar words so that "JPMorgan Chase & Co." meets "JPMorgan Chase Bank".
A CFPB company with no bank word then collapses to one distinctive word ("PROGRESSIVE"), and when
one bank has that key the match was accepted at 0.95 as `exact_name`. v4 only rejected non-bank
names that would have waited for review. The same path filed 28,130 complaints (all years) under the small
Nelnet Bank ("Nelnet, Inc.", the loan servicer) and "Financial Services of America" under Bank of
America. A holding company's full name can collide too: "Berkshire Financial Services, LLC" is the
full name of Lee Bank's parent, and the CFPB company of that name may be an unrelated firm (inferred; not checked).

## Fix (CFPB_PARSER_VERSION 5)
`matchCompany` with `rejectNonBankNames` accepts a name with no bank word only for a bank of $10B or
more, and, unless it matched the parent's full name, only when the name leads with the bank's own
words. Other such matches wait for a person (`non_bank_name_review`), who can accept a real parent
such as "Eagle Financial Services, Inc." for Bank of Clarke. Hand decisions are kept.

Dry read on prod, 2026-10-16: 84 machine-accepted links change; 72 of the 212 institutions with an
accepted match lose it (their complaint counts become unknown); 9,141 complaints for 2025 leave
those institutions. One known leftover: Bell Bank keeps "Bell Financial Services" and "Bell LLC"
because it is over $10B and the names lead with its word.

**Agent lesson:** hoovie/pr-1627-non-bank-company-names
