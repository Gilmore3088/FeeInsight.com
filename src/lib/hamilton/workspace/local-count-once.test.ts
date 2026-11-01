import { describe, expect, it } from "vitest";
import { enoughLocalCompetitors } from "@/lib/hamilton/answer-brief";
import { buildExhibit, buildFeeAnswer } from "./answer";
import { buildDeliverable, SISTER_CHARTERS_NOTE } from "./deliverables";
import { overdraftResearch } from "./test-fixtures";
import type { DecisionRecord, FeeResearch, MarketLayer, PeerValue } from "./types";

// An invented market for tests only; no figure here is live data. Six charters publish an
// overdraft fee, two of them sister charters of one holding company sharing one $28 schedule, so
// the local layer counts five institutions (statistics rule 7). Every sentence must say five.
const rival = (id: number, amount: number, countedAs?: number): PeerValue => ({
  institutionId: id,
  institutionName: `Rival ${id}`,
  amount,
  stateCode: "TN",
  sourceDocumentIds: [id],
  documentUrls: [`https://example.org/rival-${id}.pdf`],
  publishedAt: "2026-09-20",
  ...(countedAs !== undefined ? { countedAs } : {}),
});

const sisterMarket = [rival(201, 25), rival(202, 28), rival(203, 35), rival(204, 28, 202), rival(205, 40), rival(206, 33)];

const localLayer: MarketLayer = {
  scope: "local",
  label: "Local market (Example City, TN)",
  n: 5,
  p25: 28,
  median: 33,
  p75: 35,
  position: null,
  amounts: [25, 28, 33, 35, 40],
  bands: [],
  members: sisterMarket,
  asOf: "2026-09-30",
  source: { label: "Bank Fee Index, local market", table: "published_fee_catalog" },
};

function research(overrides: Partial<FeeResearch> = {}): FeeResearch {
  const base = overdraftResearch();
  return overdraftResearch({ current: 30, localCompetitors: sisterMarket, layers: [...base.layers, localLayer], ...overrides });
}

const decision: DecisionRecord = {
  id: "d1",
  institutionId: 1,
  feeCategory: "overdraft",
  title: "Overdraft fee",
  status: "modeling",
  createdAt: "2026-10-06T08:00:00Z",
  updatedAt: "2026-10-06T08:00:00Z",
};

describe("sister charters in the local market count once in every sentence (G7)", () => {
  it("the local story line counts five competitors and two below, not six and three", () => {
    const story = buildFeeAnswer(research()).storyline!;
    const local = story.exhibits.find((e) => e.exhibit.kind === "competitor_range" && /market/.test(e.actionTitle))!;
    expect(local.actionTitle).toBe("2 of 5 competitors in your market charge less than your $30; their range is $25 to $40.");
    // Every charter keeps its own row.
    expect(local.exhibit.kind === "competitor_range" && local.exhibit.items).toHaveLength(6);
  });

  it("the competitor exhibit title counts five institutions", () => {
    const exhibit = buildExhibit(research(), "competitors")!;
    expect(exhibit.kind).toBe("competitor_range");
    expect(exhibit.title).toBe("Overdraft fees at 5 institutions in your market");
  });

  it("the market lens counts five local competitors, two below", () => {
    const lens = buildFeeAnswer(research()).storyline!.lenses.market.map((f) => f.text);
    expect(lens[0]).toBe("2 of 5 local competitors charge less than your $30; the lowest is Rival 201 ($25).");
    expect(buildFeeAnswer(research()).storyline!.lenses.market[0].sampleSize).toBe(5);
  });

  it("the group statistics line counts five local competitors when one states several fees", () => {
    const several = { low: 38, high: 42, fees: [{ name: "Overdraft item", amount: 38 }, { name: "Overdraft ACH", amount: 42 }] };
    const local = sisterMarket.map((c) => (c.institutionId === 205 ? { ...c, several } : c));
    const lens = buildFeeAnswer(research({ localCompetitors: local })).storyline!.lenses.market;
    expect(lens[0].text).toBe("In group statistics, 2 of 5 local competitors have values below your $30; the named rows show their stated prices.");
    expect(lens[0].sampleSize).toBe(5);
  });

  it("the peers group counts sister charters once too", () => {
    const base = overdraftResearch();
    // Ten publishing rows, the last three sister charters of one schedule: eight counted peers.
    const peers = base.peers.slice(0, 10).map((p, i) => ({ ...p, amount: 20 + i, ...(i >= 7 ? { countedAs: base.peers[7].institutionId } : {}) }));
    const lens = buildFeeAnswer(overdraftResearch({ current: 30, peers, localCompetitors: null, band: { p25: 21.75, median: 23.5, p75: 25.25, n: 8 } })).storyline!.lenses.market;
    expect(lens[0].text).toMatch(/^8 of 8 peers charge less than your \$30/);
    expect(lens[0].sampleSize).toBe(8);
  });

  it("no sentence anywhere in the answer counts six competitors", () => {
    const text = JSON.stringify([buildFeeAnswer(research()), buildExhibit(research(), "competitors")]);
    expect(text).not.toMatch(/\b6 (local )?competitors|at 6 institutions|of 6\b/);
  });

  it("the answer brief gates on the counted competitors", () => {
    expect(enoughLocalCompetitors(sisterMarket)).toBe(true);
    // Five charters, two of them sisters: four counted, below the minimum of five.
    expect(enoughLocalCompetitors(sisterMarket.filter((c) => c.institutionId !== 206))).toBe(false);
    expect(enoughLocalCompetitors(sisterMarket.filter((c) => c.institutionId !== 206).map((c) => ({ ...c, countedAs: undefined })))).toBe(true);
  });

  it("the competitive appendix notes sister charters under the named table only when the counts differ", () => {
    const appendix = buildDeliverable("competitive_appendix", [{ decision, events: [], research: research() }]);
    expect(appendix.sections[0].table?.rows.find((r) => r[0] === localLayer.label)?.[1]).toBe("5");
    expect(appendix.sections[1].table?.rows).toHaveLength(6);
    expect(appendix.sections[1].table?.note).toBe(SISTER_CHARTERS_NOTE);
    expect(SISTER_CHARTERS_NOTE).not.toMatch(/—/);
    const plain = buildDeliverable("competitive_appendix", [{ decision, events: [], research: overdraftResearch() }]);
    expect(plain.sections[1].table?.note).toBeUndefined();
  });
});
