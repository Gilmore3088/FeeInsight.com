/**
 * A saved Ask answer as a report finding (#1077 claim contract step 6, #1899): read through its
 * saved claims, never as joined prose. Pure: no reads.
 *
 * - The finding's `detail` is the answer's supported sentences (view, then what it means), exactly
 *   as before step 6: claims saved with an answer describe the same binding it was saved with.
 * - Hamilton's reading (sentences not tied to a record) is never part of `detail`. It is carried as
 *   `reading`, and printed under `INTERPRETATION_LABEL` only when the switch
 *   `HAMILTON_REPORT_FINDING_READING` is on (off by default), since printing it changes what a
 *   report shows.
 * - A left-out sentence is never carried: with saved claims and a saved binding both present, a
 *   sentence either one leaves out (or reads as Hamilton's reading) is never a finding.
 */

import { applyNarrativeBinding, savedAnswerBinding } from "./written-answer-binding";
import { bindingFromClaims, readSavedClaims, savedClaimsFrom, type SavedClaimSet } from "./saved-claims";
import type { NarrativeBinding } from "./narrative-bound";
import type { AnalyzeResponse } from "./types";

/**
 * The switch for printing a saved answer's reading under its label in a report's added findings.
 * Off unless HAMILTON_REPORT_FINDING_READING is exactly "true", "1" or "on".
 */
export function reportFindingReadingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = (env.HAMILTON_REPORT_FINDING_READING || "").trim().toLowerCase();
  return value === "true" || value === "1" || value === "on";
}

/**
 * The saved claims' binding, made at least as strict as the saved binding: a sentence either one
 * leaves out stays out, and one either reads as Hamilton's reading is never a finding. So an empty
 * or stale claims record can never print a sentence the binding left out (PR #2583 review).
 */
function strictest(fromClaims: NarrativeBinding, binding: NarrativeBinding | null): NarrativeBinding {
  if (!binding) return fromClaims;
  const key = (text: string) => text.trim();
  const omitted = [...fromClaims.omitted];
  const omittedKeys = new Set(omitted.map((o) => key(o.text)));
  for (const o of binding.omitted) if (!omittedKeys.has(key(o.text))) { omitted.push(o); omittedKeys.add(key(o.text)); }
  const interpretation = [...new Set([...fromClaims.interpretation, ...binding.interpretation].map(key))].filter((t) => !omittedKeys.has(t));
  const notFinding = new Set([...omittedKeys, ...interpretation]);
  return { ...fromClaims, supported: fromClaims.supported.filter((s) => !notFinding.has(key(s.text))), interpretation, omitted };
}

export interface SavedAnswerFinding {
  /** Supported sentences only; empty when none is left. */
  detail: string;
  /** The view's and what-it-means' sentences that are Hamilton's reading, in order, once each. */
  reading: string[];
  /** The saved claims, or the saved binding read as claims; null for an answer saved before the binding. */
  claims: SavedClaimSet | null;
}

/**
 * The finding a saved answer gives a report. Its saved claims decide; an answer saved before them
 * is read through its binding the same way; one saved before the binding keeps its text as saved.
 */
export function savedAnswerFinding(answer: AnalyzeResponse): SavedAnswerFinding {
  const binding = savedAnswerBinding(answer);
  const saved = readSavedClaims(answer.claims);
  const claims = saved ?? savedClaimsFrom(binding);
  const sections = { hamiltonView: answer.hamiltonView ?? "", whatThisMeans: answer.whatThisMeans ?? "", whyItMatters: [] };
  const bound = applyNarrativeBinding(sections, claims ? strictest(bindingFromClaims(claims), saved ? binding : null) : null);
  const source = `${sections.hamiltonView}\n${sections.whatThisMeans}`;
  return {
    detail: [bound.sections.hamiltonView, bound.sections.whatThisMeans].map((part) => part.trim()).filter(Boolean).join(" "),
    reading: bound.reading.filter((sentence) => source.includes(sentence)),
    claims,
  };
}
