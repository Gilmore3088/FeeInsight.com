// @vitest-environment node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Plan step 4 (#2535): every `*_LIVE` switch passes the golden set before it turns on.
 *
 * The PR gate runs in CI (`.github/workflows/test.yml`, unit shard 1) with `SWITCH_GATE_DIFF`
 * naming the PR's diff against its base. For each switch an added or removed line names, it
 * replays the golden set with the switch off and on and writes a receipt (Markdown and JSON under
 * `SWITCH_GATE_OUT`, default `test-results/switch-gate`, and the job summary). It fails when any
 * number gets worse, listing the fees that did. A switch the golden set cannot replay gets a
 * "not replayable" receipt, which does not pass it and does not fail the PR.
 *
 * Locally: `SWITCH_GATE_SWITCHES=all` (or a comma list) replays switches by name instead of a diff.
 */

const provider = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/ai-provider", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.entries(real).map(([name, value]) => [name, typeof value === "function"
    ? () => { provider.calls += 1; throw new Error(`switch gate: paid provider call refused (${name})`); }
    : value]));
});

const { loadGoldenSet, measureGoldenSet } = await import("./golden-set");
const { currentVariant, experimentalVariant } = await import("./shadow-lab/variants");
const replay = await import("./switch-replay");
const inventory = await import("./switch-inventory");

const TIMEOUT_MS = 600_000;
const today = new Date().toISOString().slice(0, 10);

describe("switch golden-set replay", () => {
  const entries = inventory.scanSwitches(process.cwd(), today);
  const switches = new Map(entries.filter(inventory.isSwitch).map((entry) => [entry.name, entry]));

  it("maps only real switches, and each mapped switch's inventory row says it replays", () => {
    for (const name of Object.keys(replay.SWITCH_REPLAYS)) {
      expect(switches.has(name), `${name} is mapped in SWITCH_REPLAYS but is not a switch in src/`).toBe(true);
      expect(switches.get(name)?.replay).toBe(replay.SWITCH_REPLAYS[name].scope);
    }
    for (const spec of Object.values(replay.SWITCH_REPLAYS)) {
      if (spec.scope === "partial") expect(spec.keepsCodeValue, "a partial replay names the reads it leaves at the code value").toBeTruthy();
    }
  });

  it("an experiment with no switch fields is today's pipeline", () => {
    // A slice keeps the unit shard fast; the full set runs in the PR gate and golden-set.test.ts.
    const full = loadGoldenSet();
    const set = { ...full, cases: full.cases.slice(0, 80), regression: full.regression.slice(0, 20) };
    const before = provider.calls;
    const current = measureGoldenSet(set, currentVariant);
    const unset = measureGoldenSet(set, experimentalVariant({ id: "current", description: "", excerptAtPublish: false, dailyCapLines: false, switches: {} }));
    expect(unset).toEqual(current);
    expect(current.recall.expected).toBeGreaterThan(0);
    expect(provider.calls - before).toBe(0);
  }, TIMEOUT_MS);

  it("a switch with no replay gets a not-replayable receipt that does not pass", () => {
    const set = loadGoldenSet();
    const name = [...switches.keys()].find((candidate) => !replay.SWITCH_REPLAYS[candidate])!;
    const receipt = replay.replaySwitch(set, name, switches.get(name)!.replay);
    expect(receipt.status).toBe("not_replayable");
    expect(replay.renderReceipt(receipt)).toMatch(/NOT REPLAYABLE/);
  }, TIMEOUT_MS);

  it("the gate fails on any number that falls and passes when none does", () => {
    const flat = { before: 0.5, after: 0.5, delta: 0 };
    const none = { lost: [], moreWrong: [], moreLetThrough: [] };
    expect(replay.worseNumbers({ recall: flat, precision: flat, knownWrongRefused: flat, ...none })).toEqual([]);
    expect(replay.worseNumbers({ recall: { before: 0.5, after: 0.49, delta: -0.01 }, precision: flat, knownWrongRefused: flat, ...none,
      lost: [{ id: "m", fee: { canonicalFeeKey: "nsf", feeName: null, amountCents: 3000 } }], moreWrong: [{ id: "m", before: 0, after: 1 }] }))
      .toEqual(["recall", "expected fees lost", "members publishing more known-wrong fees"]);
    expect(replay.worseNumbers({ recall: { before: null, after: null, delta: null }, precision: flat, knownWrongRefused: { before: 1, after: 0.9, delta: -0.1 },
      ...none, moreLetThrough: [{ id: "regression:x", before: 0, after: 1 }] }))
      .toEqual(["known-wrong refused", "members letting more known-wrong fees or takedowns through"]);
  });

  it("reads the switches a diff's added and removed lines name", () => {
    const diff = [
      "diff --git a/src/x.ts b/src/x.ts", "--- a/src/x.ts", "+++ b/src/x.ts", "@@ -1 +1 @@",
      "-export const DAILY_CAP_LINES_LIVE = false;", "+export const DAILY_CAP_LINES_LIVE = true;",
      " // KNOX_HELD_NAME_RULES_LIVE is context, not a change", "+const ALREADY_LIVE = /x/;",
      "diff --git a/src/lib/agents/deming/switch-replay.ts b/src/lib/agents/deming/switch-replay.ts", "+  NO_CHARGE_SENTENCE_READ_LIVE: {",
    ].join("\n");
    expect(replay.switchesNamedInDiff(diff, new Set(switches.keys()))).toEqual(["DAILY_CAP_LINES_LIVE"]);
  });
});

const diffPath = process.env.SWITCH_GATE_DIFF;
const named = process.env.SWITCH_GATE_SWITCHES;

describe.runIf(Boolean(diffPath || named))("switch golden-set gate (PR receipts)", () => {
  it("no number gets worse for any switch the PR names", () => {
    const entries = inventory.scanSwitches(process.cwd(), today).filter(inventory.isSwitch);
    const known = new Map(entries.map((entry) => [entry.name, entry]));
    const names = named
      ? named === "all" ? [...known.keys()] : named.split(",").map((name) => name.trim()).filter(Boolean)
      : replay.switchesNamedInDiff(readFileSync(diffPath!, "utf8"), new Set(known.keys()));
    const set = loadGoldenSet();
    const before = provider.calls;
    const receipts = names.map((name) => replay.replaySwitch(set, name, known.get(name)?.replay ?? "not a `*_LIVE` switch in src/"));
    expect(provider.calls - before).toBe(0);

    const out = process.env.SWITCH_GATE_OUT ?? join(process.cwd(), "test-results/switch-gate");
    mkdirSync(out, { recursive: true });
    const counts = receipts.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
    const markdown = [
      "## Switch golden-set receipts (plan step 4)",
      "",
      names.length === 0
        ? "This PR names no `*_LIVE` switch in an added or removed line."
        : `Switches named: ${names.length}. ${Object.entries(counts).map(([status, n]) => `${status.replace(/_/g, " ")}: ${n}`).join(", ")}.`,
      "",
      ...receipts.map(replay.renderReceipt),
    ].join("\n");
    writeFileSync(join(out, "receipts.md"), markdown);
    writeFileSync(join(out, "receipts.json"), `${JSON.stringify(receipts, null, 1)}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
    console.log(markdown);

    const failed = receipts.filter((r) => r.status === "fail" || r.status === "not_comparable");
    expect(failed.map((r) => ({ switch: r.switch, worse: r.worse, reason: r.reason,
      fees: r.worseFees.slice(0, 20).map((f) => `${f.change}: ${f.fee ? `${f.fee.canonicalFeeKey} ${f.fee.amountCents ?? "varies"}c ${f.fee.feeName ?? ""}` : "takedown"} (${f.member})`) })),
    "a switch made a golden-set number worse; the receipt lists the fees").toEqual([]);
  }, TIMEOUT_MS);
});
