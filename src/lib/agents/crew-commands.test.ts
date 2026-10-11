import { describe, expect, it } from "vitest";
import { describeWrite, isWriteCommand, parseCrewCommand, parseState } from "./crew-commands";

describe("parseState", () => {
  it("accepts names and codes", () => {
    expect(parseState("Georgia")).toBe("GA");
    expect(parseState("new york")).toBe("NY");
    expect(parseState("tx")).toBe("TX");
    expect(parseState("Narnia")).toBeNull();
  });
});

describe("parseCrewCommand", () => {
  it.each<[string, object]>([
    ["status", { kind: "status", agent: "atlas" }],
    ["Atlas, how are we doing?", { kind: "status", agent: "atlas" }],
    ["Magellan", { kind: "status", agent: "magellan" }],
    ["what's stuck?", { kind: "stuck", agent: "atlas" }],
    ["is Georgia done?", { kind: "is-done", agent: "atlas", stateCode: "GA" }],
    ["Atlas, run Georgia", { kind: "run", agent: "atlas", scope: { kind: "state", stateCode: "GA" } }],
    ["Hey Magellan, run Texas", { kind: "run", agent: "magellan", scope: { kind: "state", stateCode: "TX" } }],
    ["run all due states", { kind: "run", agent: "atlas", scope: { kind: "due" } }],
    ["Hamilton, publish institution 47", { kind: "run", agent: "hamilton", scope: { kind: "institution", institutionId: 47 } }],
    ["Hamilton, run bank #47", { kind: "run", agent: "hamilton", scope: { kind: "institution", institutionId: 47 } }],
    ["Knox: run everything", { kind: "run", agent: "knox", scope: { kind: "all" } }],
    ["Darwin, retry failed", { kind: "retry", agent: "darwin" }],
    ["pause", { kind: "pause", agent: "atlas" }],
    ["resume the pipeline", { kind: "resume", agent: "atlas" }],
    ["show First Credit Union", { kind: "show", agent: "atlas", query: "First Credit Union" }],
    ["Rosetta, find #8485", { kind: "show", agent: "rosetta", query: "#8485" }],
  ])("parses %s", (input, expected) => {
    expect(parseCrewCommand(input)).toMatchObject(expected);
  });

  it("explains what it can do for unknown input", () => {
    expect(parseCrewCommand("make me a sandwich")).toMatchObject({ kind: "help", reason: "I didn't catch that." });
    expect(parseCrewCommand("run Narnia")).toMatchObject({ kind: "help" });
    expect(parseCrewCommand("is Narnia done?")).toMatchObject({ kind: "help" });
    expect(parseCrewCommand("Atlas, run institution 47")).toMatchObject({ kind: "help" });
    expect(parseCrewCommand("Hamilton, run institution 0")).toMatchObject({ kind: "help" });
    expect(parseCrewCommand("Hamilton, run institution 9999999999999999999")).toMatchObject({ kind: "help" });
  });

  it("marks only state-changing commands as writes", () => {
    expect(isWriteCommand(parseCrewCommand("run Georgia"))).toBe(true);
    expect(isWriteCommand(parseCrewCommand("Hamilton, publish institution 47"))).toBe(true);
    expect(isWriteCommand(parseCrewCommand("pause"))).toBe(true);
    expect(isWriteCommand(parseCrewCommand("Knox, retry"))).toBe(true);
    expect(isWriteCommand(parseCrewCommand("status"))).toBe(false);
    expect(isWriteCommand(parseCrewCommand("show Chase"))).toBe(false);
  });

  it("describes writes in plain words for the confirmation card", () => {
    expect(describeWrite(parseCrewCommand("Atlas, run Georgia"))).toBe("Atlas will run the full pipeline for Georgia.");
    expect(describeWrite(parseCrewCommand("Hamilton, publish institution 47")))
      .toContain("institution #47");
    expect(describeWrite(parseCrewCommand("Magellan, run Texas")))
      .toBe("Magellan will find missing fee schedule URLs, then download fee schedules for Texas.");
  });
});
