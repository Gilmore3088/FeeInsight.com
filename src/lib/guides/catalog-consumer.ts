/**
 * Consumer fee guides.
 *
 * Every guide here is `accessTier: "public"` and stays that way. Consumer education is
 * never gated — the paying tier is served by `catalog-professional.ts`.
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
  {
    ...base,
    slug: "overdraft-fees",
    title: "Overdraft Fees",
    seoTitle: "Overdraft Fees Explained: What Banks Charge and How to Avoid Them",
    description:
      "What an overdraft fee costs at US banks and credit unions, why the daily cap matters more than the fee itself, and the specific steps that stop you paying it.",
    primaryCategory: "overdraft",
    relatedCategories: ["od_daily_cap", "od_protection_transfer"],
    family: "Overdraft & NSF",
    featured: true,
    relatedSlugs: ["nsf-fees", "monthly-maintenance-fees", "digital-banking-fees"],
    sections: [
      {
        id: "what-it-is",
        heading: "What is an overdraft fee?",
        blocks: [
          {
            type: "paragraph",
            text: "An overdraft fee is what your bank charges when it lets a payment go through even though your account doesn't have enough money to cover it.",
          },
          {
            type: "paragraph",
            text: "Say you have $40 in checking and a $60 insurance payment hits. Your bank has a choice: pay it and charge you a fee, or decline it and charge you a different fee. If it pays, that's an overdraft. You now owe the $20 shortfall plus the fee.",
          },
          {
            type: "paragraph",
            text: "The fee is flat. It does not scale with how far below zero you went. Overdrawing by $3 and overdrawing by $300 usually cost you exactly the same amount.",
          },
        ],
      },
      {
        id: "what-it-costs",
        heading: "How much does it cost?",
        blocks: [
          {
            type: "paragraph",
            text: "Across the {{overdraft.institutions}} banks and credit unions we track, the national median overdraft fee is {{overdraft.median}}. Most institutions fall between {{overdraft.p25}} and {{overdraft.p75}}. The highest we have recorded is {{overdraft.max}}, and {{overdraft.zero_count}} institutions charge nothing at all.",
          },
          {
            type: "paragraph",
            text: "Two other numbers matter more than the headline fee, and almost nobody checks them.",
          },
          {
            type: "list",
            items: [
              "The daily cap is the most your bank will charge in a single day. The median cap is {{od_daily_cap.median}}. Without a cap, three overdrafts in one afternoon cost you three full fees. With one, you stop at the ceiling.",
              "The overdraft protection transfer fee is what your bank charges to pull money from your own savings instead of charging you an overdraft. The median is {{od_protection_transfer.median}}, against an overdraft median of {{overdraft.median}}.",
            ],
          },
          {
            type: "callout",
            tone: "tip",
            text: "Linking a savings account is usually the single highest-return thing you can do about overdraft fees, and it takes about five minutes at most banks.",
          },
          {
            type: "paragraph",
            text: "It is worth doing the annual arithmetic once. Three overdrafts a year at the national median is a meaningful sum for something that is, in most cases, a timing problem rather than a spending one. People who overdraft at all tend to do it several times a year, so the realistic cost is rarely a single fee.",
          },
          {
            type: "paragraph",
            text: "There is one more charge to look for. Some institutions add a continuous or extended overdraft fee if your balance stays negative for several days — a second charge layered on top of the first, sometimes repeating daily until the account is positive again. If your fee schedule lists one, bringing the balance back up quickly matters more than the original fee suggests.",
          },
        ],
      },
      {
        id: "who-charges-what",
        heading: "Who charges the most, and who charges the least?",
        blocks: [
          {
            type: "paragraph",
            text: "Three patterns hold up consistently. Large national banks charge the most, and they also tend to have the highest daily caps, which means a bad week compounds faster. Credit unions charge less — not always dramatically less, but consistently, and they are more likely to cap the number of fees per day.",
          },
          {
            type: "paragraph",
            text: "Online-only banks are the outliers. Several have removed the overdraft fee entirely, usually paired with a small no-fee cushion: they will cover you up to $50 or $100 and simply ask you to bring the balance back up.",
          },
          {
            type: "comparison",
            category: "overdraft",
            dimension: "charter",
            caption: "Overdraft fee by institution type, from published fee schedules",
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
              "Link a savings account for overdraft protection. The transfer costs about {{od_protection_transfer.median}} instead of {{overdraft.median}}. This is the biggest single saving available to most people.",
              "Opt out of debit card overdraft coverage. Federal rules mean your bank cannot charge you an overdraft fee on everyday debit card purchases or ATM withdrawals unless you opted in. If you opted in years ago and forgot, you can opt back out today. Your card is simply declined instead, at no cost.",
              "Turn on low-balance alerts. Most overdrafts are timing accidents, not spending problems. A text at $50 prevents most of them.",
              "Move your bills to just after payday. Two or three days of daylight between deposit and debit removes most of the risk.",
              "Ask for a refund. Banks routinely waive a first overdraft fee for a customer in good standing. Ask once, politely, by phone. It works more often than people expect.",
              "If it keeps happening, change banks. {{overdraft.zero_count}} institutions in our index charge nothing for an overdraft. Paying {{overdraft.median}} several times a year is a reason to move, not a fact of life.",
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
            text: "Two federal rules give you leverage here, and both are worth knowing by name.",
          },
          {
            type: "callout",
            tone: "regulatory",
            text: "Regulation E requires your bank to get your explicit permission — opting in — before it can charge overdraft fees on one-time debit card purchases and ATM withdrawals. If you never opted in, those transactions should be declined at no cost.",
          },
          {
            type: "paragraph",
            text: "Checks and automatic bill payments are not covered by that rule. Banks may pay those and charge you regardless of whether you opted in.",
          },
          {
            type: "paragraph",
            text: "Regulation DD, the Truth in Savings rule, requires your bank to disclose its fees in writing and to show total overdraft fees on your periodic statements, both for the statement period and year to date. That year-to-date figure is worth finding. Most people underestimate their annual total by a wide margin.",
          },
          {
            type: "paragraph",
            text: "The Consumer Financial Protection Bureau accepts complaints about overdraft practices, and overdraft is consistently among the most-complained-about consumer banking topics.",
          },
        ],
      },
      {
        id: "compare-your-bank",
        heading: "Compare your own bank",
        blocks: [
          {
            type: "paragraph",
            text: "Pull up your bank's fee schedule — usually called a Schedule of Fees or a Truth in Savings Disclosure — and find the overdraft line.",
          },
          {
            type: "benchmark",
            category: "overdraft",
            rows: [
              { condition: "{{overdraft.p25}} or less", meaning: "Better than 75% of institutions" },
              { condition: "Around {{overdraft.median}}", meaning: "Right at the national median" },
              { condition: "More than {{overdraft.p75}}", meaning: "You pay more than 75% of the country" },
              { condition: "More than {{overdraft.p75}}, no daily cap", meaning: "Worth switching over" },
            ],
          },
          {
            type: "paragraph",
            text: "Then check two more lines: the daily cap and the overdraft protection transfer fee. A bank with a middling overdraft fee, a tight daily cap and cheap savings transfers will cost you far less in practice than one with a low headline fee and neither.",
          },
        ],
      },
    ],
  },

  // ── 2 ────────────────────────────────────────────────────────────────────
  {
    ...base,
    slug: "nsf-fees",
    title: "NSF Fees",
    seoTitle: "NSF Fees Explained: Non-Sufficient Funds Charges at US Banks",
    description:
      "What a non-sufficient funds fee is, how it differs from an overdraft fee, why many banks have dropped it, and how to stop a bounced payment costing you twice.",
    primaryCategory: "nsf",
    // `overdraft` is declared because the guide's central comparison cites its median.
    // A guide may only cite fees it declares — see guides.test.ts.
    relatedCategories: ["nsf_daily_cap", "deposited_item_return", "overdraft"],
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
            text: "A non-sufficient funds fee — an NSF fee — is charged when a payment is declined because your account did not have the money to cover it. The check bounces. The automatic payment fails. And your bank charges you anyway.",
          },
          {
            type: "paragraph",
            text: "That last part surprises people. With an overdraft, the bank pays the transaction and charges you a fee, so you at least got something for the money. With an NSF, the bank declines the transaction and still charges you. You pay for a payment that did not happen.",
          },
          {
            type: "callout",
            tone: "warning",
            text: "The company you were paying may charge you a returned payment fee of their own, often $25 to $40. One bounced payment can cost you twice.",
          },
        ],
      },
      {
        id: "what-it-costs",
        heading: "How much does it cost?",
        blocks: [
          {
            type: "paragraph",
            text: "The national median NSF fee is {{nsf.median}}, across {{nsf.institutions}} institutions. Most fall between {{nsf.p25}} and {{nsf.p75}}, with a recorded high of {{nsf.max}}.",
          },
          {
            type: "paragraph",
            text: "The most important figure on this page is {{nsf.zero_count}} — the number of institutions charging nothing. NSF fees have been disappearing faster than almost any other consumer bank fee. A large share of the industry dropped them outright rather than defend them, which means paying one is increasingly a choice you can undo by moving.",
          },
          {
            type: "paragraph",
            text: "Where a daily cap exists, the median is {{nsf_daily_cap.median}}. Caps matter more for NSF than for overdraft, because a single failed payment is often retried by the merchant two or three times, and an uncapped bank can charge you on every attempt.",
          },
        ],
      },
      {
        id: "nsf-vs-overdraft",
        heading: "NSF versus overdraft: the difference that costs you",
        blocks: [
          {
            type: "list",
            items: [
              "Overdraft: the bank pays it, you get charged, the payment goes through. Median {{overdraft.median}}.",
              "NSF: the bank refuses it, you still get charged, the payment fails. Median {{nsf.median}}.",
              "Returned deposited item: someone paid you with a check that bounced. Your bank claws the money back and charges you a median {{deposited_item_return.median}} — for a payment failure that was not yours.",
            ],
          },
          {
            type: "paragraph",
            text: "The two fees are often the same amount, which is why the distinction gets lost. It matters because the fixes are different. Overdraft is solved by linking savings. NSF is solved by timing and alerts, because there is no balance to pull from at the moment it triggers.",
          },
          {
            type: "paragraph",
            text: "There is a second reason the difference matters. An NSF fee leaves the original problem unsolved. The rent is still unpaid, the insurance has still lapsed, and the payment still has to be made — usually with a late fee attached from the other side. An overdraft at least completes the transaction. This is why an NSF fee frequently ends up costing more in total than an overdraft fee of the identical amount.",
          },
          {
            type: "paragraph",
            text: "Which one you get is often not your choice. Whether a bank pays or declines a given transaction depends on its own discretionary rules, your account history and the transaction type. Two people with the same balance and the same payment can get different outcomes, and neither is told why in advance.",
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
              "Check whether your bank still charges it. Many no longer do. This one question answers the whole problem for a growing share of customers.",
              "Turn on low-balance alerts and act on them. NSF is a timing failure, and a warning 48 hours out is usually enough.",
              "Know your bank's cutoff time. A deposit made after the cutoff does not count toward today's balance, which is how a well-funded account still bounces a payment.",
              "Ask the merchant to re-present rather than re-trying automatically. Each automatic retry can trigger another fee if your bank has no daily cap.",
              "Ask for a refund on the first one. As with overdraft, banks frequently waive a first occurrence.",
              "Move if it recurs. {{nsf.zero_count}} institutions in our index charge no NSF fee at all.",
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
            text: "NSF fees sit in a different regulatory position from overdraft fees, and the difference works in your favour less than you would hope.",
          },
          {
            type: "callout",
            tone: "regulatory",
            text: "Regulation E's opt-in requirement covers overdraft fees on one-time debit card and ATM transactions. It does not extend to NSF fees on checks and automatic payments, which is why those can be charged without you ever having agreed to anything.",
          },
          {
            type: "paragraph",
            text: "Regulation DD requires your bank to disclose the fee in writing before you open the account, and to total both overdraft and returned-item fees on your periodic statement for the period and year to date.",
          },
          {
            type: "paragraph",
            text: "Federal regulators have applied sustained supervisory pressure to fees charged on repeatedly re-presented payments — the same transaction bouncing several times and generating several fees. If that has happened to you, it is worth disputing directly and, if that fails, complaining to the Consumer Financial Protection Bureau.",
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
              { condition: "No NSF fee at all", meaning: "Where a growing share of the industry now sits" },
              { condition: "{{nsf.p25}} or less", meaning: "Better than 75% of institutions" },
              { condition: "Around {{nsf.median}}", meaning: "Right at the national median" },
              { condition: "More than {{nsf.p75}}", meaning: "You pay more than 75% of the country" },
            ],
          },
          {
            type: "paragraph",
            text: "Then find the daily cap and the returned deposited item fee. A bank that charges a median NSF fee with no cap, and bills you when someone else's check to you bounces, is more expensive than its headline number suggests.",
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
      "Why one ATM withdrawal can carry two separate fees, what banks and credit unions charge, and how to stop paying to reach your own money.",
    primaryCategory: "atm_non_network",
    relatedCategories: ["atm_international", "balance_inquiry"],
    family: "ATM & Card",
    featured: true,
    relatedSlugs: ["foreign-transaction-fees", "monthly-maintenance-fees", "overdraft-fees"],
    sections: [
      {
        id: "what-it-is",
        heading: "What is an ATM fee?",
        blocks: [
          {
            type: "paragraph",
            text: "When you use an ATM that does not belong to your bank's network, you can be charged twice for one withdrawal.",
          },
          {
            type: "list",
            items: [
              "The surcharge comes from whoever owns the machine. You see it on screen and have to accept it before the cash comes out.",
              "The out-of-network fee comes from your own bank, for the same transaction. You usually do not see this one until your statement.",
            ],
          },
          {
            type: "paragraph",
            text: "The second fee is the one people miss. You approved a $3 surcharge, and a few days later a second charge from your own bank appears against the same withdrawal.",
          },
        ],
      },
      {
        id: "what-it-costs",
        heading: "How much does it cost?",
        blocks: [
          {
            type: "paragraph",
            text: "Across {{atm_non_network.institutions}} institutions, the median out-of-network ATM fee charged by your own bank is {{atm_non_network.median}}, with most falling between {{atm_non_network.p25}} and {{atm_non_network.p75}}. Add the machine owner's surcharge on top, and a single withdrawal commonly costs more than $5.",
          },
          {
            type: "paragraph",
            text: "Using an ATM abroad adds another layer: the median international ATM fee is {{atm_international.median}}, and that is before any currency conversion charge on the same transaction.",
          },
          {
            type: "callout",
            tone: "warning",
            text: "Some banks charge for a balance inquiry at an out-of-network machine — a median {{balance_inquiry.median}} to be told a number you can see for free in your app. Check your balance before you leave, not at the ATM.",
          },
          {
            type: "paragraph",
            text: "The cost is worst on small withdrawals. Taking out $20 and paying $5 in combined fees is a 25% charge on your own money.",
          },
          {
            type: "paragraph",
            text: "That percentage framing is the useful one. Nobody would accept a 25% charge on a purchase, but the same charge on a cash withdrawal passes unnoticed because it is presented as a flat few dollars. A person taking out $40 twice a week at an out-of-network machine can spend more on ATM access over a year than on every other bank fee combined.",
          },
          {
            type: "paragraph",
            text: "Some banks include a small number of out-of-network withdrawals per month before charging, and others rebate a capped dollar amount. Both are worth finding in your fee schedule, because they change the calculation entirely: a fee you get four free passes on every month is not really a fee for most people.",
          },
        ],
      },
      {
        id: "who-charges-what",
        heading: "Who charges the most, and who charges the least?",
        blocks: [
          {
            type: "paragraph",
            text: "Credit unions do notably well here, and the reason is structural rather than generous: many belong to shared branching and surcharge-free networks that give members access to tens of thousands of machines at no charge. A small credit union can offer a larger fee-free ATM footprint than a national bank.",
          },
          {
            type: "paragraph",
            text: "Online-only banks compete on this directly. Having no branches, several reimburse ATM fees outright, sometimes without a monthly limit — which turns their biggest structural weakness into a selling point.",
          },
          {
            type: "comparison",
            category: "atm_non_network",
            dimension: "charter",
            caption: "Out-of-network ATM fee by institution type",
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
              "Get cash back at a supermarket or pharmacy checkout. It is free at most retailers and it is the single easiest fix.",
              "Ask your institution which shared network it belongs to. Members often have far more free machines available than they realise.",
              "Take out more, less often. If you cannot avoid a fee, one larger withdrawal beats three small ones — the fee is flat, so the percentage falls as the amount rises.",
              "Never accept the ATM's currency conversion offer abroad. Choosing to be charged in dollars hands the machine owner the exchange rate. Always pick the local currency.",
              "Check your balance in the app, never at the machine, if your bank charges for inquiries.",
              "If you use cash regularly, pick an institution that rebates ATM fees. For a frequent cash user this single feature can outweigh every other fee difference between two accounts.",
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
            text: "Under Regulation E, an ATM operator must tell you a surcharge is coming and let you cancel the transaction before it is charged. If cash came out without you seeing a fee notice, that is worth disputing.",
          },
          {
            type: "paragraph",
            text: "That protection covers the machine owner's surcharge. It does not cover your own bank's out-of-network fee, which is disclosed in your account agreement under Regulation DD rather than at the point of withdrawal. This is precisely why the second fee catches people out — only one of the two has to be shown to you at the moment you decide.",
          },
          {
            type: "paragraph",
            text: "There is no federal cap on either fee. Both are set by the institution, which is why the range between the cheapest and most expensive is so wide.",
          },
        ],
      },
      {
        id: "compare-your-bank",
        heading: "Compare your own bank",
        blocks: [
          {
            type: "paragraph",
            text: "Find the ATM lines in your fee schedule. There are usually two or three of them, and the one that matters most is your own bank's out-of-network charge.",
          },
          {
            type: "benchmark",
            category: "atm_non_network",
            rows: [
              { condition: "$0, or fees rebated", meaning: "Best available — common at online banks and some credit unions" },
              { condition: "{{atm_non_network.p25}} or less", meaning: "Better than 75% of institutions" },
              { condition: "Around {{atm_non_network.median}}", meaning: "Right at the national median" },
              { condition: "More than {{atm_non_network.p75}}", meaning: "You pay more than 75% of the country" },
            ],
          },
          {
            type: "paragraph",
            text: "Then ask the question the fee schedule will not answer: how many free machines can you actually reach from home and from work? A slightly higher fee you never trigger beats a lower fee you pay weekly. Open your bank's ATM locator and check both locations before deciding — for a regular cash user, the map matters more than the price list.",
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
            text: "It is also why wires are the payment method of choice for house closings and large purchases — and why they are the payment method of choice for fraud. A wire is not reversible in the way a card payment or an ACH transfer is.",
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
              "Receiving a domestic wire: median {{wire_domestic_incoming.median}} — many institutions charge nothing",
              "Sending an international wire: median {{wire_intl_outgoing.median}}",
              "Receiving an international wire: median {{wire_intl_incoming.median}}",
            ],
          },
          {
            type: "callout",
            tone: "warning",
            text: "On an international wire, the fee is not the main cost. The exchange rate is. A bank taking 3% on conversion costs you $150 on a $5,000 transfer, which dwarfs the {{wire_intl_outgoing.median}} fee you were quoted.",
          },
          {
            type: "paragraph",
            text: "International wires can also pick up intermediary bank charges in transit. Money routed through a correspondent bank can arrive $15 to $30 lighter than expected, and neither your bank nor the recipient's set that charge.",
          },
          {
            type: "paragraph",
            text: "This is why a wire quoted at one price can cost meaningfully more by the time it lands. When someone abroad tells you the money arrived short, an intermediary charge is usually the reason, and there is rarely anything either end can do about it after the fact. If the exact amount matters — a tuition payment, an invoice that must be paid in full — ask your bank in advance whether the transfer will route through a correspondent, and send a small margin above the required amount.",
          },
          {
            type: "paragraph",
            text: "Wires also have a daily cutoff, usually early afternoon. A wire submitted after it does not move until the next business day, which is worth knowing when you are paying for same-day settlement.",
          },
        ],
      },
      {
        id: "who-charges-what",
        heading: "Who charges the most, and who charges the least?",
        blocks: [
          {
            type: "paragraph",
            text: "Credit unions are consistently cheaper on wires than banks, across all four directions. The gap is often meaningful rather than marginal.",
          },
          {
            type: "paragraph",
            text: "Within any institution, initiating a wire online is frequently cheaper than doing it at a branch — sometimes by $10 or more for the identical transfer. If your bank offers both, the counter is the expensive option.",
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
              "Use ACH for anything that is not urgent. A standard bank-to-bank transfer is usually free and takes one to three business days. Most wires are paid for by people who did not need the speed.",
              "Use a real-time payment app for smaller amounts between people. Free between participating banks, and instant.",
              "For international transfers, compare a specialist service against your bank on the exchange rate, not the fee. That is where the real difference sits.",
              "Initiate online rather than in branch if your bank prices them differently.",
              "Ask about a waiver. Premium and relationship accounts often include free wires, and this is one of the most commonly waived fees if you ask.",
              "Check the incoming fee before giving out your wire details. If your bank charges you to receive, ask the sender to use ACH instead.",
            ],
          },
          {
            type: "callout",
            tone: "tip",
            text: "Before sending a large wire, confirm the account details by phone using a number you looked up yourself — never one from the email requesting payment. Wire fraud around property closings is common, and a wire is final.",
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
            text: "For international transfers, the Remittance Transfer Rule under Regulation E requires your bank to disclose the exchange rate, all fees, and the exact amount the recipient will receive — before you pay. You also get a window, generally 30 minutes, to cancel.",
          },
          {
            type: "paragraph",
            text: "That disclosure is the most useful consumer protection in this guide. It forces the total cost into the open, including the exchange rate, which is where banks make most of their money on international transfers. Read it before confirming, and compare the recipient-receives figure between providers rather than the advertised fee.",
          },
          {
            type: "paragraph",
            text: "Domestic wires have no equivalent protection. They are governed by commercial payment law rather than consumer protection rules, and once a domestic wire is executed correctly there is no right of reversal. If you are defrauded, recovery depends on the receiving bank's cooperation and speed.",
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
              { condition: "{{wire_domestic_outgoing.p25}} or less", meaning: "Better than 75% of institutions" },
              { condition: "Around {{wire_domestic_outgoing.median}}", meaning: "Right at the national median" },
              { condition: "More than {{wire_domestic_outgoing.p75}}", meaning: "You pay more than 75% of the country" },
              { condition: "Charged to receive a domestic wire", meaning: "Many institutions do not charge at all" },
            ],
          },
          {
            type: "paragraph",
            text: "If you send money abroad regularly, ignore the fee comparison and run one real test instead: ask two providers what the recipient will actually receive for the same amount sent. The gap between those two numbers is the real price difference, and it is usually far larger than the fees. Run the test with the amount you actually send, not a round number, because some providers price in tiers.",
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
            text: "It is also the most avoidable fee in banking. Nearly every account that charges one also lists conditions that waive it, and nearly every bank has at least one account that does not charge it at all.",
          },
          {
            type: "callout",
            tone: "tip",
            text: "This fee is charged monthly, so the annual cost is twelve times what it looks like. At the national median of {{monthly_maintenance.median}} a month, that is a meaningful annual sum for an account you may be able to switch for free.",
          },
        ],
      },
      {
        id: "what-it-costs",
        heading: "How much does it cost?",
        blocks: [
          {
            type: "paragraph",
            text: "The national median monthly maintenance fee is {{monthly_maintenance.median}}, across {{monthly_maintenance.institutions}} institutions. Most fall between {{monthly_maintenance.p25}} and {{monthly_maintenance.p75}}, and the highest recorded is {{monthly_maintenance.max}}. Critically, {{monthly_maintenance.zero_count}} institutions charge nothing.",
          },
          {
            type: "paragraph",
            text: "Two related fees usually travel with it. The minimum balance fee, median {{minimum_balance.median}}, is charged when your balance drops below a threshold. The paper statement fee, median {{paper_statement.median}}, is charged for receiving your statement in the post.",
          },
          {
            type: "paragraph",
            text: "Those two are worth knowing about because they are the most common waiver levers. Switching to electronic statements can remove one of them outright, and it takes about a minute.",
          },
          {
            type: "paragraph",
            text: "Read the waiver conditions rather than the fee. Two accounts advertising the same monthly fee can be completely different products depending on what it takes to avoid it. A fee waived by any direct deposit is effectively zero for anyone with a job. The same fee waived only by a five-figure minimum balance is a fee you will pay every month.",
          },
          {
            type: "paragraph",
            text: "Watch for a waiver you have quietly stopped meeting. Changing jobs, splitting a direct deposit across two accounts, or moving savings elsewhere can each restart a fee that had been waived for years, and the first sign is usually a statement line nobody reads.",
          },
        ],
      },
      {
        id: "who-charges-what",
        heading: "Who charges the most, and who charges the least?",
        blocks: [
          {
            type: "paragraph",
            text: "Large national banks are the most likely to charge a monthly fee on a standard checking account, and to set the waiver thresholds highest. Community banks tend to sit in the middle. Credit unions are the least likely to charge one at all, and where they do the amount is usually small.",
          },
          {
            type: "paragraph",
            text: "Online-only banks almost never charge one. Having no branch network to fund is the whole reason, and it is the clearest example in retail banking of a cost structure showing up directly in a consumer's fee schedule.",
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
              "Set up direct deposit. This is the most common waiver and usually the easiest to satisfy. Many banks waive the fee for any qualifying deposit, not a large one.",
              "Switch to electronic statements. It removes the paper statement fee, median {{paper_statement.median}}, and at some banks it counts toward the maintenance waiver too.",
              "Check the minimum balance rule carefully. Some banks use your average daily balance and some use the lowest balance in the cycle. The second is far harder to satisfy and is worth knowing which you have.",
              "Link accounts. Combined balances across checking, savings and a certificate often clear a threshold that checking alone would not.",
              "Ask about student, senior and military accounts. These carry automatic waivers at most institutions and are frequently not offered unless you ask.",
              "If none of that works, move the account. {{monthly_maintenance.zero_count}} institutions in our index charge no monthly fee at all, and switching a checking account is a single afternoon's work.",
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
          },
          {
            type: "paragraph",
            text: "That advance notice is the part people ignore. Fee increases arrive as a statement insert or an email that reads like boilerplate, and the increase takes effect whether you read it or not. If your monthly fee has changed recently, the notice was sent — it is worth searching your email for it, because it will also restate the current waiver conditions.",
          },
          {
            type: "paragraph",
            text: "There is no federal cap on account maintenance fees and no requirement to offer a free account. Some states and some federal programmes encourage low-cost basic accounts, but for most consumers the protection is disclosure rather than price control, which puts the responsibility to compare squarely on you.",
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
              { condition: "$0 with no conditions", meaning: "Best available, and widely offered" },
              { condition: "{{monthly_maintenance.p25}} or less", meaning: "Better than 75% of institutions" },
              { condition: "Around {{monthly_maintenance.median}}", meaning: "Right at the national median" },
              { condition: "More than {{monthly_maintenance.p75}}", meaning: "You pay more than 75% of the country" },
            ],
          },
          {
            type: "paragraph",
            text: "Then ask the more useful question: are you actually paying it? Check the last three statements. If the fee has been waived every month, the headline number does not matter. If it has been charged even once, find out which condition you missed — it is usually one you can fix permanently in a few minutes.",
          },
          {
            type: "paragraph",
            text: "If you have held the same account for years without reviewing it, that is the single best reason to look now. Accounts are rarely upgraded automatically, and banks routinely launch better products without moving existing customers onto them. The account you opened a decade ago may still be charging a fee that the same bank no longer charges anyone opening today.",
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
    relatedCategories: ["atm_international"],
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
            text: "Unlike most bank fees, this one is a percentage rather than a flat amount, so it scales with your spending. A two-week trip where you spend $3,000 on a card charging 3% costs you $90 in fees alone.",
          },
          {
            type: "callout",
            tone: "warning",
            text: "You do not have to leave the country to be charged. Buying from an overseas online retailer can trigger the same fee from your armchair, and it is rarely shown at checkout.",
          },
        ],
      },
      {
        id: "what-it-costs",
        heading: "How much does it cost?",
        blocks: [
          {
            type: "paragraph",
            text: "Most US cards charge around 3% of the transaction. Across the institutions we track, the median foreign transaction charge is {{card_foreign_txn.median}}, with a range from {{card_foreign_txn.min}} to {{card_foreign_txn.max}}, and {{card_foreign_txn.zero_count}} institutions charging nothing.",
          },
          {
            type: "paragraph",
            text: "Withdrawing cash abroad stacks charges. The median international ATM fee is {{atm_international.median}}, and the foreign transaction percentage frequently applies on top of it, alongside the machine owner's own surcharge. Three charges, one withdrawal.",
          },
          {
            type: "paragraph",
            text: "There is also a cost that never appears as a fee: the exchange rate. The card networks convert at close to the wholesale rate, which is genuinely good. The problem is what happens when someone else offers to do the conversion for you.",
          },
          {
            type: "paragraph",
            text: "Because the fee is a percentage, it is invisible in a way flat fees are not. It is folded into each transaction rather than appearing as a separate line, so a statement full of foreign purchases shows no fees at all — just amounts slightly higher than you expected. Most people never work out how much a trip cost them in foreign transaction charges, because the number is never presented as a total.",
          },
          {
            type: "paragraph",
            text: "If you want the real figure, add up your foreign purchases for a trip and take the percentage. It is usually larger than people guess, and it makes the case for carrying the right card far better than any general advice can.",
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
            text: "Choosing dollars is called dynamic currency conversion, and it hands the exchange rate to the merchant or the machine operator rather than the card network. Their rate is routinely 3% to 7% worse. You will still often pay your card's foreign transaction fee on top.",
          },
          {
            type: "callout",
            tone: "tip",
            text: "Always choose the local currency. Every time, without exception. This one habit saves more than picking the right card does.",
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
              "Carry a card with no foreign transaction fee. Many travel cards and a growing number of online banks charge nothing at all, and this eliminates the fee rather than reducing it.",
              "Always pay in the local currency. Refuse the conversion offer at every terminal and every ATM.",
              "Withdraw larger amounts less often. The flat ATM fee is the same regardless of size, so fewer withdrawals means less total cost.",
              "Check your debit card separately from your credit card. They frequently have different foreign transaction terms at the same institution, and people assume they match.",
              "Tell your bank you are travelling, or set travel notice in the app. A declined card abroad costs you more in taxis and time than any fee.",
              "For a long trip, consider opening a no-fee account before you go. The saving on a multi-week trip can exceed the effort by a wide margin.",
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
            text: "There is no federal cap on foreign transaction fees. Card issuers set them, and the 3% figure is a market convention rather than a regulated ceiling.",
          },
          {
            type: "callout",
            tone: "regulatory",
            text: "Truth in Lending disclosure rules require credit card issuers to state the foreign transaction fee in the account terms — the standardised table you received when the card was opened. It is listed there as a percentage of each transaction.",
          },
          {
            type: "paragraph",
            text: "Dynamic currency conversion is governed by card network rules rather than federal regulation. Those rules require that you be offered a genuine choice and shown the rate and any margin before you accept. In practice the presentation is often designed to make dollars look like the safe default, so treat the screen as marketing rather than guidance.",
          },
          {
            type: "paragraph",
            text: "For debit cards, Regulation E error resolution still applies abroad. If a foreign transaction is wrong or unauthorised, you have the same dispute rights you have at home, and the same deadlines for reporting it.",
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
              { condition: "No foreign transaction fee", meaning: "Best available — and widely offered" },
              { condition: "{{card_foreign_txn.p25}} or less", meaning: "Better than 75% of institutions" },
              { condition: "Around {{card_foreign_txn.median}}", meaning: "Right at the national median" },
              { condition: "More than {{card_foreign_txn.p75}}", meaning: "You pay more than 75% of the country" },
            ],
          },
          {
            type: "paragraph",
            text: "If you travel even once a year, this is a fee worth eliminating rather than optimising. The no-fee options are numerous enough that paying a percentage on every purchase abroad is now a choice.",
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
      "What banks charge for cashier's checks, money orders, stop payments and printed checks — and which of them you can avoid entirely.",
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
            text: "Checks are used less every year, but the fees around them have not fallen at the same rate — and they tend to arrive at moments when you have no time to shop around. A cashier's check for a car purchase or a stop payment on a payment gone wrong is not a decision you make at leisure.",
          },
          {
            type: "list",
            items: [
              "A cashier's check is drawn on the bank's own funds, so the recipient knows it will not bounce. Used for large purchases where a personal check would not be accepted.",
              "A money order does a similar job for smaller amounts, and you do not need an account to buy one.",
              "A stop payment tells your bank not to honour a check or payment you already issued.",
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
              "Stop payment: median {{stop_payment.median}} — usually the most expensive item in this guide",
              "Money order: median {{money_order.median}}",
              "Check printing: median {{check_printing.median}}, varying widely by style and quantity",
              "Counter check: median {{counter_check.median}}",
            ],
          },
          {
            type: "callout",
            tone: "warning",
            text: "The stop payment fee is charged whether or not the stop succeeds. If the check has already cleared, you pay the fee and get nothing — so check whether it has cleared before you request one.",
          },
          {
            type: "paragraph",
            text: "Stop payments also expire. A written stop payment generally lasts six months and an oral one expires far sooner unless confirmed in writing, so a stopped check can resurface later and be paid.",
          },
          {
            type: "paragraph",
            text: "Check printing is the fee most people overpay without noticing, because it is presented as part of opening an account rather than as a purchase. Ordering the same checks from an independent printer typically costs a fraction of the bank's price, and the checks are functionally identical — they carry your account and routing numbers and clear exactly the same way.",
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
            text: "Credit unions are consistently cheaper across check services, and often issue cashier's checks free to members. That single difference can be worth more than a year of monthly fee savings if you are buying a car or closing on a house.",
          },
          {
            type: "paragraph",
            text: "Large national banks price these services at a premium, and are also the most likely to waive them for premium account holders — which means the list price and the price you actually pay can differ substantially depending on which account you hold.",
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
              "Order checks from a third-party printer rather than your bank. The same checks typically cost a fraction of the bank's price, and they work identically.",
              "Ask whether your account includes free cashier's checks. Many do, and the benefit is rarely advertised.",
              "Use an electronic transfer instead where the recipient will accept one. A free ACH transfer replaces a cashier's check in many situations, though not usually at a closing table.",
              "Check whether a payment has already cleared before requesting a stop payment. You pay the fee either way.",
              "Put a stop payment in writing and note the expiry date, so a stopped check cannot be paid months later.",
              "For a large one-off need, ask for the fee to be waived. Banks frequently waive a single cashier's check fee for an established customer who asks.",
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
            text: "Under the Uniform Commercial Code as adopted by the states, a stop payment order on a personal check is generally effective for six months in writing. An oral order typically lapses after fourteen days unless you confirm it in writing.",
          },
          {
            type: "paragraph",
            text: "A cashier's check is different, and this is the part worth knowing. Because it is drawn on the bank's own funds, you generally cannot stop payment on one. If it is lost or stolen, the process is a declaration of loss and a waiting period — often ninety days — before the bank will reissue. Treat a cashier's check like cash.",
          },
          {
            type: "paragraph",
            text: "Regulation CC governs how long your bank may hold funds from a check you deposit. That is a hold rather than a fee, but it interacts with this guide directly: a hold you did not expect is a common cause of the NSF and overdraft fees covered elsewhere on this site.",
          },
          {
            type: "paragraph",
            text: "Regulation DD requires all of these fees to be disclosed in your account fee schedule before you open the account.",
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
              { condition: "Free to account holders", meaning: "Common at credit unions" },
              { condition: "{{cashiers_check.p25}} or less", meaning: "Better than 75% of institutions" },
              { condition: "Around {{cashiers_check.median}}", meaning: "Right at the national median" },
              { condition: "More than {{cashiers_check.p75}}", meaning: "You pay more than 75% of the country" },
            ],
          },
          {
            type: "paragraph",
            text: "These fees are easy to ignore because you meet them rarely. That is exactly why they are worth checking now rather than at the counter, when you have no alternative and no time to find one.",
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
    relatedCategories: ["ach_return", "bill_pay", "mobile_deposit", "zelle_fee"],
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
            text: "Most electronic banking is free, and that is worth saying plainly before the rest of this guide. Transfers, mobile deposits and bill payments cost nothing at the great majority of institutions.",
          },
          {
            type: "paragraph",
            text: "The charges that remain cluster in three places: speed, failure, and volume. You pay to make something arrive faster, you pay when an electronic payment fails, and a few institutions still charge per transfer.",
          },
          {
            type: "callout",
            tone: "tip",
            text: "If your bank charges for standard electronic transfers or mobile deposits, that is now unusual enough to be a reason to compare alternatives.",
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
              "Sending an ACH transfer: median {{ach_origination.median}}, and free at most institutions",
              "Returned ACH payment: median {{ach_return.median}} — by far the most expensive item here",
              "Bill pay: median {{bill_pay.median}}, generally included at no charge",
              "Mobile deposit: median {{mobile_deposit.median}}, though some banks charge for expedited availability",
              "Person-to-person payment: median {{zelle_fee.median}}",
            ],
          },
          {
            type: "paragraph",
            text: "The returned ACH fee is the one to watch. It is charged when an automatic payment fails for insufficient funds, and it is priced like an NSF fee rather than like a digital service. The company you were paying may add a returned payment fee of their own on the same failure.",
          },
          {
            type: "paragraph",
            text: "Automatic payments make this worse rather than better. The whole point of automating a payment is that you stop thinking about it, which means a shortfall is discovered by the payment rather than by you. A subscription that retries three times against an empty account can generate three separate charges at a bank with no daily cap.",
          },
          {
            type: "paragraph",
            text: "Mobile deposit carries a quieter cost: the hold. Depositing by phone is free almost everywhere, but the funds may not all be available immediately, and a deposit you counted on can fail to cover a payment that clears the same day. The fee schedule will not tell you this — the funds availability policy will.",
          },
          {
            type: "paragraph",
            text: "Person-to-person payments are free between participating institutions at nearly every bank, and the fee to watch is not the transfer but the instant-cashout option some apps offer at a percentage of the amount.",
          },
        ],
      },
      {
        id: "speed-costs-money",
        heading: "You are usually paying for speed",
        blocks: [
          {
            type: "paragraph",
            text: "Most digital banking charges you will actually meet are expedite fees. Faster mobile deposit availability, same-day bill payment, instant transfer to a debit card — each of these has a free version that simply takes longer.",
          },
          {
            type: "paragraph",
            text: "Before paying one, check when the money genuinely needs to arrive. A payment due Friday does not need instant delivery on Wednesday. Expedite fees are almost always avoidable with two days of planning.",
          },
          {
            type: "callout",
            tone: "warning",
            text: "Instant transfer options inside payment apps commonly charge a percentage of the amount. On larger transfers that is far more than a flat bank fee, and the standard option is free.",
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
              "Use the standard speed. The free option covers almost every real deadline if you start two days earlier.",
              "Set up automatic payments a few days before the due date, not on it. This removes both the expedite fee and the returned payment risk.",
              "Keep a small buffer in checking. The returned ACH fee, median {{ach_return.median}}, is triggered by a shortfall that a modest cushion would absorb.",
              "Use your bank's own bill pay rather than a merchant's expedited option. Bank bill pay is generally free; the merchant's fast option often is not.",
              "Check the transfer limits on mobile deposit. Exceeding a limit can push a deposit into a slower or chargeable path.",
              "If your bank charges for ordinary electronic transfers, compare alternatives. This is now the exception rather than the rule.",
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
            text: "Regulation E gives you error resolution rights on electronic transfers. Report an unauthorised or incorrect electronic transfer promptly and your bank must investigate, generally within ten business days, and correct genuine errors.",
          },
          {
            type: "paragraph",
            text: "Reporting quickly matters more than most people realise. Your liability for unauthorised electronic transfers rises the longer you wait after the statement showing them, so the practical protection is checking statements rather than the rule itself.",
          },
          {
            type: "paragraph",
            text: "There is an important gap. Regulation E protects you when money leaves your account without your authorisation. It offers much less when you were tricked into authorising the payment yourself — the common pattern in person-to-person payment scams. A payment you approved, even under false pretences, is treated differently from one you did not.",
          },
          {
            type: "paragraph",
            text: "Regulation E also requires advance notice before your bank imposes new electronic transfer fees or changes existing ones.",
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
              { condition: "No charge for standard transfers", meaning: "The current market standard" },
              { condition: "Returned ACH at {{ach_return.p25}} or less", meaning: "Better than 75% of institutions" },
              { condition: "Returned ACH around {{ach_return.median}}", meaning: "Right at the national median" },
              { condition: "Returned ACH above {{ach_return.p75}}", meaning: "You pay more than 75% of the country" },
            ],
          },
          {
            type: "paragraph",
            text: "The right question here is not what the fees are, but whether you are being charged for something that is free almost everywhere else. Digital banking is where competition has pushed hardest, so a charge that would have been unremarkable a few years ago now marks an institution out. If you are paying to move your own money electronically, that is worth treating as a signal about the account rather than as a cost to optimise.",
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
            text: "An early closure fee is charged for closing an account shortly after opening it, usually within 90 to 180 days. It exists to discourage people from opening accounts purely to collect a sign-up bonus.",
          },
          {
            type: "paragraph",
            text: "A dormancy fee is charged for the opposite behaviour: leaving an account alone. After a period with no activity, typically 12 to 24 months, the bank classifies the account as dormant and starts charging monthly.",
          },
          {
            type: "callout",
            tone: "warning",
            text: "Dormancy fees are the more damaging of the two, because nobody is watching. A forgotten account with a small balance can be emptied entirely by a fee charged every month against money you are not tracking.",
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
            text: "The median dormant account fee is {{dormant_account.median}}. That figure looks smaller, and it is the more expensive of the two, because it recurs. Charged monthly against a forgotten balance, it compounds until there is nothing left to charge.",
          },
          {
            type: "paragraph",
            text: "A third fee often appears alongside these: account research, median {{account_research.median}}, charged when you ask the bank to look into an old account or produce historical records. If you are reconstructing what happened to a dormant account, this is what the reconstruction costs.",
          },
          {
            type: "paragraph",
            text: "The early closure fee has a narrower reach than people fear. It applies to the window after opening, and closing an account you have held for years costs nothing at nearly every institution. If you have been putting off leaving a bank because you think closing is expensive, check the date you opened it — the fee has almost certainly long since stopped applying.",
          },
          {
            type: "paragraph",
            text: "Dormancy is the opposite: the risk grows the longer you leave it. Old accounts from a previous job, a college town, or a closed joint relationship are the usual candidates, and they are exactly the accounts nobody checks.",
          },
        ],
      },
      {
        id: "what-happens-to-the-money",
        heading: "What happens to forgotten money",
        blocks: [
          {
            type: "paragraph",
            text: "If an account stays inactive long enough, the bank does not keep the balance. State unclaimed property law requires it to be handed to the state, a process called escheatment. The dormancy period before that happens is set by state law and is commonly three to five years.",
          },
          {
            type: "paragraph",
            text: "The money is not lost at that point. Every state runs a free unclaimed property search, and you can reclaim your funds from the state at no cost, though it takes paperwork and time.",
          },
          {
            type: "callout",
            tone: "tip",
            text: "The fees are the real loss, not the escheatment. Dormancy fees are charged before the balance ever reaches the state, so a small account can be reduced to nothing while it is still with the bank.",
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
              "Keep a new account open for at least six months. That clears the early closure window at nearly every institution.",
              "Set up a small recurring transaction on any account you intend to keep but not use. An automatic transfer of a few dollars a month is enough to keep it active.",
              "Log in periodically. At some institutions this counts as activity, though a transaction is more reliable — check which your bank uses.",
              "Close accounts you have stopped using, properly. An account left at zero is still an account that can be charged.",
              "Empty it before you close it, and get written confirmation of the closure. Verbal closure requests go astray, and an account you believe is closed can keep charging fees.",
              "Confirm any pending transactions have cleared first. A payment landing after closure can reopen the account or push it negative.",
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
          },
          {
            type: "paragraph",
            text: "Unclaimed property is state law rather than federal. Each state sets its own dormancy period, its own notice requirements, and its own rules about whether a bank may charge fees against a dormant balance at all — some states restrict this. Because it varies, the rules that apply to you are your state's, not a national standard.",
          },
          {
            type: "paragraph",
            text: "Every state provides a free unclaimed property search. Use the official state programme. Any service offering to find your money for a percentage is charging you for a search you can run yourself in a few minutes.",
          },
          {
            type: "paragraph",
            text: "Banks are generally required to attempt to contact you before declaring an account dormant, which is one more reason to keep your address current on accounts you rarely use.",
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
              { condition: "No early closure fee", meaning: "Common at credit unions" },
              { condition: "{{early_closure.p25}} or less", meaning: "Better than 75% of institutions" },
              { condition: "Around {{early_closure.median}}", meaning: "Right at the national median" },
              { condition: "More than {{early_closure.p75}}", meaning: "You pay more than 75% of the country" },
            ],
          },
          {
            type: "paragraph",
            text: "Then do the more valuable thing: list every account you hold and identify the ones you have not touched in a year. That list, not the fee schedule, is where the money is going.",
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
            text: "The fee is annual and set by box size. Larger boxes cost more, and prices vary considerably by location — an urban branch usually charges more than a rural one for an identical box.",
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
            text: "Two costs sit alongside the rental. Late payment on a box carries its own fee at many institutions, and losing a key typically triggers a drilling charge that can exceed the annual rental several times over. Notary service, median {{notary_fee.median}}, is frequently needed for the same documents people store in a box, and is often free to account holders — worth asking before paying for it elsewhere.",
          },
          {
            type: "paragraph",
            text: "Boxes are usually issued with two keys and no spare held by the bank. That is a security feature rather than an oversight, and it means losing both keys is a genuine problem: the bank must drill the lock, you pay for the drilling and the replacement lock, and it happens on the branch's schedule rather than yours.",
          },
          {
            type: "paragraph",
            text: "Rental is generally billed annually and often set to auto-debit from a linked account. That is convenient until the linked account closes, at which point the rental quietly goes unpaid — which is the most common route to a box being drilled and its contents surrendered to the state.",
          },
        ],
      },
      {
        id: "who-charges-what",
        heading: "Who charges the most, and who charges the least?",
        blocks: [
          {
            type: "paragraph",
            text: "Credit unions generally offer lower box rates than banks. Location matters as much as institution type: the same size box can differ substantially between a downtown branch and a suburban one at the same institution.",
          },
          {
            type: "paragraph",
            text: "Availability is now a bigger constraint than price. Many institutions have stopped offering boxes entirely, and some are closing existing vaults, so the practical question is often which nearby branch still has one rather than which is cheapest.",
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
            text: "For some documents a box is genuinely the right answer. For others it is an annual cost with a real drawback: you can only reach the contents during branch hours.",
          },
          {
            type: "list",
            ordered: true,
            items: [
              "Do not store your only copy of a will in a box. Access after a death can require probate paperwork, which is exactly when the document is needed. Leave the original with your attorney or executor.",
              "Do not store anything you might need urgently or out of hours — a passport before an early flight, or documents needed in an emergency.",
              "Do store deeds, titles, birth certificates and irreplaceable records that you rarely need but could not easily replace.",
              "Ask whether your account waives the fee. Premium and relationship accounts frequently include a box, and this is rarely advertised.",
              "Consider a quality home safe for documents you need occasionally. It is a one-off cost with no access restriction, though it does not protect against everything a vault does.",
              "If you store valuables, arrange insurance explicitly. A rider on a homeowner's or renter's policy is often the cheaper route, and without it the contents are uninsured.",
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
            text: "FDIC and NCUA insurance cover deposits. They do not cover the contents of a safe deposit box. This is the single most misunderstood point about safe deposit boxes, and it is worth confirming in writing with your own institution.",
          },
          {
            type: "paragraph",
            text: "Your rights over a box come from the rental agreement rather than banking regulation, so the contract is the document that matters. Read what it says about the bank's liability, which is usually tightly limited, and about what happens if the branch closes or the vault is relocated.",
          },
          {
            type: "paragraph",
            text: "Unpaid rental leads to the box being drilled and the contents handed to the state as unclaimed property, under the same state laws that govern dormant accounts. Keeping your address current with the institution matters here for the same reason it does there.",
          },
          {
            type: "paragraph",
            text: "Regulation DD requires the fee to be disclosed in your fee schedule, and advance notice before it increases.",
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
              { condition: "Included with your account", meaning: "Common on premium and relationship accounts" },
              { condition: "{{safe_deposit_box.p25}} or less", meaning: "Better than 75% of institutions" },
              { condition: "Around {{safe_deposit_box.median}}", meaning: "Right at the national median" },
              { condition: "More than {{safe_deposit_box.p75}}", meaning: "You pay more than 75% of the country" },
            ],
          },
          {
            type: "paragraph",
            text: "Compare by box size rather than by headline price, and ask two questions the fee schedule will not answer: is the contents insured, and who else can open it if you cannot?",
          },
        ],
      },
    ],
  },
];
