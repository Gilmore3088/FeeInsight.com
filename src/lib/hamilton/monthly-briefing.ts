/**
 * The monthly institution briefing (#1897): one institution's month on a fixed six-section
 * template (summary, financials, competition, market, regulation, management considerations).
 * Every figure sits in its section's table with its source and its period; the sentences only
 * repeat figures from those tables. Pure: the reads are in `monthly-briefing-read.ts`.
 *
 * Rules:
 * - Built on demand. Nothing here schedules or sends a briefing.
 * - A peer median shows only when at least MIN_PEERS_FOR_POSITION peers publish the fee; the
 *   financial peer median follows the same 10-peer rule in financial-quarters.ts.
 * - The subscriber edits each section's words. The figures and their sources stay as built, and a
 *   section whose words were changed is marked as written by the team in the export.
 * - Management considerations are questions to weigh, never a price or a forecast.
 */

import { DISPLAY_NAMES } from "@/lib/fee-taxonomy";
import type { SavedFeeRef } from "@/lib/saved-output-corrections";
import {
  filedThousandsText,
  filingVariables,
  quarterLabel,
  yearEarlier,
  type FinancialPerformanceView,
} from "./financial-quarters";
import type { HamiltonPeerIndexSource } from "./peer-index";
import type { ReportSummaryResponse } from "./types";
import { MIN_PEERS_FOR_POSITION } from "./workspace/scenario";
import type { EconomicBackdrop, Fact } from "./workspace/types";

export const MONTHLY_BRIEFING_REPORT_TYPE = "monthly_briefing";

export const MONTHLY_BRIEFING_SECTIONS = [
  { id: "summary", heading: "Summary" },
  { id: "financials", heading: "Financials" },
  { id: "competition", heading: "Competition" },
  { id: "market", heading: "Market" },
  { id: "regulation", heading: "Regulation" },
  { id: "management", heading: "Management considerations" },
] as const;

export type MonthlyBriefingSectionId = (typeof MONTHLY_BRIEFING_SECTIONS)[number]["id"];

/** Words a subscriber can put in one section, and in the title. */
export const MAX_SECTION_TEXT = 5000;
export const MAX_BRIEFING_TITLE = 200;
/** Fees compared in Competition, largest gap from the peer median first. */
export const MAX_COMPETITION_ROWS = 5;
/** A gap from the peer median this large, in percent, becomes a question for management. */
export const CONSIDERATION_GAP_PCT = 10;
/** A change in fee income on a year earlier this large, in percent, becomes a question for management. */
export const CONSIDERATION_INCOME_PCT = 5;
const MAX_REGULATION_ROWS = 6;

/** One figure or item: what it is, its value, where it comes from and the period it covers. */
export interface BriefingRow {
  label: string;
  /** Null for a sourced statement with no figure (a rule, a Beige Book passage). */
  value: string | null;
  source: string;
  period: string;
  url: string | null;
}

export interface MonthlyBriefingSection {
  id: MonthlyBriefingSectionId;
  heading: string;
  /** Hamilton's words as built; kept so an edit can be told apart and undone. */
  draft: string;
  /** The words shown and exported: the draft until the subscriber edits it. */
  text: string;
  rows: BriefingRow[];
  /** What Hamilton could not show in this section, in plain words. */
  gaps: string[];
}

export interface MonthlyBriefing {
  version: 1;
  /** "2026-10". */
  month: string;
  /** "October 2026". */
  monthLabel: string;
  institutionId: number;
  institutionName: string;
  /** The peer group behind Competition (the saved peer set when the subscriber has one). */
  peerGroupLabel: string | null;
  peerGroupSource: HamiltonPeerIndexSource | null;
  generatedAt: string;
  sections: MonthlyBriefingSection[];
}

export interface CompetitionFeeInput {
  feeCategory: string;
  /** The price the schedule states; null when it states several different fees. */
  own: number | null;
  ownAsOf: string | null;
  ownUrl: string | null;
  peerMedian: number;
  peerCount: number;
}

export interface MonthlyBriefingInput {
  now: Date;
  institution: { id: number; name: string; charterType: string | null };
  financial: FinancialPerformanceView | null;
  /** Who the financial peer median covers: "banks in the same asset-size tier". */
  financialPeerLabel: string;
  competition: {
    peerLabel: string;
    peerSource: HamiltonPeerIndexSource;
    fallbackReason: string | null;
    /** When the peer medians were read or computed. */
    peerAsOf: string | null;
    fees: CompetitionFeeInput[];
  } | null;
  economy: EconomicBackdrop | null;
  /** Sourced regulatory items for the institution, as Ask reads them. */
  regulation: Fact[];
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/** "$35", "$2.50". */
export function usd(value: number): string {
  const digits = Number.isInteger(value) ? 0 : 2;
  return `$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function isoDay(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

/** "Oct 12, 2026"; anything that is not an ISO date is kept as given. */
export function dayLabel(iso: string): string {
  const d = isoDay(iso);
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : iso;
}

/** "Sep 2026". */
function monthShort(iso: string): string {
  const d = isoDay(iso);
  return d ? d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : iso;
}

/** "October 2026" and "2026-10" for the month the briefing was built in. */
export function briefingMonth(now: Date): { month: string; monthLabel: string } {
  return {
    month: now.toISOString().slice(0, 7),
    monthLabel: now.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

/** Text from shared readers, kept free of em dashes. */
function plain(text: string): string {
  return text.replace(/\s*\u2014\s*/g, ", ").trim();
}

function pct1(value: number): string {
  return `${Math.abs(value).toFixed(1)}%`;
}

/** Row counts in words, so the only numerals in the text are figures from the tables. */
function countWord(n: number): string {
  return ["none", "one", "two", "three", "four", "five"][n] ?? String(n);
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A fee's name inside a sentence: "Overdraft (OD)" reads "overdraft". */
function spoken(name: string): string {
  return name.replace(/\s*\([^)]*\)/g, "").trim().split(/\s+/).map(lowerFirst).join(" ");
}

function feeName(category: string): string {
  return DISPLAY_NAMES[category] ?? category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

// ─── Sections ────────────────────────────────────────────────────────────────

interface Built {
  draft: string[];
  rows: BriefingRow[];
  gaps: string[];
}

interface FinancialFacts extends Built {
  feeNoun: string;
  feeRow: BriefingRow | null;
  yoyRow: BriefingRow | null;
  yoyPct: number | null;
  quarter: string | null;
}

function financials(input: MonthlyBriefingInput): FinancialFacts {
  const view = input.financial;
  const empty = { feeNoun: "Fee income", feeRow: null, yoyRow: null, yoyPct: null, quarter: null };
  if (!view || view.quarters.length === 0) {
    return { ...empty, draft: [], rows: [], gaps: [`No call report filings are on file for ${input.institution.name}, so this section has no figures.`] };
  }
  const ncua = view.source === "ncua";
  const vars = filingVariables(view.source);
  const regulator = ncua ? "NCUA 5300 call report" : "FDIC call report (BankFind)";
  const feeNoun = ncua ? "Fee income" : "Deposit service charges";
  const verb = ncua ? "was" : "were";
  const latest = view.quarters.find((q) => q.fee.value !== null) ?? null;
  const balances = view.quarters[0];
  const rows: BriefingRow[] = [];
  const draft: string[] = [];
  const gaps: string[] = [];
  let feeRow: BriefingRow | null = null;
  let yoyRow: BriefingRow | null = null;
  if (latest && latest.fee.value !== null) {
    const url = latest.evidence.sourceUrl;
    feeRow = {
      label: `${feeNoun}, one quarter`,
      value: filedThousandsText(latest.fee.value),
      source: `${regulator}, ${vars.fee.code}${ncua ? " (year to date, less the previous quarter's filing)" : ""}`,
      period: latest.label,
      url,
    };
    rows.push(feeRow);
    let sentence = `${feeNoun} in ${latest.label} ${verb} ${feeRow.value}`;
    if (latest.fee.yoyPct !== null) {
      const prior = quarterLabel(yearEarlier(latest.reportDate));
      yoyRow = {
        label: `${feeNoun}, change on a year earlier`,
        value: latest.fee.yoyPct === 0 ? "unchanged" : `${latest.fee.yoyPct > 0 ? "up" : "down"} ${pct1(latest.fee.yoyPct)}`,
        source: `${regulator}, ${vars.fee.code}`,
        period: `${latest.label} against ${prior}`,
        url,
      };
      rows.push(yoyRow);
      sentence += latest.fee.yoyPct === 0 ? `, unchanged on ${prior}` : `, ${yoyRow.value} on ${prior}`;
    }
    draft.push(`${sentence}.`);
    if (latest.fee.peerMedian !== null) {
      const median: BriefingRow = {
        label: `Peer median, ${lowerFirst(feeNoun)}`,
        value: filedThousandsText(latest.fee.peerMedian),
        source: `${ncua ? "NCUA 5300 call reports" : "FDIC call reports (BankFind)"} of ${latest.fee.peers} ${input.financialPeerLabel}, ${vars.fee.code}`,
        period: latest.label,
        url: null,
      };
      rows.push(median);
      draft.push(`The median for ${latest.fee.peers} ${input.financialPeerLabel} was ${median.value}.`);
    } else {
      gaps.push(`Fewer than ${MIN_PEERS_FOR_POSITION} ${input.financialPeerLabel} reported ${lowerFirst(feeNoun)} for ${latest.label}, so no peer median is shown.`);
    }
  } else {
    gaps.push(`No filed quarter could show ${lowerFirst(feeNoun)} on its own, so that figure is left out.`);
  }
  if (balances.deposits.value !== null) {
    const deposits: BriefingRow = {
      label: ncua ? "Shares and deposits at quarter end" : "Deposits at quarter end",
      value: filedThousandsText(balances.deposits.value),
      source: `${regulator}, ${vars.deposits.code}`,
      period: balances.label,
      url: balances.evidence.sourceUrl,
    };
    rows.push(deposits);
    let sentence = `${ncua ? "Shares and deposits" : "Deposits"} at the end of ${balances.label} were ${deposits.value}`;
    if (balances.deposits.yoyPct !== null && balances.deposits.yoyPct !== 0) {
      const change: BriefingRow = {
        label: `${ncua ? "Shares and deposits" : "Deposits"}, change on a year earlier`,
        value: `${balances.deposits.yoyPct > 0 ? "up" : "down"} ${pct1(balances.deposits.yoyPct)}`,
        source: `${regulator}, ${vars.deposits.code}`,
        period: `${balances.label} against ${quarterLabel(yearEarlier(balances.reportDate))}`,
        url: balances.evidence.sourceUrl,
      };
      rows.push(change);
      sentence += `, ${change.value} on a year earlier`;
    }
    draft.push(`${sentence}.`);
  }
  if (balances.assets.value !== null) {
    const assets: BriefingRow = {
      label: "Total assets at quarter end",
      value: filedThousandsText(balances.assets.value),
      source: `${regulator}, ${vars.assets.code}`,
      period: balances.label,
      url: balances.evidence.sourceUrl,
    };
    rows.push(assets);
    draft.push(`Total assets were ${assets.value}.`);
  }
  return { draft, rows, gaps, feeNoun, feeRow, yoyRow, yoyPct: latest?.fee.yoyPct ?? null, quarter: latest?.label ?? null };
}

interface ComparedFee {
  name: string;
  own: number;
  median: number;
  count: number;
  gapPct: number | null;
  ownRow: BriefingRow;
  medianRow: BriefingRow;
}

interface CompetitionFacts extends Built {
  compared: ComparedFee[];
}

function competition(input: MonthlyBriefingInput): CompetitionFacts {
  const c = input.competition;
  if (!c) {
    return { draft: [], rows: [], gaps: [`No peer group could be read for ${input.institution.name}, so fees are not compared this month.`], compared: [] };
  }
  const name = input.institution.name;
  const gaps: string[] = [];
  if (c.fallbackReason) gaps.push(plain(c.fallbackReason));
  const counted = c.fees.filter((f) => f.own !== null && f.peerCount >= MIN_PEERS_FOR_POSITION);
  const thin = c.fees.filter((f) => f.own !== null && f.peerCount < MIN_PEERS_FOR_POSITION).length;
  if (thin > 0) {
    gaps.push(`${capital(countWord(thin))} of ${name}'s fees ${thin === 1 ? "has" : "have"} fewer than ${MIN_PEERS_FOR_POSITION} peers publishing the same fee, so no median is shown for ${thin === 1 ? "it" : "them"}.`);
  }
  const several = c.fees.filter((f) => f.own === null).length;
  if (several > 0) {
    gaps.push(`${capital(countWord(several))} ${several === 1 ? "fee category lists" : "fee categories list"} several different amounts, so ${several === 1 ? "it is" : "they are"} not compared with one median.`);
  }
  const compared: ComparedFee[] = counted
    .map((f) => {
      const own = f.own as number;
      const label = feeName(f.feeCategory);
      return {
        name: label,
        own,
        median: f.peerMedian,
        count: f.peerCount,
        gapPct: f.peerMedian === 0 ? null : Math.round(((own - f.peerMedian) / f.peerMedian) * 1000) / 10,
        ownRow: {
          label: `${label}, ${name}`,
          value: usd(own),
          source: `${name} fee schedule, verified and published in the Bank Fee Index`,
          period: f.ownAsOf ? `Published ${dayLabel(f.ownAsOf)}` : "Current schedule",
          url: f.ownUrl,
        },
        medianRow: {
          label: `${label}, peer median`,
          value: usd(f.peerMedian),
          source: `Bank Fee Index, ${c.peerLabel}, ${f.peerCount} institutions`,
          period: c.peerAsOf ? `As of ${dayLabel(c.peerAsOf)}` : "Current index",
          url: null,
        },
      };
    })
    .sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0) || a.name.localeCompare(b.name))
    .slice(0, MAX_COMPETITION_ROWS);
  if (compared.length === 0) {
    gaps.push(`None of ${name}'s published fees has ${MIN_PEERS_FOR_POSITION} or more peers in ${c.peerLabel} to compare with this month.`);
    return { draft: [], rows: [], gaps, compared };
  }
  const above = compared.filter((f) => f.own > f.median).length;
  const below = compared.filter((f) => f.own < f.median).length;
  const at = compared.length - above - below;
  const draft = [
    `Against ${c.peerLabel}, ${compared.length === 1 ? "one fee is compared" : `${countWord(compared.length)} fees are compared`}: ${countWord(above)} above the peer median, ${countWord(below)} below and ${countWord(at)} at it.`,
    ...compared.slice(0, 3).map((f) => {
      if (f.own === f.median) return `${name}'s ${spoken(f.name)} fee of ${usd(f.own)} matches the median across ${f.count} peers.`;
      const side = f.own > f.median ? "above" : "below";
      return `${name}'s ${spoken(f.name)} fee of ${usd(f.own)} is ${side} the median of ${usd(f.median)} across ${f.count} peers.`;
    }),
  ];
  return { draft, rows: compared.flatMap((f) => [f.ownRow, f.medianRow]), gaps, compared };
}

interface MarketFacts extends Built {
  lead: { row: BriefingRow; sentence: string } | null;
}

function market(input: MonthlyBriefingInput): MarketFacts {
  const e = input.economy;
  if (!e) return { draft: [], rows: [], gaps: ["No economic figures could be read for the institution's state this month."], lead: null };
  const rows: BriefingRow[] = [];
  const draft: string[] = [];
  let lead: MarketFacts["lead"] = null;
  for (const i of e.indicators) {
    const period = monthShort(i.asOf);
    const value = i.measure === "rate" ? `${i.value.toFixed(1)}%` : `${i.value === 0 ? "unchanged" : `${i.value > 0 ? "up" : "down"} ${pct1(i.value)}`} over 12 months`;
    const row: BriefingRow = { label: i.label, value, source: i.source.label, period, url: i.source.url ?? null };
    rows.push(row);
    const sentence = i.measure === "rate"
      ? `${i.label} was ${value} in ${period}.`
      : `${i.label} ${i.value === 0 ? "were unchanged" : `were ${i.value > 0 ? "up" : "down"} ${pct1(i.value)}`} over the 12 months to ${period}.`;
    draft.push(sentence);
    if (i.key === "fed_funds" || (!lead && i.measure === "rate")) lead = { row, sentence };
  }
  if (e.beigeBook) {
    rows.push({ label: "Beige Book, district reading", value: null, source: e.beigeBook.source.label, period: dayLabel(e.beigeBook.releaseDate), url: e.beigeBook.source.url ?? null });
    draft.push(`The ${e.districtName ? `${e.districtName} ` : ""}district Beige Book of ${dayLabel(e.beigeBook.releaseDate)} said: "${plain(e.beigeBook.text)}"`);
  }
  if (e.fomc) {
    rows.push({ label: "Latest rate decision", value: null, source: e.fomc.source.label, period: dayLabel(e.fomc.meetingDate), url: e.fomc.source.url ?? null });
    draft.push(`At its ${dayLabel(e.fomc.meetingDate)} meeting, the Federal Open Market Committee recorded: "${plain(e.fomc.text)}"`);
  }
  if (rows.length === 0) return { draft, rows, gaps: ["No economic figures could be read for the institution's state this month."], lead };
  return { draft, rows, gaps: [], lead };
}

function regulation(input: MonthlyBriefingInput): Built {
  const facts = input.regulation.slice(0, MAX_REGULATION_ROWS);
  if (facts.length === 0) return { draft: [], rows: [], gaps: ["No rules, bills or regulator records were found for this institution this month."] };
  const name = input.institution.name;
  return {
    draft: [`${facts.length === 1 ? "One sourced item bears" : `${capital(countWord(facts.length))} sourced items bear`} on ${name} this month, each listed below with its source and date. Rules are those that apply to overdraft fees.`],
    rows: facts.map((f) => ({
      label: plain(f.text),
      value: null,
      source: plain(f.source.label),
      period: f.source.asOf ? (/^\d{4}$/.test(f.source.asOf) ? `Year ${f.source.asOf}` : dayLabel(f.source.asOf)) : `Read ${dayLabel(input.now.toISOString())}`,
      url: f.source.url ?? null,
    })),
    gaps: [],
  };
}

function management(fin: FinancialFacts, comp: CompetitionFacts, reg: Built): Built {
  const draft: string[] = [];
  const rows: BriefingRow[] = [];
  const top = comp.compared.find((f) => f.gapPct !== null && Math.abs(f.gapPct) >= CONSIDERATION_GAP_PCT);
  if (top && top.gapPct !== null) {
    const side = top.gapPct > 0 ? "above" : "below";
    draft.push(`The ${spoken(top.name)} fee sits ${pct1(top.gapPct)} ${side} the peer median (${top.ownRow.value} against ${top.medianRow.value}). Is that the position management intends?`);
    rows.push(top.ownRow, top.medianRow, {
      label: `${top.name}, gap from the peer median`,
      value: `${pct1(top.gapPct)} ${side}`,
      source: "Worked out from the two figures above: the difference as a share of the peer median",
      period: `${top.ownRow.period}; median ${lowerFirst(top.medianRow.period)}`,
      url: null,
    });
  }
  if (fin.yoyRow && fin.feeRow && fin.yoyPct !== null && Math.abs(fin.yoyPct) >= CONSIDERATION_INCOME_PCT) {
    draft.push(`${fin.feeNoun} ${fin.yoyPct > 0 ? "rose" : "fell"} ${pct1(fin.yoyPct)} on a year earlier in ${fin.quarter}. Which fee lines moved it?`);
    rows.push(fin.feeRow, fin.yoyRow);
  }
  if (reg.rows.some((r) => /complaint/i.test(r.source))) {
    draft.push("How do the CFPB complaint figures under Regulation compare with the complaints your own team logged?");
  }
  if (draft.length === 0) {
    draft.push(`No fee sits ${CONSIDERATION_GAP_PCT}% or more from its peer median and no change in fee income of ${CONSIDERATION_INCOME_PCT}% or more was filed. Add the points your team wants management to weigh this month.`);
  }
  return { draft, rows, gaps: [] };
}

function summary(input: MonthlyBriefingInput, fin: FinancialFacts, comp: CompetitionFacts, mkt: MarketFacts, reg: Built): Built {
  const draft: string[] = [];
  const rows: BriefingRow[] = [];
  if (fin.draft[0] && fin.feeRow) {
    draft.push(fin.draft[0]);
    rows.push(fin.feeRow, ...(fin.yoyRow ? [fin.yoyRow] : []));
  }
  if (comp.draft[0]) {
    draft.push(comp.draft[0]);
    const lead = comp.compared[0];
    if (lead) {
      draft.push(comp.draft[1]);
      rows.push(lead.ownRow, lead.medianRow);
    }
  }
  if (mkt.lead) {
    draft.push(mkt.lead.sentence);
    rows.push(mkt.lead.row);
  }
  if (reg.rows.length > 0) {
    draft.push(`Regulation lists ${reg.rows.length === 1 ? "one sourced item" : `${countWord(reg.rows.length)} sourced items`} for ${input.institution.name}.`);
  }
  if (draft.length === 0) return { draft, rows, gaps: [`Hamilton found no sourced figures for ${input.institution.name} this month.`] };
  return { draft, rows, gaps: [] };
}

/** The briefing as built from the readers' figures: the draft words are the shown words. */
export function buildMonthlyBriefing(input: MonthlyBriefingInput): MonthlyBriefing {
  const fin = financials(input);
  const comp = competition(input);
  const mkt = market(input);
  const reg = regulation(input);
  const built: Record<MonthlyBriefingSectionId, Built> = {
    summary: summary(input, fin, comp, mkt, reg),
    financials: fin,
    competition: comp,
    market: mkt,
    regulation: reg,
    management: management(fin, comp, reg),
  };
  const { month, monthLabel } = briefingMonth(input.now);
  return {
    version: 1,
    month,
    monthLabel,
    institutionId: input.institution.id,
    institutionName: input.institution.name,
    peerGroupLabel: input.competition?.peerLabel ?? null,
    peerGroupSource: input.competition?.peerSource ?? null,
    generatedAt: input.now.toISOString(),
    sections: MONTHLY_BRIEFING_SECTIONS.map(({ id, heading }) => {
      const words = built[id].draft.join(" ");
      return { id, heading, draft: words, text: words, rows: built[id].rows, gaps: built[id].gaps };
    }),
  };
}

export function isSectionEdited(section: Pick<MonthlyBriefingSection, "draft" | "text">): boolean {
  return section.text.trim() !== section.draft.trim();
}

export function defaultBriefingTitle(briefing: Pick<MonthlyBriefing, "institutionName" | "monthLabel">): string {
  return `${briefing.institutionName}: monthly briefing, ${briefing.monthLabel}`;
}

/** Each distinct source once, with the periods it covers. */
export function briefingSources(briefing: MonthlyBriefing): Array<{ label: string; detail: string; url: string | null }> {
  const bySource = new Map<string, { periods: Set<string>; url: string | null }>();
  for (const section of briefing.sections) {
    for (const row of section.rows) {
      const entry = bySource.get(row.source) ?? { periods: new Set<string>(), url: row.url };
      entry.periods.add(row.period);
      bySource.set(row.source, entry);
    }
  }
  return [...bySource].map(([label, { periods, url }]) => ({ label, detail: [...periods].join("; "), url }));
}

/** The briefing in the shape every saved Hamilton report has, so the library, the store and the PDF route take it as is. */
export function monthlyBriefingReport(briefing: MonthlyBriefing, title?: string): ReportSummaryResponse {
  const summaryText = briefing.sections.find((s) => s.id === "summary")?.text ?? "";
  return {
    title: (title ?? "").trim().slice(0, MAX_BRIEFING_TITLE) || defaultBriefingTitle(briefing),
    monthlyBriefing: briefing,
    executiveSummary: summaryText ? [summaryText] : [],
    snapshot: [],
    strategicRationale: "",
    tradeoffs: [],
    recommendation: "",
    implementationNotes: [`Built on request in ${briefing.monthLabel}. Each figure is as of the period shown beside it and was not refreshed after the briefing was built.`],
    sources: briefingSources(briefing),
    exportControls: { pdfEnabled: true, shareEnabled: false },
  };
}

export interface MonthlyBriefingEdits {
  title: string;
  sections: Partial<Record<MonthlyBriefingSectionId, string>>;
}

/** Null when the edits are well formed; otherwise the reason, in the reader's words. */
export function monthlyBriefingEditsError(edits: unknown): string | null {
  if (!edits || typeof edits !== "object") return "Nothing to save.";
  const e = edits as { title?: unknown; sections?: unknown };
  if (typeof e.title !== "string" || e.title.length > MAX_BRIEFING_TITLE) return `Keep the title to ${MAX_BRIEFING_TITLE} characters.`;
  if (!e.sections || typeof e.sections !== "object") return "Nothing to save.";
  const ids = new Set<string>(MONTHLY_BRIEFING_SECTIONS.map((s) => s.id));
  for (const [id, text] of Object.entries(e.sections as Record<string, unknown>)) {
    if (!ids.has(id)) return "That section is not part of the briefing.";
    if (typeof text !== "string" || text.length > MAX_SECTION_TEXT) return `Keep each section to ${MAX_SECTION_TEXT.toLocaleString("en-US")} characters.`;
  }
  return null;
}

/**
 * The subscriber's words over a saved briefing. Figures, sources, periods and the draft never
 * change; an empty section goes back to Hamilton's draft.
 */
export function editMonthlyBriefing(report: ReportSummaryResponse, edits: MonthlyBriefingEdits): ReportSummaryResponse {
  const briefing = report.monthlyBriefing;
  if (!briefing) return report;
  const sections = briefing.sections.map((section) => {
    const next = edits.sections[section.id];
    if (next === undefined) return section;
    const text = next.slice(0, MAX_SECTION_TEXT);
    return { ...section, text: text.trim() ? text : section.draft };
  });
  return monthlyBriefingReport({ ...briefing, sections }, edits.title);
}

/** The published fee rows Competition compared, so a later correction to one names this briefing. */
export function briefingFeeRefs(
  institutionId: number,
  fees: ReadonlyArray<{ id: number; fee_category?: string | null; source_document_id?: number | null }>,
  briefing: MonthlyBriefing,
): SavedFeeRef[] {
  const shown = new Set(briefing.sections.find((s) => s.id === "competition")?.rows.map((r) => r.label) ?? []);
  return fees
    .filter((f) => f.fee_category && shown.has(`${feeName(f.fee_category)}, ${briefing.institutionName}`))
    .map((f) => ({ feePublishedId: f.id, institutionId, sourceDocumentId: f.source_document_id ?? null, sourceContentHash: null }));
}
