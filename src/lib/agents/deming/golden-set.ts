import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashText } from "@/lib/agents/rosetta/read";
import { referenceKeyFingerprint, type ReferenceKeySnapshot } from "@/lib/data-store/answer-key-eligibility";
import { replayCase, type CaseInput } from "./checkers";
import { toCents } from "./shadow-lab/rows";
import { matches } from "./shadow-lab/metrics";
import { runAll } from "./shadow-lab/run-case";
import { loadScenarios } from "./shadow-lab/scenarios";
import { currentVariant } from "./shadow-lab/variants";
import type { FeeRef, PipelineVariant, ScenarioId, ShadowCase } from "./shadow-lab/types";

/**
 * The golden set (#2533, #2535 plan step 3): a frozen, versioned, append-only list of cases with
 * known answers, and one deterministic measure of recall and precision on it. No database by
 * default, no model calls.
 *
 * Members reference their inputs instead of copying them: a shadow-lab case names its committed
 * fixture and the sha256 of its document text (W43 live audit, adversarial documents, hard
 * documents, the hourly rows and the holdout answer keys). Expectations are frozen in the manifest,
 * so a later change to how a fixture is scored cannot move the golden answer. Regression cases
 * freeze their small check input, because `regression-cases.json` is rebuilt from production and
 * may drop a case. Answer-key banks name the key's fingerprint and document hash; their text is
 * read from the database by `loadAnswerKeyBankTexts` and they are skipped offline.
 *
 * Append-only: `GOLDEN_SET_VERSIONS` pins the sha256 of each version's member prefix, so editing
 * or removing an existing member fails `golden-set.test.ts`. A new version only appends.
 */

export const GOLDEN_SET_PATH = "src/lib/agents/deming/__fixtures__/golden-set.json";

/** Each version's member count and the sha256 of `JSON.stringify(members.slice(0, count))`. */
export const GOLDEN_SET_VERSIONS: readonly GoldenSetVersion[] = [
  // v1: 377 shadow-lab cases (W43 live audit, adversarial, hard documents, hourly rows, holdout
  // answer keys), 125 regression takedowns and the 4 answer-key banks eligible on Nov 1.
  { version: 1, frozenAt: "2026-11-01", members: 381, sha256: "e7999e1d4715f62220974173cea34b56ff9e532accc941d401f427fe29b602c4" },
];

export interface GoldenSetVersion {
  version: number;
  frozenAt: string;
  members: number;
  sha256: string;
}

export interface GoldenExpected {
  publish: FeeRef[];
  forbid: FeeRef[];
  publishCount?: { canonicalFeeKey: string; amountCents: number; count: number };
  documentIsSchedule?: boolean;
}

interface MemberBase {
  id: string;
  since: number;
}

/** A frozen shadow-lab case: its text stays in the committed fixture, named by hash. */
export interface ShadowMember extends MemberBase {
  kind: "shadow_case";
  scenario: ScenarioId;
  fixture: string;
  caseKey: string;
  inputSha256: string;
  /** The expected list is the document's whole fee inventory, so any other publication is wrong. */
  completeInventory: boolean;
  expected: GoldenExpected;
}

/** A confirmed production takedown, frozen as the check read it. */
export interface RegressionMember extends MemberBase {
  kind: "regression_case";
  checkName: string;
  expectedVerdict: string;
  input: CaseInput;
}

/** An answer-key bank whose reference was eligible under a real run when it joined. */
export interface AnswerKeyBankMember extends MemberBase {
  kind: "answer_key_bank";
  answerKeyId: number;
  institutionId: number;
  documentUrl: string;
  contentHash: string;
  keyFingerprint: string;
  receiptEventId: number;
  receiptCheckedAt: string;
  completeInventory: true;
  expected: GoldenExpected;
}

export type GoldenMember = ShadowMember | RegressionMember | AnswerKeyBankMember;

export interface GoldenSetManifest {
  about: string;
  versions: GoldenSetVersion[];
  members: GoldenMember[];
}

export interface GoldenSet {
  version: number;
  manifestSha256: string;
  manifest: GoldenSetManifest;
  /** Shadow cases with frozen expectations, ready for `runAll`. */
  cases: Array<{ member: ShadowMember | AnswerKeyBankMember; case: ShadowCase }>;
  regression: RegressionMember[];
  /** Members that could not be loaded as frozen: missing fixture case or changed input. */
  problems: Array<{ id: string; reason: string }>;
  /** Answer-key banks with no text supplied (offline): counted, not measured. */
  notLoaded: string[];
}

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
export const membersSha256 = (members: readonly GoldenMember[]): string => sha256(JSON.stringify(members));

export function readGoldenManifest(root: string = process.cwd()): GoldenSetManifest {
  return JSON.parse(readFileSync(join(root, GOLDEN_SET_PATH), "utf8")) as GoldenSetManifest;
}

/** What a shadow case's frozen identity covers: its document, not how it is scored today. */
export function shadowInputSha(c: ShadowCase): string {
  return hashText(c.document.text ?? c.document.url ?? "");
}

/**
 * Loads the frozen set. `bankTexts` maps an answer-key bank member id to the stored text of its
 * reference document (`loadAnswerKeyBankTexts`); banks without one are listed in `notLoaded`.
 */
export function loadGoldenSet(options: { root?: string; manifest?: GoldenSetManifest; bankTexts?: ReadonlyMap<string, string | null> } = {}): GoldenSet {
  const root = options.root ?? process.cwd();
  const manifest = options.manifest ?? readGoldenManifest(root);
  const scenarios = new Map(loadScenarios(root).map((c) => [c.caseKey, c]));
  const problems: GoldenSet["problems"] = [];
  const notLoaded: string[] = [];
  const cases: GoldenSet["cases"] = [];
  const regression: RegressionMember[] = [];
  for (const member of manifest.members) {
    if (member.kind === "regression_case") {
      regression.push(member);
      continue;
    }
    if (member.kind === "answer_key_bank") {
      const text = options.bankTexts?.get(member.id) ?? null;
      if (text == null) {
        notLoaded.push(member.id);
        continue;
      }
      cases.push({ member, case: {
        caseKey: member.id, scenario: "missed_fees",
        provenance: { fixture: "answer_key_institutions", fixtureCaseKey: String(member.answerKeyId), textHash: hashText(text), issue: "#2533" },
        document: { url: member.documentUrl, text }, expected: { ...member.expected }, status: "ok",
      } });
      continue;
    }
    const found = scenarios.get(member.caseKey);
    if (!found) {
      problems.push({ id: member.id, reason: `fixture case ${member.caseKey} is missing from ${member.fixture}` });
      continue;
    }
    if (shadowInputSha(found) !== member.inputSha256) {
      problems.push({ id: member.id, reason: `input of ${member.caseKey} differs from the frozen sha256` });
      continue;
    }
    cases.push({ member, case: { ...found, status: "ok", expected: { ...member.expected } } });
  }
  const latest = manifest.versions[manifest.versions.length - 1];
  return { version: latest?.version ?? 0, manifestSha256: membersSha256(manifest.members), manifest, cases, regression, problems, notLoaded };
}

export interface Rate { rate: number | null }
export interface MemberResult {
  id: string;
  kind: GoldenMember["kind"];
  expected: number;
  found: number;
  /** Expected fees the variant did not publish. */
  missed: FeeRef[];
  /** Publications known to be wrong: a forbidden fee, an unexpected fee on a complete inventory, a regression let through. */
  wrong: number;
  correct: number;
}

export interface GoldenSetMeasure {
  version: number;
  manifestSha256: string;
  variant: string;
  members: { total: number; measured: number; notLoaded: number; problems: number };
  /** Fees on the source the pipeline publishes / fees on the source. */
  recall: { expected: number; found: number } & Rate;
  /** Right publications / publications whose rightness is known. */
  precision: { judged: number; correct: number; wrong: number } & Rate;
  /** Known-wrong fees and confirmed takedowns kept out / all of them. */
  knownWrongRefused: { cases: number; refused: number } & Rate;
  byKind: Record<GoldenMember["kind"], { members: number; expected: number; found: number; correct: number; wrong: number }>;
  perMember: MemberResult[];
  problems: GoldenSet["problems"];
}

const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

/**
 * Recall and precision of one pipeline variant on the golden set. Deterministic: the same set and
 * variant give the same numbers. Step 4's switch replay gate calls it twice (switch off, switch on)
 * and passes both to `compareGoldenSet`.
 */
export function measureGoldenSet(set: GoldenSet, variant: PipelineVariant = currentVariant): GoldenSetMeasure {
  const traces = new Map(runAll(variant, set.cases.map((entry) => entry.case)).map((trace) => [trace.caseKey, trace]));
  const perMember: MemberResult[] = [];
  const byKind: GoldenSetMeasure["byKind"] = {
    shadow_case: { members: 0, expected: 0, found: 0, correct: 0, wrong: 0 },
    regression_case: { members: 0, expected: 0, found: 0, correct: 0, wrong: 0 },
    answer_key_bank: { members: 0, expected: 0, found: 0, correct: 0, wrong: 0 },
  };
  let forbidden = 0;
  let refused = 0;
  for (const { member, case: c } of set.cases) {
    const trace = traces.get(c.caseKey);
    const published = trace?.published ?? [];
    const found = c.expected.publish.filter((ref) => published.some((fee) => matches(ref, fee)));
    const missed = c.expected.publish.filter((ref) => !published.some((fee) => matches(ref, fee)));
    let correct = 0;
    let wrong = 0;
    for (const fee of published) {
      if (c.expected.forbid.some((ref) => matches(ref, fee))) wrong += 1;
      else if (c.expected.publish.some((ref) => matches(ref, fee))) correct += 1;
      else if (member.completeInventory) wrong += 1;
    }
    for (const ref of c.expected.forbid) {
      forbidden += 1;
      if (!published.some((fee) => matches(ref, fee))) refused += 1;
    }
    perMember.push({ id: member.id, kind: member.kind, expected: c.expected.publish.length, found: found.length, missed, wrong, correct });
  }
  for (const member of set.regression) {
    const replay = replayCase(member.input, member.checkName);
    const caught = replay?.caught === true;
    forbidden += 1;
    if (caught) refused += 1;
    perMember.push({ id: member.id, kind: member.kind, expected: 0, found: 0, missed: [], wrong: caught ? 0 : 1, correct: 0 });
  }
  for (const result of perMember) {
    const kind = byKind[result.kind];
    kind.members += 1;
    kind.expected += result.expected;
    kind.found += result.found;
    kind.correct += result.correct;
    kind.wrong += result.wrong;
  }
  const expected = perMember.reduce((sum, r) => sum + r.expected, 0);
  const foundTotal = perMember.reduce((sum, r) => sum + r.found, 0);
  const correctTotal = perMember.reduce((sum, r) => sum + r.correct, 0);
  const wrongTotal = perMember.reduce((sum, r) => sum + r.wrong, 0);
  return {
    version: set.version,
    manifestSha256: set.manifestSha256,
    variant: variant.id,
    members: { total: set.manifest.members.length, measured: perMember.length, notLoaded: set.notLoaded.length, problems: set.problems.length },
    recall: { expected, found: foundTotal, rate: ratio(foundTotal, expected) },
    precision: { judged: correctTotal + wrongTotal, correct: correctTotal, wrong: wrongTotal, rate: ratio(correctTotal, correctTotal + wrongTotal) },
    knownWrongRefused: { cases: forbidden, refused, rate: ratio(refused, forbidden) },
    byKind,
    perMember,
    problems: set.problems,
  };
}

export interface GoldenSetComparison {
  comparable: boolean;
  reason: string | null;
  recall: { before: number | null; after: number | null; delta: number | null };
  precision: { before: number | null; after: number | null; delta: number | null };
  knownWrongRefused: { before: number | null; after: number | null; delta: number | null };
  /** Expected fees the before variant published and the after variant does not. */
  lost: Array<{ id: string; fee: FeeRef }>;
  gained: Array<{ id: string; fee: FeeRef }>;
  /** Members with more known-wrong publications after than before. */
  moreWrong: Array<{ id: string; before: number; after: number }>;
}

const key = (ref: FeeRef) => JSON.stringify([ref.canonicalFeeKey, ref.amountCents, ref.frequency ?? null, ref.feeName]);
const delta = (a: number | null, b: number | null) => (a == null || b == null ? null : b - a);

/** Before/after on the same frozen set. Different versions or member sets are not comparable. */
export function compareGoldenSet(before: GoldenSetMeasure, after: GoldenSetMeasure): GoldenSetComparison {
  const sameSet = before.manifestSha256 === after.manifestSha256
    && before.members.measured === after.members.measured && before.members.notLoaded === after.members.notLoaded;
  const beforeById = new Map(before.perMember.map((r) => [r.id, r]));
  const lost: GoldenSetComparison["lost"] = [];
  const gained: GoldenSetComparison["gained"] = [];
  const moreWrong: GoldenSetComparison["moreWrong"] = [];
  for (const result of after.perMember) {
    const prior = beforeById.get(result.id);
    if (!prior) continue;
    const missedBefore = new Set(prior.missed.map(key));
    const missedAfter = new Set(result.missed.map(key));
    for (const fee of result.missed) if (!missedBefore.has(key(fee))) lost.push({ id: result.id, fee });
    for (const fee of prior.missed) if (!missedAfter.has(key(fee))) gained.push({ id: result.id, fee });
    if (result.wrong > prior.wrong) moreWrong.push({ id: result.id, before: prior.wrong, after: result.wrong });
  }
  return {
    comparable: sameSet,
    reason: sameSet ? null : "different golden-set members or loaded banks",
    recall: { before: before.recall.rate, after: after.recall.rate, delta: delta(before.recall.rate, after.recall.rate) },
    precision: { before: before.precision.rate, after: after.precision.rate, delta: delta(before.precision.rate, after.precision.rate) },
    knownWrongRefused: { before: before.knownWrongRefused.rate, after: after.knownWrongRefused.rate,
      delta: delta(before.knownWrongRefused.rate, after.knownWrongRefused.rate) },
    lost, gained, moreWrong,
  };
}

/** Shadow-lab cases with a document text; URL-only document-gate cases carry no fees to score. */
function shadowMember(c: ShadowCase, since: number): ShadowMember {
  return {
    id: `shadow:${c.caseKey}`, kind: "shadow_case", since, scenario: c.scenario, fixture: c.provenance.fixture,
    caseKey: c.caseKey, inputSha256: shadowInputSha(c), completeInventory: c.scenario === "missed_fees",
    expected: { ...c.expected, publish: c.expected.publish.map(frozenRef), forbid: c.expected.forbid.map(frozenRef) },
  };
}

/** What matching reads; the schedule line stays in the fixture the text hash names. */
function frozenRef(ref: FeeRef): FeeRef {
  return { canonicalFeeKey: ref.canonicalFeeKey, feeName: ref.feeName, amountCents: ref.amountCents,
    ...(ref.frequency != null ? { frequency: ref.frequency } : {}) };
}

/** One member per line, so an append is a pure addition in review. */
export function serializeGoldenManifest(manifest: GoldenSetManifest): string {
  const members = manifest.members.map((member) => `  ${JSON.stringify(member)}`).join(",\n");
  return `{\n "about": ${JSON.stringify(manifest.about)},\n "versions": ${JSON.stringify(manifest.versions)},\n "members": [\n${members}\n ]\n}\n`;
}

export interface RegressionFixtureCase { case_key: string; check_name?: string; expected_verdict: string; input: CaseInput }

function regressionMember(item: RegressionFixtureCase, since: number): RegressionMember {
  return {
    id: `regression:${item.case_key}`, kind: "regression_case", since,
    checkName: item.check_name ?? item.case_key.split(":").slice(2).join(":"), expectedVerdict: item.expected_verdict,
    input: JSON.parse(JSON.stringify(item.input)) as CaseInput,
  };
}

export interface BankSource {
  key: ReferenceKeySnapshot;
  receipt: { eventId: number; checkedAt: string; keyFingerprint: string; status: string };
}

/** An answer-key bank as it joins: its identity, receipt and expected fees (category and cents). */
export interface BankEntry {
  answerKeyId: number;
  institutionId: number;
  documentUrl: string;
  contentHash: string;
  keyFingerprint: string;
  receiptEventId: number;
  receiptCheckedAt: string;
  fees: Array<[canonicalFeeKey: string, amountCents: number | null]>;
}

/**
 * An answer-key bank joins only on an eligible receipt whose fingerprint is this exact key.
 * Expected fees are its confirmed mapped lines, one per category and price.
 */
export function bankEntry(source: BankSource): BankEntry {
  const { key, receipt } = source;
  if (receipt.status !== "eligible") throw new Error(`answer key ${key.answerKeyId}: receipt is ${receipt.status}, not eligible`);
  if (referenceKeyFingerprint(key) !== receipt.keyFingerprint) throw new Error(`answer key ${key.answerKeyId}: key changed since its receipt`);
  if (!key.contentHash) throw new Error(`answer key ${key.answerKeyId}: no document hash`);
  const fees = new Map<string, [string, number | null]>();
  for (const fee of key.fees) {
    if (fee.status !== "confirmed" || fee.canonicalKey === "unmapped") continue;
    const cents = toCents(fee.amount);
    fees.set(`${fee.canonicalKey}:${cents ?? "varies"}`, [fee.canonicalKey, cents]);
  }
  return {
    answerKeyId: key.answerKeyId, institutionId: key.institutionId, documentUrl: key.documentUrl,
    contentHash: key.contentHash.toLowerCase(), keyFingerprint: receipt.keyFingerprint,
    receiptEventId: receipt.eventId, receiptCheckedAt: receipt.checkedAt,
    fees: [...fees.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, fee]) => fee),
  };
}

function bankMember(entry: BankEntry, since: number): AnswerKeyBankMember {
  const { fees, ...identity } = entry;
  return {
    id: `answer_key:${entry.answerKeyId}`, kind: "answer_key_bank", since, ...identity, completeInventory: true,
    expected: { publish: fees.map(([canonicalFeeKey, amountCents]) => ({ canonicalFeeKey, feeName: null, amountCents })), forbid: [] },
  };
}

/**
 * The next version: today's members unchanged, then every shadow case, regression case and bank
 * not yet in the set. Nothing already in the set is rewritten or dropped.
 */
export function appendGoldenSet(manifest: GoldenSetManifest, input: {
  frozenAt: string; scenarios: ShadowCase[]; regression: RegressionFixtureCase[]; banks: BankEntry[];
}): GoldenSetManifest {
  const version = (manifest.versions[manifest.versions.length - 1]?.version ?? 0) + 1;
  const have = new Set(manifest.members.map((member) => member.id));
  const added: GoldenMember[] = [];
  const add = (member: GoldenMember) => {
    if (have.has(member.id)) return;
    have.add(member.id);
    added.push(member);
  };
  for (const c of [...input.scenarios].sort((a, b) => (a.caseKey < b.caseKey ? -1 : 1))) {
    if (c.status === "ok" && c.document.text != null) add(shadowMember(c, version));
  }
  for (const item of [...input.regression].sort((a, b) => (a.case_key < b.case_key ? -1 : 1))) add(regressionMember(item, version));
  for (const bank of [...input.banks].sort((a, b) => a.answerKeyId - b.answerKeyId)) add(bankMember(bank, version));
  if (added.length === 0) return manifest;
  const members = [...manifest.members, ...added];
  return { ...manifest, members, versions: [...manifest.versions, { version, frozenAt: input.frozenAt, members: members.length, sha256: membersSha256(members) }] };
}

/** Every recorded version must still hash to the same member prefix, and the last covers all. */
export function appendOnlyViolations(manifest: GoldenSetManifest, pinned: readonly GoldenSetVersion[] = GOLDEN_SET_VERSIONS): string[] {
  const problems: string[] = [];
  if (JSON.stringify(manifest.versions) !== JSON.stringify(pinned)) problems.push("manifest versions differ from GOLDEN_SET_VERSIONS");
  let previous = 0;
  for (const version of manifest.versions) {
    if (version.members < previous) problems.push(`version ${version.version} has fewer members than the one before`);
    previous = version.members;
    if (membersSha256(manifest.members.slice(0, version.members)) !== version.sha256) {
      problems.push(`version ${version.version}: its ${version.members} members were edited, reordered or removed`);
    }
  }
  if (previous !== manifest.members.length) problems.push("members were added without a version");
  const ids = manifest.members.map((member) => member.id);
  if (new Set(ids).size !== ids.length) problems.push("duplicate member ids");
  return problems;
}
