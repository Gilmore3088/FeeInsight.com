import { describe, expect, it } from "vitest";
import { buildAskResponse, parseAsk } from "./ask";
import { QUALITY_QUESTIONS, scoreResponse, summarize } from "./quality-bar";
import { asksWholeSchedule, scheduleOverview } from "./schedule";
import { withDepth } from "./story-extras";
import { asksIncomeWhy, explainIncome, incomeSplit } from "./why";
import { overdraftResearch } from "./test-fixtures";
import { getDisplayName } from "@/lib/fee-taxonomy";
import type { AskResponse, FeePositionRow } from "./types";

// Invented research for tests only; no figure here is live data.
const schedule: FeePositionRow[] = [
  { feeCategory: "overdraft", displayName: "Overdraft (OD)", current: 32, band: { p25: 25.75, median: 29.5, p75: 32, n: 16 }, peerLabel: "peers" },
  { feeCategory: "nsf", displayName: "NSF / Returned Item", current: 25, band: { p25: 20, median: 29, p75: 30, n: 14 }, peerLabel: "peers" },
  { feeCategory: "stop_payment", displayName: "Stop Payment", current: 30, band: { p25: 25, median: 30, p75: 32, n: 12 }, peerLabel: "peers" },
  { feeCategory: "wire_transfer", displayName: "Wire Transfer", current: 25, band: null, peerLabel: "peers" },
];

const intensity = { quarterEnd: "2026-06-30", own: 1.9, peerMedian: 1.5, peers: 180, peersBelow: 140 };

function ask(question: string): AskResponse {
  // The same path as the Ask route: the overview, the income split and their storyline exhibits.
  let intent = parseAsk(question);
  const overview = !intent.feeCategory && asksWholeSchedule(question) ? scheduleOverview(schedule) : null;
  if (overview?.top) intent = { ...intent, feeCategory: overview.top };
  const split = asksIncomeWhy(question) ? incomeSplit(intensity, schedule, "credit unions with $300M to $1B in assets") : null;
  const why = split ? { split, explained: explainIncome(split), top: scheduleOverview(schedule).top } : null;
  if (!intent.feeCategory && why?.top) intent = { ...intent, feeCategory: why.top };
  const fee = intent.feeCategory;
  const research = fee ? overdraftResearch({ feeCategory: fee, displayName: getDisplayName(fee) }) : null;
  const response = buildAskResponse({ question, intent, research, memory: [] });
  return withDepth(response, overview, why, research?.provenance.dataAsOf.fees ?? null);
}

describe("Hamilton quality bar: 30 consultant questions", () => {
  const score = summarize(QUALITY_QUESTIONS.map((item) => scoreResponse(item, ask(item.question))));

  it("has exactly 30 distinct questions", () => {
    expect(new Set(QUALITY_QUESTIONS.map((q) => q.question)).size).toBe(30);
  });

  it("answers every question to the bar", () => {
    const failing = score.results.filter((r) => r.failures.length > 0);
    console.info(`Hamilton quality bar: ${score.passed}/${score.total}`);
    for (const r of failing) console.info(`  ${r.id} ${r.question}\n    - ${r.failures.join("\n    - ")}`);
    expect(failing.map((r) => `${r.id}: ${r.failures.join("; ")}`)).toEqual([]);
  });
});
