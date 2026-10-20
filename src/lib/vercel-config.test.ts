import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");

describe("vercel.json", () => {
  const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
    ignoreCommand?: string;
    crons?: { path: string; schedule: string }[];
  };

  // Vercel rejects a longer ignoreCommand before building, production included (#1647).
  it("keeps ignoreCommand within Vercel's 256-character limit", () => {
    expect(config.ignoreCommand?.length ?? 0).toBeLessThanOrEqual(256);
  });

  // The skip decision (2026-10-09 preview queue; 2026-10-16 and 2026-10-20 findings) lives in
  // scripts/vercel-ignore-build.mjs and is tested in scripts/vercel-ignore-build.test.ts.
  // It runs git, so Vercel must not strip .git or the script from the clone first (#1647).
  it("runs the skip script and keeps .git and scripts/ in the build source", () => {
    expect(config.ignoreCommand).toBe("node scripts/vercel-ignore-build.mjs");
    const ignored = readFileSync(join(root, ".vercelignore"), "utf8")
      .split("\n")
      .map((line) => line.trim().replace(/^\//, "").replace(/\/$/, ""));
    expect(ignored).not.toContain(".git");
    expect(ignored.filter((line) => line === "scripts" || line.startsWith("scripts/"))).toEqual([]);
  });

  // 2026-10-17-vercel-usage-agents-tick: the agents tick fills each slot it is given, so it is
  // most of the team's function time. Every 10 minutes halves that bill; every 5 doubled it.
  it("runs the agents tick every 10 minutes, no more often", () => {
    const tick = config.crons?.filter((cron) => cron.path === "/api/admin/agents/tick") ?? [];
    expect(tick).toEqual([{ path: "/api/admin/agents/tick", schedule: "*/10 * * * *" }]);
  });
});
