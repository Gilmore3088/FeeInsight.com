// @vitest-environment node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertOfflineEnv } from "./env-guard";

/**
 * The ratchet gate (`npm run test:quality-gates`): today's pipeline replayed on the frozen cases
 * must still meet every expectation in `ratchet-baseline.json`, and any new one must be locked in.
 * A missing baseline fails. After a change that meets more, refresh the baseline in the same PR:
 * `SHADOW_LAB_REBASE=1 npx vitest run src/lib/agents/deming/shadow-lab/ratchet-gate.test.ts`.
 * Losing an expectation on purpose needs the same refresh and a reason in the PR.
 */

vi.mock("@/lib/ai-provider", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(real).map(([name, value]) => [
      name,
      typeof value === "function"
        ? () => {
            throw new Error(`shadow lab ratchet: paid provider call refused (${name})`);
          }
        : value,
    ]),
  );
});

const BASELINE_PATH = join(__dirname, "ratchet-baseline.json");
const MANIFEST_PATH = join(__dirname, "frozen-inputs.json");
const SHOWN = 20;
const GATE_TIMEOUT_MS = 120_000;

describe("shadow lab ratchet gate", () => {
  it(
    "should_keep_every_expectation_the_baseline_holds",
    async () => {
      assertOfflineEnv();
      const { applyManifest, loadScenarios } = await import("./scenarios");
      const { currentVariant } = await import("./variants");
      const { runAll } = await import("./run-case");
      const { compareToBaseline, heldExpectations } = await import("./ratchet");

      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Record<string, string>;
      const cases = applyManifest(loadScenarios(), manifest);
      const held = heldExpectations(cases, runAll(currentVariant, cases));
      if (process.env.SHADOW_LAB_REBASE === "1") writeFileSync(BASELINE_PATH, `${JSON.stringify({ held }, null, 1)}\n`);
      // A missing baseline fails rather than regenerating, so deleting it can't pass the gate.
      expect(existsSync(BASELINE_PATH), "ratchet-baseline.json is missing: restore it, or rebuild it with SHADOW_LAB_REBASE=1").toBe(true);
      const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as { held: string[] };
      const { regressions, gains } = compareToBaseline(baseline, held);

      expect(
        regressions.slice(0, SHOWN),
        `${regressions.length} expectations the baseline held are lost (a fee no longer published, or a wrong one published again)`,
      ).toEqual([]);
      expect(
        gains.slice(0, SHOWN),
        `${gains.length} new expectations met: lock them in with SHADOW_LAB_REBASE=1 and commit ratchet-baseline.json`,
      ).toEqual([]);
    },
    GATE_TIMEOUT_MS,
  );
});
