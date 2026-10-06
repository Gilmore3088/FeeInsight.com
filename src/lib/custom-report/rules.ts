/**
 * Headline fee lines of the Competitive Fee Position Report and the rules that decide
 * which published row counts for each (ported from Reports/studio/pull-data.sql v2).
 * The catalog's canonical_fee_key is not trusted on its own: a row counts only when its
 * own fee_name supports the category, and values outside a plausible band are dropped.
 */
export interface FeeLineRule {
  key: string;
  label: string;
  sourceKeys: string[];
  include: string;
  exclude: string;
  lo: number;
  hi: number;
  allowZero: boolean;
}

export const FEE_LINE_RULES: FeeLineRule[] = [
  {
    key: "monthly_maintenance",
    label: "Monthly maintenance (entry checking)",
    sourceKeys: ["monthly_maintenance", "minimum_balance"],
    include: "(maintenance|monthly service|service charge|monthly fee)",
    exclude:
      "(savings|money market|club|night deposit|safe deposit|box|annual|dormant|inactive|statement|\\mira\\M|certificate|\\mcd\\M|loan|escheat|clos|research|excess|activity|withdrawal|saver|business|commercial|analysis|\\mhsa\\M|health|escrow|trust|address|fax|cop(y|ies))",
    lo: 0,
    hi: 30,
    allowZero: true,
  },
  {
    key: "overdraft",
    label: "Overdraft (per item)",
    sourceKeys: ["overdraft", "nsf"],
    include: "(overdraft|overdrawn|\\mod\\M|o/d|paid item|paid nsf|courtesy pay|bounce protection|privilege)",
    exclude: "(transfer|sweep|daily|continuous|extended|sustained|limit|line of credit|protection plan|\\mcap\\M|maximum|return)",
    lo: 5,
    hi: 45,
    // A bank that states $0 (no overdraft or NSF charge) is a real data point, not a gap.
    allowZero: true,
  },
  {
    key: "nsf",
    label: "NSF / returned item",
    sourceKeys: ["nsf", "overdraft"],
    include: "(nsf|insufficient|non-?sufficient|returned item|return(ed)? (check|item|ach|payment)|unpaid item)",
    exclude: "(deposit|\\mcap\\M|daily max|maximum|\\mpaid\\M|others|re-?present|credit card|loan|transfer|cover)",
    lo: 5,
    hi: 45,
    // A bank that states $0 (no overdraft or NSF charge) is a real data point, not a gap.
    allowZero: true,
  },
  {
    key: "atm_non_network",
    label: "Out-of-network ATM",
    sourceKeys: ["atm_non_network"],
    include: "atm",
    exclude: "(replace|deposit|statement|card fee|annual|\\mpin\\M|inquir|denied|declin)",
    lo: 0.5,
    hi: 10,
    allowZero: false,
  },
  {
    key: "wire_domestic_outgoing",
    label: "Outgoing domestic wire",
    sourceKeys: ["wire_domestic_outgoing"],
    include: "wire",
    exclude: "(incoming|receiv|international|foreign|intl|trace|reversal|recall|amend|investigat|return)",
    lo: 5,
    hi: 50,
    allowZero: false,
  },
  {
    key: "wire_intl_outgoing",
    label: "Outgoing international wire",
    sourceKeys: ["wire_intl_outgoing"],
    include: "wire",
    exclude: "(incoming|receiv|trace|reversal|recall|amend|investigat|return|check|deposit|collection)",
    lo: 15,
    hi: 100,
    allowZero: false,
  },
  {
    key: "wire_domestic_incoming",
    label: "Incoming domestic wire",
    sourceKeys: ["wire_domestic_incoming"],
    include: "wire",
    exclude: "(outgoing|send|sent|international|foreign|intl|trace|reversal|recall|amend|investigat|return)",
    lo: 0,
    hi: 30,
    allowZero: true,
  },
  {
    key: "stop_payment",
    label: "Stop payment",
    sourceKeys: ["stop_payment"],
    include: "stop",
    exclude: "(release|cancel|revoc|line of credit|heloc|loan|cashier|official)",
    lo: 10,
    hi: 45,
    allowZero: false,
  },
  {
    key: "cashiers_check",
    label: "Cashier's check",
    sourceKeys: ["cashiers_check"],
    include: "(cashier|official check|bank check|treasurer|certified|teller check)",
    exclude: "(cop(y|ies)|stop|replace|lost|research)",
    lo: 2,
    hi: 20,
    allowZero: false,
  },
  {
    key: "od_protection_transfer",
    label: "Overdraft protection transfer",
    sourceKeys: ["od_protection_transfer"],
    include: "(overdraft|\\mod\\M|\\modp\\M|o/d|sweep|protection)",
    exclude: "(balance transfer|wire|telephone|phone|online|internal|\\mach\\M|external|book|set-?up|excess|money market)",
    lo: 2,
    hi: 20,
    allowZero: false,
  },
  {
    key: "paper_statement",
    label: "Paper statement",
    sourceKeys: ["paper_statement"],
    include: "statement",
    exclude: "(cop(y|ies)|address|research|re-?print|duplicate|interim|special|photo|image|e-?statement)",
    lo: 0.5,
    hi: 10,
    allowZero: false,
  },
  {
    key: "card_replacement",
    label: "Debit card replacement",
    sourceKeys: ["card_replacement"],
    include: "(replace|reissue|lost|stolen)",
    exclude: "(check|statement|key|book|expedit|rush|overnight)",
    lo: 1,
    hi: 30,
    allowZero: false,
  },
  {
    key: "deposited_item_return",
    label: "Deposited item returned",
    sourceKeys: ["deposited_item_return", "nsf"],
    include: "(deposit(ed)? (item|check)|return(ed)? deposit|deposit return|chargeback)",
    exclude: "(night|safe|box|mobile deposit fee|remote|collection|correction)",
    lo: 3,
    hi: 40,
    allowZero: false,
  },
];

export const FEE_LINE_LABELS: Record<string, string> = Object.fromEntries(
  FEE_LINE_RULES.map((rule) => [rule.key, rule.label]),
);
