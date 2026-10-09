import { describe, expect, it } from "vitest";
import { recentLabel, recentQuestions, type SavedAnalysisRow } from "./recent-analyses";

const row = (id: string, title: string, prompt: string, updated_at: string, institution_id = "8109"): SavedAnalysisRow => ({
  id,
  title,
  prompt,
  institution_id,
  updated_at,
});

describe("recentQuestions", () => {
  it("keeps the newest of two saves with the same answer", () => {
    const rows = [
      row("a", "Your $30 overdraft fee is at the 58th percentile of 12 peers (median $30).", "How does our overdraft fee compare to peers?", "2026-10-08 15:38"),
      row("b", "Your $30 overdraft fee is at the 58th percentile of 12 peers (median $30).", "how do my overdraft fees compare to peers", "2026-10-08 15:12"),
      row("c", "Space Coast's biggest pricing gaps are below the market, not above it.", "Which of our fees sit furthest from our peers?", "2026-10-08 16:08"),
    ];
    expect(recentQuestions(rows, 6).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("keeps the same answer for two institutions apart", () => {
    const t = "Your $30 overdraft fee is in line with peers.";
    expect(recentQuestions([row("a", t, "q", "1", "1"), row("b", t, "q", "1", "2")], 6)).toHaveLength(2);
  });

  it("stops at the limit", () => {
    const rows = ["a", "b", "c"].map((id) => row(id, `Answer ${id}.`, "q", "1"));
    expect(recentQuestions(rows, 2).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("recentLabel", () => {
  it("keeps a title that is a whole sentence", () => {
    expect(recentLabel({ title: "Your $30 overdraft fee is at the 58th percentile of 12 peers (median $30).", prompt: "x" })).toBe(
      "Your $30 overdraft fee is at the 58th percentile of 12 peers (median $30).",
    );
  });

  it("uses the question when the saved title stops mid-sentence", () => {
    expect(
      recentLabel({
        title: "Space Coast's national rank of 23rd out of 1,325 midsize institutions overstates",
        prompt: "How does Space Coast's service-charge income compare with only credit unions over $5 billion?",
      }),
    ).toBe("How does Space Coast's service-charge income compare with only credit unions over $5 billion?");
    expect(recentLabel({ title: "Your $30 overdraft fee is at the 56th percentile of 8 $5B+ institutions in Flor…", prompt: "talk to me about $5B and up in florida" })).toBe(
      "Talk to me about $5B and up in florida",
    );
  });

  it("falls back to the saved title when there is no question", () => {
    expect(recentLabel({ title: "The typical institution earned", prompt: null })).toBe("The typical institution earned");
  });
});
