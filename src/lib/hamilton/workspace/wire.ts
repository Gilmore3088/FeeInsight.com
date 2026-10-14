/**
 * The Regulatory Wire in Hamilton's regulation answers (#1090): recent federal rules from the
 * bank's own federal regulator and the CFPB, fee bills in its state, consumer-law enforcement
 * actions by its federal regulator or in its state, and its state regulator's fee posts. Each
 * line carries the item's date and a link to it. Pure and client-safe: the loader in ./research
 * reads the rows the Magellan registry steps store; nothing here infers a rule or a stance.
 */

import { topicsBearOn } from "@/lib/regulatory/fee-topics";
import { STATE_NAMES } from "@/lib/us-states";
import type { Fact } from "./types";

/** Federal rules published, open for comment or taking effect within this many days. */
export const WIRE_RULE_DAYS = 365;
/** State bills with an action in the last two years: a legislature's two-year session. */
export const WIRE_BILL_DAYS = 730;
/** Enforcement actions that began within this many years. */
export const WIRE_ACTION_YEARS = 3;
/** State regulator posts from the last year. */
export const WIRE_POST_DAYS = 365;
/** Lines kept of each kind, so one kind never crowds out the others. */
const PER_KIND = 3;

/** The agencies the federal tracker follows, as reg_tracker_items.agencies names them. */
const TRACKED_AGENCIES = new Set(["CFPB", "OCC", "FDIC", "Federal Reserve", "NCUA"]);
/** Enforcement list codes for the federal regulators whose orders are loaded. */
const ENFORCEMENT_CODE: Record<string, string> = { OCC: "OCC", "Federal Reserve": "FRB" };

/** The Fact tables a Wire line comes from; reg_articles also holds the federal releases. */
export const WIRE_TABLES: ReadonlySet<string> = new Set(["reg_tracker_items", "institution_enforcement_actions", "reg_articles"]);

export function isWireFact(fact: Fact): boolean {
  return WIRE_TABLES.has(fact.source.table ?? "");
}

export interface WireRuleRow {
  kind: string;
  title: string;
  agencies: string[];
  topics: string[];
  published_on: string | null;
  comments_close_on: string | null;
  effective_on: string | null;
  url: string | null;
}

export interface WireBillRow {
  state_code: string;
  identifier: string | null;
  title: string;
  /** The stage in plain words ("In committee"). */
  stage_label: string | null;
  stage_on: string | null;
  topics: string[];
  url: string | null;
}

/** An action whose agency subject names consumer law (the loader keeps only those). */
export interface WireActionRow {
  /** "OCC", "FRB" or "STATE_XX". */
  agency: string;
  /** The agency in words ("OCC", "Federal Reserve", a state department). */
  agency_label: string;
  party_name: string;
  party_state: string | null;
  action_type: string | null;
  start_date: string | null;
  url: string | null;
}

/** A state regulator's own post whose headline is about bank or credit union fees. */
export interface WirePostRow {
  state_code: string;
  agency: string;
  title: string;
  link: string;
  published_at: string | null;
}

export interface WireRows {
  rules: WireRuleRow[];
  bills: WireBillRow[];
  actions: WireActionRow[];
}

export interface WireScope {
  feeCategory: string;
  stateCode: string | null | undefined;
  /** "OCC", "FDIC", "Federal Reserve", "NCUA" or "State" (institution_sources.primary_regulator). */
  primaryRegulator: string | null | undefined;
  today: Date;
}

function day(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const isoDaysAgo = (today: Date, days: number) => new Date(today.getTime() - days * 86_400_000).toISOString().slice(0, 10);

/** A title in the source's own words; double quotes inside it become single. */
const quoted = (title: string) => `"${title.trim().replace(/"/g, "'")}"`;

function andList(items: string[]): string {
  return items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function ruleFacts(rules: WireRuleRow[], scope: WireScope): Fact[] {
  const today = scope.today.toISOString().slice(0, 10);
  const since = isoDaysAgo(scope.today, WIRE_RULE_DAYS);
  const watched = new Set(["CFPB", ...(scope.primaryRegulator && TRACKED_AGENCIES.has(scope.primaryRegulator) ? [scope.primaryRegulator] : [])]);
  return rules
    .filter((r) => r.url && r.published_on && (r.kind === "final_rule" || r.kind === "proposed_rule"))
    .filter((r) => r.agencies.some((a) => watched.has(a)) && topicsBearOn(r.topics, scope.feeCategory))
    .filter((r) => r.published_on! >= since || (r.comments_close_on ?? "") >= today || (r.effective_on ?? "") >= since)
    .sort((a, b) => b.published_on!.localeCompare(a.published_on!))
    .slice(0, PER_KIND)
    .map((r) => {
      const agencies = r.agencies.filter((a) => TRACKED_AGENCIES.has(a));
      const kind = r.kind === "final_rule" ? "final rule" : "proposed rule";
      const dates = [
        `published ${day(r.published_on!)}`,
        r.comments_close_on && r.comments_close_on >= today ? `comments close ${day(r.comments_close_on)}` : null,
        r.effective_on ? `${r.effective_on > today ? "takes effect" : "effective"} ${day(r.effective_on)}` : null,
      ].filter(Boolean);
      return {
        text: `${andList(agencies)} ${kind} ${quoted(r.title)}, ${dates.join(", ")}.`,
        source: { label: "Federal Register", table: "reg_tracker_items", url: r.url!, asOf: r.published_on },
      };
    });
}

function billFacts(bills: WireBillRow[], scope: WireScope): Fact[] {
  const state = scope.stateCode?.toUpperCase();
  if (!state) return [];
  const since = isoDaysAgo(scope.today, WIRE_BILL_DAYS);
  const name = STATE_NAMES[state] ?? state;
  return bills
    .filter((b) => b.state_code.toUpperCase() === state && b.url && b.stage_on && b.stage_on >= since)
    .filter((b) => topicsBearOn(b.topics, scope.feeCategory))
    .sort((a, b) => b.stage_on!.localeCompare(a.stage_on!))
    .slice(0, PER_KIND)
    .map((b) => {
      const stage = b.stage_label ? `${b.stage_label.toLowerCase()}, last action` : "last action";
      return {
        text: `${name} bill ${b.identifier ? `${b.identifier} ` : ""}${quoted(b.title)}: ${stage} ${day(b.stage_on!)}.`,
        source: { label: `${name} legislature, via Open States`, table: "reg_tracker_items", url: b.url!, asOf: b.stage_on },
      };
    });
}

function actionFacts(actions: WireActionRow[], scope: WireScope): Fact[] {
  const state = scope.stateCode?.toUpperCase() ?? null;
  const federal = scope.primaryRegulator ? ENFORCEMENT_CODE[scope.primaryRegulator] ?? null : null;
  const since = new Date(scope.today);
  since.setUTCFullYear(since.getUTCFullYear() - WIRE_ACTION_YEARS);
  const from = since.toISOString().slice(0, 10);
  return actions
    .filter((a) => a.url && a.start_date && a.start_date >= from)
    .filter((a) => (federal !== null && a.agency === federal) || (state !== null && a.party_state?.toUpperCase() === state))
    .sort((a, b) => b.start_date!.localeCompare(a.start_date!))
    .slice(0, PER_KIND)
    .map((a) => ({
      text: `${a.agency_label} ${a.action_type ? `${quoted(a.action_type)} ` : "action "}against ${quoted(a.party_name)}${a.party_state ? ` (${a.party_state.toUpperCase()})` : ""}, ${day(a.start_date!)}; its subjects include consumer law.`,
      source: { label: `${a.agency_label} enforcement actions`, table: "institution_enforcement_actions", url: a.url!, asOf: a.start_date },
    }));
}

/**
 * The Wire's rules, bills and enforcement actions for one fee and one bank, newest first within
 * each kind and taken in turn (a rule, a bill, an action, then the next of each), so the first
 * three lines show one of each kind the Wire holds.
 */
export function wireFacts(rows: WireRows, scope: WireScope): Fact[] {
  const kinds = [ruleFacts(rows.rules, scope), billFacts(rows.bills, scope), actionFacts(rows.actions, scope)];
  const out: Fact[] = [];
  for (let i = 0; i < PER_KIND; i++) for (const kind of kinds) if (kind[i]) out.push(kind[i]);
  return out;
}

/** The state regulator's own fee posts in the last year, newest first. */
export function statePostFacts(posts: WirePostRow[], scope: Pick<WireScope, "stateCode" | "today">, limit = 2): Fact[] {
  const state = scope.stateCode?.toUpperCase();
  if (!state) return [];
  const since = isoDaysAgo(scope.today, WIRE_POST_DAYS);
  return posts
    .filter((p) => p.state_code.toUpperCase() === state && p.link && p.published_at && p.published_at.slice(0, 10) >= since)
    .sort((a, b) => b.published_at!.localeCompare(a.published_at!))
    .slice(0, limit)
    .map((p) => {
      const asOf = p.published_at!.slice(0, 10);
      return {
        text: `${p.agency} post ${quoted(p.title)}, ${day(asOf)}.`,
        source: { label: `${p.agency} release`, table: "reg_articles", url: p.link, asOf },
      };
    });
}
