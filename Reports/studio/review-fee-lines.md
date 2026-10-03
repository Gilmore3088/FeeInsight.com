# Fee-line review (rules v2, pulled 2026-10-03)

Every value the reports use, with the published line it came from. Check a line against the
institution's schedule (appendix in each report) before sending. `flag` is set only when 8+ peers
publish the line. `see appendix` = the schedule lists something under a label the rules declined.

Suggested hold: reports where fewer than 5 lines are rankable, or the lead finding is a low-volume line.

## 200 · Burke & Herbert Bank & Trust Company (Alexandria, VA)
Cohort: 68 peers, scope `national` (community_large) · rankable lines: 7
Email finding: Your overdraft-protection transfer fee ($12.50) is $6 above the $6.50 peer median, the highest of the 10 peers that publish it.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | — | see appendix | $2.00 | 9 | data_gap |
| card_replacement | — |  | $10.00 | 12 | data_gap |
| cashiers_check | — |  | $7.00 | 9 | data_gap |
| deposited_item_return | $10.00 | Returned Deposited Item | $10.00 | 22 |  |
| monthly_maintenance | — | see appendix | $6.00 | 5 |  |
| nsf | $32.00 | Overdraft Fee and Returned Item Fee | $32.00 | 12 |  |
| od_protection_transfer | $12.50 | Overdraft Protection Transfer Fee | $6.50 | 10 | above_band |
| overdraft | — | see appendix | $32.00 | 16 | data_gap |
| paper_statement | — |  | $2.50 | 12 | data_gap |
| stop_payment | $32.00 | Stop Payment Fee | $31.00 | 16 |  |
| wire_domestic_incoming | $15.00 | Incoming Domestic Wire | $14.50 | 16 |  |
| wire_domestic_outgoing | $30.00 | Outgoing Domestic Wire | $25.00 | 10 | above_band |
| wire_intl_outgoing | $60.00 | Outgoing International Wire | $40.00 | 9 | above_band |

## 201 · Hanmi Bank (Los Angeles, CA)
Cohort: 68 peers, scope `national` (community_large) · rankable lines: 8
Email finding: Your overdraft fee ($35) is $3 above the $32 peer median, the 93rd percentile of 15 peers.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | — | see appendix | $2.00 | 9 | data_gap |
| card_replacement | $10.00 | Card Replacement | $10.00 | 11 |  |
| cashiers_check | $5.00 | Cashier's Checks | $7.50 | 8 |  |
| deposited_item_return | $12.00 | Returned Deposit Item - Check or ACH | $10.00 | 22 | above_band |
| monthly_maintenance | — |  | $6.00 | 5 |  |
| nsf | — | see appendix | $32.00 | 13 | data_gap |
| od_protection_transfer | — |  | $7.00 | 11 | data_gap |
| overdraft | $35.00 | Overdraft Fee - Debit Card Transaction | $32.00 | 15 | above_band |
| paper_statement | — |  | $2.50 | 12 | data_gap |
| stop_payment | $30.00 | Stop Payment - Placed at Branch or Call Center | $32.00 | 16 |  |
| wire_domestic_incoming | $10.00 | Incoming Wire | $15.00 | 16 |  |
| wire_domestic_outgoing | $35.00 | Outgoing Wire - Fax Request | $25.00 | 10 | above_band |
| wire_intl_outgoing | $30.00 | Outgoing Wire - International/Domestic/Reverse | $50.00 | 9 | below_band |

## 203 · Forbright Bank (Potomac, MD)
Cohort: 68 peers, scope `national` (community_large) · rankable lines: 8
Email finding: Your cashier's check fee ($10) is $4 above the $6 peer median, the highest of the 8 peers that publish it.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | — | see appendix | $2.00 | 9 | data_gap |
| card_replacement | $10.00 | Debit Card Replacement | $10.00 | 11 |  |
| cashiers_check | $10.00 | Cashier's Check | $6.00 | 8 | above_band |
| deposited_item_return | $7.50 | Return Deposit Item | $10.00 | 22 | below_band |
| monthly_maintenance | — |  | $6.00 | 5 |  |
| nsf | — | see appendix | $32.00 | 13 | data_gap |
| od_protection_transfer | — |  | $7.00 | 11 | data_gap |
| overdraft | — |  | $32.00 | 16 | data_gap |
| paper_statement | $2.00 | Paper Statement Fee on Checking Accounts | $3.00 | 11 |  |
| stop_payment | $30.00 | Stop Payment | $32.00 | 16 |  |
| wire_domestic_incoming | $10.00 | Incoming Domestic Wire Transfer | $15.00 | 16 |  |
| wire_domestic_outgoing | $25.00 | Outgoing Domestic Wire Transfer | $25.00 | 10 |  |
| wire_intl_outgoing | $35.00 | Outgoing International Wire Transfer | $50.00 | 9 | below_band |

## 303 · HomeTrust Bank (Asheville, NC)
Cohort: 68 peers, scope `national` (community_large) · rankable lines: 9
Email finding: Your NSF / returned-item fee ($35) is $3 above the $32 peer median, the 92nd percentile of 12 peers.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | — | see appendix | $2.00 | 9 | data_gap |
| card_replacement | — |  | $10.00 | 12 | data_gap |
| cashiers_check | $5.00 | Official check | $7.50 | 8 |  |
| deposited_item_return | — | see appendix | $10.00 | 23 | data_gap |
| monthly_maintenance | — | see appendix | $6.00 | 5 |  |
| nsf | $35.00 | Returned Item charge | $32.00 | 12 | above_band |
| od_protection_transfer | $7.00 | Savings Overdraft Protection - personal accounts | $8.00 | 10 |  |
| overdraft | $35.00 | Overdraft charge | $32.00 | 15 | above_band |
| paper_statement | $1.50 | Mailed paper statement fee | $3.00 | 11 | below_band |
| stop_payment | $30.00 | Stop payment order | $32.00 | 16 |  |
| wire_domestic_incoming | $25.00 | Wire transfer - incoming domestic U.S. dollar | $14.50 | 16 | above_band |
| wire_domestic_outgoing | $25.00 | Wire transfer - outgoing domestic U.S. dollar | $25.00 | 10 |  |
| wire_intl_outgoing | $50.00 | Wire transfer - outgoing international U.S. dollar | $40.00 | 9 |  |

## 684 · Lawrence Bank (Nashville, TN)  — **consider holding**
Cohort: 68 peers, scope `national` (community_large) · rankable lines: 7
Email finding: Your outgoing domestic wire fee ($20 vs a $25 median) sits below the market range.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | — |  | $2.00 | 9 | data_gap |
| card_replacement | $10.00 | Debit Card Replacement Fee | $10.00 | 11 |  |
| cashiers_check | $5.00 | Cashier's Check Fee | $7.50 | 8 |  |
| deposited_item_return | — |  | $10.00 | 23 | data_gap |
| monthly_maintenance | — |  | $6.00 | 5 |  |
| nsf | — | see appendix | $32.00 | 13 | data_gap |
| od_protection_transfer | — |  | $7.00 | 11 | data_gap |
| overdraft | $33.00 | NSF - Paid Item | $32.00 | 15 |  |
| paper_statement | — |  | $2.50 | 12 | data_gap |
| stop_payment | $34.00 | Stop Payment Fee | $31.00 | 16 |  |
| wire_domestic_incoming | $12.00 | Wire Transfer Fee: Domestic Incoming | $15.00 | 16 |  |
| wire_domestic_outgoing | $20.00 | Wire Transfer Fee: Domestic Outgoing via VB Branch | $25.00 | 10 | below_band |
| wire_intl_outgoing | $50.00 | Wire Transfer Fee: International Outgoing | $40.00 | 9 |  |

## 860 · Bank of the Pacific (Aberdeen, WA)
Cohort: 68 peers, scope `national` (community_large) · rankable lines: 12
Email finding: Your outgoing domestic wire fee ($35) is $10 above the $25 peer median, the highest of the 10 peers that publish it.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | $2.00 | Non-Bank of the Pacific ATM transfers | $2.00 | 8 |  |
| card_replacement | $7.50 | Replacement card | $10.00 | 11 | below_band |
| cashiers_check | $7.00 | Cashier's checks | $6.50 | 8 |  |
| deposited_item_return | $10.00 | Return deposited item fee | $10.00 | 22 |  |
| monthly_maintenance | — | see appendix | $6.00 | 5 |  |
| nsf | $32.00 | NSF (returned item) fee | $32.00 | 12 |  |
| od_protection_transfer | $10.00 | Overdraft transfer fee | $6.50 | 10 |  |
| overdraft | $32.00 | Overdraft (paid item) fee | $32.00 | 15 |  |
| paper_statement | $3.00 | Monthly paper statement fee | $2.00 | 11 |  |
| stop_payment | $35.00 | Stop payment and renewals (branch) | $31.00 | 16 | above_band |
| wire_domestic_incoming | $20.00 | Incoming wire transfer | $14.50 | 16 | above_band |
| wire_domestic_outgoing | $35.00 | Outgoing domestic wire transfer (branch) | $25.00 | 10 | above_band |
| wire_intl_outgoing | $50.00 | Outgoing international wire transfer (branch) | $40.00 | 9 |  |

## 1391 · First Bank (Burkburnett, TX)
Cohort: 60 peers, scope `national` (community_mid) · rankable lines: 5
Email finding: Your stop-payment fee ($25 vs a $30 median) and two other lines sit below the market range.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | $1.00 | ATM foreign transactions | $2.25 | 5 | thin_peer_data |
| card_replacement | $5.00 | Replace Debit card | $10.00 | 6 | thin_peer_data |
| cashiers_check | $3.00 | Cashier's check | $6.00 | 11 | below_band |
| deposited_item_return | — | see appendix | $5.00 | 16 | data_gap |
| monthly_maintenance | — |  | $8.75 | 10 | data_gap |
| nsf | — | see appendix | $33.00 | 19 | data_gap |
| od_protection_transfer | — |  | $5.00 | 2 |  |
| overdraft | — | see appendix | $30.00 | 17 | data_gap |
| paper_statement | — |  | $3.00 | 7 |  |
| stop_payment | $25.00 | Stop Payment - all items | $30.00 | 12 | below_band |
| wire_domestic_incoming | $5.00 | Wire transfer (incoming Domestic)– customer | $12.50 | 10 | below_band |
| wire_domestic_outgoing | $15.00 | Wire transfer (outgoing Domestic) – customer | $25.00 | 9 |  |
| wire_intl_outgoing | $50.00 | Wire transfer (outgoing International) -- customer | $50.00 | 8 |  |

## 1422 · PB&T Bank (Pueblo, CO)
Cohort: 60 peers, scope `national` (community_mid) · rankable lines: 6
Email finding: All 6 of your fee lines with enough peer data sit inside the middle half of the market.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | $2.00 | Foreign ATM Charge | $2.25 | 5 | thin_peer_data |
| card_replacement | $10.00 | Debit Card Replacement | $7.50 | 6 | thin_peer_data |
| cashiers_check | $5.00 | Cashier's Checks | $6.00 | 11 |  |
| deposited_item_return | — | see appendix | $5.00 | 16 | data_gap |
| monthly_maintenance | — | see appendix | $8.75 | 10 | data_gap |
| nsf | — | see appendix | $33.00 | 19 | data_gap |
| od_protection_transfer | — |  | $5.00 | 2 |  |
| overdraft | $29.00 | Overdraft Fee | $30.00 | 16 |  |
| paper_statement | — |  | $3.00 | 7 |  |
| stop_payment | $29.00 | Stop Payment | $30.00 | 12 |  |
| wire_domestic_incoming | $10.00 | Incoming Wire | $12.50 | 10 |  |
| wire_domestic_outgoing | $15.00 | Outgoing Wire (Recurring) | $25.00 | 9 |  |
| wire_intl_outgoing | $50.00 | Foreign Wire | $50.00 | 8 |  |

## 1675 · Redwood Capital Bank (Eureka, CA)
Cohort: 60 peers, scope `national` (community_mid) · rankable lines: 7
Email finding: Your overdraft fee ($35) is $5 above the $30 peer median, the highest of the 16 peers that publish it.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | — | see appendix | $2.13 | 6 |  |
| card_replacement | $5.00 | Debit Card Replacement Fee | $10.00 | 6 | thin_peer_data |
| cashiers_check | $5.00 | Cashiers/Official Check | $6.00 | 11 |  |
| deposited_item_return | — | see appendix | $5.00 | 16 | data_gap |
| monthly_maintenance | $5.00 | Monthly service charge | $10.00 | 9 |  |
| nsf | $35.00 | Non-Sufficient Funds (NSF) Fee - Item Returned | $33.00 | 18 |  |
| od_protection_transfer | — |  | $5.00 | 2 |  |
| overdraft | $35.00 | Overdraft Fee - Item Paid | $30.00 | 16 | above_band |
| paper_statement | — |  | $3.00 | 7 |  |
| stop_payment | $25.00 | Stop Payment | $30.00 | 12 | below_band |
| wire_domestic_incoming | — |  | $10.00 | 11 | data_gap |
| wire_domestic_outgoing | $15.00 | Domestic Wire Transfer | $25.00 | 9 |  |
| wire_intl_outgoing | $25.00 | International Wire Transfer | $50.00 | 8 | below_band |

## 2033 · Community Bank of Santa Maria (Santa Maria, CA)
Cohort: 60 peers, scope `national` (community_mid) · rankable lines: 8
Email finding: Your deposited-item return fee ($18) is 3.6× the $5 peer median, the highest of the 15 peers that publish it.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | — | see appendix | $2.13 | 6 |  |
| card_replacement | $10.00 | Debit card replacement | $7.50 | 6 | thin_peer_data |
| cashiers_check | $8.00 | Cashier's Checks (Customers) | $5.00 | 11 | above_band |
| deposited_item_return | $18.00 | Returned deposited item | $5.00 | 15 | well_above |
| monthly_maintenance | $10.00 | Service charge (NOW Account, minimum daily balance below $1,000) | $7.50 | 9 |  |
| nsf | $33.00 | Insufficient Funds Fee (check, in-person withdrawal, debit card, electronic transaction) | $33.50 | 18 |  |
| od_protection_transfer | — |  | $5.00 | 2 |  |
| overdraft | — |  | $30.00 | 17 | data_gap |
| paper_statement | — |  | $3.00 | 7 |  |
| stop_payment | $30.00 | Stop Payment charge | $30.00 | 12 |  |
| wire_domestic_incoming | $10.00 | Wire Transfer - Domestic Incoming | $12.50 | 10 |  |
| wire_domestic_outgoing | $25.00 | Wire Transfer - Domestic Outgoing | $20.00 | 9 |  |
| wire_intl_outgoing | $40.00 | Wire Transfer - International Outgoing | $50.00 | 8 | below_band |

## 2050 · Kentland Bank (Kentland, IN)
Cohort: 60 peers, scope `national` (community_mid) · rankable lines: 7
Email finding: Your deposited-item return fee ($10) is 2× the $5 peer median, the 87th percentile of 15 peers.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | — | see appendix | $2.13 | 6 |  |
| card_replacement | $20.00 | ATM/Debit Replacement Card | $7.50 | 6 | thin_peer_data |
| cashiers_check | $5.00 | Cashier's Check | $6.00 | 11 |  |
| deposited_item_return | $10.00 | Return Deposit Item | $5.00 | 15 | well_above |
| monthly_maintenance | — | see appendix | $8.75 | 10 | data_gap |
| nsf | — | see appendix | $33.00 | 19 | data_gap |
| od_protection_transfer | — |  | $5.00 | 2 |  |
| overdraft | $30.00 | NSF Paid Item Fee | $30.00 | 16 |  |
| paper_statement | — |  | $3.00 | 7 |  |
| stop_payment | $30.00 | Stop Payment | $30.00 | 12 |  |
| wire_domestic_incoming | $10.00 | Wire Transfer - Incoming Domestic | $12.50 | 10 |  |
| wire_domestic_outgoing | $25.00 | Wire Transfer - Outgoing Domestic | $20.00 | 9 |  |
| wire_intl_outgoing | $65.00 | Wire Transfer - Outgoing Foreign | $50.00 | 8 | above_band |

## 2466 · Gateway Bank (Mendota Heights, MN)
Cohort: 60 peers, scope `national` (community_mid) · rankable lines: 8
Email finding: Your monthly maintenance fee ($17) is 2.3× the $7.50 peer median, the highest of the 9 peers that publish it.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | $1.00 | Non-Network ATM Fee | $2.25 | 5 | thin_peer_data |
| card_replacement | — |  | $10.00 | 7 |  |
| cashiers_check | $5.00 | Cashier's Check | $6.00 | 11 |  |
| deposited_item_return | — | see appendix | $5.00 | 16 | data_gap |
| monthly_maintenance | $17.00 | Account Maintenance | $7.50 | 9 | well_above |
| nsf | $30.00 | Returned Item Fee | $33.50 | 18 |  |
| od_protection_transfer | — |  | $5.00 | 2 |  |
| overdraft | $30.00 | Overdraft Fee | $30.00 | 16 |  |
| paper_statement | — |  | $3.00 | 7 |  |
| stop_payment | $30.00 | Stop Payment | $30.00 | 12 |  |
| wire_domestic_incoming | $15.00 | Incoming Domestic Wire Transfer | $10.00 | 10 |  |
| wire_domestic_outgoing | $25.00 | Outgoing Domestic Wire Transfer | $20.00 | 9 |  |
| wire_intl_outgoing | $50.00 | Outgoing International Wire Transfer | $50.00 | 8 |  |

## 2813 · Riverside Bank of Dublin (Dublin, OH)
Cohort: 91 peers, scope `national_widened` (community_mid, community_small) · rankable lines: 10
Email finding: Your deposited-item return fee ($10) is 2× the $5 peer median, the 88th percentile of 16 peers.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | $2.50 | ATM Transactions (Other ATMs) | $2.00 | 10 |  |
| card_replacement | $15.00 | Debit Card Replacement | $10.00 | 11 | above_band |
| cashiers_check | $4.00 | Cashier's Check | $5.00 | 14 | below_band |
| deposited_item_return | $10.00 | Returned Deposited Item | $5.00 | 16 | well_above |
| monthly_maintenance | — | see appendix | $6.95 | 17 | data_gap |
| nsf | — | see appendix | $31.00 | 28 | data_gap |
| od_protection_transfer | $3.00 | Overdraft Transfer Fee | $5.00 | 3 | thin_peer_data |
| overdraft | $30.00 | Insufficient Funds (per paid item) | $30.00 | 23 |  |
| paper_statement | $3.00 | Paper Statement Fee | $3.00 | 13 |  |
| stop_payment | $25.00 | Stop Payment | $30.00 | 21 |  |
| wire_domestic_incoming | $20.00 | Wire Transfer (Incoming) | $10.00 | 13 | well_above |
| wire_domestic_outgoing | $25.00 | Wire Transfer (Outgoing Domestic) | $25.00 | 12 |  |
| wire_intl_outgoing | $40.00 | Wire Transfer (Outgoing International) | $50.00 | 9 |  |

## 4401 · Tampa Bay Federal Credit Union (Tampa, FL)
Cohort: 141 peers, scope `national_widened` (community_large, community_mid, community_small) · rankable lines: 9
Email finding: Your NSF / returned-item fee ($35) is $8.75 above the $26.25 peer median, the 97th percentile of 60 peers.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | — | see appendix | $2.00 | 22 | data_gap |
| card_replacement | $10.00 | ATM or MasterMoney Debit Replacement Card | $10.00 | 42 |  |
| cashiers_check | $5.00 | Official Check | $5.00 | 29 |  |
| deposited_item_return | $15.00 | Check Deposit Returned NSF | $25.00 | 26 |  |
| monthly_maintenance | $6.95 | Single Service Account Monthly Fee | $5.00 | 23 |  |
| nsf | $35.00 | Share Fee (ACH or Check Returned NSF) | $26.25 | 60 | above_band |
| od_protection_transfer | — |  | $5.00 | 18 | data_gap |
| overdraft | — |  | $29.50 | 32 | data_gap |
| paper_statement | — |  | $3.00 | 14 | data_gap |
| stop_payment | $35.00 | Stop Payment | $25.00 | 70 | above_band |
| wire_domestic_incoming | $10.00 | Incoming Domestic Funds/Wire Transfer | $10.00 | 15 |  |
| wire_domestic_outgoing | $25.00 | Outgoing Domestic Funds/Wire Transfer | $20.00 | 47 |  |
| wire_intl_outgoing | $50.00 | Outgoing International Funds/Wire Transfer | $42.50 | 20 |  |

## 4802 · Georgia Heritage Federal Credit Union (SAVANNAH, GA)
Cohort: 102 peers, scope `national` (community_small) · rankable lines: 9
Email finding: Your stop-payment fee ($33) is $8 above the $25 peer median, the 82nd percentile of 62 peers.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | $2.00 | ATM - Foreign Transactions Fee (Non-GHFCU) | $1.38 | 10 |  |
| card_replacement | $10.00 | ATM/Debit Card Replacement Fee | $10.00 | 31 |  |
| cashiers_check | $5.00 | Official Check Fee | $5.00 | 23 |  |
| deposited_item_return | — | see appendix | $25.00 | 23 | data_gap |
| monthly_maintenance | $2.00 | Monthly Service Fee - Eazy Checking | $5.00 | 15 | below_band |
| nsf | — | see appendix | $27.50 | 51 | data_gap |
| od_protection_transfer | $5.00 | Overdraft Fee - Per Transfer from Another Deposit Account | $5.00 | 14 |  |
| overdraft | — | see appendix | $30.00 | 23 | data_gap |
| paper_statement | — |  | $2.50 | 8 | data_gap |
| stop_payment | $33.00 | Stop Payment Fee | $25.00 | 62 | above_band |
| wire_domestic_incoming | $12.00 | Wire Transfer Fee - Incoming Domestic | $10.00 | 11 | above_band |
| wire_domestic_outgoing | $25.00 | Wire Transfer Fee - Outgoing Domestic | $20.00 | 37 |  |
| wire_intl_outgoing | $50.00 | Wire Transfer Fee - Outgoing International | $40.00 | 16 |  |

## 5759 · Coopers Cave Federal Credit Union (Glens Falls, NY)
Cohort: 32 peers, scope `state` (community_small) · rankable lines: 7
Email finding: Your NSF / returned-item fee ($40) is $15 above the $25 peer median, the highest of the 21 peers that publish it.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | $1.00 | Non-Credit Union Affiliated ATM Usage fee | $1.75 | 7 | thin_peer_data |
| card_replacement | $10.00 | Visa Debit Chip Card Replacement Fee | $10.00 | 16 |  |
| cashiers_check | $10.00 | Certified Check | $3.00 | 9 | well_above |
| deposited_item_return | $40.00 | Returned Deposited Item | $25.00 | 8 | above_band |
| monthly_maintenance | — | see appendix | $3.50 | 5 |  |
| nsf | $40.00 | NSF Returned Item | $25.00 | 21 | above_band |
| od_protection_transfer | — |  | $7.50 | 8 | data_gap |
| overdraft | $30.00 | NSF Paid Item | $30.00 | 9 |  |
| paper_statement | — |  | $3.00 | 3 |  |
| stop_payment | $43.00 | Stop Payment | $25.00 | 27 | above_band |
| wire_domestic_incoming | — |  | $7.50 | 6 |  |
| wire_domestic_outgoing | $25.00 | Domestic Wire Fee | $20.00 | 20 |  |
| wire_intl_outgoing | $40.00 | International Wire Fee | $50.00 | 7 | thin_peer_data |

## 6185 · Peoples Federal Credit Union (Nitro, WV)  — **consider holding**
Cohort: 102 peers, scope `national` (community_small) · rankable lines: 8
Email finding: Your outgoing international wire fee ($25 vs a $45 median) sits below the market range.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | — |  | $1.75 | 11 | data_gap |
| card_replacement | $10.00 | Card Replacement | $10.00 | 31 |  |
| cashiers_check | $5.00 | Cashier's Check | $5.00 | 23 |  |
| deposited_item_return | $25.00 | Deposited Item Return | $25.00 | 22 |  |
| monthly_maintenance | — |  | $5.00 | 16 | data_gap |
| nsf | $25.00 | Non-Sufficient Funds (NSF) | $27.75 | 50 |  |
| od_protection_transfer | $3.00 | Overdraft Transfer | $5.00 | 14 |  |
| overdraft | — | see appendix | $30.00 | 23 | data_gap |
| paper_statement | — |  | $2.50 | 8 | data_gap |
| stop_payment | $25.00 | Stop Payment | $25.00 | 62 |  |
| wire_domestic_incoming | — |  | $10.00 | 12 | data_gap |
| wire_domestic_outgoing | $15.00 | Wire Transfer: Domestic Outgoing | $20.00 | 37 |  |
| wire_intl_outgoing | $25.00 | Wire Transfer: International | $45.00 | 16 | below_band |

## 6217 · Lockport Schools & Community Federal Credit Union (LOCKPORT, NY)  — **consider holding**
Cohort: 32 peers, scope `state` (community_small) · rankable lines: 4
Email finding: Your outgoing domestic wire fee ($30) is $10 above the $20 peer median, the 90th percentile of 20 peers.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | — | see appendix | $1.38 | 8 | data_gap |
| card_replacement | $10.00 | Debit Card Replacement | $10.00 | 16 |  |
| cashiers_check | — |  | $4.00 | 10 | data_gap |
| deposited_item_return | — | see appendix | $30.00 | 9 | data_gap |
| monthly_maintenance | — |  | $3.50 | 5 |  |
| nsf | $30.00 | Check/ACH returned due to non-sufficient funds | $25.00 | 21 |  |
| od_protection_transfer | $5.00 | Overdraft transfer from additional account | $10.00 | 7 | thin_peer_data |
| overdraft | — | see appendix | $30.00 | 10 | data_gap |
| paper_statement | — |  | $3.00 | 3 |  |
| stop_payment | $25.00 | Stop payment order | $25.00 | 27 |  |
| wire_domestic_incoming | $10.00 | Incoming Wire Transfer | $5.00 | 5 | thin_peer_data |
| wire_domestic_outgoing | $30.00 | Outgoing Wire Transfer | $20.00 | 20 | above_band |
| wire_intl_outgoing | — |  | $45.00 | 8 | data_gap |

## 6400 · Brockport Federal Credit Union (Brockport, NY)
Cohort: 32 peers, scope `state` (community_small) · rankable lines: 5
Email finding: Your deposited-item return fee ($15 vs a $30 median) sits below the market range.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | — | see appendix | $1.38 | 8 | data_gap |
| card_replacement | — |  | $10.00 | 17 | data_gap |
| cashiers_check | $5.00 | Certified Check | $3.00 | 9 |  |
| deposited_item_return | $15.00 | Deposited item returned | $30.00 | 8 | below_band |
| monthly_maintenance | — | see appendix | $3.50 | 5 |  |
| nsf | — | see appendix | $25.00 | 22 | data_gap |
| od_protection_transfer | — |  | $7.50 | 8 | data_gap |
| overdraft | $35.00 | Overdraft charge | $30.00 | 9 |  |
| paper_statement | — |  | $3.00 | 3 |  |
| stop_payment | $30.00 | Stop Payment on Share Draft or Electronic Payment | $25.00 | 27 |  |
| wire_domestic_incoming | $10.00 | Wire Transfer Incoming | $5.00 | 5 | thin_peer_data |
| wire_domestic_outgoing | $20.00 | Wire Transfer Outgoing | $20.00 | 20 |  |
| wire_intl_outgoing | — |  | $45.00 | 8 | data_gap |

## 7192 · Redwood Credit Union (SANTA ROSA, CA)  — **consider holding**
Cohort: 38 peers, scope `national_widened` (community_large, community_mid) · rankable lines: 4
Email finding: Your NSF / returned-item fee ($7 vs a $29 median) and one other line sit below the market range.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | — | see appendix | $2.50 | 11 | data_gap |
| card_replacement | $5.00 | Replacement Visa Debit (ATM) Card | $7.50 | 10 |  |
| cashiers_check | $6.00 | Official Checks | $5.00 | 5 | thin_peer_data |
| deposited_item_return | $22.00 | Return of Cashed/Deposited Items from Self | $15.00 | 3 | thin_peer_data |
| monthly_maintenance | — | see appendix | $7.73 | 8 | data_gap |
| nsf | $7.00 | Non-Sufficient Funds (NSF) Fee | $29.00 | 9 | below_band |
| od_protection_transfer | — |  | $5.00 | 3 |  |
| overdraft | $14.00 | Overdraft/Non-Sufficient Fund Overdraft Pay Advantage Fee | $28.50 | 8 | below_band |
| paper_statement | $2.00 | Paper Statements | $3.00 | 5 | thin_peer_data |
| stop_payment | $22.00 | Stop Payment | $30.00 | 7 | thin_peer_data |
| wire_domestic_incoming | — |  | $10.00 | 4 |  |
| wire_domestic_outgoing | $20.00 | Domestic Outgoing Wire Transfer (Self-Service) | $25.00 | 9 |  |
| wire_intl_outgoing | $45.00 | International Outgoing Wire Transfer | $50.00 | 3 | thin_peer_data |

## 7349 · Dfcu Financial Federal Credit Union (Dearborn, MI)  — **consider holding**
Cohort: 38 peers, scope `national_widened` (community_large, community_mid) · rankable lines: 4
Email finding: Your NSF / returned-item fee ($32) is $8 above the $24 peer median, the 89th percentile of 9 peers.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | $2.00 | Other ATM - ATM Monetary Transaction | $2.50 | 10 |  |
| card_replacement | $5.00 | ATM/Debit Card Replacement Fee | $7.50 | 10 |  |
| cashiers_check | — |  | $5.00 | 6 |  |
| deposited_item_return | — | see appendix | $18.50 | 4 |  |
| monthly_maintenance | — | see appendix | $7.73 | 8 | data_gap |
| nsf | $32.00 | Non-Sufficient Funds Fee | $24.00 | 9 | above_band |
| od_protection_transfer | $5.00 | Overdraft Transfer Fee | $3.50 | 2 | thin_peer_data |
| overdraft | — | see appendix | $28.00 | 9 | data_gap |
| paper_statement | $2.00 | Paper Statement Processing Fee | $3.00 | 5 | thin_peer_data |
| stop_payment | — |  | $26.00 | 8 | data_gap |
| wire_domestic_incoming | $0.00 | Wire Transfer Fee - Domestic Incoming | $10.00 | 3 | thin_peer_data |
| wire_domestic_outgoing | $25.00 | Wire Transfer Fee - Domestic Outgoing | $20.00 | 9 |  |
| wire_intl_outgoing | — |  | $47.50 | 4 |  |

## 8101 · Emblem Credit Union (GADSDEN, AL)
Cohort: 141 peers, scope `national_widened` (community_large, community_mid, community_small) · rankable lines: 8
Email finding: Your monthly maintenance fee ($10) is 2× the $5 peer median, the 87th percentile of 23 peers.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | — |  | $2.00 | 22 | data_gap |
| card_replacement | $10.00 | Replacement Card | $10.00 | 42 |  |
| cashiers_check | $2.00 | Cashier's Checks | $5.00 | 29 | below_band |
| deposited_item_return | — | see appendix | $25.00 | 27 | data_gap |
| monthly_maintenance | $10.00 | Monthly Service Fee | $5.00 | 23 | well_above |
| nsf | $20.00 | Insufficient Funds | $27.75 | 60 | below_band |
| od_protection_transfer | — |  | $5.00 | 18 | data_gap |
| overdraft | — |  | $29.50 | 32 | data_gap |
| paper_statement | $3.00 | Paper Statement Fee | $3.00 | 13 |  |
| stop_payment | $20.00 | Stop Payment | $25.00 | 70 |  |
| wire_domestic_incoming | $10.00 | Wire Transfer - Domestic Incoming | $10.00 | 15 |  |
| wire_domestic_outgoing | $20.00 | Wire Transfer - Domestic Outgoing | $20.00 | 47 |  |
| wire_intl_outgoing | — |  | $45.00 | 21 | data_gap |

## 8434 · Bay Cities Credit Union (Hayward, CA)  — **consider holding**
Cohort: 102 peers, scope `national` (community_small) · rankable lines: 8
Email finding: Your outgoing international wire fee ($30 vs a $45 median) sits below the market range.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | $1.00 | ATM Transaction Fee - Savings Account | $1.88 | 10 |  |
| card_replacement | $5.00 | Lost ATM or Visa Debit Card Replacement | $10.00 | 31 |  |
| cashiers_check | $5.00 | Cashier's Checks Payable to 2nd Party | $5.00 | 23 |  |
| deposited_item_return | $25.00 | Deposited Checks Returned Unpaid | $25.00 | 22 |  |
| monthly_maintenance | $5.00 | 1st Checking Monthly Fee | $5.00 | 15 |  |
| nsf | — | see appendix | $27.50 | 51 | data_gap |
| od_protection_transfer | — |  | $5.00 | 15 | data_gap |
| overdraft | — | see appendix | $30.00 | 23 | data_gap |
| paper_statement | — |  | $2.50 | 8 | data_gap |
| stop_payment | $30.00 | Online Bill Pay Stop Payment | $25.00 | 62 |  |
| wire_domestic_incoming | — |  | $10.00 | 12 | data_gap |
| wire_domestic_outgoing | $20.00 | Wire Transfer - USA | $20.00 | 37 |  |
| wire_intl_outgoing | $30.00 | Wire Transfer - Foreign | $45.00 | 16 | below_band |

## 8485 · First Credit Union (Chandler, AZ)
Cohort: 141 peers, scope `national_widened` (community_large, community_mid, community_small) · rankable lines: 9
Email finding: Your non-network ATM fee ($4.50) is 2.3× the $2 peer median, the 86th percentile of 21 peers.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | $4.50 | Out-of-Network ATM Usage | $2.00 | 21 | well_above |
| card_replacement | $5.00 | Visa Card Replacement | $10.00 | 42 |  |
| cashiers_check | — |  | $5.00 | 30 | data_gap |
| deposited_item_return | $35.00 | Deposit Item Returned for NSF | $25.00 | 26 | above_band |
| monthly_maintenance | — | see appendix | $5.00 | 24 | data_gap |
| nsf | $20.00 | Non-Sufficient Funds - Overdraft | $27.75 | 60 | below_band |
| od_protection_transfer | $5.00 | Overdraft Transfers | $5.00 | 17 |  |
| overdraft | $20.00 | Overdraft Payment Service | $30.00 | 31 | below_band |
| paper_statement | — |  | $3.00 | 14 | data_gap |
| stop_payment | $20.00 | Stop Payment | $25.00 | 70 |  |
| wire_domestic_incoming | — |  | $10.00 | 16 | data_gap |
| wire_domestic_outgoing | $20.00 | Wire Transfer - Outgoing Domestic | $20.00 | 47 |  |
| wire_intl_outgoing | $40.00 | Wire Transfer - Outgoing International | $47.50 | 20 |  |

## 8595 · Union Square Credit Union (Wichita Falls, TX)
Cohort: 141 peers, scope `national_widened` (community_large, community_mid, community_small) · rankable lines: 6
Email finding: Your non-network ATM fee ($3) is $1 above the $2 peer median, the 76th percentile of 21 peers.

| Category | Value | Published line used | Peer median | n | Flag |
|---|---:|---|---:|---:|---|
| atm_non_network | $3.00 | ATM Foreign Transaction | $2.00 | 21 | above_band |
| card_replacement | $5.00 | Debit Card Replacement | $10.00 | 42 |  |
| cashiers_check | $5.00 | Cashier's Check | $5.00 | 29 |  |
| deposited_item_return | — | see appendix | $25.00 | 27 | data_gap |
| monthly_maintenance | — |  | $5.00 | 24 | data_gap |
| nsf | — | see appendix | $27.50 | 61 | data_gap |
| od_protection_transfer | $2.00 | Overdraft Transfer | $5.00 | 17 | below_band |
| overdraft | $30.00 | Courtesy Pay | $29.00 | 31 |  |
| paper_statement | $5.00 | Paper Statement | $3.00 | 13 |  |
| stop_payment | — |  | $25.00 | 71 | data_gap |
| wire_domestic_incoming | — |  | $10.00 | 16 | data_gap |
| wire_domestic_outgoing | — |  | $20.00 | 48 | data_gap |
| wire_intl_outgoing | — |  | $45.00 | 21 | data_gap |
