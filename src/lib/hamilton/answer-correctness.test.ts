import { describe, expect, it } from "vitest";
import { catalogFacts, questionFigures, reconcileAnswer, reconcileMemoText, reconcileSimulateText, ties, type LiveFeeValues } from "./answer-correctness";
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
    expect(result.failures).toEqual([expect.stringMatching(/^figures that tie to no live catalog value: \$47 \(/)]);
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

  it("recomputes a band that counts sister charters on one shared schedule once (rule 7, #1441)", () => {
    // Peers 303 and 304 are sister charters of 302 reading one schedule: five values count, seven are listed.
    const sisters = [10, 20, 30, 32, 34, 40, 50].map((amount, i) => ({ ...member(300 + i, amount), ...(i === 3 || i === 4 ? { countedAs: 302 } : {}) }));
    const base = research();
    const withLayer = (amounts: number[]): FeeResearch => ({ ...base, layers: [base.layers[0], marketLayer("state", "Tennessee", amounts, base.current, [], sisters)] });
    const check = (r: FeeResearch) => {
      const response = buildAskResponse({ question: "How does our overdraft fee compare?", intent: parseAsk("How does our overdraft fee compare?"), research: r, memory: [] });
      return reconcileAnswer({ question: "How does our overdraft fee compare?", response, research: r, live: liveFor(r) }).failures.filter((f) => f.startsWith("Tennessee layer"));
    };
    expect(check(withLayer([10, 20, 32, 40, 50]))).toEqual([]);
    expect(check(withLayer(sisters.map((m) => m.amount)))).toEqual(["Tennessee layer: p25, p75 do not recompute from the members' live values"]);
  });

  describe("the transfer from savings in the structure line (#2029)", () => {
    const q = "How does our overdraft fee compare?";
    // Two peers price a transfer at $8.37 and $9.13, so the line says "typically $8.75".
    const transfers: Record<number, number> = { 501: 8.37, 502: 9.13 };
    const withStructure = (): FeeResearch => {
      const base = research();
      const others = [501, 502, 503, 504, 505, 506].map((id) => ({
        institutionId: id,
        name: `Peer ${id}`,
        own: false,
        values: { overdraft: 30, ...(id in transfers ? { od_protection_transfer: transfers[id] } : {}) },
      }));
      return {
        ...base,
        structure: {
          groupLabel: "peers (Credit unions in Tennessee)",
          columns: [{ category: "od_protection_transfer", label: "Transfer fee" }],
          rows: [{ institutionId: base.institutionId, name: "Example", own: true, values: { overdraft: 32 } }, ...others],
          source: { label: "Fees", table: "published_fee_catalog" },
        },
      };
    };
    const transferRows = (amounts: Record<number, number>) =>
      Object.entries(amounts).map(([id, amount]) => ({ institution_id: Number(id), amount, fee_category: "od_protection_transfer" }));
    const check = (live: LiveFeeValues) => {
      const r = withStructure();
      const response = buildAskResponse({ question: q, intent: parseAsk(q), research: r, memory: [] });
      expect(catalogFacts(response).map((f) => f.text)).toContainEqual(expect.stringContaining("typically $8.75"));
      return reconcileAnswer({ question: q, response, research: r, live }).failures;
    };

    it("ties the typical transfer to the members' live transfer values", () => {
      expect(check({ ...liveFor(withStructure()), transferRows: transferRows(transfers) })).toEqual([]);
    });

    it("fails a transfer value that moved or left the catalog, and the typical figure built on it", () => {
      const moved = check({ ...liveFor(withStructure()), transferRows: transferRows({ 501: 8.37, 502: 14 }) });
      expect(moved).toContain("transfer from savings (structure group): 1 of 2 values differ from the catalog");
      expect(moved).toContainEqual(expect.stringMatching(/^figures that tie to no live catalog value: \$8\.75 \(/));
      const gone = check({ ...liveFor(withStructure()), transferRows: transferRows({ 501: 8.37 }) });
      expect(gone).toContain("transfer from savings (structure group): 1 of 2 values have no live catalog row");
    });

    it("cannot tie the typical transfer when the transfer values were not read", () => {
      expect(check(liveFor(withStructure()))).toContainEqual(expect.stringMatching(/^figures that tie to no live catalog value: \$8\.75 \(/));
    });
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
      expect(result.failures).toEqual([expect.stringMatching(/^figures that tie to no live catalog value: \$91\.37 \(/)]);
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

    it("skips the overdraft pricing groups' fixed rules, but still checks a fee beside them", () => {
      const { r, response } = setup();
      const text = "Your $32 puts you in the mid group ($15.01 to $30) with 4 peers. Of 9 peers: 5 at $15.01–$30 and 4 over $30.";
      expect(reconcileMemoText({ question: q, response, research: r, live: liveFor(r), text }).failures).toEqual([]);
      const untied = reconcileMemoText({ question: q, response, research: r, live: liveFor(r), text: `${text} Peers charge $15.01.` });
      expect(untied.failures).toEqual([expect.stringMatching(/^figures that tie to no live catalog value: \$15\.01 \(/)]);
    });

    it.each([
      ["Peers charge up to $15.50.", "$15.50"],
      ["2 peers charge up to $150.", "$150"],
      ["3 over $300 stand out.", "$300"],
      ["The top fee is just over $30.33 here.", "$30.33"],
    ])("still checks a fee that only starts like a group rule: %s", (text, figure) => {
      const { r, response } = setup();
      const result = reconcileMemoText({ question: q, response, research: r, live: liveFor(r), text });
      expect(result.failures).toEqual([expect.stringContaining(`value: ${figure} (`)]);
    });

    it("leaves the memo unchecked when the catalog could not be read", () => {
      const { r, response } = setup();
      expect(reconcileMemoText({ question: q, response, research: r, live: null, text: "$32" })).toEqual({ checked: false, figures: 0, failures: [] });
    });
  });

  describe("a Simulate read's text (#1414)", () => {
    const q = "How does our overdraft fee compare?";
    const setup = () => {
      const r = research();
      return { r, response: buildAskResponse({ question: q, intent: parseAsk(q), research: r, memory: [] }) };
    };

    it("ties a gap stated from the tested price, and fails a figure that ties to nothing", () => {
      const { r, response } = setup();
      const p75 = r.band!.p75!;
      const tested = 43.17;
      const gap = Math.abs(tested - p75).toFixed(2);
      const text = `At $43.17 the fee would sit $${gap} from the peer p75 of $${p75.toFixed(2)}.`;
      const ok = reconcileSimulateText({ question: q, response, research: r, live: liveFor(r), text, readerAnchors: [tested, r.current!] });
      expect(ok).toMatchObject({ checked: true, figures: 3, failures: [] });
      // As a single (the old memo path), the tested price could not anchor the gap.
      expect(reconcileMemoText({ question: q, response, research: r, live: liveFor(r), text, extra: [tested] }).failures).toEqual([expect.stringMatching(new RegExp(`^figures that tie to no live catalog value: \\$${String(gap).replace(".", "\\.")} \\(`))]);
      const bad = reconcileSimulateText({ question: q, response, research: r, live: liveFor(r), text: "At $43.17 peers would charge $91.37.", readerAnchors: [tested] });
      expect(bad.failures).toEqual([expect.stringMatching(/^figures that tie to no live catalog value: \$91\.37 \(/)]);
    });

    it("scores only the read's figures, not the free answer's stale values", () => {
      const { r, response } = setup();
      const stale = liveFor(r);
      // One peer's live value has moved since the free answer read it: the answer's failure, not the read's.
      stale.rows = stale.rows.map((row, i) => (i === 1 ? { ...row, amount: Number(row.amount) + 7 } : row));
      expect(reconcileMemoText({ question: q, response, research: r, live: stale, text: "At $41.25." }).failures.length).toBeGreaterThan(0);
      expect(reconcileSimulateText({ question: q, response, research: r, live: stale, text: "At $41.25.", readerAnchors: [41.25] }).failures).toEqual([]);
    });
  });
});
