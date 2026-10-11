// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CREW, crewMember, unknownCrew } from "./crew";
import { CREW as leafCrew, crewMember as leafCrewMember } from "./crew-members";
import { agentRegistry } from "./atlas/registry";

describe("Atlas crew import boundary", () => {
  it("preserves the crew public API and Atlas metadata", () => {
    expect(CREW).toBe(leafCrew);
    expect(crewMember).toBe(leafCrewMember);
    expect(crewMember("atlas")).toBe(leafCrew.find((member) => member.agent === "atlas"));
    expect(agentRegistry([]).map(({ agent, name, role }) => ({ agent, name, role })))
      .toEqual(CREW.map(({ agent, name, role }) => ({ agent, name, role })));
    expect(unknownCrew(new Date("2026-10-09T12:00:00Z"))).toHaveLength(CREW.length);
  });

  it("keeps the static roster below both consumer modules", () => {
    const atlas = readFileSync(resolve(__dirname, "atlas/registry.ts"), "utf8");
    const roster = readFileSync(resolve(__dirname, "crew-members.ts"), "utf8");
    expect(atlas).toContain('from "@/lib/agents/crew-members"');
    expect(atlas).not.toMatch(/from\s*["']@\/lib\/agents\/crew["']/);
    expect(roster).not.toMatch(/from\s*["'](?:\.\/atlas\/registry|@\/lib\/agents\/crew)["']/);
  });
});
