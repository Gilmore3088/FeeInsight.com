import { compareGoldenSet, goldenMatches, goldenTraces, measureGoldenSet, notLoadedNote, type GoldenSet, type GoldenSetComparison, type GoldenSetMeasure } from "./golden-set";
import { experimentalVariant, type ExperimentConfig } from "./shadow-lab/variants";
import type { CaseTrace, FeeRef, ShadowCase, StageFee } from "./shadow-lab/types";
import { SWEEP_REPLAYS, sweepSwitches, sweepTraces } from "./sweep-replay";
import { DAILY_CAP_LINES_LIVE } from "@/lib/daily-cap-wording";
import { DASH_LIST_ROWS_LIVE } from "@/lib/agents/knox/dash-list-rows";
import { NOT_REPLAYABLE_REASONS } from "./switch-replay-reasons";

export { NOT_REPLAYABLE_REASONS };
/** Where `NOT_REPLAYABLE_REASONS` lives; the gate reads a PR's stated reasons from this file's added lines. */
export const NOT_REPLAYABLE_REASONS_PATH = "src/lib/agents/deming/switch-replay-reasons.ts";

/**
 * Plan step 4 (#2535): every `*_LIVE` switch passes the golden set before it turns on. A switch's
 * change replays on the frozen golden set (#2533, `golden-set.ts`) twice, switch held off and
 * switch held on, through the override parameters the replayed Knox, Darwin and Hamilton functions
 * already take (`ExperimentConfig.switches` in `shadow-lab/variants.ts`). No database, no model call.
 *
 * Only a switch listed in `SWITCH_REPLAYS` (read switches here, database sweeps from `sweep-replay.ts`) can be replayed. Every other switch gets a receipt that
 * says "not replayable" with its reason from `NOT_REPLAYABLE_REASONS`; with no reason it fails. A replay is `full` when every read of the switch on the
 * replay path takes the override, `full on shadow cases` when the shadow cases take it everywhere but
 * the regression members replay the PR head's own checks, and `partial` when some reads keep the PR
 * head's code value (the receipt names which). "Code value" always means the value in the PR head
 * being tested, not main's or prod's.
 *
 * The gate: no number gets worse with the switch on. Recall, precision and known-wrong refused
 * must not fall, no expected fee may be lost, and no member may publish or let through more
 * known-wrong fees. `switch-gate.test.ts` also proves each mapped override changes at least one
 * input, so a misspelled or ignored override cannot pass by measuring the same pipeline twice.
 */

export type ReplayScope = "full" | "full on shadow cases" | "partial" | "sweep" | "sweep, partial";

export interface SwitchReplay {
  scope: ReplayScope;
  /** What the replay holds on and off. */
  replays: string;
  /** For `partial`: the reads on the replay path that keep the PR head's code value. */
  keepsCodeValue?: string;
  /** The experiment fields that hold the switch at `on`. */
  config: (on: boolean) => Partial<Pick<ExperimentConfig, "dailyCapLines" | "dashListRows" | "switches">>;
  /**
   * A database sweep (`sweep-replay.ts`): the pipeline runs once at the PR head's code values and
   * the sweep's decision function runs over what it published, switch off then on.
   */
  sweep?: true;
}

const CATEGORY_KEEPS = "Knox's own category reads inside the free read and Darwin's `category_mismatch` check (`verificationReasonCode`)";

const READ_REPLAYS: Readonly<Record<string, SwitchReplay>> = {
  KNOX_HELD_NAME_RULES_LIVE: {
    scope: "full on shadow cases",
    replays: "every stage of the shadow-case replay runs under `withHeldNameRules(on)`, the module flag each held-name read consults; the regression members replay the PR head's own checks",
    config: (on) => ({ switches: { heldNameRules: on } }),
  },
  FOOTNOTED_ATM_HEADING_LIVE: {
    scope: "full on shadow cases",
    replays: "every stage of the shadow-case replay runs under `withFootnotedAtmHeading(on)`, the module flag the fold's ATM heading read (`ownAtmSection`) consults; the regression members replay the PR head's own checks, and the answer keys always fold with it on",
    config: (on) => ({ switches: { footnotedAtmHeading: on } }),
  },
  DASH_LIST_ROWS_LIVE: {
    scope: "full",
    replays: "Knox's free read (`runFreeSpecialists` `dashListRows`), its only read on the replay path",
    config: (on) => ({ dashListRows: on }),
  },
  KNOX_DISCONTINUED_TABLES_LIVE: {
    scope: "full",
    replays: "Knox's free read (`runFreeSpecialists` `withoutDiscontinuedTables`), its only read on the replay path",
    config: (on) => ({ switches: { withoutDiscontinuedTables: on } }),
  },
  DAILY_CAP_LINES_LIVE: {
    scope: "partial",
    replays: "Knox's self-check trace and Darwin's `statedInOwnSource` / `sourceLineFor` (`dailyCapLines`)",
    keepsCodeValue: "Knox's plain trace (`specialists.ts`, no options), Darwin's stated-$0 trace and the replay's own attribution trace",
    config: (on) => ({ dailyCapLines: on }),
  },
  NO_CHARGE_SENTENCE_READ_LIVE: {
    scope: "partial",
    replays: "Knox's free read (`noChargeSentences`) and Darwin's `statedInOwnSource` / `sourceLineFor`",
    keepsCodeValue: "Knox's self-check traces and the replay's own attribution trace",
    config: (on) => ({ switches: { noChargeSentences: on } }),
  },
  DARWIN_CONDITIONAL_ZERO_LAYOUT_LIVE: {
    scope: "partial",
    replays: "Darwin's post-source conditional-$0 check (`postSourceCheck` `layout`)",
    keepsCodeValue: "the layout default inside `sourceLineFor` (`ownSegment`), which picks the line the check reads",
    config: (on) => ({ switches: { conditionalZeroLayout: on } }),
  },
  BORROWED_DIRECTION_LIVE: {
    scope: "partial",
    replays: "Hamilton's publish category guard (`checkFeeCategory` `borrowedDirection`)",
    keepsCodeValue: `the replay's re-file of Knox's hint, ${CATEGORY_KEEPS}`,
    config: (on) => ({ switches: { category: { borrowedDirection: on } } }),
  },
  NON_CUSTOMER_CASHIERS_CHECK_LIVE: {
    scope: "partial",
    replays: "Hamilton's publish category guard (`checkFeeCategory` `nonCustomerCashiersCheck`)",
    keepsCodeValue: `the replay's re-file of Knox's hint, ${CATEGORY_KEEPS}`,
    config: (on) => ({ switches: { category: { nonCustomerCashiersCheck: on } } }),
  },
  INTL_ABBREVIATION_REFILE_LIVE: {
    scope: "partial",
    replays: "the replay's re-file of Knox's hint (`refileCategory`) and Hamilton's publish category guard (`intlAbbreviation`)",
    keepsCodeValue: CATEGORY_KEEPS,
    config: (on) => ({ switches: { category: { intlAbbreviation: on } } }),
  },
  LOAN_PAYMENT_NSF_REFILE_LIVE: {
    scope: "partial",
    replays: "the replay's re-file of Knox's hint (`refileCategory`) and Hamilton's publish category guard (`loanPaymentNsf`)",
    keepsCodeValue: CATEGORY_KEEPS,
    config: (on) => ({ switches: { category: { loanPaymentNsf: on } } }),
  },
};

/** Every sweep switch (`SWEEP_REPLAYS`): the sweep's decision function over the golden publications. */
const SWEEP_SWITCH_REPLAYS: Readonly<Record<string, SwitchReplay>> = Object.fromEntries(SWEEP_REPLAYS.flatMap((sweep) =>
  Object.keys(sweep.switches).map((name) => [name, {
    scope: sweep.scope, replays: `${sweep.replays} (\`${sweep.check}\`)`, keepsCodeValue: sweep.keepsCodeValue, sweep: true, config: () => ({}),
  } satisfies SwitchReplay])));

export const SWITCH_REPLAYS: Readonly<Record<string, SwitchReplay>> = { ...READ_REPLAYS, ...SWEEP_SWITCH_REPLAYS };

/** The inventory's replay cell for a switch: its scope, its stated reason, or the missing reason that fails the inventory. */
export const MISSING_REASON = "no: NO REASON STATED (add one to NOT_REPLAYABLE_REASONS in src/lib/agents/deming/switch-replay-reasons.ts)";
export function replayCell(name: string): string {
  const spec = SWITCH_REPLAYS[name];
  if (spec) return spec.scope;
  const reason = NOT_REPLAYABLE_REASONS[name];
  return reason ? `no: ${reason}` : MISSING_REASON;
}

export function switchExperiment(name: string, spec: SwitchReplay, on: boolean): ExperimentConfig {
  return {
    id: `${name}=${on ? "on" : "off"}`,
    description: `${name} held ${on ? "on" : "off"}: ${spec.replays}.`,
    excerptAtPublish: false,
    // Every switch but the one under test keeps the PR head's code value.
    dailyCapLines: DAILY_CAP_LINES_LIVE,
    dashListRows: DASH_LIST_ROWS_LIVE,
    ...spec.config(on),
  };
}

export interface WorseFee {
  member: string;
  /** An expected fee no longer published; a known-wrong fee now published; a forbidden fee or takedown now let through. */
  change: "lost" | "wrong_published" | "let_through";
  /** Null for a regression takedown whose frozen input names no fee. */
  fee: FeeRef | null;
}

export interface SwitchReceipt {
  switch: string;
  status: "pass" | "fail" | "not_replayable" | "no_reason" | "not_comparable" | "removed" | "retired";
  scope: ReplayScope | null;
  replays: string | null;
  keepsCodeValue: string | null;
  /** Why a switch is not replayable, or why the two runs were not comparable. */
  reason: string | null;
  goldenSet: { version: number; manifestSha256: string; members: GoldenSetMeasure["members"]; notLoadedIds?: readonly string[] } | null;
  off: Pick<GoldenSetMeasure, "recall" | "precision" | "knownWrongRefused"> | null;
  on: Pick<GoldenSetMeasure, "recall" | "precision" | "knownWrongRefused"> | null;
  comparison: Omit<GoldenSetComparison, "lost" | "gained" | "moreWrong" | "moreLetThrough">
    & { lost: number; gained: number; moreWrong: number; moreLetThrough: number; membersChanged: number } | null;
  /** The numbers that got worse, by name. */
  worse: string[];
  /** The fees behind them: expected fees lost, and known-wrong fees the switch publishes. */
  worseFees: WorseFee[];
  gainedFees: Array<{ member: string; fee: FeeRef }>;
}

const EPSILON = 1e-12;
const fell = (delta: number | null) => delta != null && delta < -EPSILON;
const feeKey = (fee: StageFee | FeeRef) => JSON.stringify([fee.canonicalFeeKey, fee.amountCents, fee.frequency ?? null, fee.feeName]);

type Traces = ReadonlyMap<string, CaseTrace>;
const byCase = (traces: readonly CaseTrace[]): Traces => new Map(traces.map((trace) => [trace.caseKey, trace]));

/** Known-wrong publications of one member in a run, as `measureGoldenSet` counts them. */
function wrongPublications(set: GoldenSet, memberId: string, traces: Traces): StageFee[] {
  const entry = set.cases.find((candidate) => candidate.member.id === memberId);
  if (!entry) return [];
  const published = traces.get(entry.case.caseKey)?.published ?? [];
  const hit = (ref: FeeRef, fee: StageFee) => goldenMatches(entry.member, ref, fee);
  return published.filter((fee) => entry.case.expected.forbid.some((ref) => hit(ref, fee))
    || (!entry.case.expected.publish.some((ref) => hit(ref, fee)) && entry.member.completeInventory));
}

const asRef = (fee: StageFee): FeeRef => ({ canonicalFeeKey: fee.canonicalFeeKey, feeName: fee.feeName, amountCents: fee.amountCents, frequency: fee.frequency ?? null });

/** The forbidden fees one member publishes in a run (shadow cases; a takedown names its own). */
function letThroughFees(set: GoldenSet, memberId: string, traces: Traces): FeeRef[] {
  const entry = set.cases.find((candidate) => candidate.member.id === memberId);
  if (!entry) return [];
  const published = traces.get(entry.case.caseKey)?.published ?? [];
  return entry.case.expected.forbid.filter((ref) => published.some((fee) => goldenMatches(entry.member, ref, fee)));
}

function takedownFee(set: GoldenSet, memberId: string): FeeRef | null {
  const input = set.regression.find((member) => member.id === memberId)?.input as Record<string, unknown> | undefined;
  const source = (input?.fee ?? input) as Record<string, unknown> | undefined;
  if (!source || typeof source.canonical_fee_key !== "string") return null;
  const amount = source.amount == null ? null : Number(source.amount);
  return { canonicalFeeKey: source.canonical_fee_key, feeName: typeof source.fee_name === "string" ? source.fee_name : null,
    amountCents: amount == null || Number.isNaN(amount) ? null : Math.round(amount * 100) };
}

/** The gate: each number that got worse from switch off to switch on. Empty passes. */
export function worseNumbers(comparison: Pick<GoldenSetComparison, "recall" | "precision" | "knownWrongRefused" | "lost" | "moreWrong" | "moreLetThrough">): string[] {
  const worse: string[] = [];
  if (fell(comparison.recall.delta)) worse.push("recall");
  if (fell(comparison.precision.delta)) worse.push("precision");
  if (fell(comparison.knownWrongRefused.delta)) worse.push("known-wrong refused");
  if (comparison.lost.length > 0) worse.push("expected fees lost");
  if (comparison.moreWrong.length > 0) worse.push("members publishing more known-wrong fees");
  if (comparison.moreLetThrough.length > 0) worse.push("members letting more known-wrong fees or takedowns through");
  return worse;
}

/** Members whose found, correct, wrong or let-through count differs between the two runs. */
function membersChanged(off: GoldenSetMeasure, on: GoldenSetMeasure): number {
  const sig = (r: GoldenSetMeasure["perMember"][number]) => `${r.found}:${r.correct}:${r.wrong}:${r.letThrough}`;
  const before = new Map(off.perMember.map((r) => [r.id, sig(r)]));
  return on.perMember.filter((r) => before.get(r.id) !== sig(r)).length;
}

/** Why a switch has no replay: its line in `NOT_REPLAYABLE_REASONS`, or null when none is stated. */
export type NotReplayableReason = string | null;

/** The pipeline at the PR head's code values, run once per set and shared by every sweep replay. */
const headTraces = new WeakMap<GoldenSet, CaseTrace[]>();
function sweepBase(set: GoldenSet, name: string, spec: SwitchReplay): CaseTrace[] {
  const cached = headTraces.get(set);
  if (cached) return cached;
  const traces = goldenTraces(set, experimentalVariant(switchExperiment(name, spec, false)));
  headTraces.set(set, traces);
  return traces;
}

/** One run of a switch held off or on: its traces (sweeps applied after publish for a sweep switch). */
function switchRun(set: GoldenSet, name: string, spec: SwitchReplay, on: boolean): CaseTrace[] {
  if (!spec.sweep) return goldenTraces(set, experimentalVariant(switchExperiment(name, spec, on)));
  const cases = new Map<string, ShadowCase>(set.cases.map((entry) => [entry.case.caseKey, entry.case]));
  return sweepTraces(sweepBase(set, name, spec), cases, sweepSwitches({ [name]: on }));
}

/** One switch, off then on, on the same frozen set. */
export function replaySwitch(set: GoldenSet, name: string, notReplayable: NotReplayableReason = NOT_REPLAYABLE_REASONS[name] ?? null): SwitchReceipt {
  const spec = SWITCH_REPLAYS[name];
  const goldenSet = { version: set.version, manifestSha256: set.manifestSha256, members: { total: set.manifest.members.length, measured: set.cases.length + set.regression.length, notLoaded: set.notLoaded.length, problems: set.problems.length }, notLoadedIds: set.notLoaded };
  if (!spec) {
    return { switch: name, status: notReplayable ? "not_replayable" : "no_reason", scope: null, replays: null, keepsCodeValue: null,
      reason: notReplayable ?? `no replay is mapped in \`SWITCH_REPLAYS\` and no reason is stated in \`NOT_REPLAYABLE_REASONS\``,
      goldenSet, off: null, on: null, comparison: null, worse: [], worseFees: [], gainedFees: [] };
  }
  const offTraces = switchRun(set, name, spec, false);
  const onTraces = switchRun(set, name, spec, true);
  const offConfig = switchExperiment(name, spec, false);
  const onConfig = switchExperiment(name, spec, true);
  const off = measureGoldenSet(set, experimentalVariant(offConfig), { traces: offTraces });
  const on = measureGoldenSet(set, experimentalVariant(onConfig), { traces: onTraces });
  const [offBy, onBy] = [byCase(offTraces), byCase(onTraces)];
  const comparison = compareGoldenSet(off, on);
  const worse = worseNumbers(comparison);
  const worseFees: WorseFee[] = comparison.lost.map((entry) => ({ member: entry.id, change: "lost", fee: entry.fee }));
  for (const member of comparison.moreWrong) {
    const before = new Set(wrongPublications(set, member.id, offBy).map(feeKey));
    for (const fee of wrongPublications(set, member.id, onBy)) {
      if (!before.has(feeKey(fee))) worseFees.push({ member: member.id, change: "wrong_published", fee: asRef(fee) });
    }
  }
  for (const member of comparison.moreLetThrough) {
    if (member.id.startsWith("regression:")) {
      worseFees.push({ member: member.id, change: "let_through", fee: takedownFee(set, member.id) });
      continue;
    }
    const before = new Set(letThroughFees(set, member.id, offBy).map(feeKey));
    for (const fee of letThroughFees(set, member.id, onBy)) {
      if (!before.has(feeKey(fee))) worseFees.push({ member: member.id, change: "let_through", fee });
    }
  }
  const status = !comparison.comparable ? "not_comparable" : worse.length > 0 ? "fail" : "pass";
  const { lost, gained, moreWrong, moreLetThrough, ...rates } = comparison;
  return {
    switch: name, status, scope: spec.scope, replays: spec.replays, keepsCodeValue: spec.keepsCodeValue ?? null,
    reason: comparison.comparable ? null : comparison.reason,
    goldenSet: { version: off.version, manifestSha256: off.manifestSha256, members: off.members, notLoadedIds: set.notLoaded },
    off: { recall: off.recall, precision: off.precision, knownWrongRefused: off.knownWrongRefused },
    on: { recall: on.recall, precision: on.precision, knownWrongRefused: on.knownWrongRefused },
    comparison: { ...rates, lost: lost.length, gained: gained.length, moreWrong: moreWrong.length, moreLetThrough: moreLetThrough.length, membersChanged: membersChanged(off, on) },
    worse, worseFees,
    gainedFees: gained.map((entry) => ({ member: entry.id, fee: entry.fee })),
  };
}

/**
 * Switches a diff turns on: a code constant defined `true` on an added line of non-test source
 * whose removed lines do not define it `true` (a flip from false, or a new switch added on).
 * An environment switch flips outside the code, so a diff cannot show it.
 */
export function switchesTurnedOnInDiff(diff: string): string[] {
  const addedTrue = new Set<string>();
  const removedTrue = new Set<string>();
  let skip = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const path = line.split(" b/").pop() ?? "";
      skip = isSwitchTooling(path) || isTestSource(path);
    }
    if (skip || !/^[+-]/.test(line) || line.startsWith("+++") || line.startsWith("---")) continue;
    const match = /\bconst\s+([A-Z][A-Z0-9_]*_LIVE)\b\s*(?::\s*boolean)?\s*=\s*true\b/.exec(line);
    if (match) (line.startsWith("+") ? addedTrue : removedTrue).add(match[1]);
  }
  return [...addedTrue].filter((name) => !removedTrue.has(name)).sort();
}

/** Switches whose `NOT_REPLAYABLE_REASONS` line is on an added line of this diff. */
export function reasonsStatedInDiff(diff: string): string[] {
  const names = new Set<string>();
  let inReplay = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) inReplay = (line.split(" b/").pop() ?? "") === NOT_REPLAYABLE_REASONS_PATH;
    const match = inReplay ? /^\+\s*([A-Z][A-Z0-9_]*_LIVE):\s*[`"]/.exec(line) : null;
    if (match) names.add(match[1]);
  }
  return [...names].sort();
}

/**
 * The receipt of a switch the golden set cannot replay, as the gate judges it: a stated reason
 * passes it loudly, no reason fails, and a switch this diff turns on fails unless the same diff
 * adds its reason line.
 */
export function unreplayableVerdict(receipt: SwitchReceipt, turnedOn: ReadonlySet<string>, statedInDiff: ReadonlySet<string>): string | null {
  if (receipt.status === "no_reason") return `${receipt.switch} has no replay and no stated reason: add a replay (\`SWITCH_REPLAYS\` or \`SWEEP_REPLAYS\`) or its line in \`NOT_REPLAYABLE_REASONS\``;
  if (receipt.status !== "not_replayable") return null;
  if (turnedOn.has(receipt.switch) && !statedInDiff.has(receipt.switch)) {
    return `${receipt.switch} is turned on in this PR with no golden-set replay: state why in this PR by adding (or rewording) its line in \`NOT_REPLAYABLE_REASONS\` (src/lib/agents/deming/switch-replay-reasons.ts), or add a replay`;
  }
  return null;
}


/** Tests and fixtures name switches without defining or reading them. */
export const isTestSource = (path: string) => /\.test\.tsx?$|\.fixtures\.ts$|\/__fixtures__\//.test(path);
/**
 * The gate, the inventory and its facts file name switches to map them, and the read-only dry-run audit (#2842) names
 * the switches it counts; editing them turns no switch on. The inventory page once held every
 * switch's row, so the PR that removed them (2026-11-02) would otherwise name all of them.
 */
export const isSwitchTooling = (path: string) =>
  /^src\/lib\/agents\/deming\/switch-(inventory|inventory-facts|replay|replay-reasons|gate)(\.test)?\.ts$/.test(path)
  || path === "docs/project/switch-inventory.md"
  || /^src\/lib\/agents\/deming\/switch-dry-runs\//.test(path)
  || /^src\/lib\/data-store\/switch-dry-runs(\.db)?(\.test)?\.ts$/.test(path);

/** At most this many switches replay for one diff; more get a "too many" receipt (about 70 s each). */
export const MAX_SWITCHES_PER_DIFF = 6;

/**
 * A switch counts as named by a PR when an added or removed line of non-test source in its diff
 * names it. Tests, fixtures and the gate's own files are skipped.
 */
export function switchesNamedInDiff(diff: string, known: ReadonlySet<string>): string[] {
  const { added, removed } = namesOnChangedLines(diff);
  return [...new Set([...added, ...removed])].filter((name) => known.has(name)).sort();
}

/** Every `*_LIVE` name on an added or a removed line of non-test source. */
function namesOnChangedLines(diff: string): { added: Set<string>; removed: Set<string> } {
  const added = new Set<string>();
  const removed = new Set<string>();
  let skip = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const path = line.split(" b/").pop() ?? "";
      skip = isSwitchTooling(path) || isTestSource(path);
    }
    if (skip || !/^[+-]/.test(line) || line.startsWith("+++") || line.startsWith("---")) continue;
    for (const match of line.matchAll(/\b[A-Z][A-Z0-9_]*_LIVE\b/g)) (line.startsWith("-") ? removed : added).add(match[0]);
  }
  return { added, removed };
}

/**
 * Switches retired under the 14-day rule (DECISIONS, 2026-11-01). A PR that removes a switch's last
 * use adds its name here with the on-date and receipts it cites, so the removal is reviewed in the
 * diff. Any other `*_LIVE` name that disappears from `src/` fails the gate.
 */
export const RETIRED_SWITCHES: Readonly<Record<string, string>> = {};

/**
 * `*_LIVE` names on a removed line of non-test source that appear nowhere in the PR head's `src/`:
 * a deleted or renamed switch. Deleting `FOO_LIVE = false` with its guard turns the path on
 * everywhere, and the head scan no longer sees the name, so it is collected here instead.
 */
export function switchesRemovedInDiff(diff: string, headNames: ReadonlySet<string>): string[] {
  return [...namesOnChangedLines(diff).removed].filter((name) => !headNames.has(name)).sort();
}

/** The receipt for a removed name: it fails, unless the name is listed in `RETIRED_SWITCHES`. */
export function removedSwitchReceipt(name: string, retired: Readonly<Record<string, string>> = RETIRED_SWITCHES): SwitchReceipt {
  const note = retired[name];
  return {
    switch: name, status: note ? "retired" : "removed", scope: null, replays: null, keepsCodeValue: null,
    reason: note
      ? `retired under the 14-day rule: ${note}`
      : "the PR removes every use of this name from `src/`, so its code path changes everywhere with no golden-set replay. " +
        "If it is retired under the 14-day rule, add it to `RETIRED_SWITCHES` in `src/lib/agents/deming/switch-replay.ts` with its on-date and receipts. " +
        "If it is renamed, the new name gets its own receipt",
    goldenSet: null, off: null, on: null, comparison: null, worse: [], worseFees: [], gainedFees: [],
  };
}

/** What a PR naming more than `MAX_SWITCHES_PER_DIFF` switches fails with: the local command to run. */
export function tooManyMessage(names: readonly string[]): string {
  return `TOO MANY: this PR names ${names.length} switches (cap ${MAX_SWITCHES_PER_DIFF}), so none was replayed in CI. ` +
    `Run them locally and paste the receipts into the PR: \`SWITCH_GATE_SWITCHES=${names.join(",")} npx vitest run src/lib/agents/deming/switch-gate.test.ts\`.`;
}

const percent = (rate: number | null) => (rate == null ? "n/a" : `${(rate * 100).toFixed(2)}%`);
const points = (delta: number | null) => (delta == null ? "n/a" : `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(2)} pt`);
const feeText = (fee: FeeRef) => `${fee.canonicalFeeKey ?? "?"} ${fee.amountCents == null ? "varies" : `$${(fee.amountCents / 100).toFixed(2)}`}${fee.feeName ? ` "${fee.feeName}"` : ""}`;
const STATUS_LINE: Record<SwitchReceipt["status"], string> = {
  pass: "PASS: no number got worse with the switch on",
  fail: "FAIL: a number got worse with the switch on",
  not_replayable: "NOT REPLAYABLE: the golden set cannot replay this switch; it passes only on the reason stated below, which review reads",
  no_reason: "NOT REPLAYABLE, NO REASON STATED: this receipt fails until a replay or a reason in NOT_REPLAYABLE_REASONS is added",
  not_comparable: "NOT COMPARABLE: the off and on runs measured different members",
  removed: "REMOVED: the PR deletes this switch name from src/ with no replay, so this receipt fails",
  retired: "RETIRED: removed under the 14-day rule and listed in RETIRED_SWITCHES",
};
const SHOWN_FEES = 25;
const CHANGE_TEXT: Record<WorseFee["change"], string> = {
  lost: "expected fee lost",
  wrong_published: "wrong fee published",
  let_through: "known-wrong fee let through",
};

/** The receipt a PR carries for one switch, as Markdown. */
export function renderReceipt(receipt: SwitchReceipt): string {
  const lines = [`### ${receipt.switch}: ${STATUS_LINE[receipt.status]}`, ""];
  const g = receipt.goldenSet;
  if (g) lines.push(`Golden set v${g.version} (members sha256 \`${g.manifestSha256.slice(0, 12)}\`): ${g.members.measured} of ${g.members.total} members measured, ${g.members.notLoaded} answer-key banks not loaded, ${g.members.problems} problems.`, "");
  if (g?.notLoadedIds) lines.push(notLoadedNote(g.notLoadedIds), "");
  if (receipt.status === "not_replayable" || receipt.status === "no_reason" || receipt.status === "removed" || receipt.status === "retired") {
    lines.push(`Why: ${receipt.reason}.`, "");
    return lines.join("\n");
  }
  lines.push(`Replay (${receipt.scope}): ${receipt.replays}.`);
  if (receipt.keepsCodeValue) lines.push(`Keeps the PR head's code value: ${receipt.keepsCodeValue}.`);
  if (receipt.reason) lines.push(`Not comparable: ${receipt.reason}.`);
  const off = receipt.off;
  const on = receipt.on;
  const c = receipt.comparison;
  if (off && on && c) {
    lines.push("", "| Measure | Switch off | Switch on | Change |", "| --- | --- | --- | --- |",
      `| Recall | ${percent(off.recall.rate)} (${off.recall.found}/${off.recall.expected}) | ${percent(on.recall.rate)} (${on.recall.found}/${on.recall.expected}) | ${points(c.recall.delta)} |`,
      `| Precision | ${percent(off.precision.rate)} (${off.precision.correct}/${off.precision.judged}) | ${percent(on.precision.rate)} (${on.precision.correct}/${on.precision.judged}) | ${points(c.precision.delta)} |`,
      `| Known-wrong refused | ${percent(off.knownWrongRefused.rate)} (${off.knownWrongRefused.refused}/${off.knownWrongRefused.cases}) | ${percent(on.knownWrongRefused.rate)} (${on.knownWrongRefused.refused}/${on.knownWrongRefused.cases}) | ${points(c.knownWrongRefused.delta)} |`,
      `| Expected fees lost | | ${c.lost} | |`,
      `| Expected fees gained | | ${c.gained} | |`,
      `| Members publishing more known-wrong fees | | ${c.moreWrong} | |`,
      `| Members letting more known-wrong fees or takedowns through | | ${c.moreLetThrough} | |`,
      `| Members whose result changed | | ${c.membersChanged} | |`);
    if (c.membersChanged === 0) {
      lines.push("", "No golden-set member moved: the set holds no case this switch changes, so this pass shows only that nothing regressed.");
    }
  }
  if (receipt.worse.length > 0) lines.push("", `Got worse: ${receipt.worse.join(", ")}.`);
  if (receipt.worseFees.length > 0) {
    lines.push("", "Fees that got worse:");
    for (const fee of receipt.worseFees.slice(0, SHOWN_FEES)) {
      lines.push(`- ${CHANGE_TEXT[fee.change]}: ${fee.fee ? feeText(fee.fee) : "a confirmed takedown"} (${fee.member})`);
    }
    if (receipt.worseFees.length > SHOWN_FEES) lines.push(`- and ${receipt.worseFees.length - SHOWN_FEES} more (the JSON receipt lists all)`);
  }
  if (receipt.gainedFees.length > 0) {
    lines.push("", "Expected fees gained:");
    for (const fee of receipt.gainedFees.slice(0, SHOWN_FEES)) lines.push(`- ${feeText(fee.fee)} (${fee.member})`);
    if (receipt.gainedFees.length > SHOWN_FEES) lines.push(`- and ${receipt.gainedFees.length - SHOWN_FEES} more`);
  }
  lines.push("");
  return lines.join("\n");
}
