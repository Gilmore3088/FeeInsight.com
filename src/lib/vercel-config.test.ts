import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");

describe("vercel.json", () => {
  const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
    ignoreCommand?: string;
  };

  // Vercel rejects a longer ignoreCommand before building, production included (#1647).
  it("keeps ignoreCommand within Vercel's 256-character limit", () => {
    expect(config.ignoreCommand?.length ?? 0).toBeLessThanOrEqual(256);
  });

  // The skip check runs git, so Vercel must not strip .git from the clone first (#1647).
  it("does not drop .git from the build source while ignoreCommand runs git", () => {
    if (!config.ignoreCommand?.includes("git ")) return;
    const ignored = readFileSync(join(root, ".vercelignore"), "utf8")
      .split("\n")
      .map((line) => line.trim().replace(/^\//, "").replace(/\/$/, ""));
    expect(ignored).not.toContain(".git");
  });
});
