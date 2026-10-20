import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");

/**
 * 2026-10-19-next-runtime-security (#2110): Next 16.1.6 carried the App Router proxy bypass,
 * cache and native-image advisories; 16.4.2 is the first release that patches all of them.
 */
const NEXT_FLOOR = [16, 4, 2] as const;

function atLeastFloor(version: string | undefined): boolean {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "")?.slice(1).map(Number);
  if (!parts) return false;
  for (let i = 0; i < 3; i++) if (parts[i] !== NEXT_FLOOR[i]) return parts[i] > NEXT_FLOOR[i];
  return true;
}

describe("Next runtime patch floor", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as {
    packages: Record<string, { version?: string }>;
  };

  it("pins next and eslint-config-next to an exact release at or above 16.4.2", () => {
    expect(atLeastFloor(pkg.dependencies.next), `next ${pkg.dependencies.next}`).toBe(true);
    expect(atLeastFloor(pkg.devDependencies["eslint-config-next"]), "eslint-config-next").toBe(true);
  });

  it("resolves next and its Linux SWC binary at or above 16.4.2 in the lockfile", () => {
    for (const name of ["node_modules/next", "node_modules/@next/swc-linux-x64-gnu"]) {
      expect(atLeastFloor(lock.packages[name]?.version), `${name} ${lock.packages[name]?.version}`).toBe(true);
    }
  });

  it("compares versions by number, not text", () => {
    expect(["16.4.2", "16.4.10", "16.10.0", "17.0.0"].map(atLeastFloor)).toEqual([true, true, true, true]);
    expect(["16.4.1", "16.1.6", "15.9.9", "^16.4.2", undefined].map(atLeastFloor)).toEqual([false, false, false, false, false]);
  });
});
