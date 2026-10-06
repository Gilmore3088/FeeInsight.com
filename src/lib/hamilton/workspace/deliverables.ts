/**
 * "Turn this into": the six deliverables built from one or more decisions. Pure and
 * deterministic: every line is a sourced claim, a scenario the reader tested, the option
 * management chose (only when one was chosen) or a step of the implementation plan. The
 * provenance of each decision rides along as an appendix.
 *
 * A deliverable sets out options and consequences. It states the option management chose
 * only when one was chosen, and never recommends one.
 */

import { formatDollarsInWords, formatFeeAmount } from "@/lib/format";
import { buildFeeAnswer } from "./answer";
import { proseFeeName } from "./names";
import type {
  DecisionEvent,
  DecisionRecord,
  DeliverableKind,
  EvidenceLevel,
  Fact,
  FeeResearch,
  ImplementationPlan,
  Provenance,
  WatchCondition,
} from "./types";

export const DELIVERABLE_TITLES: Record<DeliverableKind, string> = {
  ceo_onepager: "CEO one-pager",
  board_memo: "Board memo",
  pricing_packet: "Pricing committee packet",
  competitive_appendix: "Competitive appendix",
  regulatory_summary: "Regulatory summary",
  implementation_checklist: "Implementation checklist",
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
  /** Checklist items (implementation checklist only). */
  checklist?: { text: string; rule?: string }[];
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

function longDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
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
    if (e.kind !== "scenario_tested" && e.kind !== "option_chosen") continue;
    const tested = Number(e.kind === "option_chosen" ? e.detail.amount : e.detail.tested);
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

function lastEvent(events: DecisionEvent[], kind: DecisionEvent["kind"]): DecisionEvent | null {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].kind === kind) return events[i];
  return null;
}

function planOf(events: DecisionEvent[]): ImplementationPlan | null {
  const plan = lastEvent(events, "plan_created")?.detail.plan;
  return plan && typeof plan === "object" ? (plan as ImplementationPlan) : null;
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

function choiceParagraph(input: DeliverableInput): string {
  const chosen = lastEvent(input.events, "option_chosen");
  const name = proseFeeName(input.decision.feeCategory ?? input.research.feeCategory);
  if (!chosen || input.decision.chosenAmount === null) return `Management has not chosen an option for the ${name} fee.`;
  const by = input.decision.chosenBy ? ` (${input.decision.chosenBy})` : "";
  return `Management chose ${money(input.decision.chosenAmount)} for the ${name} fee on ${longDate(chosen.at)}${by}.`;
}

function planSteps(plan: ImplementationPlan): { text: string; rule?: string }[] {
  return [...plan.notice, ...plan.approvals, ...plan.systems, ...plan.monitoring].map((s) => ({ text: s.text, rule: s.rule?.label }));
}

function watchList(watches: WatchCondition[]): string[] {
  return watches.map((w) => w.label);
}

function sectionsFor(kind: DeliverableKind, input: DeliverableInput): DeliverableSection[] {
  const { research, decision, events } = input;
  const answer = buildFeeAnswer(research);
  const name = proseFeeName(research.feeCategory);
  const title = `${name[0].toUpperCase()}${name.slice(1)} fee`;
  const options = optionsTable(input);
  const plan = planOf(events);
  const choice = choiceParagraph(input);

  switch (kind) {
    case "ceo_onepager":
      return [
        {
          heading: title,
          paragraphs: [answer.headline, choice, ...(plan ? [`Earliest effective date: ${longDate(plan.earliestEffectiveDate)}.`] : [])],
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
        { heading: "Management's choice", paragraphs: [choice] },
        ...(plan
          ? [
              {
                heading: "Implementation and compliance",
                paragraphs: [
                  `${plan.noticeRequiredDays > 0 ? `${plan.noticeRequiredDays} days' notice is required` : "No advance notice is required"}; the earliest effective date is ${longDate(plan.earliestEffectiveDate)}.`,
                  plan.caveat,
                ],
                checklist: planSteps(plan),
              },
            ]
          : []),
        ...(decision.watchConditions.length > 0 ? [{ heading: "What would reopen this decision", paragraphs: watchList(decision.watchConditions) }] : []),
      ];
    case "pricing_packet":
      return [
        {
          heading: `${title}: options for the committee`,
          paragraphs: [answer.headline, options ? "Each price below was tested by your team; none is Hamilton's pick." : "No prices have been modeled for this fee yet."],
          facts: answer.claims,
          ...(options ? { table: options } : {}),
        },
        { heading: "Decision status", paragraphs: [choice] },
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
                  rows: [...local].sort((a, b) => a.amount - b.amount).map((p) => [p.institutionName, money(p.amount), p.documentUrls[0] ?? ""]),
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
        ...(plan ? [{ heading: "Notice the chosen change requires", paragraphs: [plan.caveat], checklist: plan.notice.map((s) => ({ text: s.text, rule: s.rule?.label })) }] : []),
      ];
    case "implementation_checklist":
      return plan
        ? [
            {
              heading: `${title}: ${money(plan.current)} to ${money(plan.chosen)}`,
              paragraphs: [`Earliest effective date: ${longDate(plan.earliestEffectiveDate)}.`, plan.caveat],
              checklist: planSteps(plan),
            },
          ]
        : [{ heading: title, paragraphs: ["Management has not chosen an option, so there is no plan to check off yet."] }];
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
