import { metricDefinition } from "./metrics";
import type { ResearchSnapshot } from "./types";

/** Shared by HTML, PDF and exported data. No renderer recomputes a statistic. */
export function researchExhibits(snapshot: ResearchSnapshot) {
  return snapshot.cells.map(cell => {
    const definition = metricDefinition(cell.key);
    const value = cell.value === null ? "Unavailable" : new Intl.NumberFormat("en-US", {
      style: definition.unit === "dollars" ? "currency" : "decimal", currency: "USD",
      maximumFractionDigits: ["percent", "ratio"].includes(definition.unit) ? 2 : 0,
    }).format(cell.value) + (definition.unit === "percent" ? "%" : definition.unit === "ratio" ? "×" : "");
    return { ...cell, label: definition.label, module: definition.module, formatted: value, definition: definition.definition };
  });
}

export function researchDestination(snapshot: ResearchSnapshot, reportId: string): string {
  const params = new URLSearchParams({ researchReport: reportId, intent: "market-research", evidencePolicy: "verified-only" });
  if (snapshot.request.institutionId) params.set("instId", String(snapshot.request.institutionId));
  return `/pro/reports/research?${params}`;
}

const escape = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Stored artifact; public HTML uses the same exhibits, PDF uses the same frozen snapshot. */
export function renderResearchHtml(snapshot: ResearchSnapshot, title: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title><style>body{font:16px/1.6 system-ui;max-width:1100px;margin:40px auto;padding:0 20px;color:#172b3b}table{border-collapse:collapse;width:100%}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}h1,h2{text-wrap:balance}@media print{tr{break-inside:avoid}}</style></head><body><p>Fee Insight Research</p><h1>${escape(title)}</h1><p>Evidence captured ${escape(snapshot.capturedAt)}. Verified-only fee benchmarks.</p><table><thead><tr><th>Measure</th><th>Population</th><th>Value</th><th>Period</th><th>Coverage</th></tr></thead><tbody>${researchExhibits(snapshot).map(c => `<tr><td>${escape(c.label)}</td><td>${escape(c.cohort)}</td><td>${escape(c.formatted)}</td><td>${escape(c.period ?? "Unavailable")}</td><td>${c.observed}/${c.eligible} · ${c.status}</td></tr><tr><td colspan="5">${escape(c.definition)} ${escape(c.note)} ${c.sourceUrls.map(u => `<a href="${escape(u)}">Source</a>`).join(" ")}</td></tr>`).join("")}</tbody></table><h2>Methodology and limitations</h2><ul>${snapshot.limitations.map(l => `<li>${escape(l)}</li>`).join("")}</ul><p>Method ${snapshot.metricVersion}. Snapshot ${escape(snapshot.snapshotHash)}.</p></body></html>`;
}
