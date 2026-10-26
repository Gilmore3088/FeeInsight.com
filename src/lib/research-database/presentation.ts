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
    return { ...cell, label: definition.label, cohortLabel: cohortLabel(cell.cohort), module: definition.module, formatted: value, definition: definition.definition,
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title><style>body{font:16px/1.6 system-ui;max-width:1100px;margin:40px auto;padding:0 20px;color:#172b3b}table{border-collapse:collapse;width:100%}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}h1,h2{text-wrap:balance}@media print{tr{break-inside:avoid}}</style></head><body><p>Fee Insight Research</p><h1>${escape(title)}</h1><p>Evidence captured ${escape(snapshot.capturedAt)}. Verified-only fee benchmarks.</p><h2>Key findings</h2><ul>${researchHighlights(snapshot).map(f => `<li>${escape(f)}</li>`).join("")}</ul><table><thead><tr><th>Measure</th><th>Population</th><th>Value</th><th>Period</th><th>Coverage</th></tr></thead><tbody>${researchExhibits(snapshot).map(c => `<tr><td>${escape(c.label)}</td><td>${escape(c.cohortLabel)}</td><td>${escape(c.formatted)}</td><td>${escape(c.period ?? "Unavailable")}</td><td>${escape(c.coverageLabel)} · ${c.status}</td></tr><tr><td colspan="5">${escape(c.definition)} ${escape(c.note)} ${c.sourceUrls.map(u => `<a href="${escape(u)}">Source</a>`).join(" ")}</td></tr>`).join("")}</tbody></table><h2>Methodology and limitations</h2><ul>${snapshot.limitations.map(l => `<li>${escape(l)}</li>`).join("")}</ul><p>Method ${snapshot.metricVersion}. Snapshot ${escape(snapshot.snapshotHash)}.</p></body></html>`;
}
