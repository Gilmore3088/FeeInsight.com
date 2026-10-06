import { describe, expect, it, vi } from "vitest";

import {
  CATEGORY_DISPUTE_THRESHOLD,
  categoryOpinion,
  categoryTokens,
  loadCategoryModel,
  resetCategoryModelCache,
  scoreCategories,
  trainCategoryModel,
} from "./category-model";

const EXAMPLES = [
  { name: "Outgoing domestic wire transfer", categoryKey: "wire_domestic_outgoing", count: 40 },
  { name: "Wire transfer outgoing", categoryKey: "wire_domestic_outgoing", count: 30 },
  { name: "Incoming wire transfer", categoryKey: "wire_domestic_incoming", count: 30 },
  { name: "Wire incoming domestic", categoryKey: "wire_domestic_incoming", count: 20 },
  { name: "Night deposit bag", categoryKey: "night_deposit", count: 20 },
  { name: "Zipper bag", categoryKey: "night_deposit", count: 10 },
  { name: "Stop payment", categoryKey: "stop_payment", count: 50 },
  { name: "Stop payment request", categoryKey: "stop_payment", count: 20 },
];

describe("Darwin learned category model", () => {
  const model = trainCategoryModel(EXAMPLES);

  it("pairs adjacent words so outgoing and incoming wires differ", () => {
    expect(categoryTokens("Wire Transfer - Outgoing")).toEqual(["wire", "transf", "outgoi", "wire_transf", "transf_outgoi"]);
  });

  it("gives probabilities that sum to one", () => {
    const total = Array.from(scoreCategories(model, "Stop payment").values()).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("disputes a category the name does not support and suggests the likely one", () => {
    const opinion = categoryOpinion(model, "Zipper Bags", "wire_domestic_incoming");
    expect(opinion?.disputed).toBe(true);
    expect(opinion?.probability).toBeLessThan(CATEGORY_DISPUTE_THRESHOLD);
    expect(opinion?.suggested).toBe("night_deposit");
  });

  it("agrees with a category the name supports", () => {
    const opinion = categoryOpinion(model, "Wire Transfer, outgoing", "wire_domestic_outgoing");
    expect(opinion?.disputed).toBe(false);
    expect(opinion?.suggested).toBe("wire_domestic_outgoing");
  });

  it("has no opinion on an unseen category or a name without words", () => {
    expect(categoryOpinion(model, "Coin counting", "coin_counting")).toBeNull();
    expect(categoryOpinion(model, "$5.00", "stop_payment")).toBeNull();
  });

  it("trains from the live catalog once and caches the model", async () => {
    resetCategoryModelCache();
    const db = vi.fn(() => Promise.resolve(EXAMPLES.map((example) => ({
      name: example.name.toLowerCase(),
      category_key: example.categoryKey,
      count: String(example.count),
    }))));
    const loaded = await loadCategoryModel(db as never, 1_000);
    expect(loaded?.categories).toHaveLength(4);
    await loadCategoryModel(db as never, 2_000);
    expect(db).toHaveBeenCalledTimes(1);
    resetCategoryModelCache();
  });
});
