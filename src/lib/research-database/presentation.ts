import { metricDefinition } from "./metrics";
import type { ResearchSnapshot } from "./types";
import { ASSET_TIER_RANGES } from "@/lib/peer-filter-words";

function cohortLabel(cohort: string) {
  const [charter, tier] = cohort.split(":");
  if (charter !== "bank" && charter !== "credit_union") return cohort;
  return `${charter === "bank" ? "Banks" : "Credit unions"}${tier ? ` · ${ASSET_TIER_RANGES[tier] ?? tier.replaceAll("_", " ")}` : ""}`;
}

/** Shared by HTML, PDF and exported data. No renderer recomputes a statistic. */
export function researchExhibits(snapshot: ResearchSnapshot) {
  return snapshot.cells.map(cell => {
    const definition = metricDefinition(cell.key);
    const value = cell.value === null ? "Unavailable" : new Intl.NumberFormat("en-US", {
      style: definition.unit === "dollars" ? "currency" : "decimal", currency: "USD",
      maximumFractionDigits: ["percent", "ratio"].includes(definition.unit) ? 2 : 0,
    }).format(cell.value) + (definition.unit === "percent" ? "%" : definition.unit === "ratio" ? "×" : "");
    const feeLabels: Record<string, string> = { "fee:overdraft": "Overdraft", "fee:nsf": "Non-sufficient funds (NSF)", "fee:monthly_maintenance": "Monthly maintenance", "fee:atm_non_network": "Out-of-network ATM", "fee:wire_domestic_outgoing": "Outgoing domestic wire" };
    return { ...cell, label: feeLabels[cell.key] ? `${feeLabels[cell.key]} benchmark` : definition.label, cohortLabel: cohortLabel(cell.cohort), module: definition.module, formatted: value, definition: definition.definition,
      coverageLabel: definition.module === "fees" ? `Counted sample: ${cell.observed}; institutions in scope: ${cell.eligible}` : `Coverage: ${cell.observed} / ${cell.eligible}` };
  });
}

/** Executive findings quote only saved figures and retain their period and sample. */
export function researchHighlights(snapshot: ResearchSnapshot): string[] {
  const cells = researchExhibits(snapshot);
  const highlights: string[] = [];
  const population = cells.find(c => c.key === "population" && c.value !== null);
  if (population) highlights.push(`Covered counties contain ${population.formatted} residents in the ${population.period} ACS five-year estimates.`);
  const performance = cells.filter(c => c.key === "asset_growth" && c.value !== null && (!snapshot.footprint || c.cohort.startsWith(`${snapshot.footprint.charter}:`))).sort((a,b) => b.observed-a.observed)[0];
  if (performance) highlights.push(`${performance.cohortLabel}: median annual asset growth was ${performance.formatted} at ${performance.period}, using ${performance.observed} matched filings.`);
  const fee = cells.find(c => c.key === "fee:monthly_maintenance" && c.value !== null) ?? cells.find(c => c.module === "fees" && c.value !== null);
  if (fee) highlights.push(`${fee.cohortLabel}: the observed ${fee.label} is ${fee.formatted}, from ${fee.observed} counted benchmark observations captured ${fee.period}.`);
  return highlights;
}

export function researchDestination(snapshot: ResearchSnapshot, reportId: string): string {
  const params = new URLSearchParams({ researchReport: reportId, intent: "market-research", evidencePolicy: "verified-only" });
  if (snapshot.request.institutionId) params.set("instId", String(snapshot.request.institutionId));
  return `/pro/reports/research?${params}`;
}

const escape = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Stored artifact; public HTML uses the same exhibits, PDF uses the same frozen snapshot. */
export function renderResearchHtml(snapshot: ResearchSnapshot, title: string): string {
  const cells = researchExhibits(snapshot);
  const maxFee = Math.max(1, ...cells.filter(c => c.module === "fees").map(c => c.value ?? 0));
  const date = new Date(snapshot.capturedAt).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const draft = title.startsWith("DRAFT:");
  const modules = [["market", "01", "The market in context"], ["fees", "02", "What the observed fees show"], ["performance", "03", "Institutional performance"]] as const;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>
  @font-face{font-family:Newsreader;src:url(https://feeinsight.com/fonts/newsreader-latin-500.woff2)}
  *{box-sizing:border-box}body{margin:0;background:#f3efe6;color:#132338;font:15px/1.6 Arial,sans-serif}main{max-width:1100px;margin:auto;background:#fbf9f4;padding:48px 64px}header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #132338;padding-bottom:24px}header img{width:180px} .badge{color:#b23a32;border:1px solid;padding:5px 10px;font-size:11px;letter-spacing:1px}.eyebrow{color:#b23a32;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-top:48px}h1,h2,h3{font-family:Newsreader,Georgia,serif;font-weight:500;text-wrap:balance}h1{font-size:58px;line-height:1.1;max-width:850px;margin:18px 0 24px}h2{font-size:38px;line-height:1.15;margin:10px 0 20px}h3{font-size:26px}.intro{font-size:19px;color:#55606f;max-width:720px}.findings{padding:0;list-style:none;counter-reset:findings}.findings li{counter-increment:findings;display:flex;gap:24px;padding:20px 0;border-bottom:1px solid #ddd5c6}.findings li:before{content:"0" counter(findings);font:28px Georgia;color:#b23a32}.callout{padding:20px 24px;background:#f3efe6;border-left:3px solid #b23a32;margin:28px 0;color:#55606f}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}thead{background:#132338;color:#f3efe6}th{text-align:left;font-weight:500;padding:14px}td{vertical-align:top;padding:16px 14px;border-bottom:1px solid #ddd5c6}.value{font-weight:700;font-size:18px;white-space:nowrap}.notes td{padding-top:0;font-size:12px;color:#55606f}.small{font-size:12px;color:#55606f}.bar{height:7px;background:#ebe5d9;margin-top:8px;min-width:80px}.bar span{height:100%;display:block;background:#132338}.cu .bar span{background:#b23a32}a{color:#7f2620;overflow-wrap:anywhere}section{margin-top:60px}footer{border-top:1px solid #132338;margin-top:48px;padding-top:20px;font-size:11px;color:#55606f;overflow-wrap:anywhere}.source-list li{margin-bottom:12px}@media(max-width:700px){main{padding:24px}h1{font-size:38px}h2{font-size:30px}header img{width:140px}td,th{padding:10px}.value{font-size:15px}}@media print{body{background:white}main{padding:0}section{break-before:page}tr{break-inside:avoid}h1,h2{break-after:avoid}}
  </style></head><body><main><header><img src="https://feeinsight.com/brand/fee-insight-oneline.svg" alt="Fee Insight"><span class="badge">${draft ? "EDITORIAL DRAFT" : "RESEARCH"}</span></header><p class="eyebrow">${snapshot.footprint ? "Local market research" : "National research"} / ${escape(date)}</p><h1>${escape(title.replace(/^DRAFT: /, ""))}</h1><p class="intro">Economic context, institutional performance and observed consumer fee benchmarks, with source periods and coverage attached.</p><div class="callout">${draft ? "Draft for editorial review. Not approved for public distribution. " : ""}Evidence captured ${escape(snapshot.capturedAt)}. Source reporting periods vary. Verified-only fee benchmarks.</div><h3>At a glance</h3><ol class="findings">${researchHighlights(snapshot).map(f => `<li>${escape(f)}</li>`).join("")}</ol>
  ${modules.map(([module, number, heading]) => `<section><p class="eyebrow">${number} / Research findings</p><h2>${heading}</h2>${module === "market" ? '<div class="callout">National indicators describe US conditions. County income medians remain separate. Branch deposits can include nonlocal or online balances booked at headquarters; they do not measure local household demand.</div>' : module === "fees" ? '<p class="small">Banks and credit unions remain separate. Bars use one dollar scale. Counted samples follow shared-schedule deduplication and are not a representative census. Unavailable measures are never estimated as zero.</p>' : '<p class="small">Comparable charter and asset-size cohorts; growth uses matched annual filings. Thin cohorts remain unavailable. Equity to assets is not a regulatory capital ratio.</p>'}<div class="table-wrap"><table><thead><tr><th>Measure / cohort</th><th>Value</th><th>Period</th><th>Sample / coverage</th></tr></thead><tbody>${cells.filter(c => c.module === module).map(c => `<tr class="${c.cohort.startsWith("credit_union") ? "cu" : ""}"><td>${escape(c.label)}<br><span class="small">${escape(c.cohortLabel)}</span></td><td class="value">${escape(c.formatted)}${module === "fees" && c.value !== null ? `<div class="bar"><span style="width:${100 * c.value / maxFee}%"></span></div>` : ""}</td><td>${escape(c.period ?? "Unavailable")}</td><td>${escape(c.coverageLabel)}<br><span class="small">${escape(c.status)}</span></td></tr><tr class="notes"><td colspan="4">${escape(c.definition)} ${escape(c.note)} ${c.sourceUrls.map(u => `<a href="${escape(u)}">${escape(new URL(u).hostname)}</a>`).join(" · ")}</td></tr>`).join("")}</tbody></table></div></section>`).join("")}
  <section><p class="eyebrow">04 / Methodology</p><h2>Method & evidence</h2><ol class="source-list">${snapshot.limitations.map(l => `<li>${escape(l)}</li>`).join("")}</ol></section><footer>FEE INSIGHT / ${escape(date)}${draft ? " / EDITORIAL DRAFT" : ""}<br>Method ${snapshot.metricVersion} · Fee-statistics method ${snapshot.feeStatsVersion}. Snapshot ${escape(snapshot.snapshotHash)}.</footer></main></body></html>`;
}
