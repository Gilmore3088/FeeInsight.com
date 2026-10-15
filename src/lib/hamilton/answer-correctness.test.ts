import { describe, expect, it } from "vitest";
import { catalogFacts, questionFigures, reconcileAnswer, reconcileMemoText, ties, type LiveFeeValues } from "./answer-correctness";
import { buildAskResponse, parseAsk } from "./workspace/ask";
import { marketLayer } from "./workspace/context";
import { QUALITY_QUESTIONS } from "./workspace/quality-bar";
import { overdraftResearch } from "./workspace/test-fixtures";
import type { FeeResearch, PeerValue } from "./workspace/types";

// Invented figures for tests only; no figure here is live data.
const member = (id: number, amount: number): PeerValue => ({
  institutionId: id,
  institutionName: `Peer ${id}`,
  amount,
  stateCode: "TN",
  sourceDocumentIds: [id],
  documentUrls: [],
  publishedAt: "2026-09-20",
});

/** The fixture's research with every layer built from members, as the live engine builds it. */
function research(): FeeResearch {
  // The fixture numbers its peers from 1, as it does the bank; the bank gets an id of its own here.
  const base = overdraftResearch({ institutionId: 1000 });
  const national = [...base.peers, ...(base.localCompetitors ?? []), member(201, 15), member(202, 0), member(203, 36)];
  const tn = [...base.peers, ...(base.localCompetitors ?? [])];
  return {
    ...base,
    layers: [
      marketLayer("national", "National", national.map((m) => m.amount), base.current, [], national),
      marketLayer("state", "Tennessee", tn.map((m) => m.amount), base.current, [], tn),
    ],
  };
}

/** Live rows that say exactly what the research says: the bank's own row and one per member. */
function liveFor(r: FeeResearch): LiveFeeValues {
  const ids = new Map<number, number>();
  for (const m of [...r.peers, ...(r.localCompetitors ?? []), ...r.layers.flatMap((l) => l.members)]) ids.set(m.institutionId, m.amount);
  return {
    rows: [
      { institution_id: r.institutionId, amount: r.current, fee_category: r.feeCategory },
      ...[...ids].map(([id, amount]) => ({ institution_id: id, amount, fee_category: r.feeCategory })),
    ],
  };
}

describe("answer correctness", () => {
  it("ties every quality-bar answer built on the fixture to live rows that match it", () => {
    const r = research();
    const live = liveFor(r);
    const failing: string[] = [];
    for (const item of QUALITY_QUESTIONS) {
      const intent = parseAsk(item.question);
      if (!intent.feeCategory) continue;
      const response = buildAskResponse({ question: item.question, intent, research: { ...r, feeCategory: intent.feeCategory }, memory: [] });
      const result = reconcileAnswer({ question: item.question, response, research: { ...r, feeCategory: intent.feeCategory }, live: liveFor({ ...r, feeCategory: intent.feeCategory }) });
      if (result.failures.length > 0) failing.push(`${item.id}: ${result.failures.join("; ")}`);
    }
    expect(live.rows.length).toBeGreaterThan(10);
    expect(failing).toEqual([]);
  });

  it("finds the figures in catalog-sourced sentences", () => {
    const r = research();
    const response = buildAskResponse({ question: "How does our overdraft fee compare?", intent: parseAsk("How does our overdraft fee compare?"), research: r, memory: [] });
    expect(catalogFacts(response).length).toBeGreaterThan(0);
    expect(reconcileAnswer({ question: "How does our overdraft fee compare?", response, research: r, live: liveFor(r) }).figures).toBeGreaterThan(0);
  });

  it("fails an answer whose own fee is not the live one", () => {
    const r = research();
    const live = liveFor(r);
    live.rows[0] = { ...live.rows[0], amount: 29 };
    const response = buildAskResponse({ question: "How does our overdraft fee compare?", intent: parseAsk("How does our overdraft fee compare?"), research: r, memory: [] });
    const result = reconcileAnswer({ question: "How does our overdraft fee compare?", response, research: r, live });
    expect(result.failures).toContain("your fee: the answer uses $32, the catalog has $29");
  });

  it("fails a catalog-sourced figure that is no live value or gap", () => {
    const r = research();
    const built = buildAskResponse({ question: "How does our overdraft fee compare?", intent: parseAsk("How does our overdraft fee compare?"), research: r, memory: [] });
    const response = { ...built, facts: [...(built.facts ?? []), { text: "Peers' median is $47.", source: { label: "Fees", table: "published_fee_catalog" } }] };
    const result = reconcileAnswer({ question: "How does our overdraft fee compare?", response, research: r, live: liveFor(r) });
    expect(result.failures).toEqual(["figures that tie to no live catalog value: $47"]);
  });

  it("fails a peer value that is no longer live, and a median that no longer recomputes", () => {
    const r = research();
    const live = liveFor(r);
    const gone = r.peers[0].institutionId;
    live.rows = live.rows.map((row) => (row.institution_id === r.peers[1].institutionId ? { ...row, amount: 40 } : row)).filter((row) => row.institution_id !== gone);
    const response = buildAskResponse({ question: "How does our overdraft fee compare?", intent: parseAsk("How does our overdraft fee compare?"), research: r, memory: [] });
    const failures = reconcileAnswer({ question: "How does our overdraft fee compare?", response, research: r, live }).failures;
    expect(failures).toContain(`peer group (${r.peerLabel}): 1 of 16 values have no live catalog row`);
    expect(failures).toContain(`peer group (${r.peerLabel}): 1 of 16 values differ from the catalog`);
    expect(failures.some((f) => /^National layer: counts \d+ institutions, the catalog has \d+ publishing this fee$/.test(f))).toBe(true);
  });

  it("leaves an answer unchecked when the catalog could not be read", () => {
    const r = research();
    const response = buildAskResponse({ question: "How does our overdraft fee compare?", intent: parseAsk("How does our overdraft fee compare?"), research: r, memory: [] });
    expect(reconcileAnswer({ question: "How does our overdraft fee compare?", response, research: r, live: null })).toEqual({ checked: false, figures: 0, failures: [] });
  });

  it("accepts a stated value, a member's value, a gap between two anchors and the question's own price", () => {
    expect(ties(32, 0.005, [32, 29.5], [])).toBe(true);
    expect(ties(2.5, 0.005, [32, 29.5], [])).toBe(true);
    expect(ties(20, 0.005, [32], [20])).toBe(true);
    expect(ties(12, 0.005, [32], [20])).toBe(false);
    expect(questionFigures("What if we charged $35 for overdraft?")).toEqual([35]);
  });

  describe("the paid memo's text (#1079)", () => {
    const q = "How does our overdraft fee compare?";
    const setup = () => {
      const r = research();
      const response = buildAskResponse({ question: q, intent: parseAsk(q), research: r, memory: [] });
      return { r, response };
    };

    it("ties a memo that states the live fee and a live statistic", () => {
      const { r, response } = setup();
      const median = response.answer?.storyline ? r.band?.median : null;
      const text = `Your overdraft fee is $32.${median != null ? ` The peer median is $${median}.` : ""}`;
      const result = reconcileMemoText({ question: q, response, research: r, live: liveFor(r), text });
      expect(result).toMatchObject({ checked: true, failures: [] });
      expect(result.figures).toBeGreaterThan(0);
    });

    it("fails a memo figure that ties to no live value", () => {
      const { r, response } = setup();
      const result = reconcileMemoText({ question: q, response, research: r, live: liveFor(r), text: "Your overdraft fee is $32 and peers charge $91.37." });
      expect(result.failures).toEqual(["figures that tie to no live catalog value: $91.37"]);
    });

    it("accepts a figure the storyline states from another source, as the free check does", () => {
      const { r, response } = setup();
      const story = response.answer!.storyline!;
      const withIncome = {
        ...response,
        answer: {
          ...response.answer!,
          storyline: { ...story, situation: [...story.situation, { text: "Service charges were $4.2 million last year.", source: { table: "call_reports", label: "Call report" } } as (typeof story.situation)[number]] },
        },
      };
      const result = reconcileMemoText({ question: q, response: withIncome, research: r, live: liveFor(r), text: "Service charges were $4.2 million." });
      expect(result.failures).toEqual([]);
    });

    it("leaves the memo unchecked when the catalog could not be read", () => {
      const { r, response } = setup();
      expect(reconcileMemoText({ question: q, response, research: r, live: null, text: "$32" })).toEqual({ checked: false, figures: 0, failures: [] });
    });
  });
});
