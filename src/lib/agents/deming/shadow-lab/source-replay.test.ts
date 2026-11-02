// @vitest-environment node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertOfflineEnv } from "./env-guard";

/**
 * The source-bytes replay: the answer-key documents whose public bytes reproduce, read again by
 * today's Rosetta readers and run through the current pipeline beside their frozen text. Runs
 * offline from committed fixtures. It measures and never gates on a rate: it checks only that the
 * run is repeatable and makes no provider call. With `SHADOW_LAB_OUT` set (`npm run
 * test:shadow-lab`) it writes `source-replay.json` and `source-replay.md` there.
 */

const provider = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/lib/ai-provider", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(
    Object.entries(real).map(([name, value]) => [
      name,
      typeof value === "function"
        ? () => {
            provider.calls += 1;
            throw new Error(`source replay: paid provider call refused (${name})`);
          }
        : value,
    ]),
  );
});

const OUT = process.env.SHADOW_LAB_OUT;
const MANIFEST_PATH = join(__dirname, "frozen-inputs.json");
const REPLAY_TIMEOUT_MS = 240_000;

describe("shadow lab source-bytes replay", () => {
  it(
    "should_replay_frozen_and_reread_texts_repeatably_with_no_provider_calls",
    async () => {
      assertOfflineEnv();
      const { applyManifest, loadScenarios } = await import("./scenarios");
      const { currentVariant } = await import("./variants");
      const { readSourceManifest, rereadAcceptedSources } = await import("./source-bytes");
      const { replaySources } = await import("./source-replay");
      const { renderSourceReplay } = await import("./source-replay-report");

      const frozenManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Record<string, string>;
      const cases = applyManifest(loadScenarios(), frozenManifest);
      const manifest = readSourceManifest();
      const rereads = await rereadAcceptedSources();
      const run = () => replaySources({ manifest, cases, rereads, variant: currentVariant });
      const summary = run();

      expect(JSON.stringify(run())).toBe(JSON.stringify(summary));
      expect(provider.calls).toBe(0);
      expect(summary.reproduced).toBe(manifest.accepted.length);
      expect(summary.total.frozen.expected).toBe(summary.total.reread.expected);

      if (OUT) {
        mkdirSync(OUT, { recursive: true });
        writeFileSync(join(OUT, "source-replay.json"), `${JSON.stringify(summary, null, 1)}\n`);
        writeFileSync(join(OUT, "source-replay.md"), renderSourceReplay(summary));
      }
    },
    REPLAY_TIMEOUT_MS,
  );
});
