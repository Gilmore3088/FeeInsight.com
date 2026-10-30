import { describe, expect, it } from "vitest";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { STATE_NAMES } from "@/lib/us-states";
import { liveDataFailures } from "../answer-eval";
import { buildAskResponse, parseAsk } from "./ask";
import { MAX_NOTE_WORDS, MAX_STORY_LINE_WORDS, words } from "./four-roles";
import { QUALITY_QUESTIONS, scoreResponse } from "./quality-bar";
import { withDepth } from "./story-extras";
import { overdraftResearch } from "./test-fixtures";
import type { FeeResearch } from "./types";

/**
 * The live answer eval's questions under the shapes live research takes and the fixture alone
 * leaves out (#1076): a peer median for fee income (the eval's institutions all file one) and
 * recent fee changes in the state, the latest by an institution with a long name. Invented
 * figures; nothing here is live data.
 */
function liveShaped(stateCode: string, feeCategory: string): FeeResearch {
  const base = overdraftResearch();
  const fin = base.institutionFinancials!;
  const state = STATE_NAMES[stateCode];
  return overdraftResearch({
    feeCategory,
    displayName: getDisplayName(feeCategory),
    layers: base.layers.map((l) => (l.scope === "state" ? { ...l, label: state, source: { ...l.source, label: `Bank Fee Index, ${state}` } } : l)),
    institutionFinancials: {
      ...fin,
      peerMedian: {
        label: "Credit unions, $300M to $1B in assets",
        quarters: fin.quarters.map((q) => ({ ...q, amount: q.amount - 4_000, institutions: 40 })),
        sourceRef: { label: "NCUA 5300 call report", table: "institution_financial_records", asOf: "2026-06-30" },
      },
    },
    changeEvents: [
      { date: "2026-10-01", institutionName: "First Farmers and Merchants National Bank of Columbia", from: 35, to: 30 },
      { date: "2026-09-20", institutionName: "Peer Two Credit Union", from: 25, to: 28 },
      { date: "2026-09-10", institutionName: "Peer Three Bank", from: 33, to: 29 },
    ],
  });
}

const FEES: Record<string, string> = { q10: "wire_domestic_outgoing", q15: "overdraft", q17: "overdraft", q18: "overdraft", q25: "overdraft" };

describe("the eval's questions on live-shaped research (#1076)", () => {
  for (const id of ["q10", "q15", "q17", "q18", "q25"]) {
    const item = QUALITY_QUESTIONS.find((q) => q.id === id)!;
    it(`${id} "${item.question}" passes the quality bar and names its state in every state`, () => {
      const failing: string[] = [];
      for (const code of Object.keys(STATE_NAMES)) {
        const intent = parseAsk(item.question);
        expect(intent.feeCategory).toBe(FEES[id]);
        const research = liveShaped(code, FEES[id]);
        const response = withDepth(buildAskResponse({ question: item.question, intent, research, memory: [] }), null, null, research.provenance.dataAsOf.fees ?? null);
        const institution = { id: 1, name: research.institutionName, stateCode: code, charterType: "credit_union", assetTier: "credit_union_300m_1b" };
        const failures = [...scoreResponse(item, response).failures, ...liveDataFailures(item, response, institution, null)];
        if (failures.length > 0) failing.push(`${code}: ${failures.join("; ")}`);
      }
      expect(failing).toEqual([]);
    });
  }

  it("keeps the trend exhibit's cohort caveat within an exhibit note's length", () => {
    const item = QUALITY_QUESTIONS.find((q) => q.id === "q17")!;
    const research = liveShaped("TN", "overdraft");
    const response = buildAskResponse({ question: item.question, intent: parseAsk(item.question), research, memory: [] });
    const trend = response.answer!.storyline!.exhibits.find((e) => e.exhibit.kind === "trend")!.exhibit;
    expect(trend.note).toContain("not constant-cohort or merger-adjusted growth");
    expect(words(trend.note!)).toBeLessThanOrEqual(MAX_NOTE_WORDS);
  });

  it("names the latest mover when the line fits, and drops only the name when it does not", () => {
    const item = QUALITY_QUESTIONS.find((q) => q.id === "q17")!;
    const market = (research: FeeResearch) =>
      buildAskResponse({ question: item.question, intent: parseAsk(item.question), research, memory: [] }).answer!.storyline!.lenses.market.map((f) => f.text);
    const short = liveShaped("TN", "overdraft");
    short.changeEvents = short.changeEvents!.map((e, i) => (i === 0 ? { ...e, institutionName: "Peer One Bank" } : e));
    expect(market(short)).toContain("In Tennessee, 2 decreases and 1 increase in 180 days; latest Peer One Bank, $35 to $30 on Oct 1.");
    const long = market(liveShaped("NC", "overdraft"));
    expect(long).toContain("In North Carolina, 2 decreases and 1 increase in 180 days; latest move $35 to $30 on Oct 1.");
    for (const line of long) expect(words(line)).toBeLessThanOrEqual(MAX_STORY_LINE_WORDS);
  });
});
