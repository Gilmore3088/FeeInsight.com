// Fee Insight email program: copy + structure. Rendered by build.mjs.
// Every number comes from data.mjs (Bank Fee Index snapshot). Rule for this file:
// each email must hand over something usable on its own — a benchmark, a method,
// a checklist — with the ask (if any) last and small.
import { FEES, SNAPSHOT, CHEAT_SHEET_ORDER } from "./data.mjs";

export const BRAND = {
  siteUrl: "https://feeinsight.com",
  institutionsLabel: SNAPSHOT.institutions.toLocaleString("en-US"),
  // CAN-SPAM requires a valid postal address in every commercial email.
  mailingAddress: "[Fee Insight mailing address]",
};

const S = BRAND.siteUrl;
const F = FEES;
const m = (v) => (Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`);
const n = (k) => F[k].all.n;
const benchNote = `Bank Fee Index, ${SNAPSHOT.asOf}. One headline amount per institution (lowest published amount for that fee). "Low 25%" and "High 25%" are the 25th and 75th percentiles; n = institutions with that fee published. Banks and CUs columns are medians.`;
const benchRows = (keys) => keys.map((k) => [k, F[k]]);

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
      subject: "Your fee benchmark cheat sheet (13 fees, live data)",
      preheader: `What ${BRAND.institutionsLabel} banks and credit unions actually publish, from overdraft to wires.`,
      blocks: [
        { type: "kicker", text: "Welcome · Email 1 of 5" },
        { type: "h1", text: "The fee cheat sheet we wish every bank had taped to the wall" },
        { type: "p", text: `Thanks for signing up. You'll get 5 short emails over two weeks. Each one gives you something you can use the day it lands. The first is the most useful thing we have: what U.S. banks and credit unions **actually publish** for the fees customers notice most.` },
        { type: "stats", items: [
          { value: BRAND.institutionsLabel, label: "institutions with a published fee schedule in the index" },
          { value: SNAPSHOT.feeRecords.toLocaleString("en-US"), label: "verified fee records, each linked to its source document" },
          { value: String(SNAPSHOT.states), label: "states and territories covered" },
        ] },
        { type: "h2", text: "The benchmark table" },
        { type: "bench", rows: benchRows(CHEAT_SHEET_ORDER), note: benchNote },
        { type: "h2", text: "How to read it in 30 seconds" },
        { type: "list", items: [
          `**Median** is the typical price. Half of institutions charge more and half charge less.`,
          `**Low 25% / High 25%** marks the normal range. A fee above the High 25% column is in the most expensive quarter of the market.`,
          `**Banks vs CUs** often differ more than you'd expect. Credit unions charge a lower median overdraft (${m(F.overdraft.cu.med)} vs ${m(F.overdraft.bank.med)}) but a higher median NSF (${m(F.nsf.cu.med)} vs ${m(F.nsf.bank.med)}) and card replacement (${m(F.card_replacement.cu.med)} vs ${m(F.card_replacement.bank.med)}).`,
        ] },
        { type: "box", tone: "action", title: "Do this in 15 minutes", items: [
          "Open your own fee schedule (or your bank's, if you're a customer).",
          "Write your amount next to each row of the table above.",
          "Circle any fee above the High 25% column. Those are the ones customers, examiners and competitors notice first.",
        ] },
        { type: "p", text: `Want the same comparison for a specific institution? Every institution in the index has a free public profile. [Search institutions](${S}/institutions) or browse [fees by category](${S}/fees).` },
        { type: "p", text: "Next email: overdraft and NSF, the two fees that changed the most since 2021, and where pricing sits today." },
        { type: "sign" },
      ],
    },
    {
      key: "overdraft-nsf",
      day: 2,
      subject: `Overdraft is ${m(F.overdraft.all.med)} at the median. A quarter charge $5 or less.`,
      preheader: "Where overdraft and NSF pricing sit now, and what changed since 2021.",
      blocks: [
        { type: "kicker", text: "Fee Literacy · Email 2 of 5" },
        { type: "h1", text: "Overdraft and NSF: the market split in two" },
        { type: "p", text: `In 2021 and 2022 several of the largest U.S. banks cut or dropped overdraft and NSF fees. The rest of the market did not follow in a straight line. It split. Here's what the published schedules show today.` },
        { type: "stats", items: [
          { value: m(F.overdraft.all.med), label: `median overdraft fee (n=${n("overdraft")})` },
          { value: `${Math.round(F.overdraft.all.le5)}%`, label: "charge $5 or less for overdraft" },
          { value: m(F.nsf.all.med), label: `median NSF fee (n=${n("nsf")})` },
        ] },
        { type: "h2", text: "Banks vs credit unions" },
        { type: "bars", items: [
          { label: "Overdraft: banks (median)", value: F.overdraft.bank.med, accent: true },
          { label: "Overdraft: credit unions (median)", value: F.overdraft.cu.med },
          { label: "NSF: banks (median)", value: F.nsf.bank.med, accent: true },
          { label: "NSF: credit unions (median)", value: F.nsf.cu.med },
        ], note: `Bank Fee Index, ${SNAPSHOT.asOf}. Banks n=${F.overdraft.bank.n} (overdraft) / ${F.nsf.bank.n} (NSF); credit unions n=${F.overdraft.cu.n} / ${F.nsf.cu.n}.` },
        { type: "p", text: `The pattern: banks still anchor overdraft near ${m(F.overdraft.bank.med)}, but more of them have pulled NSF down (bank median ${m(F.nsf.bank.med)}; a quarter at ${m(F.nsf.bank.p25)} or less). Credit unions are the reverse: lower overdraft, but NSF holds at ${m(F.nsf.cu.med)}.` },
        { type: "box", tone: "rule", title: "The rules that shape these fees", items: [
          "**Reg E opt-in (2010):** an overdraft fee on ATM and one-time debit card transactions requires the consumer's affirmative opt-in.",
          "**CFPB Circular 2022-06:** overdraft fees on transactions authorized against a positive balance (\"authorize positive, settle negative\") can be an unfair practice.",
          "**FDIC FIL-40-2022:** charging an NSF fee every time the same item is re-presented carries consumer-compliance risk; the FDIC expects institutions to correct the practice and may require restitution.",
          "**Truth in Savings (Reg DD):** fee schedules must be disclosed. That's why this data is public, and why your competitors can read yours.",
        ] },
        { type: "box", tone: "action", title: "Questions to ask about your own schedule", items: [
          "Do we charge NSF on re-presented items? How many times?",
          "Is our overdraft fee in the high quarter (above " + m(F.overdraft.all.p75) + ")?",
          "Do we cap daily overdraft fees? Is the cap on the published schedule?",
          "Is there a de minimis threshold (no fee on overdrafts under $X)?",
        ] },
        { type: "p", text: `Go deeper: [overdraft benchmarks](${S}/fees/overdraft) · [NSF benchmarks](${S}/fees/nsf) · [the National Fee Index](${S}/research/national-fee-index).` },
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
        { type: "p", text: "Everyone benchmarks overdraft. Almost nobody benchmarks the fees a customer pays once a year, and those come up in a branch argument or a one-star review. The spread on these is often wider than on the headline fees." },
        { type: "bars", items: [
          { label: `Debit card replacement: low 25% → high 25%`, value: F.card_replacement.all.p75, display: `${m(F.card_replacement.all.p25)}–${m(F.card_replacement.all.p75)}`, accent: true },
          { label: "Stop payment: low 25% → high 25%", value: F.stop_payment.all.p75, display: `${m(F.stop_payment.all.p25)}–${m(F.stop_payment.all.p75)}` },
          { label: "Deposited item returned: low 25% → high 25%", value: F.deposited_item_return.all.p75, display: `${m(F.deposited_item_return.all.p25)}–${m(F.deposited_item_return.all.p75)}` },
          { label: "Cashier's check: low 25% → high 25%", value: F.cashiers_check.all.p75, display: `${m(F.cashiers_check.all.p25)}–${m(F.cashiers_check.all.p75)}` },
        ], note: `Bar length = the high-quarter price. Bank Fee Index, ${SNAPSHOT.asOf}.` },
        { type: "h2", text: "Three things the data shows" },
        { type: "list", ordered: true, items: [
          `**Card replacement is the widest spread on the sheet.** The median is ${m(F.card_replacement.all.med)}, but the high quarter starts at ${m(F.card_replacement.all.p75)}. Credit unions (median ${m(F.card_replacement.cu.med)}) charge well above banks (${m(F.card_replacement.bank.med)}). Check whether you're pricing a standard reissue like a rush order.`,
          `**Returned deposits penalize the wrong person.** The customer who deposited a bad check didn't write it. Median ${m(F.deposited_item_return.all.med)}; credit unions run higher (${m(F.deposited_item_return.cu.med)}).`,
          `**Stop payment almost never drops below $15.** Only ${F.stop_payment.all.le5}% charge $5 or less. Banks sit at ${m(F.stop_payment.bank.med)} vs ${m(F.stop_payment.cu.med)} at credit unions. A lower online stop-payment price is an easy differentiator.`,
        ] },
        { type: "box", tone: "term", title: "Term worth knowing: headline fee", paras: [
          "Most schedules list several prices for the same fee (online vs branch, standard vs rush, per item vs per day). We benchmark the **lowest published amount**, the one a customer can actually get. If your lowest price is above the market's, no footnote will save the comparison.",
        ] },
        { type: "box", tone: "action", title: "Do this in 15 minutes", items: [
          "Find your three quiet fees above the high-quarter line.",
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
      preheader: "Peer group, percentile, outlier rule. The same steps behind our paid reports, free.",
      blocks: [
        { type: "kicker", text: "Fee Literacy · Email 4 of 5" },
        { type: "h1", text: "Benchmark any fee schedule in 30 minutes" },
        { type: "p", text: "This is the method behind our Competitive Fee Position reports, written out so you can run it yourself. No spreadsheet magic. Four steps." },
        { type: "box", tone: "rule", title: "The method", ordered: true, items: [
          "**Pick a real peer group.** Same charter type (bank or credit union) and a similar asset size. Comparing a $300M credit union with a national bank tells you nothing.",
          "**Use the headline amount.** For each fee, take the lowest published price on the schedule. That's what a customer can get, and what a competitor will quote.",
          "**Place yourself by percentile.** Sort the peers' prices. Where do you land? Below the 25th percentile is low, above the 75th is high.",
          "**Flag outliers with one rule.** A fee is an outlier if it's more than 2× the peer median, or more than 1.5× the interquartile range above the 75th percentile. Outliers get a written reason or a review.",
        ] },
        { type: "h2", text: "Worked example: NSF" },
        { type: "p", text: `Peer group: all credit unions in the index (n=${F.nsf.cu.n}). Low 25% is ${m(F.nsf.cu.p25)}, median ${m(F.nsf.cu.med)}, high 25% ${m(F.nsf.cu.p75)}. The interquartile range is ${m(F.nsf.cu.p75 - F.nsf.cu.p25)}, so the statistical outlier line is ${m(F.nsf.cu.p75 + 1.5 * (F.nsf.cu.p75 - F.nsf.cu.p25))}, and 2× the median is ${m(2 * F.nsf.cu.med)}. A credit union charging $35 isn't an outlier but sits in the expensive quarter. One charging $55 needs a reason.` },
        { type: "box", tone: "warn", title: "Mistakes we see constantly", items: [
          "Benchmarking against the big national banks when your customers compare you to the credit union down the street.",
          "Comparing your branch price to a competitor's online price.",
          "Using an old schedule. Fee pages change more often than the PDF in the shared drive.",
          "Counting a fee as \"$0\" when it's really \"waived with direct deposit\". Record the condition.",
        ] },
        { type: "p", text: `Shortcut: every institution profile on Fee Insight already shows its fees next to peer medians. [Find an institution](${S}/institutions) · [Read the full methodology](${S}/methodology).` },
        { type: "sign" },
      ],
    },
    {
      key: "pricing-review-kit",
      day: 14,
      subject: "Your fee review kit (and a free report offer)",
      preheader: "A one-page agenda for your next pricing committee, plus where to get a peer report.",
      blocks: [
        { type: "kicker", text: "Fee Literacy · Email 5 of 5" },
        { type: "h1", text: "Run a fee review your committee will actually finish" },
        { type: "p", text: "Last email in the series. Here's a one-page agenda you can paste into your next ALCO, pricing or product committee meeting. It turns the last four emails into decisions." },
        { type: "box", tone: "action", title: "Fee review agenda (60 minutes)", ordered: true, items: [
          "**Position (15 min):** our 13 headline fees vs peer low 25% / median / high 25%. List every fee above the high quarter.",
          "**Revenue (10 min):** service charges on deposit accounts from our Call Report (Schedule RI) or NCUA 5300 fee income. Which 3 fees drive most of it?",
          "**Risk (10 min):** re-presentment NSF, authorize-positive/settle-negative, overdraft caps, Reg E opt-in records.",
          "**Customer (10 min):** complaints and reviews that mention a fee by name in the last 12 months.",
          "**Decide (15 min):** for each high-quarter fee, keep (with a written reason), cut, restructure (cap, de minimis, online price), or study further.",
        ] },
        { type: "p", text: "Two outcomes make a review worth it: a fee you can defend in one sentence, and a list of fees you'll stop defending." },
        { type: "rule" },
        { type: "h2", text: "Want this done for your institution?" },
        { type: "p", text: "We build a **Competitive Fee Position** report for a single bank or credit union: your 15 headline fees against your true peer cohort, outliers flagged, named competitors side by side, and every figure linked to the published schedule it came from." },
        { type: "cta", text: "See a sample report", href: `${S}/reports/sample-competitive-fee-position`, sub: "Sample is free and needs no login. A custom report is $300, refreshed quarterly." },
        { type: "p", text: "From here you'll get the monthly Fee Pulse: one email a month with what moved in the index and one practical idea. Reply any time with a fee question. We answer them." },
        { type: "sign" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 2. Report requests (sample report / report form / for-institutions)
// ---------------------------------------------------------------------------
const report = {
  key: "report",
  name: "Report requests: sample → own report",
  masthead: "Competitive Fee Position",
  trigger:
    "Joins group 'Fee Insight · Report requests' (sources: capture_report_sample, report). Remove from Welcome series on entry.",
  emails: [
    {
      key: "read-your-sample",
      day: 0,
      subject: "Your sample report, and the 5 pages to read first",
      preheader: "How to read a Competitive Fee Position report in five minutes.",
      blocks: [
        { type: "kicker", text: "Competitive Fee Position · 1 of 3" },
        { type: "h1", text: "Your sample report, and how to read it in five minutes" },
        { type: "cta", text: "Open the sample report", href: `${S}/reports/sample-competitive-fee-position`, sub: "No login. Every figure links to the source schedule." },
        { type: "p", text: "The report is built to be read by a busy executive. If you only have five minutes, read these in order:" },
        { type: "list", ordered: true, items: [
          "**Executive summary.** Three findings, each with a dollar figure and a peer count.",
          "**Position chart.** Every headline fee placed between the peer low 25% and high 25%. Dots outside the band are the story.",
          "**Outlier flags.** Fees more than 2× the peer median, or statistically high. Each gets a suggested next step.",
          "**Named competitors.** The same fees at the institutions customers actually compare you to.",
          "**Sources.** Every number links to the published document, with its date, so nobody in the room has to take it on faith.",
        ] },
        { type: "box", tone: "term", title: "What \"peer cohort\" means here", paras: [
          `Same charter type and the same asset-size tier, drawn from the ${BRAND.institutionsLabel} institutions in the index. That's why the medians in a report differ from the national numbers. The national NSF median is ${m(F.nsf.all.med)}, but bank and credit union medians are ${m(F.nsf.bank.med)} and ${m(F.nsf.cu.med)}.`,
        ] },
        { type: "p", text: "In three days: the three findings that show up in almost every report we build." },
        { type: "sign" },
      ],
    },
    {
      key: "three-findings",
      day: 3,
      subject: "3 findings that show up in almost every fee report",
      preheader: "If you check only three things on your schedule, check these.",
      blocks: [
        { type: "kicker", text: "Competitive Fee Position · 2 of 3" },
        { type: "h1", text: "Three findings that show up in almost every report" },
        { type: "p", text: "After building these reports across banks and credit unions of every size, the same three issues come up again and again. Check yours against them today." },
        { type: "h2", text: "1. One fee is far out of line with the rest" },
        { type: "p", text: `Most institutions price close to the market on most fees, then have one or two at 2× the peer median or more. Card replacement is the usual suspect (national spread ${m(F.card_replacement.all.p25)} to ${m(F.card_replacement.all.p75)}), followed by returned deposits and stop payments.` },
        { type: "h2", text: "2. NSF is still on the schedule while peers dropped it" },
        { type: "p", text: `A quarter of banks in the index charge ${m(F.nsf.bank.p25)} or less for NSF. If yours is ${m(F.nsf.all.p75)} or more, you're in the expensive quarter on the fee examiners and journalists ask about first.` },
        { type: "h2", text: "3. The schedule no longer matches the website" },
        { type: "p", text: "The PDF says one thing and the product page says another, or the online price isn't listed at all. It's the cheapest finding to fix and the most embarrassing to have a customer find." },
        { type: "box", tone: "action", title: "10-minute self-check", items: [
          "Any fee above 2× the peer median? (Use the medians in the sample report.)",
          `NSF above ${m(F.nsf.all.p75)}? On re-presented items too?`,
          "Do the fee schedule PDF and the website agree, line by line?",
        ] },
        { type: "sign" },
      ],
    },
    {
      key: "your-report",
      day: 7,
      subject: "Want your own report? Here's exactly what you get",
      preheader: "Your institution, your peers, your named competitors. $300, refreshed quarterly.",
      blocks: [
        { type: "kicker", text: "Competitive Fee Position · 3 of 3" },
        { type: "h1", text: "The same report, built for your institution" },
        { type: "p", text: "If the sample was useful, here's the version with your name on it." },
        { type: "box", tone: "rule", title: "What's included", items: [
          "Your 15 headline fees against your true peer cohort (charter type + asset size).",
          "Outliers flagged with suggested actions.",
          "Up to 5 named competitors you choose, side by side.",
          "Every figure linked to the published schedule it came from.",
          "A board-ready summary page.",
          "Quarterly refresh, so it doesn't go stale before the next committee meeting.",
        ] },
        { type: "cta", text: "Request your report", href: `${S}/for-institutions`, sub: "$300. Or reply with your institution's name and we'll take it from there." },
        { type: "p", text: "Not ready? Your institution's free public profile is already live and updates as schedules change: [find it here](" + S + "/institutions). You'll also get the monthly Fee Pulse." },
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
  masthead: "Bank Fee Index · Alerts",
  trigger:
    "Joins group 'Fee Insight · Watchers' (sources: capture_institution, capture_state). Stays subscribed to change alerts after the sequence.",
  emails: [
    {
      key: "what-you-watch",
      day: 0,
      subject: "You're watching. Here's what we'll tell you, and when",
      preheader: "How fee change alerts work, and how to read an institution profile.",
      blocks: [
        { type: "kicker", text: "Alerts · 1 of 3" },
        { type: "h1", text: "You're set up. Here's what you'll hear about" },
        { type: "p", text: "When a fee schedule you follow changes, we tell you what changed, by how much, and where that puts it against peers. No noise in between." },
        { type: "box", tone: "term", title: "How to read an institution profile", items: [
          "**The fee table:** each fee next to the peer median. Arrows mark above or below.",
          "**Source links:** the published document and the date we read it.",
          "**Peer group:** institutions of the same charter type and similar size.",
          "**Coverage note:** which fees the schedule didn't publish. A missing fee isn't a $0 fee.",
        ] },
        { type: "p", text: `While you wait for the first alert, a good place to start is your state: [state fee benchmarks](${S}/research) and the [National Fee Index](${S}/research/national-fee-index).` },
        { type: "sign" },
      ],
    },
    {
      key: "state-vs-national",
      day: 4,
      subject: "Is your state expensive? How to tell in two minutes",
      preheader: "National medians to hold your state up against.",
      blocks: [
        { type: "kicker", text: "Alerts · 2 of 3" },
        { type: "h1", text: "Hold your state up against the national line" },
        { type: "p", text: "State pages on Fee Insight show local medians. To know if they're high, you need the national line to compare against. Here it is for the four fees people search most:" },
        { type: "bench", rows: benchRows(["overdraft", "nsf", "monthly_maintenance", "atm_non_network"]), note: benchNote },
        { type: "box", tone: "warn", title: "Read small samples carefully", paras: [
          "In smaller states a median can rest on a handful of institutions. Check the n on the state page. Under 10, treat the number as a signal, not a verdict.",
        ] },
        { type: "p", text: `Compare yours: [state benchmarks](${S}/research) · [city-level fees](${S}/fees).` },
        { type: "sign" },
      ],
    },
    {
      key: "go-further",
      day: 10,
      subject: "From watching fees to benchmarking them",
      preheader: "The free method, the free data, and the $300 shortcut.",
      blocks: [
        { type: "kicker", text: "Alerts · 3 of 3" },
        { type: "h1", text: "Three ways to go further, two of them free" },
        { type: "list", ordered: true, items: [
          `**Free: the method.** Peer group, headline amount, percentile, outlier rule. It's all in our [methodology](${S}/methodology).`,
          `**Free: the data.** Every institution profile and fee category page is public: [browse fees](${S}/fees).`,
          `**$300: the report.** Your institution against its true peers and named competitors, every figure sourced. [See a sample](${S}/reports/sample-competitive-fee-position).`,
        ] },
        { type: "p", text: "You'll keep getting change alerts for what you follow, plus the monthly Fee Pulse. Reply any time with a question." },
        { type: "sign" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 4. Monthly Fee Pulse (regular campaign template; refresh numbers each month)
// ---------------------------------------------------------------------------
const pulse = {
  key: "pulse",
  name: "Monthly Fee Pulse (campaign template)",
  masthead: `Fee Pulse · ${SNAPSHOT.asOf.replace(/ \d+,/, "")}`,
  trigger: "Regular monthly campaign to all Fee Insight groups. Rebuild with fresh data.mjs before each send.",
  emails: [
    {
      key: "fee-pulse",
      day: 0,
      subject: `Fee Pulse: ${BRAND.institutionsLabel} schedules, one number that matters`,
      preheader: "What moved in the Bank Fee Index this month, and one idea to use it.",
      blocks: [
        { type: "kicker", text: `Fee Pulse · ${SNAPSHOT.asOf}` },
        { type: "h1", text: "This month in the Bank Fee Index" },
        { type: "stats", items: [
          { value: BRAND.institutionsLabel, label: "institutions with published schedules" },
          { value: m(F.overdraft.all.med), label: "median overdraft" },
          { value: m(F.nsf.all.med), label: "median NSF" },
        ] },
        { type: "h2", text: "The number that matters" },
        { type: "p", text: `**${Math.round(F.monthly_maintenance.all.zero)}%** of institutions in the index publish a $0 monthly maintenance fee on at least one checking account, and ${Math.round(F.monthly_maintenance.all.le5)}% charge $5 or less. If your entry-level checking account still carries a fee, the "free checking" competitor is closer than you think.` },
        { type: "box", tone: "action", title: "One idea to use this month", paras: [
          "List your checking accounts by monthly fee and by how to waive it. If the waiver needs more than one condition, a customer will read it as \"not free\". Try rewriting it as one sentence.",
        ] },
        { type: "h2", text: "Full benchmark table" },
        { type: "bench", rows: benchRows(CHEAT_SHEET_ORDER), note: benchNote },
        { type: "p", text: `More: [National Fee Index](${S}/research/national-fee-index) · [Research](${S}/research) · [Guides](${S}/guides)` },
        { type: "sign" },
      ],
    },
  ],
};

export const PROGRAM = [welcome, report, explorer, pulse];
