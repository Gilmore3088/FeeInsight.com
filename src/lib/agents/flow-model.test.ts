import { describe, expect, it } from "vitest";
import { describeSamples, latestPerInstitution, movesFromEvents, nowFromSteps, tallyByInstitution, type FlowMove } from "./flow-model";

describe("describeSamples", () => {
  it("says what happened in plain words", () => {
    expect(describeSamples("fetch", [{ status: "failed", reason: "HTTP 404" }])).toEqual({
      text: "Couldn't download it (page not found)",
      tone: "error",
    });
    expect(describeSamples("read", [{ status: "wrong_document" }]).text).toBe("Not a fee schedule; sent back to Magellan");
    expect(describeSamples("extract", [{ inserted: 7 }]).text).toBe("Pulled 7 fees out of the document");
    expect(
      describeSamples("classify", [{ status: "verified" }, { status: "verified" }, { status: "skipped", reason: "x" }]).text,
    ).toBe("Checked 3 fees: 2 passed, 1 held back");
    expect(describeSamples("publish", [{ status: "published" }, { status: "skipped" }]).text).toBe(
      "Published 1 fee to the site, 1 held back",
    );
    expect(
      describeSamples("publish", [{ status: "published" }, { status: "skipped", reason: "Identical fee already published" }]).text,
    ).toBe("Published 1 fee to the site, 1 already live");
  });
});

describe("movesFromEvents", () => {
  it("makes one move per institution per step, named from the lookup", () => {
    const moves = movesFromEvents(
      [{
        id: 9,
        created_at: "2026-10-05T06:05:31Z",
        step_key: "classify",
        state_code: "DE",
        detail: { sample_results: [
          { institution_id: 5, status: "verified" },
          { institution_id: 5, status: "verified" },
          { institution_id: 6, status: "skipped", reason: "Outside range" },
        ] },
      }],
      new Map([[5, "First Bank"]]),
    );
    expect(moves).toHaveLength(2);
    expect(moves[0]).toMatchObject({ agent: "darwin", institutionName: "First Bank", text: "Checked 2 fees: all passed" });
    expect(moves[1]).toMatchObject({ institutionName: "Institution 6", tone: "warn" });
  });
});

describe("institution totals", () => {
  it("uses every institution's real totals, not the ten sample rows", () => {
    // Darwin checked 9 fees at bank 5, but only 2 of them fell into the samples.
    const results = [
      ...Array.from({ length: 8 }, () => ({ institution_id: 5, status: "verified" })),
      { institution_id: 5, status: "skipped", reason: "Outside range" },
    ];
    const moves = movesFromEvents(
      [{
        id: 3,
        created_at: "2026-10-05T22:35:37Z",
        step_key: "classify",
        state_code: "PA",
        detail: {
          sample_results: results.slice(0, 2),
          institution_results: tallyByInstitution("classify", results),
        },
      }],
      new Map([[5, "Armco Federal Credit Union"]]),
    );
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ institutionName: "Armco Federal Credit Union", text: "Checked 9 fees: 8 passed, 1 held back" });
  });

  it("adds up Knox's inserted fees across a bank's documents", () => {
    expect(tallyByInstitution("extract", [{ institution_id: 7, inserted: 4 }, { institution_id: 7, inserted: 2 }])).toEqual([
      { institution_id: 7, total: 6, ok: 6, already_live: 0, reason: null },
    ]);
  });
});

describe("latestPerInstitution", () => {
  it("shows each bank once per column, newest first", () => {
    const move = (key: string, institutionId: number, agent: FlowMove["agent"] = "rosetta"): FlowMove => ({
      key, at: "2026-10-05T22:35:00Z", agent, stateCode: "PA", institutionId, institutionName: `Bank ${institutionId}`, text: "", tone: "ok",
    });
    const moves = [move("a", 1), move("b", 1), move("c", 2, "knox"), move("d", 3), move("e", 1), move("f", 4)];
    expect(latestPerInstitution(moves, (m) => m.agent === "rosetta", 2).map((m) => m.key)).toEqual(["a", "d"]);
  });
});

describe("nowFromSteps", () => {
  it("shows who is working and who is next", () => {
    const now = nowFromSteps([
      { run_id: 1, state_code: "FL", step_key: "extract", status: "running" },
      { run_id: 1, state_code: "FL", step_key: "classify", status: "queued" },
    ]);
    expect(now.find((item) => item.agent === "atlas")?.text).toBe("Running 1 pass: FL");
    expect(now.find((item) => item.agent === "knox")).toMatchObject({ state: "working", text: "Working in FL" });
    expect(now.find((item) => item.agent === "darwin")).toMatchObject({ state: "queued", text: "Next up in FL" });
    expect(now.find((item) => item.agent === "hamilton")?.state).toBe("idle");
  });
});

describe("plain reasons", () => {
  it("never shows the checker's internal codes", () => {
    expect(describeSamples("publish", [{ status: "skipped", reason: 'category guard (name_contradicts): "nsf item"' }]).text).toBe(
      "Held back 1 fee (the fee name doesn't match its type)",
    );
    expect(describeSamples("publish", [{ status: "skipped", reason: "Identical fee already published" }])).toEqual({
      text: "Already live; nothing new to publish",
      tone: "ok",
    });
  });
});
