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

  it(
    "should_replay_the_html_row_pairing_experiment_on_the_reread_with_no_provider_calls",
    async () => {
      assertOfflineEnv();
      const { applyManifest, loadScenarios } = await import("./scenarios");
      const { currentVariant, EXPERIMENTS, experimentalVariant } = await import("./variants");
      const { readSourceManifest, rereadAcceptedSources } = await import("./source-bytes");
      const { replayDelta, replaySources } = await import("./source-replay");
      const { renderReplayDelta } = await import("./source-replay-report");

      const config = EXPERIMENTS["html-row-pairing"];
      const frozenManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Record<string, string>;
      const cases = applyManifest(loadScenarios(), frozenManifest);
      const manifest = readSourceManifest();
      const today = await rereadAcceptedSources();
      const off = await rereadAcceptedSources(process.cwd(), { htmlRowPairing: false });
      const on = await rereadAcceptedSources(process.cwd(), { htmlRowPairing: config.switches?.htmlRowPairing });
      // The switch ships off: today's read is the switch-off read, document for document.
      for (const [key, read] of today) expect(off.get(key)).toEqual(read);

      const base = replaySources({ manifest, cases, rereads: today, variant: currentVariant });
      const run = () => replaySources({ manifest, cases, rereads: on, variant: experimentalVariant(config) });
      const switched = run();
      expect(JSON.stringify(run())).toBe(JSON.stringify(switched));
      expect(provider.calls).toBe(0);
      // Frozen text is the reader's output, so the reader switch cannot move the frozen side.
      expect(switched.total.frozen).toEqual(base.total.frozen);

      if (OUT) {
        const delta = replayDelta(base, switched);
        mkdirSync(OUT, { recursive: true });
        writeFileSync(join(OUT, `source-replay-${config.id}.json`), `${JSON.stringify({ total: switched.total, delta }, null, 1)}\n`);
        writeFileSync(join(OUT, `source-replay-${config.id}.md`), renderReplayDelta(config.id, base, switched, delta));
      }
    },
    REPLAY_TIMEOUT_MS,
  );

  it(
    "should_replay_the_pdf_text_direction_experiment_on_the_reread_with_no_provider_calls",
    async () => {
      assertOfflineEnv();
      const { applyManifest, loadScenarios } = await import("./scenarios");
      const { currentVariant, EXPERIMENTS, experimentalVariant } = await import("./variants");
      const { loadSourceBytes, readSourceManifest, rereadAcceptedSources } = await import("./source-bytes");
      const { replayDelta, replaySources } = await import("./source-replay");
      const { renderReplayDelta } = await import("./source-replay-report");
      const { extractPdfDocumentText } = await import("@/lib/agents/rosetta/pdf-document-text");

      const config = EXPERIMENTS["pdf-text-direction"];
      const frozenManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Record<string, string>;
      const cases = applyManifest(loadScenarios(), frozenManifest);
      const manifest = readSourceManifest();
      const today = await rereadAcceptedSources();
      const off = await rereadAcceptedSources(process.cwd(), { pdfTextDirection: false });
      const on = await rereadAcceptedSources(process.cwd(), { pdfTextDirection: config.switches?.pdfTextDirection });
      // The switch ships off: today's read is the switch-off read, document for document.
      for (const [key, read] of today) expect(off.get(key)).toEqual(read);
      // A PDF with no sideways page reads byte for byte the same with the switch on.
      for (const entry of manifest.accepted.filter((item) => item.file.endsWith(".pdf.gz"))) {
        const { textDirection } = await extractPdfDocumentText(loadSourceBytes(entry));
        if (textDirection?.pages.length === 0) expect(on.get(entry.caseKey), entry.caseKey).toEqual(off.get(entry.caseKey));
      }

      const base = replaySources({ manifest, cases, rereads: today, variant: currentVariant });
      const run = () => replaySources({ manifest, cases, rereads: on, variant: experimentalVariant(config) });
      const switched = run();
      expect(JSON.stringify(run())).toBe(JSON.stringify(switched));
      expect(provider.calls).toBe(0);
      // Frozen text is the reader's output, so the reader switch cannot move the frozen side.
      expect(switched.total.frozen).toEqual(base.total.frozen);

      if (OUT) {
        const delta = replayDelta(base, switched);
        mkdirSync(OUT, { recursive: true });
        writeFileSync(join(OUT, `source-replay-${config.id}.json`), `${JSON.stringify({ total: switched.total, delta }, null, 1)}\n`);
        writeFileSync(join(OUT, `source-replay-${config.id}.md`), renderReplayDelta(config.id, base, switched, delta));
      }
    },
    REPLAY_TIMEOUT_MS,
  );

  it(
    "should_replay_the_html_cell_list_pairing_experiment_with_row_pairing_off_and_on_with_no_provider_calls",
    async () => {
      assertOfflineEnv();
      const { applyManifest, loadScenarios } = await import("./scenarios");
      const { currentVariant, EXPERIMENTS, experimentalVariant } = await import("./variants");
      const { readSourceManifest, rereadAcceptedSources } = await import("./source-bytes");
      const { replayDelta, replaySources } = await import("./source-replay");
      const { renderReplayDelta } = await import("./source-replay-report");

      const config = EXPERIMENTS["html-cell-list-pairing"];
      const frozenManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Record<string, string>;
      const cases = applyManifest(loadScenarios(), frozenManifest);
      const manifest = readSourceManifest();
      const today = await rereadAcceptedSources();
      const read = (htmlRowPairing: boolean, htmlCellListPairing: boolean) =>
        rereadAcceptedSources(process.cwd(), { htmlRowPairing, htmlCellListPairing });
      const off = await read(false, false);
      const rowsOnly = await read(true, false);
      // The switch ships off: today's read is the switch-off read for every fixture, HTML and PDF alike.
      for (const [key, text] of today) expect(off.get(key), key).toEqual(text);
      expect(off.size).toBe(manifest.accepted.length);
      // Off also leaves row pairing's own read byte for byte as it was.
      const rowsBefore = await rereadAcceptedSources(process.cwd(), { htmlRowPairing: true });
      for (const [key, text] of rowsBefore) expect(rowsOnly.get(key), key).toEqual(text);

      const switchedRun = (rereads: typeof today) => replaySources({ manifest, cases, rereads, variant: experimentalVariant(config) });
      const sides = [
        { id: config.id, base: off, on: await read(false, true) },
        { id: `${config.id}-with-row-pairing`, base: rowsOnly, on: await read(true, true) },
      ];
      for (const side of sides) {
        const base = replaySources({ manifest, cases, rereads: side.base, variant: currentVariant });
        const switched = switchedRun(side.on);
        expect(JSON.stringify(switchedRun(side.on))).toBe(JSON.stringify(switched));
        // Frozen text is the reader's output, so the reader switch cannot move the frozen side.
        expect(switched.total.frozen).toEqual(base.total.frozen);
        if (OUT) {
          const delta = replayDelta(base, switched);
          mkdirSync(OUT, { recursive: true });
          writeFileSync(join(OUT, `source-replay-${side.id}.json`), `${JSON.stringify({ total: switched.total, delta }, null, 1)}\n`);
          writeFileSync(join(OUT, `source-replay-${side.id}.md`), renderReplayDelta(side.id, base, switched, delta));
        }
      }
      expect(provider.calls).toBe(0);
    },
    REPLAY_TIMEOUT_MS,
  );
});
