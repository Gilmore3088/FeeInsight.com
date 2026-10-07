import { describe, expect, it } from "vitest";
import { memoPayload, memoProblems } from "../memo";
import { buildFeeAnswer } from "./answer";
import { evaluateFourRoles } from "./four-roles";
import { overdraftResearch } from "./test-fixtures";
import type { FeeResearch, RateResearch } from "./types";

// Invented figures for tests only; no figure here is live data.
const national: RateResearch["national"] = { n: 40, median: 1, p25: 1, p75: 2, min: 0.5, max: 3 };
const source = { label: "Fees stated as a rate on each institution's own published schedule (verified, live)", table: "published_fee_rate_catalog", asOf: "2026-10-06" };

function foreignResearch(rates: RateResearch | null, overrides: Partial<FeeResearch> = {}): FeeResearch {
  return overdraftResearch({
    feeCategory: "card_foreign_txn",
    displayName: "Foreign Transaction Fee",
    current: null,
    ownRows: [],
    peers: [],
    band: null,
    bands: [],
    layers: [],
    localCompetitors: null,
    revenueLine: null,
    rates,
    ...overrides,
  });
}

const ownThree: RateResearch = {
  own: [{ feeName: "Foreign transaction fee", label: "3% of the transaction", ratePercent: 3, sourceUrl: "https://example.test/schedule.pdf" }],
  national,
  source,
};

describe("fees stated as a rate", () => {
  it("leads with the bank's own rate against the national median rate, never a dollar figure", () => {
    const answer = buildFeeAnswer(foreignResearch(ownThree));
    expect(answer.headline).toBe("Your foreign transaction fee is 3% of the transaction, above the 1% national median.");
    expect(answer.claims[0].text).toBe("Your schedule states the foreign transaction fee as 3% of the transaction.");
    expect(answer.claims[0].source.table).toBe("published_fee_rate_catalog");
    expect(answer.claims[1].text).toContain("Stated as a rate, the national median is 1% across 40 institutions; the middle half runs 1% to 2%.");
    expect(answer.claims[1].sampleSize).toBe(40);
    // No per-item dollar question for a fee charged as a rate; the volume it applies to instead.
    expect(answer.question?.fieldKey).toBe("fee.card_foreign_txn.annual_volume");
    expect(answer.headline).not.toMatch(/\$/);
  });

  it("carries a rate exhibit, key figures and a market line in the storyline, and passes the four roles", () => {
    const answer = buildFeeAnswer(foreignResearch(ownThree));
    const story = answer.storyline!;
    const rate = story.exhibits.find((e) => e.id.endsWith("-rate"))!;
    expect(rate.actionTitle).toBe("Your 3% foreign transaction rate is above the national median rate of 1% across 40 institutions.");
    expect(rate.exhibit.kind).toBe("structure_matrix");
    if (rate.exhibit.kind === "structure_matrix") {
      expect(rate.exhibit.rows.map((r) => r.cells[0])).toEqual(["3% of the transaction", "1%", "1% to 2%", "0.5% to 3%"]);
    }
    expect(story.keyFigures.map((k) => k.value).slice(0, 2)).toEqual(["3%", "1%"]);
    expect(story.lenses.market[0].text).toBe("At 3%, you sit above the middle half of 40 institutions (1% to 2%); competitors can claim a lower rate.");
    expect(evaluateFourRoles(answer).roles.flatMap((r) => r.failures)).toEqual([]);
  });

  it("says so when too few institutions state a rate, and fills nothing in", () => {
    const thin: RateResearch = { ...ownThree, national: { n: 2, median: null, p25: null, p75: null, min: null, max: null } };
    const answer = buildFeeAnswer(foreignResearch(thin));
    expect(answer.headline).toBe("Your foreign transaction fee is 3% of the transaction; too few institutions state a rate to compare.");
    expect(answer.claims.map((c) => c.text)).toContain("Only 2 institutions state the foreign transaction fee as a rate, too few for a national median.");
  });

  it("keeps dollar answers unchanged and adds the national rate after them", () => {
    const answer = buildFeeAnswer(overdraftResearch({ feeCategory: "card_foreign_txn", rates: { own: [], national, source } }));
    expect(answer.headline).toMatch(/^Your \$/);
    const last = answer.claims.findIndex((c) => c.source.table === "published_fee_rate_catalog");
    expect(last).toBeGreaterThan(0);
  });

  it("lets a memo quote the storyline's rates and catches a rate it invented", () => {
    const story = buildFeeAnswer(foreignResearch(ownThree)).storyline!;
    const payload = memoPayload(story);
    const draft = (summary: string) => ({ summary, board: "Board text.", market: "Market text.", questions: [] });
    expect(memoProblems(draft("Your 3% rate sits above the 1% national median."), payload).problems).toEqual([]);
    expect(memoProblems(draft("Your 3% rate sits above the 1.8% national median."), payload).problems[0]).toContain("1.8%");
  });
});
