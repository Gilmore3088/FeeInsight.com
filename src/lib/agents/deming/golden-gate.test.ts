// @vitest-environment node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * The golden-set pipeline gate (`golden-gate.ts`). Its logic tests run in the unit shards. The gate
 * itself runs in CI (`.github/workflows/test.yml`, the golden-set gate step) with
 * `GOLDEN_GATE_CHANGED` naming the PR's changed files and `GOLDEN_GATE_BASELINE` main's baseline
 * (read from the merge base). Locally: `GOLDEN_GATE=1 npx vitest run src/lib/agents/deming/golden-gate.test.ts`
 * runs it against the committed baseline; `GOLDEN_GATE_WRITE=1` rewrites the baseline from the code.
 */

const provider = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/ai-provider", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.entries(real).map(([name, value]) => [name, typeof value === "function"
    ? () => { provider.calls += 1; throw new Error(`golden gate: paid provider call refused (${name})`); }
    : value]));
});

const gate = await import("./golden-gate");
type CompactMember = import("./golden-gate").CompactMember;

const TIMEOUT_MS = 300_000;
const root = process.cwd();
const member = (expected: number, found: number, correct: number, wrong: number, forbidden: number, letThrough: number, missed: string[] = []): CompactMember =>
  [expected, found, correct, wrong, forbidden, letThrough, missed];

describe("golden-set pipeline gate: logic", () => {
  const main = { a: member(2, 1, 1, 0, 1, 0, ["nsf 3000"]), b: member(1, 1, 1, 1, 0, 0), "regression:x": member(0, 0, 0, 0, 1, 0) };

  it("passes when no number moves and when one improves", () => {
    expect(gate.compareStage("publish", main, main).worse).toEqual([]);
    const better = { ...main, a: member(2, 2, 2, 0, 1, 0) };
    const verdict = gate.compareStage("publish", main, better);
    expect(verdict.worse).toEqual([]);
    expect(verdict.gained).toEqual([{ member: "a", fee: "nsf 3000" }]);
  });

  it("fails on one expected fee lost, even when another member gains one", () => {
    const traded = { ...main, a: member(2, 2, 2, 0, 1, 0), b: member(1, 0, 0, 1, 0, 0, ["od 3500"]) };
    const verdict = gate.compareStage("publish", main, traded);
    expect(verdict.lost).toEqual([{ member: "b", fee: "od 3500" }]);
    expect(verdict.worse).toContain("expected fees lost");
  });

  it("fails on a known-wrong publication, a takedown let through, or a rate that falls", () => {
    expect(gate.compareStage("publish", main, { ...main, b: member(1, 1, 1, 2, 0, 0) }).worse)
      .toEqual(["precision", "members publishing more known-wrong fees"]);
    expect(gate.compareStage("after_sweeps", main, { ...main, "regression:x": member(0, 0, 0, 0, 1, 1) }).worse)
      .toEqual(["known-wrong refused", "members letting more known-wrong fees or takedowns through"]);
  });

  it("states its tolerance as zero worse", () => {
    expect(Object.values(gate.GOLDEN_GATE_TOLERANCE).every((value) => value === 0)).toBe(true);
    // A tolerance, when James sets one, lets a rate fall that far and no further.
    const looser = { ...gate.GOLDEN_GATE_TOLERANCE, precision: 0.2 };
    expect(gate.compareStage("publish", main, { ...main, b: member(1, 1, 1, 2, 0, 0) }, looser).worse).toEqual(["members publishing more known-wrong fees"]);
  });

  it("compares only members both sides measured after a golden-set append", () => {
    const appended = { ...main, "shadow:new": member(5, 0, 0, 3, 0, 0, ["a", "b", "c", "d", "e"]) };
    const verdict = gate.compareStage("publish", main, appended);
    expect(verdict).toMatchObject({ members: 3, notCompared: 1, worse: [] });
  });

  it("round-trips the baseline one member per line", () => {
    const baseline = { about: "x", goldenSet: { version: 1, manifestSha256: "s", measured: 3, notLoaded: 0 }, stages: { publish: main, after_sweeps: main } };
    const text = gate.serializeBaseline(baseline);
    expect(JSON.parse(text)).toEqual(baseline);
    expect(text.split("\n").filter((line) => line.includes('"regression:x"'))).toHaveLength(2);
  });

  it("runs on the files the replay imports and on every agent, and skips everything else", () => {
    const files = gate.pipelineFiles(root);
    for (const path of ["src/lib/agents/deming/golden-set.ts", "src/lib/agents/deming/shadow-lab/variants.ts", "src/lib/agents/knox/specialists.ts",
      "src/lib/agents/darwin/verify.ts", "src/lib/agents/hamilton/publish.ts", "src/lib/custom-report/source-check.ts", "src/lib/fee-category-guard.ts",
      "src/lib/fee-fold.ts", "src/lib/no-charge-statement.ts", "src/lib/agents/darwin/banded-zero-check.ts", gate.GOLDEN_GATE_BASELINE_PATH,
      "src/lib/agents/deming/__fixtures__/golden-set.json"]) {
      expect(files.has(path), `${path} is in the replay's closure`).toBe(true);
    }
    expect(gate.gatedChanges(["src/lib/fee-category-guard.ts", "README.md"], files)).toEqual(["src/lib/fee-category-guard.ts"]);
    expect(gate.gatedChanges(["src/lib/agents/atlas/city-repair.ts"], files)).toEqual(["src/lib/agents/atlas/city-repair.ts"]);
    expect(gate.gatedChanges(["src/app/page.tsx", "src/components/Hero.tsx", "docs/project/LESSONS.md", ".github/workflows/test.yml"], files)).toEqual([]);
    // A type-only import does not pull its module in.
    expect([...files].some((path) => path.startsWith("src/app/"))).toBe(false);
  }, TIMEOUT_MS);
});

describe("not-loaded members are named", () => {
  it("the receipt lists every member it did not measure", async () => {
    const { notLoadedNote } = await import("./golden-set");
    expect(notLoadedNote(["answer_key:1", "answer_key:2"])).toBe("Not measured (2 answer-key banks with no stored reference text offline): `answer_key:1`, `answer_key:2`.");
    expect(notLoadedNote([])).toBe("Every golden-set member was measured.");
  });
});

const changedPath = process.env.GOLDEN_GATE_CHANGED;
// GOLDEN_GATE_MAIN=1: the push-to-main run. main's code is measured against main's own committed
// baseline, so two PRs that each passed on an older main and together moved the numbers fail on the
// merge commit that caused the drift, not on the next pipeline PR.
const onMain = process.env.GOLDEN_GATE_MAIN === "1";
const runGate = Boolean(changedPath) || onMain || process.env.GOLDEN_GATE === "1" || process.env.GOLDEN_GATE_WRITE === "1";

describe.runIf(runGate)("golden-set pipeline gate (PR receipt)", () => {
  const out = process.env.GOLDEN_GATE_OUT ?? join(root, "test-results/golden-gate");
  const report = (markdown: string, json: unknown) => {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "receipt.md"), `${markdown}\n`);
    writeFileSync(join(out, "receipt.json"), `${JSON.stringify(json, null, 1)}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
    console.log(markdown);
  };
  const changed = changedPath ? readFileSync(changedPath, "utf8").split("\n") : null;
  const gated = changed ? gate.gatedChanges(changed, gate.pipelineFiles(root)) : [onMain ? "(push to main)" : "(run by name)"];
  const who = onMain ? "this push to main" : "this PR";

  if (gated.length === 0) {
    it("skips: this PR changes no file the golden-set replay runs", () => {
      report(`## Golden-set pipeline gate: skipped\n\n${onMain ? "This push to main changes" : "This PR changes"} no file the golden-set replay imports, nothing under \`src/lib/agents/\`, and no golden-set fixture.`, { skipped: true, changed });
    });
    return;
  }

  it("no golden-set number is worse than main's, and the committed baseline is this code's", async () => {
    const { loadGoldenSet, notLoadedNote } = await import("./golden-set");
    const before = provider.calls;
    const set = loadGoldenSet();
    const head = gate.measurePipeline(set);
    expect(provider.calls - before).toBe(0);
    const committedPath = join(root, gate.GOLDEN_GATE_BASELINE_PATH);
    if (process.env.GOLDEN_GATE_WRITE === "1") writeFileSync(committedPath, gate.serializeBaseline(head));
    const mainPath = process.env.GOLDEN_GATE_BASELINE;
    const mainText = mainPath && existsSync(mainPath) && readFileSync(mainPath, "utf8").trim() ? readFileSync(mainPath, "utf8") : null;
    const committed = existsSync(committedPath) ? readFileSync(committedPath, "utf8") : null;
    expect(committed, `${gate.GOLDEN_GATE_BASELINE_PATH} is missing: write it with GOLDEN_GATE_WRITE=1`).not.toBeNull();
    // main has no baseline only on the PR that adds the gate; that PR is checked against its own copy.
    const main = JSON.parse(mainText ?? committed!) as import("./golden-gate").GateBaseline;
    const verdicts = gate.compareToBaseline(main, head);
    const regenerate = "GOLDEN_GATE_WRITE=1 npx vitest run src/lib/agents/deming/golden-gate.test.ts";
    const note = `Ran because ${who} changes: ${gated.slice(0, 12).map((path) => `\`${path}\``).join(", ")}${gated.length > 12 ? ` and ${gated.length - 12} more` : ""}. ` +
      `Compared with ${onMain ? "main's own committed baseline" : mainText ? "main's committed baseline (the merge base)" : "this branch's own baseline (main has none yet)"}, golden set v${head.goldenSet.version}. ${notLoadedNote(set.notLoaded)}`;
    const drift = onMain && committed !== gate.serializeBaseline(head)
      ? `\n\n**main is out of step with its committed baseline.** PRs that each passed on an older main merged and together moved the numbers. Regenerate on main's code with \`${regenerate}\` and commit the baseline in a PR; until then every pipeline PR is compared against a stale baseline.`
      : "";
    report(`${gate.renderGate(verdicts, note)}${drift}`, { gated, verdicts, notLoaded: set.notLoaded, drift: Boolean(drift) });
    expect(verdicts.filter((verdict) => verdict.worse.length > 0).map((verdict) => ({ stage: verdict.stage, worse: verdict.worse, lost: verdict.lost.slice(0, 20), moreWrong: verdict.moreWrong.slice(0, 20), moreLetThrough: verdict.moreLetThrough.slice(0, 20) })),
      `${who} makes a golden-set number worse than ${onMain ? "main's committed baseline" : "main"}; the receipt lists the members${onMain ? `. Fix the regression, or if it is intended regenerate with ${regenerate}` : ""}`).toEqual([]);
    expect(committed === gate.serializeBaseline(head) || process.env.GOLDEN_GATE_WRITE === "1",
      `${gate.GOLDEN_GATE_BASELINE_PATH} no longer matches ${onMain ? "main's code (baseline drift after merges)" : "this code's numbers"}: regenerate it with ${regenerate} and commit it`).toBe(true);
  }, TIMEOUT_MS);
});
