"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/hamilton/dashboard";
import { StoryExhibitView } from "./story-exhibits";
import type { StoryExhibit } from "./types";

/** A short tab name for each kind of exhibit; a repeated kind takes its exhibit number. */
const KIND_TAB: Record<string, string> = {
  fee_position: "Position",
  competitor_range: "Competitors",
  trend: "Trend",
  peer_list: "Peer list",
  segment_table: "Segment",
  change_timeline: "Changes",
  structure_matrix: "Table",
  money_at_stake: "Money at stake",
  archetype_map: "Market map",
};

export function exhibitTabLabels(items: readonly StoryExhibit[]): string[] {
  const base = items.map((item) => KIND_TAB[item.exhibit.kind] ?? "Exhibit");
  return base.map((label, i) => {
    const repeated = base.filter((b) => b === label).length > 1;
    return repeated ? `${label} ${items[i].number ?? i + 1}` : label;
  });
}

/**
 * The answer's exhibits one at a time, switched by tabs (a labelled group of aria-pressed
 * buttons). Each exhibit is drawn exactly as the answer built it, under its own numbered title.
 */
export function ExhibitTabs({ items, researchInstitutionName }: { items: StoryExhibit[]; researchInstitutionName?: string | null }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  const current = items.find((item) => item.id === active) ?? items[0];
  if (!current) return null;
  const labels = exhibitTabLabels(items);
  const index = items.indexOf(current);
  return (
    <div className="flex flex-col gap-3">
      {items.length > 1 ? (
        <SegmentedControl
          label="Choose a chart"
          options={items.map((item, i) => ({ value: item.id, label: labels[i] }))}
          value={current.id}
          onChange={setActive}
        />
      ) : null}
      <div className="ha-chart-body">
        <StoryExhibitView key={current.id} item={current} number={current.number ?? index + 1} researchInstitutionName={researchInstitutionName} />
      </div>
    </div>
  );
}
