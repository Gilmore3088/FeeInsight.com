// Fee Insight email program: copy + structure. Rendered by build.mjs.
// v2 (James, Oct 17): one sequence per person, picked by what they asked for. Each sequence
// knows who signed up and what they need next:
//   welcome  - free research subscribers only (3 emails)
//   report   - free report requesters: their exact report, a finding from it, then their institution
//   explorer - people following one institution or state: that page, then the monthly snapshot
//   pro      - paying Hamilton customers: setup, not fee lessons
//   pulse    - the monthly broadcast: one finding, one visual, one action
//   library  - earlier material kept for later use (topic email, Pulse feature, guide, kit); never in a sequence
// Automations run for months after they are written, so they carry NO figures: numbers live on
// the live pages, or arrive as subscriber fields the app sets on confirm (see README).
// Only the Pulse quotes numbers, from data.mjs, refreshed from fee_index_cache before each send.
// The institution report is quoted "from $300" (REPORT_OFFER.priceLabel); never a fixed price.
import { FEES, SNAPSHOT } from "./data.mjs";

export const BRAND = {
  siteUrl: "https://feeinsight.com",
  // CAN-SPAM requires a postal address in every commercial email. MailerLite appends its own
  // footer with the account's address to every send, so the template carries none unless
  // MARKETING_MAILING_ADDRESS is set (blank until the state registration; DECISIONS 2026-10-06).
  mailingAddress: (process.env.MARKETING_MAILING_ADDRESS || "").trim() || null,
};

const S = BRAND.siteUrl;
const F = FEES;
const m = (v) => (Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`);
const n = (v) => v.toLocaleString("en-US");
const REPORT_PRICE = "from $300"; // REPORT_OFFER.priceLabel in src/lib/constants.ts
const INSTITUTION_REPORT = `${S}/reports?report=institution&src=email_report#request`;
const SAMPLE_REPORT = `${S}/reports/sample-competitive-fee-position`;

// MailerLite merge fields the app sets on confirm (src/lib/email/mailerlite.ts). Each has a
// fallback, so an email still reads right for a subscriber who arrived without one.
const FIELD = {
  reportName: "{$report_name|default('your fee report')}",
  reportUrl: "{$report_url|default('https://feeinsight.com/reports')}",
  reportFinding: "{$report_finding|default('Start with the key findings at the top of your report. Each one names the fee, the market and how many institutions stand behind it.')}",
  // Set only when the app read a finding; without one, email 2 is a guide to reading the report.
  findingTitle: "{$report_finding_title|default('How to read your fee report')}",
  findingCta: "{$report_finding_cta|default('Open your report')}",
  followName: "{$follow_name|default('a state or an institution')}",
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
        { type: "p", text: "Thanks for subscribing. Start with your state: each headline fee next to the national median, banks and credit unions side by side. The benchmarks come from institutions' published schedules." },
        { type: "cta", text: "Find your state's fee benchmarks", href: `${S}/research`, sub: "Free, no login." },
        { type: "p", text: `Also free: [a Fed district](${S}/reports), [one institution's fees](${S}/institutions) with the schedule they came from, or [one fee across the country](${S}/fees). Breakdowns by asset size come with a Hamilton plan.` },
        { type: "sign" },
      ],
    },
    {
      key: "one-comparison",
      day: 3,
      subject: "One comparison to make before your next pricing meeting",
      preheader: "Your fee, your state's middle 50%, and the institutions behind it.",
      blocks: [
        { type: "kicker", text: "Welcome · 2 of 3" },
        { type: "h1", text: "One comparison to make before your next pricing meeting" },
        { type: "p", text: "Pick one fee your customers notice, such as overdraft or NSF, and place it against your own state rather than the country." },
        { type: "box", tone: "action", title: "Make the comparison", ordered: true, items: [
          `Open [your state's page](${S}/research) and find the fee.`,
          "Note the median and the middle 50%, the range between the 25th and 75th percentiles.",
          "Check how many institutions stand behind the number. If only a few, check their schedules directly.",
          "Write your own price next to it: below, inside or above the middle 50%.",
        ] },
        { type: "p", text: "This gives your committee a starting point. Hamilton then names the institutions that sit next to you, fee by fee." },
        { type: "cta", text: "Find your state's numbers", href: `${S}/research` },
        { type: "sign" },
      ],
    },
    {
      key: "what-hamilton-adds",
      day: 7,
      subject: "Your fees against the institutions you name",
      preheader: "What Hamilton adds to the free reports.",
      blocks: [
        { type: "kicker", text: "Welcome · 3 of 3" },
        { type: "h1", text: "Your fees against the institutions you name" },
        { type: "p", text: "The free reports show the market. Hamilton, the Fee Insight workspace, shows where your institution sits in it, against the peers you choose." },
        { type: "list", items: [
          "**Your schedule, fee by fee,** next to your peers' median and middle 50%.",
          "**Peers you pick** by charter, asset size, district or county, instead of an anonymous average.",
          "**The source behind every figure:** the competitor's published schedule and the date we read it.",
          "**Committee reports** built from your peer set.",
        ] },
        { type: "cta", text: "See Hamilton plans", href: `${S}/subscribe`, sub: `Prefer a walkthrough first? [Ask for a demo](${S}/contact?source=demo).` },
        { type: "p", text: "From here you'll get the monthly Fee Pulse: one finding and one thing to check. Reply any time." },
        { type: "sign" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 2. Report requests: free benchmark reports and the sample report
// ---------------------------------------------------------------------------
// Email 1 delivers the exact report they asked for ({$report_url}); email 2 carries a finding
// from that report ({$report_finding}, read on confirm), or, when no finding was read, becomes
// "How to read your fee report" ({$report_finding_title} and {$report_finding_cta} unset). No email assumes a geography: a
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
      subject: "Your report is ready: {$report_name|default('the fee benchmarks you asked for')}",
      preheader: "The live link, and where to start reading.",
      blocks: [
        { type: "kicker", text: "Your report · 1 of 3" },
        { type: "h1", text: `Here is ${FIELD.reportName}` },
        { type: "p", text: "Thanks for confirming. The report is live, so the link always shows the current numbers as new fee schedules are read." },
        { type: "cta", text: "Open your report", href: FIELD.reportUrl, sub: "Free, no login. Bookmark it." },
        // One line that holds for the benchmark reports and the sample Competitive Fee Position
        // Report alike (report_name covers both); section names differ between them.
        { type: "p", text: "Start at the top. The findings come first, and every table names the institutions and the published schedules behind it." },
        { type: "sign" },
      ],
    },
    {
      key: "a-finding",
      day: 4,
      subject: FIELD.findingTitle,
      preheader: "What the top of your report tells you, and what it leaves out.",
      blocks: [
        { type: "kicker", text: "Your report · 2 of 3" },
        { type: "h1", text: FIELD.findingTitle },
        { type: "p", text: FIELD.reportFinding },
        { type: "p", text: "A market finding shows where the typical institution sits. Seeing where yours sits, and which competitors set the top and bottom of the range, takes a fee-by-fee comparison against named competitors." },
        { type: "cta", text: FIELD.findingCta, href: FIELD.reportUrl, sub: "Each finding links to the table behind it." },
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
          "Each of your fees marked below, inside or above the middle 50% of your competitors' fees.",
          "The competitors you name, side by side with you.",
          "A source for every figure: the competitor's published schedule and the date we read it.",
        ] },
        { type: "cta", text: "Request your institution report", href: INSTITUTION_REPORT, sub: `Quoted ${REPORT_PRICE}. We check your market has enough published schedules, then reply within one business day with scope and price. [See a sample report](${SAMPLE_REPORT}).` },
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
      subject: "The page you're following on Fee Insight",
      preheader: "Your page, and the monthly snapshot you'll get.",
      blocks: [
        { type: "kicker", text: "Following" },
        { type: "h1", text: "The page you're following" },
        { type: "p", text: `You asked to follow ${FIELD.followName}. The figures on that page come from published schedules and update as new schedules are read.` },
        { type: "cta", text: "Open the page", href: FIELD.followUrl, sub: "Free, no login." },
        { type: "box", tone: "term", title: "What you'll get", items: [
          "**Once a month:** your state's fee snapshot (the national one if you follow an institution), with how many institutions stand behind each number.",
        ] },
        { type: "p", text: "Reply any time with a question about a number." },
        { type: "sign" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 4. Pro onboarding: paying Hamilton customers
// ---------------------------------------------------------------------------
// Setup steps in the order a new customer needs them. No fee lessons and no upgrade prompts.
const pro = {
  key: "pro",
  name: "Pro onboarding: set up Hamilton",
  masthead: "Hamilton",
  footerReason: "You're getting this because your team subscribes to Hamilton.",
  footer: "short", // setup emails are short; the footer is the reason and the unsubscribe link only
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
        { type: "p", text: "Thanks for subscribing. Hamilton measures every comparison against your institution, so check that it's the right one, with the right charter and location, before you build on it." },
        { type: "cta", text: "Confirm your institution", href: `${S}/pro/settings`, sub: "In Settings, open Research institution." },
        { type: "p", text: "If your institution isn't listed, or its fee schedule looks out of date, reply to this email and we'll check it." },
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
        { type: "p", text: "Build a peer group from the institutions your customers compare you with, by charter, asset size, district or county. Use the national median for broader context." },
        { type: "cta", text: "Build your peer group", href: `${S}/pro/settings#peer-sets`, sub: "In Settings, open Peer groups." },
        { type: "p", text: `Not sure which peers? [Building a Peer Set](${S}/guides/pro/building-a-peer-set) shows how to pick a set that holds up in a board meeting.` },
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
          "Open Hamilton and pick a fee where you and your peers differ.",
          "Find the competitor whose fee is furthest from yours, open its public profile on feeinsight.com, and follow the fee schedule link.",
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
        { type: "p", text: "With your institution and peers set, Hamilton builds a report of your fee position for your pricing or ALCO committee: each fee next to your peers' median and middle 50%, with the sources listed." },
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
        { type: "p", text: "Pricing decisions involve product, marketing, finance and compliance. Add the people who need to see the same numbers, so everyone works from one peer set and one set of sources. Your plan covers up to five people, each with their own login." }, // WORKSPACE_SEAT_LIMIT (src/lib/hamilton/workspace-seats.ts)
        { type: "cta", text: "Invite colleagues", href: `${S}/pro/settings#workspace-access`, sub: "In Settings, open Team access." },
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
  masthead: "Bank Fee Index",
  trigger: "Regular monthly campaign to the national and state marketing groups. Refresh data.mjs from fee_index_cache and rebuild before each send.",
  emails: [
    {
      key: "fee-pulse",
      day: 0,
      subject: `Fee Pulse: the middle half of returned-deposit fees runs ${m(dir.p25)} to ${m(dir.p75)}`,
      preheader: `The middle half spans ${m(dirWidth)}, compared with ${m(odWidth)} for overdraft.`,
      blocks: [
        { type: "kicker", text: `Fee Pulse · ${SNAPSHOT.month}` },
        { type: "h1", text: `Returned-deposit fees: the middle half spans ${m(dirWidth)}` },
        { type: "p", text: `When a customer deposits a check that bounces, the middle half of the banks and credit unions in the index list a fee between ${m(dir.p25)} and ${m(dir.p75)}. That spans ${m(dirWidth)}, compared with ${m(odWidth)} for overdraft (${m(od.p25)} to ${m(od.p75)}). The figures come from ${n(dir.n)} institutions that publish a returned-deposit fee.` },
        { type: "range", items: RANGE_FEES.map((k) => ({ label: F[k].label, p25: F[k].all.p25, med: F[k].all.med, p75: F[k].all.p75, accent: k === "deposited_item_return" })), max: 35, note: `Middle half (25th to 75th percentile) with the median marked. Bank Fee Index, national, ${SNAPSHOT.asOf}. One value per institution, from its own published fee schedule. Institutions behind each fee: ${RANGE_FEES.map((k) => `${F[k].label} ${n(F[k].all.n)}`).join(", ")}.` },
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
        { type: "p", text: "Planned deliverables: a one-page agenda, a worksheet with one row per headline fee (your price, peer 25th, median, 75th, position, decision), and a one-page summary template for the board pack." },
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
