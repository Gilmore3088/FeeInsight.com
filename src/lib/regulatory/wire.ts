/**
 * The Regulatory Wire's shared controls: one set of URL search params drives both the
 * Federal and the States view (search, time range, page), so switching views keeps the
 * reader's window and search. Pure: no database, no React, safe to unit test.
 */

import { parseFeeType, type FeeType } from "./wire-fee-types";

export const WIRE_PAGE_SIZE = 25;
export const WIRE_QUERY_MAX = 120;

export type WireView = "federal" | "states";
export type WireRange = "today" | "week" | "month" | "year" | "all";
/** The States view's kind filter. Absent means every kind. */
export type WireKind = "bills" | "regulators" | "press";

export const WIRE_RANGES: { key: WireRange; label: string; title: string }[] = [
  { key: "today", label: "Today", title: "Since 00:00 UTC today" },
  { key: "week", label: "7 days", title: "The last 7 days" },
  { key: "month", label: "30 days", title: "The last 30 days" },
  { key: "year", label: "12 months", title: "The last 12 months" },
  { key: "all", label: "All", title: "Everything stored" },
];

/** Both views open on the last twelve months; some state news pages list posts going back years. */
export const DEFAULT_WIRE_RANGE: WireRange = "year";

export const WIRE_KINDS: { key: WireKind | null; label: string }[] = [
  { key: null, label: "All" },
  { key: "bills", label: "Legislation" },
  { key: "regulators", label: "Regulators" },
  { key: "press", label: "Press" },
];

export interface WireParams {
  view: WireView;
  range: WireRange;
  /** Case-insensitive title search; "" when none. */
  q: string;
  page: number;
  /** Federal view: agency (FED, FDIC, OCC, CFPB) and topic. */
  source?: string;
  topic?: string;
  /** States view: two-letter state code and kind. */
  state?: string;
  kind?: WireKind;
  /** States view: the reader's watched states ("state=mine"). */
  mine?: boolean;
  /**
   * States view: every state, chosen on purpose ("state=all"). Kept in links so a reader who
   * watches states and picked All states is not sent back to My states.
   */
  allStates?: boolean;
  /** Both views: fee-type tag from the headline (wire-fee-types). */
  fee?: FeeType;
}

type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
}

export function parseRange(value: string | undefined): WireRange {
  return WIRE_RANGES.some((r) => r.key === value) ? (value as WireRange) : DEFAULT_WIRE_RANGE;
}

export function parseQuery(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, WIRE_QUERY_MAX);
}

export function parsePage(value: string | undefined): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 10_000) : 1;
}

export function parseKind(value: string | undefined): WireKind | undefined {
  return value === "bills" || value === "regulators" || value === "press" ? value : undefined;
}

/** Reads the page's search params; `isState` says whether a code is a real state. */
export function parseWireParams(raw: RawParams, isState: (code: string) => boolean): WireParams {
  const view: WireView = one(raw.view) === "states" ? "states" : "federal";
  const stateCode = (one(raw.state) ?? "").toUpperCase();
  const mine = stateCode === "MINE";
  const allStates = stateCode === "ALL";
  return {
    view,
    range: parseRange(one(raw.range)),
    q: parseQuery(one(raw.q)),
    page: parsePage(one(raw.page)),
    source: one(raw.source) || undefined,
    topic: one(raw.topic) || undefined,
    state: stateCode && isState(stateCode) ? stateCode : undefined,
    kind: parseKind(one(raw.kind)),
    fee: parseFeeType(one(raw.fee)),
    ...(mine ? { mine: true } : {}),
    ...(allStates ? { allStates: true } : {}),
  };
}

/**
 * Whether the States view opens on My states: asked for ("state=mine"), or the reader
 * watches states and the link named no jurisdiction at all.
 */
export function opensOnMyStates(params: WireParams, watchedCount: number): boolean {
  if (params.view !== "states" || watchedCount === 0) return false;
  if (params.mine) return true;
  return !params.state && !params.allStates;
}

/** The window's start as an ISO timestamp, or null for "all". "Today" is since midnight UTC. */
export function rangeSince(range: WireRange, now: Date): string | null {
  const day = 24 * 60 * 60 * 1000;
  switch (range) {
    case "today":
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    case "week":
      return new Date(now.getTime() - 7 * day).toISOString();
    case "month":
      return new Date(now.getTime() - 30 * day).toISOString();
    case "year":
      return new Date(now.getTime() - 365 * day).toISOString();
    default:
      return null;
  }
}

/** Plain words for the window, used after a count: "… in the last 7 days". */
export function rangePhrase(range: WireRange, now: Date): string {
  switch (range) {
    case "today":
      return `since 00:00 UTC on ${formatDay(now)}`;
    case "week":
      return "in the last 7 days";
    case "month":
      return "in the last 30 days";
    case "year":
      return "in the last 12 months";
    default:
      return "in everything stored";
  }
}

export interface PageWindow {
  /** The page shown, clamped to the last page. */
  page: number;
  pageCount: number;
  offset: number;
  /** 1-based first and last item numbers shown; both 0 when there is nothing. */
  from: number;
  to: number;
  total: number;
}

export function pageWindow(page: number, total: number, size = WIRE_PAGE_SIZE): PageWindow {
  const safeTotal = Math.max(0, Math.floor(total));
  const pageCount = Math.max(1, Math.ceil(safeTotal / size));
  const shown = Math.min(Math.max(1, Math.floor(page)), pageCount);
  const offset = (shown - 1) * size;
  return {
    page: shown,
    pageCount,
    offset,
    from: safeTotal === 0 ? 0 : offset + 1,
    to: Math.min(offset + size, safeTotal),
    total: safeTotal,
  };
}

/** A LIKE/ILIKE pattern that matches `q` anywhere, with %, _ and \ taken literally. */
export function likePattern(q: string | null | undefined): string | null {
  const text = parseQuery(q ?? "");
  return text ? `%${text.replace(/[\\%_]/g, "\\$&")}%` : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDay(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function parseWhen(value: string): Date | null {
  // A bare day ("2026-10-01") is that day in UTC, not local midnight.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface WireDate {
  /** "Oct 7, 2026" (UTC day). */
  absolute: string;
  /** "today", "yesterday" or "3 days ago" within a week; null beyond that or in the future. */
  relative: string | null;
  /** For <time dateTime>: the UTC day. */
  iso: string;
}

export function formatWireDate(value: string | null | undefined, now: Date): WireDate | null {
  if (!value) return null;
  const d = parseWhen(value);
  if (!d) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const dayOf = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const days = Math.round((dayOf(now) - dayOf(d)) / dayMs);
  const relative = days === 0 ? "today" : days === 1 ? "yesterday" : days > 1 && days < 7 ? `${days} days ago` : null;
  return { absolute: formatDay(d), relative, iso: d.toISOString().slice(0, 10) };
}

/**
 * The /pro/news URL for these params with some changed. Defaults (federal view, the default
 * range, page 1, no search) are left out so links stay short. Changing anything but the page
 * should pass `page: 1`.
 */
export function wireHref(current: WireParams, change: Partial<WireParams> = {}): string {
  const p = { ...current, ...change };
  const search = new URLSearchParams();
  if (p.view === "states") {
    search.set("view", "states");
    if (p.state) search.set("state", p.state);
    else if (p.mine) search.set("state", "mine");
    else if (p.allStates) search.set("state", "all");
    if (p.kind) search.set("kind", p.kind);
  } else {
    if (p.source) search.set("source", p.source);
    if (p.topic) search.set("topic", p.topic);
  }
  if (p.fee) search.set("fee", p.fee);
  if (p.q) search.set("q", p.q);
  if (p.range !== DEFAULT_WIRE_RANGE) search.set("range", p.range);
  if (p.page > 1) search.set("page", String(p.page));
  const qs = search.toString();
  return qs ? `/pro/news?${qs}` : "/pro/news";
}

// ---------------------------------------------------------------------------
// Bill stage stepper
// ---------------------------------------------------------------------------

export const BILL_STEPS = ["Introduced", "Committee", "Passed a chamber", "Enacted"] as const;

export interface BillProgress {
  /** How many of BILL_STEPS the bill has reached (0 when the stage is unknown). */
  reached: 0 | 1 | 2 | 3 | 4;
  /** A bill that stopped: shown as an end state rather than a next step. */
  end: "vetoed" | "failed" | null;
  /** The stage in plain words. */
  label: string;
}

/** Maps an Open States stage (registry-state-bills) onto the four-step stepper. */
export function billProgress(stage: string | null | undefined): BillProgress {
  switch (stage) {
    case "introduced":
      return { reached: 1, end: null, label: "Introduced" };
    case "in_committee":
      return { reached: 2, end: null, label: "In committee" };
    case "passed_chamber":
      return { reached: 3, end: null, label: "Passed one chamber" };
    case "passed_legislature":
      return { reached: 3, end: null, label: "Passed the legislature" };
    case "signed":
      return { reached: 4, end: null, label: "Signed into law" };
    // A veto comes after both chambers pass it.
    case "vetoed":
      return { reached: 3, end: "vetoed", label: "Vetoed" };
    // Open States does not say how far a failed bill got; only its introduction is certain.
    case "failed":
      return { reached: 1, end: "failed", label: "Failed" };
    default:
      return { reached: 0, end: null, label: stage ? stage.replace(/_/g, " ") : "Stage not recorded" };
  }
}
