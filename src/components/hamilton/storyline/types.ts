/**
 * The storyline answer shape proposed to the engine (2026-10-06). The engine builds it; the Pro
 * page only draws it. Kept here until the engine exports its own types, then swapped for them.
 */
import type { Exhibit, Fact, SourceRef } from "@/lib/hamilton/workspace/types";
import type { SegmentRow } from "@/components/hamilton/memo/segment-table";

export type StoryKind = "position" | "segment" | "price_test" | "trend" | "structure" | "board_decision";

export type StoryExhibitData =
  | Exhibit
  | { kind: "segment_table"; title: string; members: SegmentRow[]; own: number | null; ownLabel: string; sources: SourceRef[]; note?: string }
  | {
      kind: "change_timeline";
      title: string;
      events: { date: string; institutionName: string; from: number | null; to: number | null; url: string | null }[];
      sources: SourceRef[];
      note?: string;
    }
  | {
      kind: "structure_matrix";
      title: string;
      columns: string[];
      rows: { name: string; cells: (string | null)[]; own?: boolean }[];
      sources: SourceRef[];
      note?: string;
    }
  | {
      kind: "money_at_stake";
      title: string;
      rows: { label: string; low: number; high: number; evidenceLevel: "market" | "working_estimate" | "institution" }[];
      sources: SourceRef[];
      note?: string;
    }
  | {
      kind: "archetype_map";
      title: string;
      archetypes: { key: "zero_od" | "low_capped" | "mid" | "premium"; label: string; rule: string; count: number; names: string[] }[];
      ownKey: string | null;
      sources: SourceRef[];
      note?: string;
    };

export interface StoryExhibit {
  id: string;
  /** The exhibit's point as a sentence. */
  actionTitle: string;
  exhibit: StoryExhibitData;
  takeaway?: Fact;
}

export interface Storyline {
  kind: StoryKind;
  governingThought: string;
  situation: Fact[];
  complication: Fact[];
  keyFigures: { value: string; label: string; source: SourceRef; n?: number }[];
  exhibits: StoryExhibit[];
  lenses: { finance: Fact[]; market: Fact[] };
  options?: { label: string; consequences: Fact[] }[];
  watch: Fact[];
}
