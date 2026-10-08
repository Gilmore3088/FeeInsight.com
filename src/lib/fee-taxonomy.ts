/**
 * Fee taxonomy constants for the public app and agentic admin experience.
 * Single source of truth for fee families, display names, and colors in the UI.
 */

/**
 * The top 50 fee types (James, Oct 8 2026). Fifteen smaller categories were folded into
 * these by each fee's own wording (`src/lib/fee-fold.ts`); add a category only by folding
 * another one in.
 */
export const FEE_FAMILIES: Record<string, string[]> = {
  "Account Maintenance": [
    "monthly_maintenance",
    "minimum_balance",
    "early_closure",
    "dormant_account",
    "account_research",
    "paper_statement",
  ],
  "Overdraft & NSF": [
    "overdraft",
    "nsf",
    "continuous_od",
    "od_protection_transfer",
    "od_daily_cap",
  ],
  "ATM & Card": [
    "atm_non_network",
    "card_replacement",
    "rush_card",
    "card_foreign_txn",
  ],
  "Wire Transfers": [
    "wire_domestic_outgoing",
    "wire_domestic_incoming",
    "wire_intl_outgoing",
    "wire_intl_incoming",
  ],
  "Check Services": [
    "cashiers_check",
    "money_order",
    "check_printing",
    "stop_payment",
    "counter_check",
    "check_cashing",
    "collection_item",
    "check_image",
  ],
  "Digital & Electronic": [
    "ach_origination",
    "ach_return",
    "bill_pay",
    "mobile_deposit",
  ],
  "Cash & Deposit": [
    "coin_counting",
    "cash_advance",
    "deposited_item_return",
    "night_deposit",
  ],
  "Account Services": [
    "notary_fee",
    "safe_deposit_box",
    "garnishment_levy",
    "legal_process",
    "account_verification",
  ],
  "Lending Fees": [
    "late_payment",
    "loan_origination",
    "appraisal_fee",
  ],
  "Retirement & IRA": [
    "ira_administration",
    "ira_termination",
  ],
  "Vehicle & Title": [
    "vehicle_title",
  ],
  "Gift & Prepaid Cards": [
    "gift_card_purchase",
  ],
  "Other Fees": [
    "courier_delivery",
    "document_reproduction",
    "other_lending_fee",
  ],
};

export const DISPLAY_NAMES: Record<string, string> = {
  // Account Maintenance
  monthly_maintenance: "Monthly Maintenance",
  minimum_balance: "Minimum Balance",
  early_closure: "Early Account Closure",
  dormant_account: "Dormant Account",
  account_research: "Account Research",
  paper_statement: "Paper Statement",
  // Overdraft & NSF
  overdraft: "Overdraft (OD)",
  nsf: "NSF / Returned Item",
  continuous_od: "Continuous Overdraft",
  od_protection_transfer: "OD Protection Transfer",
  od_daily_cap: "Daily OD & NSF Fee Cap",
  // ATM & Card
  atm_non_network: "Non-Network ATM",
  atm_international: "International ATM",
  card_replacement: "Debit Card Replacement",
  rush_card: "Rush Card Delivery",
  // International ATM folded in (James, Oct 8: "Foreign Card" gave up its spot; one type for
  // using an ATM or a card abroad).
  card_foreign_txn: "International ATM & Card",
  // Wire Transfers
  wire_domestic_outgoing: "Wire Transfer (Domestic Out)",
  wire_domestic_incoming: "Wire Transfer (Domestic In)",
  wire_intl_outgoing: "Wire Transfer (Int'l Out)",
  wire_intl_incoming: "Wire Transfer (Int'l In)",
  // Check Services
  cashiers_check: "Cashier's Check",
  money_order: "Money Order",
  check_printing: "Check Printing",
  stop_payment: "Stop Payment",
  counter_check: "Counter/Temporary Check",
  check_cashing: "Check Cashing",
  collection_item: "Collection Items",
  check_image: "Check Image/Copy",
  // Digital & Electronic
  ach_origination: "ACH Origination",
  ach_return: "ACH Return",
  bill_pay: "Bill Pay & Zelle",
  mobile_deposit: "Mobile Deposit",
  // Cash & Deposit
  coin_counting: "Coin Counting",
  cash_advance: "Cash Advance",
  deposited_item_return: "Deposited Item Return",
  night_deposit: "Night Deposit",
  // Account Services
  notary_fee: "Notary Service",
  safe_deposit_box: "Safe Deposit Box",
  garnishment_levy: "Garnishment/Levy",
  legal_process: "Legal Process/Subpoena",
  account_verification: "Account Verification",
  // Lending Fees
  late_payment: "Late Payment",
  loan_origination: "Loan Origination",
  appraisal_fee: "Appraisal",
  // Retirement & IRA
  ira_administration: "IRA Administration",
  ira_termination: "IRA Termination",
  // Vehicle & Title
  vehicle_title: "Vehicle Title",
  // Gift & Prepaid Cards
  gift_card_purchase: "Gift & Prepaid Card",
  // Other Fees
  courier_delivery: "Courier Delivery",
  document_reproduction: "Document Reproduction",
  other_lending_fee: "Other Lending Fee",
};

/**
 * Canonical key map: stable aggregation keys mirroring Python CANONICAL_KEY_MAP.
 * For the base categories, canonical_fee_key === fee_category (identity mapping).
 * Synonym clusters map long-tail slugs to a single canonical key.
 *
 * IMPORTANT: Keep this map in sync with the public fee category definitions.
 * Cross-language sync is enforced by fee-taxonomy.test.ts.
 */
export const CANONICAL_KEY_MAP: Record<string, string> = {
  // Account Maintenance
  monthly_maintenance: "monthly_maintenance",
  minimum_balance: "minimum_balance",
  early_closure: "early_closure",
  dormant_account: "dormant_account",
  account_research: "account_research",
  paper_statement: "paper_statement",
  estatement_fee: "estatement_fee",
  // Overdraft & NSF
  overdraft: "overdraft",
  nsf: "nsf",
  continuous_od: "continuous_od",
  od_protection_transfer: "od_protection_transfer",
  od_line_of_credit: "od_line_of_credit",
  od_daily_cap: "od_daily_cap",
  nsf_daily_cap: "nsf_daily_cap",
  // ATM & Card
  atm_non_network: "atm_non_network",
  atm_international: "atm_international",
  card_replacement: "card_replacement",
  rush_card: "rush_card",
  card_foreign_txn: "card_foreign_txn",
  card_dispute: "card_dispute",
  // Wire Transfers
  wire_domestic_outgoing: "wire_domestic_outgoing",
  wire_domestic_incoming: "wire_domestic_incoming",
  wire_intl_outgoing: "wire_intl_outgoing",
  wire_intl_incoming: "wire_intl_incoming",
  // Check Services
  cashiers_check: "cashiers_check",
  money_order: "money_order",
  check_printing: "check_printing",
  stop_payment: "stop_payment",
  counter_check: "counter_check",
  check_cashing: "check_cashing",
  collection_item: "collection_item",
  collection_items: "collection_item",
  check_image: "check_image",
  // Digital & Electronic
  ach_origination: "ach_origination",
  ach_return: "ach_return",
  bill_pay: "bill_pay",
  mobile_deposit: "mobile_deposit",
  zelle_fee: "zelle_fee",
  // Cash & Deposit
  coin_counting: "coin_counting",
  cash_advance: "cash_advance",
  deposited_item_return: "deposited_item_return",
  night_deposit: "night_deposit",
  // Account Services
  notary_fee: "notary_fee",
  safe_deposit_box: "safe_deposit_box",
  garnishment_levy: "garnishment_levy",
  legal_process: "legal_process",
  account_verification: "account_verification",
  balance_inquiry: "balance_inquiry",
  // Lending Fees
  late_payment: "late_payment",
  loan_origination: "loan_origination",
  appraisal_fee: "appraisal_fee",
  // Mortgage Servicing
  mortgage_modification: "mortgage_modification",
  mortgage_payoff: "mortgage_payoff",
  mortgage_lien_release: "mortgage_lien_release",
  refinance_fee: "refinance_fee",
  reconveyance: "reconveyance",
  // Retirement & IRA
  ira_administration: "ira_administration",
  ira_termination: "ira_termination",
  ira_distribution: "ira_distribution",
  // Vehicle & Title
  vehicle_title: "vehicle_title",
  duplicate_title: "duplicate_title",
  dmv_filing: "dmv_filing",
  // Gift & Prepaid Cards
  gift_card_purchase: "gift_card_purchase",
  prepaid_card_reload: "prepaid_card_reload",
  // Other Fees
  courier_delivery: "courier_delivery",
  document_reproduction: "document_reproduction",
  other_lending_fee: "other_lending_fee",
  // Synonym clusters: production fee_category slugs -> canonical key
  // Keep in sync with CANONICAL_FEE_KEYS above.
  // --- Slug duplicates / abbreviations ---
  rush_card_delivery: "rush_card",
  estatement: "estatement_fee",
  check_image_charge: "check_image",
  safe_deposit: "safe_deposit_box",
  monthly_maintenance_charge: "monthly_maintenance",
  month_fee: "monthly_maintenance",
  premier_fee: "monthly_maintenance",
  savings_fee: "monthly_maintenance",
  money_market_fee: "monthly_maintenance",
  // --- NSF / returned item variants ---
  nonsufficient_fee: "nsf",
  return_item_charge: "nsf",
  // --- Overdraft variants ---
  overdraft_each_overdraft_paid: "overdraft",
  overdraft_privilege: "overdraft",
  over_fee: "overdraft",
  excessive_withdrawal_fee: "overdraft",
  // --- Card / debit variants ---
  debit_fee: "card_replacement",
  debit_card_fee: "card_replacement",
  visa_debit_card_fee: "card_replacement",
  replacement_fee: "card_replacement",
  pin_fee: "card_replacement",
  pin_replacement: "card_replacement",
  pin_replacement_fee: "card_replacement",
  debit_card_rush_fee: "rush_card",
  // --- Card foreign / gift ---
  international_fee: "card_foreign_txn",
  visa_gift_card: "gift_card_purchase",
  visa_gift_cards: "gift_card_purchase",
  gift_card: "gift_card_purchase",
  gift_cards: "gift_card_purchase",
  gift_pay: "gift_card_purchase",
  reload_fee: "prepaid_card_reload",
  // --- Wire / outgoing variants ---
  outgoing_fee: "wire_domestic_outgoing",
  outgoing_domestic: "wire_domestic_outgoing",
  returned_wire: "wire_domestic_outgoing",
  express_mail: "wire_domestic_outgoing",
  // --- Transfer / ACH variants ---
  transfer_fee: "od_protection_transfer",
  transaction_fee: "account_research",
  transactions_fee: "account_research",
  per_transaction_fee: "account_research",
  ach_batch_fee: "ach_origination",
  // --- Address / mail return variants ---
  returned_mail: "account_research",
  returned_mail_fee: "account_research",
  return_mail: "account_research",
  bad_address: "account_research",
  bad_address_fee: "account_research",
  incorrect_address: "account_research",
  incorrect_address_fee: "account_research",
  invalid_address_fee: "account_research",
  undeliverable_mail: "account_research",
  // --- Dormant / escheatment variants ---
  inactive_fee: "dormant_account",
  dormant_fee: "dormant_account",
  escheatment: "dormant_account",
  escheat_processing_fee: "dormant_account",
  abandoned_property_fee: "dormant_account",
  // --- Skip-a-pay / late payment variants ---
  skip_a_pay: "late_payment",
  skipapay: "late_payment",
  skipapayment: "late_payment",
  reinstatement: "late_payment",
  // --- Fax / research / admin variants ---
  fax_fee: "account_research",
  account_balancing_assistance: "account_research",
  account_balancing_assistance_per_hour: "account_research",
  balancing_assistance_fee: "account_research",
  inquiries_fee: "account_research",
  document_copy: "account_research",
  more_fee: "account_research",
  less_fee: "account_research",
  // --- Early closure / club variants ---
  club_account: "early_closure",
  christmas_club_early_withdrawal_fee: "early_closure",
  christmas_club_withdrawal: "early_closure",
  club_account_early_withdrawal: "early_closure",
  account_closed_within_90_days_of_opening: "early_closure",
  account_closed_within_90_days: "early_closure",
  // --- Check variants ---
  check_fee: "check_printing",
  copy_of_paid_check: "check_image",
  check_by_phone: "check_cashing",
  corporate_check: "cashiers_check",
  cashed_fee: "check_cashing",
  foreign_check_collection: "collection_item",
  items_sent_for_collection: "collection_item",
  // --- Safe deposit / key variants ---
  lost_key_fee: "safe_deposit_box",
  lost_key: "safe_deposit_box",
  lost_fee: "safe_deposit_box",
  key_replacement: "safe_deposit_box",
  replacement_key: "safe_deposit_box",
  drilling_fee: "safe_deposit_box",
  box_drilling: "safe_deposit_box",
  zipper_bag: "night_deposit",
  // --- Safe deposit box size slugs ---
  "3_x_5": "safe_deposit_box",
  "3_x_5_box": "safe_deposit_box",
  "3_x_10": "safe_deposit_box",
  "5_x_5": "safe_deposit_box",
  "5_x_10": "safe_deposit_box",
  "5_x_10_box": "safe_deposit_box",
  "10_x_10": "safe_deposit_box",
  "10_x_10_box": "safe_deposit_box",
  // --- Legal / subordination variants ---
  subordination_fee: "legal_process",
  subordination: "legal_process",
  mortgage_subordination: "legal_process",
  mortgage_subordination_fee: "legal_process",
  duplicate_lien_release: "legal_process",
  lien_fee: "legal_process",
  // --- Lending variants ---
  loan_modification_fee: "loan_origination",
  credit_card_fee: "cash_advance",
  credit_fee: "cash_advance",
  // --- Coin / deposit variants ---
  coin_deposited_fee: "coin_counting",
  deposited_fee: "deposited_item_return",
  collection_fee: "collection_item",
  // --- ATM variants ---
  all_other_atms: "atm_non_network",
  atm_deposit_adjustment: "deposited_item_return",
  // --- Statement variants ---
  returned_statement: "paper_statement",
  mailed_paper_statement: "paper_statement",
  // --- Balance inquiry variants ---
  shared_branch_fee: "balance_inquiry",
  // --- Misc ---
  fastpay_fee: "ach_origination",
  withdrawal_fee: "account_research",
  silverbronze_rewards_fee: "monthly_maintenance",
  charitable_donation: "account_research",
  operate_fee: "account_research",
  // --- Production Postgres audit (2026-04-10) ---
  fax: "account_research",
  fax_service: "account_research",
  fax_services: "account_research",
  christmas_club_early_withdrawal: "early_closure",
  christmas_club_withdrawal_fee: "early_closure",
  skipapayment_fee: "late_payment",
  skipapay_fee: "late_payment",
  zipper_bags: "night_deposit",
  membership_share: "monthly_maintenance",
  western_union: "wire_domestic_outgoing",
  document_copy_fee: "account_research",
  visa_travel_card: "card_replacement",
  loan_extension: "loan_origination",
  excessive_transaction_fee: "account_research",
  reopen_account: "early_closure",
  loan_cancellation_fee: "loan_origination",
};

/** Total number of entries in CANONICAL_KEY_MAP (for cross-language sync assertions). */
export const CANONICAL_KEY_COUNT = Object.keys(CANONICAL_KEY_MAP).length;

/**
 * Warm-family palette for fee families. One hue per family, all on the Fee
 * Insight parchment scale (no stock Tailwind blue/red/amber). Every text color
 * measures at least 7:1 on its own tint and on #FAF7F2, so chips and labels
 * stay legible at 11-13px.
 */
export interface FamilyColors {
  /** Left-edge accent on cards (`border-l-*`). */
  border: string;
  /** Tint background for chips. */
  bg: string;
  /** Text on the tint (and on parchment). */
  text: string;
  /** Solid swatch/dot in the family hue (`bg-*`), for legends and section markers. */
  dot: string;
}

export const FAMILY_COLORS: Record<string, FamilyColors> = {
  // terracotta
  "Account Maintenance": {
    border: "border-l-[#C44B2E]",
    dot: "bg-[#C44B2E]",
    bg: "bg-[#FDF0ED]",
    text: "text-[#8E2A17]",
  },
  // wine
  "Overdraft & NSF": {
    border: "border-l-[#8C3A52]",
    dot: "bg-[#8C3A52]",
    bg: "bg-[#F7ECEF]",
    text: "text-[#6E2238]",
  },
  // ochre
  "ATM & Card": {
    border: "border-l-[#B8860B]",
    dot: "bg-[#B8860B]",
    bg: "bg-[#FBF3E1]",
    text: "text-[#6E4A0C]",
  },
  // plum
  "Wire Transfers": {
    border: "border-l-[#7B6491]",
    dot: "bg-[#7B6491]",
    bg: "bg-[#F1ECF3]",
    text: "text-[#4E3A66]",
  },
  // slate-brown
  "Check Services": {
    border: "border-l-[#7A6E5E]",
    dot: "bg-[#7A6E5E]",
    bg: "bg-[#F0ECE6]",
    text: "text-[#4A4238]",
  },
  // teal-grey
  "Digital & Electronic": {
    border: "border-l-[#4F8078]",
    dot: "bg-[#4F8078]",
    bg: "bg-[#E9F0EF]",
    text: "text-[#23514B]",
  },
  // olive
  "Cash & Deposit": {
    border: "border-l-[#7A8A2E]",
    dot: "bg-[#7A8A2E]",
    bg: "bg-[#EFF1E4]",
    text: "text-[#46521A]",
  },
  // sand
  "Account Services": {
    border: "border-l-[#A38B57]",
    dot: "bg-[#A38B57]",
    bg: "bg-[#F5EEDD]",
    text: "text-[#5C4A24]",
  },
  // clay
  "Lending Fees": {
    border: "border-l-[#B5623A]",
    dot: "bg-[#B5623A]",
    bg: "bg-[#F8EBE3]",
    text: "text-[#7A3A1A]",
  },
};

export function getDisplayName(category: string): string {
  return DISPLAY_NAMES[category] ?? category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getFeeFamily(category: string): string | null {
  for (const [family, members] of Object.entries(FEE_FAMILIES)) {
    if (members.includes(category)) return family;
  }
  return null;
}

export function getFamilyColor(family: string) {
  return FAMILY_COLORS[family] ?? { border: "border-l-[#A09788]", dot: "bg-[#A09788]", bg: "bg-[#F5EFE6]", text: "text-[#5A5347]" };
}

// --- Fee Tier System ---

export type FeeTier = "spotlight" | "core" | "extended" | "comprehensive";

/**
 * Maps every fee category to a tier based on industry benchmarking importance.
 * Spotlight + Core = "Featured" (15 fees shown by default).
 * Extended + Comprehensive = shown only via "Show all" toggle.
 */
export const FEE_TIERS: Record<string, FeeTier> = {
  // Spotlight (6) — FDIC-mandated, Bankrate headline, CFPB regulatory targets
  monthly_maintenance: "spotlight",
  overdraft: "spotlight",
  nsf: "spotlight",
  atm_non_network: "spotlight",
  card_foreign_txn: "spotlight",
  wire_domestic_outgoing: "spotlight",

  // Core (9) — frequently compared in surveys, on most fee schedules
  stop_payment: "core",
  wire_intl_outgoing: "core",
  wire_domestic_incoming: "core",
  cashiers_check: "core",
  od_protection_transfer: "core",
  paper_statement: "core",
  minimum_balance: "core",
  card_replacement: "core",
  deposited_item_return: "core",

  // Extended (15) — tracked, accessible via expansion
  dormant_account: "extended",
  early_closure: "extended",
  money_order: "extended",
  wire_intl_incoming: "extended",
  continuous_od: "extended",
  garnishment_levy: "extended",
  safe_deposit_box: "extended",
  account_research: "extended",
  check_printing: "extended",
  coin_counting: "extended",
  ach_origination: "extended",
  ach_return: "extended",
  rush_card: "extended",
  late_payment: "extended",
  atm_international: "extended",

  // Comprehensive (13) — rarely benchmarked, often free, or niche
  od_daily_cap: "comprehensive",
  counter_check: "comprehensive",
  check_cashing: "comprehensive",
  collection_item: "comprehensive",
  check_image: "comprehensive",
  bill_pay: "comprehensive",
  mobile_deposit: "comprehensive",
  cash_advance: "comprehensive",
  night_deposit: "comprehensive",
  notary_fee: "comprehensive",
  legal_process: "comprehensive",
  account_verification: "comprehensive",
  loan_origination: "comprehensive",
  appraisal_fee: "comprehensive",
};

const FEATURED_TIERS: Set<FeeTier> = new Set(["spotlight", "core"]);

export function getFeeTier(category: string): FeeTier {
  return FEE_TIERS[category] ?? "comprehensive";
}

export function isFeaturedFee(category: string): boolean {
  return FEATURED_TIERS.has(getFeeTier(category));
}

export function getFeaturedCategories(): string[] {
  return Object.entries(FEE_TIERS)
    .filter(([, tier]) => FEATURED_TIERS.has(tier))
    .map(([cat]) => cat);
}

export function getSpotlightCategories(): string[] {
  return Object.entries(FEE_TIERS)
    .filter(([, tier]) => tier === "spotlight")
    .map(([cat]) => cat);
}

/** Total number of categories in the taxonomy. */
export const TAXONOMY_COUNT = Object.values(FEE_FAMILIES).flat().length;
export const FEATURED_COUNT = getFeaturedCategories().length;
