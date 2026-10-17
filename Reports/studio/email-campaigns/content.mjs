// Fee Insight email program: copy + structure. Rendered by build.mjs.
// v2 (James, Oct 17): one sequence per person, picked by what they asked for. Each sequence
// knows who signed up and what they need next:
//   welcome  - free research subscribers only (3 emails)
//   report   - free report requesters: their exact report, a finding from it, then their institution
//   explorer - people following one institution or state: that page, then the monthly snapshot
//   pro      - paying Hamilton Pro customers: setup, not fee lessons
//   pulse    - the monthly broadcast: one finding, one visual, one action
//   library  - earlier material kept for later use (topic email, Pulse feature, guide, kit); never in a sequence
// Automations run for months after they are written, so they carry NO figures: numbers live on
// the live pages, or arrive as subscriber fields the app sets on confirm (see README).
// Only the Pulse quotes numbers, from data.mjs, refreshed from fee_index_cache before each send.
// The institution report is quoted "from $300" (REPORT_OFFER.priceLabel); never a fixed price.
import { FEES, SNAPSHOT } from "./data.mjs";

export const BRAND = {
  siteUrl: "https://feeinsight.com",
  // CAN-SPAM requires a valid postal address in every commercial email. Left out until the
  // business registration gives one (James, Oct 6); set MARKETING_MAILING_ADDRESS and rebuild.
  mailingAddress: (process.env.MARKETING_MAILING_ADDRESS || "").trim() || null,
};

const S = BRAND.siteUrl;
const F = FEES;
const m = (v) => (Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`);
const n = (v) => v.toLocaleString("en-US");
const REPORT_PRICE = "from $300"; // REPORT_OFFER.priceLabel in src/lib/constants.ts
const INSTITUTION_REPORT = `${S}/for-institutions?report=institution#report`;
const SAMPLE_REPORT = `${S}/reports/sample-competitive-fee-position`;

// MailerLite merge fields the app sets on confirm (src/lib/email/mailerlite.ts). Each has a
// fallback, so an email still reads right for a subscriber who arrived without one.
const FIELD = {
  reportName: "{$report_name|default('your fee report')}",
  reportUrl: "{$report_url|default('https://feeinsight.com/reports')}",
  reportFinding: "{$report_finding|default('Start with the key findings at the top of your report. Each one names the fee, the market and how many institutions stand behind it.')}",
  followName: "{$follow_name|default('the market you follow')}",
  followUrl: "{$follow_url|default('https://feeinsight.com/research')}",
};

// ---------------------------------------------------------------------------
// 1. Welcome: free research subscribers (newsletter, national index signup)
// ---------------------------------------------------------------------------
const welcome = {
  key: "welcome",
  name: "Welcome: free research subscribers",
  masthead: "Bank Fee Index",
  trigger:
    "Joins group 'Fee Insight · Newsletter' (sources: newsletter, capture_national_index). Account sign-ups, contact forms and report requests never join it. Skips anyone in Report requests, Watchers or Pro customers.",
  emails: [
    {
      key: "find-the-data",
      day: 0,
      subject: "Where to find the fee data for your market",
      preheader: "Free benchmarks for your state, district, an institution or a fee.",
      blocks: [
        { type: "kicker", text: "Welcome · 1 of 3" },
        { type: "h1", text: "Where to find the fee data for your market" },
        { type: "p", text: "Thanks for subscribing. Every figure on the site comes from a bank's or credit union's own published fee schedule, and the views below need no login. Start with the one closest to the institutions you compete with." },
        { type: "list", items: [
          `**Your state:** each headline fee in your state next to the national median, banks and credit unions side by side. [Find your state](${S}/research).`,
          `**Your Fed district:** the same view across a district. [Open the district reports](${S}/reports).`,
          `**One institution:** its fee table, the schedule it came from, and the date we read it. [Search institutions](${S}/institutions).`,
          `**One fee across the country:** the national median and middle half, with banks and credit unions compared. [Browse fees](${S}/fees).`,
        ] },
        { type: "p", text: "What's free: every fee's own page, with its national median and middle half, and the fee index table for six headline fees, including overdraft, NSF and out-of-network ATM. The rest of the index table and breakdowns by asset size come with a Hamilton Pro plan." },
        { type: "cta", text: "Explore the free fee benchmarks", href: `${S}/research`, sub: "No login needed." },
        { type: "sign" },
      ],
    },
    {
      key: "one-comparison",
      day: 3,
      subject: "One comparison to make before your next pricing meeting",
      preheader: "Your fee, your state's middle half, and the institutions behind it.",
      blocks: [
        { type: "kicker", text: "Welcome · 2 of 3" },
        { type: "h1", text: "One comparison to make before your next pricing meeting" },
        { type: "p", text: "Pick one fee your customers notice, such as overdraft or NSF, and place it against your own state rather than the country." },
        { type: "box", tone: "action", title: "Make the comparison", ordered: true, items: [
          `Open your state's page and find the fee. [Find your state](${S}/research).`,
          "Note the median and the middle half (the 25th to 75th percentile: the middle 50% of institution benchmark values).",
          "Check how many institutions stand behind the number. A small count is a hint, not a verdict.",
          "Write your own price next to it: below, inside or above the middle half.",
        ] },
        { type: "p", text: "This gives your committee a starting point. The state view doesn't show which institutions sit next to you; Hamilton Pro does." },
        { type: "sign" },
      ],
    },
    {
      key: "what-hamilton-adds",
      day: 7,
      subject: "Your fees against the institutions you name",
      preheader: "What Hamilton Pro adds to the free reports.",
      blocks: [
        { type: "kicker", text: "Welcome · 3 of 3" },
        { type: "h1", text: "Your fees against the institutions you name" },
        { type: "p", text: "The free reports show the market. Hamilton, the Fee Insight Pro workspace, shows where your institution sits in it, against the peers you choose." },
        { type: "list", items: [
          "**Your schedule, fee by fee,** below, inside or above your peers' range.",
          "**Peers you pick** by charter, asset size, district or county, instead of an anonymous average.",
          "**The source behind every figure:** the competitor's published schedule and the date we read it.",
          "**Reports for your committee** built from your peer set.",
        ] },
        { type: "cta", text: "See Hamilton plans", href: `${S}/subscribe`, sub: `Prefer a walkthrough first? [Ask for a demo](${S}/contact?source=demo).` },
        { type: "p", text: "From here you'll get the monthly Fee Pulse: one finding from the index and one thing to check. Reply any time with a question." },
        { type: "sign" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 2. Report requests: free benchmark reports and the sample report
// ---------------------------------------------------------------------------
// Email 1 delivers the exact report they asked for ({$report_url}); email 2 carries a finding
// from that report ({$report_finding}, read on confirm). No email assumes a geography: a
// district request never gets a state follow-up. Paid institution-report requests are quoted
// by hand and stay out of this sequence.
const report = {
  key: "report",
  name: "Report requests: your report, a finding, your institution",
  masthead: "Bank Fee Index · Reports",
  trigger:
    "Joins group 'Fee Insight · Report requests' after confirming (sources: report_national, report_district, capture_report_sample, capture_homepage). Not 'report' (paid quote requests). Skips anyone in Pro customers.",
  emails: [
    {
      key: "your-report",
      day: 0,
      subject: "Your report: {$report_name|default('your fee report')}",
      preheader: "The live link, and the three sections to read first.",
      blocks: [
        { type: "kicker", text: "Your report · 1 of 3" },
        { type: "h1", text: `Here is ${FIELD.reportName}` },
        { type: "p", text: "Thanks for confirming. The report is live, so the link always shows the current numbers as new fee schedules are verified." },
        { type: "cta", text: "Open your report", href: FIELD.reportUrl, sub: "Free, no login. Bookmark it; the numbers update in place." },
        { type: "list", ordered: true, items: [
          "**Key findings** sit at the top, each with how many institutions stand behind it.",
          "**Headline fees** show the median and middle half where enough institutions publish the fee. The report states its minimum.",
          "**Banks and credit unions** are compared where each side has enough institutions.",
        ] },
        { type: "sign" },
      ],
    },
    {
      key: "a-finding",
      day: 4,
      subject: "One finding from your report",
      preheader: "The number at the top of your report, and the question it raises.",
      blocks: [
        { type: "kicker", text: "Your report · 2 of 3" },
        { type: "h1", text: "One finding from your report" },
        { type: "p", text: FIELD.reportFinding },
        { type: "p", text: "A market finding tells you where the typical institution sits. It can't tell you where yours sits, or which competitors pull the range up or down." },
        { type: "cta", text: "See it in your report", href: FIELD.reportUrl, sub: "The finding links to the table behind it." },
        { type: "sign" },
      ],
    },
    {
      key: "your-institution",
      day: 9,
      subject: "Your institution against the competitors you name",
      preheader: `The Competitive Fee Position Report, ${REPORT_PRICE}.`,
      blocks: [
        { type: "kicker", text: "Your report · 3 of 3" },
        { type: "h1", text: "Your institution against the competitors you name" },
        { type: "p", text: "The Competitive Fee Position Report puts one institution's fee schedule next to the local competitors you list, fee by fee." },
        { type: "box", tone: "rule", title: "What's in it", items: [
          "Each of your fees marked below, inside or above your competitors' range.",
          "The competitors you name, side by side with you.",
          "A source for every figure: the competitor's published schedule and the date we read it.",
        ] },
        { type: "cta", text: "Request your institution report", href: INSTITUTION_REPORT, sub: `Quoted ${REPORT_PRICE}. We check your market has enough published schedules, then reply with scope and price. [See a sample report](${SAMPLE_REPORT}).` },
        { type: "p", text: "Or reply with your institution's name and the competitors you watch." },
        { type: "sign" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 3. Explorers: people following one institution or one state
// ---------------------------------------------------------------------------
// The updates are the monthly snapshot of what they follow: the state edition (state-edition.ts)
// for a state, the national edition otherwise. No email here promises fee-change alerts (not
// verified in production) or claims that a fee changed.
const explorer = {
  key: "explorer",
  name: "Explorers: what you follow, then the monthly snapshot",
  masthead: "Bank Fee Index · Following",
  trigger:
    "Joins group 'Fee Insight · Watchers' (sources: capture_state, capture_institution). One email; the monthly state or national snapshot follows. Skips anyone in Report requests or Pro customers.",
  emails: [
    {
      key: "what-you-follow",
      day: 0,
      subject: "You're following {$follow_name|default('the market you follow')}",
      preheader: "Your page, and the monthly snapshot you'll get.",
      blocks: [
        { type: "kicker", text: "Following" },
        { type: "h1", text: `You're following ${FIELD.followName}` },
        { type: "p", text: "Here is the page you asked to follow. It reads every figure from the published fee schedules behind it and updates in place." },
        { type: "cta", text: `Open ${FIELD.followName}`, href: FIELD.followUrl, sub: "Free, no login." },
        { type: "box", tone: "term", title: "What you'll get", items: [
          "**Once a month:** a snapshot of the fees you follow, with how many institutions stand behind each number.",
        ] },
        { type: "p", text: "Reply any time with a question about a number." },
        { type: "sign" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 4. Pro onboarding: paying Hamilton Pro customers
// ---------------------------------------------------------------------------
// Setup steps in the order a new customer needs them. No fee lessons and no upgrade prompts.
const pro = {
  key: "pro",
  name: "Pro onboarding: set up Hamilton",
  masthead: "Hamilton · Fee Insight Pro",
  footerReason: "You're getting this because your team subscribes to Fee Insight Pro.",
  trigger:
    "Joins group 'Fee Insight · Pro customers' when a Pro subscription turns active (Stripe webhook). Starts the day after the account's welcome email. Joining removes them from Newsletter, Report requests and Watchers, which ends those sequences.",
  emails: [
    {
      key: "confirm-institution",
      day: 1,
      subject: "Welcome to Hamilton: confirm your institution",
      preheader: "Every view in Hamilton starts from it.",
      blocks: [
        { type: "kicker", text: "Setup · 1 of 5" },
        { type: "h1", text: "Welcome to Hamilton. Start by confirming your institution." },
        { type: "p", text: "Thanks for subscribing. Hamilton measures everything against one institution: yours. Check that it's the right one, with the right charter and location, before you build anything on it." },
        { type: "cta", text: "Confirm your institution", href: `${S}/pro/settings`, sub: "Settings, Workspace institution." },
        { type: "p", text: "If your institution isn't listed, or its fee schedule looks out of date, reply to this email and we'll fix it." },
        { type: "sign" },
      ],
    },
    {
      key: "choose-peers",
      day: 2,
      subject: "Choose the peers you're measured against",
      preheader: "The peer set decides every comparison you'll show your committee.",
      blocks: [
        { type: "kicker", text: "Setup · 2 of 5" },
        { type: "h1", text: "Choose the peers you're measured against" },
        { type: "p", text: "Start with relevant peers; use the national median for broader context. Build a peer set from the institutions your customers compare you with, by charter, asset size, district or county." },
        { type: "cta", text: "Build your peer set", href: `${S}/pro/settings#peer-sets`, sub: `How to pick one that holds up in a board meeting: [Building a Peer Set](${S}/guides/pro/building-a-peer-set).` },
        { type: "sign" },
      ],
    },
    {
      key: "inspect-evidence",
      day: 4,
      subject: "Check the source behind any figure",
      preheader: "Trace a competitor's fee to the schedule it came from.",
      blocks: [
        { type: "kicker", text: "Setup · 3 of 5" },
        { type: "h1", text: "Check the source behind any figure" },
        { type: "p", text: "Before a number goes in front of your committee, you should be able to show where it came from. Each institution's public profile names the published fee schedule we read and the date we read it." },
        { type: "box", tone: "action", title: "Try it once", ordered: true, items: [
          "Open Hamilton and pick a fee where you sit above your peers.",
          `Find the competitor with the highest price and open its profile from [Institutions](${S}/institutions). Follow the fee schedule link.`,
          "If the schedule disagrees with what we show, reply with the institution and fee. We re-check it.",
        ] },
        { type: "cta", text: "Open Hamilton", href: `${S}/pro/hamilton` },
        { type: "sign" },
      ],
    },
    {
      key: "produce-report",
      day: 7,
      subject: "Produce your first report",
      preheader: "Your position against your peers, ready for the committee.",
      blocks: [
        { type: "kicker", text: "Setup · 4 of 5" },
        { type: "h1", text: "Produce your first report" },
        { type: "p", text: "With your institution and peers set, Hamilton builds a report of your fee position: each fee below, inside or above your peers' range, with the sources listed, for your pricing or ALCO committee." },
        { type: "cta", text: "Open Reports", href: `${S}/pro/reports` },
        { type: "p", text: "Use the analysis to inform your review. Your institution makes the pricing decision." },
        { type: "sign" },
      ],
    },
    {
      key: "invite-colleagues",
      day: 11,
      subject: "Invite the colleagues who work on pricing",
      preheader: "Your plan includes seats for your team.",
      blocks: [
        { type: "kicker", text: "Setup · 5 of 5" },
        { type: "h1", text: "Invite the colleagues who work on pricing" },
        { type: "p", text: "Pricing decisions involve product, marketing, finance and compliance. Add the people who need to see the same numbers, so everyone works from one peer set and one set of sources." },
        { type: "cta", text: "Invite colleagues", href: `${S}/pro/settings`, sub: "Settings, Workspace access. Each invite is a link you send them." },
        { type: "p", text: "You can return to these steps whenever you need them. Reply any time; a person reads every one." },
        { type: "sign" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 5. Monthly Fee Pulse (broadcast). Refresh data.mjs from fee_index_cache before each send.
// ---------------------------------------------------------------------------
// October 2026: one finding (the returned-deposit fee's wide normal range), one visual (the
// middle half of four everyday fees on one axis), one action (place your own fee on it).
const RANGE_FEES = ["overdraft", "nsf", "stop_payment", "deposited_item_return"];
const dir = F.deposited_item_return.all;
const od = F.overdraft.all;
const dirWidth = dir.p75 - dir.p25;
const odWidth = od.p75 - od.p25;
const pulse = {
  key: "pulse",
  name: "Monthly Fee Pulse (broadcast)",
  masthead: `Fee Pulse · ${SNAPSHOT.month}`,
  trigger: "Regular monthly campaign to the national and state marketing groups. Refresh data.mjs from fee_index_cache and rebuild before each send.",
  emails: [
    {
      key: "fee-pulse",
      day: 0,
      subject: `Fee Pulse: returned-deposit fees run from ${m(dir.p25)} to ${m(dir.p75)}`,
      preheader: `The middle half spans ${m(dirWidth)}, compared with ${m(odWidth)} for overdraft.`,
      blocks: [
        { type: "kicker", text: `Fee Pulse · ${SNAPSHOT.month}` },
        { type: "h1", text: `Returned-deposit fees: the middle half spans ${m(dirWidth)}` },
        { type: "p", text: `When a customer deposits a check that bounces, the middle half of U.S. banks and credit unions list a fee between ${m(dir.p25)} and ${m(dir.p75)}. That spans ${m(dirWidth)}, compared with ${m(odWidth)} for overdraft (${m(od.p25)} to ${m(od.p75)}). ${n(dir.n)} institutions publish a returned-deposit fee.` },
        { type: "range", items: RANGE_FEES.map((k) => ({ label: F[k].label, p25: F[k].all.p25, med: F[k].all.med, p75: F[k].all.p75, accent: k === "deposited_item_return" })), max: 35, note: `Middle half (25th to 75th percentile) with the median marked. Bank Fee Index, national, ${SNAPSHOT.asOf}. One value per institution, from its own published fee schedule. Institutions behind each fee: ${RANGE_FEES.map((k) => `${F[k].label.toLowerCase()} ${n(F[k].all.n)}`).join(", ")}.` },
        { type: "cta", text: "Place your fee on the range", href: `${S}/fees/deposited_item_return`, sub: "National median, middle half, and banks against credit unions. Free, no login." },
        { type: "sign" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 6. Library: earlier material moved out of the sequences (James, Oct 17). Not uploaded to any
// automation. Each entry says where it goes next.
// ---------------------------------------------------------------------------
const library = {
  key: "library",
  name: "Library (not in any sequence)",
  masthead: "Bank Fee Index",
  trigger: "Not sent automatically. Topic email on request; the rest are sources for a Pulse feature, a guide page and a downloadable kit.",
  emails: [
    {
      key: "topic-overdraft-nsf",
      day: 0,
      subject: "Overdraft and NSF: the rules, and where pricing sits",
      preheader: "Four rules that shape these fees, and the questions to ask about your own.",
      blocks: [
        { type: "kicker", text: "Topic · Overdraft and NSF" },
        { type: "h1", text: "Overdraft and NSF: the rules, and where pricing sits" },
        { type: "p", text: "In 2021 and 2022 several of the largest U.S. banks cut or dropped overdraft and NSF fees. The rest of the market didn't follow in a straight line, and banks and credit unions moved differently." },
        { type: "cta", text: "See today's overdraft numbers", href: `${S}/fees/overdraft`, sub: `Median, middle half and bank vs credit union. NSF is [here](${S}/fees/nsf).` },
        { type: "box", tone: "rule", title: "The rules that shape these fees", items: [
          "**Reg E opt-in (2010):** an overdraft fee on ATM and one-time debit card transactions requires the consumer's affirmative opt-in.",
          "**CFPB Circular 2022-06:** overdraft fees on transactions authorized against a positive balance (\"authorize positive, settle negative\") can be an unfair practice.",
          "**FDIC FIL-40-2022:** charging an NSF fee each time the same item is re-presented carries consumer-compliance risk.",
          "**Truth in Savings (Reg DD):** fee schedules must be disclosed. That's why this data is public.",
        ] },
        { type: "box", tone: "action", title: "Questions to ask about your own schedule", items: [
          "Do we charge NSF on re-presented items? How many times?",
          "Is our overdraft fee above the market's middle half?",
          "Do we cap daily overdraft fees, and is the cap on the published schedule?",
          "Is there a threshold below which no overdraft fee applies?",
        ] },
        { type: "sign" },
      ],
    },
    {
      key: "pulse-feature-quiet-fees",
      day: 0,
      subject: "Pulse feature: the fees nobody benchmarks",
      preheader: "Source for a future Fee Pulse feature. October's Pulse already uses the returned-deposit fee.",
      blocks: [
        { type: "kicker", text: "Pulse feature · draft" },
        { type: "h1", text: "The fees nobody benchmarks (customers notice them anyway)" },
        { type: "p", text: "Everyone benchmarks overdraft. Few institutions benchmark the fees a customer pays once a year, and those come up in a branch argument or a one-star review." },
        { type: "list", ordered: true, items: [
          `**Debit card replacement.** Check whether a standard reissue is priced like a rush order. [See the market](${S}/fees/card_replacement).`,
          `**Deposited item returned.** The customer who deposited a bad check didn't write it. [See the market](${S}/fees/deposited_item_return).`,
          `**Stop payment.** A lower online price is an easy way to stand out. [See the market](${S}/fees/stop_payment).`,
          `**Cashier's check.** Often priced once years ago and never revisited. [See the market](${S}/fees/cashiers_check).`,
        ] },
        { type: "sign" },
      ],
    },
    {
      key: "guide-benchmark-method",
      day: 0,
      subject: "Guide draft: how to benchmark a fee schedule",
      preheader: "Source for a practical guide page. The time claim is dropped until someone times it.",
      blocks: [
        { type: "kicker", text: "Guide · draft" },
        { type: "h1", text: "How to benchmark a fee schedule" },
        { type: "p", text: "The method behind our reports, in four steps you can run yourself." },
        { type: "box", tone: "rule", title: "The method", ordered: true, items: [
          "**Pick a real peer group.** Same charter type and the institutions your customers actually compare you with.",
          "**Compare like with like.** Same fee, same channel, same conditions.",
          "**Place yourself by percentile.** Below the 25th percentile is low; above the 75th is high.",
          "**Flag outliers with one rule.** More than 2× the peer median, or more than 1.5× the interquartile range above the 75th percentile. Outliers get a written reason or a review.",
        ] },
        { type: "box", tone: "warn", title: "Common mistakes", items: [
          "Benchmarking against national banks when customers compare you with the credit union down the street.",
          "Comparing your branch price with a competitor's online price.",
          "Using an old schedule instead of the one published today.",
          "Recording \"waived with direct deposit\" as $0. Record the condition.",
        ] },
        { type: "p", text: `[Read the full methodology](${S}/methodology).` },
        { type: "sign" },
      ],
    },
    {
      key: "kit-fee-review",
      day: 0,
      subject: "Kit draft: fee review for the pricing committee",
      preheader: "Source for a downloadable kit: agenda plus a worksheet. Not offered until the files exist.",
      blocks: [
        { type: "kicker", text: "Downloadable kit · draft" },
        { type: "h1", text: "Fee review kit for the pricing committee" },
        { type: "p", text: "Planned deliverables: a one-page agenda (below), a worksheet with one row per headline fee (your price, peer 25th, median, 75th, position, decision), and a one-page summary template for the board pack." },
        { type: "box", tone: "action", title: "Fee review agenda (60 minutes)", ordered: true, items: [
          "**Position (15 min):** headline fees against the peer 25th percentile, median and 75th percentile. List every fee above the 75th.",
          "**Revenue (10 min):** service charges on deposit accounts from the Call Report (Schedule RI) or NCUA 5300. Which 3 fees drive most of it?",
          "**Risk (10 min):** re-presentment NSF, authorize-positive/settle-negative, overdraft caps, Reg E opt-in records.",
          "**Customer (10 min):** complaints and reviews that name a fee in the last 12 months.",
          "**Decide (15 min):** for each fee above the 75th percentile, keep (with a written reason), change, or study further.",
        ] },
        { type: "sign" },
      ],
    },
  ],
};

export const PROGRAM = [welcome, report, explorer, pro, pulse, library];
