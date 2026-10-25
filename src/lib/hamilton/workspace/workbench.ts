/**
 * Ask Hamilton as a research workbench (#1895): every result uses the same blocks in the same
 * order, and shows the context it used (institution, peers, fee) with where each came from, so
 * the reader never restates what Hamilton already has. Pure; the page renders what this returns.
 */

import { DISPLAY_NAMES, getDisplayName } from "@/lib/fee-taxonomy";
import type { AskContextUsed, AskFeeSource, Provenance, Scenario } from "./types";

/** The fee of the page Ask was opened from, when the address's ?fee= names a fee in the taxonomy. */
export function contextFeeParam(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9_]{2,60}$/.test(value) && Object.hasOwn(DISPLAY_NAMES, value) ? value : null;
}

/** The standard result blocks, in reading order. */
export const RESULT_BLOCKS = [
  { key: "summary", title: "Summary" },
  { key: "key_figures", title: "Key figures" },
  { key: "charts", title: "Charts" },
  { key: "evidence", title: "Evidence" },
  { key: "limitations", title: "Limitations" },
  { key: "next_steps", title: "Next steps" },
] as const;

export type ResultBlockKey = (typeof RESULT_BLOCKS)[number]["key"];

export function blockTitle(key: ResultBlockKey): string {
  return RESULT_BLOCKS.find((b) => b.key === key)!.title;
}

/** The page anchor of a block, so a next step can point at it ("Review assumptions"). */
export function blockAnchor(key: ResultBlockKey): string {
  return `answer-${key.replace(/_/g, "-")}`;
}

// ─── The context the answer used ─────────────────────────────────────────────

/** How the research institution was chosen, in words; null when there is nothing to say. */
const SUBJECT_FROM: Record<string, string> = {
  url: "from the page you came from",
  manual: "your workspace institution",
  profile: "your account's institution",
  watchlist: "from your watchlist",
};

const FEE_FROM: Record<AskFeeSource, string> = {
  question: "named in your question",
  conversation: "carried from earlier in this conversation",
  page: "from the page you came from",
  furthest: "the fee furthest from its peer median, opened in detail",
};

export function askContextUsed(input: {
  subjectName: string;
  selectionSource: string | null | undefined;
  provenance: Pick<Provenance, "peerGroup" | "dataAsOf"> | null | undefined;
  peerLabel: string | null | undefined;
  feeCategory: string | null;
  feeFrom: AskFeeSource | null | undefined;
}): AskContextUsed {
  const group = input.provenance?.peerGroup ?? null;
  const label = group?.label ?? input.peerLabel ?? null;
  return {
    subject: { name: input.subjectName, from: input.selectionSource ?? null },
    peers: label ? { label, n: group?.n ?? null, asOf: input.provenance?.dataAsOf.fees ?? null } : null,
    fee: input.feeCategory ? { category: input.feeCategory, from: input.feeFrom ?? "question" } : null,
  };
}

export interface ContextRow {
  label: string;
  value: string;
  /** Where the value came from, or what stands behind it. */
  note: string | null;
}

function shortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The rows the answer's context strip shows: institution, peers, fee. */
export function contextRows(context: AskContextUsed): ContextRow[] {
  const rows: ContextRow[] = [
    { label: "Institution", value: context.subject.name, note: context.subject.from ? SUBJECT_FROM[context.subject.from] ?? null : null },
  ];
  if (context.peers) {
    const { n, asOf } = context.peers;
    const count = n !== null && context.fee
      ? `${n.toLocaleString("en-US")} ${n === 1 ? "publishes" : "publish"} this fee on schedules read through ${asOf ? shortDate(asOf) : "the latest read"}`
      : null;
    rows.push({ label: "Peers", value: context.peers.label, note: count });
  }
  if (context.fee) {
    rows.push({ label: "Fee", value: getDisplayName(context.fee.category), note: FEE_FROM[context.fee.from] });
  }
  return rows;
}

// ─── Limitations ─────────────────────────────────────────────────────────────

/**
 * What limits the answer: the method's assumptions (peer group rule, one value per institution,
 * a peer group too small for percentiles) and, for a modeled price, the scenario's own. Each is
 * stated once, in the order given.
 */
export function answerLimitations(input: { provenance?: Pick<Provenance, "assumptions"> | null; scenario?: Pick<Scenario, "assumptions"> | null }): string[] {
  const all = [...(input.scenario?.assumptions ?? []), ...(input.provenance?.assumptions ?? [])];
  return [...new Set(all.map((a) => a.trim()).filter(Boolean))];
}

// ─── Next steps ──────────────────────────────────────────────────────────────

export interface NextStep {
  key: "compare_peers" | "try_price" | "review_assumptions" | "add_to_brief";
  label: string;
  href: string;
  primary?: boolean;
}

/**
 * The standard next steps on an answer, each carrying the answer's context so the next page
 * needs nothing restated: compare peers on the fee's research page, try a price, review the
 * assumptions in the answer's Limitations block, and add the saved answer to a board brief.
 */
export function standardNextSteps(input: {
  feeCategory: string | null;
  savedAnalysisId: string | null;
  /** The fee's research page (peers, national and local layers), already carrying the institution. */
  researchHref: string | null;
  /** Try a price for the fee, already carrying the institution. */
  simulateHref: string | null;
}): NextStep[] {
  const steps: NextStep[] = [];
  if (input.researchHref) steps.push({ key: "compare_peers", label: "Compare peers", href: input.researchHref });
  if (input.simulateHref && input.feeCategory) steps.push({ key: "try_price", label: "Try a price", href: input.simulateHref, primary: true });
  steps.push({ key: "review_assumptions", label: "Review assumptions", href: `#${blockAnchor("limitations")}` });
  if (input.savedAnalysisId) {
    steps.push({ key: "add_to_brief", label: "Add to board brief", href: `/pro/reports?from_analysis=${encodeURIComponent(input.savedAnalysisId)}` });
  }
  return steps;
}
