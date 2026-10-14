/**
 * The weekly Regulatory Wire digest: a reader's watched states plus the federal agencies,
 * the last 7 days, grouped by jurisdiction and kind, each item with its fee-type tags and,
 * where stage 2 wrote one, its AI summary (labelled as such). Pure: the page
 * (/pro/news/digest) and the Monday Pro digest step build it from rows they read.
 *
 * Nothing here sends anything. The page says the digest is not emailed yet; the Monday step
 * only adds this as a section to an email it would already send, behind PRO_EMAILS_ENABLED.
 */

import type { StateWireItem } from "@/lib/data-store/state-news";
import { STATE_NAMES } from "@/lib/us-states";
import { billProgress, formatWireDate } from "./wire";
import { FEE_TYPE_LABELS, feeTypesOf, type FeeType } from "./wire-fee-types";
import { researchKey, type ResearchNote } from "./wire-research";

export const DIGEST_DAYS = 7;
/** Most items one section lists in the email; the page lists them all. */
export const DIGEST_EMAIL_ITEMS_PER_SECTION = 5;

export type DigestGroupKind = "bills" | "regulators" | "press" | "federal";

export interface DigestItem {
  kind: "bill" | "regulator" | "press" | "federal";
  title: string;
  url: string | null;
  /** ISO time or day: publication, or a bill's latest action. */
  date: string | null;
  feeTypes: FeeType[];
  /** The AI summary from reg_wire_research, when one was written and passed its checks. */
  summary: string | null;
  /** Bills: number and stage in words. */
  identifier?: string | null;
  stage?: string | null;
  /** Press: the outlet. Federal: the agency code (FED, FDIC, OCC, CFPB). */
  publisher?: string | null;
  source?: string | null;
}

export interface DigestGroup {
  kind: DigestGroupKind;
  label: string;
  items: DigestItem[];
}

export interface DigestSection {
  /** A state code, or "federal". */
  jurisdiction: string;
  name: string;
  total: number;
  groups: DigestGroup[];
}

export interface WireDigest {
  /** Start of the window (ISO), 7 days before `until`. */
  since: string;
  until: string;
  states: string[];
  sections: DigestSection[];
  /** Items across every section. */
  total: number;
  /** Items that carry an AI summary. */
  summaries: number;
}

export interface FederalDigestRow {
  guid: string;
  source: string;
  title: string;
  link: string;
  published_at: string | null;
  created_at?: string | null;
}

const STATE_GROUPS: { kind: Exclude<DigestGroupKind, "federal">; label: string }[] = [
  { kind: "bills", label: "Legislation" },
  { kind: "regulators", label: "Regulators" },
  { kind: "press", label: "Press" },
];

const AGENCY_ORDER = ["FED", "FDIC", "OCC", "CFPB"];
const AGENCY_NAMES: Record<string, string> = {
  FED: "Federal Reserve",
  FDIC: "FDIC",
  OCC: "OCC",
  CFPB: "CFPB",
};

function time(value: string | null): number {
  if (!value) return NaN;
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value).getTime();
}

function inWindow(date: string | null, since: number, until: number): boolean {
  const t = time(date);
  return Number.isFinite(t) && t >= since && t <= until;
}

function newestFirst(a: DigestItem, b: DigestItem): number {
  return (time(b.date) || 0) - (time(a.date) || 0) || a.title.localeCompare(b.title);
}

function okSummary(note: ResearchNote | undefined): string | null {
  return note && note.status === "ok" && note.summary ? note.summary : null;
}

function stateItem(item: StateWireItem, notes: ReadonlyMap<string, ResearchNote>): DigestItem {
  if (item.kind === "bill") {
    return {
      kind: "bill",
      title: item.title,
      url: item.url,
      date: item.stage_on ?? item.introduced_on,
      feeTypes: feeTypesOf(item.title),
      summary: item.tracker_id ? okSummary(notes.get(researchKey("tracker", item.tracker_id))) : null,
      identifier: item.identifier,
      stage: billProgress(item.stage).label,
    };
  }
  if (item.kind === "regulator") {
    return {
      kind: "regulator",
      title: item.title,
      url: item.link,
      date: item.published_at,
      feeTypes: feeTypesOf(item.title),
      summary: item.guid ? okSummary(notes.get(researchKey("article", item.guid))) : null,
    };
  }
  // Press stories are never summarised.
  return {
    kind: "press",
    title: item.headline,
    url: item.link,
    date: item.published_at,
    feeTypes: feeTypesOf(item.headline),
    summary: null,
    publisher: item.publisher,
  };
}

const GROUP_OF: Record<StateWireItem["kind"], Exclude<DigestGroupKind, "federal">> = {
  bill: "bills",
  regulator: "regulators",
  press: "press",
};

/**
 * Groups the week's items: one section per watched state (alphabetical, empty ones kept so
 * the reader sees "nothing new"), then the federal agencies. Items outside the 7-day window
 * or without a date are left out; each group is newest first.
 */
export function buildWireDigest(input: {
  states: readonly string[];
  stateItems: readonly StateWireItem[];
  federal: readonly FederalDigestRow[];
  notes?: ReadonlyMap<string, ResearchNote>;
  now: Date;
  days?: number;
}): WireDigest {
  const until = input.now.getTime();
  const since = until - (input.days ?? DIGEST_DAYS) * 24 * 60 * 60 * 1000;
  const notes = input.notes ?? new Map<string, ResearchNote>();
  const states = [...new Set(input.states.map((s) => s.toUpperCase()))].sort();

  const sections: DigestSection[] = states.map((code) => {
    const mine = input.stateItems.filter((item) => item.state_code.toUpperCase() === code);
    const groups = STATE_GROUPS.map(({ kind, label }) => ({
      kind,
      label,
      items: mine
        .filter((item) => GROUP_OF[item.kind] === kind)
        .map((item) => stateItem(item, notes))
        .filter((item) => inWindow(item.date, since, until))
        .sort(newestFirst),
    })).filter((group) => group.items.length > 0);
    return {
      jurisdiction: code,
      name: STATE_NAMES[code] ?? code,
      total: groups.reduce((n, g) => n + g.items.length, 0),
      groups,
    };
  });

  const federalItems: DigestItem[] = input.federal
    .map((row) => ({
      kind: "federal" as const,
      title: row.title,
      url: row.link,
      date: row.published_at ?? row.created_at ?? null,
      feeTypes: feeTypesOf(row.title),
      summary: okSummary(notes.get(researchKey("article", row.guid))),
      source: row.source,
    }))
    .filter((item) => inWindow(item.date, since, until));
  const agencies = [...new Set(federalItems.map((i) => i.source ?? ""))].sort(
    (a, b) => (AGENCY_ORDER.indexOf(a) + 1 || 99) - (AGENCY_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b),
  );
  const federalGroups: DigestGroup[] = agencies.map((agency) => ({
    kind: "federal",
    label: AGENCY_NAMES[agency] ?? agency,
    items: federalItems.filter((i) => (i.source ?? "") === agency).sort(newestFirst),
  }));
  sections.push({ jurisdiction: "federal", name: "Federal agencies", total: federalItems.length, groups: federalGroups });

  const all = sections.flatMap((s) => s.groups.flatMap((g) => g.items));
  return {
    since: new Date(since).toISOString(),
    until: new Date(until).toISOString(),
    states,
    sections,
    total: all.length,
    summaries: all.filter((i) => i.summary).length,
  };
}

/** True when any section has an item. */
export function wireDigestHasItems(digest: WireDigest | null | undefined): boolean {
  return Boolean(digest && digest.total > 0);
}

function day(value: string | null): string {
  return formatWireDate(value, new Date(0))?.absolute ?? "date not given";
}

/**
 * The digest as plain lines for the Monday Pro digest email (its renderer turns lines into
 * text and HTML). At most DIGEST_EMAIL_ITEMS_PER_SECTION items per section, then a link.
 */
export function wireDigestLines(digest: WireDigest, site: string): string[] {
  const base = site.replace(/\/$/, "");
  const lines: string[] = [`Regulatory Wire: ${day(digest.since)} to ${day(digest.until)}`];
  for (const section of digest.sections) {
    if (section.total === 0) {
      lines.push(`${section.name}: nothing new this week.`);
      continue;
    }
    lines.push(`${section.name}: ${section.total} item(s)`);
    const items = section.groups.flatMap((g) => g.items.map((item) => ({ group: g.label, item })));
    for (const { group, item } of items.slice(0, DIGEST_EMAIL_ITEMS_PER_SECTION)) {
      const tags = item.feeTypes.length ? ` [${item.feeTypes.map((f) => FEE_TYPE_LABELS[f]).join(", ")}]` : "";
      const number = item.identifier ? `${item.identifier}: ` : "";
      lines.push(`${group} · ${day(item.date)} · ${number}${item.title}${tags}`);
      if (item.summary) lines.push(`AI summary of the source text: ${item.summary}`);
    }
    const more = section.total - DIGEST_EMAIL_ITEMS_PER_SECTION;
    if (more > 0) lines.push(`and ${more} more: ${base}/pro/news/digest`);
  }
  lines.push("Summaries are written by an AI model from each item's own text and can be wrong; the source is what counts.");
  return lines;
}
