/**
 * A saved answer's checked claims, carried with it when it becomes a report finding (#1077, Cycle A
 * trace defect 7; V5 T4 "report fails closed"). Pure: no reads, no model calls.
 *
 * - The finding keeps its supported sentences and the facts they cite (value, unit, dates), bounded,
 *   and their source lines, so the report screen and PDF can point a finding back to its records.
 *   They come only from the server's re-read of the saved answer (`readSavedAnalysisRecord`); a
 *   browser-sent basket item never carries them (`sanitizeBasketItems`).
 * - The answer section that addresses the findings may state a finding's figure only when it
 *   matches that finding's carried facts or the section's own DATA. Any other figure in a finding is
 *   held before the model sees it, and the carried facts join the section's DATA so the figure check
 *   traces a restated finding figure to them, never to a coincidence in pooled data alone.
 */

import { checkNarrativeFigures, extractFigures } from "./figure-check";
import { numericPayloadValue } from "./monetary-units";
import { recordValue, writtenSourceLine } from "./board-brief";
import type { HamiltonIdentitySnapshot } from "./account-context";
import type { ReportBasketItem } from "./report-basket";
import type { SavedClaimFact, SavedClaimSet } from "./saved-claims";

/** The most supported sentences one report finding keeps. */
export const REPORT_FINDING_MAX_CLAIMS = 12;
/** The most facts one report finding keeps (a saved answer keeps up to 40). */
export const REPORT_FINDING_MAX_FACTS = 12;

/** What stands in a finding's text for a figure no carried fact or section data supports. */
export const HELD_FINDING_FIGURE = "[figure held: not traced to a record]";

export interface ReportFindingClaims {
  /** The finding's supported sentences, each with the facts it rests on. */
  supported: Array<{ text: string; factIds: string[] }>;
  /** The cited facts, at most `REPORT_FINDING_MAX_FACTS`. */
  facts: SavedClaimFact[];
  /** True when a cited fact is not among `facts` (bounded here, or not saved with the answer). */
  factsTruncated: boolean;
}

/** One source line under a report finding, worded on the server like the written answer's. */
export interface ReportFindingSource {
  id: string;
  label: string;
  value: string;
  note: string;
}

/**
 * The supported claims a finding's detail states, with the facts they cite. Null with no claims or
 * no supported sentence in the detail: a sentence the detail does not hold is never carried.
 */
export function reportFindingClaims(set: SavedClaimSet | null | undefined, detail: string): ReportFindingClaims | null {
  if (!set) return null;
  const supported = set.claims
    .filter((c) => c.outcome === "supported" && c.text.trim() && detail.includes(c.text.trim()))
    .slice(0, REPORT_FINDING_MAX_CLAIMS)
    .map((c) => ({ text: c.text.trim(), factIds: [...c.factIds] }));
  if (!supported.length) return null;
  const byId = new Map(set.facts.map((fact) => [fact.id, fact]));
  const cited = [...new Set(supported.flatMap((s) => s.factIds))];
  const held = cited.filter((id) => byId.has(id));
  return {
    supported,
    facts: held.slice(0, REPORT_FINDING_MAX_FACTS).map((id) => ({ ...(byId.get(id) as SavedClaimFact) })),
    factsTruncated: held.length > REPORT_FINDING_MAX_FACTS || held.length < cited.length || set.factsTruncated,
  };
}

/** The finding's source lines, one per carried fact; the research institution is named when recorded. */
export function reportFindingSources(claims: ReportFindingClaims | null, identity?: HamiltonIdentitySnapshot | null): ReportFindingSource[] {
  if (!claims) return [];
  const names = new Map<number, string>();
  if (identity?.researchInstitutionId && identity.researchInstitutionName) names.set(identity.researchInstitutionId, identity.researchInstitutionName);
  return claims.facts.map((fact) => {
    const line = writtenSourceLine(fact, names);
    return {
      id: line.id,
      label: `${line.figure} · ${line.institution}`,
      value: recordValue(line.value, line.unit),
      note: [line.detail, line.complete ? null : "Value not in the saved record"].filter(Boolean).join(" · "),
    };
  });
}

/**
 * The carried facts as figure-check DATA: each value with its unit, never combined with another
 * number (no implicit differences), so a figure traces only to a fact as saved.
 */
export function findingFactsData(claims: ReportFindingClaims | null): { numeric_arithmetic_allowed: false; facts: Array<Record<string, unknown>> } | null {
  // A value saved as a numeric string ("35.00") still counts.
  const facts = (claims?.facts ?? []).flatMap((fact) => {
    const value = numericPayloadValue(fact.value);
    return value == null ? [] : [{ fact, value }];
  });
  if (!facts.length) return null;
  return {
    numeric_arithmetic_allowed: false,
    facts: facts.map(({ fact, value }) => ({
      fact_id: fact.id, value, unit: fact.unit,
      fee_category: fact.feeCategory, metric: fact.metric, reporting_date: fact.reportingDate,
    })),
  };
}

/**
 * The text with every figure that neither the finding's carried facts nor the section's DATA
 * supports replaced by `HELD_FINDING_FIGURE`, and the figures held.
 */
export function holdUntracedFindingFigures(text: string, claims: ReportFindingClaims | null, sectionData: unknown): { text: string; held: string[] } {
  if (!text) return { text, held: [] };
  const own = findingFactsData(claims);
  const unmatched = new Set(checkNarrativeFigures(text, own ? [own, sectionData] : [sectionData]).unmatched);
  if (!unmatched.size) return { text, held: [] };
  let out = text;
  const figures = extractFigures(text).filter((f) => unmatched.has(f.raw)).sort((a, b) => b.index - a.index);
  for (const f of figures) out = `${out.slice(0, f.index)}${HELD_FINDING_FIGURE}${out.slice(f.index + f.raw.length)}`;
  return { text: out, held: [...unmatched] };
}

/**
 * The reader's added findings for the answer section: the CONTEXT block that lists them (each
 * untraced figure held) and the DATA the section's figure check traces a restated figure to (their
 * carried facts). The findings' words stay in CONTEXT: they are earlier model prose or text the
 * browser sent, never evidence.
 */
export function readerFindingsSection(findings: readonly ReportBasketItem[], sectionData: unknown): { context: string; data: Array<Record<string, unknown>> | null } {
  if (findings.length === 0) return { context: "", data: null };
  const data: Array<Record<string, unknown>> = [];
  const listed = findings.map((f) => {
    const claims = reportFindingClaims(f.savedClaims, f.detail);
    const title = holdUntracedFindingFigures(f.title, claims, sectionData).text;
    const facts = findingFactsData(claims);
    if (facts) data.push({ finding: title, ...facts });
    return { from: f.source, finding: title, detail: holdUntracedFindingFigures(f.detail, claims, sectionData).text };
  });
  const context = [
    "",
    "",
    "READER FINDINGS (the reader added these from their own analysis; they are not evidence):",
    JSON.stringify(listed, null, 2),
    "Address each one in the summary. State a figure from them only when the same figure is in DATA "
      + "(reader_finding_facts holds the records a saved answer was checked against); otherwise describe the finding without it. "
      + `A figure shown as ${HELD_FINDING_FIGURE} was not traced to a record: never state or estimate it.`,
  ].join("\n");
  return { context, data: data.length ? data : null };
}

type AddedFinding = NonNullable<import("./types").ReportSummaryResponse["addedFindings"]>[number];

/**
 * The report's added findings as saved in `report_json`: title, detail and identity as before, the
 * reading only with its switch on, and, for a saved answer, its carried claims and source lines.
 */
export function reportAddedFindings(findings: readonly ReportBasketItem[], printReading: boolean): AddedFinding[] {
  return findings.map((f) => {
    const claims = f.source === "Ask" ? reportFindingClaims(f.savedClaims, f.detail) : null;
    const sources = reportFindingSources(claims, f.identityContext);
    return {
      source: f.source, title: f.title, detail: f.detail,
      ...(printReading && f.reading?.length ? { reading: [...f.reading] } : {}),
      ...(f.identityContext ? { identityContext: f.identityContext } : {}),
      ...(claims ? { claims } : {}),
      ...(sources.length ? { sources } : {}),
    };
  });
}
