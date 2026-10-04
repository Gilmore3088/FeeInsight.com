/**
 * Professional guides — the paying tier.
 *
 * Bank and credit-union employees and consultants are one audience, not two. These are
 * separate guides written for that reader, never gated sections of a consumer guide.
 *
 * The three opening topics are deliberately the three dimensions `/fees/[category]`
 * already breaks down — charter, asset tier and state. The guides teach the reader to
 * use the instrument the product already has, rather than describing a parallel one.
 */

import type { Guide } from "./types";

const base = {
  audience: "professional",
  accessTier: "pro",
  author: "Fee Insight Research",
  reviewedAt: "2026-08-15",
  publishedAt: "2026-08-15",
  methodologyHref: "/methodology",
  carriesRegulatoryContent: false,
} as const;

export const PROFESSIONAL_GUIDES: Guide[] = [
  {
    ...base,
    slug: "building-a-peer-set",
    title: "Building a Peer Set",
    seoTitle: "Building a Peer Set for Fee Benchmarking: Methodology for Banks and Credit Unions",
    description:
      "Why the national median is the wrong yardstick for a single institution, and how to construct a peer set that survives being questioned in a board meeting.",
    primaryCategory: "overdraft",
    relatedCategories: ["monthly_maintenance", "nsf"],
    family: "Benchmarking Method",
    featured: true,
    relatedSlugs: ["reading-your-state", "charter-and-institution-type"],
    sections: [
      {
        id: "why-national-medians-mislead",
        heading: "Why the national median is the wrong yardstick",
        blocks: [
          {
            type: "paragraph",
            text: "A national median answers a question almost no institution is actually asking. It tells you where the middle of the entire industry sits, pooling money-centre banks with single-branch credit unions, high-cost metropolitan markets with rural ones.",
          },
          {
            type: "paragraph",
            text: "The national overdraft median is {{overdraft.median}} across {{overdraft.institutions}} institutions, with a spread from {{overdraft.min}} to {{overdraft.max}}. That range is the point. A distribution that wide means the median describes the population and not any individual member of it.",
          },
          {
            type: "callout",
            tone: "warning",
            text: "The failure mode is predictable: an institution benchmarks against the national median, finds itself close to it, and concludes it is competitively priced — while every institution its customers actually consider is priced somewhere else entirely.",
          },
        ],
      },
      {
        id: "the-three-dimensions",
        heading: "The three dimensions that matter",
        blocks: [
          {
            type: "paragraph",
            text: "A defensible peer set is built from three variables, and each answers a different objection.",
          },
          {
            type: "list",
            ordered: true,
            items: [
              "Asset tier. Size drives cost structure, compliance burden and product range more than any other single variable. An institution at a different scale is not a peer regardless of geography.",
              "Charter type. Bank and credit union pricing differ systematically and structurally, not incidentally. Mixing them without saying so invites the objection that the comparison is not like for like.",
              "Geography. Market-level competition sets the ceiling on what an institution can charge, and it varies far more than national figures suggest.",
            ],
          },
          {
            type: "paragraph",
            text: "Applied in sequence these narrow a national population to a set an executive team will recognise as its actual competitors — which is the test a peer set has to pass.",
          },
          {
            type: "comparison",
            category: "overdraft",
            dimension: "asset_tier",
            caption: "Overdraft fee by asset tier — the dimension with the widest systematic spread",
          },
        ],
      },
      {
        id: "sizing-the-set",
        heading: "Sizing the set",
        blocks: [
          {
            type: "paragraph",
            text: "Peer sets fail in both directions. Too narrow and a single outlier moves the median. Too broad and you have rebuilt the national figure with extra steps.",
          },
          {
            type: "list",
            items: [
              "Below roughly 15 institutions, report the range and the individual observations rather than a median. A median over eight data points implies a precision the sample does not support.",
              "Between 15 and 60 is where most defensible peer sets land. Large enough for a stable median, small enough that every member is recognisable.",
              "Above roughly 100, ask which constraint you relaxed to get there and whether it was the one that mattered.",
            ],
          },
          {
            type: "callout",
            tone: "tip",
            text: "Report the count alongside every peer median. A median without an n is an assertion, not a finding, and it is the first thing a sceptical reader will ask for.",
          },
        ],
      },
      {
        id: "coverage-and-honesty",
        heading: "Coverage, and being honest about it",
        blocks: [
          {
            type: "paragraph",
            text: "Not every institution publishes every fee. A peer set of 40 institutions may yield 40 observations for overdraft and 12 for a less common fee, and those two numbers cannot carry the same confidence.",
          },
          {
            type: "paragraph",
            text: "Report coverage per fee, not per peer set. The alternative — a single stated peer count with fee-level medians drawn from varying subsets — is the most common way a benchmarking deck misleads its own authors.",
          },
          {
            type: "paragraph",
            text: "Where coverage is thin, say so and show the observations. A finding presented with its limits stated survives scrutiny; one presented without them fails at the first question.",
          },
        ],
      },
      {
        id: "using-the-result",
        heading: "Using the result",
        blocks: [
          {
            type: "paragraph",
            text: "A peer median is an input to a pricing decision, not the decision. Being above the peer median is not automatically a problem, and being below it is not automatically an opportunity.",
          },
          {
            type: "paragraph",
            text: "The useful questions are directional. Which fees sit furthest from peer, in which direction, and what does each of those gaps imply about volume and about how the fee is perceived? A fee well above peer with high incidence is a retention risk. One well below peer with low incidence is usually just a rounding error in the income statement.",
          },
          {
            type: "paragraph",
            text: "Pair the comparison with your own incidence data before drawing conclusions. Published fee schedules tell you the price; only your own systems tell you how often it is actually charged, and the second number governs the revenue impact.",
          },
        ],
      },
    ],
  },

  {
    ...base,
    slug: "reading-your-state",
    title: "Reading Your State",
    seoTitle: "State-Level Fee Benchmarking: How Geographic Fee Landscapes Differ",
    description:
      "How much of a fee gap is geography rather than strategy, and how to use state and district benchmarks without over-reading them.",
    primaryCategory: "monthly_maintenance",
    relatedCategories: ["overdraft", "atm_non_network"],
    family: "Benchmarking Method",
    featured: true,
    relatedSlugs: ["building-a-peer-set", "charter-and-institution-type"],
    sections: [
      {
        id: "geography-is-real",
        heading: "Geography is a real variable, not noise",
        blocks: [
          {
            type: "paragraph",
            text: "Fee levels vary systematically by state, and the variation is large enough that a national comparison can invert a local conclusion. An institution priced above the national median may sit below the median of the market it actually competes in.",
          },
          {
            type: "paragraph",
            text: "The drivers are structural: local competitive density, the mix of institution types operating in the market, cost of delivery, and in some cases state-level regulation.",
          },
          {
            type: "comparison",
            category: "monthly_maintenance",
            dimension: "state",
            minObservations: 10,
            caption: "Monthly maintenance fee by state, where coverage supports a median",
          },
        ],
      },
      {
        id: "state-versus-district",
        heading: "State or Federal Reserve district?",
        blocks: [
          {
            type: "paragraph",
            text: "Both cuts are available and they answer different questions.",
          },
          {
            type: "list",
            items: [
              "State is the better proxy for a competitive market and the unit most executive teams think in. It is also the unit that matters where state law affects pricing.",
              "Federal Reserve district gives larger samples and aligns with regional economic reporting, which makes it the better frame when you are relating fee levels to economic conditions.",
            ],
          },
          {
            type: "paragraph",
            text: "For a single-market institution, state is almost always the right cut. For a multi-state footprint, run both — a district view that looks stable can conceal two states moving in opposite directions.",
          },
        ],
      },
      {
        id: "the-sample-trap",
        heading: "The sample trap",
        blocks: [
          {
            type: "callout",
            tone: "warning",
            text: "State-level medians are the easiest figure in fee benchmarking to over-read. A state with few observations for a given fee produces a median that moves with a single institution's schedule.",
          },
          {
            type: "paragraph",
            text: "Check the observation count for the specific fee in the specific state before quoting a state median — not the count for the state overall. A state with strong coverage on overdraft may have very thin coverage on a less common fee, and the two figures do not deserve equal confidence.",
          },
          {
            type: "paragraph",
            text: "Where the sample is thin, use the district figure and say that is what you did. Substituting a broader unit and labelling it accurately is sound. Quoting a fragile state median as though it were robust is not.",
          },
        ],
      },
      {
        id: "separating-geography-from-strategy",
        heading: "Separating geography from strategy",
        blocks: [
          {
            type: "paragraph",
            text: "The analytical question is how much of a gap is location and how much is decision-making. Run the comparison twice — once against a national peer set matched on asset tier and charter, once against in-state institutions.",
          },
          {
            type: "list",
            items: [
              "Above national peers but in line with in-state: the gap is largely market. Defensible, though worth confirming the market itself is not an outlier.",
              "In line with national peers but above in-state: a genuine competitive exposure in the market that matters.",
              "Above both: a pricing decision, and one that should be deliberate.",
              "Below both: check incidence and revenue before treating it as an opportunity.",
            ],
          },
          {
            type: "paragraph",
            text: "That two-way read is the whole value of the geographic cut. A single comparison against either frame alone cannot distinguish market from strategy.",
          },
        ],
      },
      {
        id: "reporting-it",
        heading: "Reporting it",
        blocks: [
          {
            type: "paragraph",
            text: "State comparisons invite a specific objection: that the peers named are not real competitors, only institutions that share a border. Anticipate it by naming the constraint set explicitly — state, asset tier, charter, and the observation count for the fee in question.",
          },
          {
            type: "paragraph",
            text: "Where a state median rests on a thin sample, show the individual observations instead of the median. Fewer than a dozen data points are usually more persuasive listed than summarised, and listing them forecloses the argument about whether the median can bear weight.",
          },
          {
            type: "paragraph",
            text: "Be careful with state borders around metropolitan areas. An institution on the edge of a market that spans a state line competes against institutions filed under a different state, and a strict in-state cut will exclude its closest competitors while including institutions several hours away. Where that applies, build the comparison from the metropolitan market and note that you departed from the state cut deliberately.",
          },
          {
            type: "paragraph",
            text: "Finally, treat state figures as a snapshot rather than a trend unless you have the history to support one. Fee schedules are republished at irregular intervals, so a state median moving between two reads may reflect which institutions happened to update rather than any change in the market. Trend claims need a consistent panel, not two cross-sections.",
          },
        ],
      },
    ],
  },

  {
    ...base,
    slug: "charter-and-institution-type",
    title: "Charter & Institution Type",
    seoTitle: "Bank vs Credit Union Fee Benchmarking: Separating Charter from Scale",
    description:
      "How much of the bank versus credit union fee gap is charter and how much is size — and why the distinction changes what you do about it.",
    primaryCategory: "nsf",
    relatedCategories: ["overdraft", "wire_domestic_outgoing"],
    family: "Benchmarking Method",
    featured: true,
    relatedSlugs: ["building-a-peer-set", "reading-your-state"],
    sections: [
      {
        id: "the-headline-gap",
        heading: "The headline gap, and why it is not the finding",
        blocks: [
          {
            type: "paragraph",
            text: "Credit unions price consumer fees below banks across most categories. That much is consistent, well documented, and not in dispute.",
          },
          {
            type: "paragraph",
            text: "It is also close to useless as a benchmark, because the two populations differ in size as well as charter. Credit unions skew smaller. Banks include institutions orders of magnitude larger than any credit union. A raw charter comparison is measuring scale and charter simultaneously and reporting the sum as though it were one effect.",
          },
          {
            type: "comparison",
            category: "nsf",
            dimension: "charter",
            caption: "NSF fee by charter type — before controlling for scale",
          },
        ],
      },
      {
        id: "controlling-for-scale",
        heading: "Controlling for scale",
        blocks: [
          {
            type: "paragraph",
            text: "Cut the same fee by asset tier and the picture changes. Much of the apparent charter effect is a size effect wearing a charter's clothes.",
          },
          {
            type: "comparison",
            category: "nsf",
            dimension: "asset_tier",
            caption: "The same fee by asset tier — how much of the gap is scale",
          },
          {
            type: "paragraph",
            text: "The practical method is to hold asset tier constant and compare charter within it. A $500m credit union against $500m banks is a comparison that answers the charter question. The same credit union against all banks answers a question nobody asked.",
          },
          {
            type: "callout",
            tone: "tip",
            text: "Where a genuine charter effect survives the scale control, it is worth reporting precisely because it survived. That is a finding. The raw gap is not.",
          },
        ],
      },
      {
        id: "where-the-gap-is-widest",
        heading: "Where the gap is widest",
        blocks: [
          {
            type: "paragraph",
            text: "The charter difference is not uniform across fee categories, and the pattern is informative.",
          },
          {
            type: "list",
            items: [
              "Punitive fees — overdraft at a {{overdraft.median}} national median, NSF at {{nsf.median}} — show the widest and most persistent gaps, and are also where fee elimination has moved fastest.",
              "Transactional service fees such as outgoing wires, national median {{wire_domestic_outgoing.median}}, show a narrower but consistent gap.",
              "Fees tied to a hard external cost track much closer between charters, because the underlying cost does not care about the charter.",
            ],
          },
          {
            type: "paragraph",
            text: "That distribution is itself the useful output. Where the gap is wide, pricing is discretionary and competitive positioning is in play. Where it is narrow, there is less room to move regardless of charter.",
          },
        ],
      },
      {
        id: "using-it",
        heading: "Using it",
        blocks: [
          {
            type: "paragraph",
            text: "For a credit union, the relevant comparison is other credit unions at a similar scale in a similar market. Comparing favourably against all banks is not a finding; it is an artefact of the population.",
          },
          {
            type: "paragraph",
            text: "For a bank competing directly against credit unions in its market, the charter gap is a real competitive fact rather than a methodological artefact — but it should be measured against the credit unions that actually operate in the market, not the national credit union population.",
          },
          {
            type: "paragraph",
            text: "In both cases the instruction is the same: state the constraint set. A comparison whose population is described precisely can be argued with on the merits. One whose population is implicit will be argued about instead.",
          },
          {
            type: "paragraph",
            text: "There is a further distinction worth holding onto. Credit unions and banks are not simply two pricing strategies applied to the same business; they differ in ownership, tax treatment and statutory purpose, and those differences flow into fee schedules for reasons that are structural rather than competitive. A credit union pricing below a comparable bank is not necessarily undercutting it, and a bank cannot always follow.",
          },
          {
            type: "paragraph",
            text: "That matters for what you do with the finding. A gap driven by structure is a fact to plan around — it tells you where you will lose a straight price comparison and where you need to compete on something other than price. A gap driven by a pricing decision is a gap you can close. Presenting the two as though they were the same thing produces recommendations that cannot be executed.",
          },
          {
            type: "paragraph",
            text: "Within institution type there is also more variation than the headline suggests. The spread among credit unions on a single fee is frequently wider than the gap between the credit union and bank medians, which means the charter tells you less about a specific institution than a well-built peer set does. Use charter to frame the comparison, never as a substitute for one.",
          },
        ],
      },
    ],
  },
];
