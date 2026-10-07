// Generated from the state fee law research of 2026-10-07 (see state-fee-laws.ts).
// Draft legal content: not reviewed. Edit by hand only with a citation you have read.
import type { StateFeeLaw, StateFeeLawCoverage } from "./state-fee-laws";

export const STATE_FEE_LAWS_DATA: StateFeeLaw[] = [
  {
    "id": "ak_liquid_assets_exemption",
    "state_code": "AK",
    "topic": "garnishment_legal_process",
    "name": "Liquid assets (including deposits) exemption for debtors without regular earnings",
    "citation": "AS 09.38.030 (Alaska Exemptions Act); Alaska Court System forms CIV-511, CIV-530",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "A debtor not paid weekly, twice monthly or monthly may claim a $1,890 exemption for cash and liquid assets, including bank deposits, each month.",
    "detail": "A debtor who is not paid weekly, twice a month or monthly may claim an exemption of $1,890 for the total cash and other liquid assets, including bank deposits, available in any month. The debtor must file a claim of exemption; the statute is a debtor exemption and does not address bank fees.",
    "evidence": "public.courts.alaska.gov court forms: 'If you do not get paid either weekly, semi-monthly (twice a month), or monthly, you can ask for a maximum exemption of $1,890 for the total value of cash and other liquid assets available'; '\"Liquid assets\" includes deposits, securities, notes, drafts, accrued vacation pay, refunds, prepayments, and receivables'. Older akleg.gov text showed $1,400, so the amount is periodically changed; the form date for the $1,890 figure was not confirmed.",
    "url": "https://public.courts.alaska.gov/web/forms/docs/civ-511.pdf",
    "figures": {
      "liquid_assets_exemption_usd": 1890
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "al_dormancy_charge_conditions",
    "state_code": "AL",
    "topic": "dormancy",
    "name": "Conditions on dormancy charges deducted from abandoned property",
    "citation": "Ala. Code § 35-12-75 (Uniform Disposition of Unclaimed Property Act of 2004)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct a dormancy charge from abandoned property only under a written contract it regularly enforces, and the deduction may not be unconscionable.",
    "detail": "A holder may deduct a charge for the owner's failure to claim property within a set time from property presumed abandoned only if a valid, enforceable written contract lets it impose the charge and it regularly does so, and the deduction may not be unconscionable. Deposit accounts are presumed abandoned three years after maturity or the owner's last indication of interest.",
    "evidence": "Treasurer's copy of Article 2A: 'A holder may deduct from property presumed abandoned a charge imposed by reason of the apparent owner's failure to claim the property within a specified time only if there is a valid and enforceable written contract ... and the holder regularly imposes the charge. The amount of the deduction is limited to an amount that is not unconscionable.'",
    "url": "https://treasury.alabama.gov/wp-content/uploads/2024/07/UCP.pdf",
    "figures": {
      "deposit_dormancy_years": 3
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "al_rsu_transaction_fee_notice",
    "state_code": "AL",
    "topic": "atm",
    "name": "Notice of remote service unit (ATM) transaction fees",
    "citation": "Ala. Code § 5-5A-30; Alabama State Banking Dept. Regulation No. 16",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [
      "atm_non_network"
    ],
    "summary": "Users of a state bank's remote service unit must be told of any transaction fee, and depositors need written notice of extra electronic transfer charges.",
    "detail": "Third-party users of a remote service unit must be told, in the manner § 5-5A-30 sets, of any transaction fee the unit's owner or operator imposes, and depositors must be notified in writing of any extra charges for using electronic fund transfer services.",
    "evidence": "Reg. 16: 'Third party users of remote service units shall be informed, in the manner set forth in §5-5A-30 of the Alabama Banking Code, of any transaction fee imposed by the owner or operator'; depositor 'must be notified in writing of any additional charges'. Statute text itself not seen.",
    "url": "https://banking.alabama.gov/wp-content/uploads/2023/06/Reg_16.pdf",
    "verification": "official_excerpt",
    "source_kind": "regulation"
  },
  {
    "id": "ar_unclaimed_property_service_charge_conditions",
    "state_code": "AR",
    "topic": "dormancy",
    "name": "Conditions for deducting service charges from unclaimed deposits",
    "citation": "Ark. Code Ann. § 18-28-202 and related sections of the Unclaimed Property Act, as applied in the Auditor of State's holder reporting booklet",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct service charges from unclaimed property only under a written contract, regularly imposed and not reversed, and only until presumed abandonment.",
    "detail": "Per the Auditor of State's holder guidance, a holder may deduct service charges from reported property only if an enforceable written contract with the owner allows the charge, the holder regularly imposes it and does not regularly reverse it, and a copy of the contract is attached to the report; service fees are allowed only until the property is presumed abandoned (generally after three years without activity).",
    "evidence": "Auditor booklet: service charges allowed where 'an enforceable written contract exists between the holder and the owner, providing that the holder may impose a charge or stop payment of interest; and the holder regularly imposes such charges ... and does not regularly reverse or otherwise cancel the charges; and a copy of the contract authorizing service charges is included or attached as part of the report. Service fees are only allowed until the property is abandoned in accordance with A.C.A. 18-28-202.' Most property presumed abandoned after three years of no activity.",
    "url": "https://auditor.ar.gov/wp-content/uploads/UCP_Reporting_Booklet_Revised_JULY_2026.pdf",
    "figures": {
      "general_dormancy_period_years": 3
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "az_dormancy_charge_conditions",
    "state_code": "AZ",
    "topic": "dormancy",
    "name": "Conditions on dormancy charges deducted from abandoned property",
    "citation": "A.R.S. § 44-305",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct a dormancy charge only under a written contract, if regularly imposed and not reversed, and only if not unconscionable.",
    "detail": "A holder may deduct a charge for the owner's failure to claim property within a set time from property presumed abandoned only if a valid, enforceable written contract lets it impose the charge, it regularly imposes the charge and does not regularly reverse or cancel it, and the amount is not unconscionable.",
    "evidence": "Search excerpt of § 44-305 'Dormancy charge': 'may deduct ... a charge imposed by reason of the owner's failure to claim the property within a specified time if there is a valid and enforceable written contract ... the holder regularly imposes the charge and the charge is not regularly reversed or otherwise canceled ... limited to an amount that is not unconscionable.'",
    "url": "https://azleg.gov/ars/44/00305.htm",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "az_wage_deposit_free_withdrawal",
    "state_code": "AZ",
    "topic": "other",
    "name": "Free withdrawal under employer wage deposit plans",
    "citation": "A.R.S. § 23-351",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "other",
    "coverage_note": "A.R.S. § 23-351 (azleg.gov) puts the free-withdrawal duty on 'any wage deposit plan adopted by an employer', so it binds employers, not banks directly; it defines 'financial institution' as a member of the FDIC or a comparable federal or state agency.",
    "applies_to": [],
    "summary": "An employer wage deposit plan must give the employee 1 withdrawal per deposit free of any service charge.",
    "detail": "An employer wage deposit plan must give the employee one withdrawal per deposit free of any service charge to the employee. The duty is framed on the employer's plan, not directly on the bank.",
    "evidence": "Search excerpt: 'Any wage deposit plan adopted by an employer shall entitle the employee to one withdrawal for each deposit, free of any service charge to the employee.' Full section not read.",
    "url": "https://www.azleg.gov/viewdocument/?docName=http://www.azleg.gov/ars/23/00351.htm",
    "figures": {
      "free_withdrawals_per_deposit": 1
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "az_payee_dishonored_check_fee",
    "state_code": "AZ",
    "topic": "payee_returned_check",
    "name": "Payee service fee on dishonored checks",
    "citation": "A.R.S. § 44-6852",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "other",
    "coverage_note": "Definition not seen; coded from the statute's text as summarized: A.R.S. § 44-6852 lets the holder, payee or assignee of a dishonored check collect a fee from the drawer, so it binds payees, not a bank's fee to its depositor.",
    "applies_to": [],
    "summary": "This payee rule lets a dishonored check's holder or payee collect up to $25 plus actual bank charges from the drawer.",
    "detail": "The holder, payee or assignee of a dishonored check may collect from the drawer a service fee of up to $25 plus any actual charges the financial institution assessed. This is a payee rule, not a limit on bank fees.",
    "evidence": "Search excerpt of § 44-6852: 'may charge and collect from the maker or drawer a service fee of not more than $25 plus any actual charges assessed by the financial institution'.",
    "url": "https://www.azleg.gov/ars/44/06852.htm",
    "figures": {
      "max_payee_fee": 25
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "az_bank_account_garnishment_exemption",
    "state_code": "AZ",
    "topic": "garnishment_legal_process",
    "name": "Bank account exemption from garnishment; service charges still allowed",
    "citation": "A.R.S. § 33-1126",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "Up to $5,000 in one account at one financial institution is exempt from garnishment, adjusted yearly, but remains subject to normal service charges.",
    "detail": "Money held in a single account at one financial institution is exempt from garnishment up to a set amount ($5,000 per the search excerpt), adjusted for cost of living each January 1 starting in 2024 and rounded up to the nearest $100. The exempt amount is not exempt from the normal service charges the institution assesses on the account.",
    "evidence": "azleg.gov 33-1126 search excerpt: a total of $5,000 'held in a single account in any one financial institution' is exempt; 'adjusted annually beginning on January 1, 2024 and thereafter on January 1 of each successive year by the increase in the cost of living ... rounded up to the nearest $100'; 'The property declared exempt by this paragraph is not exempt from normal service charges assessed against the account by the financial institution at which the account is carried.' Because of annual adjustments, the current dollar amount may be higher than $5,000.",
    "url": "https://www.azleg.gov/ars/33/01126.htm",
    "figures": {
      "exempt_amount_usd": 5000,
      "rounding_usd": 100
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "az_special_deposit_overdraft_fee",
    "state_code": "AZ",
    "topic": "overdraft_nsf",
    "name": "Overdraft fees on special deposits (Uniform Special Deposits Act)",
    "citation": "Laws 2025, ch. 63 (SB 1206), Uniform Special Deposits Act",
    "date": "in force since 2025-09-26",
    "effective_date": "2025-09-26",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "coverage_note": "Laws 2025 ch. 63 (SB 1206, azleg.gov) defines 'bank' as a person engaged in the business of banking, including a savings bank, savings and loan association, credit union, trust company and a bank as defined in § 6-101, with no charter limit.",
    "applies_to": [
      "overdraft"
    ],
    "summary": "An account agreement may let a bank or credit union debit a special deposit for overdraft fees and directly related costs, barring other setoff.",
    "detail": "For a special deposit (a bank deposit for at least two beneficiaries, for a stated purpose and subject to a contingency), the account agreement may let the bank debit the deposit for an overdraft fee and for costs directly related to the special deposit; the bank otherwise may not set off against it. It applies to account agreements made on or after September 26, 2025, and covers banks as the act defines them, which includes savings banks, savings and loan associations, credit unions and trust companies.",
    "evidence": "azleg.gov Laws 2025 ch. 63 and Senate fact sheet: 'An account agreement may authorize the bank to debit a special deposit: ... for an overdraft fee; for costs incurred by the bank that relate directly to a special deposit'; bank may not exercise recoupment or setoff against a special deposit except against an obligation to pay a beneficiary; applies to account agreements executed on or after September 26, 2025 (per search summary). Signed by the Governor.",
    "url": "https://azleg.gov/legtext/57leg/1r/laws/0063.htm",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "az_state_bank_national_parity",
    "state_code": "AZ",
    "topic": "fee_authority",
    "name": "State banks may exercise national bank powers",
    "citation": "A.R.S. § 6-184",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "An Arizona state bank may exercise any power and engage in any activity it could as a national bank with an Arizona office.",
    "detail": "An Arizona state bank may exercise any power and engage in any activity it could if it were a national bank with a banking office in Arizona.",
    "evidence": "azleg.gov Title 6 search summary: state banks 'may exercise any power and engage in any activity which they could exercise or engage in if they were a national banking association with a banking office in the state', citing A.R.S. § 6-184. Section page itself not read.",
    "url": "https://www.azleg.gov/arsDetail/?title=6",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ca_cu_overdraft_nsf_cap",
    "state_code": "CA",
    "topic": "overdraft_nsf",
    "name": "Credit union overdraft and NSF fee cap and per-fee notice",
    "citation": "Cal. Fin. Code § 14053 (SB 1075, Stats. 2024, approved Sept. 24, 2024)",
    "date": "in force since 2026-01-01",
    "effective_date": "2026-01-01",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [
      "overdraft",
      "nsf"
    ],
    "summary": "Starting in 2026, a state credit union may not charge an overdraft or NSF fee above $14 or the CFPB amount, whichever is lower.",
    "detail": "Beginning January 1, 2026, a credit union may not charge an overdraft fee or an NSF fee above $14 or the amount set by the CFPB for that fee, whichever is lower. It must notify the member each time it assesses such a fee, by the member's designated communication method, on the same business day as the transaction or the next business day if same-day notice is not feasible.",
    "evidence": "leginfo bill text: 'Beginning January 1, 2026, ... prohibited from charging an overdraft fee or a nonsufficient funds fee exceeding $14 or the amount set by the federal Consumer Financial Protection Bureau for the fee, whichever is lower'; notice 'on the same business day the transaction occurred, or the next business day if not feasible'.",
    "url": "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202320240SB1075",
    "figures": {
      "max_fee_amount": 14
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ca_instant_decline_nsf_ban",
    "state_code": "CA",
    "topic": "overdraft_nsf",
    "name": "No NSF fee on instantaneously declined transactions",
    "citation": "Cal. Fin. Code § 530 (AB 2017, Ch. 509, Stats. 2024)",
    "date": "in force since 2026-01-01",
    "effective_date": "2026-01-01",
    "status": "in_force",
    "institutions": "state_banks_and_credit_unions",
    "applies_to": [
      "nsf"
    ],
    "summary": "A state bank or credit union may not charge an NSF fee when a transaction is declined instantly or near instantly for insufficient funds.",
    "detail": "A bank or credit union subject to the DFPI commissioner's examination authority may not charge a consumer an NSF fee when the consumer's attempt to initiate a transaction is declined instantaneously or near instantaneously for insufficient funds.",
    "evidence": "Search summary of leginfo AB 2017 text: adds Chapter 5.5 (commencing with Section 530); 'shall not charge a consumer a nonsufficient funds fee, as defined in Section 521, when the consumer's attempt to initiate a transaction is declined instantaneously or near instantaneously'. Chaptered as Ch. 509, Stats. 2024 per leginfo bill status; DFPI 2024 chaptered-legislation highlights also list it.",
    "url": "https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202320240AB2017",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ca_od_nsf_revenue_report",
    "state_code": "CA",
    "topic": "overdraft_nsf",
    "name": "Annual overdraft/NSF fee revenue report to DFPI",
    "citation": "Cal. Fin. Code § 521",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks_and_credit_unions",
    "applies_to": [
      "overdraft",
      "nsf"
    ],
    "summary": "A state bank or credit union must report its yearly overdraft and NSF fee revenue to the DFPI by March 1, with no fee cap.",
    "detail": "Banks and credit unions subject to the DFPI commissioner's examination authority must report each year, by March 1, the revenue they earned from overdraft and NSF fees in the prior calendar year and that revenue as a percentage of net income. It is a reporting duty and does not cap fees.",
    "evidence": "DFPI page: 'Financial Code section 521 requires state-chartered banks and credit unions to notify DFPI annually of the revenue they received from fees on nonsufficient funds and overdraft charges'; report 'on or before March 1 ... and the percentage of that revenue as a proportion of the net income'.",
    "url": "https://dfpi.ca.gov/regulated-industries/commercial-banks/california-state-bank-charter-the-charter-of-choice/income-from-fees-on-nonsufficient-funds-and-overdraft-charges/",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ca_dormant_service_charge_limit",
    "state_code": "CA",
    "topic": "dormancy",
    "name": "Inactivity service charges on dormant deposits limited to filed schedules; $2 notice charge",
    "citation": "Cal. Code Civ. Proc. § 1513 (Unclaimed Property Law)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "Inactivity charges on demand and NOW accounts may not exceed schedules filed with the State Controller, and a pre-escheat notice charge may not exceed $2.",
    "detail": "Reasonable service charges imposed because of inactivity may be withheld from demand deposits and NOW accounts, but may not exceed the schedules the financial organization has filed with the State Controller. For the pre-escheat notice, a charge of no more than $2 may be imposed on accounts worth more than $2, and no notice charge may be made on accounts under $50 (for which notice is not required).",
    "evidence": "Search excerpt of CCP 1513: 'Reasonable service charges may lawfully be withheld ... cannot exceed those set forth in schedules filed by the financial organization with the Controller'; notice charge 'in no case to exceed two dollars ($2)'; 'notice is not required for ... less than fifty dollars ($50), and no service charge may be made for notice on these items'. The notice provision may sit in CCP 1513.5; reviewer should confirm which subsection.",
    "url": "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CCP&sectionNum=1513.",
    "figures": {
      "max_notice_charge": 2,
      "notice_not_required_below": 50,
      "dormancy_years": 3
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ca_bank_paycheck_cashing_free",
    "state_code": "CA",
    "topic": "check_cashing",
    "name": "No fee to cash a bank-issued paycheck for a non-customer",
    "citation": "Cal. Fin. Code § 865 (SB 1904, 2003-04 session)",
    "date": "in force since 2004",
    "effective_date": "2004",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [
      "check_cashing"
    ],
    "summary": "A state bank may not charge a non-customer any fee to cash a paycheck the bank issued for one of its business clients.",
    "detail": "A bank may not charge any fee to cash a paycheck for a person without an account at the bank when the bank issued the paycheck for a business client that pays its employees through it.",
    "evidence": "SB 1904 bill text on leginfo: adds Article 1.5 'Paycheck Charges' (commencing with Section 865): 'a bank shall not assess any charge or fee to cash a paycheck for a person who does not have an account at the bank if the paycheck was issued by the bank for a business client of the bank'. Urgency statute. Chaptering and current code status were not directly confirmed (leginfo fetch blocked); 'bank' coverage of national banks not checked.",
    "url": "https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=200320040SB1904",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ca_levy_automatic_exemption",
    "state_code": "CA",
    "topic": "garnishment_legal_process",
    "name": "Automatic deposit account exemption on levy",
    "citation": "Cal. Code Civ. Proc. § 704.220",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "A financial institution served with a levy must automatically leave each debtor an exempt amount, which the Judicial Council lists as $2,325.",
    "detail": "When served with a levy on a judgment not based on wages owed or support, a financial institution must automatically leave exempt an amount equal to the minimum basic standard of care for a family of four, per debtor; the Judicial Council lists that amount as $2,325 from July 1, 2026. The statute protects funds and does not itself set a bank levy fee.",
    "evidence": "Judicial Council form EJ-157 info (courts.ca.gov): CCP 704.220 'requires financial institutions ... to apply an automatic exemption'; 'As of July 1, 2026, the amount ... is $2,325'; applies per debtor.",
    "url": "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=704.220.&lawCode=CCP",
    "figures": {
      "exempt_amount_from_2026_07_01": 2325
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "co_no_overdraft_nsf_cap_regulator_statement",
    "state_code": "CO",
    "topic": "overdraft_nsf",
    "name": "No state cap on bank overdraft or returned-check fees (Division of Banking statement)",
    "citation": "Colorado Division of Banking, Consumer FAQ (regulator guidance, not a statute)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [
      "overdraft",
      "nsf"
    ],
    "summary": "The Division of Banking says Colorado sets no limit on bank returned-check or overdraft fees, but banks must give a fee schedule at opening.",
    "detail": "The Colorado Division of Banking states that Colorado law sets no limit on what a bank may charge for returned checks or overdrafts, and that banks must give customers a fee schedule when an account is opened.",
    "evidence": "Search result summary of the Division of Banking FAQ: 'In Colorado, there is no limit on the amount a bank can charge for returned checks or overdrafts. Banks are required to provide a fee schedule to customers when new accounts are opened.' The FAQ does not cite the source of the fee-schedule requirement (may be federal Reg DD).",
    "url": "https://banking.colorado.gov/consumers/frequently-asked-questions",
    "verification": "official_excerpt",
    "source_kind": "regulator_guidance"
  },
  {
    "id": "co_ruupa_dormancy_charge",
    "state_code": "CO",
    "topic": "dormancy",
    "name": "Dormancy charge conditions under the Revised Uniform Unclaimed Property Act",
    "citation": "C.R.S. § 38-13-602 (SB 19-088)",
    "date": "in force since 2019",
    "effective_date": "2019",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct a dormancy charge from property sent to the state only under a contract, if regularly imposed, and if not unconscionable.",
    "detail": "A holder may deduct a dormancy charge from property it turns over to the state only if a valid contract with the owner authorizes the charge, the holder regularly imposes it and does not regularly reverse it, and the amount is not unconscionable given the holder's marginal costs and services received.",
    "evidence": "§ 38-13-602: holder may deduct a dormancy charge if 'a valid contract between the holder and the apparent owner authorizes imposition of the charge for the apparent owner's failure to claim the property within a specified time,' the holder regularly imposes and does not regularly reverse the charge; amount 'limited to an amount that is not unconscionable considering all relevant factors, including the marginal transactional costs incurred by the holder.'",
    "url": "http://leg.colorado.gov/bill_files/65189/download",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ct_ssa_direct_deposit_overdraft_fee_ban",
    "state_code": "CT",
    "topic": "overdraft_nsf",
    "name": "No overdraft fee when caused by Social Security direct deposit error",
    "citation": "Conn. Gen. Stat. § 36a-303",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "coverage_note": "§ 36a-303 names any bank, Connecticut credit union or federal credit union, and § 36a-2 (cga.ct.gov) defines 'bank' as a Connecticut bank or a federal bank (national bank, federal savings bank or federal S&L with its principal office in Connecticut); out-of-state credit unions are not named.",
    "applies_to": [
      "overdraft",
      "nsf"
    ],
    "summary": "A bank, Connecticut credit union or federal credit union may not charge for an overdraft caused by a Social Security direct deposit tape error.",
    "detail": "A bank, Connecticut credit union or federal credit union may not charge a fee or penalty for an overdraft caused by an error on, or an accidental omission from, a Social Security Administration direct deposit tape. (Covers banks, which § 36a-2 defines to include Connecticut banks and federal banks with a Connecticut principal office, plus Connecticut credit unions and federal credit unions.)",
    "evidence": "'No bank, Connecticut credit union or federal credit union may charge a fee or a penalty for an overdraft if such overdraft is due to an error on a direct deposit tape of the Social Security Administration or an accidental omission from such tape.'",
    "url": "https://cga.ct.gov/2023/pub/chap_665a.htm",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ct_state_assistance_check_cashing_free",
    "state_code": "CT",
    "topic": "check_cashing",
    "name": "Free cashing of state public assistance checks",
    "citation": "Conn. Gen. Stat. § 36a-304",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "coverage_note": "§ 36a-304 names each bank, Connecticut credit union and federal credit union, and § 36a-2 (cga.ct.gov) defines 'bank' to include federal banks (national banks, federal savings banks and S&Ls) with a Connecticut principal office.",
    "applies_to": [
      "check_cashing"
    ],
    "summary": "A bank, Connecticut credit union or federal credit union must cash state public assistance checks for the identified payee without charging a fee.",
    "detail": "Each bank, Connecticut credit union and federal credit union must cash, at its main office or any Connecticut branch, a State of Connecticut check payable to a recipient of public assistance, state-administered general assistance or the refugee program when the original payee presents reasonable identification, and may not charge the recipient a fee.",
    "evidence": "'Each bank, Connecticut credit union and federal credit union shall cash, at its main office or any of its branch offices within this state, any check drawn by the state of Connecticut and payable within this state to a recipient of public assistance ... and no bank, credit union or federal credit union shall charge such recipient a fee for cashing a check pursuant to this section.' Section number 36a-304 is from a search summary of chapter 665a.",
    "url": "https://cga.ct.gov/2023/pub/chap_665a.htm",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ct_deposit_charge_posting_and_30_day_notice",
    "state_code": "CT",
    "topic": "fee_change_notice",
    "name": "Posted fee lists and 30-day notice of new or increased deposit charges",
    "citation": "Conn. Gen. Stat. § 36a-319 (scope limits in § 36a-323)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "coverage_note": "§ 36a-316 (cga.ct.gov, as quoted in search) defines 'financial institution' for §§ 36a-315 to 36a-323 as any bank, Connecticut credit union or federal credit union, and § 36a-2 makes 'bank' include federal banks with a Connecticut principal office.",
    "applies_to": [],
    "summary": "A financial institution must post its deposit account charges and give 30 days' posted and delivered notice before any new or increased charge.",
    "detail": "A 'financial institution' (any bank, Connecticut credit union or federal credit union, per § 36a-316) must post a list of current deposit account charges in each office that accepts deposits, and may not impose a new or increased deposit account charge unless it posts notice at least 30 days beforehand and delivers notice to each affected depositor. Sections 36a-315 to 36a-323 do not apply to time accounts of $100,000 or more.",
    "evidence": "'No financial institution shall impose any new deposit account charge or increase any existing deposit account charge unless the financial institution posts a notice reciting such new or increased charge at least thirty days prior to such imposition or increase in each office ... and delivers a notice ... to each depositor who has a deposit account which will be affected.' § 36a-323: provisions of 36a-315 to 36a-323 do not apply to any time account containing $100,000 or more.",
    "url": "https://cga.ct.gov/2023/pub/chap_665a.htm",
    "figures": {
      "advance_notice_days": 30,
      "time_account_exclusion_threshold": 100000
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ct_basic_banking_account",
    "state_code": "CT",
    "topic": "basic_account",
    "name": "Required basic banking account with fee limits",
    "citation": "Conn. Gen. Stat. § 36a-316",
    "date": "in force since 2023-07-01",
    "effective_date": "2023-07-01",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "coverage_note": "§ 36a-316 (cga.ct.gov, as quoted in search) defines 'banking institution' as any FDIC- or NCUA-insured bank, trust company, savings bank, S&L or credit union chartered under the laws of Connecticut, any other state or the United States that offers consumer transaction accounts.",
    "applies_to": [
      "overdraft",
      "nsf",
      "early_closure",
      "dormant_account",
      "minimum_balance",
      "monthly_maintenance",
      "check_cashing",
      "paper_statement"
    ],
    "summary": "Each banking institution must offer a basic account without overdraft, NSF or dormancy fees, minimums of at most $25, and maintenance of at most $10.",
    "detail": "From July 1, 2023, each 'banking institution' must offer Connecticut residents a basic banking account with no overdraft, NSF, activation, closure, dormancy, inactivity or low-balance fees, a minimum opening deposit and minimum balance of no more than $25, and a maintenance charge of no more than $10 per cycle. The account must include at no extra charge a debit card, in-network ATM access, deposits, cashing of the institution's own checks, and electronic monthly statements.",
    "evidence": "'On and after July 1, 2023, each banking institution shall make available to consumers residing in the state a basic banking account.' Account 'shall not include fees for overdrafts, nonsufficient funds, account activation, account closure, dormancy, inactivity, or low balance'; 'shall not include a minimum initial deposit greater than twenty-five dollars, a minimum balance ... greater than twenty-five dollars, or a charge to maintain such account greater than ten dollars per periodic cycle.' Free: debit card, ATM in-network access, deposits, cashing checks issued by the institution, electronic monthly statements.",
    "url": "https://www.cga.ct.gov/current/pub/chap_665a.htm#sec_36a-316",
    "figures": {
      "max_minimum_opening_deposit": 25,
      "max_minimum_balance": 25,
      "max_maintenance_fee_per_cycle": 10
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ct_unclaimed_property_dormancy_fee_ban",
    "state_code": "CT",
    "topic": "dormancy",
    "name": "Ban on dormancy and inactivity charges on unclaimed-property-covered accounts",
    "citation": "Conn. Gen. Stat. ch. 32, Unclaimed Property (§§ 3-56a to 3-76; exact section not confirmed), as amended 2003 (SB 121)",
    "date": "in force since 2003-08-16",
    "effective_date": "2003-08-16",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder, including a bank, may not impose any dormancy, inactivity, escheat or similar fee on property under the unclaimed property law.",
    "detail": "A holder of property subject to Connecticut's unclaimed property law, including a banking organization, may not impose a dormancy, inactivity, abandoned property, unclaimed property, escheat or similar charge, fee or penalty for inactivity on that property. Legislative research reports date the ban to August 16, 2003.",
    "evidence": "'A holder of property subject to the unclaimed property part may not impose on the property a dormancy charge or fee, abandoned property charge or fee, unclaimed property charge or fee, escheat charge or fee, inactivity charge or fee, or any similar charge, fee or penalty for inactivity.' OLR materials: banks and other holders barred from charging dormancy fees starting August 16, 2003. Seen via OLR reports on cga.ct.gov, not the codified section.",
    "url": "https://www.cga.ct.gov/2019/rpt/pdf/2019-R-0014.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ct_bank_execution_exempt_funds_fee_refund",
    "state_code": "CT",
    "topic": "garnishment_legal_process",
    "name": "Bank execution: protected benefits floor, processing fee, and fee refund for wrongly paid exempt funds",
    "citation": "Conn. Gen. Stat. § 52-367b",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "coverage_note": "§ 52-367a (cga.ct.gov) defines 'financial institution' for §§ 52-367a and 52-367b as any bank, savings bank, S&L or credit union chartered under Connecticut or United States law with its main office in Connecticut, or a similar out-of-state institution with a Connecticut branch.",
    "applies_to": [
      "garnishment_levy",
      "legal_process",
      "nsf",
      "overdraft",
      "minimum_balance"
    ],
    "summary": "On execution against an account with federal benefits deposited within 30 days, a banking institution must leave the lesser of the balance or $800.",
    "detail": "When executing on a natural person's account at a banking institution, if identifiable federal benefits (veterans, Social Security, SSI) were direct-deposited in the prior 30 days the institution must leave the lesser of the balance or $800; the institution receives an $8 compliance fee from the serving officer (recoverable by the creditor as a cost), and if it wrongly pays over exempt money it is liable to the debtor and must refund or waive its charges, including dishonored check, overdraft and minimum balance fees.",
    "evidence": "Banking institution 'shall leave the lesser of the account balance or eight hundred dollars'; 'the banking institution shall receive from the serving officer a fee of eight dollars for its costs'; institution paying exempt moneys 'shall refund or waive any charges or fees by the bank, including dishonored check fees, overdraft fees, and minimum balance service charges.' Seen in 2020 supplement text; dollar amounts may have been amended later (PA 23-23 also appeared in results, not reviewed).",
    "url": "https://www.cga.ct.gov/2020/sup/chap_906.htm",
    "figures": {
      "lookback_days": 30,
      "protected_amount": 800,
      "bank_compliance_fee": 8
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "dc_unclaimed_property_dormancy_charge",
    "state_code": "DC",
    "topic": "dormancy",
    "name": "Dormancy charge deductible from unclaimed property only under contract, with a reasonableness limit",
    "citation": "D.C. Code § 41-156.02",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct a contract-authorized, regularly imposed dormancy charge, and $10 yearly for property of $50 or less or $20 above is not unconscionable.",
    "detail": "A holder may deduct a dormancy charge from property it must remit to the Administrator only if a valid contract with the owner authorizes the charge and the holder regularly imposes it and does not regularly reverse it, and the deduction must not be unconscionable. The statute treats a deduction of $10 a year for property of $50 or less, or $20 a year for property over $50, as not unconscionable.",
    "evidence": "Official code text (via search result): a holder may deduct a dormancy charge if 'a valid contract between the holder and the apparent owner authorizes imposition of the charge' and 'the holder regularly imposes the charge and regularly does not reverse or otherwise cancel the charge'; 'A deduction of $10 a year for maintaining property valued at $50 or less, or $20 a year for maintaining property valued at more than $50, or other amounts established by the Administrator by rule, is not unconscionable.'",
    "url": "https://code.dccouncil.gov/us/dc/council/code/sections/41-156.02",
    "figures": {
      "safe_harbor_small_annual": 10,
      "small_property_threshold": 50,
      "safe_harbor_large_annual": 20
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "dc_district_government_check_cashing_free",
    "state_code": "DC",
    "topic": "check_cashing",
    "name": "Free cashing of District government checks by eligible financial institutions",
    "citation": "D.C. Code § 47-351.14",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "other",
    "coverage_note": "D.C. Code § 47-351.01 (code.dccouncil.gov) defines 'eligible financial institution' as a bank, SEC-registered brokerage, S&L, savings bank or credit union meeting the requirements to bid for District deposits under § 47-351.04, a narrow class, not all banks.",
    "applies_to": [
      "check_cashing"
    ],
    "summary": "An eligible financial institution must cash District government checks without charge for account holders and non-account holders, and may require identification.",
    "detail": "An 'eligible financial institution' (a bank, savings institution, credit union or SEC-registered brokerage meeting the requirements to bid for District deposits) must cash checks issued by the District government without charge, for account holders and non-account holders alike, and may require proper identification.",
    "evidence": "Official code text (via search result): 'An eligible financial institution shall cash checks issued by the District government without charge for both account and non-account holders.' Definition in § 47-351.01 covers any bank, savings and loan association, savings bank, credit union, or SEC-registered brokerage 'meeting the requirements to become eligible to submit a bid'.",
    "url": "https://code.dccouncil.gov/us/dc/council/code/sections/47-351.14",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "dc_universal_bank_parity",
    "state_code": "DC",
    "topic": "fee_authority",
    "name": "Parity of powers for DC universal banks",
    "citation": "D.C. Code § 26-1401.08",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "The Commissioner may let a DC universal bank use any power of other state, savings or national banks, with no specific mention of fees.",
    "detail": "The Commissioner may authorize a DC universal bank to exercise any power that another state bank, a state or federal savings bank or savings and loan association, or a national bank may exercise. The provision is a general powers parity rule and does not mention deposit fees specifically.",
    "evidence": "Official code text (via search result): 'The Commissioner may authorize a universal bank to exercise a power that may be exercised by any other state bank, state or federally chartered savings bank, state or federally chartered savings and loan association, or federally charted national bank.'",
    "url": "https://code.dccouncil.gov/us/dc/council/code/sections/26-1401.08",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "de_special_deposit_overdraft_fee_debit",
    "state_code": "DE",
    "topic": "other",
    "name": "Uniform Special Deposits Act: permitted debits for overdraft fees and costs",
    "citation": "5 Del. C. ch. 51 (Uniform Special Deposits Act; Senate Bill 308, 152nd General Assembly, 84 Del. Laws c. 465); exact section number for the debit provision not confirmed",
    "date": "in force since 2025-01-01",
    "effective_date": "2025-01-01",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "coverage_note": "84 Del. Laws c. 465 (SB 308, legis.delaware.gov) defines 'bank' as a person engaged in the business of banking, including a savings bank, savings and loan association, credit union and trust company, with no charter limit.",
    "applies_to": [
      "overdraft"
    ],
    "summary": "An account agreement may let a bank or credit union debit a special deposit for overdraft fees and directly related costs, with no amount set.",
    "detail": "For a 'special deposit' (a deposit for the benefit of at least 2 beneficiaries, for a permissible purpose, and subject to a contingency, such as an escrow-type account), the account agreement may authorize the bank to debit the special deposit for a bank fee that relates to an overdraft in the special deposit account or for costs that relate directly to the special deposit. It applies to banks (which the act defines to include savings banks, savings and loan associations, credit unions and trust companies) holding special deposits under Delaware law, not to ordinary consumer checking accounts, and it sets no fee amount.",
    "evidence": "Official session law text (via search result): 'An account agreement may authorize the bank to debit the special deposit ... (2) For a fee assessed by the bank that relates to an overdraft in the special deposit account; (3) For costs incurred by the bank that relate directly to the special deposit'. Special deposit = deposit 'for the benefit of at least 2 beneficiaries ... subject to a contingency'. Act takes effect January 1, 2025.",
    "url": "https://legis.delaware.gov/SessionLaws/Chapter/GetPdfDocument?fileAttachmentId=645649",
    "figures": {
      "min_beneficiaries": 2
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "fl_unclaimed_property_dormancy_charge_conditions",
    "state_code": "FL",
    "topic": "dormancy",
    "name": "Dormancy or inactivity charges need a written contract and 3 months' notice",
    "citation": "Fla. Stat. § 717.117",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may impose dormancy charges only under a written contract and, for property over $2, after written notice at least 3 months beforehand.",
    "detail": "A holder may not impose charges due to dormancy or inactivity, or stop paying interest, unless an enforceable written contract with the owner allows it, and for property over $2 the holder must mail the owner written notice of the charges at least 3 months before first imposing them. Reasonable certified-mail costs paid to the U.S. Postal Service may be deducted as a service charge.",
    "evidence": "'A holder may not impose any charges due to dormancy or inactivity or cease payment of interest with respect to property unless there is an enforceable written contract between the holder and the apparent owner ... For property in excess of $2, the holder must give written notice to the apparent owner of the amount of those charges at the last known address at least 3 months prior to the initial imposition of those charges.' Search summary attributed this to § 717.117; exact subsection not confirmed.",
    "url": "https://www.leg.state.fl.us/Statutes/index.cfm?App_mode=Display_Statute&Search_String=&URL=0700-0799%2F0717%2FSections%2F0717.117.html",
    "figures": {
      "notice_threshold_amount": 2,
      "advance_notice_months": 3
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "fl_check_payment_fee_payee_in_person",
    "state_code": "FL",
    "topic": "check_cashing",
    "name": "Par settlement rule does not bar a fee for paying a check presented in person by the payee",
    "citation": "Fla. Stat. § 655.85 (as amended by 2013 SB 1020)",
    "date": "in force since 2013",
    "effective_date": "2013",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "coverage_note": "Fla. Stat. § 655.005 (flsenate.gov / leg.state.fl.us) defines 'financial institution' as a state or federal savings or thrift association, bank, savings bank, trust company, credit union and listed international and other entities.",
    "applies_to": [
      "check_cashing"
    ],
    "summary": "A financial institution may deduct a fee from a check drawn on it when the payee presents it in person, despite the at-par settlement rule.",
    "detail": "A 'financial institution' (as defined in chapter 655) must settle checks presented to it for payment at par, except when the payee presents the check in person; the at-par rule covers only settlement between institutions and does not prohibit the paying institution from deducting a fee from a check drawn on it when the payee presents it in person.",
    "evidence": "'the term \"at par\" applies only to the settlement of checks between collecting and paying or remitting institutions and does not apply to, or prohibit an institution from, deducting from the face amount of the check drawn on it a fee for paying the check if the check is presented to the institution by the payee in person.' 2013 date inferred from the SB 1020 bill analysis appearing in results; confirm.",
    "url": "https://flsenate.gov/Laws/Statutes/2022/0655.85",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "fl_garnishee_attorney_fee_deposit",
    "state_code": "FL",
    "topic": "garnishment_legal_process",
    "name": "Creditor pays $100 to the garnishee toward its attorney fee",
    "citation": "Fla. Stat. § 77.28",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "A party seeking a writ of garnishment must pay the garnishee, such as a bank, $100 toward its attorney fee, not charged to the depositor.",
    "detail": "On issuance of a writ of garnishment, the party applying for it must pay the garnishee (such as a bank) $100 on demand toward the garnishee's attorney fee for responding to the writ; this is a creditor payment, not a charge to the depositor.",
    "evidence": "'Upon issuance of any writ of garnishment, the party applying for it shall pay $100 to the garnishee on the garnishee's demand at any time after the service of the writ for the payment or part payment of his or her attorney fee.'",
    "url": "https://www.leg.state.fl.us/Statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099%2F0077%2F0077.html",
    "figures": {
      "garnishee_fee_amount": 100
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ga_dbf_dormant_account_service_charge",
    "state_code": "GA",
    "topic": "dormancy",
    "name": "Dormant deposit account service charge limits",
    "citation": "Ga. Comp. R. & Regs. 80-1-8-.01 (banks), applied to credit unions by 80-2-3-.06; O.C.G.A. § 44-12-197(c)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks_and_credit_unions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A state bank or credit union may charge a dormant account only after 12 dormant months and written notice, and $5 monthly absent contract terms.",
    "detail": "A demand deposit account is dormant after at least 12 months with no deposit, withdrawal or correspondence; a dormant-account service or maintenance charge may be assessed only after 12 months of dormancy and only after written notice before the first charge. Where the account contract provides no dormant charge, the charge may not exceed $5.00 per month; DBF guidance also describes contract-based charges as capped at the greater of $5.00 per month or the monthly charge assessed on active accounts.",
    "evidence": "Rule 80-1-8: 'Where a financial institution's contractual obligation does not make provision for a maintenance or service charge on a dormant account, such a charge may be assessed in an amount not to exceed $5.00 per month'; demand deposit accounts dormant after 'not less than twelve months'; charge 'may only be assessed after the account has been dormant for at least twelve months'; 'no service charge or maintenance charge may be assessed unless the financial institution provides written notice prior to the initial imposition of the charges pursuant to O.C.G.A. § 44-12-197(c)(1).' DBF dormant-accounts page: charges 'shall not exceed the greater of $5.00 per month or the per month service charge which the financial institution otherwise assesses against active accounts.'",
    "url": "https://rules.sos.ga.gov/gac/80-1-8",
    "figures": {
      "dormancy_period_months": 12,
      "max_monthly_dormant_charge": 5
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ga_unclaimed_property_reversed_charges",
    "state_code": "GA",
    "topic": "dormancy",
    "name": "No dormancy charges on remitted property when the holder reverses them for customers",
    "citation": "O.C.G.A. § 44-12-197(c)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder remitting unclaimed funds may not deduct dormancy charges it reverses for its customers, and such charges need prior written notice.",
    "detail": "A holder remitting unclaimed funds to Georgia may not deduct dormancy or inactivity service charges when it reverses such charges for its customers, and charges require prior written notice to the owner under § 44-12-197(c)(1).",
    "evidence": "Search summary of Georgia official results: 'O.C.G.A. § 44-12-197(c) forbids a holder remitting unclaimed funds to the state from imposing service charges for dormancy or inactivity when the same holder reverses such charges for its customers.' Exact statutory wording not seen.",
    "url": "https://dor.georgia.gov/ucp-holders-faqs",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ga_bank_overdraft_fee_parity_order",
    "state_code": "GA",
    "topic": "fee_authority",
    "name": "State banks may set overdraft fees free of state usury limits (parity order)",
    "citation": "Ga. Dept. of Banking & Finance Declaratory Order, Overdraft Fees Imposed in Connection with Deposit Accounts (banks), July 3, 2013, under O.C.G.A. §§ 7-1-61(e)(5) and 7-1-280",
    "date": "in force since 2013-07-03",
    "effective_date": "2013-07-03",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [
      "overdraft"
    ],
    "summary": "By parity order, a state bank's overdraft fees are non-interest deposit fees not subject to state usury limits, with no dollar cap.",
    "detail": "Using its parity power, the Commissioner modified state banks' deposit-taking authority in O.C.G.A. § 7-1-280 to treat overdraft fees on deposit accounts as non-interest fees directly related to receiving and paying out deposits, so a state bank's overdraft fees are not subject to state usury limits; no dollar cap is set.",
    "evidence": "'Pursuant to O.C.G.A. § 7-1-61(e)(5), the Commissioner modifies the deposit taking authority of state-chartered banks in O.C.G.A. § 7-1-280 to provide that overdraft fees on deposit accounts are non-interest fees and charges directly related to the receipt and withdrawal of deposits'; 'Overdraft fees imposed by a state-chartered bank are not subject to state law usury limitations.' Date taken from the document URL; current status assumed, not confirmed.",
    "url": "https://dbf.georgia.gov/document/publication/declaratory-order-overdraft-fees-banks-7-3-2013/download",
    "verification": "official_excerpt",
    "source_kind": "regulator_guidance"
  },
  {
    "id": "ga_cu_overdraft_fee_parity_order",
    "state_code": "GA",
    "topic": "fee_authority",
    "name": "State credit unions may set overdraft fees free of state usury limits (parity order)",
    "citation": "Ga. Dept. of Banking & Finance Declaratory Order, Credit Unions: Overdraft Fees Imposed in Connection with Deposit Accounts, July 11, 2013, under O.C.G.A. §§ 7-1-61(e)(5) and 7-1-650",
    "date": "in force since 2013-07-11",
    "effective_date": "2013-07-11",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [
      "overdraft"
    ],
    "summary": "By parity order, a state credit union may set overdraft fee amounts free of state usury limits, matching federal credit unions.",
    "detail": "To give parity with federal credit unions, the Commissioner modified state credit unions' deposit-taking authority in O.C.G.A. § 7-1-650(1) and (2) so they may set the amount of overdraft fees on deposit accounts free of state usury limits.",
    "evidence": "'the Commissioner modified the deposit taking authority of state-chartered credit unions in O.C.G.A. §§ 7-1-650(1) and (2) to provide that state-chartered credit unions can establish the amount of overdraft fees on deposit accounts free of any state law usury limitations in order to achieve parity with federal credit unions.'",
    "url": "https://dbf.georgia.gov/document/publication/declaratory-order-overdraft-fees-credit-unions-7-11-2013/download",
    "verification": "official_excerpt",
    "source_kind": "regulator_guidance"
  },
  {
    "id": "hi_cu_dormant_account_maintenance_fee",
    "state_code": "HI",
    "topic": "dormancy",
    "name": "Credit union reasonable maintenance fee on accounts inactive one year",
    "citation": "Haw. Rev. Stat. § 412:10-310",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A Hawaii credit union may impose a reasonable maintenance fee on a share or deposit account with no activity for 1 year.",
    "detail": "If a share or deposit account at a Hawaii credit union has had no activity for one year, the credit union may impose a reasonable maintenance fee; the statute sets no dollar amount.",
    "evidence": "§ 412:10-310: 'if there has been no activity on a share or deposit account for one year, the credit union may impose a reasonable maintenance fee.' (Seen as search-result paraphrase of the DFI-hosted statute page.) Same results described a presumption of abandonment after five years without member contact; not confirmed as part of this section.",
    "url": "https://files.hawaii.gov/dcca/dfi/Laws_html/HRS0412/HRS_0412-0010-0310.htm",
    "figures": {
      "inactivity_period_years": 1
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ia_bank_deposit_charges_schedule_notice",
    "state_code": "IA",
    "topic": "fee_change_notice",
    "name": "State bank deposit charges: board-set, schedule at opening, advance notice of changes",
    "citation": "Iowa Code § 524.805(3)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "A state bank may set deposit handling charges by board decision but must give a fee schedule at first deposit and advance notice of changes.",
    "detail": "A state bank may make charges for handling or custody of deposits as fixed by its board of directors, but must give the customer a schedule of the charges when it accepts the initial deposit and must furnish any change in charges within a reasonable period before the change takes effect.",
    "evidence": "Official Iowa Code text (legis.iowa.gov, chapter 524): 'A state bank may make charges for the handling or custody of deposits as fixed by its board of directors, provided that a schedule of the charges shall be furnished to the customer at the time of acceptance by the state bank of the initial deposit. Any change in the charges shall be furnished to the customer within a reasonable period of time before the effective date of the change.'",
    "url": "https://www.legis.iowa.gov/docs/code/2026/524.html",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ia_cu_fee_authority",
    "state_code": "IA",
    "topic": "fee_authority",
    "name": "State credit union power to charge fees and penalties",
    "citation": "Iowa Code § 533.301",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "An Iowa state credit union may charge fees and penalties, including on share drafts, and apply them to its income.",
    "detail": "Iowa's credit union powers section lets a state credit union charge fees and penalties, including on share drafts, and apply them to its income.",
    "evidence": "Search summary of the official § 533.301 text on legis.iowa.gov: a state credit union may 'charge fees and penalties on share drafts and apply fees and penalties to the state credit union's income.' Exact subsection number not confirmed.",
    "url": "https://www.legis.iowa.gov/docs/code/2023/533.301.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ia_unclaimed_dormancy_fee_rule",
    "state_code": "IA",
    "topic": "dormancy",
    "name": "Dormancy fees limited to those authorized by chapter 556; escheat fees prohibited",
    "citation": "Iowa Admin. Code r. 781-9.5(556) (Treasurer of State), implementing Iowa Code ch. 556",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "Only dormancy fees the unclaimed property law authorizes are allowed, escheat or compliance fees are prohibited, and dormancy fees must be disclosed in reports.",
    "detail": "Iowa's unclaimed property rule allows only dormancy fees authorized by Iowa Code chapter 556, such as lawful charges withheld from abandoned demand, savings or matured time deposits held by a financial organization; an escheat fee or other fee for the holder's compliance with chapter 556 is prohibited, and dormancy fees charged on an unclaimed account must be disclosed in the holder's unclaimed property report.",
    "evidence": "Official IAC text: 'Dormancy fees not authorized by Iowa Code chapter 556, including but not limited to an escheat fee or other fee sought for the holder's performance of the requirements of Iowa Code chapter 556, are prohibited.' Authorized fees include 'lawful charges withheld from abandoned demand, savings, or matured time deposits held by a financial organization.' 'Dormancy fee' covers 'a service charge, dormancy charge, inactive account fee, escheat fee, minimum balance fee, maintenance fee, unclaimed property fee, or any other charge that results in the reduction of an account balance ... and is not directly related to a transaction initiated by an owner.'",
    "url": "https://www.legis.iowa.gov/docs/iac/chapter/01-21-2026.781.9.pdf",
    "verification": "official_excerpt",
    "source_kind": "regulation"
  },
  {
    "id": "ia_daily_overdraft_fee_bulletin",
    "state_code": "IA",
    "topic": "overdraft_nsf",
    "name": "Banking Division bulletin: daily overdraft fees may be consumer credit finance charges",
    "citation": "Iowa Superintendent of Banking Interpretive Bulletin #9 (SB-1994-01, Feb. 14, 1994), applying Iowa Consumer Credit Code ch. 537",
    "date": "in force since 1994-02-14",
    "effective_date": "1994-02-14",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [
      "continuous_od"
    ],
    "summary": "The Division of Banking says a state bank's recurring daily overdraft fee is consumer credit that may face rate limits and disclosure rules.",
    "detail": "The Iowa Division of Banking's interpretive bulletin says paying an item that overdraws a consumer account is an extension of consumer credit, so a recurring daily fee charged while the account stays overdrawn may be subject to the Iowa Consumer Credit Code's rate limits and disclosure requirements; the bulletin treated a one-time overdraft charge as permissible and flagged daily fees exceeding 21 percent per annum without proper disclosures.",
    "evidence": "idob.iowa.gov page for SB-1994-01: some institutions assessed 'a daily fee on an overdrawn account, in addition to the normal one-time overdraft charge'; the decision to pay an overdraft 'creates an extension of credit'; if primarily for personal, family or household purpose it 'normally meets the definition of a consumer credit transaction', which has rate limitations and disclosure requirements; in the cases seen 'the daily fee exceeded 21 percent per annum and proper disclosures had not been provided.'",
    "url": "https://idob.iowa.gov/sb-1994-01-daily-fees",
    "figures": {
      "rate_threshold_percent_per_annum": 21
    },
    "verification": "official_excerpt",
    "source_kind": "regulator_guidance"
  },
  {
    "id": "id_garnishment_bank_fees",
    "state_code": "ID",
    "topic": "garnishment_legal_process",
    "name": "Financial institution garnishment search fee and $12 processing fee cap, with recredit on release",
    "citation": "Idaho Code § 11-710; search fee in § 11-703(1)(a)(vi)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy",
      "legal_process"
    ],
    "summary": "A garnished financial institution gets a $7 search fee from the creditor and may deduct one fee up to $12, refunded if funds prove exempt.",
    "detail": "When a financial institution is garnishee, the creditor must supply a $7 search fee; the institution may deduct one fee of no more than $12 from the money sent to the sheriff to cover processing and service, and this is its only processing and service fee. If the money is released as exempt (by court decision or because the creditor did not contest the exemption claim), the institution must recredit or reimburse the fee to the debtor and the creditor must reimburse the institution.",
    "evidence": "'A financial institution is entitled to deduct a single fee of not to exceed twelve dollars ($12.00) from the money transferred to the sheriff pursuant to the garnishment to cover the costs associated with the processing and service of the documents. This fee is the only processing and service fee to which the financial institution is entitled ... and is in addition to the search fee specified in section 11-703(1)(a)(vi)'; 'If the garnishee is a financial institution, a search fee of seven dollars ($7.00)'; 'the garnishee shall recredit the fee to the judgment debtor's account or reimburse the judgment debtor therefor, and the judgment creditor shall reimburse the garnishee for the fee.'",
    "url": "https://legislature.idaho.gov/statutesrules/idstat/title11/t11ch7/sect11-710/",
    "figures": {
      "search_fee": 7,
      "max_processing_fee": 12
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "id_garnishment_exempt_direct_deposits",
    "state_code": "ID",
    "topic": "garnishment_legal_process",
    "name": "Directly deposited exempt benefits not subject to garnishment",
    "citation": "Idaho Code § 11-713",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "Direct-deposited exempt benefits such as Social Security stay exempt at a financial institution and are not subject to garnishment.",
    "detail": "Exempt funds such as Social Security, SSI, veterans benefits, public assistance, unemployment and certain retirement and workers' compensation benefits stay exempt when deposited at a financial institution; if the institution determines from payor information that exempt payments were direct-deposited, the total balance of those deposited exempt funds is not subject to garnishment. This is an exemption rule, not a fee limit.",
    "evidence": "Exempt funds 'shall remain exempt without limitation when deposited into an account at a financial institution'; 'If the financial institution determines, solely from information transmitted to the financial institution by the payor, that one (1) or more payments of exempt funds ... were deposited by direct or electronic deposit payment in an account of the debtor, the total balance of deposited exempt funds in the debtor account is not subject to garnishment.'",
    "url": "https://legislature.idaho.gov/statutesrules/idstat/title11/t11ch7/sect11-713/",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "id_ruupa_dormancy_charge",
    "state_code": "ID",
    "topic": "dormancy",
    "name": "Dormancy charge deduction conditions under the Revised Unclaimed Property Act",
    "citation": "Idaho Code title 14, ch. 5 (Revised Unclaimed Property Act), part 6 (exact section not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct a dormancy charge from property turned over to the state only under a contract, if regularly imposed and not reversed.",
    "detail": "A holder may deduct a dormancy charge from property it turns over to the state only if a valid contract with the owner authorizes the charge for failure to claim the property within a specified time and the holder regularly imposes and does not regularly reverse the charge.",
    "evidence": "'A holder may deduct a dormancy charge from property required to be paid or delivered to the administrator if a valid contract between the holder and the apparent owner authorizes imposition of the charge for the apparent owner's failure to claim the property within a specified time, and the holder regularly imposes the charge and regularly does not reverse or otherwise cancel the charge.' Any further limit on the amount was not seen.",
    "url": "https://legislature.idaho.gov/statutesrules/idstat/Title14/T14CH5PT6/",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "id_bank_parity_and_cu_fee_power",
    "state_code": "ID",
    "topic": "fee_authority",
    "name": "State bank national-bank parity and credit union power to set account fees",
    "citation": "Idaho Bank Act and Idaho Credit Union Act, Idaho Code title 26 (sections not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks_and_credit_unions",
    "applies_to": [],
    "summary": "An Idaho bank may use any national bank power, and an Idaho credit union may impose fees and charges on member accounts and services.",
    "detail": "An Idaho bank may engage in any activity or exercise any power it could if it were a national bank, or that a federal agency has approved for any state-chartered bank; an Idaho credit union may impose fees and charges in connection with the accounts and services it provides to members.",
    "evidence": "Bank: may 'engage in any activity in which it could engage, exercise any power it could exercise, or make any loan or investment which it could make if it were operating as a national bank or which has been approved by the responsible federal agency for any state-chartered bank.' Credit union: power to 'impose fees and charges in connection with the accounts and services provided to members.' Seen in search summaries of Idaho Department of Finance / Legislature act PDFs; section numbers not identified.",
    "url": "https://legislature.idaho.gov/wp-content/uploads/statutesrules/idstat/Title26/T26CH21.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "il_basic_checking_seniors",
    "state_code": "IL",
    "topic": "basic_account",
    "name": "Basic Checking Account for consumers 65 and older",
    "citation": "205 ILCS 605/4 (Consumer Deposit Account Act)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_banks",
    "coverage_note": "205 ILCS 605/1 (ilga.gov) defines 'financial institution' as Illinois banks (and out-of-state bank branches), savings banks, savings and loan associations, and federally chartered commercial banks, savings banks or S&Ls operating in Illinois; credit unions are not named.",
    "applies_to": [
      "minimum_balance",
      "monthly_maintenance"
    ],
    "summary": "A covered financial institution must offer people 65 or older a Basic Checking Account opening for $100, with no activity charge on 10 checks monthly.",
    "detail": "Every financial institution covered by the Consumer Deposit Account Act must offer a Basic Checking Account to any natural person 65 or older who asks. It may require only a $100 minimum opening deposit or a direct-deposit agreement (no other minimum balance or deposit requirement, subject to a subsection (d) exception), and may not impose an activity charge on the first 10 checks per calendar month, though it may charge its customary stop payment and NSF returned-check fees.",
    "evidence": "'Every financial institution shall offer a Basic Checking Account to any natural person 65 years of age or older who requests such an account.' ... 'minimum initial deposit of $100, or ... direct deposits' ... 'No activity charge may be imposed for the first 10 checks drawn on a Basic Checking Account in any calendar month, provided that a financial institution may charge its customary fee for a stop payment order or any transaction resulting in a check returned due to insufficient funds.' (search summary of ilga.gov text)",
    "url": "https://www.ilga.gov/legislation/ilcs/ilcs3.asp?ActID=1189&ChapterID=20",
    "figures": {
      "min_age": 65,
      "max_initial_deposit": 100,
      "free_checks_per_month": 10
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "il_consumer_deposit_fee_disclosure",
    "state_code": "IL",
    "topic": "fee_change_notice",
    "name": "Fee disclosure statement at opening and annually",
    "citation": "205 ILCS 605/2 (Consumer Deposit Account Act)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_banks",
    "coverage_note": "205 ILCS 605/1 (ilga.gov) defines 'financial institution' as Illinois banks (and out-of-state bank branches), savings banks, savings and loan associations, and federally chartered commercial banks, savings banks or S&Ls operating in Illinois; credit unions are not named.",
    "applies_to": [],
    "summary": "A financial institution must give consumer deposit account holders a statement of all account fees at opening and at least once each calendar year.",
    "detail": "A financial institution must give a disclosure statement listing all fees charged for a consumer deposit account at the initial deposit and at least once each calendar year to every consumer deposit account holder.",
    "evidence": "'Every financial institution shall provide the disclosure statement specified in subsection (a) to each depositor at the time of the initial deposit ... and not less than once during each calendar year to every consumer-deposit account holder' (search summary of ilga.gov text). The statement contains 'all fees charged for the account'.",
    "url": "https://ilga.gov/documents/legislation/ilcs/documents/020506050K2.htm",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "il_bank_service_charge_authority",
    "state_code": "IL",
    "topic": "fee_authority",
    "name": "State bank service charges are a business decision; parity with national banks",
    "citation": "205 ILCS 5/5 (Illinois Banking Act, general corporate powers)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "An Illinois state bank sets account service charges not otherwise limited by law as a business decision under prudent, safe and sound standards.",
    "detail": "The establishment of account service charges and their amounts, where not otherwise limited by law, is a business decision for an Illinois state bank under prudent business judgment and safe and sound standards; the bank may consider its costs plus a profit margin, deterrence of misuse, competitive position, and safety and soundness. State banks also have the powers of national banks, subject to restrictions in Section 5(11) and 5(25).",
    "evidence": "'the establishment of account service charges and the amounts of the charges not otherwise limited or prescribed by law is a business decision to be made by a bank according to prudent business judgment and safe and sound operating standards' (search summary of ilga.gov / IDFPR text)",
    "url": "https://ilga.gov/Legislation/ILCS/Articles?ActID=1178&ChapterID=20",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "il_cu_fees_by_board_resolution",
    "state_code": "IL",
    "topic": "fee_authority",
    "name": "Credit union fees set by board resolution",
    "citation": "205 ILCS 305 (Illinois Credit Union Act); specific section not confirmed",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "An Illinois credit union may assess charges and fees to members as its board resolves.",
    "detail": "An Illinois credit union may assess charges and fees to members in accordance with board resolution.",
    "evidence": "'Credit unions may assess charges and fees to members in accordance with board resolution.' (search summary of ilga.gov text; section number not shown)",
    "url": "https://ilga.gov/Legislation/ILCS/Articles?ActID=1185&ChapterID=20&Print=True",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "il_cu_dormancy_escheat_fee",
    "state_code": "IL",
    "topic": "dormancy",
    "name": "Credit union dormancy or escheat fee",
    "citation": "205 ILCS 305/44.1",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "An Illinois credit union may deduct a dormancy charge or escheat fee from unclaimed property if consistent with unclaimed property act standards.",
    "detail": "A credit union may deduct a dormancy charge or escheat fee from property it must deliver to the state under the Revised Uniform Unclaimed Property Act, if the deduction is consistent with the standards in that Act.",
    "evidence": "Section 44.1 (Unclaimed property; dormancy or escheat fee): a credit union may deduct a dormancy charge or an escheat fee ... consistent with the standards set forth in the applicable law (search summary of ilga.gov text).",
    "url": "https://ilga.gov/Legislation/ILCS/Articles?ActID=1185&ChapterID=20&Print=True",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "il_unclaimed_property_dormancy_charge",
    "state_code": "IL",
    "topic": "dormancy",
    "name": "Conditions on dormancy charges deducted from unclaimed property",
    "citation": "765 ILCS 1026/15-602 (Revised Uniform Unclaimed Property Act)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct a dormancy charge only under a contract, if regularly imposed and not reversed, and in an amount that is not unconscionable.",
    "detail": "A holder may deduct a dormancy charge from property paid to the state only if a valid contract with the owner authorizes it and the holder regularly imposes and does not regularly reverse it; the amount may not be unconscionable considering the holder's marginal costs and services received by the owner.",
    "evidence": "'A holder may deduct a dormancy charge or an escheat fee ... if: (1) a valid contract between the holder and the apparent owner authorizes imposition of the charge ... and (2) the holder regularly imposes the charge and regularly does not reverse or otherwise cancel the charge.' Amount limited to 'an amount that is not unconscionable' (search summary of ilga.gov text).",
    "url": "https://www.ilga.gov/legislation/ILCS/details?ActID=3794&ActName=Revised+Uniform+Unclaimed+Property+Act.&ChapAct=765+ILCS+1026%2F&Chapter=PROPERTY&ChapterID=62&MajorTopic=RIGHTS+AND+REMEDIES",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "in_unclaimed_dormancy_charge_conditions",
    "state_code": "IN",
    "topic": "dormancy",
    "name": "Conditions for deducting dormancy charges from unclaimed property",
    "citation": "Ind. Code ch. 32-34-1.5 (unclaimed property act, added 2021); predecessor Ind. Code ch. 32-34-1. Exact section number not confirmed (possibly § 32-34-1.5-28).",
    "date": "in force since 2021",
    "effective_date": "2021",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct a dormancy charge from unclaimed property only under a written contract, if regularly imposed and not regularly reversed.",
    "detail": "Under Indiana's unclaimed property act, a holder may deduct a dormancy charge from property it must report or deliver to the attorney general only if a valid written contract with the owner allows the charge, the holder regularly imposes it, and the charge is not regularly reversed or canceled.",
    "evidence": "Official sources seen in search results: the 2014 statute posted on indianaunclaimed.gov (Attorney General) states a holder 'may not deduct a charge' imposed because the owner failed to claim the property unless there is 'a valid and enforceable written contract' allowing it, the holder 'regularly imposes the charge,' and the charge 'is not regularly reversed or otherwise canceled'; the 2021 Indiana Senate Journal (iga.in.gov) shows new IC 32-34-1.5 carrying the same conditions ('a holder may deduct a dormancy charge ... if' a valid contract exists and the holder regularly imposes the charge).",
    "url": "https://iga.in.gov/ic/2026/Title_32.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ks_unclaimed_dormancy_charge_conditions",
    "state_code": "KS",
    "topic": "dormancy",
    "name": "Conditions and five-year limit on dormancy or inactivity charges",
    "citation": "K.S.A. 58-3935(h)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may charge for dormancy only by written contract, for at most 5 years, with notice within 3 months before for property over $100.",
    "detail": "A holder of property subject to the Kansas unclaimed property act may impose a fee or charge due to dormancy or inactivity only under an enforceable written contract with the owner, and such charges may be imposed for no more than five calendar years. For property over $100, the holder must mail the owner written notice no more than three months before first imposing the charge.",
    "evidence": "Official kslegislature.gov statute text (as returned in search): a holder may not impose any fee or charge due to dormancy or inactivity unless there is an enforceable written contract; for property in excess of $100 the holder must mail written notice no more than three months before the initial imposition; charges 'may be made and collected monthly, quarterly or annually except that such charges may only be imposed for a maximum of five calendar years.'",
    "url": "https://kslegislature.gov/li_2024/b2023_24/statute/058_000_0000_chapter/058_039_0000_article/058_039_0035_section/058_039_0035_k",
    "figures": {
      "max_years_charged": 5,
      "notice_threshold_amount": 100,
      "notice_window_months": 3
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ks_garnishment_admin_fee",
    "state_code": "KS",
    "topic": "garnishment_legal_process",
    "name": "Garnishee administrative fee for non-wage garnishment",
    "citation": "K.S.A. 60-733",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "A garnishee may withhold and keep a $15 administrative fee for each garnishment order that attaches funds.",
    "detail": "A garnishee may, without prior agreement, withhold and keep a $15 administrative fee for each garnishment order that attaches funds; where the amount ordered withheld exceeds the funds held by a bank, savings and loan association, credit union or finance company, the fee is deducted from the amount withheld.",
    "evidence": "Official statute text (2020 Kansas Statutes page on kslegislature.gov): 'The garnishee, without prior agreement, may withhold and retain to defray the garnishee's costs, an administrative fee of $15 for each order of garnishment that attaches funds, credits or indebtedness ... if the amount required to be withheld ... is greater than the amount of the funds ... held by a bank, savings and loan association, credit union or finance company, the fee shall be deducted from the amount withheld.'",
    "url": "https://www.kslegislature.gov/li_2020/b2019_20/statute/060_000_0000_chapter/060_007_0000_article/060_007_0033_section/060_007_0033_k/",
    "figures": {
      "max_fee_amount": 15
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ky_unclaimed_interest_bearing_no_fees",
    "state_code": "KY",
    "topic": "dormancy",
    "name": "No fees on presumed-abandoned interest-bearing deposit accounts",
    "citation": "KRS ch. 393 (Kentucky unclaimed property law), as described in the State Treasurer's Unclaimed Property Holder Book; exact section not seen",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "An interest-bearing deposit account presumed abandoned must be remitted with its interest and may not be reduced by holder fees after that date.",
    "detail": "For unclaimed property held in an interest-bearing demand, savings or time deposit account, accumulated interest must be remitted with the account and the account may not be reduced by fees or charges assessed by the holder from the date the property was presumed abandoned.",
    "evidence": "'All accumulated interest shall remit with the account, and the account shall not be reduced by fees or charges assessed by the holder from and after the date the property was presumed abandoned' (search summary of Kentucky Treasury holder materials / legislature.ky.gov).",
    "url": "https://treasury.ky.gov/unclaimedproperty/Documents/2025%20Unclaimed%20Property%20Holder%20Book.pdf",
    "verification": "official_excerpt",
    "source_kind": "regulator_guidance"
  },
  {
    "id": "ky_cu_federal_parity_by_rule",
    "state_code": "KY",
    "topic": "fee_authority",
    "name": "Credit union parity with federal credit unions by commissioner rule",
    "citation": "KRS 286.6-095",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "The Commissioner may adopt rules letting Kentucky credit unions exercise any federal credit union power when reasonably necessary.",
    "detail": "Notwithstanding other law, the Commissioner of Financial Institutions may make reasonable rules letting Kentucky credit unions exercise any power conferred on federal credit unions when the commissioner deems it reasonably necessary for their well-being.",
    "evidence": "KRS 286.6-095: 'notwithstanding any other provision of law, the commissioner may make reasonable rules authorizing credit unions to exercise any of the powers conferred upon federal credit unions' (search summary of legislature.ky.gov text).",
    "url": "https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=14761",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "la_state_bank_national_parity",
    "state_code": "LA",
    "topic": "fee_authority",
    "name": "State bank parity with national banks on notice",
    "citation": "La. R.S. 6:242",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "A Louisiana state bank gains national bank powers by notifying the Commissioner in writing if the Commissioner does not object within 45 days.",
    "detail": "A Louisiana state bank has the rights, powers, privileges and immunities of a national bank (or national bank branch) domiciled in the state if it notifies the Commissioner of Financial Institutions in writing and the commissioner does not object within 45 days.",
    "evidence": "R.S. 6:242: a state bank 'shall have and possess such rights, powers, privileges, and immunities of a national bank or national bank branch domiciled in the state' if it 'notifies the commissioner in writing of its intent' and 'the commissioner does not raise an objection within forty-five days' (search summary of legis.la.gov text).",
    "url": "https://www.legis.la.gov/legis/Law.aspx?d=105876",
    "figures": {
      "objection_period_days": 45
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ma_dormancy_charge_conditions",
    "state_code": "MA",
    "topic": "dormancy",
    "name": "Conditions on dormancy or inactivity charges",
    "citation": "Mass. Gen. Laws ch. 200A, § 15C",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account",
      "cashiers_check",
      "money_order"
    ],
    "summary": "No holder may charge savings or checking accounts for dormancy unless a written contract sets it, the customer is told first, and waiver isn't policy.",
    "detail": "A holder may not impose a dormancy or inactivity charge on a savings or checking account, or stop paying interest, unless a valid written contract specifies the charge and that interest will cease, the customer is notified before the charge is imposed, and it is not the holder's policy to waive the charge. A holder also may not deduct charges for failure to present a draft, money order, certified, cashier's or treasurer's check unless a written contract provides for them and the holder does not have a policy of waiving them.",
    "evidence": "\"no holder may impose any charges in respect of dormancy or inactivity on a savings or checking account or cease payment of interest unless: (1) such charges ... are provided for in a valid, enforceable and written contract ... which specifies the amount of such charges ...; (2) the customer is notified prior to the imposition of such charges ...; and (3) it is not the policy of the holder to waive such charges\" (search excerpt of malegislature.gov page)",
    "url": "https://malegislature.gov/Laws/GeneralLaws/PartII/TitleII/Chapter200a/Section15c",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ma_18_65_accounts",
    "state_code": "MA",
    "topic": "basic_account",
    "name": "\"18-65\" accounts: no fees for depositors 18 or younger or 65 or older",
    "citation": "Mass. Gen. Laws ch. 167D, § 2 (banks); credit union counterpart in ch. 171 as amended by St. 2020, c. 338; Division of Banks Regulatory Bulletin 2.1-106 (Oct. 7, 2022)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks_and_credit_unions",
    "applies_to": [
      "monthly_maintenance",
      "minimum_balance",
      "nsf",
      "overdraft"
    ],
    "summary": "A state bank or credit union may not charge accounts of people 65 or older or 18 or younger, except $5 maximum per insufficient-funds transaction.",
    "detail": "A Massachusetts-chartered bank or credit union may not impose any fee, charge or other assessment on the savings or demand deposit account of a person 65 or older or 18 or younger; such an account may not have a minimum balance requirement, a charge for deposits or withdrawals, or a fee for the basic line of checks. Under the Division of Banks guidelines, the charge for a transaction refused or paid despite insufficient funds on such an account may not exceed $5 per transaction.",
    "evidence": "Bulletin 2.1-106: banks/credit unions \"are prohibited from imposing any fee, charge or other assessment against the savings account or demand deposit account of any persons 65 years of age or older or 18 years of age or younger\"; \"the charge assessed for a transaction refused because of insufficient funds or paid despite insufficient funds shall not exceed $5.00 per such transaction\"; \"No such account shall be subject to: (i) a minimum balance requirement; (ii) a charge for a deposit or withdrawal; or (iii) a fee for the initial order or subsequent refills of the basic line of checks\". Chapter 338 of the Acts of 2020 extended the requirement to credit unions.",
    "url": "https://www.mass.gov/regulatory-bulletin/21-106-guidelines-for-18-65-accounts-for-banks-and-credit-unions",
    "figures": {
      "min_age_senior": 65,
      "max_age_minor": 18,
      "max_nsf_or_od_fee_per_transaction": 5
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ma_deposit_return_item_fee_cap",
    "state_code": "MA",
    "topic": "returned_item",
    "name": "Deposited return item (DRI) fee cap set annually by the Commissioner of Banks",
    "citation": "Mass. Gen. Laws ch. 167D, § 6 (banks); ch. 171, § 41A (credit unions); Division of Banks 2025 Deposit Return Item Fee Decision (July 18, 2025)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks_and_credit_unions",
    "applies_to": [
      "deposited_item_return"
    ],
    "summary": "A state bank or credit union may charge only a direct-cost fee for a consumer's returned deposited check, capped at $7.14 under the 2025 decision.",
    "detail": "When a consumer deposits a check of which they are the payee but not the maker and it is returned unpaid, a Massachusetts-chartered bank or credit union may charge only a reasonable fee representing its direct costs, with the maximum set each year by the Commissioner of Banks. The 2025 decision set the maximum at $7.14 for August 1, 2025 to July 31, 2026, or until the 2026 decision is issued.",
    "evidence": "2025 decision: \"The maximum allowable fee Massachusetts state-chartered banks and credit unions may assess certain consumer deposit accounts for processing dishonored checks or DRI items shall be $7.14\", in effect \"from August 1, 2025 to July 31, 2026, or until such time as the Division of Banks issues its 2026 DRI fee decision\"; statute permits \"a reasonable fee, charge or assessment that represents its direct costs, as established annually by the Commissioner of Banks\".",
    "url": "https://www.mass.gov/decision/2025-deposit-return-item-fee-decision",
    "figures": {
      "max_fee_amount_2025_decision": 7.14
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ma_trustee_process_exemption",
    "state_code": "MA",
    "topic": "garnishment_legal_process",
    "name": "$2,500 bank account exemption from trustee process",
    "citation": "Mass. Gen. Laws ch. 246, § 28A",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "$2,500 of a person's bank account funds is exempt from trustee process, and the bank answers only for funds above that amount.",
    "detail": "$2,500 of a natural person's funds in an account at any bank, credit union or national bank doing business in Massachusetts is exempt from attachment by trustee process, and the bank answers only for the amount above $2,500. The section as seen does not itself address the bank's own legal process fee.",
    "evidence": "\"Twenty-five hundred dollars of any natural person in an account in a trust company, savings bank, cooperative bank, credit union, national banking association or other banking institution doing business in the commonwealth shall be exempt from attachment by trustee process.\"",
    "url": "https://malegislature.gov/Laws/GeneralLaws/PartIII/TitleIV/Chapter246/Section28A",
    "figures": {
      "exempt_amount": 2500
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ma_bank_parity_national_banks",
    "state_code": "MA",
    "topic": "fee_authority",
    "name": "State bank parity with national and out-of-state banks",
    "citation": "Mass. Gen. Laws ch. 167F, § 2, para. 31; 209 CMR 47.00",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "A Massachusetts bank may exercise any federal or out-of-state bank power on 30 days' notice to the Commissioner unless state law prohibits it.",
    "detail": "A Massachusetts-chartered bank may, on 30 days' written notice to the Commissioner, exercise any power or activity permissible for a federal bank or out-of-state bank, subject to the same limits, unless Massachusetts law otherwise prohibits it.",
    "evidence": "Para. 31: may \"exercise any power and engage in any activity that is permissible for a federal bank or out-of-state bank ... by providing 30 days written notice in advance to the commissioner\", provided not otherwise prohibited under Massachusetts law; implemented at 209 CMR 47.00 \"Parity with National Bank\".",
    "url": "https://www.mass.gov/regulations/209-CMR-47-parity-with-national-banks",
    "figures": {
      "notice_days": 30
    },
    "verification": "official_excerpt",
    "source_kind": "regulation"
  },
  {
    "id": "md_dormant_account_charges",
    "state_code": "MD",
    "topic": "dormancy",
    "name": "Conditions on charges against dormant or inactive accounts",
    "citation": "Md. Code, Com. Law § 17-308.1",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may not charge a dormant account unless a written contract sets it, the owner gets prior notice, and all dormant accounts are charged.",
    "detail": "A holder may not impose charges on a dormant or inactive account, or stop paying interest or dividends, during the abandonment period unless a valid written contract specifies the amount or rate of the charge, the holder gives the owner written notice before acting, and the holder imposes the charge on all dormant accounts without reversing it.",
    "evidence": "'A holder may not impose any charges on a dormant or inactive account or cease payment or accrual of any benefits ... unless: (1) the charges ... are provided for in a valid, enforceable and written contract ... which specifies the amount or rate of the charges ...; (2) the holder gives written notice to the owner at the owner's last known address before the proposed action; and (3) the holder imposes charges ... on all dormant or inactive accounts, and does not reverse or otherwise cancel the charges' (search summary of mgaleg.maryland.gov text)",
    "url": "https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcl&section=17-308.1&enactments=false",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "md_garnishment_500_exemption",
    "state_code": "MD",
    "topic": "garnishment_legal_process",
    "name": "Automatic $500 exemption in garnished deposit accounts",
    "citation": "Md. Code, Cts. & Jud. Proc. § 11-504 (as amended by 2023 Md. Laws ch. 719 (HB 42) and ch. 720 (SB 106))",
    "date": "in force since 2023",
    "effective_date": "2023",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "Up to $500 in a debtor's deposit accounts is automatically exempt from garnishment, and the institution holds only amounts above $500.",
    "detail": "Up to $500 in a debtor's deposit account at a depository institution is exempt from garnishment without the debtor having to claim it; on receiving a writ the institution answers that the balance does not exceed $500 or holds only the amount above $500, and may decide which of several accounts the exemption applies to. The statute as summarized does not address bank fees for processing the writ.",
    "evidence": "'Up to $500 in a deposit account or other account of the debtor held by a depository institution' is exempt 'without election of the debtor'; the institution answers the writ stating the total does not exceed $500 or the amount in excess of $500 held pending further order (search summary of mgaleg.maryland.gov text and 2023 chapters).",
    "url": "https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gcj&section=11-504",
    "figures": {
      "exempt_amount": 500
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "md_state_bank_wildcard_parity",
    "state_code": "MD",
    "topic": "fee_authority",
    "name": "State bank wild-card parity with national banks (notice procedure)",
    "citation": "Maryland wild-card statute, Financial Institutions Article (exact section not seen; described in Commissioner of Financial Regulation Industry Advisory)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "A Maryland state bank may use a national bank power not expressly authorized by state law after giving the Commissioner 45 days' written notice.",
    "detail": "A Maryland state-chartered bank may engage in an activity, service or practice authorized for national banks under federal law but not expressly authorized by Maryland law after giving the Commissioner written notice at least 45 calendar days in advance, describing the authority relied on and any federal conditions.",
    "evidence": "State-chartered banks 'are no longer required to apply, but shall provide the Commissioner with written notice, at least 45 calendar days before engaging in any activity, service, or other practice authorized under federal law, but not expressly authorized under Maryland law' (search summary of Commissioner advisory).",
    "url": "https://labor.maryland.gov/finance/advisories/advisory-wildcardstatutefinal.pdf",
    "figures": {
      "notice_days": 45
    },
    "verification": "official_excerpt",
    "source_kind": "regulator_guidance"
  },
  {
    "id": "me_multiple_nsf_fee_guidance",
    "state_code": "ME",
    "topic": "overdraft_nsf",
    "name": "Bureau guidance treating multiple NSF fees on re-presented items as unfair",
    "citation": "Maine Bureau of Financial Institutions Bulletin #83 (Non-Sufficient Funds Fees), issued under Resolves 2025 (LD 142 / SP 78, 132nd Legislature, signed May 29, 2025)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks_and_credit_unions",
    "applies_to": [
      "nsf"
    ],
    "summary": "Bureau guidance, not statute, treats multiple NSF fees, such as one on each unavoidable re-presentment, as unfair for state banks and credit unions.",
    "detail": "The Bureau of Financial Institutions treats charging multiple NSF fees on consumer accounts as an unfair practice, particularly where an institution assesses an NSF fee on each re-presentment the customer cannot reasonably avoid, or charges multiple NSF fees in a short period without sufficient notice or chance to bring the account positive. This is regulator guidance, not a statutory cap; LD 142 as introduced would have barred more than one NSF fee per withdrawal transaction, but was amended into a Resolve directing the Bureau to issue guidance to state-chartered institutions by January 1, 2026.",
    "evidence": "Bulletin 83: the Bureau treats multiple NSF fees charged to consumer accounts as an unfair practice 'particularly when a financial institution has a policy of assessing NSF fees on each representment if the customer or member is unable to reasonably avoid the NSF fees' (search summary). LD 142 final version: Resolve directing BFI 'to issue written guidance to state-chartered financial institutions and credit unions on the charging of multiple fees for attempted withdrawals involving insufficient funds no later than January 1, 2026'; signed May 29, 2025.",
    "url": "https://www.maine.gov/pfr/financialinstitutions/sites/maine.gov.pfr.financialinstitutions/files/inline-files/Bulletin_83_NonSufficient_Funds_Fees_0.pdf",
    "verification": "official_excerpt",
    "source_kind": "regulator_guidance"
  },
  {
    "id": "me_fee_disclosure_30_day_increase_notice",
    "state_code": "ME",
    "topic": "fee_change_notice",
    "name": "Fee disclosure at opening and 30 days before fee increases",
    "citation": "Maine law under Title 9-B as described by the Bureau of Financial Institutions consumer FAQ; Bureau Bulletin #67; exact statutory section not seen",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks_and_credit_unions",
    "applies_to": [],
    "summary": "A state bank or credit union must disclose checking fees at opening and 30 days before any increase, and Maine sets no overdraft fee limit.",
    "detail": "According to the Bureau, a bank or credit union must give a written disclosure of checking account fees when the account is opened and 30 days before any fee increase takes effect; Bulletin #67 also says informational brochures must be updated at least 30 days before new or increased deposit service charges are implemented. The Bureau states Maine law does not limit the amount of overdraft fees.",
    "evidence": "BFI FAQ: 'Maine law does not limit the amount of overdraft fees ... However, they are required to provide you with a written disclosure of the fees ... at the time you open the account and 30 days prior to the effective date of any increase in fees.' Bulletin 67: 'At least 30 days prior to implementation of new or increased deposit account service charges, any informational brochures ... must be modified.'",
    "url": "https://www.maine.gov/pfr/financialinstitutions/consumer-tools/financial-faq/bank-and-credit-union-fees",
    "figures": {
      "notice_days": 30
    },
    "verification": "official_excerpt",
    "source_kind": "regulator_guidance"
  },
  {
    "id": "me_inactive_account_charges_bulletin_67",
    "state_code": "ME",
    "topic": "dormancy",
    "name": "No state maximum on inactive account service charges; guidelines apply",
    "citation": "Maine Bureau of Financial Institutions Bulletin #67 (Nov. 2, 1997), following repeal of Banking Regulation #12; 9-B M.R.S. § 428",
    "date": "in force since 1997-11-02",
    "effective_date": "1997-11-02",
    "status": "in_force",
    "institutions": "state_banks_and_credit_unions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "No Maine law caps inactive account charges before escheat, but Bureau guidelines apply to state banks and credit unions.",
    "detail": "Since Banking Regulation #12 was repealed, no Maine law or rule sets a maximum service charge on inactive or dormant accounts before escheat, but Bureau guidelines in Bulletin #67 apply; under 9-B § 428, unclaimed account money is handled under the Maine Revised Unclaimed Property Act.",
    "evidence": "'While state law or rule no longer sets a maximum service charge that can be levied against inactive or dormant accounts prior to escheating to the state, guidelines apply to such charges' (search summary of Bulletin 67). 9-B §428: moneys in unclaimed accounts 'must be disposed of according to Title 33, chapter 45'.",
    "url": "https://www.maine.gov/pfr/financialinstitutions/sites/maine.gov.pfr.financialinstitutions/files/pdf/bulletins/Bulletin-67.pdf",
    "verification": "official_excerpt",
    "source_kind": "regulator_guidance"
  },
  {
    "id": "me_unclaimed_property_dormancy_charge",
    "state_code": "ME",
    "topic": "dormancy",
    "name": "Conditions on dormancy charges deducted from unclaimed property",
    "citation": "33 M.R.S. § 2112 (Maine Revised Unclaimed Property Act, P.L. 2019 ch. 498)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct a dormancy charge only under a contract, if regularly imposed and not reversed, and in an amount that is not unconscionable.",
    "detail": "A holder may deduct a dormancy charge from property delivered to the state only if a valid contract with the owner authorizes it and the holder regularly imposes and does not reverse it; the amount may not be unconscionable considering the holder's marginal costs and services received by the owner.",
    "evidence": "'A holder may deduct a dormancy charge ... if a valid contract between the holder and the apparent owner authorizes imposition of the charge ...' ; 'regularly impose the charge and regularly not reverse'; 'not unconscionable' (search summary of legislature.maine.gov, Title 33 ch. 45, § 2112).",
    "url": "https://legislature.maine.gov/statutes/33/title33ch45sec0.html",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "me_trustee_process_100_exemption",
    "state_code": "ME",
    "topic": "garnishment_legal_process",
    "name": "$100 of demand accounts exempt from ex parte trustee process",
    "citation": "14 M.R.S. ch. 501 (Trustee Process); exact section not seen",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "Up to $100 of a defendant's demand bank accounts per trustee is exempt from trustee process approved by an ex parte order.",
    "detail": "Up to $100 of a defendant's demand bank accounts held by any one trustee is exempt from trustee process approved by an ex parte order. The text seen does not address bank fees for processing trustee process.",
    "evidence": "'A maximum of one hundred dollars of demand bank accounts of the defendant held by any one trustee shall, however, be exempt from trustee process approved by an ex parte order.' (search summary of legislature.maine.gov Title 14 ch. 501)",
    "url": "https://legislature.maine.gov/legis/statutes/14/title14ch501.pdf",
    "figures": {
      "exempt_amount": 100
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "mi_dormancy_charge_conditions",
    "state_code": "MI",
    "topic": "dormancy",
    "name": "Conditions on dormancy or inactivity charges",
    "citation": "MCL 567.227(3) (Uniform Unclaimed Property Act, 1995 PA 29)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may not charge for dormancy or stop paying interest unless statutory conditions are met, starting with a written contract allowing it.",
    "detail": "A holder may not impose a charge for dormancy or inactivity, or stop paying interest, unless all of the statute's conditions are met, the first being an enforceable written contract with the owner allowing the charge or the end of interest. The remaining listed conditions were not seen.",
    "evidence": "\"A holder may not impose any charge due to dormancy or inactivity or cease payment of interest unless all of the following requirements are met: (a) There is an enforceable written contract between the holder and the owner of the property providing that the holder may impose a charge or cease payment of interest.\"",
    "url": "https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-567-227",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "mi_cu_fee_authority",
    "state_code": "MI",
    "topic": "fee_authority",
    "name": "Credit union fees set by contract",
    "citation": "MCL 490.401 (Credit Union Act, 2003 PA 215)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "A Michigan credit union may charge fees for shares, savings, credit and other services by contract or agreement.",
    "detail": "A Michigan-chartered credit union may charge fees in connection with shares, savings, extensions of credit and other services by contract or agreement.",
    "evidence": "\"A domestic credit union may charge fees in connection with shares, savings, extensions of credit, and other services by contract or agreement.\" (search excerpt)",
    "url": "https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-490-401",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "mi_cu_check_cashing_fee_cap",
    "state_code": "MI",
    "topic": "check_cashing",
    "name": "Credit union check cashing fee caps",
    "citation": "MCL 490.412 (Credit Union Act, 2003 PA 215)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [
      "check_cashing"
    ],
    "summary": "A Michigan credit union may charge at most 5% to cash payroll or government checks, 7% for insurance checks, 10% for others, plus $25 initially.",
    "detail": "A Michigan-chartered credit union may not charge more than 5% of the face amount to cash a payroll, pension or government check, 7% for an insurance company check, or 10% for a personal check, money order or other check. It may also charge a fee of up to $25 for the first check it cashes for an individual.",
    "evidence": "\"(1) A domestic credit union shall not contract for, receive, impose, assess, or collect a charge or fee for the cashing of a check that exceeds 1 of the following percentages of the face amount of the check, as applicable: (a) Five percent for a payroll, pension, or government check. (b) Seven percent for a check from an insurance company ... (c) Ten percent for a personal check, money order, or other check. (2) A domestic credit union may contract for, receive, impose, assess, or collect a charge or fee that does not exceed $25.00 for the first check the credit union cashes for an individual.\"",
    "url": "https://legislature.mi.gov/Laws/MCL?objectName=mcl-490-412",
    "figures": {
      "max_pct_payroll_pension_government": 5,
      "max_pct_insurance": 7,
      "max_pct_personal_money_order_other": 10,
      "max_first_check_fee": 25
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "mn_transaction_account_service_charges_reasonable",
    "state_code": "MN",
    "topic": "fee_authority",
    "name": "Transaction account service charges are a business decision but must be reasonable",
    "citation": "Minn. Stat. § 48.512, subd. 7",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "coverage_note": "Minn. Stat. § 48.512, subd. 1 (revisor.mn.gov) defines 'financial intermediary' as any person doing business in Minnesota who offers transaction accounts to the public, so it reaches any bank, thrift or credit union regardless of charter.",
    "applies_to": [],
    "summary": "Each financial intermediary sets transaction account service charges by sound business judgment, and they must be reasonable and set competitively, not by agreement.",
    "detail": "Each financial intermediary (as defined in § 48.512) sets its own transaction account service charges, not otherwise limited by law, by sound business judgment; the charges must be reasonable in relation to cost plus profit, deterring misuse, competitive position and safety and soundness, and must be set competitively, not by agreement with other institutions.",
    "evidence": "\"The establishment of transaction account service charges and the amounts of the charges not otherwise limited or prescribed by law or rule is a business decision to be made by each financial intermediary according to sound business judgment ...\"; \"Transaction account service charges must be reasonable in relation to these considerations and should be arrived at by each financial intermediary on a competitive basis and not on the basis of any agreement, arrangement, undertaking, or discussion with other financial intermediaries\"",
    "url": "https://www.revisor.mn.gov/statutes/cite/48.512",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "mn_dishonored_check_charge_non_issuer_cap",
    "state_code": "MN",
    "topic": "returned_item",
    "name": "$10 cap on dishonored check charge to anyone other than the issuer",
    "citation": "Minn. Stat. § 48.512, subd. 7",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "coverage_note": "Minn. Stat. § 48.512, subd. 1 (revisor.mn.gov) defines 'financial intermediary' as any person doing business in Minnesota who offers transaction accounts to the public, so it reaches any bank, thrift or credit union regardless of charter.",
    "applies_to": [
      "deposited_item_return"
    ],
    "summary": "A financial intermediary may not charge anyone other than the check's issuer more than $10 for a dishonored check.",
    "detail": "A financial intermediary (as defined in § 48.512) may not charge more than $10 for a dishonored check to any person other than the issuer of the check, such as a customer who deposited it.",
    "evidence": "\"A financial intermediary may not impose a service charge in excess of $10 for a dishonored check on any person other than the issuer of the check.\"",
    "url": "https://www.revisor.mn.gov/statutes/cite/48.512",
    "figures": {
      "max_fee_amount": 10
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "mn_required_no_fee_savings_account",
    "state_code": "MN",
    "topic": "basic_account",
    "name": "Required no-fee savings account",
    "citation": "Minn. Stat. § 47.76",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "monthly_maintenance",
      "minimum_balance"
    ],
    "summary": "A bank, savings association, savings bank or credit union must offer residents a fee-free savings account when its average monthly balance exceeds $50.",
    "detail": "A federal or state chartered bank, savings association, savings bank or credit union must offer a Minnesota resident a savings account with no service charge or fee if the account's average monthly balance is more than $50.",
    "evidence": "Search excerpt (twice): a \"federal or state chartered financial institution, including a bank, savings association, savings bank, or credit union, shall offer to a Minnesota resident a savings account to promote thrift that has no service charge or fee, if such an account has an average monthly balance of more than $50\"; section titled \"Required Savings Account\".",
    "url": "https://www.revisor.mn.gov/statutes/cite/47.76",
    "figures": {
      "min_average_monthly_balance": 50
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "mn_dormant_deposit_service_charges",
    "state_code": "MN",
    "topic": "dormancy",
    "name": "Contracted service charges on dormant deposits limited to one year",
    "citation": "Minn. Stat. § 345.32",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "Deposits are presumed abandoned after 3 years of owner inactivity, and contracted service charges may be deducted for no more than 1 year.",
    "detail": "A demand, savings or matured time deposit with a banking organization is presumed abandoned after three years without owner activity, together with its interest, excluding contracted service charges, which may be deducted for a period of no more than one year.",
    "evidence": "\"Any demand, savings or matured time deposit made in Minnesota with a banking organization ... is presumed abandoned, with any interest or dividend thereon, excluding contracted service charges which may be deducted for a period not to exceed one year\" (search excerpt)",
    "url": "https://www.revisor.mn.gov/statutes/cite/345.32",
    "figures": {
      "dormancy_years": 3,
      "max_service_charge_period_years": 1
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "mn_garnishment_account_exemption",
    "state_code": "MN",
    "topic": "garnishment_legal_process",
    "name": "$1,000 depository account exemption from garnishment",
    "citation": "Minn. Stat. ch. 571 (exact section not pinned; references §§ 571.91 to 571.915)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "A garnished financial institution must leave the debtor the lesser of the account total or $1,000, and the creditor pays the garnishee $15.",
    "detail": "Up to $1,000 in a debtor's depository accounts is exempt from garnishment regardless of source, and a financial institution served with a garnishment summons must leave in the debtor's accounts the lesser of the account total or $1,000. The creditor pays the garnishee a $15 fee at service; no state limit on the bank's own fee to the customer was found.",
    "evidence": "\"An amount of up to $1,000 in one or more of a debtor's depository accounts held in a financial institution, regardless of the money's source, is exempt from garnishment under sections 571.91 to 571.915\"; FI \"must leave in the debtor accounts the lesser of the total of the debtor accounts or $1,000\"; \"A garnishee shall be paid a $15 fee by the creditor at the time of service of a garnishment summons.\"",
    "url": "https://www.revisor.mn.gov/statutes/cite/571/full",
    "figures": {
      "exempt_amount": 1000,
      "creditor_paid_garnishee_fee": 15
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "mn_cu_parity_federal_credit_unions",
    "state_code": "MN",
    "topic": "fee_authority",
    "name": "Credit union parity with federal credit unions",
    "citation": "Minn. Stat. § 52.04, subd. 2a",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "With the commissioner's approval, a Minnesota credit union may exercise federal credit union powers not barred by state law, decided within 60 days.",
    "detail": "With the commissioner's approval, a Minnesota credit union may exercise any power or activity permitted for a federal credit union, except credit union activity that Minnesota law prohibits; the commissioner must decide within 60 days.",
    "evidence": "\"notwithstanding any other provision of law, and in addition to all powers and activities a credit union has under the laws of this state, a credit union may exercise the powers and activities of, or take any action permitted for, a federal credit union, upon approval of the commissioner\"; approve or deny within 60 days; may not authorize activity prohibited by state law.",
    "url": "https://www.revisor.mn.gov/statutes/cite/52.04/pdf",
    "figures": {
      "approval_deadline_days": 60
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "mo_bank_deposit_fee_authority_federal_parity",
    "state_code": "MO",
    "topic": "fee_authority",
    "name": "State bank deposit fees; regulation no more restrictive than for federal institutions",
    "citation": "RSMo § 362.111",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "A Missouri bank may impose deposit account fees under state regulation, but no state condition may be stricter than federal charters allow.",
    "detail": "A Missouri bank or trust company may impose fees or service charges on deposit accounts, subject to conditions the Director of Finance and the State Banking and Savings and Loan Board may set by regulation under § 361.105, but no such condition may be more restrictive than what any federally chartered depository institution is permitted to charge.",
    "evidence": "'A bank or trust company may impose fees or service charges on deposit accounts; however, such fees or service charges are subject to such conditions or requirements that may be fixed by regulations pursuant to section 361.105 ... no such condition or requirement shall be more restrictive than the fees or service charges on deposit accounts or similar accounts permitted any federally chartered depository institution.' (search summary of revisor.mo.gov text)",
    "url": "https://revisor.mo.gov/main/OneSection.aspx?bid=34743&hl=&section=362.111",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "mo_state_bank_super_wild_card",
    "state_code": "MO",
    "topic": "fee_authority",
    "name": "State bank 'super wild card' parity with national banks",
    "citation": "RSMo § 362.106(4)",
    "date": "in force since 2001",
    "effective_date": "2001",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "A Missouri state bank may exercise national bank powers after prior notice to the Division of Finance, even if state law would prohibit them.",
    "detail": "Missouri state-chartered banks may exercise all powers of national banks operating in Missouri after prior notice to the Division of Finance, without a Division regulation, even where Missouri law would otherwise prohibit the power.",
    "evidence": "Division of Finance: 'Section 362.106(4) RSMo Supp.2001 gives Missouri state banks the same powers as Missouri-based national banks without requiring a Division of Finance regulation'; powers 'can be exercised even if they would otherwise be prohibited under Missouri law' with 'only a prior notice to the Division of Finance'.",
    "url": "https://finance.mo.gov/banks-0/laws-regulations-and-wild-card-powers",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "mo_inactive_account_statement_fee",
    "state_code": "MO",
    "topic": "dormancy",
    "name": "Annual statements and $5 statement fee on inactive consumer accounts",
    "citation": "RSMo § 447.200 (as shown in search result; reviewer should confirm section)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "coverage_note": "RSMo § 447.503 (revisor.mo.gov) defines 'banking organization' as any bank, trust company or safe deposit company and 'financial organization' as any savings and loan association, credit union or loan and investment company engaged in business in Missouri, with no charter limit.",
    "applies_to": [
      "dormant_account",
      "paper_statement"
    ],
    "summary": "A bank, thrift or credit union must send annual statements on consumer accounts inactive 12 or more months, and may charge up to $5 each.",
    "detail": "For a consumer deposit account inactive for 12 months or more, a banking organization or financial organization (banks, trust companies, savings and loan associations and credit unions, per § 447.503) must issue annual statements to the depositor and may charge a service fee of up to $5 for each such statement, withdrawn from the inactive account.",
    "evidence": "'a bank or financial organization may charge a service fee of up to five dollars for any statement issued for inactive accounts' ... 'For any consumer deposit account that is or has been inactive for twelve months or more, such bank or financial organization shall issue annual statements' (search summary of revisor.mo.gov text).",
    "url": "https://www.revisor.mo.gov/main/PageSelect.aspx?section=447.200&bid=35074",
    "figures": {
      "inactive_months": 12,
      "max_statement_fee": 5
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ms_state_bank_federal_parity",
    "state_code": "MS",
    "topic": "fee_authority",
    "name": "State bank parity with federally chartered depository institutions",
    "citation": "Miss. Code tit. 81, ch. 5 (state bank powers; exact section not seen) and DBCF Banking Regulations (parity regulation)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "coverage_note": "Miss. Code § 81-5-1 as summarized on billstatus.ls.state.ms.us / dbcf.ms.gov gives parity to state-chartered banks, savings associations, S&Ls and savings banks; it is a grant of powers to state charters only.",
    "applies_to": [],
    "summary": "A state bank, savings association or savings bank may exercise its federal counterpart's powers with the Commissioner's prior approval.",
    "detail": "A state-chartered bank, savings association or savings bank may exercise the rights and powers of its federally chartered counterpart operating in Mississippi, under the same conditions, with prior approval from the Commissioner of Banking and Consumer Finance after an application showing the federal counterpart has the right; the statute also gives state banks national-bank powers as prescribed by State Board of Banking Review regulation.",
    "evidence": "DBCF regulation: 'Any state-chartered bank, savings association, savings and loan association, or savings bank may exercise the rights, powers, privileges, immunities, duties and obligations of a federally chartered depository institution under the same circumstances and conditions ... subject to the prior approval and any conditions imposed by the Commissioner'; statute: a state-chartered bank 'shall have ... such of the rights, powers ... of a national bank having its principal place of business in this state as may be prescribed by the State Board of Banking Review by general regulation' (search summary of dbcf.ms.gov text).",
    "url": "https://dbcf.ms.gov/wp-content/uploads/2021/01/Banking-Regulations.pdf",
    "verification": "official_excerpt",
    "source_kind": "regulation"
  },
  {
    "id": "mt_unclaimed_property_dormancy_charge",
    "state_code": "MT",
    "topic": "dormancy",
    "name": "Conditions on dormancy charges deducted from presumed-abandoned property",
    "citation": "Mont. Code Ann. § 70-9-806",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct a dormancy charge only under a written contract, if regularly imposed and not reversed, and only if not unconscionable.",
    "detail": "A holder may deduct a dormancy charge from property presumed abandoned only if a valid, enforceable written contract with the owner allows it and the holder regularly imposes the charge without regularly reversing or canceling it; the deduction is limited to an amount that is not unconscionable.",
    "evidence": "MCA 70-9-806 'Dormancy charge': a holder may deduct ... a charge imposed by reason of the owner's failure to claim the property within a specified time only if there is a valid and enforceable written contract ... and the holder regularly imposes the charge, which is not regularly reversed or otherwise canceled; the amount of the deduction is limited to an amount that is not unconscionable.",
    "url": "https://leg.mt.gov/BILLS/mca/title_0700/chapter_0090/part_0080/section_0060/0700-0090-0080-0060.html",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "mt_state_bank_national_parity",
    "state_code": "MT",
    "topic": "fee_authority",
    "name": "National bank powers extended to state banks",
    "citation": "Mont. Code Ann. § 32-1-362",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "With department approval, a Montana bank may engage in any national bank activity not expressly prohibited or limited by state law.",
    "detail": "On application to and approval by the department, a Montana bank may engage in any activity or business it could engage in as a national bank, if the power or activity is not expressly prohibited or limited by Montana law.",
    "evidence": "MCA 32-1-362: 'A bank organized under the laws of this state may engage in any activity or business in which the bank could engage if it were operating as a national bank if the power or activity is not expressly prohibited or limited by the laws of this state and upon application to and approval by the department.'",
    "url": "https://leg.mt.gov/bills/mca/title_0320/chapter_0010/part_0030/section_0620/0320-0010-0030-0620.html",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "mt_credit_union_federal_parity",
    "state_code": "MT",
    "topic": "fee_authority",
    "name": "Credit union parity with federal credit unions",
    "citation": "Mont. Code Ann. Title 32, ch. 3 (likely § 32-3-804 'Additional rights and powers -- department rules'; exact section not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "After written application to the department, a Montana credit union may engage in any activity open to federal credit unions.",
    "detail": "On written application to the department, a Montana credit union may engage in any activity a federally chartered credit union could engage in at the time the authority is granted.",
    "evidence": "MCA Title 32 ch. 3 (per search of leg.mt.gov): 'Upon written application to the department of administration, a credit union may engage in any activity in which a credit union could engage if it were operating as a federal chartered credit union at the time the authority is granted.'",
    "url": "https://leg.mt.gov/bills/2019/mca/title_0320/chapter_0030/part_0080/section_0040/0320-0030-0080-0040.html",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nc_savings_bank_returned_check_fee",
    "state_code": "NC",
    "topic": "returned_item",
    "name": "Savings bank processing fee for returned and NSF checks",
    "citation": "N.C. Gen. Stat. § 54C-168",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "other",
    "coverage_note": "N.C. Gen. Stat. § 54C-168 (ncleg.gov) speaks of 'a savings bank' under Chapter 54C (Savings Banks), whose § 54C-4 covers state savings banks organized under that chapter, a narrow class of North Carolina savings banks only.",
    "applies_to": [
      "deposited_item_return",
      "nsf"
    ],
    "summary": "A North Carolina savings bank may charge a processing fee for refused checks and checks drawn against insufficient funds, with no dollar limit shown.",
    "detail": "A North Carolina-chartered savings bank may charge a processing fee for checks on which payment was refused by the payor institution, and for checks drawn on the savings bank against an account with insufficient funds. The search result did not show a dollar limit for this fee.",
    "evidence": "G.S. 54C-168 (per search of ncleg.gov): a savings bank may charge and collect a processing fee for checks on which payment has been refused by the payor depository institution, and may also collect a processing fee for checks drawn on that savings bank with respect to an account with insufficient funds.",
    "url": "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_54C/GS_54C-168.html",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nc_savings_association_returned_check_fee",
    "state_code": "NC",
    "topic": "returned_item",
    "name": "Savings and loan association processing fee for returned and NSF checks",
    "citation": "N.C. Gen. Stat. § 54B-147 (Chapter 54B, Article 6A 'Fee for Returned Checks')",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "other",
    "coverage_note": "Definition not seen; coded from the statute's text: N.C. Gen. Stat. § 54B-147 (ncleg.gov) speaks of a savings and loan association under Chapter 54B (Savings and Loan Associations), a narrow class of North Carolina savings associations only.",
    "applies_to": [
      "deposited_item_return",
      "nsf"
    ],
    "summary": "A North Carolina savings and loan association may charge a processing fee for refused checks and insufficient-funds checks, with no dollar limit shown.",
    "detail": "A North Carolina savings and loan association may charge a processing fee for checks, including NOW drafts, on which payment was refused by the payor institution, and for checks drawn on the association against an account with insufficient funds. The search result did not show a dollar limit for this fee.",
    "evidence": "G.S. 54B-147 (per search of ncleg.gov): a processing fee may be charged and collected by any association for checks (including negotiable order of withdrawal drafts) on which payment has been refused by the payor depository institution, and an association may also collect said fee for checks drawn on that association with respect to an account with insufficient funds.",
    "url": "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_54B/GS_54B-147.html",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nc_unclaimed_property_dormancy_charge",
    "state_code": "NC",
    "topic": "dormancy",
    "name": "Conditions on dormancy charges deducted from presumed-abandoned property",
    "citation": "N.C. Gen. Stat. § 116B-57",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct a reasonable dormancy charge from abandoned property only under a written contract, if regularly imposed and not reversed.",
    "detail": "A holder may deduct from property presumed abandoned a reasonable charge for the owner's failure to claim it only if a valid, enforceable written contract with the owner allows the charge and the holder regularly imposes the charge without regularly reversing or canceling it.",
    "evidence": "G.S. 116B-57 (per search of ncleg.gov): a holder may deduct from property presumed abandoned a reasonable charge imposed by reason of the owner's failure to claim the property within a specified time only if there is a valid and enforceable written contract ... and the holder regularly imposes the charge, which is not regularly reversed or otherwise canceled.",
    "url": "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/ByChapter/Chapter_116B.html",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nc_bank_deposit_account_terms",
    "state_code": "NC",
    "topic": "fee_authority",
    "name": "Banks may set deposit account terms and conditions",
    "citation": "N.C. Gen. Stat. § 53C-6-2(a)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "A North Carolina bank may offer deposit accounts on terms it considers appropriate, consistent with law and safe and sound practices.",
    "detail": "A North Carolina bank may, consistent with applicable law and safe and sound banking practices, offer all types of deposit accounts on the terms and conditions it considers appropriate.",
    "evidence": "§ 53C-6-2(a): a bank may, consistent with applicable law and safe and sound banking practices, offer all types of deposit accounts upon such terms and conditions as the bank considers appropriate.",
    "url": "https://ncleg.gov/EnactedLegislation/Statutes/HTML/ByArticle/Chapter_53C/Article_6.html",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nc_credit_union_deposit_terms",
    "state_code": "NC",
    "topic": "fee_authority",
    "name": "Credit union deposits on terms set by the board",
    "citation": "N.C. Gen. Stat. Chapter 54, Subchapter III (credit unions); exact section not confirmed",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "A North Carolina credit union may take deposits from members and nonmembers on terms set by its board and bylaws.",
    "detail": "A North Carolina credit union may receive deposits from members and nonmembers in amounts and on terms its board of directors determines and its bylaws provide.",
    "evidence": "Chapter 54 (per search of ncleg.gov): 'A credit union may receive on deposit the savings of its members and also nonmembers in such amounts and upon such terms as the board of directors may determine and the bylaws shall provide.'",
    "url": "https://www.ncleg.gov/EnactedLegislation/Statutes/html/bychapter/chapter_54.html",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nc_payee_returned_check_fee",
    "state_code": "NC",
    "topic": "payee_returned_check",
    "name": "Payee processing fee for returned checks",
    "citation": "N.C. Gen. Stat. § 25-3-506",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "other",
    "coverage_note": "N.C. Gen. Stat. § 25-3-506 (ncleg.gov, heading 'Collection of processing fee for returned checks') lets a person who accepts a check for goods or services charge the fee, so it binds payees, not a bank's fee to its depositor.",
    "applies_to": [],
    "summary": "This payee rule lets a person accepting a check for goods or services charge up to $35 when the bank refuses it for insufficient funds.",
    "detail": "A person who accepts a check for goods or services may charge a processing fee of up to $35 when the payor bank refuses payment for insufficient funds or because the drawer has no account; this is a payee rule, not a bank fee rule.",
    "evidence": "G.S. 25-3-506: a person who accepts a check in payment for goods or services may charge and collect a processing fee, not to exceed thirty-five dollars ($35.00), for a check on which payment has been refused by the payor bank because of insufficient funds or because the drawer did not have an account at that bank.",
    "url": "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_25/GS_25-3-506.html",
    "figures": {
      "max_fee_amount": 35
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nd_cu_overdraft_policy_fee",
    "state_code": "ND",
    "topic": "overdraft_nsf",
    "name": "Credit union overdraft policy must set limits and any fee",
    "citation": "N.D. Admin. Code ch. 13-03-08",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [
      "overdraft"
    ],
    "summary": "A North Dakota credit union honoring overdrafts must cap totals and per-member amounts, allow at most 60 days to cure, and set any fee.",
    "detail": "A North Dakota credit union that honors overdrafts must cap the total dollar amount of overdrafts it will honor, give a member no more than 60 calendar days to deposit funds or obtain an approved loan to cover each overdraft, limit the overdraft amount honored per member, and set the fee, if any, it charges for honoring overdrafts. The rule sets no fee amount.",
    "evidence": "Search summary of the official chapter: credit unions must set a cap on the total dollar amount of all overdrafts they will honor, establish a time limit not to exceed sixty calendar days for a member either to deposit funds or obtain an approved loan to cover each overdraft, limit the dollar amount of overdrafts honored per member, and establish the fee, if any, charged for honoring overdrafts.",
    "url": "https://ndlegis.gov/information/acdata/pdf/13-03-08.pdf",
    "figures": {
      "max_cure_days": 60
    },
    "verification": "official_excerpt",
    "source_kind": "regulation"
  },
  {
    "id": "nd_unclaimed_dormancy_charge_conditions",
    "state_code": "ND",
    "topic": "dormancy",
    "name": "Dormancy charges deductible only under a written contract",
    "citation": "N.D.C.C. ch. 47-30.2 (Revised Uniform Unclaimed Property Act; section number not confirmed)",
    "date": "in force since 2021",
    "effective_date": "2021",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct a dormancy charge only under a written contract, if regularly imposed and not reversed, and only until abandonment.",
    "detail": "A holder may deduct a dormancy charge from property it turns over as unclaimed only if an enforceable written contract with the owner authorizes the charge for failure to claim the property within a set time and the holder regularly imposes and does not regularly reverse the charge; such charges may be imposed only until the property is deemed abandoned.",
    "evidence": "Search summary of the official chapter: \"A holder may deduct a dormancy charge ... if: (a) An enforceable written contract between the holder and the apparent owner authorizes imposition of the charge for the apparent owner's failure to claim the property within a specified time; and (b) The holder regularly imposes the charge and regularly does not reverse or otherwise cancel the charge.\" Charges may only be charged until the property is deemed abandoned.",
    "url": "https://ndlegis.gov/cencode/t47c30-2.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nd_garnishee_disclosure_fee",
    "state_code": "ND",
    "topic": "garnishment_legal_process",
    "name": "Garnishee disclosure fee paid by the creditor",
    "citation": "N.D.C.C. § 32-09.1-10",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "other",
    "coverage_note": "N.D.C.C. ch. 32-09.1 (ndlegis.gov) designates as garnishee whoever the summons is issued against, and § 32-09.1-10 makes the plaintiff tender the $40 fee, so it sets what a creditor pays any garnishee, not a bank's fee to its depositor.",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "In every garnishment the creditor must pay the garnishee, including a bank, $40 for its disclosure affidavit, not charged to the depositor.",
    "detail": "Applies to any garnishee, including a bank. In every garnishment, the plaintiff must tender $40 to the garnishee when the garnishee summons is served, as the fee for making the affidavit of disclosure; this fee is paid by the creditor, not charged to the depositor.",
    "evidence": "\"in all garnishment proceedings, the plaintiff, when the garnishee summons is served upon the garnishee, shall tender to the garnishee the sum of forty dollars as the fee for making an affidavit of disclosure.\" (Search summary; the same figure appears in 2025 bill 25-1262 and 2025 session laws, so the amount may have changed in 2025.)",
    "url": "https://ndlegis.gov/cencode/t32c09-1.pdf",
    "figures": {
      "fee_amount": 40
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nd_bank_national_bank_parity",
    "state_code": "ND",
    "topic": "fee_authority",
    "name": "State bank parity with national banks",
    "citation": "N.D.C.C. § 6-03-02.3",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "With State Banking Board authorization, a North Dakota state bank has national bank powers and may do anything a national bank could.",
    "detail": "Subject to authorization by the State Banking Board by order or rule, a North Dakota state bank has the same powers as a national bank and may engage in any activity it could engage in if nationally chartered.",
    "evidence": "Search summary of the official section: \"Subject to authorization by the state banking board, acting by order or rule, a state bank has the same powers as a national bank and may engage directly or indirectly in any activity in which a bank could engage if the state bank were nationally chartered.\"",
    "url": "https://ndlegis.gov/cencode/t06c03.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ne_unclaimed_property_dormancy_charge",
    "state_code": "NE",
    "topic": "dormancy",
    "name": "Dormancy charges on deposits require a written contract and may not increase during dormancy",
    "citation": "Neb. Rev. Stat. Uniform Disposition of Unclaimed Property Act, §§ 69-1301 to 69-1332 (dormancy charge rule likely § 69-1329; exact section not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may charge deposits for dormancy or stop interest only under a written contract and may not raise dormancy charges during dormancy.",
    "detail": "A holder of demand, savings or matured time deposits may not impose charges solely due to dormancy, or stop paying interest solely due to dormancy, unless a written contract with the owner allows reasonable charges or the cessation of interest; a holder that imposes dormancy charges may not increase them during the dormancy period. Deposits are presumed abandoned after five years without owner activity.",
    "evidence": "Neb. Rev. Stat. 69-1301 et seq. (nebraskalegislature.gov): 'A holder may not, with respect to property such as demand, savings, or matured time deposits, impose any charges solely due to dormancy or cease payment of interest solely due to dormancy unless there is a written contract between the holder and the owner ... pursuant to which the holder may impose reasonable charges'; a holder who imposes charges solely due to dormancy may not increase such charges during the period of dormancy.",
    "url": "https://nebraskalegislature.gov/laws/display_html.php?begin_section=69-1301&end_section=69-1332",
    "figures": {
      "abandonment_years": 5
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ne_special_deposit_overdraft_fee_debit",
    "state_code": "NE",
    "topic": "other",
    "name": "Special deposits: no setoff, but agreement may allow debiting overdraft fees",
    "citation": "Neb. Rev. Stat. Uniform Special Deposits Act (search pointed to § 8-3211; exact section not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "coverage_note": "The Nebraska Uniform Special Deposits Act (nebraskalegislature.gov, § 8-3202) defines 'financial institution' as a bank, savings bank, building and loan, S&L or credit union chartered by the United States, Nebraska or another state, plus similar federally insured organizations, trust companies and some digital asset depositories.",
    "applies_to": [
      "overdraft"
    ],
    "summary": "An account agreement may let a financial institution debit a special deposit for overdraft fees on that account, though setoff is otherwise barred.",
    "detail": "Except in stated circumstances, a financial institution may not exercise recoupment or setoff against a special deposit, but the account agreement may authorize it to debit the special deposit for fees relating to an overdraft in that special deposit account.",
    "evidence": "Per search of nebraskalegislature.gov: 'a financial institution may not exercise a right of recoupment or set off against a special deposit, but an account agreement may authorize the financial institution to debit the special deposit for fees assessed that relate to an overdraft in the special deposit account.'",
    "url": "https://www.nebraskalegislature.gov/laws/statutes.php?statute=8-3211&print=true",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ne_state_bank_wildcard",
    "state_code": "NE",
    "topic": "fee_authority",
    "name": "State bank wild-card parity with federally chartered banks",
    "citation": "Neb. Rev. Stat. § 8-1,140",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "Nebraska state banks have the same rights, powers, privileges and immunities as federally chartered banks doing business in Nebraska.",
    "detail": "Nebraska-chartered banks have the same rights, powers, privileges and immunities as federally chartered banks doing business in Nebraska; because of state constitutional limits on delegation, the statute is amended each year.",
    "evidence": "Committee statement (nebraskalegislature.gov): 'Section 8-1,140 of the Nebraska Banking Act is the \"wild-card\" statute for state-chartered banks ... provides state-chartered banks have the same rights, powers, privileges, and immunities as federally chartered banks doing business in Nebraska ... this statute is amended annually.'",
    "url": "https://www.nebraskalegislature.gov/FloorDocs/105/PDF/CS/LB812.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ne_credit_union_wildcard",
    "state_code": "NE",
    "topic": "fee_authority",
    "name": "Credit union wild-card parity with federal credit unions",
    "citation": "Neb. Rev. Stat. § 21-17,115",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "Nebraska credit unions have the same rights, powers, privileges and immunities as federally chartered credit unions doing business in Nebraska.",
    "detail": "Nebraska-chartered credit unions have the same rights, powers, privileges and immunities as federally chartered credit unions doing business in Nebraska.",
    "evidence": "Committee statement (nebraskalegislature.gov): 'Section 21-17,115 of the Nebraska Credit Union Act is the \"wildcard\" statute for state-chartered credit unions that provides state-chartered credit unions have the same rights, powers, privileges, and immunities as federally chartered credit unions doing business in Nebraska.'",
    "url": "https://ndbf.nebraska.gov/about/legal/credit-union-act",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nh_unclaimed_property_dormancy_charge",
    "state_code": "NH",
    "topic": "dormancy",
    "name": "Conditions on dormancy/inactivity charges",
    "citation": "RSA ch. 471-C (Custody and Escheat of Unclaimed and Abandoned Property); exact section not confirmed",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may charge for dormancy or stop interest only under a written contract, and for property over $2 may not regularly reverse charges.",
    "detail": "A holder may not impose a charge due to dormancy or inactivity, or stop paying interest, unless there is an enforceable written contract with the owner; for property over $2, the holder must also not regularly reverse or cancel such charges or retroactively credit interest. Bank deposits are presumed abandoned after 5 years without owner activity.",
    "evidence": "RSA 471-C (per search of gc.nh.gov): 'A holder may not impose any charge due to dormancy or inactivity or cease payment of interest unless there is an enforceable written contract between the holder and the owner'; for property in excess of $2, the holder must not regularly reverse or cancel such charges or retroactively credit interest; demand, savings or matured time deposits presumed abandoned unless the owner within 5 years has increased or decreased the balance.",
    "url": "https://gc.nh.gov/rsa/html/XLVI/471-C/471-C-mrg.htm",
    "figures": {
      "property_threshold_amount": 2,
      "abandonment_years": 5
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nh_trustee_process_account_fees",
    "state_code": "NH",
    "topic": "garnishment_legal_process",
    "name": "Bank trustee liability under trustee process net of account fees",
    "citation": "RSA ch. 512 (Trustee Process); exact section not confirmed; payroll account exemption in RSA 512:21",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "A bank served as trustee is chargeable only for funds held at service, less account fees owed it, and payroll accounts are exempt.",
    "detail": "A bank served as trustee is chargeable only for the defendant's funds it holds at the time of service, less reductions due the bank for account fees and other priority claims; service on a bank must be on an officer, branch supervisor or head teller between 8:00 a.m. and 3:00 p.m. on weekdays other than bank holidays. Money in an account designated as a payroll account is exempt from trustee process.",
    "evidence": "RSA ch. 512 (per search of gc.nh.gov): 'The trustee so served shall be chargeable only for any money ... of the defendant in the trustee's hands at the time of service, subject to any reductions due the trustee for account fees ...'; RSA 512:21: money deposited in any account designated as a payroll account is exempt.",
    "url": "https://gc.nh.gov/rsa/html/LII/512/512-mrg.htm",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nh_depository_bank_parity",
    "state_code": "NH",
    "topic": "fee_authority",
    "name": "Depository bank parity with national and federal savings banks",
    "citation": "RSA ch. 383-B (Depository Bank Act); exact section not confirmed",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "A New Hampshire depository bank may engage in any activity federal law permits for a national bank or federal savings bank.",
    "detail": "A New Hampshire depository bank may engage, directly or indirectly, in any activity permitted for a national bank or federal savings bank or their subsidiaries under federal law.",
    "evidence": "RSA 383-B (per search of gc.nh.gov): 'A depository bank may directly or indirectly engage in any activity permitted for a national bank or federal savings bank or their subsidiaries under federal laws'.",
    "url": "https://gc.nh.gov/rsa/html/xxxv/383-b/383-b-mrg.htm",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nh_credit_union_parity",
    "state_code": "NH",
    "topic": "fee_authority",
    "name": "Credit union parity with federal credit unions",
    "citation": "RSA ch. 383-E (Credit Union Act); exact section not confirmed",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "A New Hampshire credit union may exercise any power federal law, regulation or ruling grants federal credit unions.",
    "detail": "A New Hampshire credit union may exercise any power, right, benefit or privilege authorized now or later for federal credit unions by federal law, regulation or ruling; credit union deposits are subject to Article 4 of RSA 383-B.",
    "evidence": "RSA 383-E (per search of gc.nh.gov): 'A credit union shall have and may exercise any power, right, benefit or privilege, now or hereafter authorized for federal credit unions by federal legislation, regulation or ruling'; 'Deposits of a credit union shall be subject to Article 4 of RSA 383-B.'",
    "url": "https://gc.nh.gov/rsa/html/XXXV/383-E/383-E-mrg.htm",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nj_consumer_checking_account",
    "state_code": "NJ",
    "topic": "basic_account",
    "name": "New Jersey Consumer Checking Account (required low-cost account)",
    "citation": "N.J.S.A. 17:16N-1 et seq.; N.J.A.C. 3:1-19 (3:1-19.2 account criteria)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "monthly_maintenance",
      "minimum_balance"
    ],
    "summary": "Banks and credit unions must offer a Consumer Checking Account opening for $50 or less, with at most $1 minimum balance and $3 monthly fee.",
    "detail": "Banks, savings banks, savings and loan associations and credit unions that offer checking accounts and do business in New Jersey must offer a New Jersey Consumer Checking Account with an opening balance of $50 or less, a minimum balance requirement of no more than $1, unlimited deposits, and a monthly maintenance fee of no more than $3. Offices must post a lobby sign and make printed material available explaining the account.",
    "evidence": "NJ DOBI pages: 'New Jersey Statutes call for banks, savings banks, savings and loan associations and credit unions that offer checking accounts and are doing business in the State to offer the New Jersey Consumer Checking account... Monthly maintenance fees are limited to $3.00'; DOBI rule notice: 'Subchapter 19, consistent with N.J.S.A. 17:16N-1 et seq., requires depositories to offer consumer checking accounts'; opening balance $50 or less, minimum balance not more than $1, unlimited deposits.",
    "url": "https://www.nj.gov/dobi/division_consumers/finance/banktips.htm",
    "figures": {
      "max_opening_deposit": 50,
      "max_minimum_balance": 1,
      "max_monthly_maintenance_fee": 3
    },
    "verification": "official_excerpt",
    "source_kind": "regulation"
  },
  {
    "id": "nj_unclaimed_property_dormancy_charge",
    "state_code": "NJ",
    "topic": "dormancy",
    "name": "Conditions on dormancy/inactivity charges (Uniform Unclaimed Property Act)",
    "citation": "N.J.S.A. 46:30B-20",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may charge for dormancy only under a written contract, if regularly imposed and not reversed, and only if not unconscionable.",
    "detail": "A holder of bank deposits may not impose a charge due to dormancy or inactivity, or stop paying interest, unless there is an enforceable written contract with the owner, the holder regularly imposes the charge and does not regularly reverse or cancel it, and the amount of the charge is not unconscionable.",
    "evidence": "N.J.S.A. 46:30B-20 (as summarized on nj.gov treasury page): a holder may not impose any charge due to dormancy or inactivity or cease payment of interest unless there is an enforceable written contract between the holder and the owner, the holder regularly imposes the charges and does not regularly reverse or otherwise cancel them, and the amount of any charges is not unconscionable.",
    "url": "https://www.nj.gov/treasury/taxation/pdf/4630b.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nj_state_bank_parity",
    "state_code": "NJ",
    "topic": "fee_authority",
    "name": "State bank and savings bank parity with national/federal institutions",
    "citation": "N.J.S.A. 17:9A-24b.1 (as amended by P.L. 2000, c. 69); N.J.A.C. 3:6 (parity rules)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "New Jersey banks and savings banks may use national or federal savings bank powers on the same terms, but not to break criminal usury limits.",
    "detail": "New Jersey banks and savings banks may exercise the powers, rights, benefits or privileges authorized for national banks, federal savings banks or savings associations, on the same terms and conditions as those institutions; parity does not permit violating the state criminal code, including criminal usury limits.",
    "evidence": "DOBI rule text: 'N.J.S.A. 17:9A-24b.1 as amended by P.L. 2000, c. 69 provides that banks and savings banks may exercise those powers, rights, benefits or privileges now or hereafter authorized for national banks or for Federal savings banks or savings associations'; must be exercised 'upon the same terms and subject to the same conditions'.",
    "url": "https://nj.gov/dobi/proposed/ad031222.pdf",
    "verification": "official_excerpt",
    "source_kind": "regulation"
  },
  {
    "id": "nj_credit_union_parity",
    "state_code": "NJ",
    "topic": "fee_authority",
    "name": "Credit union parity with federal credit unions",
    "citation": "N.J.A.C. 3:21-2.1",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "New Jersey credit unions have parity with federal credit unions by rule, but cannot use it to avoid certain state consumer protections.",
    "detail": "A DOBI rule addresses parity of New Jersey credit unions with federal credit unions; certain state consumer protection requirements, such as criminal usury limits and predatory lending protections, cannot be avoided through parity.",
    "evidence": "DOBI notice: 'N.J.A.C. 3:21-2.1 addresses parity of New Jersey credit unions with Federal credit unions. Certain State statutory and regulatory consumer protection requirements may not be avoided through parity'.",
    "url": "https://www.nj.gov/dobi/pn02_072.htm",
    "verification": "official_excerpt",
    "source_kind": "regulation"
  },
  {
    "id": "nm_garnishment_deposit_account_exemption",
    "state_code": "NM",
    "topic": "garnishment_legal_process",
    "name": "Automatic $2,400 exemption in deposit accounts on garnishment",
    "citation": "NMSA 1978 garnishment exemption as amended in 2023 (SB 216); court forms NMRA 4-808 and Rule 3-802; exact statutory section not confirmed (search summary pointed to § 35-12-18)",
    "date": "in force since 2023-07-01",
    "effective_date": "2023-07-01",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "A garnished bank must leave an individual's first $2,400 in deposit and investment accounts, since the writ attaches only to money above it.",
    "detail": "When a garnishment writ is served on a bank or other depository institution, an individual or sole proprietor has $2,400 in deposit and investment accounts exempt, the writ attaches only to money above $2,400, and the writ must instruct the garnishee not to hold the exempt amount. For actions filed on or after July 1, 2023, the debtor does not have to assert this exemption; the search result did not show a rule on the bank's own processing fee.",
    "evidence": "NM courts forms/rules (nmcourts.gov): defendant who is an individual or sole proprietor 'has an exemption totaling $2,400 in depository and investment accounts, and the writ attaches only to money in excess of $2,400'; 'For actions filed on or after July 1, 2023, it is not necessary for a judgment debtor to assert an exemption to the first $2,400'; the financial institution may rely on the representations of the person executing the writ as to whether the exemption has already been satisfied at other institutions.",
    "url": "https://metro.nmcourts.gov/wp-content/uploads/sites/47/2026/01/Rule-4-808-CV-012-Notice-of-Right-to-Claim-Exemptions-Garnishment-12-31-25.pdf",
    "figures": {
      "protected_amount": 2400
    },
    "verification": "official_excerpt",
    "source_kind": "regulation"
  },
  {
    "id": "nm_state_bank_parity",
    "state_code": "NM",
    "topic": "fee_authority",
    "name": "Director may grant state banks national bank / federal institution powers",
    "citation": "NMSA 1978 § 58-1-54; implementing rules in 12.16 NMAC (e.g., 12.16.76 NMAC)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "The director may grant New Mexico state banks any power that national banks or federally chartered or insured institutions may exercise.",
    "detail": "The Financial Institutions Division director may grant New Mexico state banks any powers and authority that national banks or federally chartered or insured depository institutions are or may be allowed to exercise; implementing rules grant state banks the powers available to national banks, federal savings associations and federal credit unions under federal preemption.",
    "evidence": "NMAC parity rule: 'The director may grant to state banks any of the powers and authority that national banks or federally chartered or insured depository institutions are or may be authorized, empowered, permitted or otherwise allowed to exercise' (58-1-54).",
    "url": "https://www.srca.nm.gov/parts/title12/12.016.0076.html",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nm_credit_union_parity",
    "state_code": "NM",
    "topic": "fee_authority",
    "name": "Director may grant credit unions federal credit union powers",
    "citation": "NMSA 1978 § 58-11-20; implementing rules in 12.17 NMAC",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "The director may by regulation grant New Mexico credit unions the powers federal credit unions may exercise.",
    "detail": "Section 58-11-20 authorizes the director, by regulation, to grant New Mexico credit unions the powers and authority that federal credit unions may exercise under federal statutes, rules or regulations.",
    "evidence": "NMAC: 'Section 58-11-20 NMSA 1978 authorizes the director to grant by regulation the powers and authority that federal credit unions are authorized, empowered, permitted or otherwise allowed to exercise under federal statutes, rules or regulations.'",
    "url": "https://www.srca.nm.gov/parts/title12/12.017.0013.html",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nv_fee_disclosure_and_nsf_check_order",
    "state_code": "NV",
    "topic": "overdraft_nsf",
    "name": "Fees must be disclosed in advance; order for NSF fees on multiple checks in one day",
    "citation": "NRS 657.120",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "coverage_note": "NRS ch. 657 (leg.state.nv.us, as quoted in search) defines 'financial institution' as an institution licensed under NRS Title 55/56 or chapter 645B, or a similar institution chartered or licensed under federal law, so it reaches state and federal banks, thrifts and credit unions; the exact definition section number was not seen.",
    "applies_to": [
      "nsf",
      "overdraft"
    ],
    "summary": "A financial institution may charge only disclosed fees, and must figure NSF fees on same-day checks as if paid lowest number or smallest amount first.",
    "detail": "A financial institution (as defined for NRS chapter 657) may charge a fee for a service, within any amount a statute sets, only if the fee is clearly and conspicuously disclosed in writing before the customer receives the service. When several checks drawn by a customer are presented on one business day against an insufficient balance, the fee must be figured as if the checks were presented in the order written, from lowest to highest check number, or from smallest to largest amount.",
    "evidence": "NRS 657.120 'Fees and charges: Imposition and collection by financial institution; limitations': may impose a fee 'not to exceed an amount specified in or limited by specific statute ... if the fee or charge is clearly and conspicuously disclosed in writing to the customer before the customer receives the service'; multiple checks presented on a single business day with insufficient balance must be determined as if presented (a) in the order written; (b) lowest to highest check number; or (c) ascending amounts.",
    "url": "https://www.leg.state.nv.us/nrs/nrs-657.html",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nv_unclaimed_property_dormancy_charge",
    "state_code": "NV",
    "topic": "dormancy",
    "name": "Conditions and cap on dormancy charges deducted from presumed-abandoned property",
    "citation": "NRS 120A.540",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct a contract-authorized, regularly imposed dormancy charge from abandoned property, reportedly capped at $5 per month.",
    "detail": "A holder may deduct a dormancy charge from property presumed abandoned only if a valid, enforceable written contract with the owner allows it and the holder regularly imposes the charge without regularly reversing or canceling it; the search summary reports the deduction may not exceed $5 per month.",
    "evidence": "NRS 120A.540 (per search of leg.state.nv.us): a holder may deduct ... a charge imposed by reason of the owner's failure to claim the property within a specified time only if there is a valid and enforceable written contract ... and the holder regularly imposes the charge, which is not regularly reversed or otherwise cancelled; 'the amount of the deduction must not exceed $5 per month' (the $5 limit appeared in the search summary; reviewer should confirm it is in 120A.540 itself).",
    "url": "https://www.leg.state.nv.us/NRS/NRS-120A.html",
    "figures": {
      "max_fee_per_month": 5
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nv_bank_account_execution_exemption",
    "state_code": "NV",
    "topic": "garnishment_legal_process",
    "name": "Protected amount in a personal bank account under execution or garnishment",
    "citation": "NRS 21.105 (claim procedure NRS 21.112)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "On a levied personal account, $2,000 stays exempt if exempt money was deposited electronically within 45 days, otherwise $400, or the whole balance if less.",
    "detail": "When a writ of execution or garnishment is levied on a personal bank account, $2,000 (or the whole balance if less) stays exempt and accessible if identifiable exempt money was deposited electronically in the prior 45 days; otherwise $400 (or the whole balance if less) stays exempt, except for support debts. A bank that makes a reasonable effort to determine exempt money is immune from civil liability; the search result did not show a rule on the bank's own processing fee.",
    "evidence": "NRS 21.105: if money reasonably identifiable as exempt was deposited electronically within the immediately preceding 45 days, '$2,000 or the entire amount in the account, whichever is less, is not subject to execution and must remain accessible'; otherwise '$400 or the entire amount in the account, whichever is less'.",
    "url": "https://www.leg.state.nv.us/nrs/nrs-021.html",
    "figures": {
      "protected_amount_with_exempt_deposits": 2000,
      "lookback_days": 45,
      "protected_amount_otherwise": 400
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nv_bank_national_bank_parity",
    "state_code": "NV",
    "topic": "fee_authority",
    "name": "State bank parity with national banks",
    "citation": "NRS Chapter 662 (exact section not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "With the Commissioner's written approval, a Nevada bank may exercise any authority and perform any act a national bank may.",
    "detail": "With the Commissioner's consent and written approval, a Nevada bank may exercise any authority and perform any act a national bank may; the Commissioner may by regulation waive or modify a Nevada requirement when the matching national bank requirement is eliminated or modified.",
    "evidence": "NRS ch. 662: banks may 'exercise any authority and perform all acts that a national bank may exercise or perform ... with the consent and written approval of the Commissioner.'",
    "url": "https://www.leg.state.nv.us/nrs/NRS-662.html",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "nv_credit_union_federal_parity",
    "state_code": "NV",
    "topic": "fee_authority",
    "name": "Credit union parity with federal credit unions",
    "citation": "NRS Chapter 672 (exact section not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "With the Commissioner's written approval, a Nevada credit union may exercise any authority and perform any act a federal credit union may.",
    "detail": "With the Commissioner's consent and written approval, a Nevada credit union may exercise any authority and perform any act a federal credit union may; the Commissioner may by regulation waive or modify a Nevada requirement when the matching federal credit union requirement is eliminated or modified.",
    "evidence": "NRS ch. 672: credit unions 'may exercise any authority and perform all acts that a federal credit union may exercise or perform, with the consent and written approval of the Commissioner.'",
    "url": "https://www.leg.state.nv.us/nrs/NRS-672.html",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ny_basic_banking_account",
    "state_code": "NY",
    "topic": "basic_account",
    "name": "Basic banking account (Banking Law 14-f)",
    "citation": "N.Y. Banking Law § 14-f; 3 NYCRR Part 9 (Basic Banking Accounts)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks_and_credit_unions",
    "applies_to": [
      "monthly_maintenance",
      "minimum_balance"
    ],
    "summary": "A New York bank or credit union must offer a basic account with at most $3 monthly fee, $25 opening deposit and $0.01 minimum balance.",
    "detail": "New York-regulated banking institutions, including commercial banks, savings banks and credit unions, must offer a basic banking account (or a DFS-approved alternative) with a monthly maintenance charge of no more than $3.00, an opening deposit of no more than $25, and a minimum balance of no more than $0.01. The account must allow at least eight withdrawals a month at no extra charge for holders under 65 and at least 12 for holders 65 or older, with unlimited deposits.",
    "evidence": "DFS 'Basic Banking in New York State': law enacted in 1994, codified in Banking Law 14-f, requires all NYS-regulated banking institutions incl. commercial banks, savings banks and credit unions to offer low-fee accounts; 'The monthly charge for the maintenance of the account cannot be more than $3.00'; initial deposit not more than $25; minimum balance not more than $.01; at least eight withdrawals (under 65) / 12 (65+); requirements 'also reflected in Part 9 of the General Regulations of the Superintendent (3 NYCRR - Part 9)'. DFS has allowed Bank On certified accounts as an approved alternative (Industry Letter Apr. 15, 2022).",
    "url": "https://www.dfs.ny.gov/consumers_basic_banking",
    "figures": {
      "max_monthly_fee": 3.0,
      "max_opening_deposit": 25,
      "max_minimum_balance": 0.01,
      "free_withdrawals_under_65": 8,
      "free_withdrawals_65_plus": 12,
      "age_threshold": 65
    },
    "verification": "official_excerpt",
    "source_kind": "regulation"
  },
  {
    "id": "ny_9y_order_of_payment_and_od_charges",
    "state_code": "NY",
    "topic": "overdraft_nsf",
    "name": "Order of payment and DFS authority over insufficient-funds and returned-deposit charges (Banking Law 9-y)",
    "citation": "N.Y. Banking Law § 9-y, as amended by L. 2023, ch. 556 (A.5519)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks_and_credit_unions",
    "applies_to": [
      "overdraft",
      "nsf",
      "deposited_item_return"
    ],
    "summary": "A New York bank or credit union must pay consumer checks in order received or smallest first, disclose that order, and follow Superintendent charge rules.",
    "detail": "A banking organization that offers checking to consumer accounts must pay checks either in the order received or from smallest to largest each business day, must disclose that order in writing at account opening and before changing it, and the Superintendent may set by regulation the charges allowed for insufficient funds or uncollected balances and for deposited items that are dishonored and returned. A 2023 amendment (ch. 556, signed November 2023) extended these protections to paperless (electronic) transactions and directed DFS to write rules on how overdraft charges are imposed and how consumers are notified.",
    "evidence": "nysenate.gov 9-Y: banking organizations providing checking to consumer accounts must 'pay checks in the order wherein they are received or pay checks from smallest to largest dollar amount'; superintendent may prescribe regulations on 'charges that may be imposed in connection with insufficient funds or uncollected balances' and on checks 'received for deposit or collection drawn against a consumer account and subsequently dishonored and returned for any reason'; written disclosure of order 'at the time the account is opened and prior to any change'. NY Assembly (Hunter) release: A5519 signed November 2023 extends protections to paperless transactions and requires DFS rules. DFS 2026 Regulatory Agenda cites 'Chapter 556 of the Laws of New York of 2023' amending § 9-y.",
    "url": "https://www.nysenate.gov/legislation/laws/BNK/9-Y",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ny_dfs_overdraft_nsf_preproposal_2025",
    "state_code": "NY",
    "topic": "overdraft_nsf",
    "name": "DFS draft overdraft and NSF fee rules (3 NYCRR Parts 32 and 6), pre-proposal",
    "citation": "DFS pre-proposed amendments to 3 NYCRR Part 32 (Maximum Charges for Payments Made Against Insufficient Funds, Uncollected Balances and Return Items; Certain Disclosures) and Part 6, posted Jan. 22, 2025; DFS Industry Letter Sept. 5, 2025 (RFI); 2026 DFS Regulatory Agenda",
    "date": "proposed, not adopted",
    "effective_date": "unknown",
    "status": "proposed",
    "institutions": "state_banks_and_credit_unions",
    "applies_to": [
      "overdraft",
      "nsf",
      "od_daily_cap",
      "nsf_daily_cap",
      "continuous_od"
    ],
    "summary": "DFS draft rules, not formally proposed, would bar bank and credit union overdraft fees on overdrafts under $20 and over 3 such fees daily.",
    "detail": "In January 2025 DFS posted draft rules, for a pre-proposal comment period only (not yet a formal State Register proposal), that would bar overdraft fees on overdrafts under $20, overdraft fees larger than the overdrawn amount, more than three overdraft or NSF fees per account per day, NSF fees on instantly declined electronic transactions, repeat fees on the same (resubmitted) transaction, daily or sustained overdraft fees, and overdraft fees on electronic transactions authorized against a sufficient balance. After industry comments DFS issued a request for information in September 2025, and the amendment to Part 32 is listed on DFS's 2026 Regulatory Agenda (published January 28, 2026); no formal proposal or adoption was found.",
    "evidence": "DFS press release Jan. 22, 2025: proposed regulations would prohibit 'Charging overdraft fees on overdrafts of less than $20, and charging overdraft fees that exceed the overdrawn amount'; 'Charging more than three overdraft or non-sufficient funds (NSF) fees per consumer account per day'; NSF fees for instantaneously declined electronic transactions; multiple NSF/overdraft fees for the same transaction. DFS Industry Letter Sept. 5, 2025: DFS 'released draft regulations for a pre-proposal comment period'; commenters said it would be costly; DFS 'is now soliciting further information'. 2026 Regulatory Agenda lists amendment to 3 NYCRR Part 32 'in response to amendments to Banking Law § 9-y'.",
    "url": "https://www.dfs.ny.gov/reports_and_publications/press_releases/pr20250122",
    "figures": {
      "min_overdraft_amount_for_fee": 20,
      "max_od_nsf_fees_per_day": 3
    },
    "verification": "official_excerpt",
    "source_kind": "regulation"
  },
  {
    "id": "ny_cplr_5222j_no_fee_unlawful_restraint",
    "state_code": "NY",
    "topic": "garnishment_legal_process",
    "name": "No bank fee when a restraint is unlawful (CPLR 5222(j))",
    "citation": "N.Y. CPLR § 5222(j) (Exempt Income Protection Act, L. 2008, ch. 575)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "coverage_note": "CPLR 5205(n) (nysenate.gov, as quoted in search) defines 'banking institution' for article 52 as all banks, trust companies, savings banks, S&Ls, credit unions and foreign banking corporations chartered or licensed under New York law, foreign banks with a New York branch, and nationally chartered banks; federal thrifts and federal credit unions are not expressly named.",
    "applies_to": [
      "garnishment_levy",
      "legal_process"
    ],
    "summary": "A banking institution that cannot lawfully restrain a debtor's account, or restrains it unlawfully, may charge the debtor no fee whatever its agreement says.",
    "detail": "If a banking institution served with a restraining notice cannot lawfully restrain a judgment debtor's account, or a restraint is placed in violation of the CPLR, the institution may charge the debtor no fee, whatever its account agreement or fee schedule says. This reaches any 'banking institution' served with a New York restraining notice; CPLR 5205(n) defines that term to include banks, savings banks, S&Ls and credit unions chartered under New York law and nationally chartered banks.",
    "evidence": "Quoted in nycourts.gov opinions (e.g. Jackson v Bank of Am., 2017 NY Slip Op 02780): 'In the event that a banking institution served with a restraining notice cannot lawfully restrain a judgment debtor's banking institution account, or a restraint is placed on the judgment debtor's account in violation of any section of this chapter, the banking institution shall charge no fee to the judgment debtor regardless of any terms of agreement, or schedule of fees, or other contract between the judgment debtor and the banking institution.' Subdivision heading: 'Fee for banking institution's costs in processing a restraining notice for an account.'",
    "url": "https://www.nysenate.gov/legislation/laws/CVP/5222",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ny_cplr_exempt_funds_restraint",
    "state_code": "NY",
    "topic": "garnishment_legal_process",
    "name": "Exempt amounts a bank may not restrain (CPLR 5222(i), 5205(l), 5222-a)",
    "citation": "N.Y. CPLR §§ 5205(l), 5222(i), 5222-a",
    "date": "in force since 2024-04-01",
    "effective_date": "2024-04-01",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "coverage_note": "CPLR 5205(n) (nysenate.gov, as quoted in search) defines 'banking institution' for article 52 as all banks, trust companies, savings banks, S&Ls, credit unions and foreign banking corporations chartered or licensed under New York law, foreign banks with a New York branch, and nationally chartered banks; federal thrifts and federal credit unions are not expressly named.",
    "applies_to": [
      "garnishment_levy",
      "legal_process"
    ],
    "summary": "A banking institution may not restrain the exempt amount, set at $3,425, if exempt payments were direct-deposited within 45 days before a restraining notice.",
    "detail": "If statutorily exempt payments (such as Social Security, SSI, public assistance, veterans' benefits, unemployment, pensions or child support) were direct-deposited into the account in the 45 days before a restraining notice, the bank may not restrain the CPLR 5205(l) amount, which DFS set at $3,425 from April 1, 2024 (next adjustment April 1, 2027). Otherwise a restraining notice does not apply to an amount up to 240 times the greater of the federal or New York State minimum hourly wage.",
    "evidence": "DFS 'Amount Exempt from Judgments': new exemption amount $3,425 effective April 1, 2024, not applicable to restraining notices served before that date; prior amounts $2,500 (2009) ... $3,000 (2021); adjustments every three years. CPLR 5222(i) quoted by DFS: restraining notice 'shall not apply to an amount equal to or less than the greater of two hundred forty times the federal minimum hourly wage ... or two hundred forty times the state minimum hourly wage'. nycourts.gov: if exempt direct deposits were made 'during the forty-five day period preceding the restraining notice', the bank 'shall not restrain' the protected amount. 'Banking institution' definition not checked.",
    "url": "https://www.dfs.ny.gov/industry_guidance/exemption_from_judgments",
    "figures": {
      "exempt_amount_2024": 3425,
      "lookback_days": 45,
      "min_wage_multiplier": 240
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ny_abp_1415_no_service_charges",
    "state_code": "NY",
    "topic": "dormancy",
    "name": "Limits on service charges against abandoned property (Abandoned Property Law 1415)",
    "citation": "N.Y. Abandoned Property Law § 1415",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may not deduct service or maintenance charges from abandoned property unless New York law or a valid nonrefundable-deduction contract allows it.",
    "detail": "A holder of property subject to the Abandoned Property Law may not deduct service, handling or maintenance charges from it unless the deduction is allowed by New York law (including DFS regulations) or by a valid contract that specifically says the deduction will not be refunded or restored to the owner.",
    "evidence": "ABP § 1415: 'No deduction shall be made for service, handling or maintenance charges from property subject to the abandoned property law, by the holder of such property, unless such deduction is made pursuant to: (a) the laws of the state of New York including therein the regulations of the New York state department of financial services; or (b) a valid contract which provides, specifically, that the deduction shall not be refundable or otherwise restored to the owner.'",
    "url": "https://www.nysenate.gov/legislation/laws/ABP/1415",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ny_banking_law_12a_wild_card",
    "state_code": "NY",
    "topic": "fee_authority",
    "name": "Wild card: state institutions may exercise federal counterpart powers",
    "citation": "N.Y. Banking Law § 12-a",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks_and_credit_unions",
    "applies_to": [],
    "summary": "The Superintendent may let a state-chartered bank or credit union exercise federal counterpart powers the Banking Law does not expressly grant.",
    "detail": "The Superintendent of Financial Services may permit state-chartered banking institutions, including credit unions, to exercise powers available to their federally chartered counterparts (national banks, federal savings associations, federal credit unions) that the Banking Law does not expressly grant. It is a general powers provision, not a deposit-fee rule.",
    "evidence": "dfs.ny.gov 'Wild Card Activities' and Industry Letter Oct. 22, 2007: 'Under the \"wild card\" law (Section 12-a of the Banking Law), the Superintendent of Financial Services is authorized to permit state-chartered banking organizations to exercise banking powers that are available to corresponding federally-chartered institutions, but which are not expressly authorized under the Banking Law'; including allowing 'a credit union to exercise any federally permitted power of a federal credit union.'",
    "url": "https://www.dfs.ny.gov/industry_guidance/wild_card_activities",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "oh_unclaimed_dormancy_charge_conditions",
    "state_code": "OH",
    "topic": "dormancy",
    "name": "Conditions on charges deducted from unclaimed funds",
    "citation": "Ohio Adm. Code 1301:10-3-07 (under R.C. Chapter 169)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct a dormancy charge from unclaimed funds only under a contract or proper disclosure, if regularly imposed, not reversed, and not unconscionable.",
    "detail": "A holder may deduct from unclaimed funds a charge imposed because the owner failed to claim the property within a set time only if a valid written contract imposes it or, for a financial organization, the charge was properly disclosed, is regularly imposed, is not regularly reversed, and is not unconscionable or otherwise prohibited by law. No holder may impose a charge to avoid or contravene the reporting requirements of R.C. 169.02 and 169.03.",
    "evidence": "Search result from codes.ohio.gov: 'a holder may deduct from unclaimed funds ... a charge imposed due to the owner's failure to claim the property within a specified time only if a valid and enforceable written contract ... or a holder that is a financial organization properly discloses the charge ... the holder regularly imposes the charge, the charge is not regularly reversed or otherwise canceled, and the amount deducted is not unconscionable or otherwise prohibited by law ... no holder may impose a charge to avoid or contravene the reporting requirements of sections 169.02 and 169.03'",
    "url": "https://codes.ohio.gov/ohio-administrative-code/rule-1301:10-3-07",
    "verification": "official_excerpt",
    "source_kind": "regulation"
  },
  {
    "id": "oh_garnishee_fee_nonearnings",
    "state_code": "OH",
    "topic": "garnishment_legal_process",
    "name": "Garnishee's fee for garnishment of property other than earnings",
    "citation": "Ohio Rev. Code § 2716.12",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "other",
    "coverage_note": "Ohio Rev. Code § 2716.12 (codes.ohio.gov) makes the creditor's affidavit carry $1 as 'the garnishee's fee' in any non-earnings garnishment, so it sets what a creditor pays any garnishee, not a bank's fee to its depositor; the chapter's definition of garnishee was not seen.",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "A creditor garnishing non-wage property such as a deposit account must pay the garnishee, such as a bank, a $1 compliance fee.",
    "detail": "In a garnishment of property other than personal earnings (which includes deposit accounts), the creditor's affidavit must be accompanied by one dollar as the garnishee's fee for complying with the order. The statute sets the fee paid to the garnishee (e.g., a bank) by the creditor; it does not itself address fees a bank charges its own customer.",
    "evidence": "codes.ohio.gov search result: 'The affidavit required by section 2716.11 ... in a proceeding for garnishment of property, other than personal earnings, shall be accompanied by one dollar as the garnishee's fee for compliance with the order, no part of which shall be charged as court costs.'",
    "url": "https://codes.ohio.gov/ohio-revised-code/section-2716.12",
    "figures": {
      "garnishee_fee": 1
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "oh_state_bank_national_parity",
    "state_code": "OH",
    "topic": "fee_authority",
    "name": "State bank parity with national banks and federal savings associations",
    "citation": "Ohio Rev. Code § 1109.02",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "An Ohio state bank may exercise national bank and federal savings association powers except on interest rates, and the superintendent may object within 90 days.",
    "detail": "An Ohio state bank may exercise all powers, perform all acts and provide all services permitted for national banks and federal savings associations (other than those dealing with interest rates), subject to prior written notice to the superintendent if no parity rule has yet been adopted; the superintendent may prohibit the action within 90 days as unsafe or unsound.",
    "evidence": "codes.ohio.gov search result: 'a state bank has and may exercise all powers, perform all acts, and provide all services that are permitted for national banks and federal savings associations, other than those dealing with interest rates ... the superintendent, within ninety days after receipt of that notice, may prohibit ...'",
    "url": "https://codes.ohio.gov/ohio-revised-code/section-1109.02",
    "figures": {
      "superintendent_review_days": 90
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ok_unclaimed_dormancy_charge_notice",
    "state_code": "OK",
    "topic": "dormancy",
    "name": "Notice condition on dormancy or inactivity charges on deposit accounts",
    "citation": "Okla. Stat. tit. 60, § 652 (Uniform Unclaimed Property Act)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may charge a deposit account for dormancy only after reasonable notice, and must reverse unclaimed property charges if it routinely reverses them elsewhere.",
    "detail": "A holder may not impose a charge on a deposit account due to dormancy or inactivity, or stop paying interest, unless the owner received reasonable notice that it may do so, at account opening, through a schedule of charges sent to the owner, or in the holder's rules or bylaws. If the holder regularly reverses such charges on other deposits (other than for its own error), it must likewise reverse them on property reported as unclaimed.",
    "evidence": "Search results from oksenate.gov Title 60 compilation and oklegislature.gov SB 853 (2007): 'A holder may not impose with respect to property described in [deposit accounts] any charge due to dormancy or inactivity or cease payment of interest unless reasonable notice that the holder may impose the charge or cease payment of interest is given to the owner ... either at the time the account is opened, through a schedule of charges sent to the owner ..., or through a statement in the rules, regulations, or bylaws of the holder ...' SB 853 identifies the section as 60 O.S. 2001, Section 652.",
    "url": "https://oksenate.gov/sites/default/files/2019-12/os60.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ok_state_bank_national_parity",
    "state_code": "OK",
    "topic": "fee_authority",
    "name": "State bank parity with national banks",
    "citation": "Okla. Stat. tit. 6 (Banking Code; bank powers provision; exact section number not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "An Oklahoma bank may exercise national bank powers unless the Legislature provides otherwise or the Banking Board restricts them by rule.",
    "detail": "An Oklahoma-chartered bank may exercise any of the powers of a national bank doing business in Oklahoma until the Legislature provides otherwise, and the Banking Board may by rule prohibit or restrict any such power; the Board may also grant state banks powers conferred on national banks.",
    "evidence": "Search result from oksenate.gov Title 6 compilation: a bank chartered under Oklahoma law 'may exercise any of the powers of a national bank doing business in this state, until otherwise provided by the Legislature; and provided that the Board may by rule prohibit or restrict the exercise of any such power ...'",
    "url": "https://oksenate.gov/sites/default/files/2019-12/os6.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "or_unclaimed_dormancy_charge_conditions",
    "state_code": "OR",
    "topic": "dormancy",
    "name": "Conditions and 3-month notice before dormancy service charges",
    "citation": "Or. Rev. Stat. § 98.311 (Unclaimed property; section number per search result, see notes)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may charge a deposit account for dormancy only under a written contract, applied uniformly, with mailed notice at least 3 months ahead.",
    "detail": "A holder may not impose a service charge or stop paying interest on a deposit account due to dormancy or inactivity unless a written contract clearly sets out the conditions, the charge is applied uniformly to all dormant or inactive accounts, and the owner gets written notice by first-class mail to the last-known address at least three months before the charge is applied.",
    "evidence": "Search result from oregonlegislature.gov ORS ch. 98: 'a holder may not deduct a service charge or fee or otherwise reduce an owner's unclaimed account unless there is a valid written contract ... the service charge or fee is imposed uniformly on all accounts, and three months' written notice is given by first class mail to the last-known address of the owner of a dormant or inactive account before the holder applies a service charge to that account or stops paying interest on that account.'",
    "url": "https://www.oregonlegislature.gov/bills_laws/ors/ors098.html",
    "figures": {
      "advance_notice_months": 3
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "or_garnishment_search_fee",
    "state_code": "OR",
    "topic": "garnishment_legal_process",
    "name": "Financial institution garnishment search fee paid by garnishor",
    "citation": "Or. Rev. Stat. § 18.790",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "A garnishor must pay a financial institution a $15 search fee per debtor, or $10 if the garnishor is the Department of Revenue.",
    "detail": "When a writ of garnishment is delivered to a financial institution, the garnishor must pay the institution a search fee of $15 ($10 if the garnishor is the Department of Revenue), with a separate fee for each debtor named.",
    "evidence": "oregonlegislature.gov search result: 'a search fee of $10 must be paid if the garnishor is the Department of Revenue, or $15 must be paid if the garnishor is a person other than the department. A separate search fee must be paid for each debtor ...'",
    "url": "https://www.oregonlegislature.gov/bills_laws/ors/ors018.html",
    "figures": {
      "search_fee": 15,
      "search_fee_department_of_revenue": 10
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "or_garnishment_processing_fee_limits",
    "state_code": "OR",
    "topic": "garnishment_legal_process",
    "name": "Limits on the bank's garnishment processing fee charged to the debtor",
    "citation": "Or. Rev. Stat. § 18.790",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "A financial institution may deduct a garnishment processing fee from the debtor, but not when nothing is garnishable or from protected amounts.",
    "detail": "A financial institution may charge the debtor a garnishment processing fee by deducting it from amounts it owes the debtor, but may not charge it if none of the debtor's property it holds is subject to garnishment and, where a garnishment account review is required, may not take the fee from amounts not subject to garnishment or from amounts in the account after the review date. The search results did not show a dollar cap for the financial institution processing fee.",
    "evidence": "oregonlegislature.gov search results: 'A financial institution may not charge or collect a garnishment processing fee if none of the debtor's property held by the financial institution is subject to garnishment ... may not charge or collect a processing fee against any amount that is not subject to garnishment, and may not charge or collect a garnishment processing fee against any amounts in the account after the date that it conducts the review.'",
    "url": "https://www.oregonlegislature.gov/bills_laws/ors/ors018.html",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "or_garnishment_protected_balance",
    "state_code": "OR",
    "topic": "garnishment_legal_process",
    "name": "Garnishment account review and protected account balance",
    "citation": "Or. Rev. Stat. § 18.784 to 18.785 as amended by SB 1595 (Or. Laws 2024, ch. 100)",
    "date": "in force since 2024-04-04",
    "effective_date": "2024-04-04",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "A garnished financial institution must review for benefit deposits and leave the debtor a protected balance, initially $2,500 and later indexed to $2,600.",
    "detail": "On receiving a writ of garnishment, a financial institution must review the debtor's accounts once for deposited benefit payments, and SB 1595 adds a base protected account balance of $2,500 across all the debtor's accounts that stays available to the debtor; the State Court Administrator indexes the amount each July 1 (its published table shows $2,600 from July 1, 2026).",
    "evidence": "olis/oregonlegislature.gov SB 1595: 'The initial base protected account balance is the combined total of $2,500 in all of a debtor's accounts in the financial institution'; courts.oregon.gov adjustments table: $2,500 through June 30, 2026, $2,600 effective July 1, 2026. Effective date April 4, 2024 per search summary (operative date for the account balance provision not separately confirmed).",
    "url": "https://www.oregonlegislature.gov/bills_laws/lawsstatutes/2024orLaw0100.pdf",
    "figures": {
      "base_protected_balance_initial": 2500,
      "base_protected_balance_from_2026_07_01": 2600
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "or_cu_federal_parity",
    "state_code": "OR",
    "topic": "fee_authority",
    "name": "Credit union parity with federal credit unions",
    "citation": "Or. Rev. Stat. ch. 723 (credit union powers; exact section not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "An Oregon credit union may exercise federal credit union powers after 45 days' written notice to the Director, and later powers with approval.",
    "detail": "An Oregon credit union may exercise any power available to a federal credit union as of January 1, 2022 after giving the Director of the Department of Consumer and Business Services 45 days' written notice, and may exercise later-conferred federal credit union powers with the director's approval.",
    "evidence": "oregonlegislature.gov ORS 723 search result: 'A credit union may exercise any of the powers that were available to a federal credit union as of January 1, 2022. At least 45 days before exercising a power, a credit union shall provide written notice to the Director ...'",
    "url": "https://www.oregonlegislature.gov/bills_laws/ors/ors723.html",
    "figures": {
      "notice_days": 45
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "or_bank_national_parity",
    "state_code": "OR",
    "topic": "fee_authority",
    "name": "Commercial bank activity parity with national banks",
    "citation": "Or. Rev. Stat. ch. 708A (exact section not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "Oregon commercial banks may engage in national bank activities under the same conditions and restrictions that apply to national banks.",
    "detail": "Oregon commercial banks may engage, as principal or agent, in activities in which national banks may engage, subject to the conditions and restrictions that apply to national banks.",
    "evidence": "oregonlegislature.gov ORS 708A search result: 'Oregon commercial banks may engage as principal or agent in activities in which national banks may engage ... subject to conditions and restrictions that apply to national banks.'",
    "url": "https://www.oregonlegislature.gov/bills_laws/ors/ors708a.html",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "pa_unclaimed_inactivity_charge_contract",
    "state_code": "PA",
    "topic": "dormancy",
    "name": "Inactivity charges on presumed-abandoned deposits require a written contract",
    "citation": "72 P.S. § 1301.3 (Disposition of Abandoned and Unclaimed Property, Fiscal Code Art. XIII.1)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A financial institution may not exclude inactivity charges imposed after 1981 from a presumed-abandoned deposit unless a written contract allows them.",
    "detail": "When a financial institution computes a presumed-abandoned deposit, it may not exclude any charge due to inactivity imposed after December 31, 1981 unless a valid and enforceable written contract with the owner allows that charge.",
    "evidence": "\"The charges which may be excluded hereunder shall not include any charge due to inactivity imposed, directly or indirectly, after December 31, 1981 unless there is a valid and enforceable written contract between the financial institution and the owner of the deposit pursuant to which the financial institution may impose said charge.\" (Treasury's compiled text of the Act)",
    "url": "https://www.patreasury.gov/pdf/unclaimed-property/UnclaimedProperty-Law.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "pa_garnishment_no_fee_on_exempt_funds",
    "state_code": "PA",
    "topic": "garnishment_legal_process",
    "name": "Garnishee bank may not assess fees against exempt funds",
    "citation": "Pa.R.C.P. 3111.1 (231 Pa. Code Rule 3111.1)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy",
      "legal_process"
    ],
    "summary": "Recurring electronic exempt deposits are protected from attachment up to $10,000 per account, and the garnishee may not charge fees against exempt funds.",
    "detail": "Funds deposited electronically on a recurring basis and identified as exempt under state or federal law are protected from attachment up to $10,000 per account (all of the account if every deposit is such exempt funds), and where funds are not attached because of the rule the garnishee may not assess any fee against exempt funds in any account it holds.",
    "evidence": "Rule protects the first $10,000 of each account containing funds deposited electronically on a recurring basis and identified as exempt; \"the garnishee shall not assess any fee against exempt funds contained in any account held by the garnishee.\"",
    "url": "https://www.pacodeandbulletin.gov/Display/pacode?file=%2Fsecure%2Fpacode%2Fdata%2F231%2Fchapter3000%2Fs3111.1.html",
    "figures": {
      "protected_amount": 10000
    },
    "verification": "official_excerpt",
    "source_kind": "court_rule"
  },
  {
    "id": "pa_cu_federal_parity",
    "state_code": "PA",
    "topic": "fee_authority",
    "name": "Credit union parity with federal credit unions",
    "citation": "17 Pa.C.S. (Credit Union Code), Chapter 5 powers provision (exact section not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "A Pennsylvania credit union may engage in any activity permitted for federal credit unions, subject to Department of Banking and Securities conditions.",
    "detail": "A Pennsylvania credit union may engage in any activity permissible for a federal credit union under the Federal Credit Union Act and NCUA rules, subject to conditions the Department of Banking and Securities may impose.",
    "evidence": "\"a credit union shall have the power to engage in any activity permissible for a Federal credit union as authorized by the Federal Credit Union Act and the rules and regulations of the National Credit Union Administration, subject to reasonable conditions, limitations and restrictions as may be imposed by the department.\"",
    "url": "https://www.legis.state.pa.us/WU01/LI/LI/CT/HTM/17/00.005..HTM",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "pa_bank_deposit_terms_by_agreement",
    "state_code": "PA",
    "topic": "fee_authority",
    "name": "Bank deposit terms set by institution rules or agreement",
    "citation": "Banking Code of 1965, Act of Nov. 30, 1965, P.L. 847, No. 356, Chapter 3 (exact section not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "A Pennsylvania institution may set deposit withdrawal and interest terms by its own rules or depositor agreement, without naming deposit fees.",
    "detail": "A Pennsylvania institution may receive deposits and set the terms of withdrawal and interest by its own rules or by agreement with the depositor; the text seen does not name deposit fees specifically.",
    "evidence": "\"An institution may receive money for deposit and may provide by rules of the institution or by agreement with the depositor for the terms of withdrawal thereof and for payment of interest thereon...\"",
    "url": "https://www.palegis.us/statutes/unconsolidated/law-information/view-statute?iFrame=true&txtType=HTM&yr=1965&sessInd=0&smthLwInd=0&act=356&chpt=3",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "pa_payee_bad_check_service_charge",
    "state_code": "PA",
    "topic": "payee_returned_check",
    "name": "Payee service charge for a bad check",
    "citation": "18 Pa.C.S. § 4105",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "other",
    "coverage_note": "Definition not seen; coded from the statute's text as summarized: 18 Pa.C.S. § 4105 caps the service charge a payee may impose for a bad check, so it binds payees, not a bank's fee to its depositor.",
    "applies_to": [],
    "summary": "This payee rule caps a payee's bad check service charge at $50, unless bank fees charged to the payee exceeded $50.",
    "detail": "Payee rule, not a bank fee rule: the service charge a payee may impose for a bad check is capped at $50, unless financial institutions charged the payee more than $50 because of the check, in which case it may not exceed those actual fees.",
    "evidence": "Search summary of the official section: service charges for bad checks at a maximum of $50 unless the payee is charged fees over $50 by financial institutions, then not exceeding the actual amount.",
    "url": "https://www.legis.state.pa.us/WU01/LI/LI/CT/HTM/18/00.041.005.000..HTM",
    "figures": {
      "max_fee_amount": 50
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "pr_unclaimed_money_no_service_charges",
    "state_code": "PR",
    "topic": "dormancy",
    "name": "No service charges on unclaimed or abandoned money",
    "citation": "Ley Núm. 36 de 28 de julio de 1989, según enmendada (Ley de Dinero y Otros Bienes Líquidos Abandonados o No Reclamados); article not confirmed",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "Money unclaimed for 5 years is presumed abandoned, and no financial institution may impose service charges on unclaimed money before or after that.",
    "detail": "Money held by a financial institution is presumed abandoned after five years in which the owner shows no interest, and a financial institution or holder may not impose service charges on unclaimed money or liquid assets, either before or after they are declared unclaimed.",
    "evidence": "Search summary drawn from bvirtualogp.pr.gov (Ley 36-1989) and ocif.pr.gov/cuentasinactivas: presumed abandoned if within the previous five years the owner has not shown interest; it is illegal for a financial institution or holder to impose service charges on unclaimed money or liquid assets before or after being declared as such. Exact Spanish text not seen (OCIF page egress-blocked).",
    "url": "https://bvirtualogp.pr.gov/ogp/Bvirtual/leyesreferencia/PDF/36-1989.pdf",
    "figures": {
      "dormancy_years": 5
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "pr_banks_no_charges_inactive_savings",
    "state_code": "PR",
    "topic": "dormancy",
    "name": "Banks may not charge inactive savings accounts",
    "citation": "Ley de Bancos, Ley Núm. 55 de 12 de mayo de 1933, según enmendada; article not confirmed",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A bank in Puerto Rico may not charge inactive savings accounts and must report yearly balances over $1 left unclaimed for 5 years.",
    "detail": "A bank or foreign bank in Puerto Rico may not impose service charges on inactive savings accounts or otherwise remove them from its books, and must report to the Commissioner by August 10 each year unclaimed amounts over $1 that have gone unclaimed for the previous five years.",
    "evidence": "Search summary of the OGP compiled Ley de Bancos (rev. May 10, 2025): illegal for a bank or foreign bank to impose service charges on inactive savings accounts or to eliminate them from the books in any other manner; annual report by August 10 of amounts greater than $1 unclaimed for the previous five years.",
    "url": "https://bvirtualogp.pr.gov/ogp/Bvirtual/leyesreferencia/PDF/55-1933.pdf",
    "figures": {
      "report_threshold_amount": 1,
      "dormancy_years": 5
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ri_unclaimed_dormancy_charge_conditions",
    "state_code": "RI",
    "topic": "dormancy",
    "name": "Conditions on dormancy or inactivity charges on deposit accounts",
    "citation": "R.I. Gen. Laws § 33-21.1-6",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may charge for dormancy only under a written contract, regularly imposed, with notice within 3 months beforehand for property over $2.",
    "detail": "A holder may not impose a dormancy or inactivity charge on a deposit account (or stop paying interest) unless there is an enforceable written contract with the owner, the holder gave written notice no more than three months before the first charge for property over $2, and the holder regularly imposes and does not regularly reverse such charges. Demand and savings deposits are presumed abandoned after three years without owner activity or contact.",
    "evidence": "Search summary of the official section: a holder may not impose any charge due to dormancy or inactivity ... unless (1) an enforceable written contract, (2) for property in excess of two dollars, written notice to the owner no more than three months before the initial imposition, and (3) the holder regularly imposes the charges and does not regularly reverse or otherwise cancel them.",
    "url": "https://webserver.rilegislature.gov/Statutes/TITLE33/33-21.1/33-21.1-6.htm",
    "figures": {
      "notice_threshold_amount": 2,
      "notice_window_months": 3,
      "dormancy_years": 3
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "sc_unclaimed_dormancy_charge_limit",
    "state_code": "SC",
    "topic": "dormancy",
    "name": "Dormancy charges over $1 a month need a written contract",
    "citation": "S.C. Code § 27-18-70 (Uniform Unclaimed Property Act)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may not charge deposits more than $1 a month for dormancy, or stop paying interest, unless a written contract allows it.",
    "detail": "For demand, savings and matured time deposits, a holder may not impose a dormancy or inactivity charge of more than $1 a month, or stop paying interest, unless an enforceable written contract with the owner allows it.",
    "evidence": "\"A holder may not impose with respect to property described in this section any charge in excess of one dollar a month due to dormancy or inactivity or cease payment of interest unless there is an enforceable written contract between the holder and the owner of the property pursuant to which the holder may impose a charge or cease payment of interest.\"",
    "url": "https://www.scstatehouse.gov/code/t27c018.php",
    "figures": {
      "max_monthly_charge_without_contract": 1
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "sc_bank_national_bank_parity",
    "state_code": "SC",
    "topic": "fee_authority",
    "name": "State bank parity with national banks",
    "citation": "S.C. Code Title 34, Chapter 1 (exact section not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "South Carolina state banks may engage in activities that federal law or OCC regulation authorizes for national banks.",
    "detail": "In addition to the powers in Chapters 1 through 31 of Title 34, South Carolina state-chartered banks may engage in activities authorized for national banks by federal law or OCC regulation; the text seen does not mention fees specifically.",
    "evidence": "Search summary of the official chapter: \"Notwithstanding any other provision of law and in addition to all of the powers granted under Chapters 1 through 31, Title 34, state-chartered banks are permitted to engage in activities authorized for national banks by federal law or regulation of the Comptroller of the Currency.\" Any conditions (e.g., board approval) not checked.",
    "url": "https://www.scstatehouse.gov/code/t34c001.php",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "sc_cu_federal_parity",
    "state_code": "SC",
    "topic": "fee_authority",
    "name": "Credit union powers tied to federal credit unions",
    "citation": "S.C. Code Title 34, Chapter 26 (South Carolina Credit Union Act; exact section not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "A South Carolina credit union's powers may not exceed federal credit unions', and the State Board may authorize federally approved activities.",
    "detail": "A state-chartered credit union's powers may not exceed those federal law gives federal credit unions, and the State Board of Financial Institutions may, by operational instructions, authorize state credit unions to engage in activities approved for federal credit unions.",
    "evidence": "Search summary of the official chapter: powers granted to a state-chartered credit union \"shall not exceed those provided by federal law to a federally chartered credit union\"; the board may by operational instructions authorize activities approved for federally-chartered credit unions.",
    "url": "https://www.scstatehouse.gov/code/t34c026.php",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "sc_payee_returned_check_fee",
    "state_code": "SC",
    "topic": "payee_returned_check",
    "name": "Payee processing fee and service charge for returned checks",
    "citation": "S.C. Code §§ 34-11-65, 34-11-70",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "other",
    "coverage_note": "Definition not seen; coded from the statute's text as summarized: S.C. Code §§ 34-11-65 and 34-11-70 let a person who accepts a check collect the fee from the drawer, so they bind payees, not a bank's fee to its depositor.",
    "applies_to": [],
    "summary": "This payee rule lets a person accepting a check charge up to $25 when the bank refuses it for insufficient funds or no account.",
    "detail": "Payee rule, not a bank fee rule: a person who accepts a check may collect a processing fee of up to $25 when the payor bank refuses it for insufficient funds or no account, and a drawer of an NSF check must pay the amount plus a $25 service charge within 10 days of written notice by certified mail.",
    "evidence": "Search summary of official Chapter 11: processing fee \"not to exceed twenty-five dollars\" (34-11-65); service charge of twenty-five dollars within ten days after written notice sent by certified mail (34-11-70).",
    "url": "https://www.scstatehouse.gov/code/t34c011.php",
    "figures": {
      "max_fee_amount": 25,
      "notice_days": 10
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "sd_unclaimed_dormancy_charge_contract",
    "state_code": "SD",
    "topic": "dormancy",
    "name": "Dormancy charges on deposits need a written contract",
    "citation": "SDCL § 43-41B-6(c) (as amended by 2002 S.D. Sess. Laws ch. 200)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may not charge a deposit account for dormancy or stop paying interest unless a written contract with the owner allows it.",
    "detail": "For deposit accounts covered by the unclaimed property act, a holder may not impose a charge due to dormancy or inactivity, or stop paying interest, unless an enforceable written contract with the owner allows it (further conditions in the subsection were not seen).",
    "evidence": "\"A holder may not impose with respect to property described in subsection (a) any charge due to dormancy or inactivity or cease payment of interest unless: (1) There is an enforceable written contract between the holder and the owner of the property pursuant to which the holder may impose a charge or cease payment of interest...\" (2002 session law text; later amendments, e.g. 2024 HB 1118 on unclaimed property, not checked).",
    "url": "https://mylrc.sdlegislature.gov/api/Documents/95203.html?Year=2002",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "sd_bank_federal_parity",
    "state_code": "SD",
    "topic": "fee_authority",
    "name": "State bank parity with federally chartered banks",
    "citation": "SDCL § 51A-2-14.1",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "South Dakota state banks have federal bank powers as of 2008 and may use later ones only by the Director's declaratory ruling.",
    "detail": "South Dakota state banks have the powers federally chartered banks doing business in the state had as of January 1, 2008, and may use later federal powers only after the Director of Banking finds the conditions met and issues a declaratory ruling.",
    "evidence": "Search summary of sdlegislature.gov Title 51A and the Division of Banking 'state charter advantages' document: state banks have the powers conferred as of January 1, 2008 upon federally chartered banks; later powers only if the director finds they serve depositors/borrowers/public and maintain parity, by declaratory ruling. The DLR document names SDCL 51A-2-14.1 as the parity statute.",
    "url": "https://dlr.sd.gov/banking/banks/documents/state_charter_advantages.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "tn_unclaimed_dormancy_charge_conditions",
    "state_code": "TN",
    "topic": "dormancy",
    "name": "Dormancy charges deductible only under a contract and not unconscionable",
    "citation": "Tenn. Code Ann. Title 66, Chapter 29 (Uniform Unclaimed Property Act; section number not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct a dormancy charge only under a contract, if regularly imposed and not reversed, and in an amount that is not unconscionable.",
    "detail": "A holder may deduct a dormancy charge from property it turns over to the Treasurer only if a valid and enforceable contract with the owner authorizes the charge for failure to claim the property within a set time and the holder regularly imposes and does not regularly reverse it; the deduction may not be unconscionable given the holder's marginal costs of maintaining the property and services the owner received.",
    "evidence": "Search summary of official results (Public Chapter 457 of the 110th General Assembly and related bill text): \"A holder may deduct a dormancy charge from property required to be paid or delivered to the treasurer if a valid and enforceable contract ... authorizes imposition of the charge ... and the holder regularly imposes the charge and does not regularly reverse or otherwise cancel the charge\"; amount limited to one that is not unconscionable considering marginal transactional costs and services received. Whether this text is the current codified version was not confirmed.",
    "url": "https://publications.tnsosfiles.com/acts/110/pub/pc0457.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "tn_deposit_account_2500_exemption",
    "state_code": "TN",
    "topic": "garnishment_legal_process",
    "name": "$2,500 in deposit accounts automatically exempt from execution",
    "citation": "2024 Tenn. Pub. Acts ch. 914 (HB 2320 / SB 2375), amending Tenn. Code Ann. Title 26, Chapter 2 (codified section not confirmed)",
    "date": "in force since 2024-07-01",
    "effective_date": "2024-07-01",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "Up to $2,500 total in a debtor's deposit accounts at a Tennessee financial institution is automatically exempt from execution, seizure or attachment.",
    "detail": "Up to $2,500 in aggregate in a judgment debtor's deposit accounts at a bank or other financial institution in Tennessee is automatically exempt from execution, seizure or attachment, unless the debtor used the general personal property exemption without selecting that account; where the debtor has several accounts, the creditor may get a court order naming which accounts carry the $2,500 exemption. The text seen does not address bank processing fees.",
    "evidence": "\"Funds to the aggregate value of two thousand five hundred dollars ($2,500) in a judgment debtor's deposit account with a bank or other financial institution in this state are exempt automatically from execution, seizure, or attachment.\" Bill information page: signed May 13, 2024, Public Chapter 914, effective July 1, 2024.",
    "url": "https://www.capitol.tn.gov//Bills/113/Bill/HB2320.pdf",
    "figures": {
      "exempt_amount": 2500
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "tn_bank_wild_card_parity",
    "state_code": "TN",
    "topic": "fee_authority",
    "name": "State bank wild-card parity with national banks",
    "citation": "Tenn. Code Ann. Title 45, Chapter 2 'wild card' statute (section number not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "Under the wild-card statute, Tennessee state banks may exercise national bank powers, subject to federal conditions and Commissioner oversight.",
    "detail": "Under Tennessee's wild-card statute, as described by the Department of Financial Institutions, state banks and their operating subsidiaries may exercise the powers granted national banks, free from the same state laws, subject to federal terms and conditions and to the Commissioner's safety-and-soundness oversight.",
    "evidence": "TDFI 'Charter of Choice' page (search summary): through the operation of the \"wild card\" statute, state banks and their operating subsidiaries may exercise the same powers granted national banks, free from the same state laws, subject only to the terms and conditions imposed by federal regulations; subject to regulation by the Commissioner for safety and soundness.",
    "url": "https://www.tn.gov/tdfi/bank-trust/banking.html",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "tx_inactive_account_no_service_charge",
    "state_code": "TX",
    "topic": "dormancy",
    "name": "No service charge on inactive accounts",
    "citation": "Tex. Prop. Code § 73.003",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "coverage_note": "Tex. Prop. Code ch. 73 defines a depository as a bank, savings and loan association, credit union or other banking organization that holds deposits in Texas (text seen only on texas.public.law, a secondary source; official capitol.texas.gov text not reached), with no charter limit.",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A depository must preserve an inactive account and may not reduce its value by service charges or any other procedure.",
    "detail": "A depository must preserve an inactive account and may not, by any procedure including a service charge, reduce the account's value or convert it to the depository's assets. Chapter 73 applies to 'depositories' holding property; whether it reaches national banks and federal credit unions was not confirmed.",
    "evidence": "Texas Department of Banking FAQ (official): 'Section 73.003(a) of the Texas Property Code prohibits a bank from service charging an inactive account'; to keep an account active the holder needs to make a deposit or withdrawal at least once per year (FAQ citing § 73.003(b)). Statute wording (seen on Justia/FindLaw/onecle, secondary): the depository 'may not, at any time, by any procedure, including the imposition of a service charge, transfer or convert to the profits or assets of the depository or otherwise reduce the value of the account.'",
    "url": "https://www.dob.texas.gov/banks-trust-companies/faqs",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "tx_state_bank_national_parity",
    "state_code": "TX",
    "topic": "fee_authority",
    "name": "State bank parity with national banks",
    "citation": "Tex. Const. art. XVI, § 16(c); Tex. Fin. Code §§ 32.009, 32.010",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "A Texas state bank has national bank rights but must notify the banking commissioner by letter before using a power not otherwise authorized.",
    "detail": "A Texas state bank has the same rights and privileges as a national bank domiciled in Texas; to use a national-bank power not otherwise authorized by Texas law it must first send the banking commissioner a letter describing the activity and the national-bank authority. The sources do not single out deposit fees.",
    "evidence": "Texas Department of Banking 'Why Choose a State Charter' (official): Tex. Const. art. XVI § 16(c) and Finance Code § 32.009 provide that a Texas state bank has the same rights and privileges granted to a national bank domiciled in Texas; § 32.009(b) requires a letter to the commissioner; § 32.009(f): exercise in compliance 'is not a violation of any statute of this state.' Additional parity authority in § 32.010 (1999).",
    "url": "https://www.dob.texas.gov/sites/default/files/files/Bank-Trust-Companies/charterbnk.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "tx_cu_account_terms_board_policy",
    "state_code": "TX",
    "topic": "fee_authority",
    "name": "Credit union share and deposit account terms set by board policy",
    "citation": "7 Tex. Admin. Code § 91.601",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "A Texas credit union may offer any share or deposit account on terms set by board-approved written policies.",
    "detail": "A Texas credit union may offer any type of share or deposit account and set the account terms and conditions in written policies approved by its board. The excerpt seen does not mention fees by name.",
    "evidence": "Search result summarizing the Credit Union Department rules compilation: 7 TAC § 91.601 'a credit union may offer any type of share or deposit accounts and prescribe the terms and conditions relating to the accounts as established by written policies approved by the board of directors.'",
    "url": "https://cud.texas.gov/wp-content/uploads/2026/04/RULES_FOR_CREDIT_UNIONS-Complilation-1.pdf",
    "verification": "official_excerpt",
    "source_kind": "regulation"
  },
  {
    "id": "ut_depository_transaction_fee_authority",
    "state_code": "UT",
    "topic": "fee_authority",
    "name": "Depository institutions may charge any transaction fee not prohibited by law (ATM Act)",
    "citation": "Utah Code § 7-16a-202(4) (Automated Teller Machine Act)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "coverage_note": "Utah Code § 7-16a-102 (le.utah.gov) defines 'depository institution' as a bank, S&L, savings bank, industrial loan corporation, credit union or other institution that holds deposits or share accounts, with no charter limit.",
    "applies_to": [
      "atm_non_network"
    ],
    "summary": "Depository institutions and ATM owners, operators, issuers or transfer systems may charge customers any transaction fee that law allows or does not prohibit.",
    "detail": "A depository institution (and an ATM owner, operator, card issuer or electronic funds transfer system) may charge any or all customers any transaction fee allowed or not prohibited by state or federal law. The provision sits in the section on ATM fees and surcharges, so it may be read as limited to ATM transactions; it reaches any depository institution operating in Utah, not only state-chartered ones.",
    "evidence": "le.utah.gov 7-16a-202(4): 'Any of the following entities may charge any or all customers any transaction fee allowed or not prohibited by state or federal law: (a) a depository institution; (b) an owner; (c) an operator; (d) an issuer; or (e) an electronic consumer funds transfer system.' Section heading: 'Powers of depository institutions operating automated teller machines -- Fees or surcharges.'",
    "url": "https://le.utah.gov/xcode/Title7/Chapter16A/C7-16a-S202_1800010118000101.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ut_atm_surcharge_disclosure",
    "state_code": "UT",
    "topic": "atm",
    "name": "ATM surcharge must be disclosed before the user is committed",
    "citation": "Utah Code § 7-16a-202",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "coverage_note": "Utah Code § 7-16a-102 (le.utah.gov) defines 'operator' as a depository institution, a depository institution holding company or an institution they own or control that owns or contracts to operate the ATM, and 'depository institution' has no charter limit.",
    "applies_to": [
      "atm_non_network"
    ],
    "summary": "An ATM operator may impose a transaction fee only if it is disclosed in time for the user to cancel without paying it.",
    "detail": "An ATM operator may impose a transaction fee only if the fee is disclosed at a time and in a manner that lets the user cancel the transaction without incurring it. The fee may be in addition to charges imposed by the network, the depository institution or the card issuer, and includes surcharges on users whose accounts are at depository institutions outside the United States. No dollar cap was seen.",
    "evidence": "le.utah.gov search excerpt of 7-16a-202: operator 'may impose a transaction fee for the use of an automated teller machine if the imposition of the transaction fee is disclosed at a time and in a manner that allows a user to terminate or cancel the transaction without incurring the transaction fee'; the fee 'may be in addition to any other charges imposed by an electronic consumer funds transfer system, a depository institution, or an issuer'.",
    "url": "https://le.utah.gov/xcode/Title7/Chapter16A/C7-16a-S202_1800010118000101.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ut_unclaimed_dormancy_charge",
    "state_code": "UT",
    "topic": "dormancy",
    "name": "Dormancy charge deducted from unclaimed property",
    "citation": "Utah Code § 67-4a-602 (Revised Uniform Unclaimed Property Act, S.B. 175, 2017)",
    "date": "in force since 2017-05-09",
    "effective_date": "2017-05-09",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct a dormancy charge from unclaimed property only under a contract with the owner, if regularly imposed and not regularly reversed.",
    "detail": "A holder may deduct a dormancy charge from property it remits to the state as unclaimed only if a valid contract with the apparent owner authorizes the charge for failing to claim the property within a set time, and the holder regularly imposes the charge and does not regularly reverse or cancel it.",
    "evidence": "le.utah.gov ch. 67-4a (version dated 2017-05-09): 'A holder may deduct a dormancy charge from property required to be paid or delivered to the administrator if: (a) a valid contract between the holder and the apparent owner authorizes imposition of the charge for the apparent owner's failure to claim the property within a specified time; and (b) the holder regularly imposes the charge and regularly does not reverse or otherwise cancel the charge.' Whether Utah also kept the uniform act's 'not unconscionable' limit was not seen. Effective date is the date on the code version seen, not confirmed as the section's effective date.",
    "url": "https://le.utah.gov/xcode/Title67/Chapter4A/C67-4a_2017050920170509.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ut_cu_may_charge_fees",
    "state_code": "UT",
    "topic": "fee_authority",
    "name": "Credit unions may charge fees for their services",
    "citation": "Utah Credit Union Act, Utah Code Title 7, Chapter 9 (powers section; exact section number not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "A Utah credit union may charge fees for its services and set interest rates on shares and deposits, with no statutory fee cap seen.",
    "detail": "A Utah credit union may charge fees for its services and determine the interest rates on shares and deposits. No statutory cap on deposit fees was seen.",
    "evidence": "le.utah.gov Utah Credit Union Act search excerpt: 'A credit union may make contracts, sue and be sued, acquire and hold assets, charge fees for its services, determine interest rates on shares and deposits, and determine terms and conditions of credit granted to members.'",
    "url": "https://le.utah.gov/xcode/Title7/Chapter9/C7-9_1800010118000101.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ut_commissioner_federal_parity",
    "state_code": "UT",
    "topic": "fee_authority",
    "name": "Commissioner may grant state institutions federal-charter powers",
    "citation": "Utah Financial Institutions Act, Utah Code Title 7, Chapter 1 (exact section number not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks_and_credit_unions",
    "applies_to": [],
    "summary": "The commissioner may let a state-chartered bank or credit union exercise any activity or power it would have under a federal charter.",
    "detail": "The commissioner of financial institutions may authorize a state-chartered depository institution to engage in any activity, and grant it any right, power or privilege, it would have if chartered under federal law, considering competitive equality with federally and out-of-state chartered institutions.",
    "evidence": "le.utah.gov Title 7 ch. 1 search excerpt: 'The commissioner may authorize a state chartered depository institution to engage in any activity it could engage in, and to grant to that institution all additional rights, powers, privileges, benefits, or immunities it would possess, if it were chartered under the laws of the United States'; 'the commissioner shall consider the need for competitive equality'.",
    "url": "https://le.utah.gov/xcode/Title7/Chapter1/C7-1_1800010118000101.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "ut_dishonored_check_service_charge",
    "state_code": "UT",
    "topic": "payee_returned_check",
    "name": "Payee service charge on dishonored checks; depository institutions exempt",
    "citation": "Utah Code § 7-15-1",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "other",
    "coverage_note": "Utah Code § 7-15-1 (le.utah.gov) binds the issuer and holder of a dishonored check and exempts a holder that is a depository institution, so it binds payees, not a bank's fee to its depositor.",
    "applies_to": [],
    "summary": "This payee rule makes a dishonored check's issuer liable for the amount plus a $20 service charge, but depository institution holders are exempt.",
    "detail": "The issuer of a dishonored check is liable to the holder for the check amount plus a $20 service charge, which may not be collected if the redeposited check is honored. A depository institution holder is exempt from this rule and may instead contract with the issuer for dishonor fees.",
    "evidence": "le.utah.gov search summary: issuer 'is liable for the check amount and a service charge of $20'; a holder 'is exempt ... if the holder is a depository institution ... and may contract with an issuer for collection of fees or charges for the dishonor of a check'; no service charge if 'the holder redeposits the check and that check is honored.' The search result named Title 7-15-1 but the section page URL was not shown.",
    "url": null,
    "figures": {
      "service_charge_usd": 20
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "va_dormant_account_service_charges",
    "state_code": "VA",
    "topic": "dormancy",
    "name": "Limits on service charges on dormant accounts (Unclaimed Property Act)",
    "citation": "Va. Code § 55.1-2503 (bank deposits and funds in financial organizations); Virginia Disposition of Unclaimed Property Act, § 55.1-2500 et seq.",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A banking or financial organization may charge a dormant account differently from active accounts only after written notice, a condition stated for property over $100.",
    "detail": "A banking or financial organization may not deduct a service charge from an account, or stop paying interest, because the account is dormant or inactive, except in line with charges and interest rules applied to active accounts or as the section allows. A holder may impose dormancy charges that differ from active-account charges only after giving the owner written notice of the charge at the last known address, a condition stated for property over $100. Court-controlled deposits for minors are not subject to dormant service charges.",
    "evidence": "law.lis.virginia.gov search excerpt: 'No banking or financial organization may deduct any service charge or cease to accrue interest on any account from the date the account is declared dormant or inactive by such organization except in conformity with cessation of interest or service charges generally assessed upon active accounts and except as provided in this section.' And: 'A holder may not impose any charges due to dormancy or inactivity that differ from charges imposed on active accounts ... unless: ... written notice to the owner of the amount of those charges at the last known address of the owner stating that those charges will be imposed ... for property in excess of $100.' Deposits by a court or guardian for an infant subject to court order 'shall not be subject to ... dormant service charges.' The exact subsection for the notice condition, and its full list of conditions, was not seen.",
    "url": "https://law.lis.virginia.gov/vacode/title55.1/chapter25/section55.1-2503/",
    "figures": {
      "notice_threshold_usd": 100
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "va_garnishment_minimum_protected_balance",
    "state_code": "VA",
    "topic": "garnishment_legal_process",
    "name": "Minimum protected account balance and automatic benefit protection in garnishment",
    "citation": "Va. Code §§ 34-4.3, 34-4.4, 8.01-511, 8.01-512.4 (as amended by 2026 Acts ch. 638, SB 301)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "A garnished financial institution must hold exempt a protected balance of up to $1,000 plus benefits deposited within 2 months, except for support debts.",
    "detail": "On receiving a garnishment summons, a financial institution must review the debtor's accounts and hold exempt a minimum protected balance of up to $1,000 in total, with no part of it withheld for any purpose relating to the garnishment and full customary access for the account holder; the amount is adjusted every three years for inflation starting April 1, 2027. Benefit payments deposited in the two months before the review are also automatically exempt, except for child or spousal support debts.",
    "evidence": "law.lis.virginia.gov § 34-4.3 and 2026 CHAP0638 (SB 301) text: financial institution 'shall hold exempt from garnishment a minimum protected account balance of such account holder's funds in a combined total amount not to exceed $1,000. No portion of such minimum protected account balance shall be withheld from the account holder for a purpose relating to the garnishment and such financial institution shall provide the account holder with full and customary access'; benefit payments deposited 'within the two months immediately preceding' the review are automatically exempt; adjusted every three years from April 1, 2027. Which parts SB 301 (2026) added versus amended, and its effective date, were not confirmed.",
    "url": "https://law.lis.virginia.gov/vacode/title34/chapter2/section34-4.3/",
    "figures": {
      "minimum_protected_balance_usd": 1000,
      "benefit_lookback_months": 2,
      "adjustment_interval_years": 3
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "va_state_bank_charges_parity",
    "state_code": "VA",
    "topic": "fee_authority",
    "name": "SCC may let state banks make charges comparable to national banks",
    "citation": "Va. Code § 6.2-805; see also § 6.2-804",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "The State Corporation Commission may by order let state banks make charges comparable to those federal law permits national banks.",
    "detail": "The State Corporation Commission may by order give state banks the power to make charges comparable to those any federal statute or regulation permits national banks to make, and may by regulation let state banks engage in any activity federal law authorizes for federally supervised banks.",
    "evidence": "law.lis.virginia.gov § 6.2-805 title: 'Commission authorized to confer on state banks power to make charges comparable to those permitted to national banking associations'; text per search: the Commission may, by order, confer upon state banks 'the power to make charges that are comparable to those permitted under any federal statute or regulation to any national banking association.' § 6.2-804: Commission may by regulation amend state bank powers to allow any activity a federally supervised bank may be authorized to engage in.",
    "url": "https://law.lis.virginia.gov/vacode/title6.2/chapter8/section6.2-805/",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "va_cu_federal_parity",
    "state_code": "VA",
    "topic": "fee_authority",
    "name": "SCC may give state credit unions federal credit union powers",
    "citation": "Va. Code Title 6.2, Chapter 13 (Credit Unions) (exact section number not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "The Commission may adopt regulations giving state credit unions powers at least comparable to federal credit unions, despite contrary law.",
    "detail": "The Commission may adopt regulations giving state-chartered credit unions powers at least comparable to those of federally chartered credit unions, regardless of any contrary statute, regulation or court decision.",
    "evidence": "law.lis.virginia.gov ch. 13 search excerpt: 'The Commission may adopt such regulations as may be necessary to permit state chartered credit unions to have powers at least comparable with those of federally chartered credit unions ... regardless of any then existing statute, regulation or court decision limiting or denying such powers'.",
    "url": "https://law.lis.virginia.gov/vacodefull/title6.2/chapter13/",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "vt_no_deposited_item_return_charge",
    "state_code": "VT",
    "topic": "returned_item",
    "name": "Ban on charging a depositor for a deposited check returned unpaid",
    "citation": "8 V.S.A. § 10505",
    "date": "in force since 1999",
    "effective_date": "1999",
    "status": "in_force",
    "institutions": "state_banks_and_credit_unions",
    "applies_to": [
      "deposited_item_return"
    ],
    "summary": "A depository institution or credit union may not charge a depositor for a deposited check returned unpaid for nonsufficient funds.",
    "detail": "A depository institution, financial institution or credit union may not charge a depositor a returned check charge or similar charge for processing a check the depositor received and deposited that was returned for nonsufficient funds by the bank it was drawn on.",
    "evidence": "Search result from legislature.vermont.gov (8 V.S.A. § 10505): 'no depository institution or financial institution or credit union shall assess a returned check charge or similar charge against a depositor for the costs of processing a check received by that depositor and returned for nonsufficient funds by the institution upon which it was drawn.' Added 1999. The 2026 banking bill H.648 (as passed by the House) carries the same language.",
    "url": "https://legislature.vermont.gov/statutes/section/08/200/10505",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "vt_basic_banking_rulemaking",
    "state_code": "VT",
    "topic": "basic_account",
    "name": "Basic banking policy and Commissioner rulemaking authority",
    "citation": "8 V.S.A. §§ 10501, 10502, 10504 (§ 10503 repealed by 2019 Acts No. 20, § 102)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "coverage_note": "Search of legislature.vermont.gov returned a Title 8 definition making 'financial institution' mean any Vermont, state or national financial institution under § 11101(32) plus credit unions and other regulated lenders chartered under Vermont, US or other state law; § 10502 itself defines only the account types, and which definition governs §§ 10501-10504 was not confirmed.",
    "applies_to": [],
    "summary": "The Commissioner may require financial institutions to offer basic checking and savings accounts if availability and cost deteriorate, with no current fee cap.",
    "detail": "Vermont declares a policy that reasonable-cost basic checking and savings accounts stay available to consumers and lets the Commissioner of Financial Regulation adopt rules requiring financial institutions to offer basic checking and savings accounts if availability and cost materially deteriorate; no standing fee cap was found in the current text.",
    "evidence": "Official search results: § 10501 states the public policy that 'reasonable cost basic banking services' be available; § 10502 defines 'basic checking account' and 'basic savings account'; § 10504 allows the Commissioner to adopt rules requiring financial institutions to offer basic checking and savings accounts if there is material deterioration in availability and cost; § 10503 was repealed (2019, No. 20, § 102).",
    "url": "https://legislature.vermont.gov/statutes/chapter/08/200",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "vt_unclaimed_dormancy_charge",
    "state_code": "VT",
    "topic": "dormancy",
    "name": "Conditions on dormancy charges deducted from unclaimed property",
    "citation": "27 V.S.A. § 1512",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct a contract-authorized, regularly imposed dormancy charge, and charging for inactivity can shorten abandonment to 2 years.",
    "detail": "A holder may deduct a dormancy charge from property it remits to the state only if a valid contract with the owner authorizes the charge and the holder regularly imposes it and does not regularly reverse it. Separately, if a holder charges for owner inactivity and the normal abandonment period is longer than two years, the property is presumed abandoned two years after the owner's last indication of interest.",
    "evidence": "Official search result (27 V.S.A. ch. 18, Subchapter 6, § 1512 Dormancy charge): holder may deduct a dormancy charge if '(1) a valid contract between the holder and the apparent owner authorizes imposition of the charge ... and (2) the holder regularly imposes the charge and regularly does not reverse or otherwise cancel the charge.' Same chapter: if the holder has imposed a charge for owner inactivity and the abandonment period is greater than two years, property is presumed abandoned two years from the last indication of interest. The section number of the two-year rule was not seen.",
    "url": "https://legislature.vermont.gov/statutes/fullchapter/27/018",
    "figures": {
      "accelerated_abandonment_years": 2
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "vt_cu_federal_parity",
    "state_code": "VT",
    "topic": "fee_authority",
    "name": "Credit union federal parity (expanded powers)",
    "citation": "8 V.S.A. § 32103",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "After notifying the Commissioner and receiving nonobjection, a Vermont credit union may exercise federal credit union powers not barred by state law.",
    "detail": "A Vermont credit union may exercise any power or activity granted to a federal credit union after notifying the Commissioner and receiving a written letter of nonobjection, provided the activity is not prohibited or restricted by other Vermont law. The statute does not mention fees specifically.",
    "evidence": "Official search result: 'Vermont credit unions may exercise any of the powers or engage in any activity conferred upon a federal credit union ... Prior to engaging in such power or activity, the credit union shall notify the Commissioner'; Commissioner issues a written letter of nonobjection if permitted by federal law, safe and sound, and not prohibited or restricted by Vermont law.",
    "url": "https://legislature.vermont.gov/statutes/section/08/222/32103",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "wa_bank_account_garnishment_exemption",
    "state_code": "WA",
    "topic": "garnishment_legal_process",
    "name": "Automatically protected bank-account balance in garnishment",
    "citation": "RCW 6.15.010 (as amended by ch. 391, Laws of 2025, E2SSB 5651); ch. 6.27 RCW (garnishment)",
    "date": "in force since 2025-07-01",
    "effective_date": "2025-07-01",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "When a bank account is garnished for consumer debt, $2,000 is automatically protected, up from $1,000 before the 2025 act.",
    "detail": "When a bank account is garnished for consumer debt, $2,000 is automatically protected; chapter 391, Laws of 2025 (E2SSB 5651) raised that automatic protection from $1,000 to $2,000 and made the automatic protections permanent. Earlier text also showed a $2,500 exemption for private student loan debt with $1,000 automatically protected and $500 for other debts; whether the 2025 act changed those two amounts was not confirmed. No limit on the bank's own garnishment fee was found.",
    "evidence": "Official search results (app.leg.wa.gov RCW 6.15.010 and ch. 6.27 RCW): 'For all consumer debt, $2,000 ... The maximum exemption shall be automatically protected'; private student loan debt $2,500 with $1,000 automatically protected; other debts $500; legislative intent to specify 'when and how much a garnishee bank is required to hold and release.' An archived version is labeled 'Effective until July 1, 2025', so the section was amended effective July 1, 2025; which amounts belong to the current version was not confirmed, and 2025-26 bill SB 5651 also amends RCW 6.15.010 (passage not confirmed). Wave 2: Final Bill Report E2SSB 5651, C 391 L 25 (lawfilesext.leg.wa.gov): 'The amount of personal property in financial accounts and securities that is automatically protected from execution, attachment, and garnishment in nonbankruptcy proceedings for consumer debt is increased from $1,000 to $2,000, and the automatic protections that pertain to nonbankruptcy exemptions are made permanent.' Passed House April 10, 2025 (61-34) and Senate April 22, 2025 (33-15). Effective July 1, 2025 per search summary of the bill reports. The introduced bill's $5,000-for-all-debts version was not what was enacted.",
    "url": "https://app.leg.wa.gov/rcw/default.aspx?cite=6.15.010",
    "figures": {
      "consumer_debt_auto_protected": 2000,
      "prior_consumer_debt_auto_protected": 1000,
      "private_student_loan_exemption": 2500,
      "private_student_loan_auto_protected": 1000,
      "other_debt_auto_protected": 500
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "wa_unclaimed_dormancy_charge",
    "state_code": "WA",
    "topic": "dormancy",
    "name": "Dormancy charge deducted from unclaimed property",
    "citation": "RCW 63.30.330 (Revised Uniform Unclaimed Property Act)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct a dormancy charge only under a contract, if regularly imposed and not reversed, after 3 months' notice, and if not unconscionable.",
    "detail": "A holder may deduct a dormancy charge from property it remits to the state only if a valid contract with the owner authorizes the charge, the holder regularly imposes and does not regularly reverse it, and (per the search excerpt) the holder notifies the owner three months before ceasing interest or charging dormancy fees; the amount may not be unconscionable given the holder's marginal costs and services the owner received.",
    "evidence": "app.leg.wa.gov RCW 63.30.330 'Dormancy charge. (1) A holder may deduct a dormancy charge from property required to be paid or delivered to the administrator if: (a) A valid contract between the holder and the apparent owner authorizes imposition of the charge ...; (b) The holder regularly imposes the charge and regularly does not reverse or otherwise cancel the charge'; amount 'limited to an amount that is not unconscionable considering all relevant factors, including the marginal transactional costs ...'. The three-month notice condition came from the search summary and should be checked against the section text.",
    "url": "https://app.leg.wa.gov/RCW/default.aspx?cite=63.30.330&pdf=true",
    "figures": {
      "notice_months": 3
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "wa_bank_federal_parity",
    "state_code": "WA",
    "topic": "fee_authority",
    "name": "State banks have federally chartered bank powers",
    "citation": "RCW 30A.04.215 (ch. 30A.04 RCW)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "A Washington bank has federally chartered bank powers as of set dates and may get out-of-state bank powers if the director finds it fair.",
    "detail": "A Washington bank has the powers conferred on federally chartered banks doing business in Washington as of July 28, 1985, or any later date up to July 28, 2013, and may get out-of-state state bank powers if the director finds this serves depositors and borrowers and keeps competition fair. No deposit-fee-specific provision was seen.",
    "evidence": "app.leg.wa.gov ch. 30A.04 RCW search excerpt: 'A bank has the powers and authorities conferred as of July 28, 1985, or as of any subsequent date not later than July 28, 2013, upon any federally chartered bank doing business in this state.' Section number taken from the result URL (RCW 30A.04.215); not confirmed that the quoted text is in that section.",
    "url": "https://app.leg.wa.gov/rcw/default.aspx?cite=30A.04&full=true",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "wa_cu_reasonable_charges_parity",
    "state_code": "WA",
    "topic": "fee_authority",
    "name": "Credit unions may impose reasonable charges; federal credit union parity",
    "citation": "Ch. 31.12 RCW (Washington State Credit Union Act) (exact sections not confirmed)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "A Washington credit union may impose reasonable charges for its services and has federal credit union powers as of set dates.",
    "detail": "A Washington credit union may impose reasonable charges for the services it provides, and has the powers a federal credit union had on December 31, 1993 or any later date through June 9, 2022, plus later federal powers if the director finds they serve members and keep competition fair.",
    "evidence": "app.leg.wa.gov ch. 31.12 RCW search excerpt: credit unions may 'impose reasonable charges for the services it provides'; 'A credit union has the powers and authorities that a federal credit union had on December 31, 1993, or a subsequent date by June 9, 2022'.",
    "url": "https://app.leg.wa.gov/rcw/default.aspx?cite=31.12&full=true",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "wi_unclaimed_dormancy_charge",
    "state_code": "WI",
    "topic": "dormancy",
    "name": "Dormancy charge deducted from unclaimed property",
    "citation": "Wis. Stat. § 177.0602",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct a dormancy charge only under a written contract, if regularly imposed and not reversed, and only if not unconscionable.",
    "detail": "A holder may deduct a dormancy charge from property it remits as unclaimed only if a valid written contract with the apparent owner allows it and the holder regularly imposes and does not regularly reverse the charge; the deduction may not be unconscionable, considering the holder's marginal costs and services the owner received.",
    "evidence": "Search result from docs.legis.wisconsin.gov (ch. 177): 'A holder may deduct a dormancy charge from property required to be paid or delivered to the administrator if a valid written contract between the holder and the apparent owner authorizes imposition of the charge ... the holder regularly imposes the charge and regularly does not reverse or otherwise cancel ... limited to an amount that is not unconscionable considering all relevant factors, including the marginal transactional costs incurred by the holder in maintaining the apparent owner's property and any services received by the apparent owner.'",
    "url": "https://docs.legis.wisconsin.gov/statutes/statutes/177",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "wi_depository_account_exemption_5000",
    "state_code": "WI",
    "topic": "garnishment_legal_process",
    "name": "Depository account exemption",
    "citation": "Wis. Stat. § 815.18(3)(k)",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "Personal depository accounts are exempt from execution up to $5,000 in total, but the debtor must claim the exemption.",
    "detail": "Personal (non-business) depository accounts are exempt from execution up to $5,000 in aggregate, but the debtor must affirmatively claim the exemption. The statute does not address bank fees.",
    "evidence": "docs.legis.wisconsin.gov 815.18(3)(k): 'Depository accounts in the aggregate value of $5,000, but only to the extent that the account is for the debtor's personal use and is not used as a business account.'",
    "url": "https://docs.legis.wisconsin.gov/document/statutes/815.18(3)(k)",
    "figures": {
      "exempt_deposit_amount_usd": 5000
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "wi_nonearnings_garnishee_fee_3",
    "state_code": "WI",
    "topic": "garnishment_legal_process",
    "name": "Garnishee fee for non-earnings garnishment",
    "citation": "Wis. Stat. § 812.08",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "other",
    "coverage_note": "Wis. Stat. §§ 812.01 and 812.08 (docs.legis.wisconsin.gov) let a creditor proceed against any person indebted to or holding the debtor's property and entitle that garnishee to a $3 fee, so it sets what a creditor pays any garnishee, not a bank's fee to its depositor.",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "In a non-earnings garnishment such as of a bank account, the garnishee, including a bank, is entitled to a $3 fee before answering.",
    "detail": "In a non-earnings garnishment (e.g. of a bank account), the garnishee is entitled to a $3 garnishee fee and need not answer until it is paid; the fee is taxed as costs. The statute sets the fee paid by the creditor to any garnishee, including banks; it does not itself address fees charged to the depositor.",
    "evidence": "docs.legis.wisconsin.gov 812.08: 'a garnishee shall be entitled to $3 as garnishee fee, and shall not be required to answer unless such fee is first paid ... such fee shall be taxed as costs in the action.'",
    "url": "https://docs.legis.wisconsin.gov/document/statutes/812.08",
    "figures": {
      "garnishee_fee_usd": 3
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "wi_cu_federal_incidental_parity",
    "state_code": "WI",
    "topic": "fee_authority",
    "name": "Credit union incidental powers parity with federal credit unions",
    "citation": "Wis. Stat. § 186.118",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "A Wisconsin credit union may exercise listed federal credit union incidental powers, and the office must decide on new ones within 30 days.",
    "detail": "A Wisconsin credit union may engage in any activity or exercise any power on the Office of Credit Unions' list of incidental powers authorized for federal credit unions as of April 18, 2014; when a new incidental power becomes authorized for federal credit unions, the office must decide within 30 days whether to authorize it for state credit unions.",
    "evidence": "docs.legis.wisconsin.gov 186.118 'Incidental powers parity with federal credit unions': credit union organized under s. 186.02 may engage in any activity or exercise any power listed by the office of credit unions, which promulgates a rule listing incidental powers authorized for federally chartered credit unions as of April 18, 2014; for later federal powers 'within 30 days after the activity or power becomes authorized the office of credit unions shall make a determination'.",
    "url": "https://docs.legis.wisconsin.gov/statutes/statutes/186/118",
    "figures": {
      "determination_days": 30
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "wi_bank_additional_authority",
    "state_code": "WI",
    "topic": "fee_authority",
    "name": "State banks may offer any financially related product another provider may offer",
    "citation": "Wis. Stat. § 221.0322",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [],
    "summary": "With any required approval, a Wisconsin state bank may offer any financially related product or service other financial providers may offer.",
    "detail": "Subject to any required regulatory approval, a Wisconsin state bank may undertake any activity, exercise any power or offer any financially related product or service in Wisconsin that any other provider of financial products or services may, or that the Division finds financially related. It is a broad powers provision, not a deposit-fee rule.",
    "evidence": "docs.legis.wisconsin.gov ch. 221 search excerpt of 221.0322 'Additional banking authority': 'a bank, directly or through a subsidiary, may undertake any activity, exercise any power or offer any financially related product or service in this state that any other provider of financial products or services may undertake, exercise or provide or that the division finds to be financially related.'",
    "url": "https://docs.legis.wisconsin.gov/statutes/statutes/221.pdf",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "wv_unclaimed_deposit_dormancy_charge_limits",
    "state_code": "WV",
    "topic": "dormancy",
    "name": "Dormancy and inactivity charges on deposits limited (Unclaimed Property Act)",
    "citation": "W. Va. Code § 36-8-2",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "Dormancy charges need a written contract, and no one may charge dormancy on interest-bearing savings or time deposits before withdrawal or abandonment.",
    "detail": "A holder may not impose dormancy or inactivity charges on deposits covered by the section, or stop paying interest, unless an enforceable written contract with the owner allows it. Separately, no one may charge a dormancy or inactivity fee on an interest-bearing savings or time deposit for any period before the depositor withdraws the funds or the state's right to take the deposit as abandoned accrues; such a deposit counts as dormant if the depositor has not increased or decreased it within the preceding two years.",
    "evidence": "Search result from code.wvlegislature.gov: 'No holder may impose with respect to property described in this section any charges due to dormancy or inactivity or cease payment of interest unless there is an enforceable written contract ... no person may demand, collect, charge or contract to receive any charge due to dormancy or inactivity on any interest bearing savings or time deposit for any period of time prior to the withdrawal of such funds by the depositor ... or the accrual under this article of the right of the state ... deemed to be dormant or inactive if the depositor ... has not within the immediately preceding two years increased or decreased the amount of the deposit.'",
    "url": "https://code.wvlegislature.gov/36-8-2/",
    "figures": {
      "inactivity_period_years": 2
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "wv_unclaimed_dormancy_charge_deduction",
    "state_code": "WV",
    "topic": "dormancy",
    "name": "Dormancy charge deducted from property presumed abandoned",
    "citation": "W. Va. Code § 36-8-5",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "dormant_account"
    ],
    "summary": "A holder may deduct a dormancy charge only under a written contract, if regularly imposed and not reversed, and only if not unconscionable.",
    "detail": "A holder may deduct a dormancy charge from property presumed abandoned only if a valid written contract with the owner allows the charge and the holder regularly imposes it and does not regularly reverse or cancel it; the deduction may not be unconscionable.",
    "evidence": "Search result from code.wvlegislature.gov: holder may deduct a charge imposed by reason of the owner's failure to claim the property within a specified time only if there is a valid and enforceable written contract ... and the holder regularly imposes the charge, which is not regularly reversed or otherwise canceled. The amount of the deduction is limited to an amount that is not unconscionable.",
    "url": "https://code.wvlegislature.gov/36-8-5/",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "wv_bank_merchant_returned_check_stop_payment_fee_reasonable",
    "state_code": "WV",
    "topic": "returned_item",
    "name": "Bank fees to merchants on worthless checks and stop payments limited to reasonable cost",
    "citation": "W. Va. Code § 31A-4-30b",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks",
    "applies_to": [
      "deposited_item_return",
      "stop_payment"
    ],
    "summary": "A state bank may charge a reasonable, cost-based fee when a merchant's presented or deposited check is worthless or stopped, within commissioner limits.",
    "detail": "A banking institution may charge a reasonable fee when a check presented or deposited by a merchant is worthless or has had payment stopped, but the fee is limited by reasonableness and the bank's actual processing cost, and the commissioner is to set limits by rule. The text speaks of merchants, so it may not reach consumer depositors.",
    "evidence": "Search results from code.wvlegislature.gov (31A-4 listing): 'A banking institution may charge and collect a reasonable fee when a check is presented for payment or deposited into an account by a merchant and that check is worthless or when a stop payment has been issued on that check; however, those fees shall be limited based on a standard of reasonableness and actual cost to the banking institution for processing. The commissioner of banking shall promulgate rules consistent with this section...'",
    "url": "https://code.wvlegislature.gov/31A-4/",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "wv_dfi_no_max_overdraft_returned_check_fee",
    "state_code": "WV",
    "topic": "overdraft_nsf",
    "name": "No statutory maximum on bank overdraft / returned-check fees (regulator statement)",
    "citation": "W. Va. Division of Financial Institutions, FAQ",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_banks_and_credit_unions",
    "applies_to": [
      "overdraft",
      "nsf"
    ],
    "summary": "The state regulator says no maximum applies to bank and credit union returned check or overdraft fees, which institutions set by policy.",
    "detail": "The state regulator says there is no maximum on what a financial institution may charge its own customers for returned checks or overdrafts, and institutions set their own overdraft policies. This is a regulator statement, not a statute.",
    "evidence": "dfi.wv.gov FAQ: 'There is no maximum amount that a financial institution may charge its customers for their returned checks or overdrafts ... financial institutions are allowed by law to establish their own internal policies with regard to overdraft charges for their own customers.'",
    "url": "https://dfi.wv.gov/faq",
    "verification": "official_excerpt",
    "source_kind": "regulator_guidance"
  },
  {
    "id": "wv_cu_fees_money_instruments_atm",
    "state_code": "WV",
    "topic": "fee_authority",
    "name": "Credit unions may charge fees for checks, money orders and ATM services",
    "citation": "W. Va. Code § 31C-8-4 (1996 Enrolled H.B. 4527)",
    "date": "in force since 1996",
    "effective_date": "1996",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [
      "cashiers_check",
      "money_order",
      "atm_non_network"
    ],
    "summary": "A West Virginia credit union may provide checks, money orders and similar instruments, including through ATMs, and charge fees for them.",
    "detail": "A West Virginia credit union may provide negotiable checks, money orders, travelers' checks and other money-type instruments, and these services through ATMs, and may charge fees for them.",
    "evidence": "code.wvlegislature.gov 31C-8-4: 'A credit union may collect, receive and disburse moneys in connection with the providing of negotiable checks, money orders, travelers' checks and other money-type instruments, and the providing of these services through automated teller machines ... A credit union may charge fees for such services.'",
    "url": "https://code.wvlegislature.gov/31C-8-4/",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "wv_cu_federal_powers_parity",
    "state_code": "WV",
    "topic": "fee_authority",
    "name": "Commissioner may grant state credit unions federal credit union powers",
    "citation": "W. Va. Code § 31C-3-3",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "state_credit_unions",
    "applies_to": [],
    "summary": "A West Virginia credit union may get any federal credit union power by commissioner rule if appropriate and beneficial to members.",
    "detail": "Unless a power is specifically denied, the commissioner may by rule let state credit unions exercise any power of federal credit unions if appropriate and a benefit to members. This is a general powers parity, not a fee-specific rule.",
    "evidence": "code.wvlegislature.gov 31C-3-3 'Advantageous federal powers': 'Unless exercise of a power is specifically denied, the commissioner may prescribe rules authorizing credit unions to exercise any of the powers conferred upon federal credit unions if the commissioner deems it appropriate ... and a benefit to their members.'",
    "url": "https://code.wvlegislature.gov/31C-3-3/",
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "wv_check_cashing_banks_exempt",
    "state_code": "WV",
    "topic": "check_cashing",
    "name": "Check-cashing fee limits do not apply to insured depository institutions",
    "citation": "W. Va. Code § 32A-3-1",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "other",
    "coverage_note": "W. Va. Code § 32A-3-1(f) (code.wvlegislature.gov) exempts federally insured depository institutions, foreign bank agencies and governmental entities from the check-cashing article, so it binds licensed check cashers, not banks.",
    "applies_to": [
      "check_cashing"
    ],
    "summary": "Federally insured depository institutions are exempt from the check-cashing article, so it sets no bank check-cashing fee limit.",
    "detail": "The check-cashing article bars fees for check cashing except as state law allows and caps merchant check-cashing fees at the greater of $1 or 1% of the check, but federally insured depository institutions are exempt from that article. It therefore sets no bank check-cashing fee limit.",
    "evidence": "code.wvlegislature.gov 32A-3-1 search summary: fees for merchants may not exceed the greater of $1 or 1% of face value; 'Federally-insured depository institutions, foreign bank agencies, and governmental entities exempt from licensure as money transmitters under this chapter are exempt from the provisions of this article.'",
    "url": "https://code.wvlegislature.gov/32A-3-1/",
    "figures": {
      "merchant_fee_floor_usd": 1,
      "merchant_fee_percent": 1
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "wv_deposit_exemption_1100",
    "state_code": "WV",
    "topic": "garnishment_legal_process",
    "name": "Exemption for funds on deposit",
    "citation": "W. Va. Code § 38-8-1",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "all_depository_institutions",
    "applies_to": [
      "garnishment_levy"
    ],
    "summary": "An individual's deposits in a federally insured financial institution are exempt from execution or other process up to $1,100.",
    "detail": "An individual's funds on deposit in a federally insured financial institution are exempt from execution or other process up to $1,100. The statute does not address bank fees on legal process.",
    "evidence": "Search result from code.wvlegislature.gov 38-8-1: funds on deposit in a federally insured financial institution exempt, 'not to exceed $1,100'.",
    "url": "https://code.wvlegislature.gov/38-8-1/",
    "figures": {
      "exempt_deposit_amount_usd": 1100
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  },
  {
    "id": "wv_payee_returned_check_25",
    "state_code": "WV",
    "topic": "payee_returned_check",
    "name": "Payee may charge up to $25 on a dishonored check",
    "citation": "W. Va. Code § 61-3-39e",
    "date": "in force, effective date not confirmed",
    "effective_date": "unknown",
    "status": "in_force",
    "institutions": "other",
    "coverage_note": "Definition not seen; coded from the statute's text as summarized: W. Va. Code § 61-3-39e lets a payee or holder charge the fee, so it binds payees, not a bank's fee to its depositor.",
    "applies_to": [],
    "summary": "This payee rule lets a payee or holder, not the bank, charge up to $25 per check dishonored for insufficient funds.",
    "detail": "A payee or holder (not the bank) may charge up to $25 for each check, draft or order dishonored for insufficient funds.",
    "evidence": "dfi.wv.gov FAQ: 'Chapter 61, Article 3, Section 39e allows the payee or holder to charge up to $25 for each check, draft or order that has been dishonored due to insufficient funds.'",
    "url": "https://code.wvlegislature.gov/61-3-39E/",
    "figures": {
      "max_fee_amount": 25
    },
    "verification": "official_excerpt",
    "source_kind": "statute"
  }
];

export const STATE_FEE_LAW_COVERAGE_DATA: StateFeeLawCoverage[] = [
  {
    "state_code": "AK",
    "state_name": "Alaska",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "dormancy",
      "fee_authority"
    ],
    "leads_unconfirmed": [
      {
        "topic": "fee_authority",
        "claim": "The Alaska Division of Banking and Securities found no Alaska statute limiting the amount of fees a bank or credit union can charge; only fee disclosure before a transaction is required.",
        "where_seen": "commerce.alaska.gov (search summary; exact page not identified)",
        "why_unconfirmed": "Could not identify or read the specific Division page."
      },
      {
        "topic": "dormancy",
        "claim": "AS 34.45 (Uniform Unclaimed Property Act) may contain a dormancy-charge condition like other UUPA states; checking and savings accounts have a 5-year dormancy period.",
        "where_seen": "https://unclaimedproperty.alaska.gov/docs/AK%20Property%20Types%20and%20Dormancy%20Periods.pdf",
        "why_unconfirmed": "Dormancy period seen on official site; no dormancy-charge text found."
      },
      {
        "topic": "atm",
        "claim": "The Division of Banking and Securities found no Alaska statute on the amount of ATM fees a bank or credit union may charge; only fee disclosure before the transaction is required.",
        "where_seen": "commerce.alaska.gov / akleg.gov documents (search summary)",
        "why_unconfirmed": "Search summary only; the disclosure statute was not identified."
      }
    ],
    "notes": "Wave 1: 4 searches. Wave 2: 4 searches (overdraft/dormancy, unclaimed property, garnishment, parity). No Alaska statute capping overdraft, NSF or other deposit fees was found; the Division of Banking and Securities is reported to say none exists. AS 34.45 dormancy-charge text was not seen (only the 5-year dormancy period for checking and savings, and a ban on gift card dormancy fees). No bank or credit union parity provision on fees was found (HB 85 2023 regs concern branch application fee parity). NOT SEARCHED: check_cashing, returned_item, fee_change_notice, basic_account."
  },
  {
    "state_code": "AL",
    "state_name": "Alabama",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "check_cashing",
      "returned_item",
      "fee_change_notice",
      "basic_account",
      "fee_authority"
    ],
    "leads_unconfirmed": [
      {
        "topic": "garnishment_legal_process",
        "claim": "Up to $7,500 of personal property including bank accounts may be exempt from garnishment in some circumstances.",
        "where_seen": "https://judicial.alabama.gov/docs/library/rules/cv64_A.pdf",
        "why_unconfirmed": "Debtor exemption notice in court rule; statute not seen and it does not address bank fees."
      }
    ],
    "notes": "Alabama State Banking Department consumer FAQ (https://banking.alabama.gov/con_affairs/faq/) says there is no maximum NSF fee a bank may charge (set by the account agreement) and that a bank may charge non-customers a fee to cash a check. 2025 SB281 (earned wage access, introduced only) would require EWA providers to reimburse bank overdraft/NSF fees; not a bank rule. Search budget ran out; about 7 searches used."
  },
  {
    "state_code": "AR",
    "state_name": "Arkansas",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "garnishment_legal_process",
      "basic_account",
      "fee_change_notice",
      "check_cashing"
    ],
    "leads_unconfirmed": [
      {
        "topic": "fee_authority",
        "claim": "Arkansas law authorizes state banks to engage in any banking activity in which they could engage if they were national banks (wild-card/parity).",
        "where_seen": "https://www.arkleg.state.ar.us/Home/FTPDocument?path=%2FACTS%2F1997%2FPublic%2F408.pdf (search summary)",
        "why_unconfirmed": "Codified section number not identified and text not quoted; no fee-specific language seen. No credit union parity text found."
      },
      {
        "topic": "payee_returned_check",
        "claim": "Arkansas state agency bank-draft forms cite Ark. Code § 5-37-301 for a $25 returned item charge plus $2 service fee; a DFA statement describes a returned check fee of 10% of face or $20, whichever greater, not over $50. These are payee/state fees, not bank fees.",
        "where_seen": "https://sas.arkansas.gov/wp-content/uploads/Bank-Authorization-Form-8.01.2025.pdf",
        "why_unconfirmed": "Low priority payee rule; statutory text not reviewed."
      }
    ],
    "notes": "Six searches used. Arkansas AG debit card page describes only the federal opt-in rule for overdraft on one-time debit purchases. Garnishment results described court procedure and federal-benefit exemptions only; nothing on a bank's own fees. NOT SEARCHED: ATM rules, returned deposited item fees specifically."
  },
  {
    "state_code": "AZ",
    "state_name": "Arizona",
    "topics_no_rule_found": [
      "check_cashing",
      "returned_item",
      "fee_change_notice",
      "basic_account"
    ],
    "leads_unconfirmed": [
      {
        "topic": "overdraft_nsf",
        "claim": "The Arizona Attorney General supported federal CFPB limits on large banks' overdraft fees; no Arizona statute capping overdraft fees was found.",
        "where_seen": "https://www.azag.gov/press-release/attorney-general-mayes-fights-protect-consumers-high-overdraft-fees",
        "why_unconfirmed": "Advocacy press release, not a state rule."
      }
    ],
    "notes": "Wave 1: 2 searches. Wave 2: 4 searches (garnishment, SB 1206, parity, overdraft). No general Arizona cap on bank overdraft or NSF fees was found; the only overdraft-fee provision found is the 2025 Uniform Special Deposits Act. A.R.S. § 6-635 ('other allowable fees') is in the consumer lender chapter, not deposit accounts. Credit union fee authority/parity: only a bylaw-based membership fee power and incidental powers were seen, no federal parity text. NOT SEARCHED: atm. azleg.gov is egress-blocked for fetch."
  },
  {
    "state_code": "CA",
    "state_name": "California",
    "topics_no_rule_found": [
      "fee_change_notice",
      "basic_account",
      "fee_authority",
      "atm"
    ],
    "leads_unconfirmed": [
      {
        "topic": "returned_item",
        "claim": "AB 1606 (1999-2000, Margett) would have added Fin. Code § 3351 capping a bank's returned-check / returned-deposit-item fee at $15 and requiring basic/no-frills and federal-deposit accounts to pay no more than other accounts.",
        "where_seen": "https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=199920000AB1606",
        "why_unconfirmed": "Last version seen was 'Amended in Assembly January 12, 2000'; no evidence it was enacted. Almost certainly died; do NOT treat as law."
      },
      {
        "topic": "returned_item",
        "claim": "Attorney General Bonta warned small banks and credit unions (Feb. 20, 2024) that surprise overdraft and returned-deposited-item fees harm consumers.",
        "where_seen": "https://oag.ca.gov/news/press-releases/attorney-general-bonta-issues-warning-small-banks-and-credit-unions-surprise",
        "why_unconfirmed": "Enforcement warning letter, not a statute or regulation; contents not read."
      }
    ],
    "notes": "Web search budget for the session ran out partway through; CA got ~10 searches. Not checked: public-benefit (CCP 704.080) exemptions, bank levy processing fees, Fin. Code fee-authority/parity provisions, any 2025-26 bills. leginfo.legislature.ca.gov is egress-blocked, so all leginfo evidence is from search-result excerpts."
  },
  {
    "state_code": "CO",
    "state_name": "Colorado",
    "topics_no_rule_found": [
      "overdraft_nsf"
    ],
    "leads_unconfirmed": [
      {
        "topic": "dormancy",
        "claim": "Former C.R.S. § 38-13-107 barred a holder of bank deposits from deducting a service fee due solely to dormancy or inactivity unless an enforceable written contract allowed it. Appears to be the pre-2019 act, likely superseded by RUUPA (§ 38-13-602).",
        "where_seen": "https://law.justia.com/codes/colorado/2018/title-38/unclaimed-property/article-13/section-38-13-107/",
        "why_unconfirmed": "Seen only on Justia 2018 code; likely repealed by SB 19-088."
      },
      {
        "topic": "fee_authority",
        "claim": "C.R.S. § 11-30-104 (credit union powers) and § 11-30-112 reference credit union fees; a search summary said credit unions may charge an entrance fee and annual membership fee that must be uniform to all members.",
        "where_seen": "https://law.justia.com/codes/colorado/title-11/credit-unions/article-30/section-11-30-104/",
        "why_unconfirmed": "Did not see the section text; no general deposit-fee authority or parity clause confirmed."
      },
      {
        "topic": "garnishment_legal_process",
        "claim": "C.R.S. § 13-54-102 exempts a cumulative amount in the debtor's depository accounts from garnishment ($2,500 per older text; a search summary said later amendments raised it to $7,000). This is an exemption, not a bank fee rule.",
        "where_seen": "https://content.leg.colorado.gov/sites/default/files/2019a_1189_signed.pdf",
        "why_unconfirmed": "Current dollar amount not confirmed from official text; no rule on bank garnishment processing fees found."
      },
      {
        "topic": "other",
        "claim": "HB25-1090 (Protections Against Deceptive Pricing Practices) requires clear price disclosure and prohibits certain fees; whether it reaches deposit account fees or exempts financial institutions is unknown.",
        "where_seen": "https://leg.colorado.gov/bills/hb25-1090",
        "why_unconfirmed": "Did not see bill text or its scope."
      },
      {
        "topic": "payee_returned_check",
        "claim": "Colorado Consumer Credit Code allows a fee not exceeding $25 on return or dishonor of a check tendered as payment in a consumer credit transaction (creditor rule, not a bank deposit fee rule).",
        "where_seen": "https://content.leg.colorado.gov/sites/default/files/images/olls/crs2024-title-05.pdf",
        "why_unconfirmed": "Section number not identified; seen only as a search summary."
      }
    ],
    "notes": "Seven searches used. The Division of Banking FAQ says no state limit exists on bank overdraft/returned-check fees. 2025-2026 bill search found no deposit-overdraft bill (HB26-1046 on earned-wage access requires providers to reimburse overdraft fees they cause; not a bank rule). NOT SEARCHED or not reached with dedicated queries: basic/lifeline account, check cashing by banks, fee change notice beyond Reg DD, ATM, bank garnishment processing fee. Parity/fee authority search returned nothing usable."
  },
  {
    "state_code": "CT",
    "state_name": "Connecticut",
    "topics_no_rule_found": [],
    "leads_unconfirmed": [
      {
        "topic": "overdraft_nsf",
        "claim": "No Connecticut bank may charge more than one overdraft fee or penalty per day to a bank customer.",
        "where_seen": "search summary of cga.ct.gov results (chap_665a and 2010 HB 5051 'An Act Concerning Overdraft Fees')",
        "why_unconfirmed": "Could not tell whether this language is in current § 36a-303 or only in a 2010 bill; account-freeze language in the same summary appears to come from an unenacted bill."
      },
      {
        "topic": "returned_item",
        "claim": "Older OLR reports state neither Connecticut nor federal law caps bank fees for returned checks; fees are a matter of contract.",
        "where_seen": "https://www.cga.ct.gov/2005/rpt/2005-R-0842.htm",
        "why_unconfirmed": "Report is dated; not a statute."
      },
      {
        "topic": "fee_authority",
        "claim": "§ 36a-250 (bank powers) and § 36a-455a (credit union powers) may include parity provisions.",
        "where_seen": "https://www.cga.ct.gov/current/PUB/chap_665.htm",
        "why_unconfirmed": "No fee-authority or parity text seen."
      }
    ],
    "notes": "Seven searches used. Institutions: the statutes use 'bank, Connecticut credit union or federal credit union' (36a-303, 36a-304), 'financial institution' (36a-319) and 'banking institution' (36a-316, 52-367b); definitions in Title 36a were not reviewed, so 'other' is used. 52-367b dollar figures ($800, $8) come from a 2020 supplement and should be checked against the current code. NOT SEARCHED: ATM surcharge rules, parity/wild-card text (search returned nothing specific), payee returned-check fees."
  },
  {
    "state_code": "DC",
    "state_name": "District of Columbia",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "returned_item",
      "fee_change_notice",
      "basic_account",
      "atm"
    ],
    "leads_unconfirmed": [
      {
        "topic": "dormancy",
        "claim": "Former D.C. Code § 41-106(e) barred holders from imposing dormancy charges on deposits without a written contract, regular imposition and written notice, limited to an amount not unconscionable.",
        "where_seen": "https://cfo.dc.gov/sites/default/files/dc/sites/ocfo/publication/attachments/ocfo_dc_unclaimed_property_law_title_41.pdf",
        "why_unconfirmed": "Appears to be the older Uniform Disposition of Unclaimed Property Act text; other sections of that chapter (e.g. § 41-120) are now marked repealed, so whether § 41-106(e) is still in force was not confirmed. The current rule appears to be § 41-156.02."
      },
      {
        "topic": "garnishment_legal_process",
        "claim": "DC Superior Court garnishment notices state that no funds may be attached from an account consisting solely of direct-deposited exempt benefits (Social Security, SSI, veterans, unemployment, TANF, workers' compensation, etc.).",
        "where_seen": "https://www.dccourts.gov/sites/default/files/pdf-forms/NoticeOfExemptionBeforeNewRule.pdf",
        "why_unconfirmed": "Seen in a court form, not in the statute; it protects exempt funds but says nothing about a bank's legal process fee."
      }
    ],
    "notes": "D.C. Code § 26-317 caps fees charged by licensed check cashers (not banks): the greater of 2% or $3 for government checks, 10% or $5 for personal checks or money orders, 4% or $5 for other instruments, plus a one-time $5 membership fee; it is a licensee rule, so it is not recorded as a bank rule. No DC Council overdraft or NSF fee bill was found. The effective date of the current unclaimed property chapter (§ 41-151.01 et seq.) was not confirmed."
  },
  {
    "state_code": "DE",
    "state_name": "Delaware",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "check_cashing",
      "returned_item",
      "fee_change_notice",
      "basic_account",
      "garnishment_legal_process",
      "fee_authority",
      "atm"
    ],
    "leads_unconfirmed": [
      {
        "topic": "dormancy",
        "claim": "Delaware's unclaimed property law (12 Del. C. ch. 11, subch. II, revised by SB 13 in 2017) may limit dormancy or inactivity charges on deposit accounts, as the Uniform Unclaimed Property Act does.",
        "where_seen": "https://vda.delaware.gov/?p=76 (search snippet described the Uniform Act rule, not Delaware's text)",
        "why_unconfirmed": "Could not find any Delaware statute or regulation text on dormancy charges; delcode.delaware.gov and legis.delaware.gov are blocked for direct fetch, and searches returned only the Uniform Act rule and a $5-per-mailing cap on holder notice costs for securities (12 DE Admin. Code 104), which is not a deposit fee rule."
      }
    ],
    "notes": "Searches of delcode.delaware.gov, legis.delaware.gov and banking.delaware.gov found no Delaware statute capping overdraft, NSF, maintenance or other consumer deposit fees. Direct fetches of the Delaware Code were blocked, so the Title 5 PDF could not be read in full; that is a gap, not proof no rule exists. The Delaware Banking Modernization Act of 2026 (SB 16, signed July 7, 2026) covers digital assets, governance and trust companies; search results showed no deposit fee provisions in it. Delaware's 2017 unclaimed property rewrite should be checked by a reviewer for a dormancy-charge provision."
  },
  {
    "state_code": "FL",
    "state_name": "Florida",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "basic_account"
    ],
    "leads_unconfirmed": [
      {
        "topic": "fee_authority",
        "claim": "Florida credit unions have the power to charge fees for their services.",
        "where_seen": "https://www.flsenate.gov/Laws/statutes/1999/657.031",
        "why_unconfirmed": "Seen only as a search summary of a 1999 version of § 657.031; current text and exact wording not confirmed. No bank parity/wild-card text found."
      },
      {
        "topic": "garnishment_legal_process",
        "claim": "Fla. Stat. § 655.0201 makes a financial institution's designated place or registered agent the sole location for service of garnishment, levy and similar process.",
        "where_seen": "https://m.flsenate.gov/Statutes/655.0201",
        "why_unconfirmed": "Service-of-process rule, not a fee rule; recorded only as context."
      }
    ],
    "notes": "Six searches used. No Florida overdraft/NSF cap found in chapter 655; a 2025-2026 bill search found no passed overdraft/NSF bill. Florida chapter 655 'financial institution' definition was not reviewed, hence institutions 'other' for § 655.85. NOT SEARCHED: fee change notice beyond Reg DD, ATM rules, returned deposited item fees. Chapter 832 (worthless checks) payee fees not recorded."
  },
  {
    "state_code": "GA",
    "state_name": "Georgia",
    "topics_no_rule_found": [
      "overdraft_nsf"
    ],
    "leads_unconfirmed": [
      {
        "topic": "garnishment_legal_process",
        "claim": "2020 Georgia garnishment legislation: statutory garnishee expenses do not interfere with any contractual arrangement for a garnishee (e.g., a bank) to reimburse itself for the costs of legal processing of a garnishment.",
        "where_seen": "https://www.legis.ga.gov/api/document/docs/default-source/house-budget-and-research-office-document-library/2020-end-of-session-report-by-committee-with-vetoes.pdf",
        "why_unconfirmed": "Seen only in a House session report summary; bill number and O.C.G.A. section not identified."
      },
      {
        "topic": "dormancy",
        "claim": "Georgia DBF 2026 proposed rulemaking (May 13, 2026) appeared in dormant-account search results; it may amend the dormant account rules.",
        "where_seen": "https://dbf.georgia.gov/document/document/2026-proposed-rulemaking-5-13-2026/download",
        "why_unconfirmed": "Content not seen."
      }
    ],
    "notes": "Six searches used. No Georgia dollar cap on overdraft/NSF fees found; the DBF 2013 declaratory orders classify overdraft fees as non-interest deposit fees not subject to usury limits. The two dormancy descriptions (no-contract $5 cap in Rule 80-1-8 vs. 'greater of $5 or active-account charge' on the DBF page) should be reconciled by the reviewer against current rule text. NOT SEARCHED: basic/lifeline account, check cashing by banks, fee change notice beyond Reg DD, ATM rules; garnishment search found no direct bank fee limit."
  },
  {
    "state_code": "HI",
    "state_name": "Hawaii",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "garnishment_legal_process"
    ],
    "leads_unconfirmed": [
      {
        "topic": "dormancy",
        "claim": "HRS § 523A-6 (Uniform Unclaimed Property Act) addresses dormancy charges that holders may deduct before reporting; holder guidelines reference it.",
        "where_seen": "https://budget.hawaii.gov/wp-content/uploads/2026/01/Holder-Reporting-Guidelines-Revised-January-2026.pdf",
        "why_unconfirmed": "Search could not surface the section text or conditions."
      },
      {
        "topic": "fee_authority",
        "claim": "HRS § 412:1-109 defines 'comparable financial institution' (a Hawaii bank is comparable to a national bank; a Hawaii credit union to a federal credit union), which suggests a parity mechanism elsewhere in chapter 412; § 412:5-200 grants banks general power to accept deposits and engage in activities usual or incidental to banking.",
        "where_seen": "https://files.hawaii.gov/dcca/dfi/Laws_html/HRS0412/HRS_0412-0001-0109.htm",
        "why_unconfirmed": "No parity or fee-setting text actually seen."
      },
      {
        "topic": "garnishment_legal_process",
        "claim": "HRS chapter 651/652 exempt from attachment child support money commingled in a bank account and federal EITC / child tax credit refunds. These are exemptions, not bank fee limits.",
        "where_seen": "https://www.capitol.hawaii.gov/hrscurrent/Vol13_Ch0601-0676/HRS0652/HRS_0652-.htm",
        "why_unconfirmed": "Exact section not identified; no bank garnishment fee rule found."
      }
    ],
    "notes": "Six searches used. Overdraft/NSF search on official sites returned only a $20 NSF check collection fee for depository financial services loan companies (a lender rule, not a deposit fee) and nothing on bank overdraft caps. NOT SEARCHED: basic/lifeline account, check cashing by banks, fee change notice beyond Reg DD, ATM rules."
  },
  {
    "state_code": "IA",
    "state_name": "Iowa",
    "topics_no_rule_found": [
      "check_cashing",
      "returned_item",
      "basic_account",
      "garnishment_legal_process",
      "atm"
    ],
    "leads_unconfirmed": [
      {
        "topic": "garnishment_legal_process",
        "claim": "Iowa Code ch. 642 garnishment rules reference applicable fees related to issuance of a garnishment and require a supervised financial organization garnished for an account to monitor it monthly; no bank fee cap or exempt-funds fee rule was found.",
        "where_seen": "https://www.legis.iowa.gov/docs/ico/chapter/642.pdf",
        "why_unconfirmed": "No fee-specific text found for banks."
      }
    ],
    "notes": "The 1994 bulletin is interpretive guidance, not a statute; it is still posted on the Division of Banking site. Dollar amounts in the bulletin ($3 daily, $12-$15 one-time) describe market practice in 1994 and are not limits, so they are not recorded as figures."
  },
  {
    "state_code": "ID",
    "state_name": "Idaho",
    "topics_no_rule_found": [
      "overdraft_nsf"
    ],
    "leads_unconfirmed": [
      {
        "topic": "overdraft_nsf",
        "claim": "Idaho credit union rules required share draft account operational specifications to include a summary of overdraft procedures and the fee charged for each overdraft.",
        "where_seen": "https://adminrules.idaho.gov/rules/2018%20Archive/12/120104.pdf",
        "why_unconfirmed": "Seen only in archived (1998/2018) IDAPA rules; current status unknown."
      },
      {
        "topic": "overdraft_nsf",
        "claim": "Idaho Department of Finance guidance treats an overdraft fee as a finance charge on an extension of credit that collection agencies may collect for bank/credit union clients when based on agreement.",
        "where_seen": "https://www.finance.idaho.gov/wp-content/uploads/legal/guidance/archive/documents/ca_act_faq.pdf",
        "why_unconfirmed": "Archived 2014 collection agency FAQ; not a fee limit."
      },
      {
        "topic": "dormancy",
        "claim": "If a holder imposes an inactivity charge and the abandonment period is longer than five years, the property is instead presumed abandoned five years after the owner's last indication of interest.",
        "where_seen": "search summary of legislature.idaho.gov / adminrules.idaho.gov unclaimed property results",
        "why_unconfirmed": "Source document not identified; may be from an archived rule."
      },
      {
        "topic": "payee_returned_check",
        "claim": "In a regulated consumer credit transaction a creditor may charge a dishonored check fee equal to the set collection fee under Idaho Code § 28-22-105 if contracted for.",
        "where_seen": "https://legislature.idaho.gov/statutesrules/idstat/title28/t28ch42/sect28-42-308/",
        "why_unconfirmed": "Creditor rule, low priority; amount not seen."
      }
    ],
    "notes": "Six searches used. No Idaho dollar cap on bank or credit union overdraft/NSF fees found; Idaho Code § 28-4-401 (UCC) lets a bank charge an item that creates an overdraft. NOT SEARCHED: basic/lifeline account, check cashing by banks, fee change notice beyond Reg DD, ATM rules."
  },
  {
    "state_code": "IL",
    "state_name": "Illinois",
    "topics_no_rule_found": [
      "overdraft_nsf"
    ],
    "leads_unconfirmed": [
      {
        "topic": "garnishment_legal_process",
        "claim": "A $1,000 automatic exemption for a judgment debtor's funds, defined in a new 735 ILCS 5/12-1001.1, applies after a final judgment.",
        "where_seen": "https://ilga.gov/documents/legislation/ilcs/documents/073500050K12-1001.htm ; https://witnessslips.ilga.gov/Legislation/BillStatus/FullText?GAID=18&DocNum=1738&DocTypeID=SB&LegId=160773&SessionID=114",
        "why_unconfirmed": "Search summary only; could not confirm whether this is enacted law or SB1738 bill text, its effective date, or whether it limits bank fees on levies."
      },
      {
        "topic": "overdraft_nsf",
        "claim": "HB4474 (104th GA, 'BANKS-OVERDRAFT FEE BAN') would direct IDFPR to adopt rules prohibiting banks, savings banks and credit unions from charging NSF/overdraft and returned deposited item fees on consumer accounts, and would repeal a provision that authorizes overdraft fees.",
        "where_seen": "https://www.ilga.gov/Legislation/BillStatus/FullText?GAID=18&DocNum=4474&DocTypeID=HB&LegId=165196&SessionID=114",
        "why_unconfirmed": "Bill introduced; no evidence it passed either chamber. The existing provision authorizing overdraft fees that it would repeal was not identified."
      },
      {
        "topic": "basic_account",
        "claim": "Whether a monthly maintenance fee is capped or barred on the 205 ILCS 605/4 Basic Checking Account.",
        "where_seen": "https://www.ilga.gov/legislation/ilcs/ilcs3.asp?ActID=1189&ChapterID=20",
        "why_unconfirmed": "Search summary did not show any monthly fee limit; the full section text could not be fetched (ilga.gov egress blocked)."
      }
    ],
    "notes": "Seven searches used. ilga.gov WebFetch is EGRESS_BLOCKED, so all text is from search-result summaries of ilga.gov pages; the reviewer should read 205 ILCS 605/4 in full (subsection (d) exception and any monthly fee terms). 'institutions: other' for the Consumer Deposit Account Act because the Act's definition of 'financial institution' was not seen. NOT SEARCHED: check cashing by banks, ATM surcharge, stop payment / deposited item return beyond the basic account provision, payee returned check."
  },
  {
    "state_code": "IN",
    "state_name": "Indiana",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "check_cashing",
      "basic_account",
      "garnishment_legal_process"
    ],
    "leads_unconfirmed": [
      {
        "topic": "dormancy",
        "claim": "The current dormancy-charge provision is IC 32-34-1.5-28, effective July 1, 2021.",
        "where_seen": "https://iga.in.gov/publications/senate_journal/js-apr21-2021-fortysixth.pdf",
        "why_unconfirmed": "Section number and effective date came from a Senate Journal amendment text, not the codified section; could not open the 2026 Title 32 PDF (fetch blocked)."
      }
    ],
    "notes": "Research incomplete: the shared WebSearch budget ran out before searches on fee authority/parity (IC 28-1-11, IC 28-7-1), returned items, fee-change notice and ATM. Topics not listed in topics_no_rule_found were not searched. Garnishment search found only court forms (sheriff service fees paid by the creditor), nothing on bank-charged fees."
  },
  {
    "state_code": "KS",
    "state_name": "Kansas",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "check_cashing",
      "returned_item",
      "fee_change_notice",
      "basic_account",
      "atm"
    ],
    "leads_unconfirmed": [
      {
        "topic": "fee_authority",
        "claim": "K.S.A. 9-1715 lets the state bank commissioner, by special order, authorize state banks to engage in any activity that other insured banks (national, state or other-state) may engage in; this is a general parity power, not specific to fees.",
        "where_seen": "https://kslegislature.gov/li_2022/b2021_22/statute/009_000_0000_chapter/009_017_0000_article/009_017_0015_section/009_017_0015_k/",
        "why_unconfirmed": "Official text seen, but no source ties it to deposit fees; recorded as a lead only."
      }
    ],
    "notes": "Garnishment fee text was seen on the 2020 statute page; confirm no later amendment. Kansas UCCC (K.S.A. 16a-2-501) insufficient-check charges apply to consumer credit lenders, not deposit accounts, and were not recorded. 2026 SB 352 (digital assets in unclaimed property) does not touch deposit fees."
  },
  {
    "state_code": "KY",
    "state_name": "Kentucky",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "garnishment_legal_process",
      "basic_account",
      "fee_change_notice"
    ],
    "leads_unconfirmed": [
      {
        "topic": "dormancy",
        "claim": "A holder may deduct a dormancy charge from property delivered to the administrator only if a valid contract authorizes it and the holder regularly imposes and does not reverse it, in an amount that is not unconscionable.",
        "where_seen": "https://apps.legislature.ky.gov/recorddocuments/bill/18RS/hb394/bill.pdf ; https://apps.legislature.ky.gov/law/acts/18RS/documents/0163.pdf",
        "why_unconfirmed": "Text seen in 2018 HB 394 (abandoned property); whether this provision is in the enacted Acts ch. 163 and its KRS section were not confirmed."
      },
      {
        "topic": "check_cashing",
        "claim": "A bank must cash free of charge, by end of day, a check drawn on an account at the bank when presented by the payee in Kentucky with sufficient funds; for checks not drawn on the bank, the fee may not exceed $4.",
        "where_seen": "https://apps.legislature.ky.gov/recorddocuments/bill/19RS/hb452/orig_bill.pdf",
        "why_unconfirmed": "Appears to be from a 2019 introduced bill (HB 452, 'An Act relating to check cashing'); no evidence it was enacted."
      },
      {
        "topic": "fee_authority",
        "claim": "KRS 286.3-190 sets out powers of Kentucky state banks.",
        "where_seen": "https://apps.legislature.ky.gov/law/statutes/statute.aspx?id=14551",
        "why_unconfirmed": "Section title only; text on fees or national-bank parity not seen."
      }
    ],
    "notes": "Six searches used. The overdraft search returned only lender rules (KRS 286.4-533 consumer loan returned-payment charge of $25, deferred deposit rules), which do not govern bank deposit fees. 2026 SB 219 (Acts ch. 98, law without signature 4/12/26) concerns deferred deposit fees, not bank deposit fees. Garnishment search found KRS 427.010 exemptions and benefit exemptions but no bank fee limit. NOT SEARCHED: ATM, stop payment / deposited item return."
  },
  {
    "state_code": "LA",
    "state_name": "Louisiana",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "dormancy",
      "garnishment_legal_process"
    ],
    "leads_unconfirmed": [
      {
        "topic": "check_cashing",
        "claim": "A payor state bank must pay a check drawn on it against an account with sufficient balance whether or not the payee holds an account at the bank; it may require identification; OFI enforces. Search summary attributed this to R.S. 10:4-112.",
        "where_seen": "https://www.legis.la.gov/legis/ViewDocument.aspx?d=875592 ; https://legis.la.gov/legis/Law.aspx?d=107803",
        "why_unconfirmed": "Text appears in a 2014 original Senate bill (SLS 14RS-441); enactment and current codification not confirmed, and the excerpt seen does not mention fees."
      },
      {
        "topic": "fee_authority",
        "claim": "R.S. 6:667.1 gives federal credit unions and federally insured credit unions all rights, powers and privileges provided by Louisiana law (reverse parity).",
        "where_seen": "https://www.legis.la.gov/legis/Law.aspx?d=106092",
        "why_unconfirmed": "Search summary only; it is not a fee-setting authority for state credit unions, and no state credit union fee-authority or federal-parity provision was seen."
      },
      {
        "topic": "payee_returned_check",
        "claim": "A payee or holder may charge the drawer of a dishonored check a service charge up to $25 or 5% of the check, whichever is greater, when making written demand.",
        "where_seen": "https://www.legis.la.gov/legis/LawPrint.aspx?d=106285",
        "why_unconfirmed": "Payee rule, not a bank fee rule; section number not shown in the result."
      }
    ],
    "notes": "Six searches used. Returned-check fee caps found in the first search apply to consumer credit, motor vehicle credit and premium finance creditors, not to bank deposit accounts. Check casher fee caps (2% or $5 for government checks; 10% or $5 otherwise, R.S. 6:1001 et seq.) apply to licensed check cashers, not banks. Dormancy search on the Uniform Unclaimed Property Act of 1997 (R.S. 9:151 et seq.) did not surface any dormancy-charge text. Garnishment search found R.S. 13:3881 exemptions (2026 Act 55 / HB 135 added HSA exemption) but no bank fee rule. NOT SEARCHED: basic/lifeline account, fee change notice, ATM, stop payment."
  },
  {
    "state_code": "MA",
    "state_name": "Massachusetts",
    "topics_no_rule_found": [
      "check_cashing"
    ],
    "leads_unconfirmed": [
      {
        "topic": "basic_account",
        "claim": "Massachusetts Basic Banking Program: basic checking costs no more than $10 to open, no monthly fee at balances of $10 or more, at most $1/month below $10; basic savings at most $25 to open, at most $3/month, at least 15 free withdrawals (8 checks), at most $1 per extra withdrawal.",
        "where_seen": "https://www.mass.gov/info-details/savings-and-checking-accounts",
        "why_unconfirmed": "Described by mass.gov as a program many state-chartered institutions offer; no statute or regulation making it mandatory was found, so it appears voluntary."
      },
      {
        "topic": "dormancy",
        "claim": "H.2976 (190th General Court, 2017) would amend ch. 167D § 5 to bar a fee for inactive accounts.",
        "where_seen": "https://malegislature.gov/Bills/190/H2976.Html",
        "why_unconfirmed": "Bill only; no evidence it passed."
      },
      {
        "topic": "other",
        "claim": "18-65 law for credit unions: exact ch. 171 section number added by St. 2020, c. 338 was not seen.",
        "where_seen": "https://www.mass.gov/regulatory-bulletin/21-106-guidelines-for-18-65-accounts-for-banks-and-credit-unions",
        "why_unconfirmed": "Section number not shown in results."
      }
    ],
    "notes": "All official text came through WebSearch excerpts of malegislature.gov and mass.gov; direct fetches were blocked. The $5 NSF cap on 18-65 accounts was seen in the Division of Banks bulletin; whether it is in the statute text itself should be checked. The 18-65 scope (all accounts of qualifying persons vs. a designated account product) should be read in the statute. The DRI cap changes every August; the 2025 figure ($7.14) ran to July 31, 2026 and a 2026 decision was not looked up. The search budget ran out partway through this assignment. Topics not listed as rules or leads were not all searched; absence here is not a finding."
  },
  {
    "state_code": "MD",
    "state_name": "Maryland",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "fee_change_notice"
    ],
    "leads_unconfirmed": [
      {
        "topic": "fee_authority",
        "claim": "Maryland state-chartered credit unions may exercise the powers of federal credit unions on request and approval; a 2021 bill (HB1004) would streamline that parity approval.",
        "where_seen": "https://mgaleg.maryland.gov/cmte_testimony/2021/fin/4303_03242021_8213-535.pdf",
        "why_unconfirmed": "Seen only in trade association testimony; statute section and the bill's outcome not confirmed."
      },
      {
        "topic": "payee_returned_check",
        "claim": "If a dishonored check is not paid within 30 days after notice of dishonor, the drawer is liable for the check amount, a collection fee up to $35, and up to twice the check amount up to $1,000.",
        "where_seen": "mgaleg.maryland.gov search results (exact section not identified)",
        "why_unconfirmed": "Payee rule, not a bank fee rule; section number not seen."
      },
      {
        "topic": "check_cashing",
        "claim": "Licensed check cashers may charge up to 2% or $3, whichever is greater, for government checks; 2020 SB 939 (ch. 444) on check cashing services exempts federal and Maryland chartered financial institutions.",
        "where_seen": "https://labor.maryland.gov/finance/consumers/frcheckcash.shtml ; https://labor.maryland.gov/finance/industry/sb939.shtml",
        "why_unconfirmed": "Applies to licensed check cashers, not shown to bind banks or credit unions."
      }
    ],
    "notes": "Seven searches used. The Office of Financial Regulation consumer page (labor.maryland.gov/finance/banks/deposit-accounts.shtml) describes federal opt-in rules and fee disclosure only; no Maryland overdraft/NSF cap was found. GFI § 12-918 appeared in an overdraft search result but its content was not seen. NOT SEARCHED: basic/lifeline account (search combined with parity returned nothing on it, so treat as not checked), ATM, stop payment / deposited item return."
  },
  {
    "state_code": "ME",
    "state_name": "Maine",
    "topics_no_rule_found": [],
    "leads_unconfirmed": [
      {
        "topic": "overdraft_nsf",
        "claim": "9-B M.R.S. § 241(6) is referenced as the authority under which a bank's NSF charge is 'legally assessed'.",
        "where_seen": "https://www1.maine.gov/pfr/financialinstitutions/sites/maine.gov.pfr.financialinstitutions/files/pdf/advisory-rulings/1990-04-02-Advisory-Ruling-95.pdf",
        "why_unconfirmed": "1990 advisory ruling reference only; § 241(6) text not seen."
      }
    ],
    "notes": "Six searches used. LD 142 (2025) did NOT enact a statutory one-NSF-fee limit; it became a Resolve directing guidance. The 30-day fee-increase notice is stated by the Bureau but its statutory section was not identified; reviewer should locate it (possibly in Title 9-B ch. 42 or a Bureau regulation). NOT SEARCHED: basic/lifeline account (a combined search returned nothing on it), fee authority/parity for state banks and credit unions, check cashing, ATM, stop payment."
  },
  {
    "state_code": "MI",
    "state_name": "Michigan",
    "topics_no_rule_found": [
      "overdraft_nsf"
    ],
    "leads_unconfirmed": [
      {
        "topic": "garnishment_legal_process",
        "claim": "HB 4900 (2023-24) would add MCL 600.4033: deposit accounts exempt up to the greater of $800 or a calculated amount of exempt-source deposits from the prior 90 days, and a financial institution could not charge a debtor a garnishment fee unless it is a reasonable fee disclosed in its regular fee schedule. It passed the Senate on December 20, 2024 (companion SB 408).",
        "where_seen": "https://legislature.mi.gov/documents/2023-2024/billengrossed/House/pdf/2023-HEBS-4900.pdf",
        "why_unconfirmed": "Enactment not confirmed. One search summary claimed a veto on 07/10/2026, which does not fit a 2023-24 bill, so the final status is unknown. One summary also wrongly placed the fee language in MCL 600.4012."
      },
      {
        "topic": "overdraft_nsf",
        "claim": "SB 360 (2025) passed the Senate on August 26, 2025; the Attorney General has an 'Overdraft Fee Rules' consumer page and an April 2025 press release on overdraft fees.",
        "where_seen": "https://legislature.mi.gov/documents/2025-2026/billengrossed/Senate/pdf/2025-SEBS-0360.pdf",
        "why_unconfirmed": "The content of SB 360 was not seen, so it is not known to concern deposit fees; the AG page appears to describe federal rules."
      },
      {
        "topic": "check_cashing",
        "claim": "Whether the Banking Code of 1999 has a check cashing fee cap for state banks like MCL 490.412.",
        "where_seen": "n/a",
        "why_unconfirmed": "Not searched before the search budget ran out."
      }
    ],
    "notes": "Direct fetches to legislature.mi.gov were not tried after other legislature sites were blocked; all text came from search excerpts. A parity or fee-authority provision for state banks in the Banking Code of 1999 (MCL 487.11101 et seq.) was not found. The search budget ran out partway through this assignment. Topics not listed as rules or leads were not all searched; absence here is not a finding."
  },
  {
    "state_code": "MN",
    "state_name": "Minnesota",
    "topics_no_rule_found": [],
    "leads_unconfirmed": [
      {
        "topic": "garnishment_legal_process",
        "claim": "HF 4100 (2024) and HF 3188 (2025) would bar financial institutions from charging debtors a fee for receiving a garnishment summons.",
        "where_seen": "https://www.revisor.mn.gov/bills/94/2025/0/HF/3188/versions/0/",
        "why_unconfirmed": "Introduced bills; no evidence either was enacted. 2025 Session Law ch. 18 (SF 2847, approved 05/08/2025) changed garnishment forms and notices but was not seen to add a fee ban."
      },
      {
        "topic": "check_cashing",
        "claim": "Presumed fair fee for cashing a government check up to $500 is the greater of 2.5% or $1 (up to 5% for a first-time customer).",
        "where_seen": "https://www.revisor.mn.gov/rules/2872.0100/",
        "why_unconfirmed": "This appears to be a currency exchange rule (ch. 53A licensees), not a bank rule; not confirmed to apply to banks or credit unions."
      },
      {
        "topic": "fee_authority",
        "claim": "A parity statute letting state banks do what national banks may do (beyond investments).",
        "where_seen": "https://www.revisor.mn.gov/statutes/2025/2025-10-19%2010:04:35+00:00/cite/48.61/pdf",
        "why_unconfirmed": "Only § 48.61 subd. 8 (investments in securities) was seen; no general bank parity found."
      }
    ],
    "notes": "\"Financial intermediary\" in § 48.512 is defined in that section; the definition was not seen, so institutions is 'other' for those two rules. § 47.76 reaches federal institutions on its face; preemption for national banks and federal credit unions is a question for the reviewing lawyer. The § 345.32 wording on one-year service charge deduction should be read in full. Overdraft, ATM and fee-change notice were not searched before the search budget ran out. Direct fetch to revisor.mn.gov returned EGRESS_BLOCKED."
  },
  {
    "state_code": "MO",
    "state_name": "Missouri",
    "topics_no_rule_found": [
      "garnishment_legal_process"
    ],
    "leads_unconfirmed": [
      {
        "topic": "overdraft_nsf",
        "claim": "Text stating that any depository institution (state or federal bank, credit union, S&L) may charge up to $20 as an overdraft charge on first presentment or up to $15 for an item returned for insufficient funds (another version: no more than $15 for either).",
        "where_seen": "https://senate.mo.gov/03info/billtext/intro/sb346.htm ; https://www.senate.mo.gov/02info/pdf-bill/tat/SB895.pdf ; https://house.mo.gov/billtracking/bills061/billpdf/intro/HB1227I.PDF ; https://senate.mo.gov/23info/pdf-bill/tat/SB103.pdf",
        "why_unconfirmed": "Seen only in bill texts (2002, 2003, 2006, 2023); not found in a revisor.mo.gov statute section; no evidence of enactment. Would also sit uneasily with RSMo 362.111."
      },
      {
        "topic": "garnishment_legal_process",
        "claim": "Funds on deposit are not subject to garnishment if all funds are deposited electronically on a recurring basis and reasonably identified as exempt under RSMo 513.430.1(10)(a)-(c) or 31 C.F.R. Part 212; for accounts receiving exempt electronic deposits the attachment date is the day the institution performs the federal look-back.",
        "where_seen": "https://www.revisor.mo.gov/main/OneSection.aspx?section=525.235&bid=60211 ; https://www.courts.mo.gov/page.jsp?id=199872",
        "why_unconfirmed": "Could not tell whether this text is RSMo 525.235 or Supreme Court Rule 90; does not address bank fees."
      },
      {
        "topic": "payee_returned_check",
        "claim": "A payee of a dishonored check may collect from the drawer $20 plus the depository institution's actual return charge.",
        "where_seen": "https://revisor.mo.gov/main/OneSection.aspx?section=400.4-401 (search result set)",
        "why_unconfirmed": "Payee rule; section number not confirmed."
      }
    ],
    "notes": "Six searches used. 'institutions: other' for § 447.200 because the search summary says 'bank or financial organization' without defining scope. RSMo 400.4-401 (UCC) lets a bank charge an overdraft item that is properly payable; not a fee rule. Credit union search found only RSMo 370.107 (examiner pay parity), not a fee-authority or federal-parity power. NOT SEARCHED: basic/lifeline account, check cashing, fee change notice, ATM, stop payment."
  },
  {
    "state_code": "MS",
    "state_name": "Mississippi",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "garnishment_legal_process"
    ],
    "leads_unconfirmed": [
      {
        "topic": "fee_authority",
        "claim": "A Department of Banking and Consumer Finance document refers to service charges assessed on demand deposit accounts under Miss. Code § 81-3-11.",
        "where_seen": "https://www.sos.ms.gov/adminsearch/ACCode/00000214c.pdf ; https://dbcf.ms.gov/wp-content/uploads/2020/06/18673d7a-4ddc-43c9-9b1a-6a9736793397.pdf",
        "why_unconfirmed": "Only a passing reference (in a bank organization application); the section text was not seen in two searches."
      },
      {
        "topic": "fee_authority",
        "claim": "The Commissioner of Banking and Consumer Finance may by rule authorize a Mississippi credit union to engage in any activity or exercise any power it could if it were a federal credit union (Miss. Code tit. 81, ch. 13).",
        "where_seen": "https://dbcf.ms.gov/banks-and-credit-unions/ and billstatus.ls.state.ms.us search results",
        "why_unconfirmed": "Search summary did not show which document or section the text came from; could be bill text."
      },
      {
        "topic": "dormancy",
        "claim": "Under the Mississippi unclaimed property act (Miss. Code tit. 89, ch. 12), a holder may deduct a dormancy-type charge from presumed-abandoned property only if a valid, enforceable written contract permits it, the holder regularly imposes and does not regularly reverse it, and the amount is not unconscionable.",
        "where_seen": "https://treasury.ms.gov/wp-content/uploads/2020/06/Holder-Reporting-Instructions.pdf ; billstatus.ls.state.ms.us bill texts (e.g., 2019 HB1513, 2026 SB2714 as passed the Senate)",
        "why_unconfirmed": "Could not tell whether the text came from current codified law or a bill; section number not seen."
      },
      {
        "topic": "check_cashing",
        "claim": "Mississippi Check Cashers Act rules (Part 3, Ch. 3) regulate licensed check cashers.",
        "where_seen": "https://dbcf.ms.gov/wp-content/uploads/2020/06/Check-Casher-Regulations-Effective-12-1-12-PDF.pdf",
        "why_unconfirmed": "Applies to licensed check cashers, not shown to apply to banks or credit unions."
      },
      {
        "topic": "other",
        "claim": "DBCF posts legislative updates for the 2025 and 2026 regular sessions; 2026 HB1597 ('Mississippi Fair Banking Standards Act') passed the House.",
        "where_seen": "https://dbcf.ms.gov/wp-content/uploads/2026/05/Legislative-Update-for-Website.2026-Regular-Session.Revised.pdf ; https://billstatus.ls.state.ms.us/documents/2026/html/HB/1500-1599/HB1597PS.htm",
        "why_unconfirmed": "Contents not seen; no sign either addresses consumer deposit fees."
      }
    ],
    "notes": "Extended from a partial earlier pass (three searches) with six more searches this pass. 'institutions: other' on the parity rule because it covers state banks, savings associations and savings banks (not credit unions). Overdraft search found only bills: 2025 SB2082 and HB1044 would let the State Treasurer set fees (including overdraft, NSF and stop payment) on state depository accounts, which concern the State's own accounts, not consumer accounts. Garnishment search found only bill texts on bank garnishee procedure (accounting for deposits between service and answer; exempt directly deposited Social Security/VA funds) and no bank fee rule. NOT SEARCHED: basic/lifeline account, fee change notice, ATM, stop payment / deposited item return."
  },
  {
    "state_code": "MT",
    "state_name": "Montana",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "returned_item",
      "basic_account",
      "check_cashing",
      "fee_change_notice",
      "garnishment_legal_process"
    ],
    "leads_unconfirmed": [
      {
        "topic": "garnishment_legal_process",
        "claim": "Earnings exempt under MCA 25-13-614 remain exempt for 45 days after receipt while traceable (MCA 25-13-610 tracing); HSAs/medical savings accounts exempt under 25-13-603.",
        "where_seen": "https://leg.mt.gov/bills/mca/title_0250/chapter_0130/part_0060/section_0100/0250-0130-0060-0100.html",
        "why_unconfirmed": "Debtor exemption rules that do not address any bank fee; recorded as context only."
      }
    ],
    "notes": "ARM 44.2.205 ($15/$25 returned check service fees) applies to returned checks paid to a state office, not bank fees; MCA 27-1-717 is a payee civil-liability bad check statute (amounts not reviewed). No state overdraft/NSF cap found. NOT SEARCHED: atm."
  },
  {
    "state_code": "NC",
    "state_name": "North Carolina",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "basic_account",
      "garnishment_legal_process"
    ],
    "leads_unconfirmed": [
      {
        "topic": "fee_change_notice",
        "claim": "NC Commissioner of Banks FAQ says banks may charge non-interest charges and fees, must disclose fees at account opening and give advance notice if fees change.",
        "where_seen": "https://nccob.nc.gov/financial-institutions/banks-trusts/banking-frequently-asked-questions",
        "why_unconfirmed": "Regulator FAQ seen only as a search summary; it does not cite a state statute and may describe federal Reg DD requirements."
      }
    ],
    "notes": "No state overdraft/NSF dollar cap for banks or credit unions surfaced; the savings bank and S&L statutes authorize a returned/NSF check processing fee, and whether they set an amount was not visible in the search result. Garnishment search returned only tax-collection attachment (G.S. 105-368) and benefit-specific exemptions, nothing on bank fees. NOT SEARCHED: check_cashing, atm, credit union parity with federal credit unions (searched once, not found), state bank wild-card parity."
  },
  {
    "state_code": "ND",
    "state_name": "North Dakota",
    "topics_no_rule_found": [
      "basic_account"
    ],
    "leads_unconfirmed": [
      {
        "topic": "payee_returned_check",
        "claim": "Collection fees or costs for a check returned for nonsufficient funds may not exceed $40 (likely in N.D.C.C. ch. 6-08, around § 6-08-16).",
        "where_seen": "https://ndlegis.gov/cencode/t06c08.pdf (search summary)",
        "why_unconfirmed": "Exact section and whether it is a payee collection fee were not confirmed; low priority."
      },
      {
        "topic": "fee_authority",
        "claim": "The State Credit Union Board issues parity orders letting state-chartered credit unions act as federal credit unions may (e.g., June 5, 2020 orders on public-unit and nonmember shares).",
        "where_seen": "https://www.nd.gov/dfi/sites/www/files/documents/State%20Credit%20Union%20Board/Orders/SCUBOrder206052020.pdf",
        "why_unconfirmed": "The orders seen concern share deposits, not fees; the statutory parity section for credit unions was not identified."
      }
    ],
    "notes": "5 searches used. Basic-account search found only Bank of North Dakota's own product pages, no statute. NOT SEARCHED: check cashing by banks, ATM, fee-change notice, exempt-funds fee protection beyond § 32-09.1-10 (the garnishment chapter was not searched for a ban on fees against exempt funds). No ND file existed before this pass."
  },
  {
    "state_code": "NE",
    "state_name": "Nebraska",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "basic_account"
    ],
    "leads_unconfirmed": [
      {
        "topic": "garnishment_legal_process",
        "claim": "A financial institution garnishee must be paid a $15 fee by the plaintiff at service of a garnishment summons (taxed as costs; garnishment void if unpaid; separate fee per defendant), and if the institution may charge its customer a garnishment processing fee, the $15 received must be deducted from that customer fee. 'Financial institution' covers banks, savings banks, building and loan and savings and loan associations, and credit unions, whether federally or state chartered.",
        "where_seen": "https://www.nebraskalegislature.gov/laws/statutes.php?statute=25-1056 ; https://nebraskalegislature.gov/FloorDocs/104/PDF/Slip/LB195.pdf",
        "why_unconfirmed": "Text seen on nebraskalegislature.gov, but the search could not pin whether it sits in current § 25-1010 or § 25-1056 or only in bill text (LB195 of 2015 was approved; LB229/LB37 of 2017 were introduced). Likely current law; reviewer should confirm section and figure before promoting to a rule."
      },
      {
        "topic": "overdraft_nsf",
        "claim": "A Nebraska state consumer page 'Overdraft Fees: What You Need to Know' exists.",
        "where_seen": "https://makecentsmakesense.nebraska.gov/overdraft-fees-what-you-need-know",
        "why_unconfirmed": "Content not seen; no state overdraft cap surfaced."
      }
    ],
    "notes": "Neb. Rev. Stat. 45-918.01 caps a delayed deposit (payday) licensee's returned check charge at $15 - a payee/licensee rule, not a bank fee rule. UCC 4-401 lets a bank charge a properly payable item even if it creates an overdraft (general UCC). NOT SEARCHED: check_cashing, fee_change_notice, atm, payee_returned_check."
  },
  {
    "state_code": "NH",
    "state_name": "New Hampshire",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "basic_account"
    ],
    "leads_unconfirmed": [
      {
        "topic": "other",
        "claim": "RSA 384-G:7 is titled 'Overdraft Accounts' within RSA 384-G (Regulation of Revolving Credit Plans).",
        "where_seen": "https://gc.nh.gov/rsa/html/NHTOC/NHTOC-XXXV-384-G.htm",
        "why_unconfirmed": "Only the title was seen; it appears to govern overdraft lines of credit under revolving credit plans, not deposit overdraft fees. Text not reviewed."
      },
      {
        "topic": "atm",
        "claim": "RSA 383-B search summary mentioned ATM disclosure requirements.",
        "where_seen": "https://gc.nh.gov/rsa/html/xxxv/383-b/383-b-mrg.htm",
        "why_unconfirmed": "No text or section seen."
      }
    ],
    "notes": "HB 1207 (signed July 10, 2026) changes examination fees and licensing, not consumer deposit fees. RSA 6:11-a lets STATE agencies charge $25 or 5% for checks returned to them (not a bank fee rule, not recorded). NOT SEARCHED: check_cashing, fee_change_notice, returned_item (beyond the broad overdraft search), payee_returned_check (RSA 544-B:1 seen only by title)."
  },
  {
    "state_code": "NJ",
    "state_name": "New Jersey",
    "topics_no_rule_found": [
      "overdraft_nsf"
    ],
    "leads_unconfirmed": [
      {
        "topic": "overdraft_nsf",
        "claim": "Bill text would have the Commissioner of Banking set by regulation the maximum fee for a check drawn on insufficient or uncollected funds, and bar any fee on a deposited item returned unpaid when the payee is someone other than the depositor.",
        "where_seen": "https://pub.njleg.gov/bills/9899/A1500/1317_I1.PDF",
        "why_unconfirmed": "This is introduced bill text (Assembly No. 1317, 208th Legislature, 1998-99); no evidence it was enacted."
      },
      {
        "topic": "garnishment_legal_process",
        "claim": "A levy must exclude all funds in an account if all deposits in the 90 days before the writ were recurring electronic deposits of exempt funds; garnishee must protect the exempt amount and preserve access.",
        "where_seen": "https://www.njcourts.gov/sites/default/files/forms/12323_obj_bank_levy.pdf",
        "why_unconfirmed": "Seen in search summary of court forms/bills; could not tie it to a specific enacted statute or court rule, and nothing about a bank processing fee."
      },
      {
        "topic": "garnishment_legal_process",
        "claim": "$10,000 in a deposit account ($15,000 joint) exempt from execution; garnishee to garnish only the excess.",
        "where_seen": "https://pub.njleg.state.nj.us/Bills/2024/A4000/3513_I1.PDF",
        "why_unconfirmed": "Appears in introduced bill text (A3513, 2024); enactment not confirmed."
      }
    ],
    "notes": "A NJ DOBI consumer FAQ (https://www.nj.gov/dobi/division_consumers/finance/bankfaqs.htm), per the search summary, says no state or federal law limits what a bank can charge for its fees; no enacted overdraft/NSF cap was found in 2025-2026 bill searches. The Consumer Checking Account number-of-checks term was not found in official text. NOT SEARCHED: check_cashing (beyond one incidental result), returned_item beyond the old bill, fee_change_notice (searched once without result), atm, payee_returned_check."
  },
  {
    "state_code": "NM",
    "state_name": "New Mexico",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "basic_account"
    ],
    "leads_unconfirmed": [
      {
        "topic": "dormancy",
        "claim": "HB 165 (2023) would enact the Revised Uniform Unclaimed Property Act (NMSA 7-8B), with § 7-8B-602 allowing a dormancy charge deduction only under a valid contract in a record, regularly imposed and not regularly reversed, and limited to an amount that is not unconscionable; it repeals the prior Uniform Unclaimed Property Act (7-8A).",
        "where_seen": "https://www.nmlegis.gov/Sessions/23%20Regular/final/HB0165.pdf",
        "why_unconfirmed": "A 'final' version exists, but signing/enactment and effective date were not confirmed, and a 2024 bill (SB 237) fiscal report on the same subject suggests it may not have become law. Current 7-8A dormancy text was not found."
      },
      {
        "topic": "overdraft_nsf",
        "claim": "Small loan licensees (not banks) may charge at most $15 for a check or debit returned for insufficient funds, one fee per item, under NMSA § 58-15-20.",
        "where_seen": "https://www.srca.nm.gov/parts/title03/03.002.0219.html",
        "why_unconfirmed": "Applies to small loan licensees as payee, not to deposit fees; recorded only as context."
      }
    ],
    "notes": "The NM Financial Institutions Division FAQ (https://www.rld.nm.gov/financial-institutions/about-us/faqs/), per the search summary, says there is no maximum on overdraft or NSF fees and banks and credit unions set their own. Dormancy: only the possibly-unenacted 2023 RUUPA text was found (see leads). NOT SEARCHED: check_cashing, fee_change_notice, atm, returned_item beyond the broad search."
  },
  {
    "state_code": "NV",
    "state_name": "Nevada",
    "topics_no_rule_found": [],
    "leads_unconfirmed": [
      {
        "topic": "garnishment_legal_process",
        "claim": "SB 142 (2025, 83rd Session) would replace the $2,000/$400 two-tier bank account exemption in NRS 21.105 with a flat $5,000 exemption regardless of deposit source, and have the Department of Taxation adjust exemption amounts every 3 years.",
        "where_seen": "https://archive.leg.state.nv.us/Session/83rd2025/Bills/SB/SB142_R1.pdf",
        "why_unconfirmed": "Search summary said the bill 'has been passed', but enactment, chapter number and effective date were not seen. If enacted, the NRS 21.105 rule above is outdated."
      }
    ],
    "notes": "NRS 657.120 applies to 'financial institutions' as defined for NRS chapter 657; exact definition not checked, so institutions is 'other'. The SB 142 (2025) status must be checked before relying on the NRS 21.105 figures. NOT SEARCHED: basic_account, check_cashing, fee_change_notice, atm, returned_item beyond NRS 657.120."
  },
  {
    "state_code": "NY",
    "state_name": "New York",
    "topics_no_rule_found": [
      "check_cashing"
    ],
    "leads_unconfirmed": [
      {
        "topic": "overdraft_nsf",
        "claim": "The 2025 DFS pre-proposal would also require at least 30 days' notice before an increase in NSF or overdraft fees and require fees to be a fixed amount, with the NSF fee not above the overdraft fee.",
        "where_seen": "https://www.steptoe.com/en/news-publications/nydfs-proposals-target-overdraft-fees.html ; https://www.hklaw.com/en/insights/publications/2025/01/overdraft-free-new-yorks-pre-proposed-outreach-on-bank-fees",
        "why_unconfirmed": "Seen only in law firm summaries; draft rule text not seen on dfs.ny.gov. Pre-proposal only."
      },
      {
        "topic": "returned_item",
        "claim": "The 2025 DFS draft amendments to Parts 32 and 6 also address returned deposited item fees.",
        "where_seen": "DFS 2024 CPFED annual report (dfs.ny.gov) says CEU revised regulations on 'overdraft, non-sufficient funds, and return deposit item fees pursuant to Section 9-y'",
        "why_unconfirmed": "The specific returned-deposit provision in the draft was not seen; search budget ran out before it could be checked."
      },
      {
        "topic": "overdraft_nsf",
        "claim": "Existing 3 NYCRR Part 32 sets maximum charges or conditions for payments against insufficient funds, uncollected balances and return items.",
        "where_seen": "Title quoted in DFS 2026 Regulatory Agenda (dfs.ny.gov)",
        "why_unconfirmed": "Only the title of Part 32 was seen, not its current text or any dollar limit."
      },
      {
        "topic": "fee_change_notice",
        "claim": "A Banking Law § 9-y provision requiring written notice of overdraft fees charged every 180 days (dates, amounts, total, right to negotiate, contact), effective Jan. 1, 2023.",
        "where_seen": "nysenate.gov search summary drawing on 2021 S7202",
        "why_unconfirmed": "Appears to come from a bill (2021 S7202); enactment not confirmed and it conflicts with the order-of-payment text seen for 9-y."
      },
      {
        "topic": "check_cashing",
        "claim": "No banking organization may charge a payee any fee to cash a check drawn on an account at that bank, customer or not.",
        "where_seen": "nysenate.gov bill text (2017-2021 bills, e.g. S7535/A10754)",
        "why_unconfirmed": "Seen only in bill text; no evidence it was enacted."
      },
      {
        "topic": "overdraft_nsf",
        "claim": "2023 S7742/A8266 would require annual overdraft revenue reporting and a ten-day grace period before overdraft fees.",
        "where_seen": "web search summary (nysenate.gov bill pages)",
        "why_unconfirmed": "Search summary claimed it was signed but was unreliable; not confirmed."
      },
      {
        "topic": "dormancy",
        "claim": "2025 S4109 would extend dormancy periods for many accounts from three to five years.",
        "where_seen": "https://www.nysenate.gov/legislation/bills/2025/S4109",
        "why_unconfirmed": "Bill only; passage not checked."
      },
      {
        "topic": "atm",
        "claim": "N.Y. General Business Law § 399-y bars an ATM operator from imposing a fee unless it gives on-screen or paper notice, after the transaction starts but before the consumer is committed, that a fee applies and its amount, and the consumer chooses to continue.",
        "where_seen": "nysenate.gov bill pages (e.g. 2013 S6391, S748, S3571) found by search",
        "why_unconfirmed": "Text was seen in bill pages that amend or cite the section, not in the enacted section itself; current wording not confirmed."
      },
      {
        "topic": "fee_change_notice",
        "claim": "A Banking Law § 9-x requires written notice to a customer 30 days before charging any fee based on account inactivity.",
        "where_seen": "nysenate.gov bill pages (search summary of 2009-2021 bills)",
        "why_unconfirmed": "Seen only in bill text; whether this is enacted § 9-x was not confirmed."
      }
    ],
    "notes": "The task brief referred to '3 NYCRR Part 6' for basic banking; DFS's own pages place the basic banking rules in 3 NYCRR Part 9, while the 2025 overdraft pre-proposal amends Parts 32 and 6 (law firm summaries). The DFS overdraft/NSF rules are a pre-proposal draft (Jan. 22, 2025), followed by a Sept. 5, 2025 RFI and a 2026 Regulatory Agenda listing; no formal State Register proposal or adoption was found as of this research (Oct. 2026), but a later formal proposal may exist. DFS Industry Letter July 12, 2022 is guidance on unfair/deceptive OD/NSF practices (not a rule). Wave 2 (3 searches) covered fee_authority/parity (Banking Law 12-a found), atm (only GBL 399-y seen in bill pages) and fee_change_notice (no enacted rule beyond Reg DD found; the 180-day overdraft-fee notice under 9-y and a 30-day inactivity-fee notice under 9-x were seen only in bill text). NOT SEARCHED: minors/seniors fee limits, payee_returned_check, credit union-specific fee powers under Banking Law § 454. Direct fetches to nysenate.gov, dfs.ny.gov and assembly sites were blocked; evidence comes from search-result excerpts of those official pages."
  },
  {
    "state_code": "OH",
    "state_name": "Ohio",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "check_cashing",
      "fee_change_notice",
      "basic_account",
      "atm"
    ],
    "leads_unconfirmed": [
      {
        "topic": "returned_item",
        "claim": "R.C. 1109.20 lets a bank charge, as interest, fees agreed with the borrower including charges for return of a dishonored check; this is a lending/interest provision, not a deposit account fee rule.",
        "where_seen": "https://codes.ohio.gov/ohio-revised-code/section-1109.20",
        "why_unconfirmed": "Context is loans to borrowers; not confirmed to reach deposit account returned-item fees."
      },
      {
        "topic": "garnishment_legal_process",
        "claim": "R.C. 2716.13 / 2716.05 allow an employer garnishee a processing fee up to $3 per pay period on continuous earnings garnishments.",
        "where_seen": "https://codes.ohio.gov/ohio-revised-code/section-2716.05",
        "why_unconfirmed": "Applies to earnings garnishees (employers), not bank account fees; recorded only as context."
      }
    ],
    "notes": "Ohio credit union parity with federal credit unions not confirmed (R.C. 1733.04 general powers seen but no parity text). R.C. 135.33/131.11 deal with service charges on PUBLIC deposits (government funds), not consumer accounts. Fetch of codes.ohio.gov was egress-blocked; evidence is from search result excerpts of the official domain."
  },
  {
    "state_code": "OK",
    "state_name": "Oklahoma",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "check_cashing",
      "fee_change_notice",
      "basic_account",
      "garnishment_legal_process",
      "atm"
    ],
    "leads_unconfirmed": [
      {
        "topic": "returned_item",
        "claim": "Deferred deposit lenders (payday lenders) may charge a dishonored instrument charge of up to $25 and may not charge to cash their own instrument (Title 59, Deferred Deposit Lending Act).",
        "where_seen": "https://oksenate.gov/sites/default/files/2019-12/os6.pdf (search summary)",
        "why_unconfirmed": "Applies to deferred deposit lenders, not bank deposit accounts; section not confirmed."
      },
      {
        "topic": "dormancy",
        "claim": "Enrolled SB 999 (2025-26 session) amends the Unclaimed Property Act; effect on § 652 not checked.",
        "where_seen": "https://www.oklegislature.gov/cf_pdf/2025-26%20ENR/SB/SB999%20ENR.PDF",
        "why_unconfirmed": "Did not read the bill text."
      }
    ],
    "notes": "Garnishment statutes (12 O.S. §§ 1170 et seq.) require notice of exemptions when the garnishee is a financial institution, but no bank fee limit or garnishee fee for banks was confirmed. Oklahoma credit union parity not researched in depth."
  },
  {
    "state_code": "OR",
    "state_name": "Oregon",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "check_cashing",
      "fee_change_notice",
      "basic_account",
      "atm",
      "returned_item"
    ],
    "leads_unconfirmed": [
      {
        "topic": "other",
        "claim": "DFR Bulletin 2025-7 directs/asks depository institutions to waive overdraft and NSF fees for affected Oregon residents (appears to be emergency/disaster guidance).",
        "where_seen": "https://dfr.oregon.gov/laws-rules/Documents/Bulletins/Bulletin2025-7.pdf",
        "why_unconfirmed": "Did not read the bulletin; guidance, likely temporary, not a statute."
      }
    ],
    "notes": "Search snippets showed two phrasings of the Oregon dormancy-charge rule (one general, one specific to deposit accounts that also requires notice whenever an account becomes dormant); a reviewer should confirm the current section number (98.311 per one snippet) and wording, and whether 2025 SB 146 (unclaimed property) changed it. ORS 18.790 also mentions a $2 per-week processing fee tied to wage payments, which applies to wage garnishees, not deposit accounts. Fetch of oregonlegislature.gov was egress-blocked."
  },
  {
    "state_code": "PA",
    "state_name": "Pennsylvania",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "basic_account",
      "returned_item"
    ],
    "leads_unconfirmed": [],
    "notes": "5 searches used. Overdraft/NSF search on official domains found only UCC 13 Pa.C.S. Ch. 44 (bank may charge an overdraft-creating item) and no fee cap. Basic/lifeline account search found nothing. The Banking Code search also surfaced a $15/year credit card fee limit, which is a credit product, not deposit, so it is omitted. NOT SEARCHED: check cashing, fee-change notice, ATM. Earlier placeholder leads (from recall) were dropped; the parity lead for banks (Banking Code national-bank parity) was not seen in a result and is not recorded."
  },
  {
    "state_code": "PR",
    "state_name": "Puerto Rico",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "basic_account",
      "garnishment_legal_process",
      "check_cashing",
      "atm"
    ],
    "leads_unconfirmed": [],
    "notes": "6 searches used (Spanish queries on ocif.pr.gov, bvirtualogp.pr.gov, sutra.oslpr.org, cossec.pr.gov). Overdraft/NSF: only Ley 165-2013 (IOLTA accounts: returned-check and overdraft charges are not 'reasonable charges' payable from IOLTA account interest), which concerns lawyer trust accounts, not consumer accounts, so not recorded as a rule. Garnishment: found pension/benefit exemption statutes but nothing on bank fees. Check cashing: Ley 136-2010 regulates non-bank check cashers, not banks. Ley 150-2008 bans merchant card surcharges (not a bank deposit fee rule). Ley 201-2008 on ATM accessibility appeared by title only; contents not checked. NOT SEARCHED: fee-change notice, cooperative (Ley 255-2002) fee authority/parity. Both rules above rest on search-engine summaries of official PDFs; exact article numbers and Spanish text should be confirmed. The earlier placeholder leads (from recall) were dropped."
  },
  {
    "state_code": "RI",
    "state_name": "Rhode Island",
    "topics_no_rule_found": [
      "basic_account",
      "garnishment_legal_process"
    ],
    "leads_unconfirmed": [
      {
        "topic": "overdraft_nsf",
        "claim": "Text amending R.I. Gen. Laws § 19-9-21.1 would bar an overdraft fee when the day's aggregate overdraft is under $10 and bar more than three overdraft fees per calendar day unless the day's aggregate overdraft exceeds $100.",
        "where_seen": "https://webserver.rilegislature.gov/BillText12/SenateText12/S2437.htm (2012 Senate bill S 2437; similar texts in H5105 (2019), H5640 (2023), S2592 (2022))",
        "why_unconfirmed": "Seen only in introduced bill text; no result showed it was enacted, and the current § 19-9-21.1 text could not be read (fetch egress-blocked)."
      },
      {
        "topic": "fee_change_notice",
        "claim": "R.I. Gen. Laws § 19-9-21.1 ('Fee disclosure by banks, credit unions and other financial institutions') requires a notice enumerating charges the institution imposes of which customers may not be aware.",
        "where_seen": "https://webserver.rilegislature.gov/Statutes/TITLE19/19-9/INDEX.htm (section title in chapter index; content paraphrased by search summary)",
        "why_unconfirmed": "Section title confirmed in the official index, but the operative text was not seen; the paraphrase may come from bill text."
      },
      {
        "topic": "fee_authority",
        "claim": "A Rhode Island credit union may engage in any activity authorized for federal credit unions that the director (or designee) does not consider unsafe and unsound.",
        "where_seen": "Search summary of results on webserver.rilegislature.gov / rules.sos.ri.gov (possibly Title 19 or 230-RICR-40-05-4)",
        "why_unconfirmed": "The specific section or regulation the text comes from was not identified."
      }
    ],
    "notes": "6 searches used plus one egress-blocked fetch. Basic/lifeline account: an extended search of rilegislature.gov, dbr.ri.gov and rules.sos.ri.gov found no basic-account statute (the brief lists RI as having one; not confirmed). Garnishment search returned only general attachment/trustee-process and wage provisions, nothing on bank fees. NOT SEARCHED: check cashing by banks (230-RICR-40-20-2 covers licensed check cashers, not banks), ATM, returned item/stop payment. The earlier placeholder leads (from recall) were dropped."
  },
  {
    "state_code": "SC",
    "state_name": "South Carolina",
    "topics_no_rule_found": [
      "garnishment_legal_process",
      "basic_account"
    ],
    "leads_unconfirmed": [
      {
        "topic": "overdraft_nsf",
        "claim": "A proposed S.C. Code § 34-3-120 would require a state-chartered bank that charges an overdraft or NSF fee to remit those fees to the State Treasurer for the State Highway Fund.",
        "where_seen": "https://www.scstatehouse.gov/sess121_2015-2016/bills/3746.htm (2015-2016 Bill 3746, 'Banking overdraft fees')",
        "why_unconfirmed": "Seen only as bill text; no result showed enactment."
      },
      {
        "topic": "dormancy",
        "claim": "A bill would bar any bank, savings and loan, credit union or other deposit-taking institution in South Carolina from levying a service charge or fee against an account because of inactivity.",
        "where_seen": "https://www.scstatehouse.gov/billsearch.php?billnumbers=3532&session=107&summary=B (1987-88 session bill 3532, per search summary)",
        "why_unconfirmed": "Bill summary only; enactment not shown, and § 27-18-70 (above) suggests a contract-based regime instead."
      },
      {
        "topic": "dormancy",
        "claim": "Chapter 18 of Title 27 (1988 Uniform Unclaimed Property Act) may have been, or was proposed to be, repealed and replaced by a Chapter 17 'Revised Uniform Unclaimed Property Act of 2019'.",
        "where_seen": "https://www.scstatehouse.gov/sess123_2019-2020/bills/524.htm and https://www.scstatehouse.gov/sess124_2021-2022/bills/3849.htm",
        "why_unconfirmed": "Bill pages only; the current-code page for Chapter 18 still appears on scstatehouse.gov/code, so § 27-18-70 is recorded as in force. A reviewer should confirm."
      }
    ],
    "notes": "6 searches used. Garnishment search found only debtor exemptions (S.C. Code 15-41-30, pension/IRA, disability) and nothing about bank fees. No basic-account law found. NOT SEARCHED: check cashing by banks, ATM, fee-change notice. The earlier placeholder lead (from recall) is superseded by the § 27-18-70 rule above."
  },
  {
    "state_code": "SD",
    "state_name": "South Dakota",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "basic_account"
    ],
    "leads_unconfirmed": [
      {
        "topic": "garnishment_legal_process",
        "claim": "SDCL § 21-18-9 requires that a garnishee (such as a bank) be paid a fee for preparing the garnishment disclosure, taxed as the plaintiff's costs; 2026 HB 1179 would raise it from $15 to $40. A different search summary gave $50.",
        "where_seen": "https://mylrc.sdlegislature.gov/api/Documents/298729.htm and https://mylrc.sdlegislature.gov/api/Documents/Bill/305200.pdf?Year=2026",
        "why_unconfirmed": "Current amount conflicts across results ($15, $40, $50) and the 2026 bill's enactment was not confirmed. This fee is paid by the creditor, not the depositor."
      },
      {
        "topic": "garnishment_legal_process",
        "claim": "Garnishees are told to retain an amount only if it is $25.00 or more.",
        "where_seen": "https://ujs.sd.gov/files/garnishment-cover-sheet/ (search summary)",
        "why_unconfirmed": "Court form instruction, not a statute seen; underlying section not identified."
      },
      {
        "topic": "other",
        "claim": "A South Dakota statute lets banks contract for and collect credit service charges including membership and transaction fees, over-limit charges, stop-payment charges and returned-check charges.",
        "where_seen": "Search summary of sdlegislature.gov results (likely a credit card / revolving credit provision)",
        "why_unconfirmed": "Section not identified; appears to concern credit accounts rather than deposit accounts."
      }
    ],
    "notes": "6 searches used. The overdraft/NSF search on sdlegislature.gov and dlr.sd.gov returned no deposit-fee statute. The garnishment search found exemptions (social security and veterans' disability benefits excluded from 'earnings'; public assistance exempt) but no ban on bank fees against exempt funds. No basic-account law found. NOT SEARCHED: credit union parity (search found none), check cashing, ATM, fee-change notice."
  },
  {
    "state_code": "TN",
    "state_name": "Tennessee",
    "topics_no_rule_found": [
      "basic_account"
    ],
    "leads_unconfirmed": [
      {
        "topic": "returned_item",
        "claim": "Tenn. Code Ann. § 47-29-102 authorizes a handling charge of up to $30 (raised from $20) when a check, draft or order is not paid because the drawer had no account, insufficient funds, or an incorrect or insufficient signature. One official fiscal note describes the charge as assessed by 'the financial institution'.",
        "where_seen": "https://www.capitol.tn.gov/Bills/114/Fiscal/SB0766.pdf; https://publications.tnsosfiles.com/acts/114/pub/pc0258.pdf (Public Chapter 258, 114th GA, amending $20 to $30)",
        "why_unconfirmed": "Statute text not seen. Unclear whether the charge belongs to the holder/payee (a payee rule) or to a financial institution, and whether Public Chapter 258 is the $20-to-$30 amendment and its effective date."
      },
      {
        "topic": "overdraft_nsf",
        "claim": "TDFI Bulletin B-04-1 gives guidance on overdraft programs, noting that a written obligation to pay overdrafts may make the program open-end credit subject to state interest, finance charge and disclosure statutes.",
        "where_seen": "https://www.tn.gov/tdfi/bank-trust/banking/bank-bulletins/bulletin-b-04-1.html",
        "why_unconfirmed": "Regulator guidance, not a fee limit; full text not read."
      },
      {
        "topic": "other",
        "claim": "The Tennessee Fair Access to Financial Services Act requires a financial institution to offer each financial service it provides to each person in its geographic market on a non-discriminatory basis.",
        "where_seen": "Search summary of capitol.tn.gov results (bill text; enactment and citation not identified)",
        "why_unconfirmed": "Not a fee rule; enactment status and section not confirmed."
      }
    ],
    "notes": "6 searches used. No overdraft/NSF fee cap for banks found on official domains. Credit union search found only Tenn. Code Ann. § 45-4-803 (tax parity with federal credit unions), not a fee or powers parity, so not recorded. Garnishment: an AG opinion (2007 op07-016) says statutes do not let a private employer-garnishee withhold a processing fee from garnished wages; not specific to banks, not recorded. NOT SEARCHED: check cashing, ATM, fee-change notice. Earlier placeholder had no leads."
  },
  {
    "state_code": "TX",
    "state_name": "Texas",
    "topics_no_rule_found": [],
    "leads_unconfirmed": [
      {
        "topic": "garnishment_legal_process",
        "claim": "Texas law lets a garnishee bank recover its costs and fees out of the garnished account first, and from the creditor if the account is empty.",
        "where_seen": "https://www.bills.com/learn/debt/texas-collection-laws (secondary, citation not given)",
        "why_unconfirmed": "No statute or rule number given and no official text seen (possibly Tex. R. Civ. P. 677 / Civ. Prac. & Rem. Code ch. 63; unverified)."
      },
      {
        "topic": "other",
        "claim": "Tex. Fin. Code § 59.006 is the exclusive method for compelled discovery of a financial institution's customer records and requires the requesting party to pay or bond the institution's costs.",
        "where_seen": "https://cud.texas.gov/wp-content/uploads/2026/04/FINANCE-CODE-REV-06-25.pdf",
        "why_unconfirmed": "Cost text was only partially seen; it shifts record-production costs to the requester, not a customer account fee rule."
      }
    ],
    "notes": "About 7 searches. statutes.capitol.texas.gov is egress-blocked. The shared web-search budget ran out before overdraft/NSF, check cashing, fee-change notice, basic account, ATM and returned-item topics were searched, so nothing is listed as 'no rule found'. Reviewer should confirm § 73.003's full text (including any exceptions) and the § 73.001 definition of 'inactive'."
  },
  {
    "state_code": "UT",
    "state_name": "Utah",
    "topics_no_rule_found": [
      "overdraft_nsf"
    ],
    "leads_unconfirmed": [
      {
        "topic": "garnishment_legal_process",
        "claim": "Under Utah R. Civ. P. 64D the creditor pays the garnishee's fee directly to the garnishee (e.g. a bank); exempt funds (Utah Exemptions Act, Utah Code 78B-5-501 et seq., incl. 78B-5-505) should not be taken from a garnished account, but the debtor must claim them within 14 days.",
        "where_seen": "https://legacy.utcourts.gov/rules/view.php?type=urcp&rule=64d ; https://www.utcourts.gov/en/self-help/case-categories/consumer/garnishment/rights.html",
        "why_unconfirmed": "Only search summaries; the garnishee fee amount and whether a bank may charge the debtor a fee were not seen."
      }
    ],
    "notes": "Wave 2: 6 searches. Overdraft: only UCC Article 4 (Utah Code 70A-4-401, a bank may charge an overdraft item) was found; no fee cap. Utah Code 7-3-26 ('Overdraft as asset') is an accounting rule, not a fee rule. NOT SEARCHED: check_cashing, basic_account, fee_change_notice, returned_item (bank side). le.utah.gov fetches were not attempted."
  },
  {
    "state_code": "VA",
    "state_name": "Virginia",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "check_cashing"
    ],
    "leads_unconfirmed": [],
    "notes": "Wave 2: 6 searches. Overdraft: Title 6.2 ch. 6 and Title 8.4 (UCC 8.4-401, bank may charge an overdraft item) show no fee cap; §§ 6.2-877 and 6.2-1129 only let insiders' inadvertent overdrafts of $1,000 or less be paid if charged the same fee as other customers (insider-lending rule, not a consumer fee limit). The $25 returned-item cap seen was for short-term lenders (Title 6.2 ch. 18), not banks. Check cashing: only the check casher registration chapter (Title 6.2 ch. 21) was found. § 8.01-27.1 (payee recovery on bad checks) was seen but its amounts were not read. NOT SEARCHED: basic_account, fee_change_notice, atm."
  },
  {
    "state_code": "VT",
    "state_name": "Vermont",
    "topics_no_rule_found": [
      "overdraft_nsf"
    ],
    "leads_unconfirmed": [],
    "notes": "Searched about 6 times; official sites (legislature.vermont.gov) are egress-blocked for direct fetch, so all evidence is from search-result excerpts. Not searched before the shared web-search budget ran out: check cashing, fee-change notice, garnishment/trustee-process fees (12 V.S.A.), ATM, state bank parity. Pending/2026: H.648 (banking, insurance and securities bill, passed House 2026) and Act 142 of 2026 appeared in results but their deposit-fee content, if any, was not reviewed. H.99 (2025) is earned wage access, not overdraft."
  },
  {
    "state_code": "WA",
    "state_name": "Washington",
    "topics_no_rule_found": [
      "overdraft_nsf"
    ],
    "leads_unconfirmed": [
      {
        "topic": "garnishment_legal_process",
        "claim": "Chapter 6.27 RCW may let a garnishee deduct a processing fee.",
        "where_seen": "web search summary of app.leg.wa.gov ch. 6.27 RCW",
        "why_unconfirmed": "Search summary only said a processing fee 'may be charged'; section, amount and whether it applies to bank accounts were not seen."
      },
      {
        "topic": "overdraft_nsf",
        "claim": "DFI's overdraft legislative report and FAQ say banks decide their own fee schedules and overdraft policies subject to disclosure; DFI issued guidance and best practices for overdraft protection programs (not a rule).",
        "where_seen": "https://dfi.wa.gov/documents/reports/overdraft-legislative-report.pdf ; https://dfi.wa.gov/sites/default/files/publications/overdraft-protection_0.pdf ; https://dfi.wa.gov/banks/faqs",
        "why_unconfirmed": "Guidance and a survey of fee levels, not a fee limit; report date not seen."
      }
    ],
    "notes": "Wave 1: 3 searches. Wave 2: 5 searches (dormancy, overdraft, SB 5651 x2, parity). Overdraft/NSF: no RCW cap found; DFI treats fees as set by the institution with disclosure. SB 5651 (2025) was enacted as ch. 391, Laws of 2025 and raised the consumer-debt automatic protection from $1,000 to $2,000 (the introduced bill's $5,000 figures were not enacted). NOT SEARCHED: basic_account, check_cashing, fee_change_notice, atm, returned_item. The garnishee processing-fee lead (ch. 6.27 RCW) is still unconfirmed."
  },
  {
    "state_code": "WI",
    "state_name": "Wisconsin",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "returned_item",
      "check_cashing",
      "basic_account"
    ],
    "leads_unconfirmed": [
      {
        "topic": "garnishment_legal_process",
        "claim": "Wis. Stat. § 812.? (subch. II) makes a financial-institution garnishee liable only up to the garnishable amount as of the 2nd business day after service; earnings garnishments carry a $15 garnishee fee (§ 812.34 area).",
        "where_seen": "docs.legis.wisconsin.gov ch. 812",
        "why_unconfirmed": "Earnings-garnishment rules don't govern deposit fees; exact section for the financial-institution liability text not pinned down."
      },
      {
        "topic": "check_cashing",
        "claim": "Wisconsin's community currency exchange (check casher) licensing statute excludes banks, savings banks, savings and loans and credit unions, and sets no check-cashing fee cap.",
        "where_seen": "docs.legis.wisconsin.gov ch. 218 (218.05) and dfi.wi.gov Licensed Financial Services FAQ",
        "why_unconfirmed": "Confirms only that banks are outside the check casher law; not a bank fee rule."
      }
    ],
    "notes": "Wave 1 searched overdraft/NSF (only UCC § 404.401-style rules, no cap). Wave 2: 3 searches (fee authority/parity x2, check cashing + basic account). Check cashing and basic/lifeline accounts: one combined search of docs.legis.wisconsin.gov and dfi.wi.gov found no bank rule. The $15 returned-check fee in Wis. Stat. § 422.202(1)(d) applies to creditors in closed-end consumer credit, not to deposit accounts. NOT SEARCHED: fee_change_notice, atm, payee_returned_check (likely § 943.24 area)."
  },
  {
    "state_code": "WV",
    "state_name": "West Virginia",
    "topics_no_rule_found": [
      "fee_change_notice",
      "basic_account",
      "atm"
    ],
    "leads_unconfirmed": [
      {
        "topic": "returned_item",
        "claim": "Commissioner rules implementing § 31A-4-30b (reasonable limits on merchant returned-check/stop-payment fees) may exist in W. Va. Code of State Rules title 106.",
        "where_seen": "inferred from § 31A-4-30b text",
        "why_unconfirmed": "Did not locate the rule; search budget ran out."
      }
    ],
    "notes": "Section numbers for 36-8-2 and 31A-4-30b come from search-engine summaries of code.wvlegislature.gov pages; direct fetches were blocked, so a reviewer should open the pages. The § 31A-4-30b merchant wording may mean it covers only merchant accounts. Garnishment: no WV statute found on bank fees for processing legal process (searched 38-5A/5B). The DFI FAQ says no overdraft/returned-check fee cap. No 2025-2026 overdraft bill found. The § 36-8 dormancy rules are from the existing Uniform Unclaimed Property Act. The shared search budget ran out partway through Wisconsin."
  },
  {
    "state_code": "WY",
    "state_name": "Wyoming",
    "topics_no_rule_found": [
      "overdraft_nsf",
      "fee_authority"
    ],
    "leads_unconfirmed": [
      {
        "topic": "dormancy",
        "claim": "Wyoming's Uniform Unclaimed Property Act is W.S. 34-24-101 to -140; it may contain a dormancy/service-charge provision for deposits. A definition of stored-value card 'net card value' refers to 'any service charge, fee or dormancy charge permitted by law', and a 2022-23 Revised Uniform Unclaimed Property Act draft (23LSO-0275) was prepared.",
        "where_seen": "https://statetreasurer.wyo.gov/wp-content/uploads/2020/04/AnnualReportChecklist.pdf ; https://wyoleg.gov/InterimCommittee/2022/07-202210134-0123LSO-0275RevisedUniformUnclaimedPropertyAct.pdf",
        "why_unconfirmed": "Three searches on wyoleg.gov / statetreasurer.wyo.gov found no current statute text on dormancy charges for deposit accounts; whether the RUUPA draft was enacted was not checked. wyoleg.gov fetch is egress-blocked."
      },
      {
        "topic": "garnishment_legal_process",
        "claim": "Wyoming Judicial Branch self-help guidance says exempt funds in a garnished bank account (other than federal benefits) are not automatically protected and must be claimed by objection; even if released as exempt, the debtor remains liable for NSF fees, garnishment fees and costs, and the bank will probably charge a garnishment fee. Writs of garnishment are W.S. 1-15-401 to -425; exemptions are W.S. ch. 1-20.",
        "where_seen": "https://www.wyocourts.gov/legal-help-by-topic/garnishment/ ; https://www.wyocourts.gov/app/uploads/2025/06/Garnishment-Instructions-06.01.2021.pdf",
        "why_unconfirmed": "Official court guidance, not statute text; no statutory limit on a bank's garnishment fee was seen."
      }
    ],
    "notes": "Wave 2: 6 searches (plus 1 from wave 1). Overdraft/NSF: Title 13 searches found no fee cap. Fee authority/parity: searches of wyoleg.gov and the Division of Banking found no state bank or credit union parity or fee-authority text (Title 13 compressed PDF is egress-blocked, so W.S. 13-2 and 13-10 were not read). The Wyoming post-dated check limit ($30 or 20% per month finance charge) applies to licensed post-dated check cashers under the consumer credit code, not banks. NOT SEARCHED: check_cashing (banks), basic_account, fee_change_notice, atm, returned_item."
  }
];
