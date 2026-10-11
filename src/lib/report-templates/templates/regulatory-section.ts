/**
 * CFPB complaints, the fee-change rules and (for a state) its Fed district's Beige Book
 * line, shown in the reports' regulatory developments section. Agency releases are listed
 * by ./developments. Renders only what the regulatory context holds; an empty part says so.
 */

import { compactTable, escapeHtml, keyFinding, statCardRow } from "../primitives";
import type { StatCard } from "../primitives";
import type { RegulatoryContext } from "@/lib/report-assemblers/regulatory-context";

function subhead(text: string): string {
  return `<div class="release-group-title">${escapeHtml(text)}</div>`;
}

function empty(text: string): string {
  return `<p class="report-empty">${escapeHtml(text)}</p>`;
}

function complaints(ctx: RegulatoryContext, place: string): string {
  const c = ctx.complaints;
  if (!c) return empty(`No CFPB complaint records are on file for ${place}.`);
  // The yearly pull names a different set of institutions each year, so the change compares
  // only institutions named in both years.
  const same = c.sameInstitutions;
  const change = same && same.priorTotal > 0 ? ((same.total - same.priorTotal) / same.priorTotal) * 100 : null;
  const cards: StatCard[] = [
    {
      label: `CFPB complaints, ${c.latestYear}`,
      value: c.total.toLocaleString("en-US"),
      delta: change === null ? undefined : `${change > 0 ? "+" : ""}${change.toFixed(0)}% vs ${c.priorYear} at the same ${same?.institutions.toLocaleString("en-US")}`,
      deltaColor: change === null ? undefined : change > 0 ? "negative" : "positive",
      source: `against ${c.institutionCount.toLocaleString("en-US")} institutions we track`,
    },
    {
      label: "Fee and account issues",
      value: c.total > 0 ? `${((c.feeRelated / c.total) * 100).toFixed(0)}%` : "-",
      source: `${c.feeRelated.toLocaleString("en-US")} complaints on low funds, fees or account management`,
    },
  ];
  const products =
    c.topProducts.length > 0
      ? `<p class="release-note">Top products: ${c.topProducts
          .map((p) => `${escapeHtml(p.product)} (${p.count.toLocaleString("en-US")})`)
          .join(", ")}.</p>`
      : "";
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
  const coverage = `<p class="release-note">Counts cover only institutions we track that the CFPB names, for ${escapeHtml(c.latestYear)}, the latest full year on file${change === null ? "" : `. The change compares the ${same?.institutions.toLocaleString("en-US")} institutions named in both ${escapeHtml(String(c.priorYear))} and ${escapeHtml(c.latestYear)}`}.</p>`;
  return [statCardRow(cards), products, institutions, coverage].join("\n");
}

/** Complaints, fee-change rules and the Beige Book line, under small headings. */
export function regulatoryExtras(ctx: RegulatoryContext | null | undefined, place: string): string {
  if (!ctx) return "";
  const rules = ctx.rules
    .map((r) => `<li class="release-item"><span class="release-body">${escapeHtml(r.text)} <em>(${escapeHtml(r.source.label)})</em></span></li>`)
    .join("");
  return [
    ctx.beigeBook ? keyFinding(`${ctx.beigeBook.text} (Beige Book, ${ctx.beigeBook.releaseDate})`, "Regional economy") : "",
    `<div class="release-group">${subhead("Consumer complaints (CFPB)")}${complaints(ctx, place)}</div>`,
    rules ? `<div class="release-group">${subhead("Rules that apply when a penalty fee changes")}<ul class="release-list">${rules}</ul></div>` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
