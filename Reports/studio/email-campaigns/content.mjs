// Fee Insight email program: copy + structure. Rendered by build.mjs.
// Automations (welcome, report, explorer) run for months after they are written, so they
// carry NO figures: every number lives on the live pages, which read published_fee_catalog.
// Only the monthly Pulse campaign quotes numbers, from data.mjs, refreshed before each send.
// The institution report has no fixed price yet (James, Oct 5): never state one.
// Each email hands over something usable on its own, with the ask (if any) last and small.
import { FEES, SNAPSHOT, CHEAT_SHEET_ORDER } from "./data.mjs";

export const BRAND = {
  siteUrl: "https://feeinsight.com",
  // CAN-SPAM requires a valid postal address in every commercial email. Left out until the
  // business registration gives one (James, Oct 6); set MARKETING_MAILING_ADDRESS and rebuild.
  mailingAddress: (process.env.MARKETING_MAILING_ADDRESS || "").trim() || null,
};

const S = BRAND.siteUrl;
const F = FEES;
const m = (v) => (Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`);
const benchNote = `Bank Fee Index, national, ${SNAPSHOT.asOf}. One value per institution, from its own published fee schedule. "Low 25%" and "High 25%" are the 25th and 75th percentiles; n = institutions that publish the fee.`;
const benchRows = (keys) => keys.map((k) => [k, F[k]]);
const NATIONAL_REPORT = `${S}/reports/benchmark/national`;
const INSTITUTION_REPORT = `${S}/for-institutions?report=institution#report`;

// ---------------------------------------------------------------------------
// 1. Welcome: Fee Literacy (newsletter / homepage / general signups)
// ---------------------------------------------------------------------------
const welcome = {
  key: "welcome",
  name: "Welcome: Fee Literacy series",
  masthead: "Fee Literacy · Bank Fee Index",
  trigger:
    "Joins group 'Fee Insight · Newsletter' (sources: newsletter, capture_homepage, capture_national_index, website). Exclude anyone in 'Fee Insight · Report requests'.",
  emails: [
    {
      key: "cheat-sheet",
      day: 0,
      subject: "The 15 fees worth benchmarking, and where to see them live",
      preheader: "What U.S. banks and credit unions actually publish, from overdraft to wires.",
      blocks: [
        { type: "kicker", text: "Welcome · Email 1 of 5" },
        { type: "h1", text: "The fee cheat sheet every bank should keep open" },
        { type: "p", text: "Thanks for signing up. You'll get 5 short emails over two weeks, each with something you can use the day it lands. The first is the most useful thing we have: what U.S. banks and credit unions **actually publish** for the 15 fees customers notice most." },
        { type: "cta", text: "Open the national fee report", href: NATIONAL_REPORT, sub: "Free, no login. The numbers update as new fee schedules are verified." },
        { type: "h2", text: "How to read it in 30 seconds" },
        { type: "list", items: [
          "**Median** is the typical price. Half of institutions charge more and half charge less.",
          "**The middle half** (25th to 75th percentile) is the normal range. A fee above it is in the most expensive quarter of the market.",
          "**Banks vs credit unions** often differ more than you'd expect, so the report shows them side by side.",
        ] },
        { type: "box", tone: "action", title: "Do this in 15 minutes", items: [
          "Open your own fee schedule (or your bank's, if you're a customer).",
          "Write your amount next to each fee in the national report.",
          "Circle any fee above the middle half. Those are the ones customers, examiners and competitors notice first.",
        ] },
        { type: "p", text: `Want a specific institution? Every one we track has a free public profile: [search institutions](${S}/institutions) or browse [fees by category](${S}/fees).` },
        { type: "p", text: "Next email: overdraft and NSF, the two fees that changed the most since 2021, and the rules behind them." },
        { type: "sign" },
      ],
    },
    {
      key: "overdraft-nsf",
      day: 2,
      subject: "Overdraft and NSF: the rules, and where pricing sits",
      preheader: "Four rules that shape these fees, and the questions to ask about your own.",
      blocks: [
        { type: "kicker", text: "Fee Literacy · Email 2 of 5" },
        { type: "h1", text: "Overdraft and NSF: the market split in two" },
        { type: "p", text: "In 2021 and 2022 several of the largest U.S. banks cut or dropped overdraft and NSF fees. The rest of the market didn't follow in a straight line. It split, and banks and credit unions moved differently." },
        { type: "cta", text: "See today's overdraft and NSF numbers", href: `${S}/fees/overdraft`, sub: `Median, middle half and bank vs credit union, from published schedules. NSF is [here](${S}/fees/nsf).` },
        { type: "box", tone: "rule", title: "The rules that shape these fees", items: [
          "**Reg E opt-in (2010):** an overdraft fee on ATM and one-time debit card transactions requires the consumer's affirmative opt-in.",
          "**CFPB Circular 2022-06:** overdraft fees on transactions authorized against a positive balance (\"authorize positive, settle negative\") can be an unfair practice.",
          "**FDIC FIL-40-2022:** charging an NSF fee every time the same item is re-presented carries consumer-compliance risk; the FDIC expects institutions to correct the practice and may require restitution.",
          "**Truth in Savings (Reg DD):** fee schedules must be disclosed. That's why this data is public, and why your competitors can read yours.",
        ] },
        { type: "box", tone: "action", title: "Questions to ask about your own schedule", items: [
          "Do we charge NSF on re-presented items? How many times?",
          "Is our overdraft fee above the market's middle half?",
          "Do we cap daily overdraft fees? Is the cap on the published schedule?",
          "Is there a de minimis threshold (no fee on overdrafts under $X)?",
        ] },
        { type: "p", text: `Go deeper: [the National Fee Index](${S}/research/national-fee-index).` },
        { type: "sign" },
      ],
    },
    {
      key: "quiet-fees",
      day: 5,
      subject: "The fees nobody benchmarks (customers notice them anyway)",
      preheader: "Stop payment, returned deposits, card replacement: where the real spread is.",
      blocks: [
        { type: "kicker", text: "Fee Literacy · Email 3 of 5" },
        { type: "h1", text: "The quiet fees: small line items, wide spread" },
        { type: "p", text: "Everyone benchmarks overdraft. Almost nobody benchmarks the fees a customer pays once a year, and those are the ones that come up in a branch argument or a one-star review." },
        { type: "h2", text: "Four to check" },
        { type: "list", ordered: true, items: [
          `**Debit card replacement.** Check whether you price a standard reissue like a rush order. [See the market](${S}/fees/card_replacement).`,
          `**Deposited item returned.** The customer who deposited a bad check didn't write it, which makes this fee hard to defend. [See the market](${S}/fees/deposited_item_return).`,
          `**Stop payment.** A lower online price is an easy way to stand out. [See the market](${S}/fees/stop_payment).`,
          `**Cashier's check.** Often priced once years ago and never revisited. [See the market](${S}/fees/cashiers_check).`,
        ] },
        { type: "box", tone: "term", title: "Term worth knowing: headline fee", paras: [
          "Most schedules list several prices for the same fee (online vs branch, standard vs rush). Compare like with like, and know which one a customer actually gets. If your everyday price is above the market's, no footnote will save the comparison.",
        ] },
        { type: "box", tone: "action", title: "Do this in 15 minutes", items: [
          "Find your quiet fees above the market's middle half.",
          "For each one, write the one-sentence reason you'd give a customer at the counter.",
          "If you can't write it, that fee is a candidate for your next pricing review.",
        ] },
        { type: "sign" },
      ],
    },
    {
      key: "benchmark-method",
      day: 9,
      subject: "How to benchmark a fee schedule in 30 minutes (our exact method)",
      preheader: "Peer group, percentile, outlier rule. The steps behind our reports, free.",
      blocks: [
        { type: "kicker", text: "Fee Literacy · Email 4 of 5" },
        { type: "h1", text: "Benchmark any fee schedule in 30 minutes" },
        { type: "p", text: "This is the method behind our reports, written out so you can run it yourself. No spreadsheet magic. Four steps." },
        { type: "box", tone: "rule", title: "The method", ordered: true, items: [
          "**Pick a real peer group.** Same charter type (bank or credit union) and the institutions your customers actually compare you to. A $300M credit union and a national bank tell you nothing about each other.",
          "**Compare like with like.** Same fee, same channel, same conditions. A branch price against an online price isn't a comparison.",
          "**Place yourself by percentile.** Sort the peers' prices. Below the 25th percentile is low; above the 75th is high.",
          "**Flag outliers with one rule.** A fee is an outlier if it's more than 2× the peer median, or more than 1.5× the interquartile range above the 75th percentile. Outliers get a written reason or a review.",
        ] },
        { type: "box", tone: "warn", title: "Mistakes we see constantly", items: [
          "Benchmarking against the big national banks when your customers compare you to the credit union down the street.",
          "Comparing your branch price to a competitor's online price.",
          "Using an old schedule. Fee pages change more often than the PDF in the shared drive.",
          "Counting a fee as \"$0\" when it's really \"waived with direct deposit\". Record the condition.",
        ] },
        { type: "p", text: `Shortcut: the free [national](${NATIONAL_REPORT}) and [Fed district](${S}/reports) reports do steps 3 and 4 for the market. [Read the full methodology](${S}/methodology).` },
        { type: "sign" },
      ],
    },
    {
      key: "pricing-review-kit",
      day: 14,
      subject: "Your fee review kit, for the next pricing committee",
      preheader: "A one-page agenda for your next pricing committee, and where to get a report on your own fees.",
      blocks: [
        { type: "kicker", text: "Fee Literacy · Email 5 of 5" },
        { type: "h1", text: "Run a fee review your committee will actually finish" },
        { type: "p", text: "Last email in the series. Here's a one-page agenda you can paste into your next ALCO, pricing or product committee meeting. It turns the last four emails into decisions." },
        { type: "box", tone: "action", title: "Fee review agenda (60 minutes)", ordered: true, items: [
          "**Position (15 min):** our headline fees against the market's 25th percentile, median and 75th percentile. List every fee above the 75th.",
          "**Revenue (10 min):** service charges on deposit accounts from our Call Report (Schedule RI) or NCUA 5300 fee income. Which 3 fees drive most of it?",
          "**Risk (10 min):** re-presentment NSF, authorize-positive/settle-negative, overdraft caps, Reg E opt-in records.",
          "**Customer (10 min):** complaints and reviews that mention a fee by name in the last 12 months.",
          "**Decide (15 min):** for each high-quarter fee, keep (with a written reason), cut, restructure (cap, de minimis, online price), or study further.",
        ] },
        { type: "p", text: "Two outcomes make a review worth it: a fee you can defend in one sentence, and a list of fees you'll stop defending." },
        { type: "rule" },
        { type: "h2", text: "Want this done for your institution?" },
        { type: "p", text: "We build an institution report: your fees against the local competitors you name, fee by fee, with every competitor figure taken from its own published schedule." },
        { type: "cta", text: "Request your institution report", href: INSTITUTION_REPORT, sub: "We check that your market has enough published data, then reply with scope and price." },
        { type: "p", text: "From here you'll get the monthly Fee Pulse: what moved in the index and one practical idea. Reply any time with a fee question." },
        { type: "sign" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 2. Report requests (free national / district reports, institution report requests)
// ---------------------------------------------------------------------------
// No figures in this sequence: every number lives on the live report pages, which read
// published_fee_catalog, so an email can never quote a stale median. The institution
// report has no fixed price yet (James, Oct 5), so these emails never state one.
const report = {
  key: "report",
  name: "Report requests: free report → institution report",
  masthead: "Bank Fee Index · Reports",
  trigger:
    "Joins group 'Fee Insight · Report requests' after confirming their email (sources: report_national, report_district, report, capture_report_sample). Remove from Welcome series on entry.",
  emails: [
    {
      key: "read-your-report",
      day: 0,
      subject: "Your fee reports, and what to read first",
      preheader: "Every free report is live. Here is where every number comes from.",
      blocks: [
        { type: "kicker", text: "Bank Fee Index · 1 of 3" },
        { type: "h1", text: "Your fee reports, and what to read first" },
        { type: "p", text: "Thanks for confirming. Whichever report you asked for, the free ones are live and update as new fee schedules are verified, so a link always shows the current numbers." },
        { type: "cta", text: "See every free report", href: `${S}/reports`, sub: "National, all 12 Fed districts, and every state. Free, no login." },
        { type: "p", text: "If you have five minutes, read these in order:" },
        { type: "list", ordered: true, items: [
          "**Key findings.** The two penalty fees and the bank vs credit union gap, each with how many institutions stand behind it.",
          "**Headline fees.** The median and the middle half (25th to 75th percentile) for each of the 15 fees customers notice most. A fee only appears when 20 or more institutions publish it.",
          "**Banks vs credit unions.** The same fees by charter, where each side has enough institutions to compare.",
          "**Methodology.** One value per institution, taken from its own published fee schedule.",
        ] },
        { type: "box", tone: "term", title: "Asked for a report on your own institution?", paras: [
          "That one is built by hand against the competitors in your market. We first check that your market has enough published fee schedules, then write to you directly with what it covers and the price.",
        ] },
        { type: "p", text: "In a week: how your state compares with the national numbers." },
        { type: "sign" },
      ],
    },
    {
      key: "your-state",
      day: 7,
      subject: "How your state's fees compare with the national median",
      preheader: "Free state fee reports, from each institution's own published schedule.",
      blocks: [
        { type: "kicker", text: "Bank Fee Index · 2 of 3" },
        { type: "h1", text: "How your state compares with the national numbers" },
        { type: "p", text: "Customers don't compare you with the whole country. They compare you with the institutions down the street. The state reports are the next step closer: each headline fee in your state against the national median, banks against credit unions, and the economy around them." },
        { type: "cta", text: "Find your state's report", href: `${S}/research`, sub: "Free, no login." },
        { type: "box", tone: "action", title: "10-minute self-check", items: [
          "Which of your 15 headline fees sit above your state's median?",
          "Is your overdraft or NSF fee above the state's middle half?",
          "Do your fee schedule PDF and your website agree, line by line?",
        ] },
        { type: "p", text: "Next week: what the institution report adds, for when the state view isn't close enough." },
        { type: "sign" },
      ],
    },
    {
      key: "institution-report",
      day: 14,
      subject: "Your institution against the competitors you name",
      preheader: "The one report we build by hand. Tell us your institution and we'll quote it.",
      blocks: [
        { type: "kicker", text: "Bank Fee Index · 3 of 3" },
        { type: "h1", text: "Your institution against the competitors you name" },
        { type: "p", text: "The free reports show the market. The institution report shows where you stand in it." },
        { type: "box", tone: "rule", title: "What's in it", items: [
          "Your headline fees against your local competitors, fee by fee.",
          "The competitors you name, side by side with you.",
          "Fees well above or below the local market, flagged.",
          "Every figure taken from the competitor's own published fee schedule.",
        ] },
        { type: "cta", text: "Request your institution report", href: `${S}/for-institutions?report=institution#report`, sub: "We check that your market has enough published data, then reply with scope and price." },
        { type: "p", text: "Or just reply with your institution's name." },
        { type: "sign" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 3. Explorers (institution alerts / state benchmark capture)
// ---------------------------------------------------------------------------
const explorer = {
  key: "explorer",
  name: "Explorers: institution + state watchers",
  masthead: "Bank Fee Index · Watchers",
  trigger:
    "Joins group 'Fee Insight · Watchers' (sources: capture_institution, capture_state).",
  emails: [
    {
      key: "what-you-watch",
      day: 0,
      subject: "How to read your state's fee numbers",
      preheader: "What the state page shows, and the institution profiles behind it.",
      blocks: [
        { type: "kicker", text: "Watchers · 1 of 3" },
        { type: "h1", text: "How to read your state's fee numbers" },
        { type: "p", text: "You signed up to follow fees in your state. Every number on the state page comes from the published fee schedules of the banks and credit unions there. Here's what to look at." },
        { type: "box", tone: "term", title: "Reading the state page", items: [
          "**The median:** the middle price among institutions in the state that publish the fee.",
          "**The middle half:** the 25th to 75th percentile, where most institutions price.",
          "**Institutions behind it:** how many schedules each number rests on. A small count means read it as a hint, not a verdict.",
        ] },
        { type: "cta", text: "Find your state's page", href: `${S}/research`, sub: "Free, no login." },
        { type: "box", tone: "term", title: "Then look at a single institution", items: [
          "**The fee table:** each fee next to the national median.",
          "**Source:** the published document and the date we read it.",
          "**Coverage:** how many of the 15 headline fees the schedule publishes. A missing fee isn't a $0 fee.",
        ] },
        { type: "p", text: `Want an email when a fee changes? Create a free account and save the institution: [find it here](${S}/institutions).` },
        { type: "sign" },
      ],
    },
    {
      key: "state-vs-national",
      day: 4,
      subject: "Is your state expensive? How to tell in two minutes",
      preheader: "Hold your state up against the national line.",
      blocks: [
        { type: "kicker", text: "Watchers · 2 of 3" },
        { type: "h1", text: "Hold your state up against the national line" },
        { type: "p", text: "State reports show each headline fee in your state next to the national median, with banks and credit unions side by side." },
        { type: "cta", text: "Find your state's report", href: `${S}/research`, sub: `Free, no login. The national numbers are in the [national report](${NATIONAL_REPORT}).` },
        { type: "box", tone: "warn", title: "Read small samples carefully", paras: [
          "In smaller states a median can rest on a handful of institutions. Check how many institutions stand behind each number before you treat it as a verdict.",
        ] },
        { type: "sign" },
      ],
    },
    {
      key: "go-further",
      day: 10,
      subject: "From watching fees to benchmarking them",
      preheader: "The free method, the free reports, and the report we build for you.",
      blocks: [
        { type: "kicker", text: "Watchers · 3 of 3" },
        { type: "h1", text: "Three ways to go further, two of them free" },
        { type: "list", ordered: true, items: [
          `**Free: the method.** Peer group, like-for-like prices, percentile, outlier rule. It's all in our [methodology](${S}/methodology).`,
          `**Free: the reports.** The [national and Fed district reports](${S}/reports), and every institution profile and fee page.`,
          `**The institution report.** Your institution against the local competitors you name, every figure from their own published schedules. [Request it](${INSTITUTION_REPORT}) and we'll reply with scope and price.`,
        ] },
        { type: "p", text: "You'll keep getting the monthly Fee Pulse. Reply any time with a question." },
        { type: "sign" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 4. Monthly Fee Pulse (regular campaign; refresh data.mjs from fee_index_cache before each send)
// ---------------------------------------------------------------------------
const nsfVsOd =
  F.nsf.all.med === F.overdraft.all.med
    ? "the same as"
    : F.nsf.all.med > F.overdraft.all.med
      ? "above"
      : "below";
const pulse = {
  key: "pulse",
  name: "Monthly Fee Pulse (campaign template)",
  masthead: `Fee Pulse · ${SNAPSHOT.asOf.replace(/ \d+,/, "")}`,
  trigger: "Regular monthly campaign to all Fee Insight groups. Refresh data.mjs from fee_index_cache and rebuild before each send.",
  emails: [
    {
      key: "fee-pulse",
      day: 0,
      subject: `Fee Pulse: the typical overdraft fee is ${m(F.overdraft.all.med)}`,
      preheader: "Where the Bank Fee Index stands this month, and one idea to use it.",
      blocks: [
        { type: "kicker", text: `Fee Pulse · ${SNAPSHOT.asOf}` },
        { type: "h1", text: "This month in the Bank Fee Index" },
        { type: "stats", items: [
          { value: m(F.overdraft.all.med), label: `median overdraft (${F.overdraft.all.n.toLocaleString("en-US")} institutions)` },
          { value: m(F.nsf.all.med), label: `median NSF (${F.nsf.all.n.toLocaleString("en-US")} institutions)` },
          { value: m(F.monthly_maintenance.all.med), label: `median monthly maintenance (${F.monthly_maintenance.all.n.toLocaleString("en-US")} institutions)` },
        ] },
        { type: "h2", text: "The number that matters" },
        { type: "p", text: `The typical NSF fee (${m(F.nsf.all.med)}) is ${nsfVsOd} the typical overdraft fee (${m(F.overdraft.all.med)}), even though NSF is the fee regulators have pushed hardest on re-presented items. If your NSF fee sits above ${m(F.nsf.all.p75)}, you're in the most expensive quarter of the market on the fee examiners ask about first.` },
        { type: "box", tone: "action", title: "One idea to use this month", paras: [
          "Check whether your schedule charges NSF on re-presented items, and how many times. If the answer takes more than one sentence, so will the conversation with your examiner.",
        ] },
        { type: "h2", text: "National benchmark table" },
        { type: "bench", rows: benchRows(CHEAT_SHEET_ORDER), note: benchNote },
        { type: "p", text: `More: [National report](${NATIONAL_REPORT}) · [Fed district reports](${S}/reports) · [Research](${S}/research)` },
        { type: "sign" },
      ],
    },
  ],
};

export const PROGRAM = [welcome, report, explorer, pulse];
