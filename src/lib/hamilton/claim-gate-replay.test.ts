import { describe, expect, it } from "vitest";
import { replayClaimGoldenCase, replayClaimGoldenGate } from "./claim-gate-replay";
import { CLAIM_GOLDEN_CASES, CLAIM_GOLDEN_PERSONAS, type ClaimGoldenCase } from "./claim-golden-set";

/**
 * The golden replay as a CI gate (V5 plan T5, #1077): every case through the one output gate,
 * failing the build when a non-control case is not held or partial as its target says, or a
 * control is not validated. Deterministic: no reads, no model calls.
 */
describe("the claim golden set replayed through the one output gate, as a CI gate", () => {
  const replay = replayClaimGoldenGate();

  it.each(replay.results.map((r) => [r.id, r] as const))("%s meets its target", (_id, result) => {
    if (result.control) expect(result.unified, `${result.id}: ${result.codes.join(", ")}`).toBe("validated");
    else {
      expect(["held", "ready_partial"], result.id).toContain(result.target);
      expect(result.unified, `${result.id}: ${result.codes.join(", ")}`).toBe(result.target);
    }
  });

  it("misses no case, and counts every control validated", () => {
    expect(replay.misses).toEqual([]);
    expect(replay.meetsTarget).toBe(replay.total);
    expect(replay.controlsValidated).toBe(replay.controls);
    expect(replay.total).toBe(CLAIM_GOLDEN_CASES.length);
  });

  it("asks as each of the five personas, with a case that must be held and a control for each", () => {
    for (const persona of CLAIM_GOLDEN_PERSONAS) {
      const mine = replay.results.filter((r) => r.persona === persona);
      expect(mine.some((r) => r.control), persona).toBe(true);
      expect(mine.some((r) => !r.control && r.target === "held"), persona).toBe(true);
    }
  });

  it("fails a case whose gate status misses its target, so the gate cannot pass everything", () => {
    const control = CLAIM_GOLDEN_CASES.find((c) => c.id === "it-yoy-control")!;
    // The same control's text with the wrong quarter is held, so as a control it misses.
    const wrong = { ...control, text: "Bank A's service charge income fell 4.2% from Q1 2025 to Q1 2026." } as ClaimGoldenCase;
    expect(replayClaimGoldenCase(wrong).result).toMatchObject({ unified: "held", meetsTarget: false });
    // A held target shown partial misses too: partial is not held.
    const partial = CLAIM_GOLDEN_CASES.find((c) => c.id === "sb-competitor-carried")!;
    expect(replayClaimGoldenCase({ ...partial, target: { ...partial.target, status: "held" } } as ClaimGoldenCase).result.meetsTarget).toBe(false);
    expect(replayClaimGoldenGate([wrong]).misses).toEqual(["it-yoy-control"]);
  });
});
