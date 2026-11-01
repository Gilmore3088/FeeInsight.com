// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertOfflineEnv } from "./env-guard";

/**
 * The pipeline shadow lab: `npm run test:shadow-lab`. Replays every frozen case through today's
 * stages and the selected experiment, three times each (twice in order, once reversed), and
 * writes `comparison.json` and `report.md` to `SHADOW_LAB_OUT`. It measures and never gates:
 * no rate thresholds. Without `SHADOW_LAB_OUT` (CI's unit shards) it is skipped.
 * `SHADOW_LAB_FREEZE=1` rewrites the frozen-input manifest from today's fixtures.
 */

const provider = vi.hoisted(() => ({ calls: 0 }));

// Constants stay real (modules read them at load); every callable export counts and refuses.
vi.mock("@/lib/ai-provider", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(real).map(([name, value]) => [
      name,
      typeof value === "function"
        ? () => {
            provider.calls += 1;
            throw new Error(`shadow lab: paid provider call refused (${name})`);
          }
        : value,
    ]),
  );
});

const OUT = process.env.SHADOW_LAB_OUT;
const MANIFEST_PATH = join(__dirname, "frozen-inputs.json");
const REPLAY_TIMEOUT_MS = 180_000;

describe.skipIf(!OUT)("pipeline shadow lab", () => {
  it(
    "should_replay_both_variants_identically_with_no_provider_calls",
    async () => {
      assertOfflineEnv();
      const { applyManifest, freezeManifest, loadScenarios, notReplayable, FIXTURE_PATHS } = await import("./scenarios");
      const { currentVariant, experimentalVariant, selectExperiment } = await import("./variants");
      const { runAll } = await import("./run-case");
      const { compareRuns, comparisonJson } = await import("./compare");
      const { renderReport } = await import("./report");
      const { knoxFreeSignature } = await import("@/lib/agents/hamilton/rules-recheck");
      const { CATEGORY_GUARD_VERSION } = await import("@/lib/fee-category-guard");
      const { HAMILTON_PUBLISH_STRATEGY } = await import("@/lib/agents/hamilton/publish");
      const { DARWIN_VERIFY_STRATEGY } = await import("@/lib/agents/darwin/verify");

      const loaded = loadScenarios();
      if (process.env.SHADOW_LAB_FREEZE === "1") writeFileSync(MANIFEST_PATH, `${JSON.stringify(freezeManifest(loaded), null, 2)}\n`);
      const manifest = existsSync(MANIFEST_PATH) ? (JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Record<string, string>) : {};
      const cases = applyManifest(loaded, manifest);

      const config = selectExperiment();
      const experimental = experimentalVariant(config);
      const runVariant = (variant: typeof currentVariant) => {
        const before = provider.calls;
        const traces = runAll(variant, cases);
        const repeats = [runAll(variant, cases), runAll(variant, [...cases].reverse())];
        return { traces, repeats, providerCalls: provider.calls - before };
      };

      const comparison = compareRuns({
        cases,
        versions: {
          knox: knoxFreeSignature(),
          darwin: `${DARWIN_VERIFY_STRATEGY.strategy}@${DARWIN_VERIFY_STRATEGY.version}`,
          hamilton: `${HAMILTON_PUBLISH_STRATEGY.strategy}@${HAMILTON_PUBLISH_STRATEGY.version}`,
          category_guard: `v${CATEGORY_GUARD_VERSION}`,
        },
        fixtures: FIXTURE_PATHS.map((path) => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })),
        notReplayable: notReplayable(),
        current: runVariant(currentVariant),
        experimental: { ...runVariant(experimental), config },
      });

      const out = OUT as string;
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "comparison.json"), comparisonJson(comparison));
      writeFileSync(join(out, "report.md"), renderReport(comparison));

      expect(comparison.variants.current.providerCalls + comparison.variants.experimental.providerCalls).toBe(0);
      expect(comparison.stability.identical).toBe(true);
      expect(comparison.variants.current.cases.ok).toBeGreaterThan(0);
    },
    REPLAY_TIMEOUT_MS,
  );
});
