import { sql } from "@/lib/data-store/connection";
import { recordAttempt } from "@/lib/agents/learning/attempts";

import { looksLikePdfUrl } from "./find-validate";
import { urlIdentity } from "./finders";
import { otherInstitutionAtHost } from "./other-bank-host";

type SqlTag = typeof sql;

/**
 * Consumer fee schedules found by hand (James, or a web search for the banks he listed) for
 * banks Magellan had not found yet. Each is
 * stored as a companion document (`consumer_supplement`), the same way the paid schedule
 * search stores its answers, so the bank keeps its link and live fees and companion fetch,
 * Rosetta and Knox read the schedule next. Adding a link here is the whole change: the
 * fetch step adds any listed schedule the bank does not hold yet, once.
 */
export const OPERATOR_SCHEDULE_STRATEGY = { strategy: "discover.operator_schedule", version: 1 } as const;

export interface OperatorSchedule {
  institutionId: number;
  /** Must match the stored name, so a renumbered or different database never gets the link. */
  institutionName: string;
  url: string;
  /** Who gave the link and when (UTC). */
  givenBy: string;
}

export const OPERATOR_SCHEDULES: readonly OperatorSchedule[] = [
  {
    institutionId: 1,
    institutionName: "JPMorgan Chase Bank, National Association",
    url: "https://www.chase.com/content/dam/chase-ux/documents/personal/checking/ABSF-en.pdf",
    givenBy: "James, 2026-10-07 00:51",
  },
  {
    // James's link (2026-10-07 00:52) was Citi Bangladesh's schedule of charges (taka), which
    // Rosetta rightly rejected. Citi publishes no single US fee schedule; this is its US
    // Consumer Deposit Account Agreement, U.S. markets, effective 2025-11-20, with its Appendix 1
    // fee schedule (the comparison chart returned HTTP 404 on 2026-10-07 07:35). Citi charges no
    // overdraft fee (dropped in 2022).
    institutionId: 3,
    institutionName: "Citibank, National Association",
    url: "https://online.citi.com/JRS/popups/ao/CDAA.pdf",
    givenBy: "web search for the US consumer schedule, 2026-10-07 08:05",
  },
  {
    // The deposit products guide (fetched 2026-10-07, document 20724) names the Overdraft Paid
    // Fee but never states it; this overdraft coverage disclosure does ($36, three a day).
    institutionId: 5,
    institutionName: "U.S. Bank National Association",
    url: "https://www.usbank.com/dam/documents/pdf/checking/ATM_DebitCard_ODCoverage_Yes.pdf",
    givenBy: "web search for the Tennessee report's largest banks, 2026-10-07 07:00",
  },
  {
    institutionId: 18,
    institutionName: "Citizens Bank, National Association",
    url: "https://www.citizensbank.com/dam/ceb2aa29-d6d9-4973-8a02-b3fa012f5f28/personal-fees-original-file.pdf",
    givenBy: "web search for James's largest-bank list, 2026-10-07 01:05",
  },
  {
    institutionId: 22,
    institutionName: "The Huntington National Bank",
    url: "https://www.huntington.com/-/media/pdf/RR5INTCHKRPAC",
    givenBy: "web search for James's largest-bank list, 2026-10-07 01:05",
  },
  {
    institutionId: 23,
    institutionName: "KeyBank National Association",
    url: "https://www.key.com/content/dam/kco/documents/personal/key_smart_checking_fee_transparency.pdf",
    givenBy: "web search for James's largest-bank list, 2026-10-07 01:05",
  },
  {
    institutionId: 27,
    institutionName: "Regions Bank",
    // The virtualDocuments copy is Rev. 8/20 (found stale by the accuracy check, 2026-10-09);
    // regions.com now serves the personal pricing schedule from its media library.
    url: "https://www.regions.com/-/media/pdfs/pricing-schedules/Checking-Pricing-Schedule.pdf",
    givenBy: "web search for the accuracy check's stale Regions schedule, 2026-10-09 02:30",
  },
  {
    institutionId: 30,
    institutionName: "USAA Federal Savings Bank",
    url: "https://content.usaa.com/mcontent/static_assets/Media/bk-depository-agreement-disclosures-toc-current.pdf",
    givenBy: "web search for James's largest-bank list, 2026-10-07 01:05",
  },
  {
    // Access Checking pays no overdrafts, so its guide has no overdraft fee; TotalView does ($35).
    institutionId: 37,
    institutionName: "First Horizon Bank",
    url: "https://www.firsthorizon.com/-/media/Files/TotalView-Account-Service-Fee-Guide.pdf",
    givenBy: "web search for the Tennessee report's largest banks, 2026-10-07 07:00",
  },
  {
    institutionId: 104,
    institutionName: "FirstBank Puerto Rico",
    // Perfecta account: $15 per item paid into insufficient funds (2026-10-08 16:05 search).
    url: "https://www.1firstbank.com/pr/en/documents/accounts/Disclosure-of-Rates-Terms-and-Fees-Deposit-Perfecta-Account-Eng.pdf",
    givenBy: "web search for banks hidden by the 3-fee rule, 2026-10-07 01:10",
  },
  {
    institutionId: 122,
    institutionName: "FirstBank",
    url: "https://www.firstbankonline.com/wp-content/uploads/2024/04/Schedule-of-Fees_Consumer-04.08.2024.pdf",
    givenBy: "web search for banks hidden by the 3-fee rule, 2026-10-07 01:10",
  },
  {
    institutionId: 265,
    institutionName: "First Internet Bank of Indiana",
    url: "https://www.firstib.com/disclosures/fees-common-personal-accounts/",
    givenBy: "web search for Knox's hidden-bank list, 2026-10-07 01:25",
  },
  {
    institutionId: 430,
    institutionName: "Minnwest Bank",
    url: "https://www.minnwestbank.com/hubfs/Document%20Manager/Disclosures/Consumer_Online_Account_Opening_Disclosure.pdf",
    givenBy: "web search for Knox's hidden-bank list, 2026-10-07 01:25",
  },
  {
    institutionId: 535,
    institutionName: "The First National Bank of Fort Smith",
    url: "https://www.fnbfs.com/additional-services/",
    givenBy: "web search for Knox's hidden-bank list, 2026-10-07 01:25",
  },
  {
    institutionId: 551,
    institutionName: "Commercial Bank",
    url: "https://www.cbtn.com/assets/files/Hxhhzv2G",
    givenBy: "web search for Knox's hidden-bank list, 2026-10-07 01:25",
  },
  {
    institutionId: 800,
    institutionName: "Farmers & Merchants Bank",
    url: "https://www.fmbankva.com/about-schedule-of-fees/",
    givenBy: "web search for Knox's hidden-bank list, 2026-10-07 01:25",
  },
  {
    institutionId: 986,
    institutionName: "Bank Forward",
    url: "https://bankforward.com/wp-content/uploads/2024/03/Cost-of-Services.pdf",
    givenBy: "web search for Knox's hidden-bank list, 2026-10-07 01:25",
  },
  {
    institutionId: 1360,
    institutionName: "Quontic Bank",
    url: "https://www.quontic.com/wp-content/uploads/2024/03/Section-5-Deposit-Products-Services-Fees.pdf?u1=3af49b71d9cf49ad92ab4ce67aae9525",
    givenBy: "web search for Knox's hidden-bank list, 2026-10-07 01:25",
  },
  {
    institutionId: 1562,
    institutionName: "Citizens Bank Minnesota",
    url: "https://www.citizensmn.bank/assets/files/C3cPxmd4",
    givenBy: "web search for Knox's hidden-bank list, 2026-10-07 01:25",
  },
  {
    institutionId: 1599,
    institutionName: "Frontier State Bank",
    url: "https://www.frontier-ok.com/assets/files/EMayvweh",
    givenBy: "web search for Knox's hidden-bank list, 2026-10-07 01:25",
  },
  {
    institutionId: 2375,
    institutionName: "City Bank & Trust Co.",
    url: "https://www.citybankandtrust.com/Disclosures/",
    givenBy: "web search for Knox's hidden-bank list, 2026-10-07 01:25",
  },
  {
    institutionId: 5000,
    institutionName: "Riverfront Federal Credit Union",
    url: "https://riverfrontfcu.org/PDFs/Rate-and-Fee-Disclosure/Rate-and-Fee-Disclosure.pdf",
    givenBy: "web search for Knox's hidden-bank list, 2026-10-07 01:25",
  },
  {
    institutionId: 5214,
    institutionName: "Thinkwise Federal Credit Union",
    url: "https://www.thinkwisecu.org/savings-rates",
    givenBy: "web search for Knox's hidden-bank list, 2026-10-07 01:25",
  },
  {
    institutionId: 6643,
    institutionName: "Local 804 Federal Credit Union",
    url: "https://cu804.org/fees-and-disclosures/",
    givenBy: "web search for Knox's hidden-bank list, 2026-10-07 01:25",
  },
  {
    institutionId: 7332,
    institutionName: "Central Kansas Education Federal Credit Union",
    url: "https://www.ckecusalina.com/Rates",
    givenBy: "web search for Knox's hidden-bank list, 2026-10-07 01:25",
  },
  {
    // The bank's own copy (Morgan Stanley Online accounts). Its pricing page times out, and
    // our fetcher has failed on us.etrade.com since 2026-10-04, so the E*TRADE copy is not used.
    institutionId: 16,
    institutionName: "Morgan Stanley Private Bank, National Association",
    url: "https://www.morganstanley.com/content/dam/msdotcom/en/wealth-disclosures/pdfs/MSPBNA_MSO_Bank_Deposit_Rate_Fee_Schedule.pdf",
    givenBy: "web search for the state market leaders, 2026-10-07 03:55",
  },
  {
    // BMO has no single schedule; this is its Smart Money checking disclosure.
    institutionId: 14,
    institutionName: "BMO Bank National Association",
    url: "https://www.bmo.com/en-us/pdf/smart_money_reg_dd.pdf",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
  },
  {
    // Deposit Account Pricing Guide, January 2026.
    institutionId: 15,
    institutionName: "Charles Schwab Bank, SSB",
    url: "https://disclosures.schwab.com/SchwabDashboard/62667/REG30608.pdf",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
  },
  {
    // Products and fees guide from the 2024 public file. Replaces the overdraft enrollment
    // terms (HTTP 403 on 2026-10-07), which list no fee amounts beyond overdraft.
    institutionId: 33,
    institutionName: "Flagstar Bank, National Association",
    url: "https://www.flagstar.com/content/dam/flagstar/about-flagstar/community-involvement/pdfs/flagstar-bank-products-and-fees-guide.pdf",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
  },
  {
    // consumer schedule of fees, effective 2025-09-15, on Zions' investor-relations file
    // host: the amegybank.com copy answered 403 (2026-10-08 11:08).
    institutionId: 35,
    institutionName: "Zions Bancorporation, N.A.",
    url: "https://s203.q4cdn.com/215756951/files/doc_downloads/2026/03/ZFNB-Consumer-Schedule-of-Fees.pdf",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-08 13:45",
  },
  {
    // other account services, September 2025.
    institutionId: 42,
    institutionName: "Columbia Bank",
    url: "https://www.umpquabank.com/globalassets/media/documents/columbia_bank_other_account_services.pdf",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
  },
  {
    // The full fee and service charge page; replaces the overdraft-only page.
    institutionId: 47,
    institutionName: "Pinnacle Bank",
    url: "https://pnfp.com/personal-finance/deposit-accounts/disclosure-of-fees-and-service-charges",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
  },
  {
    // summary of fees and definitions.
    institutionId: 50,
    institutionName: "BOKF, National Association",
    url: "https://scsvc.bokf.com/-/media/Files/PDF/BOK/BOKSummaryOfFeesAndDefinitions.pdf",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
  },
  {
    // consumer schedule effective 2026-09-01 (the stored link is the July 2025 edition).
    institutionId: 66,
    institutionName: "Banc of California",
    url: "https://dam.bancofcal.com/asset/8605259e-5406-4198-ba49-f5495a220a9b/Schedule-of-Fees-for-Consumers.pdf",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
  },
  {
    // personal fee schedule page.
    institutionId: 78,
    institutionName: "Arvest Bank",
    url: "https://www.arvest.com/personal/fee-schedule",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
  },
  {
    // personal deposit agreement and schedule of fees.
    institutionId: 84,
    institutionName: "Axos Bank",
    url: "https://www.axosbank.com/-/media/Axos/Documents/Legal/Personal-Deposit-Account-Agreement-and-Schedule-of-Fees--Axos.pdf",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
  },
  {
    // personal account disclosures; fee schedule on pages 39-48.
    institutionId: 87,
    institutionName: "Rockland Trust Company",
    url: "https://www.rocklandtrust.com/assets/files/T7YMA5SW",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
  },
  {
    // products, services and fees from the 2023 public file.
    institutionId: 111,
    institutionName: "First Financial Bank",
    url: "https://www.bankatfirst.com/content/dam/bankatfirst/legal/cra-public-file/2023/bank-products-services-fees.pdf",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
  },
  {
    // consumer services fees from the public file.
    institutionId: 112,
    institutionName: "Busey Bank",
    url: "https://www.busey.com/assets/files/P0lBSs0h/CRA_PublicFile_ConsumerServicesFees.pdf",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
  },
  {
    // schedule of service fees, 2025-03-25.
    institutionId: 142,
    institutionName: "First Commonwealth Bank",
    url: "https://www.fcbanking.com/media/fbgdwdtw/schedule-of-service-fees.pdf",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
  },
  {
    // miscellaneous fees, 2025-03-24.
    institutionId: 154,
    institutionName: "Amerant Bank, National Association",
    url: "https://media.amerantbank.com/wp-content/uploads/2022/12/AMTB-MisclFeesINTENG.pdf",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
  },
  {
    // overdraft privilege terms: the personal fee schedule PDF answered 404 (2026-10-08 08:53).
    institutionId: 186,
    institutionName: "Sunflower Bank, National Association",
    url: "https://www.sunflowerbank.com/terms-and-agreements/overdraft-privilege",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-08 13:45",
  },
  {
    // 2026 service fees.
    institutionId: 4382,
    institutionName: "Pentagon Federal Credit Union",
    url: "https://www.penfed.org/content/dam/penfedbtp/pdfs/servicefees-2026.pdf",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
  },
  {
    // fee schedule page, 2025-08-22.
    institutionId: 4677,
    institutionName: "Police & Fire Federal Credit Union",
    // The fee page never read; the July 2025 disclosure PDF states $18 and $7 per overdraft.
    url: "https://www.pffcu.org/wp-content/uploads/2025/06/PFFCT44Web_07-01-2025.pdf",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
  },
  {
    // fee schedule, April 2026.
    institutionId: 6741,
    institutionName: "Schoolsfirst Federal Credit Union",
    url: "https://schoolsfirstfcu.org/link/72f13edcd9ba49028204e419029dc373.aspx",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
  },
  {
    // Courtesy Pay disclosure (SD-84): the C-14 fee schedule timed out twice (2026-10-08 07:14).
    institutionId: 7313,
    institutionName: "The Golden 1 Federal Credit Union",
    url: "https://www.golden1.com/-/media/golden1/site-documents/misc-pdfs/sd-84.pdf",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-08 13:45",
  },
  {
    // fee schedule, updated January 2026.
    institutionId: 8322,
    institutionName: "Alliant Federal Credit Union",
    url: "https://secure.alliantcreditunion.org/images/uploads/files/FeeSchedule.pdf",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
  },
  {
    // fee schedule, December 2023.
    institutionId: 8583,
    institutionName: "Suncoast Federal Credit Union",
    url: "https://edge.sitecorecloud.io/suncoastcre57dd-suncoast-suncoastprod-d848/media/Project/suncoast/Imported/Files/Fees/FeeSchedule-pdf.pdf",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
  },
  {
    // The bank's own overdraft services page ($38 per item). Its main link is a business
    // checking page.
    institutionId: 251,
    institutionName: "Wilson Bank and Trust",
    url: "https://www.wilsonbank.com/personal/overdraft-services",
    givenBy: "web search for the Tennessee report's largest banks, 2026-10-07 07:00",
  },
  {
    // "Outline of Services 2025, Personal Checking Accounts" (31 pages), the bank's own file on
    // its site host's storage. ACNB holds 61% of Adams County deposits and had no link on file.
    institutionId: 393,
    institutionName: "ACNB Bank",
    url: "https://trabian-canvas-prd-files.s3.amazonaws.com/acnb-com/files/document/7_list_of_services.pdf",
    givenBy: "web search for the Adams County market study, 2026-10-07 07:10",
  },
  {
    // Consumer banking welcome kit dated 6/2026, with the account fees. The overdraft coverage
    // disclosure PDF now serves a "page doesn't exist" page (doc 20860, 2026-10-07 07:53).
    institutionId: 19,
    institutionName: "Fifth Third Bank, National Association",
    url: "https://www.53.com/content/dam/fifth-third/docs/reference/fifth-third-consumer-banking-welcome-kit-accessible.pdf",
    givenBy: "web search for the Tennessee report's deposit leaders, 2026-10-07 08:05",
  },
  {
    // The Tennessee bank's own consumer overdraft page: Bounce Protection $33 per item, at most
    // 4 a day; NSF charge dropped 2023-02-01. Replaces a Bangladesh bank's schedule Magellan found.
    institutionId: 371,
    institutionName: "SouthEast Bank",
    url: "https://www.southeastbank.com/consumer-overdraft-services/",
    givenBy: "web search for the Tennessee report's deposit leaders, 2026-10-07 07:35",
  },
  {
    // Overdraft consent form: up to $35 per item, $210 a day cap. Its main link is the account
    // terms PDF.
    institutionId: 255,
    institutionName: "SmartBank",
    url: "https://smartbank.com/wp-content/uploads/OverdraftConsentform.pdf",
    givenBy: "web search for the Tennessee report's deposit leaders, 2026-10-07 07:35",
  },
  // Top 10 by in-state deposits with no live fees (coverage/gaps-2026-10-08.md). Links from
  // search results only: bank sites refuse this network, so Rosetta's read is the check.
  ...([
    // No fee schedule link on file.
    [43, "SouthState Bank, National Association", "https://www.southstatebank.com/PersonalAccountFeeSchedule"],
    [85, "Eastern Bank", "https://www.easternbank.com/media/5301"],
    // Personal checking page with its fee table: the checking TISA PDFs return HTTP 404 (Mac
    // session browser, 2026-10-09 06:46; replaced the TISA PDF link).
    [147, "BancFirst", "https://www.bancfirst.bank/personal/banking/personal-checking-accounts"],
    [206, "Bankers Trust Company", "https://www.bankerstrust.com/consumer-service-fee-schedule/"],
    [400, "MVB Bank, Inc", "https://mvbbanking.com/wp-content/uploads/2024/03/4.-MVB-Retail-Fee-Schedule-3.31.22-reviewed-2024.pdf"],
    [4966, "Bank Fund Staff Federal Credit Union", "https://bfsfcu.org/documents/Fee_Schedule.pdf"],
    // Link on file was a product, rates or loan page.
    // 2026 public-file Schedule of Fees: overdraft $35, 4 a day; the bl.valley.com links are dead
    // (Mac session browser, 2026-10-09 06:46).
    [44, "Valley National Bank", "https://www.valley.com/content/dam/valley/pdfs/cra/public-file/public-file-2026/AAYA,%20Schedule%20of%20Fees,%20Privacy%20Policy.pdf"],
    // Courtesy Pay page: $35 per item (the fee schedule page never read; 2026-10-08 16:05).
    [96, "Beacon Bank and Trust", "https://www.beaconbank.com/personal/courtesy-pay"],
    [300, "Hills Bank and Trust Company", "https://www.hillsbank.com/sites/www.hillsbank.com/files/media/terms-and-conditions-fee-schedule.pdf"],
    [7656, "Dupaco Community Federal Credit Union", "https://www.dupaco.com/hubfs/dupaco-credit-union-fee-schedule-miscellaneous-fees-jan-15-2025.pdf?hsLang=en"],
    [8086, "Summit Federal Credit Union", "https://www.summitcreditunion.com/_docs/Consumer%20Fee%20Schedule_3-1-2025.pdf"],
  ] as const).map(([institutionId, institutionName, url]) => ({
    institutionId,
    institutionName,
    url,
    givenBy: "web search for each state's top 10 by deposits, 2026-10-08 02:45",
  })),
  // $10B+ banks with no live overdraft fee and no readable page on file (bot walls, pages
  // built by JavaScript). Links from search results only, so Rosetta's read is the check.
  ...([
    [6671, "Digital Federal Credit Union", "https://www.dcu.org/content/dam/dcu/pdfs/overdraft-payment-service-disclosure.pdf"],
    // Full schedules found by the Mac session browser (2026-10-09 06:46) replaced the overdraft
    // pages: Mountain America's Truth in Savings (overdraft $25, effective Oct 1, 2026) and
    // VyStar's Fee Schedule (Courtesy Pay $29).
    [6881, "Mountain America Federal Credit Union", "https://www.macu.com/media/pdf/truth-in-savings.pdf"],
    [8507, "Vystar Federal Credit Union", "https://assets.ctfassets.net/kw2oi7dtt7lh/15GlunYoDyqOCbdajKbm8L/ead2cd63d36e69dc275729c8722cba40/Fee_Schedule.pdf"],
    [46, "Banco Popular de Puerto Rico", "https://www.popular.com/assets/pdf/caracteristicas-e-account-en.pdf"],
    [102, "TowneBank", "https://www.townebank.com/member-support/overdraft-protection/"],
    // Search snippets show a per-item overdraft fee on each (2026-10-08 15:00).
    [123, "NBT Bank, National Association", "https://www.nbtbank.com/assets/pdfs/PricingScheduleforProductsandServices.pdf"],
    // Old National publishes no stand-alone personal fee schedule (its deposit agreement points
    // to one per account). Its overdraft page (held since 8 Oct: $36 paid item) gives two fees,
    // under the 3-fee bar; the Everyday Checking page lists the monthly, paper statement and
    // early-closure fees (replaced the overdraft page link, 2026-10-09 03:50).
    [41, "Old National Bank", "https://www.oldnational.com/personal/checking/onb-everyday-checking/"],
    [165, "Origin Bank", "https://www.origin.bank/deposit-account-agreement-disclosures.pdf"],
    [7559, "Idaho Central Federal Credit Union", "https://www.iccu.com/file/notices/account-agreement.pdf"],
    // Overdrafts and overdraft fees: $33 each time (replaced the 2023 flyer at 16:05).
    [133, "Bell Bank", "https://edge.sitecorecloud.io/bellbank1e14e-bellbankab0c-prod3ddb-d33b/media/project/bellbank/bellbankcorporate/terms-and-conditions/online-banking-legal-notices/overdrafts-and-overdraft-fees.pdf"],
    [107, "Apple Bank", "https://www.applebank.com/AppleBank/media/Documents/PDFs/B-294-ClassValue-Checking.pdf"],
    // Search snippets show a consumer per-item overdraft fee on each (2026-10-08 16:05).
    [45, "CIBC Bank USA", "https://us.cibc.com/content/dam/us-public-assets/documents/pdf/cibc-bank-usa-smart-account-agreements-and-disclosures.pdf"],
    [106, "The Central Trust Bank", "https://www.centralbank.net/globalassets/includedcontent/enterprise/uyda-personal.pdf?v=1DC23F7AD8F0D80"],
    [115, "Seacoast National Bank", "https://www.seacoastbank.com/overdraft-info"],
    [39, "Comerica Bank", "https://www.comerica.com/content/dam/comerica/en/documents/resources/about/cra/SEMI-PSC.pdf"],
    [48, "Cadence Bank", "https://cadencebank.com/personal/checking/my-way"],
    [83, "FirstBank", "https://www.efirstbank.com/customer-service/questions-answers.htm"],
    [98, "Centennial Bank", "https://www.my100bank.com/public/userfiles/Disclosures/CEN-SOF.pdf"],
    // Account common features: overdraft and NSF $36, effective Apr 2025 (Mac session browser,
    // 2026-10-09 06:46; replaced the overdraft privilege page).
    [170, "Stock Yards Bank & Trust Company", "https://www.syb.com/_s3/syb-com/files/document/2014_accountcommonfeatures.pdf?VersionId=FQg8ut0D4z1SQBsXZ.Yj5coelIGU5Y4x"],
    [7464, "Boeing Employees Federal Credit Union", "https://www.becu.org/-/media/Files/PDF/P-6850.pdf?rev=b84f4b81f7564db9ab1706a2a0de02a2&sc_lang=en&hash=FB0646071579AEFCC1F0BC48F4DF21E3"],
    [6394, "First Technology Federal Credit Union", "https://www.firsttechfed.com/-/media/FirstTech-Web/Documents/Terms-And-Conditions-Pdf/account-and-service-fees.pdf"],
    [38, "East West Bank", "https://www.eastwestbank.com/content/dam/ewb-dotcom/docs/CONSUMER_FEE_SCHEDULE.pdf"],
    // Miscellaneous Bank Fees PDF (05/16/26); its $40 overdraft line is business-only (Mac
    // session browser, 2026-10-09 06:46; replaced the fee schedule page).
    [135, "ConnectOne Bank", "https://cdn.prod.website-files.com/6645c05fc60bab424a196a46/6765feca5085628577e3ca17_3f3f62ff932e3a48ca59d577b756ca3e_Miscellaneous-Bank-Fees-051626.pdf"],
  ] as const).map(([institutionId, institutionName, url]) => ({
    institutionId,
    institutionName,
    url,
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-08 13:45",
  })),
  // Top-10-by-deposits banks under $10B with no live overdraft fee: each link is on the
  // bank's own site and a search snippet showed a consumer fee schedule or overdraft
  // disclosure (2026-10-08 15:45-15:50).
  ...([
    [180, "American Savings Bank, National Association", "https://www.asbhawaii.com/sites/default/files/documents/ASB-What-You-Need-Overdrafts-and-Overdraft-Fees.pdf"],
    [184, "Pinnacle Bank", "https://www.pinnbank.com/sites/default/files/document/file/KMN%20Overdraft%20Services.pdf"],
    [198, "b1BANK", "https://www.b1bank.com/_s3/b1bank-com/files/document/252169%20b1Bank%20M&A-b1BANK-MA-D3-Consumer-Conversion-Guide%20FINAL.pdf?VersionId=BNTMRHeDT9jVbMjPB_he64yI3Pj8M3lq"],
    [199, "BankPlus", "https://www.bankplus.net/docs/default-source/opt-in/optindisclosure_single.pdf?sfvrsn=ad0678f2_2"],
    [208, "Bank of Colorado", "https://www.bankofcolorado.com/sites/default/files/document/file/OD%20Services%2005.23%20-%20CO.pdf"],
    [216, "Bangor Savings Bank", "https://www.bangor.com/getmedia/f5339c41-5c2d-49f0-9381-cd4f8c38f456/Common-Fee-Schedule.pdf"],
    [223, "The Camden National Bank", "https://www.camdennational.bank/getContentAsset/1aee490b-c80e-41d9-82b1-3037542a77aa/3d1daacc-ebfd-47b4-a59b-db3c9d47fbc8/Disclosure-Packet.pdf?language=en"],
    [233, "City National Bank of West Virginia", "https://www.bankatcity.com/personal-banking/avoiding-overdrafts/how-city-helps-overdrafts/"],
    [238, "Equity Bank", "https://equitybank.com/app/uploads/2025/07/Your-Deposit-Accounts_EquityBank_072025.pdf"],
    [256, "Choice Financial Group", "https://bankwithchoice.com/wp-content/uploads/2025.04_CashManagementFeeSchedule_Bank_Consumer_FINAL_kt.pdf"],
    [291, "Community Bank of Mississippi", "https://communitybank.net/service-fees/"],
    [328, "Northeast Bank", "https://www.northeastbank.com/sites/default/files/2025-12/Overdraft%20Disclosures%2011-17-25_1.pdf"],
    [358, "Security Bank of Kansas City", "https://www.securitybankkc.com/overdraft-privilege"],
    [396, "Red River Bank", "https://www.redriverbank.net/downloads/overdraftprotectiondisclosure.pdf"],
    [401, "First Community Bank", "https://www.firstcommunitybank.com/overdraft-enrollment"],
    [403, "First National Bank", "https://thefirst.com/assets/files/BWRVwFzR"],
    [422, "BankNewport", "https://www.banknewport.com/?p=2419"],
    [465, "Bank of New Hampshire", "https://bnh.bank/customer-support/account-services/"],
    [643, "First American Bank", "https://www.firstamericanbanknm.com/personal-home-loans/personal-checking/overdraft-services/"],
    [663, "Cornerstone Bank", "https://www.cornerstone.bank/wp-content/uploads/2024/04/Fees.pdf"],
    [850, "Pinnacle Bank - Wyoming", "https://www.wypinnbank.com/sites/default/files/document/file/OD%20Services%2005.23%20-%20WY.pdf"],
    [4575, "Hawaii State Federal Credit Union", "https://hawaiistatefcu.com/wp-content/uploads/2025/04/Account-Opening-Combined-Disclosures-20250701-Consumer.pdf"],
    [4595, "Aloha Pacific Federal Credit Union", "https://alohapacific.com/media/sswji4jp/overdraft-privilege-odp-member-disclosure-with-a-9_apfcu_20240913.pdf"],
    [6718, "Founders Federal Credit Union", "https://www.foundersfcu.com/founders-privilege-disclosures"],
    [7032, "Virginia Federal Credit Union", "https://www.vacu.org/sites/default/files/2025-12/Combineddisclosure%201.1.26.pdf"],
    [7628, "St. Mary'S Bank Federal Credit Union", "https://www.stmarysbank.com/docs/default-source/default-document-library/consumer-fee-schedule.pdf?sfvrsn=5049be1e_1"],
    [8591, "Rogue Federal Credit Union", "https://www.roguecu.org/media/yjyb1q41/member_disclosure.pdf?cb=638749476298730000"],
    [8638, "Desert Financial Federal Credit Union", "https://www.desertfinancial.com/globalassets/files/legal/card-overdraft-form.pdf?ver=10282025V2"],
    [8645, "Trustone Financial Federal Credit Union", "https://trustonefinancial.org/For-You/Spend/Checking/Overdraft"],
  ] as const).map(([institutionId, institutionName, url]) => ({
    institutionId,
    institutionName,
    url,
    givenBy: "web search for state top-10 banks under $10B with no live overdraft fee, 2026-10-08 15:50",
  })),
  // Second search pass for the same banks. Each link is on the bank's own stored domain or its
  // own file host; links on a domain that may be a different bank (Bankwell Direct, 1stnorthern)
  // were left out (2026-10-08 16:05).
  ...([
    [404, "First Dakota National Bank", "https://com-firstdakota-cdn.s3.amazonaws.com/general-uploads/Customer-Overdraft-Disclosure.pdf"],
    [453, "Cornerstone Bank", "https://www.cornerstoneconnect.com/gallery/Services%20and%20Costs.pdf"],
    [8397, "Greater Nevada Federal Credit Union", "https://www.gncu.org/wp-content/uploads/2025/05/20250519-GNCU-Personal-Accounts-Fee-Schedule-FINAL.pdf"],
  ] as const).map(([institutionId, institutionName, url]) => ({
    institutionId,
    institutionName,
    url,
    givenBy: "second web search for state top-10 banks with no live overdraft fee, 2026-10-08 16:05",
  })),
  {
    // Marketing's outreach batch (2026-10-08 18:20): Magellan holds only Quantum's business
    // schedule. Its personal Service Fee Schedule lists Courtesy Pay at $30 (web search 18:45).
    institutionId: 8085,
    institutionName: "Quantum Federal Credit Union",
    url: "https://www.theq.org/service-fee-schedule",
    givenBy: "web search for Marketing's outreach batch, 2026-10-08 18:45",
  },
  // State top-10 banks whose sites refuse our fetcher (HTTP 403). The Mac session's browser,
  // signed out, found no fee schedule PDF; the fees are on the product pages, with no overdraft
  // amount published (2026-10-09 00:57). The paid companion fetch reads the blocked pages.
  ...([
    [276, "Bridgewater Bank", "https://www.bridgewaterbankmn.com/personal-banking/personal-deposits/interest-checking"],
    [295, "Dacotah Bank", "https://www.dacotahbank.com/personal-checking-and-debit"],
  ] as const).map(([institutionId, institutionName, url]) => ({
    institutionId,
    institutionName,
    url,
    givenBy: "Mac session browser check of blocked top-10 banks, 2026-10-09 00:57",
  })),
  // $10B+ banks with no full fee schedule on file: the Mac session's browser, signed out, found
  // each bank's own schedule (2026-10-09 06:46). Rosetta's read is the check.
  ...([
    // Personal banking fee schedule: NSF/overdraft $35, $175 a day.
    [34, "Western Alliance Bank", "https://www.westernalliancebancorporation.com/sites/default/files/2026-05/personal-banking-fee-schedule.pdf"],
    // Personal fee disclosure, effective Sept 2026: overdraft $18.50.
    [76, "City National Bank of Florida", "https://cdn.prod.website-files.com/6531596c316e0e8e3be7c634/6a9aad21a0fdb5f38af42d3c_CNB%20Personal_Fee_Disclosure%209426%20Final.pdf"],
    // Personal welcome guide (67 pages): NSF/uncollected funds $35, $175 a day.
    [124, "Citizens Business Bank, National Association", "https://www.cbbank.com/wp-content/uploads/HBC-Personal-Welcome-Guide_website.pdf"],
    // Cuenta Libre terms: NSF $15, daily overdraft $5.
    [144, "Oriental Bank", "https://orientalbank.com/assets/Pdfs/BankAccounts/terms_and_conditions_CUENTA_LIBRE.pdf"],
    // Fee schedule, rev 3/2025.
    [4885, "Fourleaf Federal Credit Union", "https://docs.fourleaffcu.com/disclosures/olb/MK-289-fee-schedule-12-2013.pdf"],
  ] as const).map(([institutionId, institutionName, url]) => ({
    institutionId,
    institutionName,
    url,
    givenBy: "Mac session browser check of $10B+ banks with no live overdraft fee, 2026-10-09 06:46",
  })),
  {
    // Market-gap list (2026-10-09): Magellan's paid search proposed this PDF four times on
    // 7 Oct ("personal deposit account fees including overdraft ($25.00)") but timed out
    // opening it; the link on file is a page-not-found page.
    institutionId: 25,
    institutionName: "The Northern Trust Company",
    url: "https://www.northerntrust.com/content/dam/northerntrust/pws/nt/documents/wealth-management/banking/disclosures/deposit-account-descriptions-and-fees.pdf",
    givenBy: "Magellan's paid schedule search (proposed 4 times, 2026-10-07), for the market-gap list 2026-10-09",
  },
];

export interface NoConsumerSchedule {
  institutionId: number;
  institutionName: string;
  reason: string;
}

/**
 * Large-deposit banks with no consumer deposit fee schedule to find: their deposits are
 * wholesale, custody or fee-free online savings. Discovery does not put them first as market
 * gaps, and the gap ranking leaves them out (2026-10-09). A bank leaves this list when it
 * publishes a consumer schedule.
 */
export const NO_CONSUMER_SCHEDULE: readonly NoConsumerSchedule[] = [
  {
    institutionId: 7,
    institutionName: "Goldman Sachs Bank USA",
    reason: "Marcus online savings and CDs charge no account fees; web search found no consumer fee schedule (paid web search)",
  },
  {
    institutionId: 10,
    institutionName: "The Bank of New York Mellon",
    reason: "Custody and wholesale bank; the only schedule is Pershing's broker-client bank sweep charges; web search found no consumer fee schedule",
  },
  {
    institutionId: 817,
    institutionName: "The Bank of New York Mellon Trust Company, National Association",
    reason: "Trust company; same Pershing sweep schedule as BNY; web search found no consumer fee schedule",
  },
];

export const NO_CONSUMER_SCHEDULE_IDS: ReadonlySet<number> = new Set(NO_CONSUMER_SCHEDULE.map((bank) => bank.institutionId));

/** A stored copy of the schedule counts as held only when it is this recent. */
export const HELD_DOCUMENT_DAYS = 30;

const sameName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export interface OperatorScheduleResult {
  added: Array<{ institutionId: number; url: string }>;
}

/**
 * Adds each listed schedule the bank does not hold yet (as its link, a document stored in the last HELD_DOCUMENT_DAYS days or a
 * companion). A schedule already held, or one a reviewer rejected, is left alone.
 */
export async function addOperatorSchedules(options: {
  db?: SqlTag;
  runId: number;
  stepId?: number | null;
  schedules?: readonly OperatorSchedule[];
}): Promise<OperatorScheduleResult> {
  const db = options.db ?? sql;
  const schedules = options.schedules ?? OPERATOR_SCHEDULES;
  const result: OperatorScheduleResult = { added: [] };
  if (schedules.length === 0) return result;

  const ids = [...new Set(schedules.map((schedule) => schedule.institutionId))];
  const held = await db`
    SELECT inst.id AS institution_id, inst.fee_schedule_url AS url, inst.institution_name FROM institution_sources inst WHERE inst.id = ANY(${ids}::bigint[])
    UNION ALL
    SELECT doc.institution_id, doc.document_url, NULL FROM source_documents doc
     WHERE doc.institution_id = ANY(${ids}::bigint[])
       -- A copy stored months ago under no current link is not held: ConnectOne's fee page
       -- was last stored in March 2026, so its listed schedule was never added again.
       AND doc.crawled_at > NOW() - make_interval(days => ${HELD_DOCUMENT_DAYS})
    UNION ALL
    SELECT ias.institution_id, ias.url, NULL FROM institution_additional_sources ias WHERE ias.institution_id = ANY(${ids}::bigint[])
  `;
  const names = new Map(
    held.filter((row) => row.institution_name).map((row) => [Number(row.institution_id), sameName(String(row.institution_name))]),
  );
  const known = new Set(held.filter((row) => row.url).map((row) => `${Number(row.institution_id)}:${urlIdentity(String(row.url))}`));

  for (const schedule of schedules) {
    if (names.get(schedule.institutionId) !== sameName(schedule.institutionName)) continue;
    if (known.has(`${schedule.institutionId}:${urlIdentity(schedule.url)}`)) continue;
    if (!(await insertHandFoundSchedule(db, schedule, { runId: options.runId, stepId: options.stepId ?? null }))) continue;
    known.add(`${schedule.institutionId}:${urlIdentity(schedule.url)}`);
    result.added.push({ institutionId: schedule.institutionId, url: schedule.url });
  }
  return result;
}

/** Stores one hand-found schedule as a consumer companion, with its discover attempt. */
async function insertHandFoundSchedule(
  db: SqlTag,
  schedule: Pick<OperatorSchedule, "institutionId" | "url" | "givenBy">,
  run: { runId: number | null; stepId: number | null },
): Promise<boolean> {
  // A person can be fooled by a same-name bank too: First United of Durant, Oklahoma was given
  // First United of Oakland, Maryland's mybank.com disclosures (2026-10-09). A page on another
  // institution's own website is that bank's schedule, as in discovery.
  if (await otherInstitutionAtHost(db, schedule.institutionId, schedule.url)) return false;
  const reason = `Consumer fee schedule given by ${schedule.givenBy}`;
  const inserted = await db`
    INSERT INTO institution_additional_sources
      (institution_id, url, document_type, document_role, found_by_strategy, strategy_version, agent_run_id, reason)
    VALUES
      (${schedule.institutionId}, ${schedule.url}, ${looksLikePdfUrl(schedule.url) ? "pdf" : "html"}, 'consumer_supplement',
       ${OPERATOR_SCHEDULE_STRATEGY.strategy}, ${OPERATOR_SCHEDULE_STRATEGY.version}, ${run.runId}, ${reason})
    ON CONFLICT (institution_id, url) DO NOTHING
    RETURNING id
  `;
  if (inserted.length === 0) return false;
  await recordAttempt(db, {
    institutionId: schedule.institutionId,
    stage: "discover",
    strategy: OPERATOR_SCHEDULE_STRATEGY.strategy,
    version: OPERATOR_SCHEDULE_STRATEGY.version,
    fingerprint: urlIdentity(schedule.url),
    outcome: "ok",
    yieldCount: 1,
    costMicrousd: 0,
    durationMs: 0,
    runId: run.runId,
    stepId: run.stepId,
    detail: { url: schedule.url, given_by: schedule.givenBy, reason },
  });
  return true;
}

export type HandFoundLinkResult =
  | { ok: true; institutionName: string }
  | { ok: false; error: string };

/**
 * A schedule link a person pasted on the hit list. It is stored like an OPERATOR_SCHEDULES
 * entry, so Atlas's priority path (`priority-institutions.ts`, tier hand_found) fetches,
 * reads, verifies and publishes that one institution on its next tick.
 */
export async function addHandFoundLink(options: {
  db?: SqlTag;
  institutionId: number;
  url: string;
  givenBy: string;
}): Promise<HandFoundLinkResult> {
  const db = options.db ?? sql;
  if (!Number.isInteger(options.institutionId) || options.institutionId < 1) return { ok: false, error: "Invalid institution" };
  let url: string;
  try {
    const parsed = new URL(options.url.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, error: "Link must start with https://" };
    url = parsed.toString();
  } catch {
    return { ok: false, error: "That is not a link" };
  }
  const [institution] = await db`
    SELECT institution_name FROM institution_sources WHERE id = ${options.institutionId}
  `;
  if (!institution) return { ok: false, error: "Institution not found" };
  const institutionName = String(institution.institution_name);
  const other = await otherInstitutionAtHost(db, options.institutionId, url);
  if (other) return { ok: false, error: `That link is on the website of ${other.institutionName}${other.stateCode ? ` (${other.stateCode})` : ""}, another institution` };
  const added = await insertHandFoundSchedule(
    db,
    { institutionId: options.institutionId, url, givenBy: options.givenBy },
    { runId: null, stepId: null },
  );
  if (!added) return { ok: false, error: "That link is already on file for this institution" };
  return { ok: true, institutionName };
}
