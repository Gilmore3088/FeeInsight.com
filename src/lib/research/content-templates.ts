export interface ContentTemplate {
  id: string;
  name: string;
  category: string;
  prompt: string;
  params?: { name: string; placeholder: string }[];
}

export const CONTENT_TEMPLATES: ContentTemplate[] = [
  {
    id: "district-outlook",
    name: "District Fee Outlook",
    category: "analysis",
    prompt: "Write a 1000-word analysis of fee trends in Federal Reserve District {district}. Include: Beige Book economic context, district fee medians vs national, top fee categories by institution count, bank vs credit union comparison, and a 3-point strategic outlook. Use the district-economic-outlook methodology.",
    params: [{ name: "district", placeholder: "District number (1-12)" }],
  },
  {
    id: "category-deep-dive",
    name: "Category Deep Dive",
    category: "analysis",
    prompt: "Write a 1200-word deep dive on {category} fees. Include: national median and P25-P75 range, bank vs credit union comparison, top 5 states by institution count, asset tier breakdown, 5 cheapest and 5 most expensive institutions, and consumer impact analysis. Use the fee-benchmarking methodology.",
    params: [{ name: "category", placeholder: "Fee category (e.g., overdraft, nsf, monthly_maintenance)" }],
  },
  {
    id: "state-report",
    name: "State Fee Report",
    category: "report",
    prompt: "Write a 800-word fee landscape report for {state}. Include: total institutions and fee observations, top 5 fee categories by coverage, median comparisons to national benchmarks, bank vs credit union split, and key findings. Use the executive-report methodology.",
    params: [{ name: "state", placeholder: "State name (e.g., Texas, California)" }],
  },
  {
    id: "monthly-pulse",
    name: "Monthly Fee Pulse",
    category: "brief",
    prompt: "Write a 500-word monthly fee pulse report for the current period. Include: headline metric (total observations and institution count), top 3 fee categories by observation count with medians, one notable finding or outlier, a district spotlight for District {district}, and a looking-ahead section. Use the monthly-pulse methodology.",
    params: [{ name: "district", placeholder: "Spotlight district (1-12)" }],
  },
  {
    id: "charter-comparison",
    name: "Bank vs Credit Union Brief",
    category: "brief",
    prompt: "Write a 600-word competitive brief comparing bank and credit union fee structures. Include: overall median comparison across spotlight categories, which charter type charges more for each fee, asset tier interaction (do large CUs price differently than small banks?), and strategic implications for each charter type. Use the competitive-intelligence methodology.",
  },
  {
    id: "consumer-guide",
    name: "Consumer Fee Guide",
    category: "guide",
    prompt: "Write a 1000-word consumer guide about {topic}. Use plain language suitable for everyday banking customers. Include: what the fee is, how much it typically costs (median and range), who charges the most and least, 5 specific tips to avoid or reduce the fee, and what regulators say. Use the consumer-guide methodology.",
    params: [{ name: "topic", placeholder: "Fee topic (e.g., overdraft fees, wire transfer fees)" }],
  },
  {
    id: "peer-benchmark",
    name: "Peer Benchmarking Report",
    category: "report",
    prompt: "Write a 1500-word peer benchmarking report for {tier} {charter} institutions. Include: peer group definition, national vs peer medians across spotlight categories, fee positioning scorecard, revenue correlation insights from call reports, and 3 questions the data puts to management (never advice to raise, lower or drop a fee). Use the fee-benchmarking and executive-report methodologies.",
    params: [
      { name: "tier", placeholder: "Asset tier (e.g., micro, community, midsize, regional, mega)" },
      { name: "charter", placeholder: "Charter type (bank or credit_union)" },
    ],
  },
  {
    id: "data-quality",
    name: "Data Quality Report",
    category: "report",
    prompt: "Run a comprehensive data quality audit. Include: coverage funnel (total -> with fees -> approved), uncategorized fee count, null amount count, duplicate count, stale institution count, review status distribution, and top 5 remediation priorities. Use the data-quality-audit methodology.",
  },
];
