import type { FeeCategorySummary } from "@/lib/data-store/fees";
import type { CostScenario } from "./types";

export interface ScenarioCost {
  title: string;
  note?: string;
  /** Each charge at its live national median. */
  parts: { category: string; count: number; median: number }[];
  /** The sum of the parts, or null when a median is missing (the scenario then shows no total). */
  total: number | null;
  /** The median published daily limit, when the scenario names one. */
  cap: number | null;
  /** The total with that limit applied; equals `total` when the limit does not bind. */
  capped: number | null;
  binds: boolean;
}

/**
 * What a scenario costs at the national medians. Every number comes from the same summaries
 * the guide's other figures use, so the arithmetic can never disagree with them.
 */
export function scenarioCost(scenario: CostScenario, summaries: FeeCategorySummary[]): ScenarioCost {
  const median = new Map(summaries.map((s) => [s.fee_category, s.median_amount]));
  const parts = scenario.charges.map((c) => ({ ...c, median: median.get(c.category) ?? null }));
  const complete = parts.every((p) => p.median != null);
  const total = complete ? round(parts.reduce((sum, p) => sum + p.count * (p.median as number), 0)) : null;
  const cap = scenario.capCategory ? (median.get(scenario.capCategory) ?? null) : null;
  const binds = total != null && cap != null && total > cap;
  return {
    title: scenario.title,
    note: scenario.note,
    parts: complete ? parts.map((p) => ({ ...p, median: p.median as number })) : [],
    total,
    cap,
    capped: total == null ? null : binds ? cap : total,
    binds,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
