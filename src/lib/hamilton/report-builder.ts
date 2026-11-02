/**
 * The Reports builder (Hamilton dashboard redesign, Nov 2026): a fee report put together from the
 * sections a banker ticks, in the order they set, drawn page by page on screen and printed page for
 * page in the PDF. Pure and client-safe: no read, no write, no model call.
 *
 * The content comes from the pricing committee packet (buildCommitteePacket, read on the server by
 * loadCommitteePacket), so every figure is one the committee brief already prints: published fees
 * from published_fee_catalog against the packet's peer group (a median needs MIN_PEERS_FOR_POSITION
 * peers; fewer shows the spread and says too few), filed service charge income, and peer changes the
 * peers' own schedules bear out. Nothing here estimates a figure.
 *
 * buildReportDocument paginates once. The screen preview and the PDF (ReportBuilderPdf) both draw
 * its pages, one PDF page per preview page, so the export matches what the banker saw.
 */
import type { CommitteePacket, PacketFeeBar } from "./committee-packet";
import { readerAsOf } from "./brief-exhibits";

export const BUILDER_SECTION_KEYS = ["summary", "findings", "above", "fees", "trend", "changes", "sources"] as const;
export type BuilderSectionKey = (typeof BUILDER_SECTION_KEYS)[number];
export type BuilderPreset = "board" | "committee";
export type BuilderAudience = "board" | "committee";
export type BuilderPeriod = "4" | "8" | "all";
export type BuilderPageSize = "LETTER" | "A4";

export const BUILDER_SECTIONS: Record<BuilderSectionKey, { name: string; hint: string }> = {
  summary: { name: "Fee position summary", hint: "Above, within or below the peer range" },
  findings: { name: "What to resolve first", hint: "The largest differences and a next step" },
  above: { name: "Fees above the range", hint: "Largest gap to the median first" },
  fees: { name: "Every fee against peers", hint: "Your price, the median and the middle half" },
  trend: { name: "Service charge income", hint: "By quarter, from call reports" },
  changes: { name: "Peer fee changes", hint: "Confirmed on each peer's own schedule" },
  sources: { name: "Sources", hint: "Where every figure comes from" },
};

export const BUILDER_PRESETS: Record<BuilderPreset, { name: string; blurb: string; sections: BuilderSectionKey[]; audience: BuilderAudience }> = {
  board: {
    name: "Board summary",
    blurb: "Where your fees sit, in plain terms.",
    sections: ["summary", "above", "trend", "sources"],
    audience: "board",
  },
  committee: {
    name: "Committee fee review",
    blurb: "Every fee against peers, with what moved.",
    sections: ["summary", "findings", "above", "fees", "changes", "trend", "sources"],
    audience: "committee",
  },
};

export interface BuilderLayout {
  preset: BuilderPreset;
  /** Every section, in the order the banker set. */
  order: BuilderSectionKey[];
  /** The sections ticked on. */
  on: BuilderSectionKey[];
  audience: BuilderAudience;
  period: BuilderPeriod;
  pageSize: BuilderPageSize;
}

/** A preset's starting layout: its sections first and on, the rest after them and off. */
export function presetLayout(preset: BuilderPreset, over: Partial<Pick<BuilderLayout, "period" | "pageSize">> = {}): BuilderLayout {
  const def = BUILDER_PRESETS[preset];
  return {
    preset,
    order: [...def.sections, ...BUILDER_SECTION_KEYS.filter((k) => !def.sections.includes(k))],
    on: [...def.sections],
    audience: def.audience,
    period: over.period ?? "4",
    pageSize: over.pageSize ?? "LETTER",
  };
}

/** The sections that print, in order. */
export function activeSections(layout: BuilderLayout): BuilderSectionKey[] {
  return layout.order.filter((k) => layout.on.includes(k));
}

/** "board:board:4:LETTER:summary,above,-findings,..." — a link or a PDF request carries the layout as this. */
export function encodeBuilderLayout(layout: BuilderLayout): string {
  const secs = layout.order.map((k) => (layout.on.includes(k) ? k : `-${k}`)).join(",");
  return [layout.preset, layout.audience, layout.period, layout.pageSize, secs].join(":");
}

const isKey = (v: string): v is BuilderSectionKey => (BUILDER_SECTION_KEYS as readonly string[]).includes(v);

/** The layout a link or request carries; anything malformed falls back to the board preset. */
export function parseBuilderLayout(raw: unknown): BuilderLayout {
  if (typeof raw !== "string" || raw.length > 300) return presetLayout("board");
  const [preset, audience, period, pageSize, secs = ""] = raw.split(":");
  if (preset !== "board" && preset !== "committee") return presetLayout("board");
  const base = presetLayout(preset);
  const order: BuilderSectionKey[] = [];
  const on: BuilderSectionKey[] = [];
  for (const token of secs.split(",")) {
    const key = token.startsWith("-") ? token.slice(1) : token;
    if (!isKey(key) || order.includes(key)) continue;
    order.push(key);
    if (!token.startsWith("-")) on.push(key);
  }
  for (const key of BUILDER_SECTION_KEYS) if (!order.includes(key)) order.push(key);
  return {
    preset,
    order: order.length ? order : base.order,
    on: secs ? on : base.on,
    audience: audience === "committee" || audience === "board" ? audience : base.audience,
    period: period === "8" || period === "all" ? period : "4",
    pageSize: pageSize === "A4" ? "A4" : "LETTER",
  };
}

// ─── Builder data: the slice of the committee packet the builder draws ───────────────────────

export interface BuilderData {
  institutionId: number;
  institutionName: string;
  generatedAt: string;
  peerGroupLabel: string;
  glance: { published: number; placed: number; above: number; within: number; below: number };
  conclusion: string;
  findings: { fee: string; statement: string; evidence: string; caveats: string[] }[];
  unresolvedCount: number;
  nextStep: { action: string; rationale: string } | null;
  bars: Pick<PacketFeeBar, "feeCategory" | "name" | "current" | "ownRange" | "median" | "q1" | "q3" | "low" | "high" | "peers" | "band" | "comparedWith">[];
  income: { quarters: string[]; own: number[]; peer: (number | null)[]; peerLabel: string | null } | null;
  incomeSummary: string | null;
  changes: { since: string; rows: { who: string; fee: string; change: string; when: string }[] } | null;
  changesEmpty: string;
  sourceCount: number;
  firstSources: string[];
}

/** Footnote marks ("[1, 6]") point into the committee brief's numbered sources; the builder states sources in words instead. */
export function withoutMarks(text: string): string {
  return text
    .replace(/\s*\[\d+(?:, \d+)*\]/g, "")
    .replace(/\s+\./g, ".")
    // The appendices live in the full committee brief, not in this report.
    .replace(/\b(?:in )?Appendix ([A-E])\b/g, "in the pricing committee brief's Appendix $1")
    .trim();
}

/** The builder's slice of a committee packet: plain, serialisable, small enough to hand a client. */
export function builderData(packet: CommitteePacket): BuilderData {
  const changes = packet.position.changes;
  const changeRows = changes
    ? changes.rows
        .filter((row) => row.length >= 4)
        .map((row) => ({ who: withoutMarks(row[0]), fee: withoutMarks(row[1]), change: withoutMarks(row[2]), when: withoutMarks(row[3]) }))
    : [];
  const since = changes?.title.replace(/^What moved since\s*/, "") ?? "";
  return {
    institutionId: packet.institutionId,
    institutionName: packet.institutionName,
    generatedAt: packet.generatedAt,
    peerGroupLabel: packet.peerGroupLabel,
    glance: { published: packet.glance.published, placed: packet.glance.placed, above: packet.glance.above, within: packet.glance.within, below: packet.glance.below },
    conclusion: withoutMarks(packet.brief.conclusion),
    findings: packet.brief.findings.map((f) => ({ fee: f.fee, statement: withoutMarks(f.statement), evidence: withoutMarks(f.evidence), caveats: f.caveats.map(withoutMarks) })),
    unresolvedCount: packet.brief.unresolved.length,
    nextStep: packet.brief.nextStep ? { action: withoutMarks(packet.brief.nextStep.action), rationale: withoutMarks(packet.brief.nextStep.rationale) } : null,
    bars: packet.position.bars.map((b) => ({ feeCategory: b.feeCategory, name: b.name, current: b.current, ownRange: b.ownRange, median: b.median, q1: b.q1, q3: b.q3, low: b.low, high: b.high, peers: b.peers, band: b.band, comparedWith: b.comparedWith })),
    income: packet.financial.series && packet.financial.series.quarters.length >= 2 ? { ...packet.financial.series } : null,
    incomeSummary: packet.financial.trendSummary ? withoutMarks(packet.financial.trendSummary) : null,
    changes: changeRows.length ? { since, rows: changeRows } : null,
    changesEmpty: packet.position.comparedNote
      ? withoutMarks(packet.position.comparedNote)
      : "No peer has a confirmed change to these fees since the last quarter began. A peer whose schedule has been read only once has nothing to compare, so this does not show that peer fees held steady.",
    sourceCount: packet.footnotes.length,
    firstSources: packet.footnotes.slice(0, 2).map((f) => withoutMarks(`${f.label}, ${f.detail}.`)),
  };
}

// ─── The document: sections as drawn, paginated once ──────────────────────────────────────────

/** A fee: "$35", "$7.95". */
export function builderMoney(value: number): string {
  return Number.isInteger(value) ? `$${value.toLocaleString("en-US")}` : `$${value.toFixed(2)}`;
}

/** Whole dollars of income: "$4.2M", "$812K". */
export function builderDollars(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${Math.round(value / 1e3).toLocaleString("en-US")}K`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** "2026-Q2" (the packet's quarter key) to "Q2 2026". */
export function builderQuarter(key: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  return m ? `Q${m[2]} ${m[1]}` : key;
}

export type BuilderPosition = "above" | "in_range" | "below" | "too_few" | "not_single" | "not_published";

export interface BuilderFeeRow {
  name: string;
  yours: string;
  median: string;
  range: string;
  peers: number;
  position: BuilderPosition;
  /** For the range plot: the peers' spread, middle half, median and the subject's price. */
  plot: { low: number; high: number; q1: number | null; q3: number | null; median: number | null; yours: number | null } | null;
  /** "+$5.50 vs median". */
  gap: string | null;
}

export type BuilderSectionView =
  | { key: "summary"; counts: { above: number; within: number; below: number }; placed: number; published: number; conclusion: string }
  | { key: "findings"; items: BuilderData["findings"]; nextStep: BuilderData["nextStep"]; unresolvedCount: number; empty: string | null }
  | { key: "above"; rows: BuilderFeeRow[]; more: number; empty: string | null }
  | { key: "fees"; rows: BuilderFeeRow[]; more: number; tooFew: number }
  | { key: "trend"; quarters: string[]; own: number[]; peer: (number | null)[]; peerLabel: string | null; headline: string; empty: string | null }
  | { key: "changes"; since: string; rows: NonNullable<BuilderData["changes"]>["rows"]; more: number; empty: string | null }
  | { key: "sources"; lines: string[] };

export interface BuilderPageSection {
  n: number;
  title: string;
  view: BuilderSectionView;
}

export interface BuilderPage {
  number: number;
  sections: BuilderPageSection[];
}

export interface BuilderDocument {
  title: string;
  institutionName: string;
  preparedFor: string;
  peerGroupLabel: string;
  readOn: string;
  pageSize: BuilderPageSize;
  pages: BuilderPage[];
  pageCount: number;
  sectionCount: number;
  feesCompared: number;
  aboveCount: number;
}

/** Page geometry in PDF points, shared by the preview (1 CSS px per point) and the PDF. */
export const BUILDER_PAGE = {
  LETTER: { width: 612, height: 792 },
  A4: { width: 595, height: 842 },
  marginX: 48,
  marginTop: 48,
  marginBottom: 64,
  coverHeight: 96,
  sectionGap: 16,
} as const;

/** Rows each audience sees: a board gets the short list, a committee the whole one. */
const LIMITS: Record<BuilderAudience, { above: number; fees: number; findings: number; changes: number }> = {
  board: { above: 4, fees: 6, findings: 2, changes: 4 },
  committee: { above: 10, fees: 10, findings: 3, changes: 8 },
};

function position(bar: BuilderData["bars"][number]): BuilderPosition {
  if (bar.current === null) return bar.ownRange ? "not_single" : "not_published";
  if (bar.median === null || bar.q1 === null || bar.q3 === null) return "too_few";
  if (bar.band === "above") return "above";
  if (bar.band === "below") return "below";
  return "in_range";
}

function feeRow(bar: BuilderData["bars"][number]): BuilderFeeRow {
  const pos = position(bar);
  const placed = pos === "above" || pos === "below" || pos === "in_range";
  const gapValue = placed && bar.current !== null && bar.median !== null ? bar.current - bar.median : null;
  const spread = bar.low !== null && bar.high !== null ? `${builderMoney(bar.low)} to ${builderMoney(bar.high)}` : "None publish it";
  return {
    name: bar.name,
    yours: bar.current !== null ? builderMoney(bar.current) : bar.ownRange ?? "Not published",
    median: placed && bar.median !== null ? builderMoney(bar.median) : "—",
    range: placed && bar.q1 !== null && bar.q3 !== null ? `${builderMoney(bar.q1)} to ${builderMoney(bar.q3)}` : spread,
    peers: bar.peers,
    position: pos,
    plot: bar.low !== null && bar.high !== null
      ? { low: Math.min(bar.low, bar.current ?? bar.low), high: Math.max(bar.high, bar.current ?? bar.high), q1: placed ? bar.q1 : null, q3: placed ? bar.q3 : null, median: placed ? bar.median : null, yours: bar.current }
      : null,
    gap: gapValue === null ? null : `${gapValue >= 0 ? "+" : "-"}${builderMoney(Math.abs(Math.round(gapValue * 100) / 100))} vs median`,
  };
}

function periodWindow<T>(values: T[], period: BuilderPeriod): T[] {
  return period === "all" ? values : values.slice(-Number(period));
}

function pctChange(from: number, to: number): string {
  const pct = ((to - from) / from) * 100;
  return `${pct >= 0 ? "up" : "down"} ${Math.abs(pct).toFixed(1)}%`;
}

function trendView(data: BuilderData, period: BuilderPeriod): BuilderSectionView {
  const income = data.income;
  if (!income) {
    return { key: "trend", quarters: [], own: [], peer: [], peerLabel: null, headline: "", empty: "No filed quarters of service charge income are on file for this institution yet." };
  }
  const quarters = periodWindow(income.quarters, period);
  const own = periodWindow(income.own, period);
  const peer = periodWindow(income.peer, period);
  const total = own.reduce((a, b) => a + b, 0);
  const first = quarters[0];
  const last = quarters[quarters.length - 1];
  let headline: string;
  if (period === "4" && data.incomeSummary) headline = data.incomeSummary;
  else if (own.length >= 2 && own[0] > 0) headline = `${builderDollars(total)} over ${own.length} quarters, ${builderQuarter(first)} to ${builderQuarter(last)}. The latest quarter is ${pctChange(own[0], own[own.length - 1])} on ${builderQuarter(first)}.`;
  else headline = `${builderDollars(total)} over ${own.length} ${own.length === 1 ? "quarter" : "quarters"} to ${builderQuarter(last)}.`;
  return { key: "trend", quarters: quarters.map(builderQuarter), own, peer, peerLabel: income.peerLabel, headline, empty: null };
}

function sourcesLines(data: BuilderData, sections: BuilderSectionKey[]): string[] {
  const lines = [...data.firstSources];
  lines.push(`Peer group: ${data.peerGroupLabel}. A median, middle half or percentile needs at least 10 peers; with fewer, only the spread is shown.`);
  lines.push("Fees are live published fees, each verified against the institution's own schedule. Fees stated as a rate are left out.");
  if (sections.includes("trend")) lines.push("Service charge income: FDIC call reports and NCUA 5300 reports as filed. It is the whole institution's income, not any one fee's.");
  if (sections.includes("changes")) lines.push("A peer's change is listed only when its own earlier and later schedules both bear it out.");
  if (data.sourceCount > 2) lines.push(`The pricing committee brief numbers all ${data.sourceCount} sources behind these figures.`);
  return lines;
}

function view(key: BuilderSectionKey, data: BuilderData, layout: BuilderLayout, sections: BuilderSectionKey[]): BuilderSectionView {
  const limit = LIMITS[layout.audience];
  switch (key) {
    case "summary":
      return { key, counts: { above: data.glance.above, within: data.glance.within, below: data.glance.below }, placed: data.glance.placed, published: data.glance.published, conclusion: data.conclusion };
    case "findings":
      return {
        key,
        items: data.findings.slice(0, limit.findings),
        nextStep: data.nextStep,
        unresolvedCount: data.unresolvedCount,
        empty: data.findings.length === 0 ? "No fee that compares like for like sits outside the peers' middle half." : null,
      };
    case "above": {
      const rows = data.bars
        .filter((b) => position(b) === "above")
        .sort((a, b) => ((b.current! - b.median!) / b.median!) - ((a.current! - a.median!) / a.median!))
        .map(feeRow);
      return { key, rows: rows.slice(0, limit.above), more: Math.max(0, rows.length - limit.above), empty: rows.length ? null : "No fee sits above the middle half of this peer group." };
    }
    case "fees": {
      const rows = data.bars.map(feeRow);
      return { key, rows: rows.slice(0, limit.fees), more: Math.max(0, rows.length - limit.fees), tooFew: rows.filter((r) => r.position === "too_few").length };
    }
    case "trend":
      return trendView(data, layout.period);
    case "changes": {
      const rows = data.changes?.rows ?? [];
      return { key, since: data.changes?.since ?? "", rows: rows.slice(0, limit.changes), more: Math.max(0, rows.length - limit.changes), empty: rows.length ? null : data.changesEmpty };
    }
    case "sources":
      return { key, lines: sourcesLines(data, sections) };
  }
}

/** Characters per printed line at the body size, kept low so an estimate never runs short. */
const CHARS = 88;
const lines = (text: string, chars = CHARS) => Math.max(1, Math.ceil(text.length / chars));

/** A section's printed height in points, over- rather than under-estimated, so a page never overflows. */
export function sectionHeight(v: BuilderSectionView): number {
  const head = 28;
  switch (v.key) {
    case "summary":
      return head + 100 + lines(v.conclusion) * 14 + 6;
    case "findings":
      return head
        + (v.empty ? 16 : 0)
        + v.items.reduce((h, f) => h + 18 + lines(f.statement) * 13 + lines(f.evidence, 100) * 12 + f.caveats.reduce((c, t) => c + lines(t, 100) * 12, 0) + 8, 0)
        + (v.nextStep ? 20 + lines(v.nextStep.action) * 13 + lines(v.nextStep.rationale, 100) * 12 : 0)
        + (v.unresolvedCount ? 16 : 0);
    case "above":
      return head + 18 + (v.empty ? 16 : v.rows.length * 26) + (v.more ? 14 : 0) + 14;
    case "fees":
      return head + 20 + v.rows.reduce((h, r) => h + (r.name.length > 26 || r.yours.length > 12 ? 28 : 18), 0) + (v.more ? 14 : 0) + 14;
    case "trend":
      return head + (v.empty ? 16 : lines(v.headline) * 14 + 126 + 16);
    case "changes":
      return head + (v.empty ? lines(v.empty, 100) * 12 : 20 + v.rows.reduce((h, r) => h + Math.max(lines(r.who, 30), lines(r.change, 26)) * 12 + 8, 0) + (v.more ? 14 : 0));
    case "sources":
      return head + v.lines.reduce((h, l) => h + lines(l, 100) * 12 + 4, 0);
  }
}

/** The report as drawn: its sections in order, split into pages that each fit the page size. */
export function buildReportDocument(data: BuilderData, layout: BuilderLayout): BuilderDocument {
  const sections = activeSections(layout);
  const size = BUILDER_PAGE[layout.pageSize];
  const body = size.height - BUILDER_PAGE.marginTop - BUILDER_PAGE.marginBottom;
  const pages: BuilderPage[] = [];
  let current: BuilderPageSection[] = [];
  let used: number = BUILDER_PAGE.coverHeight;
  sections.forEach((key, i) => {
    const v = view(key, data, layout, sections);
    const cost = sectionHeight(v) + BUILDER_PAGE.sectionGap;
    if (current.length > 0 && used + cost > body) {
      pages.push({ number: pages.length + 1, sections: current });
      current = [];
      used = 0;
    }
    current.push({ n: i + 1, title: BUILDER_SECTIONS[key].name, view: v });
    used += cost;
  });
  pages.push({ number: pages.length + 1, sections: current });
  return {
    title: BUILDER_PRESETS[layout.preset].name,
    institutionName: data.institutionName,
    preparedFor: layout.audience === "board" ? "Prepared for the board of directors" : "Prepared for the pricing committee",
    peerGroupLabel: data.peerGroupLabel,
    readOn: readerAsOf(data.generatedAt),
    pageSize: layout.pageSize,
    pages,
    pageCount: pages.length,
    sectionCount: sections.length,
    feesCompared: data.glance.placed,
    aboveCount: data.glance.above,
  };
}

/** Status of a saved report, from what it holds: a team note or an edited section marks it edited. */
export type SavedReportStatus = "as_written" | "edited";

export function savedReportStatus(report: { report_type: string; report_json: unknown }): SavedReportStatus {
  const json = (report.report_json ?? {}) as {
    boardBrief?: { teamNote?: string };
    monthlyBriefing?: { sections?: { draft?: string; text?: string }[] };
  };
  if (json.boardBrief?.teamNote?.trim()) return "edited";
  if (json.monthlyBriefing?.sections?.some((s) => typeof s.text === "string" && s.text !== s.draft)) return "edited";
  return "as_written";
}

export const SAVED_STATUS_LABEL: Record<SavedReportStatus, string> = { as_written: "As written", edited: "Edited" };
