# 2026-10-09: A free line at the bank's own ATM was published as its non-network ATM fee
**What happened:** Regions (institution 27) had "Balance Inquiry $0.00", printed under "Regions
ATM:", live as `atm_non_network` (fee 81986). Its "Balance Inquiry $3.00" under "Non-Regions
ATM:" was rolled back at 01:35 (81956). A read-only query found 41 live free `atm_non_network`
rows that name no other bank or network, among them "MidFirst ATM", "Transactions at Orrstown
Bank ATMs", "ATM Enrollment" and "Check Card/ATM First Card".
**Cause:** the top-50 fold files a bare "Balance Inquiry" by the ATM heading above it, but
`foldContext` took the first copy of a name on the page, so both Regions rows got the "Regions
ATM:" section. Neither the fold nor the guard told the bank's own ATM apart from another
network's. The $3 row came down because the rules re-check keeps one live row per category and
price on a document, and the $3 withdrawal already held `atm_non_network:300`. The catalog still
shows Regions' $3 non-network fee through that withdrawal.
**Fix:** `foldContext` takes the section of the copy priced at the fee's amount. A bare inquiry
under the bank's own ATM heading ("Regions ATM:", "Our ATM:") has no home in the 50. Guard v54
fails a free `atm_non_network` line that names no other bank or network, which means a flag, a
12h second look, then archive. This PR.
**Lesson:** "free at the ATM" is usually the bank's own machine. A non-network price of $0 has
to say whose network it is.
