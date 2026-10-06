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
