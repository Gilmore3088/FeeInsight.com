/**
 * The shared report structure as HTML strings, for reports rendered outside React (state
 * reports, PDFs printed from HTML) and for SVG built by exhibit functions. The React
 * components in src/components/report-design render the same structure and class names.
 *
 * A report is: eyebrow, title, deck, a row of headline figures, then numbered exhibits.
 * An exhibit is: label ("Exhibit 2 · Fees"), a headline that states what the data shows, an
 * optional sub-line, a legend, one or two chart panels (or a table), an optional plain notice
 * when data is missing, and a source line.
 */
import { RD } from "./tokens";

export interface RdHero {
  figure: string;
  /** Small unit after the figure, e.g. "B" in $8.0B. */
  unit?: string;
  label: string;
  note?: string;
}

export type RdMark = "dot" | "ring" | "bar" | "band" | "line" | "tick";

export interface RdLegendItem {
  label: string;
  color?: string;
  mark?: RdMark;
}

export interface RdPanel {
  heading?: string;
  /** Trusted HTML (chart SVG built from escaped data, or an rd-table). */
  html: string;
}

export interface RdExhibit {
  key: string;
  label: string;
  title: string;
  sub?: string | null;
  legend?: RdLegendItem[];
  panels?: RdPanel[];
  /** Plain words shown when the data for the exhibit is not there. */
  notice?: string | null;
  source: string;
  /** A long exhibit (a ladder of many rows) that may continue onto the next printed page. */
  flow?: boolean;
}

export interface RdDocument {
  eyebrow: string;
  title: string;
  deck?: string | null;
  heroes: RdHero[];
  exhibits: RdExhibit[];
}

export function rdEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A legend key as inline SVG, so it prints and matches the chart marks. */
export function rdMarkSvg(mark: RdMark = "dot", color: string = RD.ink): string {
  const c = rdEscape(color);
  switch (mark) {
    case "ring":
      return `<svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="#fff" stroke="${c}" stroke-width="1.8"/></svg>`;
    case "bar":
      return `<svg width="16" height="12" aria-hidden="true"><rect x="0" y="2" width="16" height="8" fill="${c}"/></svg>`;
    case "band":
      return `<svg width="20" height="12" aria-hidden="true"><rect x="0" y="1" width="20" height="10" rx="2" fill="${c}"/></svg>`;
    case "line":
      return `<svg width="20" height="12" aria-hidden="true"><line x1="0" y1="6" x2="20" y2="6" stroke="${c}" stroke-width="2.4"/></svg>`;
    case "tick":
      return `<svg width="10" height="14" aria-hidden="true"><line x1="5" y1="1" x2="5" y2="13" stroke="${c}" stroke-width="2.4"/></svg>`;
    default:
      return `<svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5.5" fill="${c}"/></svg>`;
  }
}

export function rdLegend(items: RdLegendItem[]): string {
  if (items.length === 0) return "";
  return `<div class="rd-legend">${items
    .map((i) => `<span>${i.color || i.mark ? rdMarkSvg(i.mark, i.color) : ""}${rdEscape(i.label)}</span>`)
    .join("")}</div>`;
}

/** A chart drawn wide (report, desktop, print) and narrow (phone). */
export function rdResponsive(wide: string | null, narrow: string | null): string | null {
  if (!wide) return null;
  return narrow ? `<div class="sc-wide">${wide}</div><div class="sc-narrow">${narrow}</div>` : wide;
}

export function rdHeroes(heroes: RdHero[]): string {
  if (heroes.length === 0) return "";
  return `<div class="rd-heroes">${heroes
    .map(
      (h) =>
        `<div class="rd-hero"><div class="rd-hero-fig">${rdEscape(h.figure)}${h.unit ? `<small>${rdEscape(h.unit)}</small>` : ""}</div><div class="rd-hero-lab">${rdEscape(h.label)}</div>${h.note ? `<div class="rd-hero-note">${rdEscape(h.note)}</div>` : ""}</div>`,
    )
    .join("")}</div>`;
}

export function rdExhibit(ex: RdExhibit): string {
  const panels = ex.panels ?? [];
  const body =
    panels.length === 0
      ? ""
      : `<div class="${panels.length > 1 ? "rd-pair" : "rd-one"}">${panels
          .map((p) => `<div class="rd-panel">${p.heading ? `<h3 class="rd-panel-title">${rdEscape(p.heading)}</h3>` : ""}${p.html}</div>`)
          .join("")}</div>`;
  return `<section class="rd-exhibit${ex.flow ? " rd-flow" : ""}" id="rd-${rdEscape(ex.key)}"><div class="rd-label">${rdEscape(ex.label)}</div><h2>${rdEscape(ex.title)}</h2>${
    ex.sub ? `<p class="rd-sub">${rdEscape(ex.sub)}</p>` : ""
  }${ex.legend ? rdLegend(ex.legend) : ""}${body}${ex.notice ? `<p class="rd-notice">${rdEscape(ex.notice)}</p>` : ""}<div class="rd-source">${rdEscape(ex.source)}</div></section>`;
}

/** Header (eyebrow, title, deck, headline figures) as HTML. */
export function rdHeader(doc: Pick<RdDocument, "eyebrow" | "title" | "deck" | "heroes">): string {
  return `<header class="rd-cover"><div class="rd-eyebrow">${rdEscape(doc.eyebrow)}</div><h1 class="rd-title">${rdEscape(doc.title)}</h1>${
    doc.deck ? `<p class="rd-deck">${rdEscape(doc.deck)}</p>` : ""
  }${rdHeroes(doc.heroes)}</header>`;
}

/** A whole report body, wrapped in `.rd` (the stylesheet is injected separately). */
export function rdDocument(doc: RdDocument): string {
  return `<div class="rd">${rdHeader(doc)}${doc.exhibits.map(rdExhibit).join("")}</div>`;
}

/** Numbers exhibits in order: "Exhibit 1 · Footprint". */
export function rdExhibitLabel(n: number, topic: string): string {
  return `Exhibit ${n} · ${topic}`;
}
