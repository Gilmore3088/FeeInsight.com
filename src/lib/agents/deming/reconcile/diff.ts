import type { CompactFee, Conflict, DecisionRule, DiffEntry, Evidence, PipelineStep, ShadowDrop, SideFee, Winner } from "./types";

/**
 * Pure: the per-fee diff of one bank's live fees against its shadow read, the reconciliation rule that
 * says which version wins, and the pipeline step each difference is charged to.
 */

const feeKey = (fee: Pick<SideFee, "canonicalFeeKey" | "amountCents">) => `${fee.canonicalFeeKey}|${fee.amountCents}`;

const STOP = new Set(["fee", "fees", "charge", "the", "a", "an", "of", "per", "each", "for", "and", "or", "to", "on", "in", "item"]);
function tokens(text: string | null | undefined): Set<string> {
  return new Set((text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((word) => word.length > 1 && !STOP.has(word)));
}

/** Same fee by its words: equal lines, or names sharing at least half their words. */
export function sameFeeWords(a: SideFee, b: SideFee): boolean {
  const lineA = (a.line ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const lineB = (b.line ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (lineA && lineA === lineB) return true;
  const ta = tokens(a.feeName);
  const tb = tokens(b.feeName);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const word of ta) if (tb.has(word)) shared += 1;
  return shared / Math.min(ta.size, tb.size) >= 0.5;
}

/**
 * Live against shadow for one bank. A live fee whose (category, cents) the shadow also holds is `same`
 * (or `audience_changed` when both audiences are known and differ, or one side is unknown and the
 * other is not). The rest pair up by their words: the same category at another amount is
 * `amount_changed`, the same amount under another category `category_changed`. What is left is
 * `missing_in_shadow` (live only) or `new_in_shadow` (shadow only).
 */
export function diffBank(live: readonly SideFee[], shadow: readonly SideFee[]): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const shadowByKey = new Map<string, SideFee[]>();
  for (const fee of shadow) shadowByKey.set(feeKey(fee), [...(shadowByKey.get(feeKey(fee)) ?? []), fee]);
  const matchedShadowKeys = new Set<string>();
  const liveLeft: SideFee[] = [];
  for (const fee of live) {
    const same = shadowByKey.get(feeKey(fee));
    if (!same) { liveLeft.push(fee); continue; }
    matchedShadowKeys.add(feeKey(fee));
    const twin = same.find((s) => sameFeeWords(fee, s)) ?? same[0];
    entries.push({ kind: fee.audience !== twin.audience ? "audience_changed" : "same", live: fee, shadow: twin });
  }
  const shadowLeft = shadow.filter((fee) => !matchedShadowKeys.has(feeKey(fee)));
  const used = new Set<SideFee>();
  for (const fee of liveLeft) {
    const pair = (match: (s: SideFee) => boolean) => shadowLeft.find((s) => !used.has(s) && match(s) && sameFeeWords(fee, s));
    const amount = pair((s) => s.canonicalFeeKey === fee.canonicalFeeKey);
    const category = amount ? null : pair((s) => s.amountCents === fee.amountCents);
    const twin = amount ?? category;
    if (twin) {
      used.add(twin);
      entries.push({ kind: amount ? "amount_changed" : "category_changed", live: fee, shadow: twin });
    } else {
      entries.push({ kind: "missing_in_shadow", live: fee, shadow: null });
    }
  }
  for (const fee of shadowLeft) if (!used.has(fee)) entries.push({ kind: "new_in_shadow", live: null, shadow: fee });
  return entries;
}

/**
 * The reconciliation rule, checked against the bank's own documents, in order:
 *  1. answer key: where the bank has a confirmed key, the version that matches it wins;
 *  2. source check: the version the shared check (`checkFeeAgainstSource`) finds on one of the bank's
 *     current documents wins over one it does not;
 *  3. category guard: of two versions both on the page, the one the publish category guard accepts;
 *  4. audience evidence (audience only): a known audience beats unknown;
 *  5. otherwise a tie, sent to review: never decided by which side is newer.
 * A side that is absent (`null`) can only win by the other side failing: a live fee missing from the
 * shadow wins "live" when it passes, and "neither" when it fails (it should come down).
 */
export function decide(kind: DiffEntry["kind"], live: Evidence | null, shadow: Evidence | null): { winner: Winner; rule: DecisionRule } {
  const pick = (l: boolean, s: boolean, rule: DecisionRule): { winner: Winner; rule: DecisionRule } | null => {
    if (live && shadow) {
      if (l && !s) return { winner: "live", rule };
      if (s && !l) return { winner: "shadow", rule };
      if (!l && !s && rule !== "category_guard") return { winner: "neither", rule };
      return null;
    }
    const ok = live ? l : s;
    return { winner: ok ? (live ? "live" : "shadow") : "neither", rule };
  };
  const keyed = (live?.answerKey ?? shadow?.answerKey) != null;
  if (keyed) {
    const decided = pick(live?.answerKey === true, shadow?.answerKey === true, "answer_key");
    if (decided) return decided;
    if (live && shadow && live.answerKey && shadow.answerKey) return { winner: "both", rule: "answer_key" };
  }
  const bySource = pick(Boolean(live?.currentDocument), Boolean(shadow?.currentDocument), "source_check");
  if (bySource) return bySource;
  if (live && shadow) {
    const byGuard = pick(live.categoryOk, shadow.categoryOk, "category_guard");
    if (byGuard) return byGuard;
    if (kind === "audience_changed") return { winner: "both", rule: "audience_evidence" };
  }
  return { winner: "review", rule: "tie" };
}

/** Normalised line equality, as the shadow lab's attribution reads a line. */
function lineIn(line: string | null | undefined, text: string | null | undefined): boolean {
  if (!line || !text) return false;
  const squash = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  return squash(text).includes(squash(line).slice(0, 80));
}

export interface CauseInput {
  entry: DiffEntry;
  winner: Winner;
  /** The shadow's drops on the bank's current documents. */
  drops: readonly ShadowDrop[];
  /** The bank's current document texts. */
  currentTexts: readonly string[];
  /** The live fee's own document has a stored text. */
  liveHasText: boolean;
}

/**
 * The pipeline step a difference is charged to, so a whole step is fixed rather than one fee. The
 * step is the one whose output is wrong on the losing side:
 *  - a live fee that loses because its copy is superseded, or its line is on no current document,
 *    is Magellan's (the document behind it is stale); one with no stored text is Rosetta's;
 *  - a live fee the shadow dropped and that wins is charged to the stage that dropped it (Knox
 *    held it, Darwin refused it, Hamilton gated it), or to Knox when today's rules never read it;
 *  - a fee only the shadow finds that wins was missed by an older read: Knox's rules fix never
 *    reached that text (the re-read backlog);
 *  - an amount or category that differs is Knox's read; an audience is Darwin's.
 */
export function chargeCause({ entry, winner, drops, currentTexts, liveHasText }: CauseInput): { step: PipelineStep; cause: string } {
  const live = entry.live;
  const shadow = entry.shadow;
  const liveOnCurrent = live ? currentTexts.some((text) => lineIn(live.line, text)) : false;
  const liveLost = live != null && (winner === "shadow" || winner === "neither");
  if (live && liveLost) {
    if (!liveHasText) return { step: "rosetta", cause: "live_document_has_no_text" };
    if (live.onSupersededCopy && !liveOnCurrent) return { step: "magellan", cause: "live_on_stale_copy" };
  }
  switch (entry.kind) {
    case "missing_in_shadow": {
      if (liveLost) return { step: "knox", cause: "old_read_wrong" };
      const drop = drops.find((d) => d.canonicalFeeKey === live?.canonicalFeeKey && d.amountCents === live?.amountCents)
        ?? drops.find((d) => d.amountCents === live?.amountCents && lineIn(d.line, live?.line));
      if (drop) {
        const step: PipelineStep = drop.stage === "extract" ? "knox" : drop.stage === "verify" ? "darwin" : "hamilton";
        return { step, cause: `shadow_dropped:${drop.reason.split(":").slice(0, 2).join(":")}` };
      }
      if (!liveOnCurrent) return { step: "magellan", cause: "live_line_not_on_current_document" };
      return { step: "knox", cause: "today_rules_miss_live_line" };
    }
    case "new_in_shadow":
      return winner === "shadow" || winner === "both"
        ? { step: "knox", cause: "old_read_missed" }
        : { step: "knox", cause: "today_rules_misread" };
    case "amount_changed":
      return { step: "knox", cause: winner === "shadow" ? "old_read_wrong_amount" : winner === "live" ? "today_rules_wrong_amount" : "amount_unresolved" };
    case "category_changed":
      return { step: "knox", cause: winner === "shadow" ? "old_read_wrong_category" : winner === "live" ? "today_rules_wrong_category" : "category_unresolved" };
    case "audience_changed":
      return { step: "darwin", cause: shadow?.audience === "unknown" ? "today_audience_unknown" : live?.audience === "unknown" ? "live_audience_unknown" : "audience_disagrees" };
    case "same":
      return { step: "knox", cause: "same" };
  }
}

export function compact(fee: SideFee | null): CompactFee | null {
  if (!fee) return null;
  return {
    k: fee.canonicalFeeKey,
    c: fee.amountCents,
    n: fee.feeName.slice(0, 80),
    a: fee.audience,
    d: fee.sourceDocumentId,
    ...(fee.feePublishedId != null ? { id: fee.feePublishedId } : {}),
    ...(fee.line ? { l: fee.line.slice(0, 160) } : {}),
  };
}

export function toConflict(entry: DiffEntry, decided: { winner: Winner; rule: DecisionRule }, cause: { step: PipelineStep; cause: string }): Conflict {
  if (entry.kind === "same") throw new Error("a same fee is no conflict");
  return { kind: entry.kind, winner: decided.winner, rule: decided.rule, step: cause.step, cause: cause.cause, live: compact(entry.live), shadow: compact(entry.shadow) };
}
