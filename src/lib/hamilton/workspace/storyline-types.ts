/**
 * The storyline contract: how a Hamilton answer reads as a consulting memo instead of a
 * fixed template. Shared by the engine (which builds it from data) and the Pro page
 * (which renders it). Types only.
 *
 * One storyline serves both readers James named (2026-10-06): a CFO taking a decision to
 * the board and a product or marketing manager comparing competitors. The exhibits are the
 * same for both; `lenses` carries what each reader takes from them, and `defaultView`
 * picks which the page opens on. Options are laid side by side and never ranked or picked.
 */

import type { EvidenceLevel, Exhibit, Fact, SegmentMember, SourceRef } from "./types";

export type StorylineKind = "position" | "segment" | "price_test" | "trend" | "structure" | "board_decision";

export type StorylineView = "finance" | "market";

export interface KeyFigure {
  /** As displayed, e.g. "$35" or "39 of 185". */
  value: string;
  label: string;
  source: SourceRef;
  /** Institutions behind the figure, for a market figure. */
  n?: number;
}

export interface StoryExhibit {
  id: string;
  /** Exhibit number in reading order, from 1. */
  number?: number;
  /** The point the exhibit proves, as one sentence with a number. */
  actionTitle: string;
  exhibit: Exhibit;
  takeaway?: Fact;
}

export interface StoryOption {
  label: string;
  /** The dollar price the option tests (0 removes the fee). */
  price?: number;
  consequences: Fact[];
}

export interface Storyline {
  kind: StorylineKind;
  /** The one sentence the whole answer argues, with its number. */
  governingThought: string;
  /** What is true today, one or two lines. */
  situation: Fact[];
  /** What changed or why it matters now, one or two lines; empty when nothing has. */
  complication: Fact[];
  /** At most four. */
  keyFigures: KeyFigure[];
  /** Three to five, in reading order. */
  exhibits: StoryExhibit[];
  lenses: {
    /** For the CFO or board: money at stake, risk, governance, notice. */
    finance: Fact[];
    /** For marketing or product: positioning, competitor moves, message. */
    market: Fact[];
  };
  defaultView?: StorylineView;
  /** Paths to weigh with what each would mean; never ranked, never a pick. */
  options?: StoryOption[];
  /** What would change the conclusion. */
  watch: Fact[];
}

// ─── Exhibit kinds the storyline adds ────────────────────────────────────────

interface ExhibitBase {
  title: string;
  sources: SourceRef[];
  note?: string;
}

export interface SegmentTableExhibit extends ExhibitBase {
  kind: "segment_table";
  /** Largest first. */
  members: SegmentMember[];
  own: number | null;
  ownLabel: string;
}

export interface ChangeTimelineExhibit extends ExhibitBase {
  kind: "change_timeline";
  /** Newest first. */
  events: { date: string; institutionName: string; from: number | null; to: number | null; url: string | null }[];
}

export interface StructureMatrixExhibit extends ExhibitBase {
  kind: "structure_matrix";
  columns: string[];
  /** A null cell means the schedule shows nothing for that column. */
  rows: { name: string; cells: (string | null)[]; own?: boolean }[];
  /** The figures behind an income-split matrix, as numbers, so the page can draw it as a chart. */
  incomeSplit?: IncomeSplitData;
}

/**
 * Fee income per $1,000 of deposits against the peer median, and the gap split into what
 * published prices account for and the rest (how often fees are charged, and which ones).
 * priceExplained is the peer median's income at the bank's prices less the peer median;
 * otherExplained is the remainder, so the two add to own minus peerMedian. Signed dollars.
 */
export interface IncomeSplitData {
  unit: "per_1000_deposits";
  own: number;
  peerMedian: number;
  peerLabel: string;
  n: number;
  /** The bank's published prices against peer medians, peer median = 100; null with no compared fee. */
  priceIndex: number | null;
  priceExplained: number;
  otherExplained: number;
  quarterEnd: string;
}

export interface MoneyAtStakeExhibit extends ExhibitBase {
  kind: "money_at_stake";
  /** Dollars per year, from filings or the bank's own figures only. */
  rows: { label: string; low: number; high: number; evidenceLevel: EvidenceLevel }[];
}

export type ArchetypeKey = "zero_od" | "low_capped" | "mid" | "premium";

export interface ArchetypeMapExhibit extends ExhibitBase {
  kind: "archetype_map";
  archetypes: { key: ArchetypeKey; label: string; rule: string; count: number; names: string[] }[];
  ownKey: ArchetypeKey | null;
}

export type StorylineExhibit =
  | SegmentTableExhibit
  | ChangeTimelineExhibit
  | StructureMatrixExhibit
  | MoneyAtStakeExhibit
  | ArchetypeMapExhibit;

// ─── The written memo over a storyline ───────────────────────────────────────

/**
 * Hamilton's written memo on top of a storyline: prose a partner would hand a client,
 * drawn only from the storyline's own figures. Every dollar figure and percentage is
 * traced back to the storyline before it is shown; a memo that fails is withheld.
 */
export interface StorylineMemo {
  identityContext?: import("../account-context").HamiltonIdentitySnapshot;
  /** Three or four sentences: the answer, why it holds, the decision it raises. */
  summary: string;
  /** For the CFO or board. */
  board: string;
  /** For product and marketing. */
  market: string;
  /** Questions the reader should be able to answer before deciding; never a recommendation. */
  questions: string[];
  model: string;
  generatedAt: string;
  figureCheck: { checked: number; unmatched: string[] };
}

export type StorylineMemoResult =
  | { status: "written"; memo: StorylineMemo }
  | { status: "withheld"; reason: string; /** What the last draft failed on, for the run ledger; never shown. */ problems?: string[] }
  | { status: "unavailable"; reason: string };
