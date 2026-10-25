/**
 * The institution command center (#1891, Hamilton V5 plan P5, the CEO's "what changed"): the
 * landing for a workspace with a saved institution. Five questions, each answered in a line or two
 * from data Hamilton already holds, each linking into the page that backs it:
 *
 *   1. How is it doing?            the newest filed quarter            -> /pro/financials
 *   2. What changed?               filed quarter moves, own fee changes -> /pro/financials, /pro/monitor
 *   3. How does it compare?        fees against peers, local names     -> /pro/peers, /pro/research
 *   4. Market and regulation       confirmed state moves, rule items   -> /pro/monitor, /pro/news
 *   5. What to look at next        the briefing's first item, a brief  -> /pro/research, /pro/reports
 *
 * Pure and deterministic: no model call, no read. Rules it keeps:
 *   - an own fee figure that moved is a price change only when `withConfirmedPriceChanges` made it
 *     one (`own_price`); every other own-fee move is counted as a data update, never as a price move;
 *   - a fee is placed against peers only with a band (MIN_PEERS_FOR_POSITION peers or more), and a
 *     filed-income peer median only at FINANCIAL_PEER_MINIMUM filers; smaller groups are counted or named;
 *   - every figure carries its source and period, and the copy names the institution rather than
 *     calling it "yours" (the saved institution is a research preference, not ownership).
 */

import { buildAttentionItems, buildBriefingOverview } from "./briefing-observations";
import { hrefWithInstitutionContext } from "./context-link";
import { filedThousandsText, headlineSentence, quarterLabel as filedQuarterLabel, type FinancialPerformanceView } from "./financial-quarters";
import type { QuarterlyChanges } from "./briefing-snapshots";
import { RECORD_UPDATE_KINDS, nextQuarter, quarterLabel } from "./workspace/briefing-diff";
import { MIN_PEERS_FOR_POSITION } from "./workspace/scenario";
import type { Briefing } from "./workspace/types";

export type CommandCenterKey = "performance" | "change" | "peers" | "market" | "next";

export interface CommandCenterLink {
  label: string;
  href: string;
}

export interface CommandCenterAnswer {
  key: CommandCenterKey;
  question: string;
  /** One to three sentences; each number in them is covered by `source`. */
  lines: string[];
  /** Where the figures come from and their period; null when the answer states no figure. */
  source: string | null;
  links: CommandCenterLink[];
}

export interface CommandCenterInput {
  institution: { id: number; name: string };
  briefing: Briefing | null;
  financials: FinancialPerformanceView | null;
  changes: QuarterlyChanges | null;
  /** The institution's state by name, for the market line. */
  stateLabel: string | null;
  /** Days of confirmed state fee changes the briefing reads. */
  windowDays: number;
}

/** Local competitors named before the rest are counted. */
const NAMED_COMPETITORS = 3;

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

function signed(pct: number): string {
  return pct === 0 ? "unchanged" : `${pct > 0 ? "up" : "down"} ${Math.abs(pct).toFixed(1)}%`;
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function dayText(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function filingName(source: "fdic" | "ncua"): string {
  return source === "ncua" ? "NCUA 5300 call report" : "FDIC call report";
}

function latestFiled(view: FinancialPerformanceView | null) {
  return view?.quarters.find((q) => q.fee.value !== null) ?? null;
}

function performance(input: CommandCenterInput, link: (href: string) => string): CommandCenterAnswer {
  const { financials, institution } = input;
  const latest = latestFiled(financials);
  const headline = financials ? headlineSentence(financials) : null;
  const links = [{ label: "Financial performance", href: link("/pro/financials") }];
  if (!financials || !latest || !headline) {
    return {
      key: "performance",
      question: `How is ${institution.name} doing?`,
      lines: [`No filed quarter of fee income is on file for ${institution.name} yet, so its performance is not shown.`],
      source: null,
      links,
    };
  }
  const lines = [headline];
  if (latest.deposits.value !== null) {
    lines.push(`Deposits at the end of ${latest.label} were ${filedThousandsText(latest.deposits.value)}.`);
  }
  return {
    key: "performance",
    question: `How is ${institution.name} doing?`,
    lines,
    source: `${filingName(financials.source)}, ${latest.label}${latest.fee.peerMedian !== null ? `; the peer group is the other filers with the same charter and asset size` : ""}.`,
    links,
  };
}

function change(input: CommandCenterInput, link: (href: string) => string): CommandCenterAnswer {
  const { financials, changes, institution } = input;
  const lines: string[] = [];
  const sources: string[] = [];
  const latest = latestFiled(financials);
  if (financials && latest) {
    const moves: string[] = [];
    const noun = financials.source === "ncua" ? "fee income was" : "deposit service charges were";
    if (latest.fee.qoqPct !== null) moves.push(`${noun} ${signed(latest.fee.qoqPct)} on the quarter before`);
    if (latest.deposits.yoyPct !== null) moves.push(`deposits were ${signed(latest.deposits.yoyPct)} on a year earlier`);
    if (moves.length > 0) {
      lines.push(`In ${latest.label}, ${list(moves)}.`);
      sources.push(`${filingName(financials.source)}, ${latest.label}`);
    }
  }
  if (changes?.kind === "first") {
    lines.push(`Fee changes are listed from ${quarterLabel(nextQuarter(changes.quarter))}, once a second quarterly copy of this briefing is saved.`);
  } else if (changes?.kind === "diff") {
    const { diff } = changes;
    const from = quarterLabel(diff.fromQuarter);
    const priceChanges = diff.changes.filter((c) => c.kind === "own_price");
    const updates = diff.changes.filter((c) => RECORD_UPDATE_KINDS.has(c.kind));
    if (priceChanges.length > 0) {
      lines.push(`${plural(priceChanges.length, "confirmed price change", "confirmed price changes")} on its published schedules since ${from}. ${priceChanges[0].text}`);
    } else {
      lines.push(`No price change on its published schedules is confirmed since ${from}.`);
    }
    if (updates.length > 0) {
      lines.push(
        `${plural(updates.length, "fee figure", "fee figures")} on file changed without a confirmed price change; these are updates to our data, not price changes by ${institution.name}.`,
      );
    }
    sources.push(`briefings saved ${dayText(diff.fromGeneratedAt)} and ${dayText(diff.toGeneratedAt)}, checked against its published schedules`);
  }
  if (lines.length === 0) lines.push(`Nothing is on file yet to compare ${institution.name} with an earlier quarter.`);
  return {
    key: "change",
    question: "How has it changed?",
    lines,
    source: sources.length > 0 ? `${sources.join("; ")}.` : null,
    links: [
      { label: "Quarter by quarter", href: link("/pro/financials") },
      { label: "Alerts and watches", href: link("/pro/monitor") },
    ],
  };
}

function peers(input: CommandCenterInput, link: (href: string) => string): CommandCenterAnswer {
  const { briefing, institution } = input;
  const links = [
    { label: "Peers", href: link("/pro/peers") },
    { label: "Every fee against peers", href: link("/pro/research") },
  ];
  if (!briefing || briefing.positions.length === 0) {
    return {
      key: "peers",
      question: "How does it compare with real peers?",
      lines: [`Too few of ${institution.name}'s published fees are on file to compare with peers yet.`],
      source: null,
      links,
    };
  }
  const overview = buildBriefingOverview(briefing, input.stateLabel);
  const unplaced = briefing.positions.length - overview.feesCompared;
  const lines: string[] = [];
  if (overview.feesCompared > 0) {
    lines.push(
      `Of ${plural(overview.feesCompared, "fee", "fees")} compared with its peer group (${briefing.peerLabel}), ${overview.inLine} ${overview.inLine === 1 ? "sits" : "sit"} within the middle half of peer prices, ${overview.higher} above it and ${overview.lower} below.`,
    );
  }
  if (unplaced > 0) {
    lines.push(`${plural(unplaced, "fee is", "fees are")} not placed, as fewer than ${MIN_PEERS_FOR_POSITION} peers publish ${unplaced === 1 ? "it" : "them"}.`);
  }
  const competitors = (briefing.localMarket?.rows ?? []).filter((r) => !r.own).map((r) => r.name);
  if (competitors.length > 0) {
    const named = competitors.slice(0, NAMED_COMPETITORS);
    const rest = competitors.length - named.length;
    lines.push(`Local competitors on file: ${list(rest > 0 ? [...named, plural(rest, "other", "others")] : named)}.`);
  }
  return {
    key: "peers",
    question: "How does it compare with real peers?",
    lines,
    source: `Fees on each institution's own published schedule, verified and live, read ${dayText(briefing.generatedAt)}; ${briefing.peerLabel}.`,
    links,
  };
}

function market(input: CommandCenterInput, link: (href: string) => string): CommandCenterAnswer {
  const { briefing, stateLabel, windowDays, institution } = input;
  const place = stateLabel ?? "its state";
  const lines: string[] = [];
  const moves = briefing?.observations.filter((o) => o.kind === "competitor_move") ?? [];
  const rules = briefing?.observations.filter((o) => o.kind === "rule_change") ?? [];
  if (briefing) {
    lines.push(
      moves.length === 0
        ? `No institution in ${place} has a confirmed change in the last ${windowDays} days to a fee ${institution.name} publishes.`
        : `${plural(moves.length, "fee", "fees")} ${institution.name} publishes changed at an institution in ${place} in the last ${windowDays} days, each confirmed on that institution's schedules.`,
    );
    lines.push(
      rules.length > 0
        ? rules[0].headline
        : "No regulator release bearing on its fees is flagged in this month's briefing; the Regulatory Wire lists every recent item.",
    );
  } else {
    lines.push(`The market for ${institution.name} could not be read just now.`);
  }
  return {
    key: "market",
    question: "What happened in its market and in regulation?",
    lines,
    source: briefing ? `Fee changes confirmed on published schedules, ${place}, last ${windowDays} days to ${dayText(briefing.generatedAt)}.` : null,
    links: [
      { label: "Alerts and watches", href: link("/pro/monitor") },
      { label: "Regulatory Wire", href: link("/pro/news") },
    ],
  };
}

function next(input: CommandCenterInput, link: (href: string) => string): CommandCenterAnswer {
  const [first] = buildAttentionItems(input.briefing, { limit: 1 });
  const links: CommandCenterLink[] = [];
  if (first?.feeCategory) links.push({ label: "Research this fee", href: link(`/pro/research?fee=${encodeURIComponent(first.feeCategory)}`) });
  links.push({ label: "Build this quarter's brief", href: link("/pro/reports?intent=executive-briefing") });
  return {
    key: "next",
    question: "What to look at next",
    lines: [first ? first.headline : "Nothing in this month's briefing stands out for a closer look."],
    source: first && input.briefing ? `This month's briefing, read ${dayText(input.briefing.generatedAt)}.` : null,
    links,
  };
}

/** Pure: the five answers, in the order a chief executive asks them. */
export function buildCommandCenter(input: CommandCenterInput): CommandCenterAnswer[] {
  const id = String(input.institution.id);
  const link = (href: string) => hrefWithInstitutionContext(href, id);
  return [performance(input, link), change(input, link), peers(input, link), market(input, link), next(input, link)];
}

/** The newest filed quarter's label, for the page's kicker; null without a filing. */
export function commandCenterQuarter(view: FinancialPerformanceView | null): string | null {
  const latest = latestFiled(view);
  return latest ? filedQuarterLabel(latest.reportDate) : null;
}
