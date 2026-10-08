import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn(), getSql: vi.fn() }));

import { summarizeMarketingTeam, teamStop } from "./marketing-team";

describe("marketing team", () => {
  it("lists all eight agents in roster order, even with nothing filed", () => {
    const team = summarizeMarketingTeam([], null);
    expect(team.map((member) => member.name)).toEqual([
      "Carnegie", "Draper", "Edison", "Ernest", "Murrow", "Nielsen", "Norman", "Sherlock",
    ]);
    expect(team.every((member) => member.status === "Not started yet" && member.tone === "idle")).toBe(true);
  });

  it("says why nothing runs when marketing or its budget is off", () => {
    expect(teamStop(false, "enabled")).toBe("Paused: marketing is switched off");
    expect(teamStop(true, "off")).toBe("Paused: growth budget is off");
    expect(teamStop(true, "missing")).toBe("Paused: growth budget is off");
    expect(teamStop(true, "enabled")).toBeNull();
    const [carnegie] = summarizeMarketingTeam([], teamStop(true, "off"));
    expect(carnegie).toMatchObject({ status: "Paused: growth budget is off", tone: "paused" });
  });

  it("counts what each agent filed and what still waits for James", () => {
    const team = summarizeMarketingTeam(
      [
        { agent: "murrow", status: "draft", count: 2, lastAt: "2026-10-08T10:00:00Z" },
        { agent: "murrow", status: "posted", count: 1, lastAt: "2026-10-07T10:00:00Z" },
        { agent: "ernest", status: "skipped", count: 3, lastAt: null },
      ],
      null,
    );
    expect(team.find((member) => member.agent === "murrow")).toMatchObject({
      filed: 3, waiting: 2, lastFiledAt: "2026-10-08T10:00:00Z", status: "3 filed for review", tone: "working",
    });
    expect(team.find((member) => member.agent === "ernest")).toMatchObject({ filed: 3, waiting: 0 });
  });
});
