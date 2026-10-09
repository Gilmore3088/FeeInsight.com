# 2026-10-09: 39 state-law source pages could not be fetched

**What happened:** The cloud network cannot reach state legislature or court sites, so the Mac's Remote Control session fetched the 103 distinct URLs behind the 125 unconfirmed state-fee-law leads (fixtures/state-fee-law-sources/manifest.tsv on branch claude/state-law-sources, commit fcc8126). 56 returned 200 and were read into PR 339. The 47 below did not return a readable page, so their leads stay unconfirmed in STATE_FEE_LAW_COVERAGE.

**Cause:** Bot protection on legislature sites (akleg.gov, leginfo.legislature.ca.gov, legislature.mi.gov, nysenate.gov, justia, mass.gov) answered 403. Others (ilga.gov, ndlegis.gov, codes.ohio.gov, rilegislature.gov, njleg) timed out from the Mac's network. The Tennessee URL carries a stray trailing ";" from the research notes, and vda.delaware.gov/?p=76 no longer exists.

**Retry (commit 622d53b):** the Mac retried all 47 with headless Chromium. 8 loaded (CA-1, CA-2, CA-3, CO-4, MA-1, MA-3, NY-1, NY-2) and were read into PR 339; the CA, MA and NY files replaced error pages the first pass had saved as content. 22 of the 39 that still fail reset the connection from the Mac's network as well, so they need another source (Justia, the state's PDF code compilation, or a cached copy) rather than another retry:

- https://codes.ohio.gov/ohio-revised-code/section-1109.20
- https://codes.ohio.gov/ohio-revised-code/section-2716.05
- https://gc.nh.gov/rsa/html/NHTOC/NHTOC-XXXV-384-G.htm
- https://ilga.gov/documents/legislation/ilcs/documents/073500050K12-1001.htm
- https://judicial.alabama.gov/docs/library/rules/cv64_A.pdf
- https://legacy.utcourts.gov/rules/view.php?type=urcp&rule=64d
- https://legislature.idaho.gov/statutesrules/idstat/title28/t28ch42/sect28-42-308/
- https://legislature.vermont.gov/statutes/section/08/221/31405
- https://malegislature.gov/Bills/190/H2976.Html
- https://ndlegis.gov/cencode/t06c08.pdf
- https://olis.oregonlegislature.gov/liz/2021R1/Downloads/MeasureDocument/HB2356
- https://pub.njleg.gov/bills/2016/A5000/4965_I1.HTM
- https://pub.njleg.gov/bills/9899/A1500/1317_I1.PDF
- https://pub.njleg.state.nj.us/Bills/2024/A4000/3513_I1.PDF
- https://statetreasurer.wyo.gov/wp-content/uploads/2020/04/AnnualReportChecklist.pdf
- https://webserver.rilegislature.gov/BillText12/SenateText12/S2437.htm
- https://webserver.rilegislature.gov/Statutes/TITLE19/19-9/INDEX.htm
- https://www.capitol.tn.gov/Bills/114/Fiscal/SB0766.pdf;
- https://www.ilga.gov/Legislation/BillStatus/FullText?GAID=18&DocNum=4474&DocTypeID=HB&LegId=165196&SessionID=114
- https://www.ilga.gov/legislation/ilcs/ilcs3.asp?ActID=1189&ChapterID=20
- https://www.nd.gov/dfi/sites/www/files/documents/State%20Credit%20Union%20Board/Orders/SCUBOrder206052020.pdf
- https://www.nebraskalegislature.gov/laws/statutes.php?statute=25-1056

**Fix:** None yet for the 39. Retry from the Mac with a real browser (Playwright Chromium, headless) for the 403s, a longer timeout for the timeouts, and the corrected Tennessee URL. Where a site keeps refusing, find the same section on another official host (for example the state's own PDF code compilation) before using a secondary source.

**Lesson:** A plain fetch is enough for about half of state sites. Legislature sites need a browser fetch, and lead URLs should be checked for typos before handing them to the fetcher.

**403 Forbidden (22):**

- AK (fee_authority): https://www.akleg.gov/basis/get_documents.asp?session=34&docid=11679
- AK (fee_authority): https://www.akleg.gov/basis/get_documents.asp?session=32&docid=78316
- CA (returned_item): https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=199920000AB1606
- CA (other): https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260AB2795
- CA (basic_account): https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260AB1365
- CO (dormancy): https://law.justia.com/codes/colorado/2018/title-38/unclaimed-property/article-13/section-38-13-107/
- CO (fee_authority): https://law.justia.com/codes/colorado/title-11/credit-unions/article-30/section-11-30-104/
- CO (garnishment_legal_process): https://content.leg.colorado.gov/sites/default/files/2019a_1189_signed.pdf
- CO (payee_returned_check): https://content.leg.colorado.gov/sites/default/files/images/olls/crs2024-title-05.pdf
- HI (garnishment_legal_process): https://www.capitol.hawaii.gov/hrscurrent/Vol13_Ch0601-0676/HRS0652/HRS_0652-.htm
- MA (basic_account): https://www.mass.gov/info-details/savings-and-checking-accounts
- MA (other): https://www.mass.gov/regulatory-bulletin/21-106-guidelines-for-18-65-accounts-for-banks-and-credit-unions
- MI (garnishment_legal_process): https://legislature.mi.gov/documents/2023-2024/billengrossed/House/pdf/2023-HEBS-4900.pdf
- MI (overdraft_nsf): https://legislature.mi.gov/documents/2025-2026/billengrossed/Senate/pdf/2025-SEBS-0360.pdf
- MS (fee_authority): https://www.sos.ms.gov/adminsearch/ACCode/00000214c.pdf
- NH (other): https://gc.nh.gov/rsa/html/NHTOC/NHTOC-XXXV-384-G.htm
- NJ (garnishment_legal_process): https://www.njcourts.gov/sites/default/files/forms/12323_obj_bank_levy.pdf
- NM (dormancy): https://www.nmlegis.gov/Sessions/23%20Regular/final/HB0165.pdf
- NV (garnishment_legal_process): https://archive.leg.state.nv.us/Session/83rd2025/Bills/SB/SB142_R1.pdf
- NY (overdraft_nsf): https://www.steptoe.com/en/news-publications/nydfs-proposals-target-overdraft-fees.html
- NY (dormancy): https://www.nysenate.gov/legislation/bills/2025/S4109
- NY (overdraft_nsf): https://www.nysenate.gov/legislation/bills/2025/S7031

**timed out (22):**

- AL (garnishment_legal_process): https://judicial.alabama.gov/docs/library/rules/cv64_A.pdf
- ID (payee_returned_check): https://legislature.idaho.gov/statutesrules/idstat/title28/t28ch42/sect28-42-308/
- IL (garnishment_legal_process): https://ilga.gov/documents/legislation/ilcs/documents/073500050K12-1001.htm
- IL (overdraft_nsf): https://www.ilga.gov/Legislation/BillStatus/FullText?GAID=18&DocNum=4474&DocTypeID=HB&LegId=165196&SessionID=114
- IL (basic_account): https://www.ilga.gov/legislation/ilcs/ilcs3.asp?ActID=1189&ChapterID=20
- MA (dormancy): https://malegislature.gov/Bills/190/H2976.Html
- ND (payee_returned_check): https://ndlegis.gov/cencode/t06c08.pdf
- ND (fee_authority): https://www.nd.gov/dfi/sites/www/files/documents/State%20Credit%20Union%20Board/Orders/SCUBOrder206052020.pdf
- NE (garnishment_legal_process): https://www.nebraskalegislature.gov/laws/statutes.php?statute=25-1056
- NH (atm): https://gc.nh.gov/rsa/html/xxxv/383-b/383-b-mrg.htm
- NJ (overdraft_nsf): https://pub.njleg.gov/bills/9899/A1500/1317_I1.PDF
- NJ (garnishment_legal_process): https://pub.njleg.state.nj.us/Bills/2024/A4000/3513_I1.PDF
- NJ (overdraft_nsf): https://pub.njleg.gov/bills/2016/A5000/4965_I1.HTM
- OH (returned_item): https://codes.ohio.gov/ohio-revised-code/section-1109.20
- OH (garnishment_legal_process): https://codes.ohio.gov/ohio-revised-code/section-2716.05
- OR (check_cashing): https://olis.oregonlegislature.gov/liz/2021R1/Downloads/MeasureDocument/HB2356
- RI (overdraft_nsf): https://webserver.rilegislature.gov/BillText12/SenateText12/S2437.htm
- RI (fee_change_notice): https://webserver.rilegislature.gov/Statutes/TITLE19/19-9/INDEX.htm
- TN (returned_item): https://www.capitol.tn.gov/Bills/114/Fiscal/SB0766.pdf;
- UT (garnishment_legal_process): https://legacy.utcourts.gov/rules/view.php?type=urcp&rule=64d
- VT (fee_authority): https://legislature.vermont.gov/statutes/section/08/221/31405
- WY (dormancy): https://statetreasurer.wyo.gov/wp-content/uploads/2020/04/AnnualReportChecklist.pdf

**406 Not Acceptable (1):**

- CO (other): https://leg.colorado.gov/bills/hb25-1090

**404 Not Found (1):**

- DE (dormancy): https://vda.delaware.gov/?p=76

**202 Accepted (no page body) (1):**

- WY (garnishment_legal_process): https://www.wyocourts.gov/legal-help-by-topic/garnishment/
