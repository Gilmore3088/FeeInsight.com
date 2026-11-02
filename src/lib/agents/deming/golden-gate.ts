import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { GOLDEN_SET_PATH, goldenTraces, measureGoldenSet, type GoldenSet, type GoldenSetMeasure } from "./golden-set";
import { FIXTURE_PATHS } from "./shadow-lab/scenarios";
import { experimentalVariant } from "./shadow-lab/variants";
import { sweepSwitches, sweepTraces } from "./sweep-replay";
import type { FeeRef, PipelineVariant, ShadowCase } from "./shadow-lab/types";

/**
 * The golden-set pipeline gate (#2533 follow-up, Nov 2 audit): every PR that changes code the
 * golden-set replay runs is measured on the golden set and compared with main's numbers, whether or
 * not it names a `*_LIVE` switch. Before this, only a PR naming a switch met the golden set
 * (`switch-gate.test.ts`), so a pipeline logic change with no switch shipped unmeasured.
 *
 * Two stages are measured, both on the PR head's code values (`headVariant`: every switch as the
 * head's code sets it): `publish`, what the replayed Knox -> Darwin -> Hamilton path publishes, and
 * `after_sweeps`, the same publications after every replayed database sweep (`sweep-replay.ts`) at
 * its code value, so a change to a sweep's decision function is measured too.
 *
 * main's numbers are `GOLDEN_GATE_BASELINE_PATH` as committed on main (CI reads it from the merge
 * base). The PR fails on any number worse than main's beyond `GOLDEN_GATE_TOLERANCE`, which is zero:
 * no expected fee main finds may be lost, no member may publish more known-wrong fees or let more
 * through, and recall, precision and known-wrong refused may not fall. The PR's own committed
 * baseline must equal its measure, so a PR that moves a number commits the new baseline (the
 * diff shows each member that moved) and main's copy stays current.
 *
 * Which PRs it runs on: `gateApplies` — a changed file the replay imports (the static import
 * closure of this module, `pipelineFiles`), anything under `src/lib/agents/`, the golden set and
 * its fixtures. Every other PR skips it.
 */

export const GOLDEN_GATE_BASELINE_PATH = "src/lib/agents/deming/__fixtures__/golden-gate-baseline.json";

/**
 * How far a PR may fall below main and still pass. Zero: James's rule for the gate (Nov 2) is no
 * worse on fees right. Rates are compared in points of a share (0.001 is 0.1 point).
 */
export interface GateTolerance {
  recall: number; precision: number; knownWrongRefused: number; lostFees: number; membersMoreWrong: number; membersMoreLetThrough: number;
}
export const GOLDEN_GATE_TOLERANCE: Readonly<GateTolerance> = { recall: 0, precision: 0, knownWrongRefused: 0, lostFees: 0, membersMoreWrong: 0, membersMoreLetThrough: 0 };

export type GateStage = "publish" | "after_sweeps";
export const GATE_STAGES: readonly GateStage[] = ["publish", "after_sweeps"];

/** One member's result: [expected, found, correct, wrong, forbidden, letThrough, missed fee keys]. */
export type CompactMember = [number, number, number, number, number, number, string[]];

export interface GateBaseline {
  about: string;
  goldenSet: { version: number; manifestSha256: string; measured: number; notLoaded: number };
  stages: Record<GateStage, Record<string, CompactMember>>;
}

/** The pipeline the PR head deploys: every switch at its code value (none of the shadow lab's pins). */
export const headVariant: PipelineVariant = experimentalVariant({
  id: "pr-head",
  description: "The PR head's Knox free read, Darwin's verify checks and Hamilton's publish gate, every switch at its code value.",
  excerptAtPublish: false,
});

const feeKey = (ref: FeeRef) => JSON.stringify([ref.canonicalFeeKey, ref.amountCents, ref.frequency ?? null, ref.feeName]);

function compact(set: GoldenSet, measure: GoldenSetMeasure): Record<string, CompactMember> {
  const forbidden = new Map<string, number>(set.cases.map((entry) => [entry.member.id, entry.case.expected.forbid.length]));
  for (const member of set.regression) forbidden.set(member.id, 1);
  const out: Record<string, CompactMember> = {};
  for (const r of [...measure.perMember].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    out[r.id] = [r.expected, r.found, r.correct, r.wrong, forbidden.get(r.id) ?? 0, r.letThrough, r.missed.map(feeKey).sort()];
  }
  return out;
}

/** The PR head's numbers on the set: one pipeline run, measured before and after the sweeps. */
export function measurePipeline(set: GoldenSet): GateBaseline {
  const traces = goldenTraces(set, headVariant);
  const cases = new Map<string, ShadowCase>(set.cases.map((entry) => [entry.case.caseKey, entry.case]));
  const publish = measureGoldenSet(set, headVariant, { traces });
  const afterSweeps = measureGoldenSet(set, headVariant, { traces: sweepTraces(traces, cases, sweepSwitches()) });
  return {
    about: `Golden-set gate baseline (golden-gate.ts): main's numbers per member. Regenerate with GOLDEN_GATE_WRITE=1 npx vitest run src/lib/agents/deming/golden-gate.test.ts. Member = [expected, found, correct, wrong, forbidden, letThrough, missed fees].`,
    goldenSet: { version: set.version, manifestSha256: set.manifestSha256, measured: publish.members.measured, notLoaded: publish.members.notLoaded },
    stages: { publish: compact(set, publish), after_sweeps: compact(set, afterSweeps) },
  };
}

/** One member per line, so a moved member is one changed line in review. */
export function serializeBaseline(baseline: GateBaseline): string {
  const stage = (members: Record<string, CompactMember>) =>
    Object.entries(members).map(([id, member]) => `   ${JSON.stringify(id)}: ${JSON.stringify(member)}`).join(",\n");
  return `{\n "about": ${JSON.stringify(baseline.about)},\n "goldenSet": ${JSON.stringify(baseline.goldenSet)},\n "stages": {\n${GATE_STAGES
    .map((name) => `  ${JSON.stringify(name)}: {\n${stage(baseline.stages[name])}\n  }`).join(",\n")}\n }\n}\n`;
}

export interface Totals {
  recall: { expected: number; found: number; rate: number | null };
  precision: { correct: number; wrong: number; rate: number | null };
  knownWrongRefused: { cases: number; refused: number; rate: number | null };
}

const ratio = (part: number, whole: number) => (whole === 0 ? null : part / whole);

export function totals(members: Record<string, CompactMember>, ids: Iterable<string> = Object.keys(members)): Totals {
  let expected = 0, found = 0, correct = 0, wrong = 0, forbidden = 0, letThrough = 0;
  for (const id of ids) {
    const m = members[id];
    if (!m) continue;
    expected += m[0]; found += m[1]; correct += m[2]; wrong += m[3]; forbidden += m[4]; letThrough += m[5];
  }
  return {
    recall: { expected, found, rate: ratio(found, expected) },
    precision: { correct, wrong, rate: ratio(correct, correct + wrong) },
    knownWrongRefused: { cases: forbidden, refused: forbidden - letThrough, rate: ratio(forbidden - letThrough, forbidden) },
  };
}

export interface StageVerdict {
  stage: GateStage;
  members: number;
  /** Members in only one of the two (a golden-set append): left out of both sides' numbers. */
  notCompared: number;
  main: Totals;
  head: Totals;
  lost: Array<{ member: string; fee: string }>;
  gained: Array<{ member: string; fee: string }>;
  moreWrong: Array<{ member: string; main: number; head: number }>;
  moreLetThrough: Array<{ member: string; main: number; head: number }>;
  /** Each number worse than main beyond the tolerance. Empty passes. */
  worse: string[];
}

const EPSILON = 1e-12;
const fellBeyond = (before: number | null, after: number | null, tolerance: number) =>
  before != null && after != null && after < before - tolerance - EPSILON;

/** The PR head against main's baseline, member by member, on the members both measured. */
export function compareStage(stage: GateStage, main: Record<string, CompactMember>, head: Record<string, CompactMember>,
  tolerance: Readonly<GateTolerance> = GOLDEN_GATE_TOLERANCE): StageVerdict {
  const ids = Object.keys(head).filter((id) => main[id]).sort();
  const all = new Set([...Object.keys(main), ...Object.keys(head)]);
  const lost: StageVerdict["lost"] = [];
  const gained: StageVerdict["gained"] = [];
  const moreWrong: StageVerdict["moreWrong"] = [];
  const moreLetThrough: StageVerdict["moreLetThrough"] = [];
  for (const id of ids) {
    const [before, after] = [main[id], head[id]];
    const missedBefore = new Set(before[6]);
    const missedAfter = new Set(after[6]);
    for (const fee of after[6]) if (!missedBefore.has(fee)) lost.push({ member: id, fee });
    for (const fee of before[6]) if (!missedAfter.has(fee)) gained.push({ member: id, fee });
    if (after[3] > before[3]) moreWrong.push({ member: id, main: before[3], head: after[3] });
    if (after[5] > before[5]) moreLetThrough.push({ member: id, main: before[5], head: after[5] });
  }
  const [mainTotals, headTotals] = [totals(main, ids), totals(head, ids)];
  const worse: string[] = [];
  if (fellBeyond(mainTotals.recall.rate, headTotals.recall.rate, tolerance.recall)) worse.push("recall");
  if (fellBeyond(mainTotals.precision.rate, headTotals.precision.rate, tolerance.precision)) worse.push("precision");
  if (fellBeyond(mainTotals.knownWrongRefused.rate, headTotals.knownWrongRefused.rate, tolerance.knownWrongRefused)) worse.push("known-wrong refused");
  if (lost.length > tolerance.lostFees) worse.push("expected fees lost");
  if (moreWrong.length > tolerance.membersMoreWrong) worse.push("members publishing more known-wrong fees");
  if (moreLetThrough.length > tolerance.membersMoreLetThrough) worse.push("members letting more known-wrong fees or takedowns through");
  return { stage, members: ids.length, notCompared: all.size - ids.length, main: mainTotals, head: headTotals, lost, gained, moreWrong, moreLetThrough, worse };
}

export function compareToBaseline(main: GateBaseline, head: GateBaseline): StageVerdict[] {
  return GATE_STAGES.map((stage) => compareStage(stage, main.stages[stage] ?? {}, head.stages[stage] ?? {}));
}

const SOURCE = /\.(ts|tsx)$/;
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

function resolveImport(root: string, from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(root, "src", spec.slice(2)) : spec.startsWith(".") ? join(dirname(join(root, from)), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return relative(root, normalize(candidate)).split("\\").join("/");
  }
  return null;
}

/**
 * Every file the gate's replay loads: the static (non-type) import closure of this module, plus the
 * golden set, its scenario fixtures and the baseline. Computed from the code each run, so a new
 * dependency of the replay joins the path filter without anyone editing a list.
 */
export function pipelineFiles(root: string = process.cwd(), entries: readonly string[] = ["src/lib/agents/deming/golden-gate.ts"]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!SOURCE.test(file)) continue;
    const text = readFileSync(join(root, file), "utf8");
    for (const match of text.matchAll(IMPORT)) {
      const resolved = resolveImport(root, file, match[1] ?? match[2]);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  for (const path of [GOLDEN_SET_PATH, GOLDEN_GATE_BASELINE_PATH, ...FIXTURE_PATHS]) seen.add(path);
  return seen;
}

/** Paths that always run the gate, whatever the closure holds: every agent and the gate's fixtures. */
export const ALWAYS_GATED = [/^src\/lib\/agents\//, /^src\/lib\/custom-report\/source-check\.ts$/];

/** The changed files that put a PR under the gate; empty means it skips. */
export function gatedChanges(changed: readonly string[], files: ReadonlySet<string>): string[] {
  return changed.map((path) => path.trim()).filter(Boolean)
    .filter((path) => files.has(path) || ALWAYS_GATED.some((pattern) => pattern.test(path)));
}

const percent = (rate: number | null) => (rate == null ? "n/a" : `${(rate * 100).toFixed(2)}%`);
const points = (before: number | null, after: number | null) =>
  before == null || after == null ? "n/a" : `${after - before >= 0 ? "+" : ""}${((after - before) * 100).toFixed(2)} pt`;
const STAGE_TEXT: Record<GateStage, string> = {
  publish: "Published (Knox -> Darwin -> Hamilton replay)",
  after_sweeps: "After the replayed database sweeps",
};
const SHOWN = 25;

export function renderGate(verdicts: readonly StageVerdict[], note: string): string {
  const failed = verdicts.some((verdict) => verdict.worse.length > 0);
  const lines = [`## Golden-set pipeline gate: ${failed ? "FAIL, a number is worse than main" : "PASS, no number is worse than main"}`, "", note, "",
    `Tolerance: ${JSON.stringify(GOLDEN_GATE_TOLERANCE)} (zero: no worse on fees right).`, ""];
  for (const v of verdicts) {
    lines.push(`### ${STAGE_TEXT[v.stage]}: ${v.worse.length > 0 ? `FAIL (${v.worse.join(", ")})` : "pass"}`, "",
      `${v.members} members compared${v.notCompared > 0 ? `, ${v.notCompared} in only one side (not compared)` : ""}.`, "",
      "| Measure | main | PR head | Change |", "| --- | --- | --- | --- |",
      `| Recall | ${percent(v.main.recall.rate)} (${v.main.recall.found}/${v.main.recall.expected}) | ${percent(v.head.recall.rate)} (${v.head.recall.found}/${v.head.recall.expected}) | ${points(v.main.recall.rate, v.head.recall.rate)} |`,
      `| Precision | ${percent(v.main.precision.rate)} (${v.main.precision.correct}/${v.main.precision.correct + v.main.precision.wrong}) | ${percent(v.head.precision.rate)} (${v.head.precision.correct}/${v.head.precision.correct + v.head.precision.wrong}) | ${points(v.main.precision.rate, v.head.precision.rate)} |`,
      `| Known-wrong refused | ${percent(v.main.knownWrongRefused.rate)} (${v.main.knownWrongRefused.refused}/${v.main.knownWrongRefused.cases}) | ${percent(v.head.knownWrongRefused.rate)} (${v.head.knownWrongRefused.refused}/${v.head.knownWrongRefused.cases}) | ${points(v.main.knownWrongRefused.rate, v.head.knownWrongRefused.rate)} |`,
      `| Expected fees lost / gained | | ${v.lost.length} / ${v.gained.length} | |`,
      `| Members publishing more known-wrong fees | | ${v.moreWrong.length} | |`,
      `| Members letting more known-wrong fees or takedowns through | | ${v.moreLetThrough.length} | |`, "");
    const list = (title: string, rows: string[]) => {
      if (rows.length === 0) return;
      lines.push(`${title}:`, ...rows.slice(0, SHOWN).map((row) => `- ${row}`), ...(rows.length > SHOWN ? [`- and ${rows.length - SHOWN} more (the JSON receipt lists all)`] : []), "");
    };
    list("Expected fees lost", v.lost.map((row) => `${row.fee} (${row.member})`));
    list("Members publishing more known-wrong fees", v.moreWrong.map((row) => `${row.member}: ${row.main} -> ${row.head}`));
    list("Members letting more through", v.moreLetThrough.map((row) => `${row.member}: ${row.main} -> ${row.head}`));
    list("Expected fees gained", v.gained.map((row) => `${row.fee} (${row.member})`));
  }
  return lines.join("\n");
}
