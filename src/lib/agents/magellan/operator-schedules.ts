import { sql } from "@/lib/data-store/connection";
import { recordAttempt } from "@/lib/agents/learning/attempts";

import { looksLikePdfUrl } from "./find-validate";
import { urlIdentity } from "./finders";

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
    url: "https://www.regions.com/virtualDocuments/Checking-Pricing-Schedule.pdf",
    givenBy: "web search for James's largest-bank list, 2026-10-07 01:05",
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
    url: "https://www.1firstbank.com/pr/en/documents/accounts/Disclosures-of-Rates-Terms-and-Fees-Deposit-UNO-Account-Eng.pdf",
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
    // consumer schedule of fees, effective 2025-09-15.
    institutionId: 35,
    institutionName: "Zions Bancorporation, N.A.",
    url: "https://www.amegybank.com/content/dam/zbna/disclosures/localized/zfnb/rate-sheets/scheduleoffeesconsut.pdf",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
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
    // personal schedule of fees page.
    institutionId: 118,
    institutionName: "First United Bank and Trust Company",
    url: "https://first.bank/About/Disclosures/Personal-Schedule-of-Fees",
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
    // personal deposit product fee schedule.
    institutionId: 186,
    institutionName: "Sunflower Bank, National Association",
    url: "https://sunflowerbank.com/getmedia/e45c00b0-ab7b-4e5c-9b5e-5e7053989b75/Deposit-Product-Fee-Schedule-Personal.pdf",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
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
    url: "https://www.pffcu.org/membership/fee-schedule",
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
    // consumer services fee schedule (C-14), 2025-07-05.
    institutionId: 7313,
    institutionName: "The Golden 1 Federal Credit Union",
    url: "https://www.golden1.com/-/media/Golden1/Site%20Documents/Disclosures/C-14",
    givenBy: "web search for the $10B+ banks with no live overdraft fee, 2026-10-07 06:10",
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
    // Checking Truth in Savings disclosure: overdraft $25 (four a day), stop payment $27.
    [147, "BancFirst", "https://www.bancfirst.bank/BancFirst/media/Documents/NewDisclosureDocs/BancFirst-Checking-TISA.pdf"],
    [206, "Bankers Trust Company", "https://www.bankerstrust.com/consumer-service-fee-schedule/"],
    [400, "MVB Bank, Inc", "https://mvbbanking.com/wp-content/uploads/2024/03/4.-MVB-Retail-Fee-Schedule-3.31.22-reviewed-2024.pdf"],
    [4966, "Bank Fund Staff Federal Credit Union", "https://bfsfcu.org/documents/Fee_Schedule.pdf"],
    // Link on file was a product, rates or loan page.
    [44, "Valley National Bank", "https://www.valley.com/content/dam/valley/pdfs/cra/public-file/NEW_AAYA-Schedule%20of%20Fees-Privacy%20Policy-ADA.pdf"],
    [96, "Beacon Bank and Trust", "https://www.beaconbank.com/disclosures/consumer-fee-schedule"],
    [300, "Hills Bank and Trust Company", "https://www.hillsbank.com/sites/www.hillsbank.com/files/media/terms-and-conditions-fee-schedule.pdf"],
    [7032, "Virginia Federal Credit Union", "https://www.vacu.org/portals/0/pdfs/feedisclosure.pdf"],
    [7656, "Dupaco Community Federal Credit Union", "https://www.dupaco.com/hubfs/dupaco-credit-union-fee-schedule-miscellaneous-fees-jan-15-2025.pdf?hsLang=en"],
    [8086, "Summit Federal Credit Union", "https://www.summitcreditunion.com/_docs/Consumer%20Fee%20Schedule_3-1-2025.pdf"],
  ] as const).map(([institutionId, institutionName, url]) => ({
    institutionId,
    institutionName,
    url,
    givenBy: "web search for each state's top 10 by deposits, 2026-10-08 02:45",
  })),
];

const sameName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export interface OperatorScheduleResult {
  added: Array<{ institutionId: number; url: string }>;
}

/**
 * Adds each listed schedule the bank does not hold yet (as its link, a stored document or a
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
    SELECT doc.institution_id, doc.document_url, NULL FROM source_documents doc WHERE doc.institution_id = ANY(${ids}::bigint[])
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
    const reason = `Consumer fee schedule given by ${schedule.givenBy}`;
    const inserted = await db`
      INSERT INTO institution_additional_sources
        (institution_id, url, document_type, document_role, found_by_strategy, strategy_version, agent_run_id, reason)
      VALUES
        (${schedule.institutionId}, ${schedule.url}, ${looksLikePdfUrl(schedule.url) ? "pdf" : "html"}, 'consumer_supplement',
         ${OPERATOR_SCHEDULE_STRATEGY.strategy}, ${OPERATOR_SCHEDULE_STRATEGY.version}, ${options.runId}, ${reason})
      ON CONFLICT (institution_id, url) DO NOTHING
      RETURNING id
    `;
    if (inserted.length === 0) continue;
    known.add(`${schedule.institutionId}:${urlIdentity(schedule.url)}`);
    result.added.push({ institutionId: schedule.institutionId, url: schedule.url });
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
      runId: options.runId,
      stepId: options.stepId ?? null,
      detail: { url: schedule.url, given_by: schedule.givenBy, reason },
    });
  }
  return result;
}
