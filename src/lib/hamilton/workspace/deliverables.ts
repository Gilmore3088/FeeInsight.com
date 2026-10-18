/**
 * "Turn this into": the five deliverables built from one or more decisions. Pure and
 * deterministic: every line is a sourced claim or a scenario the reader tested. The
 * provenance of each decision rides along as an appendix.
 *
 * A deliverable sets out options and consequences and never recommends one.
 */

import { formatDollarsInWords, formatFeeAmount } from "@/lib/format";
import { statedFeeText } from "@/lib/own-fee";
import { buildFeeAnswer } from "./answer";
import { proseFeeName } from "./names";
import type {
  DecisionEvent,
  DecisionRecord,
  DeliverableKind,
  EvidenceLevel,
  Fact,
  FeeResearch,
  Provenance,
} from "./types";

export const DELIVERABLE_TITLES: Record<DeliverableKind, string> = {
  ceo_onepager: "CEO one-pager",
  board_memo: "Board memo",
  pricing_packet: "Pricing committee packet",
  competitive_appendix: "Competitive appendix",
  regulatory_summary: "Regulatory summary",
};

export interface DeliverableTable {
  columns: string[];
  rows: string[][];
}

export interface DeliverableSection {
  heading: string;
  paragraphs: string[];
  /** Sourced lines, shown with their source under the paragraphs. */
  facts?: Fact[];
  table?: DeliverableTable;
}

export interface Deliverable {
  kind: DeliverableKind;
  title: string;
  institutionName: string;
  /** ISO date the deliverable was built. */
  preparedOn: string;
  decisionIds: string[];
  sections: DeliverableSection[];
  /** How each decision's figures were built, for the reader to retrace. */
  appendix: { decisionTitle: string; provenance: Provenance }[];
}

/** One decision with what Hamilton needs to write about it. */
export interface DeliverableInput {
  decision: DecisionRecord;
  events: DecisionEvent[];
  research: FeeResearch;
}

interface TestedRow {
  tested: number;
  positionAfter: number | null;
  evidenceLevel: EvidenceLevel | null;
  revenueEffect: { low: number; high: number } | null;
}

const EVIDENCE_LABEL: Record<EvidenceLevel, string> = {
  market: "Market data only",
  working_estimate: "Working estimate (filed income)",
  institution: "Your figures",
};

function money(n: number): string {
  return formatFeeAmount(n) ?? `$${n}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function effectText(effect: { low: number; high: number } | null): string {
  if (!effect) return "No dollar figure";
  const fmt = (n: number) => `${n < 0 ? "-" : "+"}${formatDollarsInWords(Math.abs(n))}`;
  return effect.low === effect.high ? `${fmt(effect.low)} a year` : `${fmt(effect.low)} to ${fmt(effect.high)} a year`;
}

/** Prices tested in the decision, last result per price, in the order first tested. */
export function testedRows(events: DecisionEvent[]): TestedRow[] {
  const byPrice = new Map<number, TestedRow>();
  for (const e of events) {
    if (e.kind !== "scenario_tested") continue;
    const tested = Number(e.detail.tested);
    if (!Number.isFinite(tested)) continue;
    const effect = e.detail.revenueEffect as { low?: unknown; high?: unknown } | null | undefined;
    const row: TestedRow = {
      tested,
      positionAfter: typeof e.detail.positionAfter === "number" ? e.detail.positionAfter : byPrice.get(tested)?.positionAfter ?? null,
      evidenceLevel: (e.detail.evidenceLevel as EvidenceLevel | undefined) ?? byPrice.get(tested)?.evidenceLevel ?? null,
      revenueEffect:
        effect && typeof effect.low === "number" && typeof effect.high === "number"
          ? { low: effect.low, high: effect.high }
          : byPrice.get(tested)?.revenueEffect ?? null,
    };
    byPrice.set(tested, row);
  }
  return [...byPrice.values()];
}

function optionsTable(input: DeliverableInput): DeliverableTable | null {
  const rows = testedRows(input.events);
  if (rows.length === 0) return null;
  const current = input.research.current;
  return {
    columns: ["Price", "Position among peers", "Annual fee income effect", "Evidence"],
    rows: [
      ...(current !== null ? [[`${money(current)} (today)`, "", "", ""]] : []),
      ...rows.map((r) => [
        money(r.tested),
        r.positionAfter !== null ? `${ordinal(r.positionAfter)} percentile` : "Too few peers to rank",
        effectText(r.revenueEffect),
        r.evidenceLevel ? EVIDENCE_LABEL[r.evidenceLevel] : "",
      ]),
    ],
  };
}

function sectionsFor(kind: DeliverableKind, input: DeliverableInput): DeliverableSection[] {
  const { research } = input;
  const answer = buildFeeAnswer(research);
  const name = proseFeeName(research.feeCategory);
  const title = `${name[0].toUpperCase()}${name.slice(1)} fee`;
  const options = optionsTable(input);

  switch (kind) {
    case "ceo_onepager":
      return [
        {
          heading: title,
          paragraphs: [answer.headline],
          facts: answer.claims.slice(0, 3),
          ...(options ? { table: options } : {}),
        },
      ];
    case "board_memo":
      return [
        { heading: `${title}: what the market shows`, paragraphs: [answer.headline], facts: answer.claims },
        ...(answer.drivers.length > 0 ? [{ heading: "Why it sits there", paragraphs: [], facts: answer.drivers }] : []),
        {
          heading: "Options considered",
          paragraphs: options ? [] : ["No prices have been modeled for this fee yet."],
          ...(options ? { table: options } : {}),
        },
      ];
    case "pricing_packet":
      return [
        {
          heading: `${title}: options for the committee`,
          paragraphs: [answer.headline, options ? "Each price below was tested by your team; none is Hamilton's pick." : "No prices have been modeled for this fee yet."],
          facts: answer.claims,
          ...(options ? { table: options } : {}),
        },
      ];
    case "competitive_appendix": {
      const layers = research.layers.filter((l) => l.median !== null);
      const local = research.localCompetitors ?? [];
      return [
        {
          heading: `${title}: market layers`,
          paragraphs: [answer.headline],
          table: {
            columns: ["Market", "Institutions", "25th percentile", "Median", "75th percentile"],
            rows: layers.map((l) => [l.label, l.n.toLocaleString("en-US"), money(l.p25 as number), money(l.median as number), money(l.p75 as number)]),
          },
        },
        ...(local.length > 0
          ? [
              {
                heading: "Named competitors in your market",
                paragraphs: [],
                table: {
                  columns: ["Institution", "Fee", "Schedule"],
                  rows: [...local].sort((a, b) => a.amount - b.amount).map((p) => [p.institutionName, statedFeeText(p.amount, p.several, money), p.documentUrls[0] ?? ""]),
                },
              },
            ]
          : []),
      ];
    }
    case "regulatory_summary":
      return [
        {
          heading: `${title}: rules and recent releases`,
          paragraphs: research.regulation.length > 0 ? [] : ["No rule or regulator release is on file for this fee."],
          facts: research.regulation,
        },
      ];
  }
}

export function buildDeliverable(kind: DeliverableKind, inputs: DeliverableInput[], preparedOn = new Date().toISOString()): Deliverable {
  const institutionName = inputs[0]?.research.institutionName ?? "";
  return {
    kind,
    title: `${DELIVERABLE_TITLES[kind]}: ${inputs.map((i) => i.decision.title).join(", ")}`,
    institutionName,
    preparedOn: preparedOn.slice(0, 10),
    decisionIds: inputs.map((i) => i.decision.id),
    sections: inputs.flatMap((i) => sectionsFor(kind, i)),
    appendix: inputs.map((i) => ({ decisionTitle: i.decision.title, provenance: i.research.provenance })),
  };
}
