import { describe, expect, it } from "vitest";

import { workPiles } from "./admin-work-piles";

const base = { labels: 4, answerKeyToCheck: 12, trustPending: 0, contentDrafts: [], verifyCandidates: 7, verifyLimit: 50 };

describe("Your work piles (#1122 step 3)", () => {
  it("lists every pile with its count and where to act", () => {
    const piles = workPiles(base);
    expect(piles.map((pile) => pile.key)).toEqual(["labels", "answer-key", "trust", "content", "verify", "marketing"]);
    expect(piles.find((pile) => pile.key === "labels")).toMatchObject({ count: 4, href: "/admin/knox/labels" });
    expect(piles.find((pile) => pile.key === "verify")).toMatchObject({ count: 7, unit: "banks ready" });
  });

  it("says a read failed instead of showing zero", () => {
    const pile = workPiles({ ...base, trustPending: null }).find((row) => row.key === "trust")!;
    expect(pile.count).toBeNull();
    expect(pile.note).toBe("Could not be read just now.");
  });

  it("dates the oldest draft and says when the verify list is cut", () => {
    const piles = workPiles({
      ...base,
      contentDrafts: [{ createdAt: "2026-10-12T09:00:00Z" }, { createdAt: "2026-10-10T09:00:00Z" }],
      verifyCandidates: 50,
    });
    expect(piles.find((pile) => pile.key === "content")).toMatchObject({ count: 2, oldest: "2026-10-10T09:00:00.000Z" });
    expect(piles.find((pile) => pile.key === "verify")?.unit).toBe("banks shown (the first 50)");
  });

  it("keeps marketing uncounted while it lives in MailerLite", () => {
    expect(workPiles(base).find((pile) => pile.key === "marketing")).toMatchObject({ count: null });
  });
});
