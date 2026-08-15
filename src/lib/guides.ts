export interface Guide {
  slug: string;
  title: string;
  description: string;
  feeCategories: string[];
  sections: GuideSection[];
}

export interface GuideSection {
  heading: string;
  content: string;
}

export const GUIDES: Guide[] = [
  {
    slug: "overdraft-fees",
    title: "Understanding Overdraft Fees: What Banks Charge and How to Avoid Them",
    description:
      "A complete guide to overdraft fees at US banks and credit unions. National benchmarks, how to compare institutions, and strategies to minimize costs.",
    feeCategories: ["overdraft", "od_daily_cap", "od_protection_transfer"],
    sections: [
      {
        heading: "What is an overdraft fee?",
        content:
          "An overdraft fee is charged when a transaction exceeds your available balance and the bank covers the difference. These fees typically range from $25 to $38 per occurrence, though some institutions have eliminated them entirely. Overdraft fees remain one of the most significant sources of non-interest income for banks and credit unions.",
      },
      {
        heading: "How overdraft fees vary",
        content:
          "Overdraft fees vary significantly by institution type, size, and geography. Credit unions generally charge less than banks. Community banks often have lower fees than large national banks. Some institutions have introduced tiered overdraft fees based on the transaction amount.",
      },
      {
        heading: "How to avoid overdraft fees",
        content:
          "Link a savings account for automatic overdraft protection transfers (typically $5-$12 per transfer, far less than a standard overdraft fee). Set up low balance alerts. Opt out of debit card overdraft coverage for point-of-sale transactions. Consider institutions that offer overdraft grace periods or have eliminated overdraft fees.",
      },
    ],
  },
  {
    slug: "nsf-fees",
    title: "NSF Fees Explained: Non-Sufficient Funds Charges at US Banks",
    description:
      "What are NSF fees, how much do banks charge, and how do they differ from overdraft fees? National data and tips for consumers.",
    feeCategories: ["nsf", "nsf_daily_cap", "deposited_item_return"],
    sections: [
      {
        heading: "What is an NSF fee?",
        content:
          "A non-sufficient funds (NSF) fee is charged when a transaction is declined because your account lacks the funds to cover it. Unlike overdraft fees, the bank does not cover the transaction. The check or payment bounces back to the payee. NSF fees are typically similar in amount to overdraft fees.",
      },
      {
        heading: "NSF vs. overdraft fees",
        content:
          "With an overdraft, the bank pays the transaction and charges you a fee. With NSF, the bank declines the transaction and still charges a fee. In both cases, the fee amount is often the same. Some institutions have merged these into a single fee structure or eliminated NSF fees while keeping overdraft fees.",
      },
      {
        heading: "Reducing NSF risk",
        content:
          "Monitor your balance regularly through mobile banking. Set up automatic transfers from savings as a buffer. Time bill payments to align with paycheck deposits. Consider banks that offer real-time balance notifications before transactions are declined.",
      },
    ],
  },
  {
    slug: "atm-fees",
    title: "ATM Fees by Bank: How Much You Pay for Out-of-Network Withdrawals",
    description:
      "Compare ATM fees at US banks and credit unions. Foreign ATM surcharges, network access, and how to minimize ATM costs.",
    feeCategories: ["atm_non_network", "atm_international", "balance_inquiry"],
    sections: [
      {
        heading: "Understanding ATM fees",
        content:
          "When you use an ATM outside your bank's network, you may pay two fees: a surcharge from the ATM operator and a foreign ATM fee from your own bank. Combined, these can exceed $5 per transaction. Some credit unions and online banks reimburse ATM fees as a competitive advantage.",
      },
      {
        heading: "How ATM fees compare",
        content:
          "Large banks typically charge $2.50-$3.50 for out-of-network ATM use. Credit unions often charge less or participate in surcharge-free networks like CO-OP or Allpoint. Online-only banks frequently offer unlimited ATM fee rebates. International ATM fees add an additional $2-$5 per transaction.",
      },
      {
        heading: "Minimizing ATM costs",
        content:
          "Use your bank's ATM locator app. Get cash back at point-of-sale instead of using ATMs. Consider credit unions with CO-OP network access (30,000+ surcharge-free ATMs). Look for banks offering ATM fee rebates.",
      },
    ],
  },
  {
    slug: "wire-transfer-fees",
    title: "Wire Transfer Fees: What Banks Charge for Domestic and International Wires",
    description:
      "Compare wire transfer fees at US banks and credit unions. Domestic vs. international, incoming vs. outgoing, and cheaper alternatives.",
    feeCategories: [
      "wire_domestic_outgoing",
      "wire_domestic_incoming",
      "wire_intl_outgoing",
      "wire_intl_incoming",
    ],
    sections: [
      {
        heading: "How wire transfer fees work",
        content:
          "Wire transfers are electronic fund transfers between banks via networks like Fedwire or SWIFT. Fees vary by direction (incoming vs. outgoing) and destination (domestic vs. international). Outgoing wires are always more expensive than incoming. International wires cost significantly more due to correspondent banking relationships.",
      },
      {
        heading: "Typical wire transfer costs",
        content:
          "Domestic outgoing wires typically cost $20-$30. Incoming domestic wires may be free or cost $10-$15. International outgoing wires range from $35-$50. Credit unions generally charge less than banks for all wire types. Online-initiated wires are sometimes cheaper than branch-initiated ones.",
      },
      {
        heading: "Alternatives to wire transfers",
        content:
          "For domestic transfers, ACH transfers are usually free but take 1-3 business days. Zelle offers free instant transfers between participating banks. For international transfers, services like Wise (formerly TransferWise) often offer better exchange rates and lower fees than traditional bank wires.",
      },
    ],
  },
  {
    slug: "monthly-maintenance-fees",
    title: "Monthly Maintenance Fees: Which Banks Charge Them and How to Avoid Them",
    description:
      "Guide to monthly account maintenance fees at US banks and credit unions. How much they cost, who charges them, and how to get them waived.",
    feeCategories: ["monthly_maintenance", "early_closure", "dormant_account"],
    sections: [
      {
        heading: "What are monthly maintenance fees?",
        content:
          "Monthly maintenance fees (also called monthly service charges) are recurring fees charged for maintaining a checking or savings account. They range from $4 to $25 per month and are typically waivable by meeting minimum balance requirements, setting up direct deposit, or maintaining a certain number of transactions.",
      },
      {
        heading: "Who charges maintenance fees?",
        content:
          "Large national banks are the most likely to charge monthly maintenance fees, often $12-$25 per month for basic checking. Community banks charge moderate fees. Credit unions are the least likely to charge monthly fees, and when they do, amounts are typically under $10. Online-only banks almost never charge monthly fees.",
      },
      {
        heading: "Getting fees waived",
        content:
          "Set up direct deposit (most common waiver). Maintain a minimum daily or average balance. Link multiple accounts at the same bank. Enroll in paperless statements. Student and senior accounts often have automatic fee waivers. If none of these work, consider switching to a no-fee institution.",
      },
    ],
  },
  {
    slug: "foreign-transaction-fees",
    title: "Foreign Transaction Fees: What Banks Charge for International Purchases",
    description:
      "How much US banks charge for foreign transactions, currency conversion, and international card use.",
    feeCategories: ["card_foreign_txn", "atm_international"],
    sections: [
      {
        heading: "What is a foreign transaction fee?",
        content:
          "A foreign transaction fee is a surcharge applied when you make a purchase in a foreign currency or through a foreign bank. Most US banks charge 1-3% of the transaction amount. This fee is separate from any currency conversion spread applied by the card network (Visa, Mastercard).",
      },
      {
        heading: "How foreign transaction fees compare",
        content:
          "Most major bank credit and debit cards charge 3% for foreign transactions. Many travel-focused credit cards waive this fee entirely. Credit unions vary widely, with some charging 1% and others matching bank rates. Online banks increasingly offer no foreign transaction fees as a competitive feature.",
      },
      {
        heading: "Avoiding foreign transaction fees",
        content:
          "Use a card that waives foreign transaction fees when traveling. Pay in local currency rather than USD to avoid dynamic currency conversion markups. For international ATM withdrawals, look for banks that reimburse ATM fees and waive foreign transaction surcharges.",
      },
    ],
  },
  {
    slug: "check-fees",
    title: "Check Fees: Cashier's Checks, Stop Payments, and Check Printing Costs",
    description:
      "What banks charge for check-related services including cashier's checks, stop payments, and check printing.",
    feeCategories: ["cashiers_check", "stop_payment", "check_printing", "money_order", "counter_check"],
    sections: [
      {
        heading: "Common check fees",
        content:
          "Banks charge fees for various check-related services. Cashier's checks typically cost $8-$15. Stop payment orders range from $15-$36. Check printing varies widely based on style and quantity, from free basic checks to $30+ for premium designs. Money orders are generally cheaper at $5-$10.",
      },
      {
        heading: "How check fees compare",
        content:
          "Credit unions consistently charge less than banks for check services. Online banks may offer free cashier's checks or money orders. Large national banks tend to charge premium prices for check services. Some institutions waive check fees for premium account holders.",
      },
      {
        heading: "Reducing check costs",
        content:
          "Order checks from third-party vendors instead of your bank. Use electronic payments (ACH, Zelle) instead of cashier's checks when possible. Ask about fee waivers for premium accounts. Credit union members often get better rates on check services.",
      },
    ],
  },
  {
    slug: "digital-banking-fees",
    title: "Digital Banking Fees: ACH, Mobile Deposit, and Online Payment Costs",
    description:
      "Fees for digital banking services including ACH transfers, mobile deposits, bill pay, and electronic payments.",
    feeCategories: ["ach_origination", "ach_return", "bill_pay", "mobile_deposit"],
    sections: [
      {
        heading: "What are digital banking fees?",
        content:
          "Digital banking fees cover electronic services like ACH transfers, mobile check deposits, and online bill payments. While many of these services are free at consumer banks, some institutions charge for expedited transfers, ACH origination, or returned electronic payments.",
      },
      {
        heading: "Common digital fees by service",
        content:
          "ACH origination fees range from free to $3 per transfer. ACH return fees (bounced electronic payments) typically cost $15-$30, similar to NSF fees. Mobile deposit is generally free but some banks limit the number of free deposits per month. Bill pay services are usually included at no charge.",
      },
      {
        heading: "Choosing a digital-first bank",
        content:
          "Online-only banks typically offer the most generous digital banking terms with no ACH fees, unlimited mobile deposits, and free bill pay. Traditional banks are increasingly matching these offerings. Compare digital fee schedules carefully if you rely heavily on electronic transfers.",
      },
    ],
  },
  {
    slug: "account-closure-fees",
    title: "Account Closure & Dormant Fees: What Banks Charge for Inactive Accounts",
    description:
      "Fees for closing accounts early and penalties for inactive or dormant accounts at US banks and credit unions.",
    feeCategories: ["early_closure", "dormant_account", "account_research"],
    sections: [
      {
        heading: "Early account closure fees",
        content:
          "Many banks charge a fee if you close your account within 90-180 days of opening it. These fees typically range from $25-$50 and are designed to discourage account churning. Not all banks charge this fee, and credit unions are less likely to impose early closure penalties.",
      },
      {
        heading: "Dormant account fees",
        content:
          "If your account has no activity for 12-24 months, banks may classify it as dormant and begin charging monthly inactivity fees of $5-$15. After a longer period, funds may be escheated to the state. Dormant fees can quickly erode small balances.",
      },
      {
        heading: "Avoiding closure and dormancy charges",
        content:
          "Keep accounts open for at least 6 months before closing. Set up a small recurring transaction to prevent dormancy. Before closing, transfer all funds and confirm any pending transactions have cleared. Request written confirmation of account closure.",
      },
    ],
  },
  {
    slug: "safe-deposit-fees",
    title: "Safe Deposit Box Fees: What Banks Charge for Secure Storage",
    description:
      "Annual costs for safe deposit boxes at US banks, box sizes, and what to consider before renting.",
    feeCategories: ["safe_deposit_box", "notary_fee"],
    sections: [
      {
        heading: "Safe deposit box pricing",
        content:
          "Safe deposit box fees are charged annually and vary by box size. Small boxes (3x5 inches) typically cost $20-$60 per year. Medium boxes (5x10) run $75-$150. Large boxes (10x10) can cost $150-$300 or more. Prices vary significantly by location and institution.",
      },
      {
        heading: "Comparing box fees",
        content:
          "Credit unions often offer lower safe deposit box rates than banks. Urban branches tend to charge more than suburban or rural locations. Some banks offer discounts for premium account holders. Late payment fees for box rental can be $25-$50.",
      },
      {
        heading: "Alternatives to safe deposit boxes",
        content:
          "Home safes offer one-time cost for document storage. Digital document storage services provide secure access from anywhere. For valuables, consider specialized vault storage companies. Insurance riders on homeowner's policies may be more cost-effective for jewelry and collectibles.",
      },
    ],
  },
];

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
