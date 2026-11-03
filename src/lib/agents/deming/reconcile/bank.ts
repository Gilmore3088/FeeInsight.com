import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { publishedFeeName } from "@/lib/agents/hamilton/publish";
import { darwinAudience } from "@/lib/agents/darwin/audience";
import { predictionMatches } from "@/lib/agents/answer-key-score";
import type { ExpectedFee } from "./grade";
import { runCase } from "@/lib/agents/deming/shadow-lab/run-case";
import { currentVariant } from "@/lib/agents/deming/shadow-lab/variants";
import type { PipelineVariant, ShadowCase } from "@/lib/agents/deming/shadow-lab/types";
import { chargeCause, decide, diffBank, toConflict } from "./diff";
import type { BankReconciliation, DiffKind, Evidence, ShadowDrop, SideFee, Winner } from "./types";

/** One of the bank's current documents: the newest stored text of a page no newer copy supersedes. */
export interface CurrentText {
  sourceDocumentId: number;
  url: string | null;
  text: string;
}

/** A live fee with the stored text of the document it was read from (null when none is stored). */
export interface LiveInput extends SideFee {
  ownText: string | null;
}

export interface ShadowRead {
  fees: SideFee[];
  drops: ShadowDrop[];
  texts: number;
  textsSkipped: number;
}

/**
 * Today's pipeline on the bank's current documents, in memory: each text through the shadow lab's
 * `currentVariant` (Knox's free read, Darwin's verify checks, Hamilton's publish gate; DB-bound parts
 * such as Knox's learned lessons and Darwin's peer check are not replayed). Audience is Darwin's
 * prospective decision (`darwinAudience`) on the shadow's traced line. Writes nothing.
 */
export function readShadow(texts: readonly CurrentText[], variant: PipelineVariant = currentVariant): ShadowRead {
  const fees: SideFee[] = [];
  const drops: ShadowDrop[] = [];
  let skipped = 0;
  for (const doc of texts) {
    const c: ShadowCase = {
      caseKey: `doc-${doc.sourceDocumentId}`,
      scenario: "live_audit",
      provenance: { fixture: "reconcile", fixtureCaseKey: String(doc.sourceDocumentId), textHash: null, issue: "reconcile" },
      document: { url: doc.url, text: doc.text },
      expected: { publish: [], forbid: [] },
      status: "ok",
    };
    const trace = runCase(variant, c);
    if (trace.documentAccepted === false) { skipped += 1; continue; }
    for (const stage of ["extract", "verify", "publish_gate"] as const) {
      for (const fee of trace.stages[stage].dropped) {
        drops.push({ stage, reason: fee.reason ?? "dropped", canonicalFeeKey: fee.canonicalFeeKey, amountCents: fee.amountCents, feeName: fee.feeName, line: fee.excerpt });
      }
    }
    for (const fee of trace.published) {
      if (!fee.canonicalFeeKey || fee.amountCents == null) continue;
      const line = fee.sourceLine ?? fee.excerpt;
      const audience = darwinAudience({ fee_audience: null, source_url: doc.url, fee_name: fee.feeName ?? "" }, fee.amountCents / 100, doc.text, { ownPriceClause: true });
      fees.push({
        canonicalFeeKey: fee.canonicalFeeKey,
        feeName: fee.feeName ?? "",
        amountCents: fee.amountCents,
        audience: audience?.feeAudience ?? "unknown",
        line,
        sourceDocumentId: doc.sourceDocumentId,
      });
    }
  }
  return { fees, drops, texts: texts.length - skipped, textsSkipped: skipped };
}

const onAny = (texts: readonly CurrentText[], fee: SideFee) =>
  texts.some((doc) => checkFeeAgainstSource(doc.text, fee.feeName, fee.amountCents / 100, ".", fee.canonicalFeeKey).ok);

const categoryOk = (fee: SideFee) =>
  checkFeeCategory(fee.canonicalFeeKey, publishedFeeName(fee.feeName, fee.canonicalFeeKey), { amount: fee.amountCents / 100 }).ok;

const keyMatch = (keys: readonly ExpectedFee[] | null, fee: SideFee): boolean | null =>
  keys == null ? null : keys.some((key) => predictionMatches(key, { canonicalKey: fee.canonicalFeeKey, amount: fee.amountCents / 100 }));

function distinctSet(fees: readonly SideFee[]): Array<[string, number]> {
  const seen = new Map<string, [string, number]>();
  for (const fee of fees) seen.set(`${fee.canonicalFeeKey}|${fee.amountCents}`, [fee.canonicalFeeKey, fee.amountCents]);
  return [...seen.values()];
}

const zero = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
const DIFF_KINDS: readonly DiffKind[] = ["same", "amount_changed", "category_changed", "audience_changed", "new_in_shadow", "missing_in_shadow"];
const WINNERS: readonly Winner[] = ["live", "shadow", "both", "neither", "review"];

/**
 * Pure: one bank's reconciliation. `keys` is the bank's confirmed answer key (null when it has none).
 * Every live fee and every shadow fee lands in exactly one diff entry; each entry that is not `same`
 * is decided by `decide` and charged to a step by `chargeCause`.
 */
export function reconcileBank(input: {
  institutionId: number;
  live: readonly LiveInput[];
  current: readonly CurrentText[];
  shadow: ShadowRead;
  keys: readonly ExpectedFee[] | null;
  ms?: number;
}): BankReconciliation {
  const { live, current, shadow, keys } = input;
  const ownText = new Map<SideFee, string | null>(live.map((fee) => [fee, fee.ownText]));
  const currentTexts = current.map((doc) => doc.text);
  const liveEvidence = (fee: SideFee): Evidence => ({
    currentDocument: onAny(current, fee),
    ownDocument: checkFeeAgainstSource(ownText.get(fee) ?? null, fee.feeName, fee.amountCents / 100, ".", fee.canonicalFeeKey).ok,
    answerKey: keyMatch(keys, fee),
    categoryOk: categoryOk(fee),
  });
  const shadowEvidence = (fee: SideFee): Evidence => ({ currentDocument: onAny(current, fee), answerKey: keyMatch(keys, fee), categoryOk: categoryOk(fee) });

  const result: BankReconciliation = {
    institutionId: input.institutionId,
    texts: shadow.texts,
    textsSkipped: shadow.textsSkipped,
    liveFees: live.length,
    shadowFees: shadow.fees.length,
    counts: zero(DIFF_KINDS),
    winners: zero(WINNERS),
    liveOnSupersededCopy: live.filter((fee) => fee.onSupersededCopy).length,
    liveUnknownAudience: live.filter((fee) => fee.audience === "unknown").length,
    shadowUnknownAudience: shadow.fees.filter((fee) => fee.audience === "unknown").length,
    liveSupportedOwn: 0,
    liveSupportedCurrent: 0,
    shadowSupported: 0,
    liveLost: 0,
    shadowLost: 0,
    conflicts: [],
    liveSet: distinctSet(live),
    shadowSet: distinctSet(shadow.fees),
    ms: input.ms ?? 0,
  };
  const liveSeen = new Map<SideFee, Evidence>();
  const evidenceOf = (fee: SideFee) => {
    const known = liveSeen.get(fee);
    if (known) return known;
    const made = liveEvidence(fee);
    liveSeen.set(fee, made);
    return made;
  };
  for (const entry of diffBank(live, shadow.fees)) {
    result.counts[entry.kind] += 1;
    const le = entry.live ? evidenceOf(entry.live) : null;
    const se = entry.shadow ? shadowEvidence(entry.shadow) : null;
    if (le?.ownDocument) result.liveSupportedOwn += 1;
    if (le?.currentDocument) result.liveSupportedCurrent += 1;
    if (se?.currentDocument) result.shadowSupported += 1;
    if (entry.kind === "same") continue;
    const decided = decide(entry.kind, le, se);
    result.winners[decided.winner] += 1;
    if (entry.live && (decided.winner === "shadow" || decided.winner === "neither")) result.liveLost += 1;
    if (entry.shadow && (decided.winner === "live" || decided.winner === "neither")) result.shadowLost += 1;
    const liveHasText = entry.live ? Boolean((ownText.get(entry.live) ?? "").trim()) : true;
    const cause = chargeCause({ entry, winner: decided.winner, drops: shadow.drops, currentTexts, liveHasText });
    result.conflicts.push(toConflict(entry, decided, cause));
  }
  return result;
}
