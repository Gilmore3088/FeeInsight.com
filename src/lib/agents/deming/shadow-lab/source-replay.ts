import { hashText } from "@/lib/agents/rosetta/read";
import { matches, scoreRun, type Failure } from "./metrics";
import { runAll } from "./run-case";
import type { AcceptedSource, SourceBytesManifest, SourceRead } from "./source-bytes";
import type { PipelineVariant, ShadowCase } from "./types";

/**
 * The source-bytes replay (#1092): each answer-key document whose public bytes reproduce is run
 * twice through the same variant, once on the text frozen when it was keyed and once on today's
 * re-read of its bytes, against the same keys. Misses are charged by `whereMissed` as in the main
 * lab. It measures and never gates, and the ratchet does not read it.
 */

export interface SideScore {
  expected: number;
  found: number;
  /** Known-wrong fees published, of those forbidden (answer-key cases forbid none today). */
  falsePublished: number;
  forbidden: number;
  /** Published fees not in the answer key. */
  unexpected: number;
  /** Missed fees by the stage and reason `whereMissed` charges them to, most first. */
  misses: MissCount[];
}

export interface MissCount {
  stage: string;
  reason: string;
  count: number;
}

export interface SourceReplayDocument {
  caseKey: string;
  institution: string;
  reader: string;
  similarity: AcceptedSource["similarity"];
  textChanged: boolean;
  frozen: SideScore;
  reread: SideScore;
}

export interface SourceReplaySummary {
  holdoutDocuments: number;
  reproduced: number;
  labCases: number;
  rejected: SourceBytesManifest["rejected"];
  notFetched: SourceBytesManifest["notFetched"];
  documents: SourceReplayDocument[];
  total: { frozen: SideScore; reread: SideScore };
  /** Keys the frozen text publishes and the re-read does not, and the other way round. */
  lost: string[];
  gained: string[];
  /** Every key the re-read misses, and every fee it publishes outside the key (`case key:cents "name"`). */
  rereadMissed: string[];
  rereadUnexpected: string[];
}

/** Two re-reads of the same documents (today's readers, then a reader switch held on), key by key. */
export interface ReplayDelta {
  gained: string[];
  lost: string[];
  unexpectedAdded: string[];
  unexpectedRemoved: string[];
}

/** Orders and merges miss counts; the stage and reason stay separate fields throughout. */
function mergeMisses(groups: MissCount[][]): MissCount[] {
  const merged: MissCount[] = [];
  for (const miss of groups.flat()) {
    const found = merged.find((m) => m.stage === miss.stage && m.reason === miss.reason);
    if (found) found.count += miss.count;
    else merged.push({ ...miss });
  }
  return merged.sort((a, b) => b.count - a.count || a.stage.localeCompare(b.stage) || a.reason.localeCompare(b.reason));
}
const feeKey = (failure: Failure) =>
  `${failure.caseKey} ${failure.fee.canonicalFeeKey}:${failure.fee.amountCents ?? "none"}`;

function side(cases: ShadowCase[], variant: PipelineVariant): { score: SideScore; missed: Set<string>; unexpected: string[] } {
  const traces = runAll(variant, cases);
  const metrics = scoreRun(cases, traces, 0);
  const unexpected = traces.flatMap((trace) => {
    const c = cases.find((item) => item.caseKey === trace.caseKey);
    return trace.published
      .filter((fee) => !c?.expected.publish.some((ref) => matches(ref, fee)))
      .map((fee) => `${trace.caseKey} ${fee.canonicalFeeKey}:${fee.amountCents ?? "none"} "${fee.feeName ?? ""}"`);
  });
  const misses = metrics.failures.filter((failure) => failure.kind === "missed");
  return {
    score: {
      expected: metrics.answerKeyRecall.expected,
      found: metrics.answerKeyRecall.found,
      falsePublished: metrics.falsePublication.published,
      forbidden: metrics.falsePublication.forbidden,
      unexpected: metrics.unexpectedPublications,
      misses: mergeMisses([misses.map((failure) => ({ stage: failure.stage, reason: failure.reason ?? "none", count: 1 }))]),
    },
    missed: new Set(misses.map(feeKey)),
    unexpected,
  };
}

function addSides(sides: SideScore[]): SideScore {
  const total: SideScore = { expected: 0, found: 0, falsePublished: 0, forbidden: 0, unexpected: 0, misses: [] };
  for (const s of sides) {
    total.expected += s.expected;
    total.found += s.found;
    total.falsePublished += s.falsePublished;
    total.forbidden += s.forbidden;
    total.unexpected += s.unexpected;
  }
  total.misses = mergeMisses(sides.map((s) => s.misses));
  return total;
}

/** The lab case with its frozen text replaced by today's re-read; keys and expectations unchanged. */
export function rereadCase(c: ShadowCase, text: string): ShadowCase {
  return { ...c, provenance: { ...c.provenance, textHash: hashText(text) }, document: { ...c.document, text } };
}

export function replaySources(input: {
  manifest: SourceBytesManifest;
  cases: ShadowCase[];
  rereads: ReadonlyMap<string, SourceRead>;
  variant: PipelineVariant;
}): SourceReplaySummary {
  const byKey = new Map(input.cases.map((c) => [c.caseKey, c]));
  const documents: SourceReplayDocument[] = [];
  const lost: string[] = [];
  const gained: string[] = [];
  const rereadMissed: string[] = [];
  const rereadUnexpected: string[] = [];
  for (const entry of input.manifest.accepted) {
    const c = byKey.get(entry.caseKey);
    const read = input.rereads.get(entry.caseKey);
    if (!c || c.status !== "ok" || c.document.text == null) throw new Error(`source replay: ${entry.caseKey} is not a replayable lab case`);
    if (!read?.ok) throw new Error(`source replay: ${entry.caseKey} did not re-read (${read ? read.reason : "missing"})`);
    const frozen = side([c], input.variant);
    const reread = side([rereadCase(c, read.text)], input.variant);
    lost.push(...[...reread.missed].filter((key) => !frozen.missed.has(key)));
    gained.push(...[...frozen.missed].filter((key) => !reread.missed.has(key)));
    rereadMissed.push(...reread.missed);
    rereadUnexpected.push(...reread.unexpected);
    documents.push({
      caseKey: entry.caseKey,
      institution: entry.institution,
      reader: read.reader,
      similarity: entry.similarity,
      textChanged: read.text !== c.document.text,
      frozen: frozen.score,
      reread: reread.score,
    });
  }
  return {
    holdoutDocuments: input.manifest.holdoutDocuments,
    reproduced: documents.length,
    labCases: input.cases.filter((c) => c.scenario === "missed_fees" && c.status === "ok").length,
    rejected: input.manifest.rejected,
    notFetched: input.manifest.notFetched,
    documents,
    total: { frozen: addSides(documents.map((d) => d.frozen)), reread: addSides(documents.map((d) => d.reread)) },
    lost: lost.sort(),
    gained: gained.sort(),
    rereadMissed: rereadMissed.sort(),
    rereadUnexpected: rereadUnexpected.sort(),
  };
}

/** What a reader switch moves on the re-read: keys gained and lost, publications outside the key added and removed. */
export function replayDelta(base: SourceReplaySummary, experiment: SourceReplaySummary): ReplayDelta {
  const minus = (a: string[], b: string[]) => {
    const other = new Set(b);
    return a.filter((item) => !other.has(item));
  };
  return {
    gained: minus(base.rereadMissed, experiment.rereadMissed),
    lost: minus(experiment.rereadMissed, base.rereadMissed),
    unexpectedAdded: minus(experiment.rereadUnexpected, base.rereadUnexpected),
    unexpectedRemoved: minus(base.rereadUnexpected, experiment.rereadUnexpected),
  };
}
