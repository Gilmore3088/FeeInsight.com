/**
 * v148 (#1092): the near-miss dash lists for `dash-list-rows.test.ts`, with what main (9e58a8c) publishes
 * for each, recorded through Knox, Darwin verify and the publish gate.
 */
/** A published fee: [category, amount, frequency, name]. */
export type Published = [string, number, string | null, string];
export interface NearMiss {
  lines: string[];
  published: Published[];
}

export const UNCHANGED_FROM_MAIN: NearMiss[] = [
  { lines: ["Account Fees", "$500 - Minimum balance to open", "$25.00 - Minimum Opening Deposit"], published: [] },
  { lines: ["ATM Card", "$1,000 - Daily ATM withdrawal limit", "$500 - Daily POS purchase limit"], published: [] },
  { lines: ["Mobile Deposit", "$5,000 - Maximum mobile deposit per day", "$2.00 - Mobile Deposit Express"], published: [["mobile_deposit", 2.0, null, "Mobile Deposit"]] },
  { lines: ["Overdraft", "$35.00 - Overdraft Fee", "$140 - Maximum overdraft fees per day"], published: [["overdraft", 35.0, null, "Overdraft Fee"]] },
  { lines: ["Overdraft", "$35.00 - Per item, maximum 4 per day", "$5.00 - Overdraft Transfer"], published: [["overdraft", 5.0, null, "Overdraft"], ["overdraft", 35.0, null, "Overdraft"]] },
  { lines: ["Checking", "$10.00 - Monthly Service Fee (waived with $500 balance)", "$5.00 - Paper Statement (waived with eStatements)"], published: [["monthly_maintenance", 10.0, "monthly", "Monthly Service Fee (waived with balance)"]] },
  { lines: ["Services", "1% - Foreign Transaction Fee", "$0.50 - Per $100 coin counted"], published: [] },
  { lines: ["Services", "$25.00 - Stop Payment; $35.00 - Range of checks", "$30.00 - NSF Fee"], published: [["nsf", 30.0, null, "NSF Fee"]] },
  { lines: ["Services", "$30.00 - NSF Fee, $30.00 Overdraft Fee", "$10.00 - Account Research"], published: [["nsf", 30.0, null, "NSF Fee, Overdraft Fee"]] },
  { lines: ["Overdraft Fee", "$30.00 - Stop Payment", "$25.00 - Returned Item", "$5.00"], published: [["overdraft", 30.0, null, "Overdraft Fee"]] },
  { lines: ["Services", "$2.00 - Counter checks, annual fee $10.00", "$5.00 - Cashier's Check"], published: [["counter_check", 10.0, "annual", "Counter checks, annual fee"]] },
  { lines: ["Services", "$5.00 - per wk", "$5.00 - Mo. Service Fee"], published: [] },
  { lines: ["Services", "$5.00 - ea.", "$3 - Monthly"], published: [] },
  { lines: ["Services", "$25.00 - Hourly Research", "$10.00 - Annual Fee"], published: [] },
  { lines: ["Check Cashing", "$5.00 - Non-Member Check Cashing", "$2.00 - Member Check Cashing"], published: [["check_cashing", 2.0, null, "Member Check Cashing"], ["check_cashing", 5.0, null, "Check Cashing"]] },
  { lines: ["Business Checking", "$10.00 - Business Checking Monthly Fee", "$0.20 - Per item over 200"], published: [] },
  { lines: ["Notary", "$2.00 - Members", "$5.00 - Non-members"], published: [["notary_fee", 2.0, null, "Notary"]] },
  { lines: ["Safe Deposit", "$10.00 - If both keys are lost, the box must be drilled", "$5 - for first occurrence then $10 each"], published: [["safe_deposit_box", 10.0, null, "Safe Deposit"]] },
  { lines: ["Legal", "$5 - $15 - Levy", "$50.00 - Garnishment"], published: [["garnishment_levy", 50.0, null, "Levy"]] },
  { lines: ["Wires", "$10.00 - Outgoing Wire .....", "$15.00 - Incoming Wire ....."], published: [["wire_domestic_outgoing", 15.0, null, "Outgoing Wire"]] },
  { lines: ["Overdraft Fee", "$35.00 - Stop Payment Fee"], published: [["overdraft", 35.0, null, "Overdraft Fee"], ["stop_payment", 35.0, null, "Stop Payment Fee"]] },
  { lines: ["Wire Transfers:", "  - $10 Incoming transfer", "  - $20 Outgoing U.S. transfer", "  - $60 Outgoing foreign transfer"], published: [] },
  { lines: ["Mortgage", " - $100 - HELOC Fee", " - $150 - Mortgage Subordination", " - $150 - Partial Release"], published: [["legal_process", 150.0, null, "Mortgage Subordination"]] },
  { lines: ["Fees", "• $3.00 each ATM/Debit transaction off premises", "• $2.00 Paper statement"], published: [] },
  { lines: ["Fees", "$5.00 - Statement Copy | $2.00 - Check Copy"], published: [["document_reproduction", 2.0, null, "Statement Copy"]] },
  { lines: ["Fees", "$5.00 - Statement Copy", "Overdraft Fee | $30.00"], published: [["overdraft", 30.0, null, "Overdraft Fee"]] },
  { lines: ["Personal", "$5.00 - Monthly Maintenance Fee", "Business", "$15.00 - Monthly Maintenance Fee"], published: [["monthly_maintenance", 5.0, "monthly", "Monthly Maintenance Fee"], ["monthly_maintenance", 15.0, "monthly", "Monthly Maintenance Fee"]] },
  { lines: ["Fees", "$3.00 - 3 free per month, then fee applies", "$2.00 - First 5 free"], published: [] },
  { lines: ["Fees", "$10 - $25 Wire Transfer", "$5 - 10 Copies"], published: [] },
  { lines: ["Fees", "$15.00 - Business Account Maintenance", "$5.00 - Personal Account Maintenance"], published: [] },
  { lines: ["ATM", "$2.00 - ATM Withdrawal (non-network)", "$1.00 - ATM Balance Inquiry"], published: [["atm_non_network", 1.0, null, "ATM"], ["atm_non_network", 2.0, null, "ATM"]] },
  { lines: ["Overdraft", "$500 - Overdraft Limit", "$35.00 - Overdraft Fee"], published: [["overdraft", 35.0, null, "Overdraft Fee"]] },
  { lines: ["Checks", "$1.50 - Per Check over 20", "$0.25 - Per page"], published: [] },
  { lines: ["Notary", "$10.00 - Non-Member Notary", "$0.00 - Member Notary"], published: [["notary_fee", 10.0, null, "Notary"]] },
  { lines: ["Fees", "$5.00 - MONTHLY FEE", "$30.00 - STOP PAYMENT FEE"], published: [["monthly_maintenance", 5.0, "monthly", "MONTHLY FEE"], ["stop_payment", 30.0, null, "STOP PAYMENT FEE"]] },
  { lines: ["Fees", "$5.00 - Each Additional Page", "$2.00 - Fax"], published: [] },
  { lines: ["Fees", "$5.00 - Statement Copy ($10.00 maximum)", "$2.00 - Check Copy"], published: [] },
  { lines: ["Fees", "$25.00 - Stop Payment, Annual Fee $10.00", "$3.00 - Check Copy"], published: [["stop_payment", 10.0, "annual", "Stop Payment, Annual Fee"]] },
  { lines: ["Fees", "$20.00 - Dormant Account (after 12 months; balance under $500)", "$5.00 - Returned Mail"], published: [] },
  { lines: ["Fees", "$30.00 - Overdraft Item Fee", "$5,000 - Overdraft Coverage Limit"], published: [["overdraft", 30.0, null, "Overdraft Item Fee"]] },
  { lines: ["Record Research", "$25.00 per hour ($5.00 minimum)", "Replace Lost Key", "$10.00 - If both keys are lost, the box must be drilled open at a cost determined at opening.", "Wire Transfers Customer (outgoing) - Foreign"], published: [["account_research", 25.0, "hourly", "Record Research"], ["safe_deposit_box", 10.0, null, "Replace Lost Key"]] },
  { lines: ["Replace Lost Key", "$10.00 - Both keys lost requires drilling"], published: [["safe_deposit_box", 10.0, null, "Replace Lost Key"]] },
  { lines: ["Stop Payment", "$30.00 - Charged when you request a stop"], published: [["stop_payment", 30.0, null, "Stop Payment"]] },
  { lines: ["Overdraft Fee", "$35.00 - You will be charged per item"], published: [["overdraft", 35.0, "per_item", "Overdraft Fee"]] },
  { lines: ["Stop Payment", "$30.00 - Each Request"], published: [["stop_payment", 30.0, "per_item", "Stop Payment"]] },
  { lines: ["Returned Item", "$25.00 - Per Item Returned", "Stop Payment", "$30.00 - Per Request"], published: [["nsf", 25.0, "per_item", "Returned Item"], ["stop_payment", 30.0, "per_item", "Stop Payment"]] },
  { lines: ["Paper Statement", "$3.00 - Waived With eStatements"], published: [["paper_statement", 3.0, null, "Paper Statement"]] },
  { lines: ["Overdraft Fee", "$32.00 - Maximum 3 Per Day"], published: [["overdraft", 32.0, "daily", "Overdraft Fee"]] },
  { lines: ["Fees", "$25.00 - Stop Payment", "Wire Transfer | $30.00", "$10.00 - Returned Mail"], published: [] },
  { lines: ["Business Fees", "$15.00 - Business Monthly Service Fee", "$0.25 - Per Deposited Item"], published: [] },
  { lines: ["Fees", "$5.00 - Overdraft Transfer (from savings)", "$25.00 - Overdraft Fee (per item; maximum $125 per day)"], published: [["overdraft", 25.0, "per_item", "Overdraft Fee (per item; maximum $125 per day)"]] },
];

export const CHANGED_FROM_MAIN: Array<NearMiss & { main: Published[] }> = [
  { lines: ["Services", "$25.00 - Account Research (per hour)", "$15.00 - Statement Copy"], main: [], published: [["account_research", 25.0, "hourly", "Account Research (per hour)"], ["document_reproduction", 15.0, null, "Statement Copy"]] },
  { lines: ["Services", "$25.00 - NSF FEE", "$30.00 - STOP PAYMENT"], main: [["nsf", 25.0, null, "NSF FEE"]], published: [["nsf", 25.0, null, "NSF FEE"], ["stop_payment", 30.0, null, "STOP PAYMENT"]] },
  { lines: ["Checking Fees", "$25.00 - NSF Check/ACH/ATM item", "$20.00 - Stop Payment (single check)", "$35.00 - Stop Payment (range of checks)", "$10.00 - Debit Card Replacement"], main: [["stop_payment", 35.0, null, "Stop Payment (single check)"]], published: [["card_replacement", 10.0, null, "Debit Card Replacement"], ["nsf", 25.0, null, "NSF Check/ACH/ATM item"], ["stop_payment", 20.0, null, "Stop Payment (single check)"], ["stop_payment", 35.0, null, "Stop Payment (range of checks)"]] },
  { lines: ["Fees", "$5.00 – Paper Statement Fee", "$3.00 — Check Copy"], main: [["paper_statement", 5.0, null, "Paper Statement Fee"]], published: [["check_image", 3.0, null, "Check Copy"], ["paper_statement", 5.0, null, "Paper Statement Fee"]] },
  { lines: ["Fees", "$5.00 - Inactive Account (after 12 months)", "$10.00 - Dormant Account per quarter"], main: [], published: [["dormant_account", 5.0, null, "Inactive Account (after 12 months)"], ["dormant_account", 10.0, "quarterly", "Dormant Account per quarter"]] },
  { lines: ["Fees", "$35.00 - Daily Overdraft Fee", "$5.00 - Continuous Overdraft (after 5 days)"], main: [["continuous_od", 35.0, "daily", "Daily Overdraft Fee"]], published: [["continuous_od", 5.0, null, "Continuous Overdraft (after 5 days)"], ["continuous_od", 35.0, "daily", "Daily Overdraft Fee"]] },
  { lines: ["Fees", "$12.00 - Returned Mail (per month)", "$6.00 - Annual Card Fee"], main: [], published: [["returned_mail", 12.0, "monthly", "Returned Mail (per month)"]] },
  { lines: ["Fees", "$0.00 - Notary Service", "$0 - Incoming Wire"], main: [["notary_fee", 0.0, null, "Notary Service"]], published: [["notary_fee", 0.0, null, "Notary Service"], ["wire_domestic_incoming", 0.0, null, "Incoming Wire"]] },
  { lines: ["Fees", "$10.00 - Monthly Service Charge", "$5.00 - Paper Statement"], main: [["monthly_maintenance", 10.0, "monthly", "Monthly Service Charge"]], published: [["monthly_maintenance", 10.0, "monthly", "Monthly Service Charge"], ["paper_statement", 5.0, null, "Paper Statement"]] },
  { lines: ["Fees", "$30.00 - NSF", "$30.00 - Overdraft (per item, max 3 per day)"], main: [["nsf", 30.0, "per_item", "NSF"]], published: [["nsf", 30.0, null, "NSF"], ["overdraft", 30.0, "per_item", "Overdraft (per item, max 3 per day)"]] },
  { lines: ["Wires", "$25.00 - Wire Transfer (Outgoing)", "$15.00 - Wire Transfer (Incoming)"], main: [], published: [["wire_domestic_incoming", 15.0, null, "Wire Transfer (Incoming)"], ["wire_domestic_outgoing", 25.0, null, "Wire Transfer (Outgoing)"]] },
  { lines: ["Savings", "$5.00 - Excessive Withdrawal (over 6 per month)", "$3.00 - Counter Check"], main: [], published: [["counter_check", 3.0, null, "Counter Check"], ["excess_withdrawal", 5.0, null, "Excessive Withdrawal (over 6 per month)"]] },
  { lines: ["Fees", "Overdraft Fee $35.00", "$20.00 - Stop Payment", "$10.00 - Returned Mail"], main: [["overdraft", 35.0, null, "Overdraft Fee"]], published: [["overdraft", 35.0, null, "Overdraft Fee"], ["returned_mail", 10.0, null, "Returned Mail"], ["stop_payment", 20.0, null, "Stop Payment"]] },
  { lines: ["Fees", "$2.50 - ATM Fee (5 free per month)", "$1.00 - Balance Inquiry"], main: [["atm_non_network", 2.5, null, "ATM Fee (5 free per month)"]], published: [["atm_non_network", 1.0, null, "Balance Inquiry"], ["atm_non_network", 2.5, null, "ATM Fee (5 free per month)"]] },
  { lines: ["Fees", "$3.00 - ATM Withdrawal at non-network ATMs", "$0.00 - ATM Withdrawal at our ATMs"], main: [], published: [["atm_non_network", 3.0, null, "ATM Withdrawal at non-network ATMs"]] },
];
