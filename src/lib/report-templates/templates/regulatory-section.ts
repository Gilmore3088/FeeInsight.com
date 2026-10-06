/**
 * "Regulation and Complaints" chapter shared by the national and state reports.
 * Renders only what the regulatory context holds; an empty part says so plainly.
 */

import { chapterDivider, compactTable, pageBreak, statCardRow, keyFinding } from "../index";
import type { StatCard } from "../index";
import type { RegulatoryContext, RegulatoryRelease } from "@/lib/report-assemblers/regulatory-context";

const SUBHEAD_STYLE =
  "font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #7A7062; margin: 28px 0 10px 0;";
const LIST_STYLE = "font-size: 13px; line-height: 1.6; color: #1A1815; margin: 0; padding-left: 18px;";
const EMPTY_STYLE = "font-size: 13px; color: #7A7062; font-style: italic; margin: 0;";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function releaseList(releases: RegulatoryRelease[], emptyText: string): string {
  if (releases.length === 0) return `<p style="${EMPTY_STYLE}">${escapeHtml(emptyText)}</p>`;
  const items = releases
    .map(
      (r) =>
        `<li style="margin-bottom: 6px;"><strong>${escapeHtml(r.source)}</strong>${r.publishedAt ? ` · ${r.publishedAt}` : ""} — <a href="${escapeHtml(r.link)}">${escapeHtml(r.title)}</a></li>`,
    )
    .join("\n");
  return `<ul style="${LIST_STYLE}">${items}</ul>`;
}

function complaintCards(ctx: RegulatoryContext, place: string): string {
  const c = ctx.complaints;
  if (!c) return `<p style="${EMPTY_STYLE}">No CFPB complaint records are on file for ${escapeHtml(place)}.</p>`;
  const change =
    c.priorTotal && c.priorTotal > 0 ? ((c.total - c.priorTotal) / c.priorTotal) * 100 : null;
  const cards: StatCard[] = [
    {
      label: `CFPB complaints, ${c.latestYear}`,
      value: c.total.toLocaleString("en-US"),
      delta: change === null ? undefined : `${change > 0 ? "+" : ""}${change.toFixed(0)}% vs ${c.priorYear}`,
      deltaColor: change === null ? undefined : change > 0 ? "negative" : "positive",
      source: `${c.institutionCount.toLocaleString("en-US")} institutions named`,
    },
    {
      label: "Fee and account issues",
      value: c.total > 0 ? `${((c.feeRelated / c.total) * 100).toFixed(0)}%` : "-",
      source: `${c.feeRelated.toLocaleString("en-US")} complaints on low funds, fees or account management`,
    },
  ];
  const institutions =
    c.topInstitutions.length > 0
      ? compactTable({
          caption: `Most-complained-about institutions in ${place}, ${c.latestYear}`,
          columns: [
            { key: "name", label: "Institution", align: "left" },
            { key: "complaints", label: "Complaints", align: "right", format: "integer" },
          ],
          rows: c.topInstitutions.map((i) => ({ name: i.name, complaints: i.complaints })),
        })
      : "";
  const products =
    c.topProducts.length > 0
      ? `<p style="font-size: 12px; color: #7A7062; margin: 8px 0 0 0;">Top products: ${c.topProducts
          .map((p) => `${escapeHtml(p.product)} (${p.count.toLocaleString("en-US")})`)
          .join(", ")}.</p>`
      : "";
  return [statCardRow(cards), products, institutions].join("\n");
}

export function renderRegulatorySection(
  ctx: RegulatoryContext,
  options: { number: string; place: string },
): string {
  const { number, place } = options;
  const rules = ctx.rules
    .map((r) => `<li style="margin-bottom: 6px;">${escapeHtml(r.text)} <em>(${escapeHtml(r.source.label)})</em></li>`)
    .join("\n");

  return [
    pageBreak(),
    chapterDivider(number, "Regulation and Complaints"),
    ctx.beigeBook
      ? keyFinding(`${ctx.beigeBook.text} (Beige Book, ${ctx.beigeBook.releaseDate})`, "Regional economy")
      : "",
    `<h4 style="${SUBHEAD_STYLE}">Fee-related regulator releases, last ${ctx.windowDays} days</h4>`,
    releaseList(ctx.feeReleases, `No Federal Reserve, FDIC, OCC or CFPB release in the last ${ctx.windowDays} days names fees, overdraft, NSF, Reg E or Reg DD.`),
    `<h4 style="${SUBHEAD_STYLE}">Enforcement actions and settlements</h4>`,
    releaseList(ctx.enforcement, `No enforcement action, consent order or penalty release in the last ${ctx.windowDays} days.`),
    `<h4 style="${SUBHEAD_STYLE}">Consumer complaints (CFPB)</h4>`,
    complaintCards(ctx, place),
    `<h4 style="${SUBHEAD_STYLE}">Rules that apply when a penalty fee changes</h4>`,
    `<ul style="${LIST_STYLE}">${rules}</ul>`,
  ]
    .filter(Boolean)
    .join("\n");
}
