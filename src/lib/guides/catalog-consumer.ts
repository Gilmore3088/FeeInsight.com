/**
 * Consumer fee guides.
 *
 * Every guide here is `accessTier: "public"` and stays that way. Consumer education is
 * never gated; the paying tier is served by `catalog-professional.ts`.
 *
 * Dollar figures are `{{category.stat}}` tokens, never literals. If you find yourself
 * typing a dollar sign into prose, the number belongs in a token instead.
 */

import type { Guide } from "./types";

const AUTHOR = "Fee Insight Research";
const REVIEWED = "2026-08-15";
const PUBLISHED = "2026-08-15";

const base = {
  audience: "consumer",
  accessTier: "public",
  author: AUTHOR,
  reviewedAt: REVIEWED,
  publishedAt: PUBLISHED,
  methodologyHref: "/methodology",
  carriesRegulatoryContent: true,
} as const;

export const CONSUMER_GUIDES: Guide[] = [
  // ── 1 ────────────────────────────────────────────────────────────────────
  // Rebuilt Oct 16 2026 (James's guides review): a practical guide to overdraft decisions,
  // in his order: immediate help, OD/NSF, consent, prevention, account policies, questions,
  // rules and sources. No outcome is promised; every price is a live token or a computed scenario.
  {
    ...base,
    slug: "overdraft-fees",
    title: "Overdraft Fees",
    seoTitle: "Overdraft Fees Explained: What Happened, How to Avoid the Next One, and How to Compare Accounts",
    description:
      "What to do about an overdraft charge, how to avoid the next one, and how to compare account policies, with fees from published schedules.",
    reviewedAt: "2026-10-16",
    primaryCategory: "overdraft",
    relatedCategories: ["nsf", "od_daily_cap", "od_protection_transfer", "continuous_od"],
    family: "Overdraft & NSF",
    featured: true,
    relatedSlugs: ["nsf-fees", "monthly-maintenance-fees", "digital-banking-fees"],
    sections: [
      {
        id: "start-here",
        heading: "Start with your question",
        blocks: [
          {
            type: "paths",
            paths: [
              {
                question: "I was charged. What happened?",
                answer: "Tell overdraft from NSF, check the payment type and your consent, then ask for a refund.",
                href: "#what-happened",
              },
              {
                question: "How do I avoid another charge?",
                answer: "Your debit card choice, alerts, linked accounts and timing, and their limits.",
                href: "#avoid",
              },
              {
                question: "Is there a better account for me?",
                answer: "Compare published policies line by line, including who can join and monthly cost.",
                href: "#compare-your-bank",
              },
            ],
          },
        ],
      },
      {
        id: "what-happened",
        heading: "I was charged. What happened?",
        blocks: [
          {
            type: "outcomes",
            setup: "One payment, three outcomes. You have $40 in checking and a $60 bill arrives.",
            outcomes: [
              {
                kind: "paid",
                title: "Overdraft",
                payment: "Your institution pays the $60 and your balance goes to minus $20.",
                cost: "An overdraft fee may apply. The median we track is {{overdraft.median}}.",
                after: "You owe the $20 plus any fee. Some institutions add a charge if you stay negative.",
              },
              {
                kind: "returned",
                title: "Returned unpaid (NSF)",
                payment: "Your institution declines to pay and sends the payment back.",
                cost: "An NSF fee may apply, depending on its policy. The median is {{nsf.median}}.",
                after: "The bill is still unpaid, and the biller may charge its own late or returned-payment fee.",
              },
              {
                kind: "transfer",
                title: "Linked account transfer",
                payment: "Money moves from a linked savings account, credit line or card to cover the $60.",
                cost: "A transfer fee may apply. The median is {{od_protection_transfer.median}}.",
                after: "It works only when the linked account holds enough, and it is a separate service with its own terms.",
              },
            ],
          },
          {
            type: "list",
            ordered: true,
            items: [
              "Find the fee on your statement. It will say overdraft, paid item, NSF or returned item. The statement also totals these fees for the period and the year to date.",
              "Note what kind of payment caused it. Debit card purchases and ATM withdrawals follow a consent rule; checks, ACH payments and recurring card payments do not.",
              "Find the policy. The fee schedule or account agreement names the fee, any daily limit and any exemption for small amounts.",
              "Ask which payment caused the fee, how that day's payments were ordered, and whether the fee can be refunded. Refunds are case by case.",
            ],
          },
        ],
      },
      {
        id: "consent",
        heading: "Your consent choices",
        blocks: [
          {
            type: "callout",
            tone: "regulatory",
            title: "Your choice about debit card overdraft fees",
            rule: "Regulation E",
            text: "Your institution cannot charge an overdraft fee for paying an ATM withdrawal or a one-time debit card purchase unless you opted in. Without your opt-in it may decline the transaction or pay it without a fee. Opting in allows the fee; it does not guarantee a payment will be made.",
            source: { label: "12 CFR 1005.17", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1005/section-1005.17" },
          },
          {
            type: "paragraph",
            text: "Checks, ACH payments such as online bill pay, and recurring debit card payments are outside that rule. Whatever you chose for your card, your institution may pay these and charge an overdraft fee, or return them and charge an NSF fee, as its policy allows.",
          },
        ],
      },
      {
        id: "avoid",
        heading: "How to avoid another charge",
        blocks: [
          {
            type: "list",
            items: [
              "Opt out of debit card overdraft coverage. Your institution then cannot charge an overdraft fee on card purchases and ATM withdrawals; it may decline them instead. The tradeoff is a declined card at the register.",
              "Set a low-balance alert above your largest regular payment. It helps only if you can move money before the payment posts.",
              "Link a savings account or credit line. The median transfer fee is {{od_protection_transfer.median}} against an overdraft median of {{overdraft.median}}, but a transfer covers you only when the linked account holds enough.",
              "Time payments after your deposit posts. This helps when income arrives on a predictable day. It does not help when a deposit is held or the amount varies.",
              "Ask about a grace period or a small-shortfall exemption. Some institutions skip the fee if you restore the balance within a day or the shortfall is small. We do not track these yet.",
            ],
          },
        ],
      },
      {
        id: "what-it-costs",
        heading: "What institutions charge",
        blocks: [
          {
            type: "paragraph",
            text: "Across the {{overdraft.institutions}} banks and credit unions whose schedules we hold, the median overdraft fee is {{overdraft.median}}, and the middle half charge {{overdraft.p25}} to {{overdraft.p75}}. The fee is usually flat: overdrawing by $3 or by $300 costs the same.",
          },
          {
            type: "distribution",
            category: "overdraft",
            caption: "Overdraft fee, one value per institution",
          },
          {
            type: "paragraph",
            text: "{{overdraft.zero_count}} institutions list a $0 overdraft fee on the schedule we hold. That can mean a no-fee service, no overdraft service, or $0 on one account only. A $0 fee is not a promise to pay.",
          },
          {
            type: "scenarios",
            intro: "The arithmetic below uses one illustrative account so its terms fit together. The national median overdraft fee is {{overdraft.median}}.",
            policy: { perItem: 35, maxPerDay: 3, extended: 10, transfer: 12 },
            scenarios: [
              { title: "One overdraft, repaid the next day", items: 1 },
              { title: "Four payments overdraw on the same day", items: 4 },
              { title: "One overdraft, still negative a week later", items: 1, extended: true, note: "Some accounts repeat the extended charge." },
              { title: "A linked savings transfer covers it", items: 1, transfer: true, note: "Only when the savings account holds enough." },
            ],
          },
          {
            type: "calculator",
            kind: "overdraft",
            intro: "Now use your own account's terms from its fee schedule:",
            defaults: { perItem: 35, items: 4, maxPerDay: 3 },
          },
          { type: "cap_scope", category: "od_daily_cap" },
          {
            type: "comparison",
            category: "overdraft",
            dimension: "charter",
            caption: "Overdraft fee by institution type, from published fee schedules",
          },
        ],
      },
      {
        id: "compare-your-bank",
        heading: "Is there a better account for me?",
        blocks: [
          {
            type: "paragraph",
            text: "Check these features before you open or keep an account. Where we do not track a feature, we say so. A missing answer is not the same as no protection.",
          },
          {
            type: "policy_table",
            rows: [
              { feature: "Overdraft fee", question: "What do I pay when the institution covers a shortfall?", category: "overdraft" },
              { feature: "NSF fee", question: "What happens if it returns my payment unpaid?", category: "nsf" },
              { feature: "Daily limit", question: "How many fees, or how much, can I be charged in one day?", category: "od_daily_cap", countOnly: true },
              { feature: "Grace period", question: "Can I restore my balance before a fee applies?" },
              { feature: "Small-shortfall exemption", question: "How far below zero can I go before a fee applies?" },
              { feature: "Small-payment exemption", question: "Are small payments exempt from the fee?" },
              { feature: "Extended overdraft charge", question: "Is there another charge if I stay negative?", category: "continuous_od" },
              { feature: "Linked account transfer", question: "What does a transfer from my savings cost?", category: "od_protection_transfer" },
              { feature: "Monthly maintenance", question: "What will the account cost even without overdrafts?", category: "monthly_maintenance" },
            ],
            compare: {
              intro: "Compare up to three institutions, line by line: the account each line names, its conditions, the source and the date we read it. Not charging a fee is not a promise to pay.",
            },
          },
        ],
      },
      {
        id: "questions-to-ask",
        heading: "Questions to ask your institution",
        blocks: [
          {
            type: "list",
            items: [
              "Do you charge for paying an overdraft, for returning a payment, or both?",
              "Is there a daily limit on these fees, in dollars or in number of fees?",
              "Is there a grace period to restore my balance before a fee applies?",
              "Do you skip the fee for a small shortfall or a small payment? How small?",
              "Is there a charge if my balance stays negative, and does it repeat?",
              "In what order do you process the day's payments?",
              "What does this account cost each month, and how can I avoid that fee?",
            ],
          },
        ],
      },
      {
        id: "what-regulators-say",
        heading: "Rules and recent changes",
        blocks: [
          {
            type: "callout",
            tone: "regulatory",
            title: "Your right to see what overdrafts cost you",
            rule: "Regulation DD",
            text: "Banks must show total overdraft fees and total returned item fees on each periodic statement, for the period and the year to date.",
            source: { label: "12 CFR 1030.11", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1030/section-1030.11" },
          },
          {
            type: "paragraph",
            text: "Credit unions follow the same statement requirement under the NCUA's Truth in Savings rule, Part 707.",
            source: { label: "12 CFR 707.11", url: "https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-707/section-707.11" },
          },
          {
            type: "updates",
            items: [
              {
                title: "Large-institution overdraft rule",
                status: "repealed",
                date: "May 9, 2025",
                changed: "A 2024 CFPB rule would have limited overdraft fees at institutions over $10 billion in assets. Congress disapproved it; it has no force or effect.",
                who: "Customers of banks and credit unions with more than $10 billion in assets.",
                action: "Go by your institution's current fee schedule, not news of the rule.",
                source: { label: "S.J.Res. 18, Public Law 119-10", url: "https://www.congress.gov/bill/119th-congress/senate-joint-resolution/18" },
              },
              {
                title: "NSF fees on instantly declined payments",
                status: "withdrawn",
                date: "January 2025",
                changed: "A 2024 CFPB proposal would have barred NSF fees on card, ATM and some person-to-person payments declined at the moment of payment. The CFPB withdrew it.",
                who: "Anyone whose card or transfer is declined as they pay.",
                action: "Ask whether your institution charges for a declined transaction.",
                source: { label: "Federal Register, Jan 14, 2025", url: "https://www.govinfo.gov/content/pkg/FR-2025-01-14/html/2024-31385.htm" },
              },
              {
                title: "Consent for debit card overdraft fees",
                status: "effective",
                date: "In effect since 2010",
                changed: "Your opt-in is needed before an overdraft fee on ATM and one-time debit card transactions.",
                who: "Checking customers.",
                action: "You can change your choice at any time.",
                source: { label: "12 CFR 1005.17", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1005/section-1005.17" },
              },
            ],
          },
          {
            type: "complaints",
            text: "Complaints consumers sent to the CFPB about institutions we track. Context, not a ranking.",
            source: { label: "CFPB Consumer Complaint Database", url: "https://www.consumerfinance.gov/data-research/consumer-complaints/" },
          },
          {
            type: "paragraph",
            text: "To dispute a fee, ask your institution first, then the CFPB at consumerfinance.gov/complaint.",
          },
        ],
      },
    ],
  },

  // ── 2 ────────────────────────────────────────────────────────────────────
  // Accuracy pass Oct 16 2026 (James's guides review): no promised outcomes, the daily limit
  // defined with its count, $0 fees qualified to the account, rules by purpose first.
  {
    ...base,
    slug: "nsf-fees",
    title: "NSF Fees",
    seoTitle: "NSF Fees Explained: Non-Sufficient Funds Charges at US Banks",
    description:
      "What a non-sufficient funds fee is, how it differs from an overdraft fee, and what to check and ask so a returned payment does not cost you twice.",
    reviewedAt: "2026-10-16",
    primaryCategory: "nsf",
    // `overdraft` is declared because the guide's central comparison cites its median.
    // A guide may only cite fees it declares; see guides.test.ts.
    relatedCategories: ["od_daily_cap", "deposited_item_return", "overdraft"],
    family: "Overdraft & NSF",
    featured: true,
    relatedSlugs: ["overdraft-fees", "check-fees", "digital-banking-fees"],
    sections: [
      {
        id: "what-it-is",
        heading: "What is an NSF fee?",
        blocks: [
          {
            type: "paragraph",
            text: "A non-sufficient funds fee, or NSF fee, may be charged when your institution returns a payment unpaid because your account did not have the money to cover it. The check bounces or the automatic payment fails, and depending on its policy, your institution may still charge you.",
          },
          {
            type: "paragraph",
            text: "That surprises people. With an overdraft, the institution pays the transaction and charges a fee, so the payment at least went through. With an NSF fee, the payment fails and you can still be charged.",
          },
          {
            type: "callout",
            tone: "warning",
            text: "The company you were paying may charge a returned payment or late fee of its own, so one returned payment can cost you twice.",
          },
        ],
      },
      {
        id: "what-it-costs",
        heading: "How much does it cost?",
        blocks: [
          {
            type: "paragraph",
            text: "The national median NSF fee is {{nsf.median}}, across {{nsf.institutions}} institutions whose schedules we hold. The middle half charge {{nsf.p25}} to {{nsf.p75}}, and the highest we have recorded is {{nsf.max}}.",
          },
          { type: "distribution", category: "nsf", caption: "NSF fee, one value per institution" },
          {
            type: "paragraph",
            text: "{{nsf.zero_count}} institutions list a $0 NSF fee on the schedule we hold. A $0 line can apply to one account only, so check the account you hold or plan to open.",
          },
          {
            type: "paragraph",
            text: "{{od_daily_cap.institutions}} institutions publish a daily limit in dollars. A limit can cover NSF fees, overdraft fees or both, so ask what yours covers.",
          },
          { type: "cap_scope", category: "od_daily_cap" },
          {
            type: "paragraph",
            text: "A returned payment can be presented again, and each presentment may draw another fee where the policy allows it. Ask whether yours charges for a re-presented item.",
          },
        ],
      },
      {
        id: "nsf-vs-overdraft",
        heading: "NSF versus overdraft",
        blocks: [
          {
            type: "outcomes",
            setup: "One payment, three outcomes. You have $40 in checking and a $60 bill arrives.",
            outcomes: [
              {
                kind: "paid",
                title: "Overdraft",
                payment: "Your institution pays the $60 and your balance goes to minus $20.",
                cost: "An overdraft fee may apply. The median is {{overdraft.median}}.",
                after: "You owe the $20 plus any fee.",
              },
              {
                kind: "returned",
                title: "Returned unpaid (NSF)",
                payment: "Your institution declines to pay and sends the payment back.",
                cost: "An NSF fee may apply, depending on its policy. The median is {{nsf.median}}.",
                after: "The bill is still unpaid, and the biller may add its own fee.",
              },
              {
                kind: "deposit_returned",
                title: "Someone else's check to you bounces",
                payment: "A check you deposited is returned, and your institution takes the money back.",
                cost: "A returned deposited item fee may apply. The median is {{deposited_item_return.median}}.",
                after: "You need to collect the money from the person who paid you.",
              },
            ],
          },
          {
            type: "paragraph",
            text: "The two fees are often the same amount, which is why the difference gets lost. It matters because an NSF fee leaves the bill unpaid: the payment still has to be made, often with a late fee from the other side. That is how a returned payment can end up costing more than an overdraft of the same amount.",
          },
          {
            type: "paragraph",
            text: "Which one you get is often not your choice. Whether an institution pays or returns a payment depends on its policy, your account history and the payment type, and you are usually not told in advance.",
          },
        ],
      },
      {
        id: "how-to-avoid",
        heading: "How to avoid or reduce this fee",
        blocks: [
          {
            type: "list",
            items: [
              "Check whether your institution charges an NSF fee, and on which accounts.",
              "Ask whether returned payments count toward a daily limit, and how many fees it allows in one day.",
              "Set a low-balance alert above your largest regular payment. It helps only if you can move money before the payment posts.",
              "Know the deposit cutoff time. A deposit made after it does not count toward today's balance, which is how a funded account can still return a payment.",
              "Link a savings account or credit line, if your institution offers it. A transfer covers you only when the linked account holds enough, and it may carry its own fee.",
              "Ask for a refund. Refunds are the institution's decision, case by case.",
              "Compare accounts if it recurs. The overdraft guide compares institutions' policies line by line.",
            ],
          },
        ],
      },
      {
        id: "what-regulators-say",
        heading: "What regulators say",
        blocks: [
          {
            type: "callout",
            tone: "regulatory",
            title: "Your choice about debit card overdraft fees",
            rule: "Regulation E",
            text: "The opt-in rule covers overdraft fees on ATM and one-time debit card transactions. It does not cover NSF fees on checks and automatic payments, which an institution's policy may allow without any opt-in.",
            source: { label: "12 CFR 1005.17", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1005/section-1005.17" },
          },
          {
            type: "callout",
            tone: "regulatory",
            title: "Your right to see what returned items cost you",
            rule: "Regulation DD",
            text: "Banks must disclose the fee in writing before you open the account, and total overdraft and returned item fees on each periodic statement, for the period and the year to date.",
            source: { label: "12 CFR 1030.11", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1030/section-1030.11" },
          },
          {
            type: "paragraph",
            text: "Credit unions follow the same requirements under the NCUA's Truth in Savings rule, Part 707.",
            source: { label: "12 CFR 707.11", url: "https://www.ecfr.gov/current/title-12/chapter-VII/subchapter-A/part-707/section-707.11" },
          },
          {
            type: "updates",
            items: [
              {
                title: "NSF fees on instantly declined payments",
                status: "withdrawn",
                date: "January 2025",
                changed: "A 2024 CFPB proposal would have barred NSF fees on card, ATM and some person-to-person payments declined at the moment of payment. The CFPB withdrew it.",
                who: "Anyone whose card or transfer is declined as they pay.",
                action: "Ask whether your institution charges for a declined transaction.",
                source: { label: "Federal Register, Jan 14, 2025", url: "https://www.govinfo.gov/content/pkg/FR-2025-01-14/html/2024-31385.htm" },
              },
            ],
          },
          {
            type: "paragraph",
            text: "If the same payment was returned several times and drew several fees, dispute it with your institution. If that fails, you can submit a complaint to the CFPB at consumerfinance.gov/complaint.",
          },
        ],
      },
      {
        id: "compare-your-bank",
        heading: "Compare your own bank",
        blocks: [
          {
            type: "benchmark",
            category: "nsf",
            rows: [
              { condition: "No NSF fee listed", meaning: "Check that it covers your account" },
              { condition: "{{nsf.p25}} or less", meaning: "In the lowest-priced quarter" },
              { condition: "Around {{nsf.median}}", meaning: "Right at the national median" },
              { condition: "More than {{nsf.p75}}", meaning: "In the highest-priced quarter" },
            ],
          },
          {
            type: "paragraph",
            text: "Then find the daily limit and the returned deposited item fee. A median NSF fee with no daily limit, plus a charge when someone else's check to you bounces, costs more than the headline number suggests.",
          },
        ],
      },
    ],
  },

  // ── 3 ────────────────────────────────────────────────────────────────────
  {
    ...base,
    slug: "atm-fees",
    title: "ATM Fees",
    seoTitle: "ATM Fees by Bank: What Out-of-Network Withdrawals Really Cost",
    description:
      "Why one ATM withdrawal can carry two fees, how to find cash without paying them, and how to compare accounts' ATM policies.",
    primaryCategory: "atm_non_network",
    relatedCategories: ["card_foreign_txn", "monthly_maintenance"],
    family: "ATM & Card",
    featured: true,
    relatedSlugs: ["foreign-transaction-fees", "monthly-maintenance-fees", "overdraft-fees"],
    helpLinks: {
      title: "Find a fee-free ATM",
      links: [
        { label: "Your bank or credit union's ATM locator", href: "#find-cash", note: "In its app or on its website. It shows the machines that cost you nothing." },
        { label: "Allpoint network", href: "https://www.allpointnetwork.com", note: "Surcharge-free for customers of member institutions." },
        { label: "MoneyPass network", href: "https://www.moneypass.com", note: "Surcharge-free for customers of member institutions." },
        { label: "CO-OP network", href: "https://co-opcreditunions.org", note: "Used by many credit unions for ATMs and shared branches." },
      ],
    },
    sections: [
      {
        id: "start-here",
        heading: "Start here",
        blocks: [
          {
            type: "paths",
            paths: [
              { question: "I was charged twice", answer: "Why one withdrawal can carry two fees, and when to dispute one.", href: "#charged-twice" },
              { question: "Find cheaper cash access", answer: "Fee-free machines, cash back and rebates, with their conditions.", href: "#find-cash" },
              { question: "Compare account ATM policies", answer: "Published ATM fees side by side, and what to ask about rebates and networks.", href: "#compare-your-bank" },
            ],
          },
        ],
      },
      {
        id: "charged-twice",
        heading: "Why was I charged twice?",
        blocks: [
          {
            type: "paragraph",
            text: "At an ATM outside your bank's network, one withdrawal can carry two fees from two different companies.",
          },
          {
            type: "breakdown",
            title: "One out-of-network withdrawal",
            items: [
              { label: "Cash you take out", amount: 40 },
              { label: "Machine owner's fee, shown on screen", amount: 3, sign: "plus" },
              { label: "Your bank's out-of-network fee, on your statement", amount: 2, sign: "plus" },
            ],
            totalLabel: "Taken from your account",
            note: "Illustrative amounts, not any institution's prices. Your receipt shows the first fee and your statement shows the second.",
          },
          {
            type: "list",
            items: [
              "The machine owner's fee appears on screen, and you accept it before the cash comes out.",
              "Your own bank's fee is set in your account terms. It is not shown at the machine, so it often appears days later.",
              "Some banks also charge for a balance inquiry at another bank's machine.",
            ],
          },
          {
            type: "callout",
            tone: "regulatory",
            title: "When to dispute a charge",
            text: "Under Regulation E, the machine must tell you about its fee and let you cancel before you are charged. If no notice appeared, or the machine took the money but gave you no cash, report it to your bank within 60 days of the statement that shows it. The bank must investigate.",
            source: { label: "12 CFR 1005.16 and 1005.11", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1005/section-1005.16" },
          },
        ],
      },
      {
        id: "find-cash",
        heading: "Find cheaper cash access",
        blocks: [
          {
            type: "list",
            ordered: true,
            items: [
              "Open your institution's ATM locator in its app or on its website before you go. Its own machines and its partners' cost you nothing.",
              "Ask which surcharge-free network your institution belongs to, such as Allpoint, MoneyPass or the CO-OP network, and search that network's locator.",
              "Ask for cash back at a store checkout. Some stores require a purchase, set a limit or charge a fee, so check the screen before you confirm.",
              "Check your balance in the app, not at another bank's machine.",
              "If you must pay, withdraw more at once. Each fee is flat, so one withdrawal costs less than three.",
              "Abroad, choose to be charged in the local currency when the machine offers dollars.",
            ],
          },
          {
            type: "paragraph",
            text: "If your account reimburses ATM fees, keep your receipts and check your statement. A reimbursement can have a monthly limit and may be credited later.",
          },
        ],
      },
      {
        id: "what-it-costs",
        heading: "What it costs over a month",
        blocks: [
          {
            type: "paragraph",
            text: "Across {{atm_non_network.institutions}} institutions, the median fee a bank charges its own customer for using another bank's machine is {{atm_non_network.median}}; most fall between {{atm_non_network.p25}} and {{atm_non_network.p75}}. The machine owner's fee comes on top.",
          },
          {
            type: "distribution",
            category: "atm_non_network",
            caption: "Your bank's out-of-network ATM fee, one value per institution",
          },
          {
            type: "calculator",
            kind: "atm",
            intro: "Enter your own numbers from your receipts and your account terms:",
            defaults: { withdrawals: 4, operatorFee: 3, bankFee: 2, rebate: 0 },
          },
        ],
      },
      {
        id: "banks-versus-credit-unions",
        heading: "Banks versus credit unions",
        blocks: [
          {
            type: "comparison",
            category: "atm_non_network",
            dimension: "charter",
            caption: "Out-of-network ATM fee, banks versus credit unions",
          },
          {
            type: "paragraph",
            text: "These medians compare published prices, not accounts. Many credit unions belong to shared networks, and some banks reimburse other banks' fees, so the account you hold decides what you pay.",
          },
        ],
      },
      {
        id: "abroad",
        heading: "Using an ATM abroad",
        blocks: [
          {
            type: "paragraph",
            text: "A withdrawal abroad can carry up to four separate charges. Check each one in your account terms:",
          },
          {
            type: "list",
            items: [
              "Your bank's international ATM fee, a flat amount per withdrawal.",
              "A foreign transaction fee, usually a percentage of the amount.",
              "The machine owner's fee, shown on screen.",
              "The exchange rate. If you accept the machine's offer to charge you in dollars, the machine owner sets the rate.",
            ],
          },
          {
            type: "paragraph",
            text: "The foreign transaction guide covers the percentage and the exchange rate in detail.",
          },
        ],
      },
      {
        id: "compare-your-bank",
        heading: "Compare account ATM policies",
        blocks: [
          {
            type: "paragraph",
            text: "The fee is only part of an ATM policy. Check each of these for the account you hold or plan to open. Where we do not track a feature, we say so.",
          },
          {
            type: "policy_table",
            rows: [
              { feature: "Out-of-network fee", question: "What does my bank charge when I use another bank's machine?", category: "atm_non_network" },
              { feature: "Machine owner's fee reimbursed", question: "Does the account pay back the fee the machine owner charges?" },
              { feature: "Monthly limit", question: "How many withdrawals, or how many dollars of fees, are free or reimbursed each month?" },
              { feature: "Networks", question: "Which surcharge-free networks can I use?" },
              { feature: "Account requirements", question: "Does the ATM benefit need a minimum balance, direct deposit or a premium account?" },
              { feature: "International ATM fee", question: "What does a withdrawal abroad cost, before any percentage?", category: "card_foreign_txn" },
              { feature: "Monthly maintenance", question: "What does the account cost each month?", category: "monthly_maintenance" },
            ],
            compare: {
              intro: "Compare up to three institutions' published ATM lines: the account each line names, its conditions, the source and the date we read it.",
              set: "atm",
            },
          },
          {
            type: "benchmark",
            category: "atm_non_network",
            rows: [
              { condition: "$0, or fees reimbursed", meaning: "Best available" },
              { condition: "{{atm_non_network.p25}} or less", meaning: "In the lowest-priced quarter" },
              { condition: "Around {{atm_non_network.median}}", meaning: "Right at the national median" },
              { condition: "More than {{atm_non_network.p75}}", meaning: "In the highest-priced quarter" },
            ],
          },
        ],
      },
      {
        id: "questions-to-ask",
        heading: "Questions to ask your bank",
        blocks: [
          {
            type: "list",
            items: [
              "Which ATMs can I use without any fee, and which network are you part of?",
              "Do you reimburse other machine owners' fees? Up to how much, and how many times a month?",
              "Does the reimbursement need a certain account, balance or direct deposit?",
              "Do you charge for a balance inquiry at another bank's machine?",
              "What do you charge for a withdrawal abroad, and is there a percentage on top?",
            ],
          },
        ],
      },
      {
        id: "what-regulators-say",
        heading: "What regulators say",
        blocks: [
          {
            type: "paragraph",
            text: "The machine owner's fee must be disclosed at the machine. Your own bank's fee is disclosed in your account terms under Regulation DD instead, which is why the second fee can come as a surprise.",
            source: { label: "12 CFR part 1030", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1030" },
          },
          {
            type: "paragraph",
            text: "There is no federal cap on either fee. Each institution and machine owner sets its own.",
          },
        ],
      },
    ],
  },

  // ── 4 ────────────────────────────────────────────────────────────────────
  {
    ...base,
    slug: "wire-transfer-fees",
    title: "Wire Transfer Fees",
    seoTitle: "Wire Transfer Fees: What Banks Charge for Domestic and International Wires",
    description:
      "What banks charge to send and receive wires, why international costs more than the fee suggests, and when a wire is worth it versus a free alternative.",
    primaryCategory: "wire_domestic_outgoing",
    relatedCategories: ["wire_domestic_incoming", "wire_intl_outgoing", "wire_intl_incoming"],
    family: "Wire Transfers",
    featured: true,
    relatedSlugs: ["digital-banking-fees", "foreign-transaction-fees", "check-fees"],
    sections: [
      {
        id: "what-it-is",
        heading: "What is a wire transfer fee?",
        blocks: [
          {
            type: "paragraph",
            text: "A wire transfer moves money directly between banks, usually the same day, and the money cannot be pulled back once it lands. That finality is what you are paying for.",
          },
          {
            type: "paragraph",
            text: "That is why wires are used for house closings and large purchases, and also why fraudsters ask for them. A wire is not reversible in the way a card payment or an ACH transfer can be.",
          },
          {
            type: "paragraph",
            text: "You can be charged in both directions. Sending costs more than receiving, and international costs more than domestic, so there are typically four different prices in your fee schedule.",
          },
        ],
      },
      {
        id: "what-it-costs",
        heading: "How much does it cost?",
        blocks: [
          {
            type: "list",
            items: [
              "Sending a domestic wire: median {{wire_domestic_outgoing.median}}, typically {{wire_domestic_outgoing.p25}} to {{wire_domestic_outgoing.p75}}",
              "Receiving a domestic wire: median {{wire_domestic_incoming.median}}",
              "Sending an international wire: median {{wire_intl_outgoing.median}}",
              "Receiving an international wire: median {{wire_intl_incoming.median}}",
            ],
          },
          {
            type: "callout",
            tone: "warning",
            text: "On an international wire, the fee is not the main cost. The exchange rate is. If a provider's rate is 3% worse than the market rate, a $5,000 transfer costs you $150 on conversion, on top of the {{wire_intl_outgoing.median}} fee you were quoted.",
          },
          {
            type: "paragraph",
            text: "International wires can also pick up intermediary bank charges in transit. Money routed through a correspondent bank can arrive lighter than expected, and neither your bank nor the recipient's set that charge.",
          },
          {
            type: "paragraph",
            text: "This is why a wire quoted at one price can cost meaningfully more by the time it lands. When money arrives short, an intermediary charge is a common reason, and it is hard to recover after the fact. If the exact amount matters, such as a tuition payment or an invoice that must be paid in full, ask your bank in advance whether the transfer will route through a correspondent, and send a small margin above the required amount.",
          },
          {
            type: "paragraph",
            text: "Wires also have a daily cutoff time, set by each bank. A wire submitted after it does not move until the next business day, which is worth knowing when you are paying for same-day settlement.",
          },
        ],
      },
      {
        id: "who-charges-what",
        heading: "Who charges the most, and who charges the least?",
        blocks: [
          {
            type: "paragraph",
            text: "The chart below compares outgoing domestic wire fees at banks and credit unions, from the published fee schedules in our index.",
          },
          {
            type: "paragraph",
            text: "Some institutions charge less for a wire you send online than for the same wire sent at a branch. If your schedule lists both prices, compare them.",
          },
          {
            type: "comparison",
            category: "wire_domestic_outgoing",
            dimension: "charter",
            caption: "Outgoing domestic wire fee by institution type",
          },
        ],
      },
      {
        id: "how-to-avoid",
        heading: "How to avoid or reduce this fee",
        blocks: [
          {
            type: "list",
            ordered: true,
            items: [
              "Use ACH for anything that is not urgent. A standard bank-to-bank transfer is often free and takes one to three business days.",
              "Use your bank's person-to-person payment service for smaller amounts. It is often free and fast, but it is just as hard to reverse, so send only to people you know.",
              "For international transfers, compare a specialist service against your bank on the exchange rate, not the fee. That is where the real difference sits.",
              "Initiate online rather than in branch if your bank prices them differently.",
              "Ask about a waiver. Some premium and relationship accounts include free wires, and it costs nothing to ask.",
              "Check the incoming fee before giving out your wire details. If your bank charges you to receive, ask the sender to use ACH instead.",
            ],
          },
          {
            type: "callout",
            tone: "tip",
            text: "Before sending a large wire, confirm the account details by phone using a number you looked up yourself, never one from the email requesting payment. Fraudsters target property closings, and a wire is hard to recall.",
          },
        ],
      },
      {
        id: "questions-to-ask",
        heading: "Ask these before you send",
        blocks: [
          {
            type: "list",
            items: [
              "What is the cutoff time for a same-day wire, and what happens to one sent after it?",
              "Do you charge to receive a wire, and is the price different for an international one?",
              "For an international wire, what exchange rate will you use, and will it route through another bank?",
              "Is a wire sent online priced differently from one sent at a branch?",
            ],
          },
        ],
      },
      {
        id: "what-regulators-say",
        heading: "What regulators say",
        blocks: [
          {
            type: "callout",
            tone: "regulatory",
            text: "For international transfers, the Remittance Transfer Rule under Regulation E requires your bank to disclose the exchange rate, the fees, and the amount the recipient will receive before you pay. You can generally cancel within 30 minutes of paying.",
            source: { label: "12 CFR 1005.31", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1005/section-1005.31" },
          },
          {
            type: "paragraph",
            text: "That disclosure is the most useful consumer protection in this guide. It puts the total cost in the open, including the exchange rate. Read it before confirming, and compare the recipient-receives figure between providers rather than the advertised fee.",
          },
          {
            type: "paragraph",
            text: "Domestic wires have no equivalent disclosure. They are governed by commercial payment law (Article 4A of the Uniform Commercial Code) rather than Regulation E, and once a domestic wire is executed correctly there is no right of reversal. If you are defrauded, recovery depends on the receiving bank's cooperation and speed.",
          },
        ],
      },
      {
        id: "compare-your-bank",
        heading: "Compare your own bank",
        blocks: [
          {
            type: "benchmark",
            category: "wire_domestic_outgoing",
            rows: [
              { condition: "{{wire_domestic_outgoing.p25}} or less", meaning: "In the lowest-priced quarter" },
              { condition: "Around {{wire_domestic_outgoing.median}}", meaning: "Right at the national median" },
              { condition: "More than {{wire_domestic_outgoing.p75}}", meaning: "In the highest-priced quarter" },
              { condition: "Charged to receive a domestic wire", meaning: "Ask whether the sender can use ACH" },
            ],
          },
          {
            type: "paragraph",
            text: "If you send money abroad regularly, ignore the fee comparison and run one real test instead: ask two providers what the recipient will actually receive for the same amount sent. The gap between those two numbers is the real price difference, and it can be larger than the fees. Run the test with the amount you actually send, not a round number, because some providers price in tiers.",
          },
        ],
      },
    ],
  },

  // ── 5 ────────────────────────────────────────────────────────────────────
  {
    ...base,
    slug: "monthly-maintenance-fees",
    title: "Monthly Maintenance Fees",
    seoTitle: "Monthly Maintenance Fees: Which Banks Charge Them and How to Get Them Waived",
    description:
      "What a monthly account fee costs, the waiver conditions that actually work, and why this is the easiest bank fee to stop paying entirely.",
    primaryCategory: "monthly_maintenance",
    relatedCategories: ["minimum_balance", "paper_statement", "dormant_account"],
    family: "Account Fees",
    featured: true,
    relatedSlugs: ["account-closure-fees", "overdraft-fees", "digital-banking-fees"],
    sections: [
      {
        id: "what-it-is",
        heading: "What is a monthly maintenance fee?",
        blocks: [
          {
            type: "paragraph",
            text: "A monthly maintenance fee is a recurring charge for having an account. It is not tied to anything you do. It arrives whether you make one transaction or a hundred.",
          },
          {
            type: "paragraph",
            text: "It is also one of the more avoidable fees. Many accounts that charge one also list conditions that waive it, so the conditions matter as much as the price.",
          },
          {
            type: "callout",
            tone: "tip",
            text: "This fee is charged monthly, so the annual cost is twelve times what it looks like. Multiply the national median of {{monthly_maintenance.median}} by twelve to see the yearly cost of an account whose waiver you do not meet.",
          },
        ],
      },
      {
        id: "what-it-costs",
        heading: "How much does it cost?",
        blocks: [
          {
            type: "paragraph",
            text: "The national median monthly maintenance fee is {{monthly_maintenance.median}}, across {{monthly_maintenance.institutions}} institutions. Most fall between {{monthly_maintenance.p25}} and {{monthly_maintenance.p75}}, and the highest recorded is {{monthly_maintenance.max}}. {{monthly_maintenance.zero_count}} institutions list a $0 monthly fee on the schedule we hold, which can be one account only, so check the account you would open.",
          },
          {
            type: "paragraph",
            text: "Two related fees usually travel with it. The minimum balance fee, median {{minimum_balance.median}}, is charged when your balance drops below a threshold. The paper statement fee, median {{paper_statement.median}}, is charged for receiving your statement by mail.",
          },
          {
            type: "paragraph",
            text: "Those two are worth knowing about because they are common waiver levers. Switching to electronic statements can remove one of them outright.",
          },
          {
            type: "paragraph",
            text: "Read the waiver conditions rather than the fee. Two accounts advertising the same monthly fee can be completely different products depending on what it takes to avoid it. A fee waived by any direct deposit is easy to avoid if you have one. The same fee waived only by a large minimum balance may be a fee you pay every month.",
          },
          {
            type: "paragraph",
            text: "Watch for a waiver you have quietly stopped meeting. Changing jobs, splitting a direct deposit across two accounts, or moving savings elsewhere can each restart a fee that had been waived for years, and the first sign is often a statement line.",
          },
        ],
      },
      {
        id: "who-charges-what",
        heading: "Who charges the most, and who charges the least?",
        blocks: [
          {
            type: "paragraph",
            text: "The chart below compares the monthly fees banks and credit unions publish. A median hides the account: one institution can offer a free account and a fee-charging one side by side.",
          },
          {
            type: "paragraph",
            text: "Read the waiver conditions next to the price. Those conditions decide whether you will pay it.",
          },
          {
            type: "comparison",
            category: "monthly_maintenance",
            dimension: "charter",
            caption: "Monthly maintenance fee by institution type",
          },
        ],
      },
      {
        id: "how-to-avoid",
        heading: "How to avoid or reduce this fee",
        blocks: [
          {
            type: "list",
            ordered: true,
            items: [
              "Set up direct deposit if your account waives the fee for it. Check what counts as a qualifying deposit and whether a minimum amount applies.",
              "Switch to electronic statements. It removes the paper statement fee, median {{paper_statement.median}}, and at some banks it counts toward the maintenance waiver too.",
              "Check the minimum balance rule carefully. Some banks use your average daily balance and some use the lowest balance in the cycle. The second is harder to satisfy, so it is worth knowing which you have.",
              "Ask whether linked balances count. Some accounts let combined balances across checking, savings and a certificate meet the threshold.",
              "Ask about student, senior and military accounts. Many institutions offer them with fewer fees, and they may not be offered unless you ask.",
              "If none of that works, compare accounts elsewhere. Moving a checking account takes some planning, because direct deposits and automatic payments must follow it.",
            ],
          },
        ],
      },
      {
        id: "questions-to-ask",
        heading: "Questions to ask your bank",
        blocks: [
          {
            type: "list",
            items: [
              "What exactly waives the monthly fee on my account, and how often is it checked?",
              "Is the balance rule based on my average daily balance or my lowest balance in the cycle?",
              "Is there an account on your schedule with no monthly fee, and what does it leave out?",
              "Will you tell me if my account is converted to a different account type?",
            ],
          },
        ],
      },
      {
        id: "what-regulators-say",
        heading: "What regulators say",
        blocks: [
          {
            type: "callout",
            tone: "regulatory",
            text: "Regulation DD, the Truth in Savings rule, requires your bank to give you a written schedule of fees before you open an account, and to notify you in advance before increasing a fee or introducing a new one.",
            source: { label: "12 CFR 1030.5", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1030/section-1030.5" },
          },
          {
            type: "paragraph",
            text: "That advance notice is the part people ignore. Fee increases arrive as a statement insert or an email that reads like boilerplate, and the increase takes effect whether you read it or not. If your monthly fee has changed recently, look for the notice in your email or mail, because it will also restate the current waiver conditions.",
          },
          {
            type: "paragraph",
            text: "There is no federal cap on account maintenance fees and no federal requirement to offer a free account. The protection is disclosure rather than price control, so comparing is up to you.",
          },
        ],
      },
      {
        id: "compare-your-bank",
        heading: "Compare your own bank",
        blocks: [
          {
            type: "benchmark",
            category: "monthly_maintenance",
            rows: [
              { condition: "$0 with no conditions", meaning: "Best available" },
              { condition: "{{monthly_maintenance.p25}} or less", meaning: "In the lowest-priced quarter" },
              { condition: "Around {{monthly_maintenance.median}}", meaning: "Right at the national median" },
              { condition: "More than {{monthly_maintenance.p75}}", meaning: "In the highest-priced quarter" },
            ],
          },
          {
            type: "paragraph",
            text: "Then ask the more useful question: are you actually paying it? Check the last three statements. If the fee has been waived every month, the headline number does not matter. If it has been charged even once, find out which condition you missed and whether you can meet it every month.",
          },
          {
            type: "paragraph",
            text: "If you have held the same account for years, ask your bank what it offers today. Banks do not always move existing customers onto newer accounts, so an older account can carry a fee a newer one does not.",
          },
        ],
      },
    ],
  },

  // ── 6 ────────────────────────────────────────────────────────────────────
  {
    ...base,
    slug: "foreign-transaction-fees",
    title: "Foreign Transaction Fees",
    seoTitle: "Foreign Transaction Fees: What US Banks Charge for International Purchases",
    description:
      "What your card charges when you spend abroad, the conversion trick that costs more than the fee, and how to pay nothing at all.",
    primaryCategory: "card_foreign_txn",
    relatedCategories: [],
    family: "International",
    featured: false,
    relatedSlugs: ["atm-fees", "wire-transfer-fees", "digital-banking-fees"],
    sections: [
      {
        id: "what-it-is",
        heading: "What is a foreign transaction fee?",
        blocks: [
          {
            type: "paragraph",
            text: "A foreign transaction fee is a percentage your card issuer adds when you buy something in another currency, or from a merchant whose bank is outside the US.",
          },
          {
            type: "paragraph",
            text: "Unlike most bank fees, this one is a percentage rather than a flat amount, so it scales with your spending. A trip where you spend $3,000 on a card charging 3% costs you $90 in fees.",
          },
          {
            type: "callout",
            tone: "warning",
            text: "You do not have to leave the country to be charged. Buying from an overseas online retailer can trigger the same fee at home, and it may not be shown at checkout.",
          },
        ],
      },
      {
        id: "what-it-costs",
        heading: "How much does it cost?",
        blocks: [
          {
            type: "paragraph",
            text: "Across the institutions we track, the median flat charge for using a card or an ATM abroad is {{card_foreign_txn.median}}, with a range from {{card_foreign_txn.min}} to {{card_foreign_txn.max}}, and {{card_foreign_txn.zero_count}} institutions charging nothing. Most cards charge a percentage instead, which these flat figures leave out.",
          },
          {
            type: "paragraph",
            text: "Withdrawing cash abroad stacks charges: your bank's international ATM fee, the foreign transaction percentage that can apply on top of it, and the machine owner's own surcharge. Three charges, one withdrawal.",
          },
          {
            type: "paragraph",
            text: "There is also a cost that never appears as a fee: the exchange rate. The card networks convert at their own published rate, which is usually close to the market rate. The problem is what happens when someone else offers to do the conversion for you.",
          },
          {
            type: "paragraph",
            text: "Because the fee is a percentage, it is invisible in a way flat fees are not. It is folded into each transaction rather than appearing as a separate line, so a statement full of foreign purchases may show no fee line at all, only amounts slightly higher than you expected.",
          },
          {
            type: "paragraph",
            text: "If you want the real figure, add up your foreign purchases for a trip and apply the percentage.",
          },
        ],
      },
      {
        id: "dynamic-currency-conversion",
        heading: "The offer to pay in dollars is a trap",
        blocks: [
          {
            type: "paragraph",
            text: "At a terminal or an ATM abroad you will often be asked whether to be charged in local currency or in US dollars. Paying in dollars sounds safer and more predictable. It is neither.",
          },
          {
            type: "paragraph",
            text: "Choosing dollars is called dynamic currency conversion, and it hands the exchange rate to the merchant or the machine operator rather than the card network. Their rate is often worse than the network rate, and your card's foreign transaction fee can still apply on top.",
          },
          {
            type: "callout",
            tone: "tip",
            text: "Choose the local currency at terminals and ATMs abroad.",
          },
        ],
      },
      {
        id: "how-to-avoid",
        heading: "How to avoid or reduce this fee",
        blocks: [
          {
            type: "list",
            ordered: true,
            items: [
              "Carry a card with no foreign transaction fee. Check the card's terms, because debit and credit cards from the same institution can differ.",
              "Always pay in the local currency. Refuse the conversion offer at every terminal and every ATM.",
              "Withdraw larger amounts less often. A flat ATM fee is the same regardless of size, so fewer withdrawals cost less.",
              "Check your debit card separately from your credit card. Their foreign transaction terms can differ at the same institution.",
              "Tell your bank you are traveling, or set a travel notice in the app, so a fraud check does not block your card abroad.",
              "For a long trip, consider opening an account or card with no foreign transaction fee before you go.",
            ],
          },
        ],
      },
      {
        id: "questions-to-ask",
        heading: "Questions to ask before you travel",
        blocks: [
          {
            type: "list",
            items: [
              "Is the foreign transaction fee a percentage, a flat amount, or both?",
              "Does it apply to online purchases from overseas sellers that are charged in dollars?",
              "What do you charge for using an ATM abroad, on top of the percentage?",
              "Does my debit card carry the same terms as my credit card?",
              "Do you have partner banks abroad whose ATMs I can use without a surcharge?",
              "If a purchase abroad is refunded, do you refund the foreign transaction fee too?",
            ],
          },
        ],
      },
      {
        id: "what-regulators-say",
        heading: "What regulators say",
        blocks: [
          {
            type: "paragraph",
            text: "There is no federal cap on foreign transaction fees. Card issuers set them as a business choice; no regulation sets a ceiling.",
          },
          {
            type: "callout",
            tone: "regulatory",
            text: "Truth in Lending rules require credit card issuers to state the foreign transaction fee in the summary table of the card's terms, which you received when the card was opened.",
            source: { label: "12 CFR 1026.6", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1026/section-1026.6" },
          },
          {
            type: "paragraph",
            text: "Dynamic currency conversion is governed by card network rules rather than federal regulation. Those rules require that you be offered a choice and shown the converted amount before you accept. Read the screen carefully, because dollars can be presented as the default.",
          },
          {
            type: "paragraph",
            text: "For debit cards, Regulation E error resolution still applies abroad. If a foreign transaction is wrong or unauthorized, you have the same dispute rights you have at home, and the same deadlines for reporting it.",
            source: { label: "12 CFR 1005.11", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1005/section-1005.11" },
          },
          {
            type: "paragraph",
            text: "For credit cards, the Fair Credit Billing Act lets you dispute a billing error in writing within 60 days of the statement that shows it, including a charge for something you never received. That right applies to purchases made abroad too.",
            source: { label: "12 CFR 1026.13", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1026/section-1026.13" },
          },
        ],
      },
      {
        id: "compare-your-bank",
        heading: "Compare your own bank",
        blocks: [
          {
            type: "paragraph",
            text: "Find the foreign transaction line on both your debit card and your credit card terms. They are often different.",
          },
          {
            type: "benchmark",
            category: "card_foreign_txn",
            rows: [
              { condition: "No foreign transaction fee", meaning: "Best available" },
              { condition: "{{card_foreign_txn.p25}} or less", meaning: "In the lowest-priced quarter" },
              { condition: "Around {{card_foreign_txn.median}}", meaning: "Right at the national median" },
              { condition: "More than {{card_foreign_txn.p75}}", meaning: "In the highest-priced quarter" },
            ],
          },
          {
            type: "paragraph",
            text: "If you travel or buy from overseas sellers, check this fee before your next trip or order.",
          },
        ],
      },
    ],
  },

  // ── 7 ────────────────────────────────────────────────────────────────────
  {
    ...base,
    slug: "check-fees",
    title: "Check Fees",
    seoTitle: "Check Fees: Cashier's Checks, Stop Payments and Check Printing Costs",
    description:
      "What banks charge for cashier's checks, money orders, stop payments and printed checks, and which of them you can avoid.",
    primaryCategory: "cashiers_check",
    relatedCategories: ["stop_payment", "money_order", "check_printing", "counter_check"],
    family: "Check Services",
    featured: false,
    relatedSlugs: ["nsf-fees", "wire-transfer-fees", "monthly-maintenance-fees"],
    sections: [
      {
        id: "what-it-is",
        heading: "What are check fees?",
        blocks: [
          {
            type: "paragraph",
            text: "Check fees tend to arrive at moments when you have no time to shop around. A cashier's check for a car purchase or a stop payment on a payment gone wrong is not a decision you make at leisure.",
          },
          {
            type: "list",
            items: [
              "A cashier's check is drawn on the bank's own funds, so the recipient knows it will not bounce. Used for large purchases where a personal check would not be accepted.",
              "A money order does a similar job for smaller amounts, and you do not need an account to buy one.",
              "A stop payment tells your bank not to honor a check or payment you already issued.",
              "Counter checks are the blank checks a teller prints when you have run out.",
            ],
          },
        ],
      },
      {
        id: "what-it-costs",
        heading: "How much does it cost?",
        blocks: [
          {
            type: "list",
            items: [
              "Cashier's check: median {{cashiers_check.median}}, typically {{cashiers_check.p25}} to {{cashiers_check.p75}}",
              "Stop payment: median {{stop_payment.median}}",
              "Money order: median {{money_order.median}}",
              "Check printing: median {{check_printing.median}}, varying widely by style and quantity",
              "Counter check: median {{counter_check.median}}",
            ],
          },
          {
            type: "callout",
            tone: "warning",
            text: "The stop payment fee is charged whether or not the stop succeeds. If the check has already cleared, the stop does nothing, so check whether it has cleared before you request one.",
          },
          {
            type: "paragraph",
            text: "Stop payments also expire. A written stop payment generally lasts six months and an oral one expires far sooner unless confirmed in writing, so a stopped check can resurface later and be paid.",
          },
          {
            type: "paragraph",
            text: "Check printing is easy to overlook, because it is presented as part of opening an account rather than as a purchase. You can order checks from an independent printer instead. They carry the same account and routing numbers and clear the same way, so compare the price.",
          },
          {
            type: "paragraph",
            text: "Counter checks, at a median {{counter_check.median}}, are the emergency option: blank checks a teller prints when you have run out. They work, but some businesses refuse them because they lack your printed name and address, which is worth knowing before relying on one.",
          },
        ],
      },
      {
        id: "who-charges-what",
        heading: "Who charges the most, and who charges the least?",
        blocks: [
          {
            type: "paragraph",
            text: "The chart below compares cashier's check fees at banks and credit unions, from the published fee schedules in our index. Some institutions waive these fees for members or for certain accounts, so check the schedule for the account you hold.",
          },
          {
            type: "paragraph",
            text: "To find your own price, open your bank's fee schedule and look for the service by name: cashier's check, money order, stop payment or counter check. The price is listed beside it. Some schedules list a different price for each account, so read the column for the account you have.",
          },
          {
            type: "comparison",
            category: "cashiers_check",
            dimension: "charter",
            caption: "Cashier's check fee by institution type",
          },
        ],
      },
      {
        id: "how-to-avoid",
        heading: "How to avoid or reduce this fee",
        blocks: [
          {
            type: "list",
            ordered: true,
            items: [
              "Compare your bank's check printing price with a third-party printer's. The checks work the same way.",
              "Ask whether your account includes free cashier's checks. Some do, and the benefit may not be advertised.",
              "Use an electronic transfer instead where the recipient will accept one. An ACH transfer can replace a cashier's check in some situations, though not usually at a closing table.",
              "Check whether a payment has already cleared before requesting a stop payment.",
              "Put a stop payment in writing and note the expiry date, so a stopped check cannot be paid months later.",
              "For a one-off need, ask whether the fee can be waived. It costs nothing to ask.",
            ],
          },
        ],
      },
      {
        id: "questions-to-ask",
        heading: "Questions to ask your bank",
        blocks: [
          {
            type: "list",
            items: [
              "Does my account include free cashier's checks or money orders?",
              "What does a stop payment cost, and how long does it last?",
              "How long is the wait before you pay a claim on a lost cashier's check?",
              "Can I order checks from another printer, and will you still accept them?",
              "Do you charge people without an account a different price for the same service?",
            ],
          },
        ],
      },
      {
        id: "what-regulators-say",
        heading: "What regulators say",
        blocks: [
          {
            type: "callout",
            tone: "regulatory",
            text: "Under the Uniform Commercial Code as adopted by the states, a written stop payment order on a personal check is generally effective for six months. An oral order lapses after fourteen days unless you confirm it in writing.",
            source: { label: "UCC 4-403", url: "https://www.law.cornell.edu/ucc/4/4-403" },
          },
          {
            type: "paragraph",
            text: "A cashier's check is different, and this is the part worth knowing. Because it is drawn on the bank's own funds, you generally cannot stop payment on one. If it is lost or stolen, the process is a declaration of loss and a waiting period, often ninety days, before the bank will pay the claim. Treat a cashier's check like cash.",
          },
          {
            type: "paragraph",
            text: "Regulation CC governs how long your bank may hold funds from a check you deposit. That is a hold rather than a fee, but it matters here: a hold you did not expect can lead to the NSF and overdraft fees covered in our other guides.",
          },
          {
            type: "paragraph",
            text: "Regulation DD requires fees tied to your account, such as stop payment fees, to be disclosed before you open the account. Services sold to anyone, such as money orders, may not appear in the account's fee schedule, so ask the price first.",
            source: { label: "12 CFR 1030.4", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1030/section-1030.4" },
          },
        ],
      },
      {
        id: "compare-your-bank",
        heading: "Compare your own bank",
        blocks: [
          {
            type: "benchmark",
            category: "cashiers_check",
            rows: [
              { condition: "Free to account holders", meaning: "Best available" },
              { condition: "{{cashiers_check.p25}} or less", meaning: "In the lowest-priced quarter" },
              { condition: "Around {{cashiers_check.median}}", meaning: "Right at the national median" },
              { condition: "More than {{cashiers_check.p75}}", meaning: "In the highest-priced quarter" },
            ],
          },
          {
            type: "paragraph",
            text: "These fees are easy to ignore because you meet them rarely. That is why they are worth checking now rather than at the counter.",
          },
        ],
      },
    ],
  },

  // ── 8 ────────────────────────────────────────────────────────────────────
  {
    ...base,
    slug: "digital-banking-fees",
    title: "Digital Banking Fees",
    seoTitle: "Digital Banking Fees: ACH Transfers, Mobile Deposit and Online Payment Costs",
    description:
      "Which electronic banking services still carry a charge, what a returned electronic payment costs, and how to move money without paying for it.",
    primaryCategory: "ach_origination",
    relatedCategories: ["ach_return", "bill_pay", "mobile_deposit"],
    family: "Digital Banking",
    featured: false,
    relatedSlugs: ["wire-transfer-fees", "nsf-fees", "monthly-maintenance-fees"],
    sections: [
      {
        id: "what-it-is",
        heading: "What are digital banking fees?",
        blocks: [
          {
            type: "paragraph",
            text: "Many electronic banking services carry no fee. Check your own schedule, because a few institutions still charge for some of them.",
          },
          {
            type: "paragraph",
            text: "The charges that remain cluster in three places: speed, failure, and volume. You pay to make something arrive faster, you pay when an electronic payment fails, and a few institutions still charge per transfer.",
          },
          {
            type: "callout",
            tone: "tip",
            text: "If your bank charges for standard electronic transfers or mobile deposits, compare that charge with the medians below.",
          },
        ],
      },
      {
        id: "what-it-costs",
        heading: "How much does it cost?",
        blocks: [
          {
            type: "list",
            items: [
              "Sending an ACH transfer: median {{ach_origination.median}}",
              "Returned ACH payment: median {{ach_return.median}}",
              "Bill pay: median {{bill_pay.median}}",
              "Mobile deposit: median {{mobile_deposit.median}}, though some banks charge for expedited availability",
            ],
          },
          {
            type: "paragraph",
            text: "The returned ACH fee is the one to watch. It can be charged when an automatic payment fails for insufficient funds. The company you were paying may add a returned payment fee of their own on the same failure.",
          },
          {
            type: "paragraph",
            text: "Automatic payments make this worse rather than better. The whole point of automating a payment is that you stop thinking about it, which means a shortfall is discovered by the payment rather than by you. A payment that is retried against an empty account can generate a separate charge each time, unless your bank limits them.",
          },
          {
            type: "paragraph",
            text: "Mobile deposit carries a quieter cost: the hold. Depositing by phone often carries no fee, but the funds may not all be available immediately, and a deposit you counted on can fail to cover a payment that clears the same day. The fee schedule will not tell you this; the funds availability policy will.",
          },
          {
            type: "paragraph",
            text: "With person-to-person payments, the fee to watch is often not the transfer but the instant-cashout option some apps offer at a percentage of the amount.",
          },
          {
            type: "paragraph",
            text: "Payments sent through a real-time payment service are generally final once sent, much like a wire. Confirm who you are paying before you send, because getting the money back depends on the recipient or their bank.",
          },
        ],
      },
      {
        id: "speed-costs-money",
        heading: "You are usually paying for speed",
        blocks: [
          {
            type: "paragraph",
            text: "Most digital banking charges you will actually meet are expedite fees. Faster mobile deposit availability, same-day bill payment and instant transfer to a debit card often have a slower version with no fee.",
          },
          {
            type: "paragraph",
            text: "Before paying one, check when the money genuinely needs to arrive. A payment due Friday does not need instant delivery on Wednesday. Planning a few days ahead can avoid an expedite fee.",
          },
          {
            type: "callout",
            tone: "warning",
            text: "Instant transfer options inside payment apps commonly charge a percentage of the amount. On larger transfers that can cost more than a flat fee, and the standard option is often free.",
          },
        ],
      },
      {
        id: "how-to-avoid",
        heading: "How to avoid or reduce this fee",
        blocks: [
          {
            type: "list",
            ordered: true,
            items: [
              "Use the standard speed when you can, and start a few days before the deadline.",
              "Set up automatic payments a few days before the due date, not on it. This leaves time to fix a shortfall before the payment goes out.",
              "Keep a small buffer in checking. The returned ACH fee, median {{ach_return.median}}, is triggered by a shortfall that a cushion can absorb.",
              "Use your bank's own bill pay rather than a merchant's expedited option. Check both prices first.",
              "Check the transfer limits on mobile deposit. Exceeding a limit can push a deposit into a slower or chargeable path.",
              "If your bank charges for ordinary electronic transfers, compare alternatives.",
            ],
          },
        ],
      },
      {
        id: "questions-to-ask",
        heading: "Questions to ask your bank",
        blocks: [
          {
            type: "list",
            items: [
              "Do you charge for a standard ACH transfer to an account at another bank?",
              "What do you charge when an automatic payment is returned, and is there a daily limit on those charges?",
              "When are mobile deposits available, and is there a fee for faster availability?",
              "Is there a daily or monthly limit on mobile deposits?",
              "Is bill pay included with my account?",
              "Do you charge to receive a transfer from an account at another bank?",
              "If I send money to the wrong person or to a scammer, what will you do?",
            ],
          },
        ],
      },
      {
        id: "what-regulators-say",
        heading: "What regulators say",
        blocks: [
          {
            type: "callout",
            tone: "regulatory",
            text: "Regulation E gives you error resolution rights on electronic transfers. Report an unauthorized or incorrect electronic transfer within 60 days of the statement and your bank must investigate, generally within ten business days, and correct errors it finds.",
            source: { label: "12 CFR 1005.11", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1005/section-1005.11" },
          },
          {
            type: "paragraph",
            text: "Reporting quickly matters. Your liability for unauthorized electronic transfers can rise the longer you wait, so check your statements.",
          },
          {
            type: "paragraph",
            text: "There is an important gap. Regulation E protects you when money leaves your account without your authorization. It offers much less when you were tricked into sending the payment yourself, the common pattern in person-to-person payment scams.",
            source: { label: "12 CFR part 1005", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1005" },
          },
          {
            type: "paragraph",
            text: "Regulation E also requires advance notice before your bank imposes new electronic transfer fees or changes existing ones.",
            source: { label: "12 CFR 1005.8", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1005/section-1005.8" },
          },
        ],
      },
      {
        id: "compare-your-bank",
        heading: "Compare your own bank",
        blocks: [
          {
            type: "paragraph",
            text: "Look for the electronic services section of your fee schedule and check three lines in particular.",
          },
          {
            type: "benchmark",
            category: "ach_return",
            rows: [
              { condition: "No charge for standard transfers", meaning: "Best available" },
              { condition: "Returned ACH at {{ach_return.p25}} or less", meaning: "In the lowest-priced quarter" },
              { condition: "Returned ACH around {{ach_return.median}}", meaning: "Right at the national median" },
              { condition: "Returned ACH above {{ach_return.p75}}", meaning: "In the highest-priced quarter" },
            ],
          },
          {
            type: "paragraph",
            text: "Then check whether you pay for anything you could do at no charge, such as a standard transfer or a slower deposit. If you pay to move your own money electronically, ask whether another account on the same schedule avoids it.",
          },
        ],
      },
    ],
  },

  // ── 9 ────────────────────────────────────────────────────────────────────
  {
    ...base,
    slug: "account-closure-fees",
    title: "Account Closure & Dormancy Fees",
    seoTitle: "Account Closure and Dormant Account Fees: What Banks Charge for Inactive Accounts",
    description:
      "What it costs to close an account early, how a forgotten account quietly drains itself, and what happens to money the bank eventually gives up on.",
    primaryCategory: "early_closure",
    relatedCategories: ["dormant_account", "account_research"],
    family: "Account Lifecycle",
    featured: false,
    relatedSlugs: ["monthly-maintenance-fees", "check-fees", "safe-deposit-fees"],
    sections: [
      {
        id: "what-it-is",
        heading: "What are closure and dormancy fees?",
        blocks: [
          {
            type: "paragraph",
            text: "Two fees sit at the end of an account's life, and they catch people in opposite ways.",
          },
          {
            type: "paragraph",
            text: "An early closure fee is charged for closing an account shortly after opening it, within a window the account agreement sets. It is often meant to discourage opening an account only to collect a sign-up bonus.",
          },
          {
            type: "paragraph",
            text: "A dormancy fee is charged for the opposite behavior: leaving an account alone. After a period with no activity, set in the account agreement, the bank can classify the account as inactive or dormant and start charging a fee.",
          },
          {
            type: "callout",
            tone: "warning",
            text: "A forgotten account with a small balance can be emptied by a recurring fee charged against money you are not tracking.",
          },
        ],
      },
      {
        id: "what-it-costs",
        heading: "How much does it cost?",
        blocks: [
          {
            type: "paragraph",
            text: "The median early closure fee is {{early_closure.median}}, across {{early_closure.institutions}} institutions, typically ranging from {{early_closure.p25}} to {{early_closure.p75}}. It is charged once.",
          },
          {
            type: "paragraph",
            text: "The median dormant account fee is {{dormant_account.median}}. It can recur, so over time it can cost more than a one-time closure fee.",
          },
          {
            type: "paragraph",
            text: "A third fee often appears alongside these: account research, median {{account_research.median}}, charged when you ask the bank to look into an old account or produce historical records. If you are reconstructing what happened to a dormant account, this is what the reconstruction costs.",
          },
          {
            type: "paragraph",
            text: "The early closure fee applies only within a window after opening, set in the account agreement. If you have been putting off leaving a bank because you think closing is expensive, check that window against the date you opened the account.",
          },
          {
            type: "paragraph",
            text: "Dormancy is the opposite: the risk grows the longer you leave it. Old accounts from a previous job, a college town, or a closed joint relationship are the usual candidates.",
          },
        ],
      },
      {
        id: "what-happens-to-the-money",
        heading: "What happens to forgotten money",
        blocks: [
          {
            type: "paragraph",
            text: "If an account stays inactive long enough, the bank does not keep the balance. State unclaimed property law requires it to be handed to the state, a process called escheatment. The dormancy period before that happens is set by each state, often three to five years.",
          },
          {
            type: "paragraph",
            text: "The money is not lost at that point. Every state runs a free unclaimed property search, and you can claim the funds from the state, though it takes paperwork and time.",
          },
          {
            type: "paragraph",
            text: "Search every state where you have lived or worked. A balance usually goes to the state of the owner's last known address on the account, which may not be where you live now.",
          },
          {
            type: "callout",
            tone: "tip",
            text: "Dormancy fees are charged while the balance is still with the bank, so the fees, not the transfer to the state, are where money is lost.",
          },
        ],
      },
      {
        id: "how-to-avoid",
        heading: "How to avoid or reduce this fee",
        blocks: [
          {
            type: "list",
            ordered: true,
            items: [
              "Before closing a new account, check the early closure window in the account agreement.",
              "Set up a small recurring transaction on any account you intend to keep but not use. Ask your bank what counts as activity; an automatic transfer usually does.",
              "Log in periodically. At some institutions this counts as activity, though a transaction is more reliable.",
              "Close accounts you have stopped using, properly. An account left at zero is still an account that can be charged.",
              "Empty it before you close it, and get written confirmation of the closure. An account you believe is closed can keep charging fees if the request was not completed.",
              "Confirm any pending transactions have cleared first. A payment landing after closure can reopen the account or push it negative.",
            ],
          },
        ],
      },
      {
        id: "questions-to-ask",
        heading: "Questions to ask your bank",
        blocks: [
          {
            type: "list",
            items: [
              "How long after opening does the early closure fee apply?",
              "How long without activity before you charge an inactivity or dormancy fee, and how much is it?",
              "What counts as activity: a deposit, a withdrawal, a login, or a transfer?",
              "Will you notify me before you start charging it?",
              "How do I close an account so that you confirm it in writing?",
              "Can I close the account online or by mail, and does that cost anything?",
            ],
          },
        ],
      },
      {
        id: "what-regulators-say",
        heading: "What regulators say",
        blocks: [
          {
            type: "callout",
            tone: "regulatory",
            text: "Regulation DD requires dormancy and closure fees to be disclosed in your account fee schedule before you open the account, and requires advance notice before a fee is introduced or increased.",
            source: { label: "12 CFR 1030.5", url: "https://www.ecfr.gov/current/title-12/chapter-X/part-1030/section-1030.5" },
          },
          {
            type: "paragraph",
            text: "Unclaimed property is state law rather than federal. Each state sets its own dormancy period, its own notice requirements, and and its own rules about whether a bank may charge fees against a dormant balance at all. Some states restrict this. Because it varies, the rules that apply to you are your state's, not a national standard.",
          },
          {
            type: "paragraph",
            text: "Use your state's official unclaimed property search, which is free. A service offering to find your money for a percentage is charging for a search you can run yourself.",
          },
          {
            type: "paragraph",
            text: "State law generally requires the bank to try to contact you before it turns the balance over to the state, which is one more reason to keep your address current.",
          },
        ],
      },
      {
        id: "compare-your-bank",
        heading: "Compare your own bank",
        blocks: [
          {
            type: "benchmark",
            category: "early_closure",
            rows: [
              { condition: "No early closure fee", meaning: "Best available" },
              { condition: "{{early_closure.p25}} or less", meaning: "In the lowest-priced quarter" },
              { condition: "Around {{early_closure.median}}", meaning: "Right at the national median" },
              { condition: "More than {{early_closure.p75}}", meaning: "In the highest-priced quarter" },
            ],
          },
          {
            type: "paragraph",
            text: "Then do the more valuable thing: list every account you hold and identify the ones you have not touched in a year. Those are the accounts a dormancy fee can drain.",
          },
        ],
      },
    ],
  },

  // ── 10 ───────────────────────────────────────────────────────────────────
  {
    ...base,
    slug: "safe-deposit-fees",
    title: "Safe Deposit Box Fees",
    seoTitle: "Safe Deposit Box Fees: What Banks Charge for Secure Storage",
    description:
      "Annual safe deposit box costs by size, the insurance gap almost nobody knows about, and when a box is the wrong answer.",
    primaryCategory: "safe_deposit_box",
    relatedCategories: ["notary_fee"],
    family: "Branch Services",
    featured: false,
    relatedSlugs: ["account-closure-fees", "check-fees", "monthly-maintenance-fees"],
    sections: [
      {
        id: "what-it-is",
        heading: "What is a safe deposit box fee?",
        blocks: [
          {
            type: "paragraph",
            text: "A safe deposit box is a locked container in your bank's vault, rented by the year. People use them for passports, deeds, wills, and things that are difficult or impossible to replace.",
          },
          {
            type: "paragraph",
            text: "The fee is annual and set by box size. Larger boxes cost more, and prices can vary by branch.",
          },
          {
            type: "callout",
            tone: "warning",
            text: "The contents of a safe deposit box are not FDIC insured. Deposit insurance covers deposits, not property in a vault. If you keep something valuable in a box, it is insured only if you have arranged that separately.",
          },
        ],
      },
      {
        id: "what-it-costs",
        heading: "How much does it cost?",
        blocks: [
          {
            type: "paragraph",
            text: "Across {{safe_deposit_box.institutions}} institutions, the median annual safe deposit box fee is {{safe_deposit_box.median}}, with most falling between {{safe_deposit_box.p25}} and {{safe_deposit_box.p75}}, and a recorded high of {{safe_deposit_box.max}}.",
          },
          {
            type: "paragraph",
            text: "That spread is wide because it covers every box size. A small box for documents sits near the bottom of the range and a large box near the top, so compare like with like when you are shopping.",
          },
          {
            type: "paragraph",
            text: "Two costs sit alongside the rental. Late payment on a box can carry its own fee, and losing both keys means a drilling and lock replacement charge. Notary service, median {{notary_fee.median}}, is often needed for the same documents, and some institutions offer it free to account holders, so ask first.",
          },
          {
            type: "paragraph",
            text: "Boxes are usually issued with two keys and no spare held by the bank. That is a security feature, and it means losing both keys is a real problem: the bank must drill the lock, you pay for the drilling and the replacement lock, and it happens on the branch's schedule rather than yours.",
          },
          {
            type: "paragraph",
            text: "Rental is generally billed annually and often set to auto-debit from a linked account. That is convenient until the linked account closes and the rental goes unpaid, which can lead to the box being drilled and its contents turned over to the state.",
          },
          {
            type: "paragraph",
            text: "Keep a list of what is in the box, with photos, somewhere other than the box. If you ever make a claim against an insurer or the bank, you will need to show what was there.",
          },
          {
            type: "paragraph",
            text: "If you rent a box jointly, check whether the agreement lets either renter open it alone. That matters if one of you dies or cannot get to the branch.",
          },
        ],
      },
      {
        id: "who-charges-what",
        heading: "Who charges the most, and who charges the least?",
        blocks: [
          {
            type: "paragraph",
            text: "The chart below compares box fees banks and credit unions publish. Box size drives the price, so compare the same size.",
          },
          {
            type: "paragraph",
            text: "Availability can matter as much as price. Some branches no longer offer boxes, so ask which nearby branches still have one.",
          },
          {
            type: "comparison",
            category: "safe_deposit_box",
            dimension: "charter",
            caption: "Annual safe deposit box fee by institution type",
          },
        ],
      },
      {
        id: "how-to-avoid",
        heading: "Do you actually need one?",
        blocks: [
          {
            type: "paragraph",
            text: "For some documents a box is the right answer. For others it is an annual cost with a real drawback: you can only reach the contents during branch hours.",
          },
          {
            type: "list",
            ordered: true,
            items: [
              "Do not store your only copy of a will in a box. Access after a death can require probate paperwork, which is exactly when the document is needed. Leave the original with your attorney or executor.",
              "Do not store anything you might need urgently or out of hours, such as a passport before an early flight.",
              "Do store deeds, titles, birth certificates and irreplaceable records that you rarely need but could not easily replace.",
              "Ask whether your account waives the fee. Some premium and relationship accounts include a box.",
              "Consider a quality home safe for documents you need occasionally. It is a one-off cost with no access restriction, though it does not protect against everything a vault does.",
              "If you store valuables, arrange insurance explicitly. Ask your homeowner's or renter's insurer whether a rider covers box contents.",
            ],
          },
        ],
      },
      {
        id: "questions-to-ask",
        heading: "Questions to ask your bank",
        blocks: [
          {
            type: "list",
            items: [
              "What box sizes do you have at this branch, and what does each cost a year?",
              "What do you charge to drill a box if both keys are lost?",
              "Who can open the box besides me: a co-renter, a named agent, or no one?",
              "What happens to the box if this branch closes?",
              "Does my account include a box or a discount on one?",
            ],
          },
        ],
      },
      {
        id: "what-regulators-say",
        heading: "What regulators say",
        blocks: [
          {
            type: "callout",
            tone: "regulatory",
            text: "FDIC and NCUA insurance cover deposits. They do not cover the contents of a safe deposit box.",
          },
          {
            type: "paragraph",
            text: "Your rights over a box come from the rental agreement rather than banking regulation, so the contract is the document that matters. Read what it says about the bank's liability, which is often limited, and about what happens if the branch closes or the vault is relocated.",
          },
          {
            type: "paragraph",
            text: "Unpaid rental leads to the box being drilled and the contents handed to the state as unclaimed property, under the same state laws that govern dormant accounts. Keeping your address current with the institution matters here for the same reason it does there.",
          },
        ],
      },
      {
        id: "compare-your-bank",
        heading: "Compare your own bank",
        blocks: [
          {
            type: "benchmark",
            category: "safe_deposit_box",
            rows: [
              { condition: "Included with your account", meaning: "Best available" },
              { condition: "{{safe_deposit_box.p25}} or less", meaning: "In the lowest-priced quarter" },
              { condition: "Around {{safe_deposit_box.median}}", meaning: "Right at the national median" },
              { condition: "More than {{safe_deposit_box.p75}}", meaning: "In the highest-priced quarter" },
            ],
          },
          {
            type: "paragraph",
            text: "Compare by box size rather than by headline price, and ask two questions the fee schedule will not answer: are the contents insured, and who else can open it if you cannot?",
          },
        ],
      },
    ],
  },
];
