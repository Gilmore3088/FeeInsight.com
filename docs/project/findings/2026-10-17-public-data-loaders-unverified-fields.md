# 2026-10-17: public data loaders built without reaching any source
**What happened:** the public data loaders (call-report detail, NCUA extras, FDIC history, CFPB agreements, HMDA, CRA, FR Y-9C and NIC, UBPR, designation lists, payment networks, local economy, industry events) were written in a cloud session where every regulator host returned 403 or failed to connect (cdr.ffiec.gov, api.fdic.gov, ncua.gov, consumerfinance.gov, federalreserve.gov, sec.gov and the rest). No URL, column name or field code was checked against a live file.
**Cause:** the cloud sandbox's network policy blocks these hosts. Vercel can reach them: `ffiec-overdraft` has loaded 46 quarters from the FFIEC bulk file on prod.
**Fix:** each loader verifies its fields against the file it downloads on prod, before writing. FFIEC lines load only when the file's own description row matches. NCUA lines are chosen from the zip's account descriptions. Every other loader checks headers or field presence. A missing or mismatched field is listed in `registry_ingest_partitions.detail` and nothing is written for it; a wrong URL records an empty partition. The first prod run of each source is the confirmation. Read its partition detail before any page or API shows the data.
**Lesson:** when a source host is blocked here, write the check into the loader instead of trusting memory, and say "merged, not proven" until a prod run shows rows. The per-loader lists below are what to check on that first run.

## ffiec-call-detail, ncua-extras, fdic-history
1. FFIEC codes: RIADH033-H035; RCONF049-F052; RCFD/RCON 1406, 1407, 1403; RIAD 4635, 4605, B514, B515, K129, K133, K205, K206; RI-E candidates RIADC013-C016, F555-F557, T047; RC-E candidates RCONP753-P758. Each loads only if the bulk file's description row matches; RI-E and RC-E pick the one candidate whose description fits and refuse two.
2. FFIEC schedule file names (RI, RIE, RIBI, RCE, RCN, RCO), matched by "Schedule <code>" in the zip.
3. NCUA: whether the 5300 zip carries AcctDesc.txt and its column names; without it nothing loads.
4. FDIC BankFind history endpoint field names (CERT, CHANGECODE, EFFDATE, ACQ_CERT, OFF_NUM, ...) and the EFFDATE range filter syntax; each run lists fields no record carried.

## cfpb-card-agreements
1. URLs: card zip `files.consumerfinance.gov/a/assets/credit-card-agreements/archive-zips/Credit_Card_Agreements_YYYY_QN.zip`, prepaid `.../prepaid-agreements/prepaid_metadata_all_agreements.csv`, TCCP `.../tccp/TCCP_YYYY_MM.csv`. A wrong URL records an empty partition (HTTP 404), never a guess.
2. Card zip layout (issuer folder / product PDF); the run reports `layout_depths` and any `index_files` so a different layout shows in the partition detail.
3. Prepaid metadata column names (issuer_name, product_name, agreement_id, agreement_url/direct_download, effective_date, current_status, withdrawal_date) and TCCP column names (Institution Name, Product Name, Annual Fee, Late Fee, Foreign Transaction Fee(s), Cash Advance Fee, Balance Transfer Fee, Returned Payment Fee, Purchase APR Median); each run reports missing and unexpected headers, and a file without an issuer or product column loads nothing.
4. Publication lags (card archive ~90 days after quarter end, TCCP ~180 days after the survey month) and the first periods (card 2018Q1, TCCP 2021H1) are estimates; early runs of a not-yet-published period are recorded empty and retried in 3 days.
5. Fee-line labels are tuned to the Schumer box and the prepaid short-form disclosure; PDFs laid out differently (or scanned) give `no_text` or no terms, and no real CFPB PDF was available to test against. The cleaning pass lists ambiguous-term counts per fee so the hit rate is visible.

## hmda
1. Data Browser URLs and params (`/view/csv` and `/view/aggregations` with `states`, `years`, `actions_taken=1`) and the aggregations response shape (`aggregations[0].count/sum`); a shape miss is reported as a reconciliation note and stale rows are then kept.
2. Public LAR column names (`lei`, `derived_msa_md`, `county_code`, `loan_amount`, `total_loan_costs`, `origination_charges`, `discount_points`, `lender_credits`, ...); the header is checked and a missing required column loads nothing.
3. Panel snapshot URL (`files.ffiec.cfpb.gov/static-data/snapshot/{year}/{year}_public_panel_csv.zip`) and its RSSD column name (tries `ID_RSSD`, `RESPONDENT_RSSD`, `RSSD_ID`, `RSSD`); a missing panel falls back to LEI-only matching and is reported.
4. APOR file locations and layout (S3 `cfpb-hmda-public/prod/apor/YieldTable{Fixed,Adjustable}.txt`, then ffiec.cfpb.gov); delimiter is detected, a header without numeric term columns loads nothing.
5. Whether one state-year CSV (California 2020-2021, about 1M originations, maybe 700 MB+) streams inside the 300-second tick; the first run's `bytes` and duration will tell. If it does not, split the largest states by county.

## cra
1. URLs: ratings `https://www.ffiec.gov/craratings/CRA_Ratings.zip` (may be a different name, or not a zip); lending `https://www.ffiec.gov/cra/xls/{yy}exp_discl.zip` and `{yy}exp_trans.zip`. A 404 on the disclosure zip records the year as unpublished; a wrong ratings URL fails the step visibly.
2. Ratings layout: assumed delimited with a header row; headers matched by alias lists (ID_RSSD, Exam Date, Rating, Regulator, Exam Method, PE URL...). Unknown whether the file carries RSSD, FDIC cert or only the agency's own id, or a public-evaluation URL. The partition detail lists headers, the field each mapped to, missing fields and unexpected headers.
3. Lending fixed-width positions (D1-1/D2-1 and transmittal, 2016+ spec) and codes (loan type 4/5, action 1/6, agency 1-4). Every line is checked (table id, year, agency, digit-only fields, bucket ceilings); more than 2% bad lines writes nothing.
4. Report level '040' as the county-total row: the cleaning pass sums income-group rows against it and reports mismatches; the county aggregates rely on it.
5. The aggregate (A-table) file is not loaded: it is tract level, and county totals across all reporters are the sum of disclosure rows. Matching is RSSD only for lending (transmittal), RSSD then FDIC cert for ratings; agency ids are stored but not used to match.

## fr-y9c
1. Download URLs: NIC `ReturnBHCFZipFiles?zipfilename=BHCF<YYYYMMDD>.ZIP`, `ReturnRelationshipsZipFileCSV`, `ReturnAttributesActiveZipFileCSV`, `ReturnAttributesClosedZipFileCSV`, and MDRM `federalreserve.gov/apps/mdrm/pdf/MDRM.zip`. A wrong URL yields an empty partition with the reason, not bad rows.
2. BHCF layout: delimiter (caret, tab or comma is detected) and whether a description row exists; without one, each code is checked against MDRM (FR Y-9C entry valid on the report date).
3. MDRM codes: BHCK2170, BHDM6631/6636, BHFN6631/6636, BHCK2122, BHCK3210, BHCK4340, BHCK4079, BHCK4483, BHCKF555 (interchange), BHCK4635/4605; identity RSSD9001, RSSD9999, RSSD9017, RSSD9130, RSSD9200 (state may be numeric, in which case state stays null and is counted).
4. NIC CSV column names (ID_RSSD_PARENT, ID_RSSD_OFFSPRING, DT_START, DT_END, RELN_LVL, PCT_EQUITY, CTRL_IND, REG_IND, REASON_TERM_RELN; ID_RSSD, NM_LGL, ENTITY_TYPE, STATE_ABBR_NM, ...): checked per file; missing required columns load nothing.
5. Semantics of RELN_LVL / CTRL_IND are not used to filter: the parent chain follows every open link.

## ubpr-peer-groups
1. The bulk-page product labels ("UBPR Ratio -- Single Period"; a peer statistics product matched by `/UBPR\s*(Stat|Peer)/`) and whether the UBPR products use the same `DatesDropDownList` / TSV / Download controls as the call-report product.
2. The UBPR column for the peer group number: no code is remembered, so it is found only by a description containing "PEER GROUP" (and not average/ratio/rank); its file and format (e.g. "1" vs "01") are unknown.
3. The remembered ratio codes (UBPRE004 noninterest income, UBPRE088 efficiency, UBPRE013 ROA, UBPRE018 NIM, UBPRE019 net losses) and that UBPR files carry a description row; no code for service charges / average assets is remembered at all. Unconfirmed codes load only on a unique description match, and every column's status lands in the partition detail.
4. The layout of the peer statistics product (whether it exists as a bulk product, its period and statistic columns, one row per group or several); duplicated groups are refused, not guessed.
5. The publication lag (60 days assumed) and how far back UBPR bulk history goes (2015Q1 chosen to match the call-report loaders).

## designation-lists
1. BankFind field names MDI_STATUS_CODE, MDI_STATUS_DESC, SPECGRP, SPECGRPN, MUTUAL and SUBCHAPS, and their codes (MUTUAL 1 = mutual; MDI code "0" or blank means not an MDI). A missing field is reported in `fields_missing` and produces no rows.
2. FOICU column names LIMITED_INC, TOM_CODE and YEAR_OPENED (aliases tried: LOW_INCOME/LID, FOM_CODE/FOM_TYPE, YEAR_CHARTERED). TOM_CODE is stored as filed, with no label for its codes. FOICU may also carry an MDI column; MINORITY_FLAG/MDI/MDI_FLAG are tried.
3. Page URLs and link patterns: the NCUA MDI page (`ncua.gov/.../minority-depository-institution-preservation`) and the CDFI Fund certification page. Each file's column headers are matched by alias, and the header row is found at run time.
4. (Struck 2026-10-17: the Bank On list was removed under "No non-commercial data".)
5. The CDFI list's "Organization Type" wording, which decides which rows are depository institutions. Holding-company CDFIs are kept unmatched (`holding_company`) and are not pushed down to their banks.

## payment-networks
1. Page URLs: Fed `regii-about.htm` (the Exempt / Not Exempt links) and `regii-average-interchange-fee.htm`. A wrong URL records an empty partition ("page is gone (404)"). (The Zelle, FedNow and RTP participant lists were struck on 2026-10-17 under "No non-commercial data".)
2. Page shapes: whether each list is server-rendered HTML (a JavaScript-built list loads nothing and says so), its column headings, and whether the Fed's issuer lists are CSV/HTML (a PDF/XLSX-only list loads nothing and is named in `linked_files`). Headings are recognised by pattern at run time; unrecognised ones are reported.
3. Link wording on the Fed page ("Exempt" / "Not Exempt", "as of <date>"); a date not stated falls back to the fetch date (`as_of_basis` in the run detail).
4. robots.txt on each host, including overpass-api.de: if it disallows our token the partition records that and loads nothing.
5. Overpass boundary tags (`ISO3166-2=US-XX`, `admin_level=4`) and whether the biggest states finish inside the 180 s query timeout (a timeout records an empty partition with Overpass's remark).

## economy
1. Every URL and column name is from memory: RUCC CSV path, FFIEC flat-file URL and column positions
   (year 1, MSA 2, state 3, county 4, tract 5, MSA MFI 11, ratio 13, tract MFI 14), QCEW
   `industry/10.csv` columns, CBP NAICS variable for 2022+, SAIPE variable names, BEA CAINC1 line
   codes 1-3, FHFA `hpi_master.csv` path/columns, SHED zip name and variables (`BK1`, `BK2_A`/`OD1`,
   `BK2_B`, `weight_pop`), HUD response shape. Each is checked at run time and reported as a gap.
2. FFIEC income level is derived from the file's ratio with the CRA thresholds (not read from FFIEC's
   own indicator column, whose position is unknown); the write is blocked unless the ratio column's
   median is 80-130 and the year column matches.
3. No plain download confirmed for the FDIC household survey tables, FDIC national rates or a World
   Bank RPW CSV: those three are URL-configured and skip until set. (The Atlanta Fed payment choice
   tables were struck on 2026-10-17; World Bank RPW is held and schedules nothing until its terms are
   confirmed.)
4. FDIC industry totals are the sum of every filer's BankFind Call Report figures for the quarter
   (QBP's base), not the published QBP tables; small differences from the QBP are expected.
5. The Census geocoder reuse: `toCensusCsv` from `census-geocoder.ts` is reused, but tracts need the
   `geographies/addressbatch` endpoint (the existing `geocodeBatch` returns coordinates only), plus a
   `geographies/coordinates` lookup for unmatched branches that carry lat/lon.

## industry-events
1. NCUA merger and liquidation page URLs and their column headers (`NCUA_MERGER_PAGES`,
   `NCUA_LIQUIDATION_PAGES`). If NCUA publishes only PDFs, the partition records "only PDF files
   linked" and loads nothing. The CDFI award page URL and columns were not confirmed either, and
   neither was the FHFA page (`fhfa.gov/data/fhlb-membership`) or its XLSX headers. The XLSX is
   read with the fflate-based reader in the module, so no new library is needed.
2. BankFind `/failures` field names (CERT, NAME, CITY, PSTALP, FAILDATE, RESTYPE, RESTYPE1,
   CHCLASS1, QBFASSET, QBFDEP, COST) and SBA FOIA column names (BankName, BankFDICNumber,
   BankNCUANumber, ProjectState, ApprovalFiscalYear, GrossApproval, SBAGuaranteedApproval,
   ThirdPartyLender_*). Every run reports the fields it did not find. The SBA CKAN package id
   `7-a-504-foia` and its resource names are matched by pattern, and the run lists them when none match.
3. regulations.gov: the `filter[agencyId]` value FRS and the `docketType` attribute. (CourtListener
   fee lawsuits were struck on 2026-10-17 under "No non-commercial data".)
4. Which us-gaap concepts banks use for fee income. They are found at run time by
   name or label pattern, and the run lists `fee_concepts_found` with SEC's labels so they can be
   reviewed. 8-K and 10-K passage detection is by text pattern. The 8-K item list is read from the
   document text, because `parseSecSubmissions` (in shared sec.ts) drops the submissions "items" field.
5. H.2 release URL shape (`/releases/h2/YYYYMMDD/default.htm`) and the OCC Weekly Bulletin index URL
   and PDF links. Lines are kept by keyword under the nearest heading, so this is low precision
   (early warning, not a confirmed event list). `institution_name` is filled only when the text
   before the first comma reads like an institution.

## First prod runs (2026-10-17, 11:57-12:07 UTC)

- `fdic-history` 2026: 5,035 events written, 4,770 linked to an institution, no missing fields.
- `ffiec-call-detail` 2026Q1: 4,336 banks, 39,806 rows. Loaded: H034 ATM fees (512 banks), the RI-E lines (ATM, check printing, safe deposit, interchange, wire), RC-N past due and nonaccrual, RI-B totals, card and auto. Refused by the description check: H033 ("SEV CHAR DEP DOM OFF MAIN IND"), H035 ("...ALL IND"), RC-E ("NONINTR TRN ACCTS INDIV HSHLD FMLY" and siblings), K205/K206 ("CHARGE-OFFS ALL OTHER"). RC-O was missing because its file is split with the part marker after the date ("Schedule RCO 03312026(1 of 2).txt"). Parser v2 matches those descriptions and file names; RC-E now loads each line on its own (P753, P754, P756, P758) and P757 (MMDA of partnerships and corporations) is left out.
- `ncua-extras` 2026Q2: empty, because the loader read `Acct-DescTradeNames.txt` instead of `AcctDesc.txt`. Parser v2 skips the trade-names file.

## CRA source check (2026-10-17, data-source research)

- The CRA loader's URLs were wrong. Ratings are `apps.ffiec.gov/craratings/craratng.zip`, tab-delimited
  in the spec's order (ID, Regulator, Exam Date, Name, City, State, Assets $000, Exam Method, Rating),
  possibly with no header row. The ID depends on the regulator (OCC charter, FRB RSSD, FDIC cert, OTS
  docket); there is no RSSD column. Flat files live under `www.ffiec.gov/sites/default/files/data/cra/flat-files/`,
  and FFIEC's revised 2022 and 2023 files win over the originals. Parser v2 reads all of this; the
  `cra` partitions retry on the bump. The fixed-width flat-file column positions are still unverified.
- Round-2 first run, 13:40-13:55 UTC: only `ffiec-call-detail` v4 had run (123,955 rows written) and
  `bls-qcew` (16,828). The other round-2 sources had not reached the scheduler yet.
