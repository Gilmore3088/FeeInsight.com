/**
 * Hamilton's answer about one fee, built to the four roles James set (2026-10-06):
 * Inquisitive Economist, Rigorous Consultant, Artistic Data Engineer and Technical yet
 * Clear Writer. Pure and deterministic: every sentence is a figure from FeeResearch with
 * its source, so the Ask bar, the chat and the reports can quote it without a model call.
 *
 * Decision support only: nothing here says to raise, lower or drop a fee.
 */

import { subjectPossessive } from "./subject";
import { formatDollarsInWords, formatFeeAmount } from "@/lib/format";
import { proseFeeName } from "./names";
import { annualItemsQuestion, MIN_PEERS_FOR_POSITION, pricePosition } from "./scenario";
import { segmentClaims, segmentExhibit, segmentHeadline } from "./segment";
import { buildStoryline, type StoryIntent } from "./storyline";
import { ownRate, rateClaims, rateHeadline, rateVolumeQuestion } from "./rates";

export { proseFeeName };
import type {
  ClarifyingQuestion,
  EconomicBackdrop,
  EconomicIndicator,
  EvidenceLevel,
  Exhibit,
  ExhibitMarker,
  Fact,
  FeeResearch,
  HamiltonAnswer,
  SourceRef,
} from "./types";

export type ExhibitFocus = "position" | "competitors" | "trend";

/** Fees where account balances running short drive volume, so the job market matters. */
const SHORTFALL_FEES = new Set(["overdraft", "nsf", "od_protection_transfer", "od_daily_cap", "nsf_daily_cap", "continuous_od"]);
/** A gap smaller than this between two rates (points) is "about the same". */
const RATE_GAP = 0.3;
/** Most local competitors an exhibit names. */
const MAX_COMPETITORS = 12;

const FEE_SOURCE_LABEL = "Bank Fee Index, published fee schedules";


function money(n: number): string {
  return formatFeeAmount(n) ?? `$${n}`;
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** "2026-08-01" -> "August 2026". */
function monthYear(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "2026-09-03" -> "September 3, 2026". */
function longDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function feeSource(research: FeeResearch, label = FEE_SOURCE_LABEL): SourceRef {
  return { label, table: "published_fee_catalog", asOf: research.provenance.dataAsOf.fees ?? null };
}

// ─── Consultant: sourced claims ──────────────────────────────────────────────

function ownFeeClaim(research: FeeResearch, name: string): Fact | null {
  if (research.current === null) return null;
  const row = research.ownRows[0];
  return {
    text: `${subjectPossessive(research)} published ${name} fee is ${money(research.current)}.`,
    source: {
      label: `${subjectPossessive(research)} published fee schedule`,
      table: "published_fee_catalog",
      url: row?.documentUrl ?? row?.sourceUrl ?? undefined,
      asOf: row?.publishedAt?.slice(0, 10) ?? research.provenance.dataAsOf.fees ?? null,
    },
  };
}

function peerClaim(research: FeeResearch): Fact | null {
  const band = research.band;
  if (!band || band.n < MIN_PEERS_FOR_POSITION) return null;
  return {
    text: `Across ${count(band.n)} peers, the median is ${money(band.median)} and the middle half runs ${money(band.p25)} to ${money(band.p75)}.`,
    source: feeSource(research),
    sampleSize: band.n,
  };
}

function layerClaims(research: FeeResearch): Fact[] {
  const wanted = ["state", "national"] as const;
  return wanted.flatMap((scope) => {
    const layer = research.layers.find((l) => l.scope === scope);
    if (!layer || layer.median === null) return [];
    const where = scope === "national" ? "The national median" : `The ${layer.label} median`;
    return [
      {
        text: `${where} is ${money(layer.median)} across ${count(layer.n)} institutions.`,
        source: { ...layer.source, asOf: layer.asOf ?? layer.source.asOf ?? null },
        sampleSize: layer.n,
      },
    ];
  });
}

/** What each filing's fee income line covers. */
function incomeName(source: "fdic" | "ncua"): string {
  return source === "ncua" ? "fee income" : "deposit service charge income";
}

function count(n: number): string {
  return n.toLocaleString("en-US");
}

function revenueClaims(research: FeeResearch, name: string): Fact[] {
  const out: Fact[] = [];
  const line = research.revenueLine;
  if (line) {
    // One filing line covers both fees: "NSF / returned item and overdraft income".
    const combined = line.combinedWith ? ` and ${line.combinedWith}` : "";
    out.push({
      text: `${subjectPossessive(research)} filing reports ${formatDollarsInWords(line.annualIncome)} in ${name} income${combined} over the four quarters to ${longDate(line.quarterEnd)}.`,
      source: { ...line.source, asOf: line.quarterEnd },
    });
  }
  const fin = research.institutionFinancials;
  if (fin?.latestTtm != null) {
    const change = fin.yoyPct != null ? `, ${fin.yoyPct >= 0 ? "up" : "down"} ${pct(Math.abs(fin.yoyPct))}` : "";
    out.push({
      text: `${subjectPossessive(research)} ${incomeName(fin.source)} was ${formatDollarsInWords(fin.latestTtm)} in the year to ${longDate(fin.quarterEnd)}${change}.`,
      source: { ...fin.sourceRef, asOf: fin.quarterEnd },
    });
  }
  return out;
}

// ─── Economist: what moves the number ────────────────────────────────────────

function indicator(economy: EconomicBackdrop, key: EconomicIndicator["key"]): EconomicIndicator | undefined {
  return economy.indicators.find((i) => i.key === key);
}

/** Price inflation, rates, the FOMC's decision, the job market and the district Fed's own reading, each one sentence. */
export function economicDrivers(economy: EconomicBackdrop | null | undefined, feeCategory: string): Fact[] {
  if (!economy) return [];
  const out: Fact[] = [];

  const bank = indicator(economy, "cpi_bank_services");
  const all = indicator(economy, "cpi_all_items");
  if (bank) {
    const verb = bank.value >= 0 ? "rose" : "fell";
    const versus = all
      ? Math.abs(bank.value - all.value) < 0.1
        ? `, in step with all consumer prices`
        : `, ${bank.value > all.value ? "faster" : "slower"} than the ${pct(all.value)} change in all consumer prices`
      : "";
    out.push({ text: `Prices for bank services ${verb} ${pct(Math.abs(bank.value))} in the year to ${monthYear(bank.asOf)}${versus}.`, source: bank.source });
  } else if (all) {
    out.push({ text: `All consumer prices rose ${pct(all.value)} in the year to ${monthYear(all.asOf)}.`, source: all.source });
  }

  const funds = indicator(economy, "fed_funds");
  if (funds) {
    const prior = funds.yearAgo;
    const level = `The federal funds rate was ${pct(funds.value)} in ${monthYear(funds.asOf)}`;
    if (prior === null || Math.abs(funds.value - prior) < 0.25) {
      out.push({ text: `${level}, about where it was a year earlier.`, source: funds.source });
    } else if (funds.value < prior) {
      out.push({ text: `${level}, down from ${pct(prior)} a year earlier.`, source: funds.source });
      out.push({ text: "Lower rates shrink what banks earn on deposits, so fee income carries more of the load.", source: funds.source });
    } else {
      out.push({ text: `${level}, up from ${pct(prior)} a year earlier.`, source: funds.source });
      out.push({ text: "Higher rates raise what banks earn on deposits, so fee income carries less of the load.", source: funds.source });
    }
  }

  if (economy.fomc) {
    out.push({
      text: `At its ${longDate(economy.fomc.meetingDate)} meeting, per the FOMC minutes: "${economy.fomc.text.replace(/\.$/, "")}."`,
      source: economy.fomc.source,
    });
  }

  const state = indicator(economy, "state_unemployment");
  const nation = indicator(economy, "national_unemployment");
  if (state) {
    const versus = nation ? `, against ${pct(nation.value)} nationally` : "";
    out.push({ text: `${economy.place} unemployment was ${pct(state.value)} in ${monthYear(state.asOf)}${versus}.`, source: state.source });
    if (nation && SHORTFALL_FEES.has(feeCategory) && Math.abs(state.value - nation.value) >= RATE_GAP) {
      out.push({
        text:
          state.value > nation.value
            ? `A weaker job market than the nation's usually means more accounts running short.`
            : `A stronger job market than the nation's usually means fewer accounts running short.`,
        source: state.source,
      });
    }
  }

  if (economy.beigeBook) {
    const where = economy.districtName ? `the ${economy.districtName} Fed's` : "the district";
    out.push({
      text: `Per ${where} Beige Book of ${longDate(economy.beigeBook.releaseDate)}: "${economy.beigeBook.text}"`,
      source: economy.beigeBook.source,
    });
  }

  if (economy.districtResearch) {
    const who = economy.districtName ? `The ${economy.districtName} Fed` : "The district Reserve Bank";
    const when = economy.districtResearch.publishedAt ? ` on ${longDate(economy.districtResearch.publishedAt)}` : "";
    out.push({
      text: `${who} published "${economy.districtResearch.title}"${when}.`,
      source: economy.districtResearch.source,
    });
  }
  return out;
}

// ─── Data engineer: the one exhibit ──────────────────────────────────────────

function positionExhibit(research: FeeResearch, name: string): Exhibit | null {
  const band = research.band;
  if (!band || band.n < MIN_PEERS_FOR_POSITION) return null;
  const markers: ExhibitMarker[] = [{ label: "Peer median", scope: "peer", value: band.median, n: band.n }];
  for (const layer of research.layers) {
    if (layer.median === null) continue;
    markers.push({ label: layer.scope === "national" ? "National median" : `${layer.label} median`, scope: layer.scope, value: layer.median, n: layer.n });
  }
  return {
    kind: "fee_position",
    title: research.current !== null ? `${subjectPossessive(research)} ${money(research.current)} ${name} fee against ${count(band.n)} peers` : `The ${name} fee across ${count(band.n)} peers`,
    unit: "dollars",
    own: research.current,
    ownLabel: research.institutionName,
    band: { label: research.peerLabel, p25: band.p25, median: band.median, p75: band.p75, n: band.n },
    markers,
    sources: [feeSource(research), ...research.layers.filter((l) => l.median !== null).map((l) => ({ ...l.source, asOf: l.asOf }))],
    note: "Shaded: the middle half of peers. Each marker is a market's median and its institution count.",
  };
}

function competitorExhibit(research: FeeResearch, name: string): Exhibit | null {
  const list = research.localCompetitors ?? [];
  if (list.length === 0) return null;
  const items = [...list]
    .slice(0, MAX_COMPETITORS)
    .sort((a, b) => a.amount - b.amount)
    .map((p) => ({ name: p.institutionName, amount: p.amount, url: p.documentUrls[0] ?? null, deposits: p.marketDeposits ?? null }));
  return {
    kind: "competitor_range",
    title: `${name[0].toUpperCase()}${name.slice(1)} fees at ${items.length} institutions in ${subjectPossessive(research, false)} market`,
    unit: "dollars",
    own: research.current,
    ownLabel: research.institutionName,
    items,
    sources: [research.localMarket?.source ?? feeSource(research)],
    note: list.length > MAX_COMPETITORS ? `The ${MAX_COMPETITORS} largest by local deposits of ${list.length}.` : undefined,
  };
}

function trendExhibit(research: FeeResearch): Exhibit | null {
  const fin = research.institutionFinancials;
  if (fin && fin.quarters.length >= 2) {
    const series = [
      { label: research.institutionName, points: [...fin.quarters].reverse().map((q) => ({ date: q.quarterEnd, value: q.amount })) },
    ];
    if (fin.peerMedian && fin.peerMedian.quarters.length >= 2) {
      series.push({ label: `Median, ${fin.peerMedian.label}`, points: [...fin.peerMedian.quarters].reverse().map((q) => ({ date: q.quarterEnd, value: q.amount })) });
    }
    return {
      kind: "trend",
      title: `${subjectPossessive(research)} ${incomeName(fin.source)} by quarter`,
      unit: "dollars",
      series,
      sources: [fin.sourceRef, ...(fin.peerMedian ? [fin.peerMedian.sourceRef] : [])],
    };
  }
  const national = research.nationalIncomeSeries;
  if (national.length >= 2) {
    return {
      kind: "trend",
      title: "Deposit service charge income, all U.S. banks and credit unions",
      unit: "dollars",
      series: [{ label: "All filers", points: [...national].reverse().map((q) => ({ date: q.quarter, value: q.total })) }],
      sources: [national[0].sourceRef],
    };
  }
  return null;
}

export function buildExhibit(research: FeeResearch, focus: ExhibitFocus = "position"): Exhibit | null {
  const name = proseFeeName(research.feeCategory);
  const order: Record<ExhibitFocus, (() => Exhibit | null)[]> = {
    position: [() => positionExhibit(research, name), () => competitorExhibit(research, name), () => trendExhibit(research)],
    competitors: [() => competitorExhibit(research, name), () => positionExhibit(research, name), () => trendExhibit(research)],
    trend: [() => trendExhibit(research), () => positionExhibit(research, name), () => competitorExhibit(research, name)],
  };
  for (const build of order[focus]) {
    const exhibit = build();
    if (exhibit) return exhibit;
  }
  return null;
}

// ─── Writer: the headline ────────────────────────────────────────────────────

function headline(research: FeeResearch, name: string): string {
  const byRate = rateHeadline(research, name);
  if (byRate) return byRate;
  const band = research.band;
  const amounts = research.peers.map((p) => p.amount);
  if (research.current !== null) {
    const position = pricePosition(research.current, amounts);
    if (band && position !== null) {
      return `${subjectPossessive(research)} ${money(research.current)} ${name} fee is at the ${ordinal(position)} percentile of ${count(band.n)} peers (median ${money(band.median)}).`;
    }
    return `${subjectPossessive(research)} ${name} fee is ${money(research.current)}; only ${count(amounts.length)} peers publish one, too few to rank.`;
  }
  // No amount on file means the fee is not in the index, never that the bank charges none.
  if (band) return `${subjectPossessive(research)} ${name} fee is not in the index yet; ${count(band.n)} peers' median is ${money(band.median)}.`;
  return `${subjectPossessive(research)} ${name} fee is not in the index yet, and too few peers publish one to compare.`;
}

// ─── Economist: the one question ─────────────────────────────────────────────

function currentFeeQuestion(feeCategory: string, research?: Pick<FeeResearch, "subjectName">): ClarifyingQuestion {
  return {
    prompt: `${research?.subjectName ? `What does ${research.subjectName}` : "What do you"} charge for one ${proseFeeName(feeCategory)} item today?`,
    inputKind: "number",
    fieldKey: `fee.${feeCategory}.current_amount`,
  };
}

/** The one figure that would most sharpen the answer, or null when nothing is missing. */
export function missingFigure(research: FeeResearch): ClarifyingQuestion | null {
  // A fee stated as a rate has no per-item amount; the volume it applies to sets the money.
  if (research.current === null && ownRate(research)) {
    return research.provenance.clientFacts.length === 0 ? rateVolumeQuestion(research.feeCategory, research) : null;
  }
  if (research.current === null) return currentFeeQuestion(research.feeCategory, research);
  if (!research.revenueLine && research.provenance.clientFacts.length === 0) return annualItemsQuestion(research.feeCategory, research.subjectName);
  return null;
}

function evidenceLevel(research: FeeResearch): EvidenceLevel {
  if (research.provenance.clientFacts.length > 0) return "institution";
  if (research.revenueLine) return "working_estimate";
  return "market";
}

export function buildFeeAnswer(research: FeeResearch, options: { focus?: ExhibitFocus; story?: StoryIntent } = {}): HamiltonAnswer {
  const name = proseFeeName(research.feeCategory);
  const seg = research.segment ?? null;
  const level = evidenceLevel(research);
  // A segment the question named leads the answer. When it could not be built, the first
  // claim says so and the default peer group follows; it never stands in silently.
  const segmentLed = seg !== null && seg.problem === null;
  // A bank that states the fee only as a rate leads with the rate; otherwise rates follow the dollars.
  const rates = rateClaims(research, name);
  const rateLed = research.current === null && ownRate(research) !== null;
  const claims = [
    ...(seg ? segmentClaims(seg, research.feeCategory, research.current, research) : []),
    ...(rateLed ? rates : []),
    ownFeeClaim(research, name),
    ...(segmentLed ? [] : [peerClaim(research)]),
    ...layerClaims(research).filter((c) => !segmentLed || c.text.startsWith("The national")),
    ...(rateLed ? [] : rates),
    ...revenueClaims(research, name),
  ].filter((f): f is Fact => f !== null);
  const answer: HamiltonAnswer = {
    feeCategory: research.feeCategory,
    headline: segmentLed ? segmentHeadline(seg, research.feeCategory, research.current, research) : headline(research, name),
    claims,
    drivers: economicDrivers(research.economy, research.feeCategory),
    exhibit: (segmentLed ? segmentExhibit(seg, research.feeCategory, research.current, research.institutionName) : null) ?? buildExhibit(research, options.focus),
    question: missingFigure(research),
    evidenceLevel: level,
    provenance: { ...research.provenance, evidenceLevel: level },
  };
  return { ...answer, storyline: buildStoryline(research, answer, { focus: options.focus, ...options.story }) };
}
