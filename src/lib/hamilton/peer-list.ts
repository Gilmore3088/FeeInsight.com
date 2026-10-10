/** Institution lists, not fee analysis. All amounts in this contract are whole USD. */
import { STATE_NAMES } from "@/lib/us-states";
import type { ActivePeerSet } from "./active-peer-set";

export const PEER_LIST_VERSION = 1;
export const MAX_PEER_LIST_ROWS = 50;
export type PeerCharter = "bank" | "credit_union";
export interface AssetBound { value: number; inclusive: boolean }
export interface PeerListIntent {
  requestedCount: number | null;
  limit: number;
  charterType: PeerCharter | null;
  bothTypes: boolean;
  states: string[];
  sameState: boolean;
  minAssets: AssetBound | null;
  maxAssets: AssetBound | null;
  similarSize: boolean;
  peerBased: boolean;
  largest: boolean;
  saved: boolean;
  accountSubject: boolean;
  problems: string[];
}
export interface AssetEvidence {
  totalAssetsUsd: number | null;
  reportDate: string | null;
  source: "fdic" | "ncua" | null;
  sourceUrl: string | null;
  recordId: number | null;
}
export interface PeerListSubject extends AssetEvidence {
  institutionId: number;
  name: string;
  charterType: PeerCharter | null;
  city: string | null;
  stateCode: string | null;
}
export interface PeerListRow extends PeerListSubject {
  feeCoverage: "available" | "not_found";
  inclusionReason: string;
}
export interface PeerListCriteria {
  basis: "similar_assets" | "explicit_filters" | "saved_peer_set";
  charterType: PeerCharter | null;
  states: string[];
  minAssets: AssetBound | null;
  maxAssets: AssetBound | null;
  institutionIds: number[] | null;
  assetTiers: string[];
  fedDistricts: number[];
  peerSetId: number | null;
  peerSetLabel: string | null;
  sort: "closest_assets" | "largest_assets" | "name";
  referenceAssetsUsd: number | null;
  requiresAssets: boolean;
  limit: number;
  requestedCount: number | null;
  descriptions: string[];
}
export interface PeerListData {
  version: typeof PEER_LIST_VERSION;
  status: "ready" | "needs_criteria" | "unavailable";
  subject: PeerListSubject | null;
  criteria: PeerListCriteria | null;
  rows: PeerListRow[];
  totalMatches: number | null;
  queriedAt: string;
  notes: string[];
}
export interface PeerListResponse {
  kind: "peer_list";
  shortAnswer: string;
  peerList: PeerListData;
}


/** A client-held pointer to an exact displayed list, never an access token.
 * The server re-derives the original selection for the authenticated user
 * and compares dated record IDs before honoring a follow-up.
 */
export interface PeerListContinuation {
  originQuestion: string;
  originInstitutionId: string | null;
  originSubjectId: number;
  originRows: Array<Pick<PeerListRow, "institutionId" | "recordId" | "reportDate" | "source">>;
  selectedIds: number[];
}

export function peerListRowReferences(rows: PeerListRow[]): PeerListContinuation["originRows"] {
  return rows.map(row => ({
    institutionId: row.institutionId,
    recordId: row.recordId,
    reportDate: row.reportDate,
    source: row.source,
  }));
}

export function makePeerListContinuation(
  response: PeerListResponse, question: string, institutionId: string | null,
): PeerListContinuation | null {
  const data = response.peerList;
  if (data.status !== "ready" || !data.subject) return null;
  return {
    originQuestion: question,
    originInstitutionId: institutionId,
    originSubjectId: data.subject.institutionId,
    originRows: peerListRowReferences(data.rows),
    selectedIds: data.rows.map(row => row.institutionId),
  };
}

/** Validate untrusted JSON; a list payload never establishes account membership. */
export function validatePeerListContinuation(value: unknown): PeerListContinuation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const p = value as Partial<PeerListContinuation>;
  const idOK = (id: unknown): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0;
  if (typeof p.originQuestion !== "string" || p.originQuestion.length > 1000 || !isPeerListQuestion(p.originQuestion)) return null;
  if (p.originInstitutionId !== null &&
      (typeof p.originInstitutionId !== "string" || !/^[1-9][0-9]{0,14}$/.test(p.originInstitutionId))) return null;
  if (!idOK(p.originSubjectId) || !Array.isArray(p.originRows) || p.originRows.length > MAX_PEER_LIST_ROWS ||
      !Array.isArray(p.selectedIds) || p.selectedIds.length > MAX_PEER_LIST_ROWS) return null;
  const seen = new Set<number>();
  for (const row of p.originRows) {
    if (!row || !idOK(row.institutionId) || seen.has(row.institutionId)) return null;
    if (row.recordId !== null && !idOK(row.recordId)) return null;
    if (row.reportDate !== null && (typeof row.reportDate !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(row.reportDate))) return null;
    if (row.source !== null && row.source !== "fdic" && row.source !== "ncua") return null;
    seen.add(row.institutionId);
  }
  if (new Set(p.selectedIds).size !== p.selectedIds.length ||
      p.selectedIds.some(id => !idOK(id) || !seen.has(id))) return null;
  return p as PeerListContinuation;
}

export function peerListReferencesUnchanged(rows: PeerListRow[], prior: PeerListContinuation): boolean {
  return JSON.stringify(peerListRowReferences(rows)) === JSON.stringify(prior.originRows);
}

/** Recognized list-relative questions must not fall through to a different fee group. */
export function isPeerListContinuationQuestion(question: string): boolean {
  return /^(?:only\b|show\s+only\b|filter\s+to\b|(?:compare|show|list)\s+their\b)/i.test(question.trim());
}

/** Deliberately finite grammar: other follow-ups receive explicit guidance. */
export function peerListRefinementState(question: string): string | null {
  const cleaned = question.trim().replace(/[?.!]+$/, "").replace(/\s+/g, " ");
  if (!/^only\s+/i.test(cleaned)) return null;
  const term = cleaned
    .replace(/^only\s+(?:show\s+)?(?:me\s+)?(?:the\s+)?/i, "")
    .replace(/\s+(?:ones|peers|institutions)$/i, "").trim();
  const match = Object.entries(STATE_NAMES).find(([code, name]) =>
    code.toLowerCase() === term.toLowerCase() || name.toLowerCase() === term.toLowerCase());
  return match?.[0] ?? null;
}

// Explicit fee/report questions stay on their existing route. A list of institutions
// must not be inferred from a request for a fee median, narrative or recommendation.
export function isPeerListQuestion(question: string): boolean {
  // Preserve the already-supported plain local-competitor view. Its branch-market
  // data is not replaced with an asset-size list or disabled by this addition.
  if (/^(?:please\s+)?(?:list|show(?: me)?|who are|what are|where are)\s+(?:(?:the|my|our)\s+)?(?:local\s+|nearby\s+)?competitors(?:\s+and\s+(?:their\s+(?:branches|locations)|where\s+(?:are\s+)?they(?:\s+are)?))?\s*[?.!]*$/i.test(question.trim())) return false;
  if (/\b(fees?|overdrafts?|nsf|prices?|pricing|revenue|income|median|reports?|recommend\w*|strateg\w*|compar(?:e|ison|ing))\b/i.test(question)) return false;
  const institutions = /\b(peers?|competitors?|banks?|credit unions?|institutions?|CUs?)\b/i.test(question);
  const request = /\b(list|show|find|give|return|identify|name|who|which|what|largest|biggest)\b/i.test(question);
  return institutions && (request || /^\s*(?:(?:my|our|similar|saved|custom)\s+)*(?:peers|competitors)\s*[?.!]*\s*$/i.test(question));
}

const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, twentyfive: 25, thirty: 30, forty: 40, fifty: 50 };
const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, trillion: 1e12 };
const AMOUNT = String.raw`(\$?)(\d+(?:,\d{3})*(?:\.\d+)?)\s*(trillion|billion|million|thousand|bn|mm|[kmbt])?\b`;
const LIST_HELP = "Use an institution type, US state, and/or total-asset range for this list. Some criteria in this question are not supported yet; no broader substitute list was run.";
function dollars(currency: string, raw: string, unit?: string, inheritedUnit?: string): number | null {
  const scale = unit || inheritedUnit;
  if (!currency && !scale) return null;
  const value = Number(raw.replace(/,/g, "")) * (scale ? SCALE[scale.toLowerCase()] : 1);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function replaceMatch(text: string, match: RegExpMatchArray): string {
  return text.slice(0, match.index!) + " " + text.slice(match.index! + match[0].length);
}

/** Conservative parsing: unsupported/negated constraints produce guidance, never silent widening. */
export function parsePeerListQuestion(question: string): PeerListIntent | null {
  if (!isPeerListQuestion(question)) return null;
  const problems: string[] = [];
  let remaining = question.replace(/[’`]/g, "'").replace(/twenty[ -]five/gi, "twentyfive");
  let minAssets: AssetBound | null = null;
  let maxAssets: AssetBound | null = null;
  const range = remaining.match(new RegExp(`(?:between\\s+)?${AMOUNT}\\s*(?:-|–|to|and)\\s*${AMOUNT}`, "i"));
  if (range) {
    const min = dollars(range[1], range[2], range[3], range[6]);
    const max = dollars(range[4], range[5], range[6], range[3]);
    if (min === null || max === null || min > max) problems.push("Provide an ascending total-asset range, with dollars or million/billion units.");
    else { minAssets = { value: min, inclusive: true }; maxAssets = { value: max, inclusive: true }; }
    remaining = replaceMatch(remaining, range);
  } else {
    const lower = remaining.match(new RegExp(`\\b(over|above|more than|greater than|at least)\\s+${AMOUNT}`, "i"));
    const upper = remaining.match(new RegExp(`\\b(under|below|less than|up to|at most)\\s+${AMOUNT}`, "i"));
    const after = remaining.match(new RegExp(`${AMOUNT}\\s*(\\+|and up|or more|and above)`, "i"));
    if (lower) {
      const value = dollars(lower[2], lower[3], lower[4]);
      if (value === null) problems.push("Provide the asset threshold in dollars or million/billion units.");
      else minAssets = { value, inclusive: lower[1].toLowerCase() === "at least" };
      remaining = replaceMatch(remaining, lower);
    }
    // Re-match after replacing a lower bound; indices must refer to the current string.
    const currentUpper = upper ? remaining.match(new RegExp(`\\b(under|below|less than|up to|at most)\\s+${AMOUNT}`, "i")) : null;
    if (currentUpper) {
      const value = dollars(currentUpper[2], currentUpper[3], currentUpper[4]);
      if (value === null) problems.push("Provide the asset threshold in dollars or million/billion units.");
      else maxAssets = { value, inclusive: /^(up to|at most)$/i.test(currentUpper[1]) };
      remaining = replaceMatch(remaining, currentUpper);
    }
    if (!lower && !upper && after) {
      const value = dollars(after[1], after[2], after[3]);
      if (value === null) problems.push("Provide the asset threshold in dollars or million/billion units.");
      else minAssets = { value, inclusive: true };
      remaining = replaceMatch(remaining, after);
    }
  }
  if (minAssets && maxAssets && (minAssets.value > maxAssets.value || (minAssets.value === maxAssets.value && (!minAssets.inclusive || !maxAssets.inclusive)))) problems.push("The asset limits do not overlap.");

  const countPattern = new RegExp(`\\b(\\d+|${Object.keys(COUNT_WORDS).join("|")})\\s+(?:(?:similar(?:ly)?[- ]sized?|similar|comparable|closest|largest|biggest|saved|custom|national)\\s+)*(?:peers?|competitors?|banks?|credit unions?|institutions?|CUs?)\\b`, "i");
  const countMatch = remaining.match(countPattern);
  const requestedCount = /\ball\b/i.test(remaining) ? null : countMatch ? (COUNT_WORDS[countMatch[1].toLowerCase()] ?? Number(countMatch[1])) : 10;
  if (countMatch) remaining = remaining.replace(new RegExp(`\\b${countMatch[1]}\\b`, "i"), " ");
  if (requestedCount !== null && (!Number.isSafeInteger(requestedCount) || requestedCount < 1)) problems.push("Request at least one peer.");
  const limit = requestedCount === null ? MAX_PEER_LIST_ROWS : Math.min(Math.max(requestedCount, 1), MAX_PEER_LIST_ROWS);

  const states: string[] = [];
  remaining = remaining.replace(/\bDistrict of Columbia\b/gi, "Washington DC");
  for (const [code, name] of Object.entries(STATE_NAMES).sort((a, b) => b[1].length - a[1].length)) {
    const pattern = new RegExp(`\\b${name}\\b`, "gi");
    if (pattern.test(remaining)) {
      states.push(code);
      remaining = remaining.replace(pattern, " ");
    }
  }
  // Lowercase codes are accepted only after a location preposition. Uppercase codes
  // can be joined ('FL and GA'). Do not turn the word 'in' into Indiana.
  remaining = remaining.replace(/\b(in|across|from)\s+([a-zA-Z]{2})\b/g, (whole, preposition: string, raw: string) => {
    const code = raw.toUpperCase();
    if (!STATE_NAMES[code] || (raw !== code && ["IN", "OR", "ME", "AS"].includes(code))) return whole;
    states.push(code); return preposition;
  });
  remaining = remaining.replace(/\b[A-Z]{2}\b/g, (code) => {
    if (!STATE_NAMES[code]) return code;
    states.push(code); return " ";
  });

  const hasCu = /\bcredit unions?\b|\bCUs?\b/i.test(question);
  const hasBank = /\bbanks?\b/i.test(question);
  const bothTypes = (hasCu && hasBank) || /\bboth(?:\s+types)?\b/i.test(question);
  const charterType = bothTypes ? null : hasCu ? "credit_union" : hasBank ? "bank" : null;
  const sameState = /\b(?:same|this|our|my|selected institution's) state\b/i.test(question);
  const similarSize = /\bsimilar(?:ly)?(?:[- ]sized?)?\b|\bcomparable\b|\bclosest\b|\bsame size\b/i.test(question);
  const largest = /\b(largest|biggest|top)\b/i.test(question);
  const peerBased = /\bpeers?\b/i.test(question);
  const saved = /\b(saved|custom|default)\s+(?:peer\s+)?(?:peers?|group|set)\b/i.test(question);
  const accountSubject = /\b(my|our|us)\b/i.test(question);
  if (/\bpeers?\s+(?:for|of)\s+(?!(?:the selected institution|this institution|both types|us|me)\b)/i.test(question)) problems.push("Select the intended research institution in the workspace; named-institution resolution is not supported in this list yet.");
  if (accountSubject && /\bthis institution\b/i.test(question)) problems.push("Specify whether the list should be for the selected institution or the account institution.");
  if (/\b(local|nearby|county|counties|miles?|radius|metro|branches|competitors?)\b/i.test(question)) problems.push("Branch-market selection is not supported in this list yet. Specify a US state or an asset-size group instead; local competitors and asset-size peers are different groups.");
  // A finite grammar is safer than silently ignoring 'not', a named bank, a foreign
  // geography, a reporting year or a metric this list cannot yet apply.
  const allowed = /\b(please|can|could|would|you|give|me|a|an|the|list|show|find|return|identify|name|who|which|what|are|is|of|for|with|in|across|from|and|or|to|by|total|assets?|size|sized|similarly|similar|comparable|closest|same|type|types|peer|peers|competitors?|banks?|credit|unions?|institutions?|financial|cu|cus|us|my|our|this|selected|saved|custom|group|set|default|national|nationally|nationwide|largest|biggest|top|first|all|only|state|states|both|that|have)\b/gi;
  const residue = remaining.replace(allowed, " ").replace(/['?.,!\s-]/g, "");
  if (residue && !problems.length) problems.push(LIST_HELP);
  if (largest && similarSize) problems.push("Choose largest institutions or closest asset-size peers; those are different sort orders.");
  if (sameState && states.length) problems.push("Choose the subject's state or explicitly named states, not both.");
  return { requestedCount, limit, charterType, bothTypes, states: [...new Set(states)].sort(), sameState, minAssets, maxAssets, similarSize, peerBased, largest, saved, accountSubject, problems };
}

export function formatPeerAssets(value: number | null): string {
  if (value === null) return "Not available";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
}

/** Uses explicit filters ahead of defaults. A requested saved group is never replaced. */
export function planPeerList(intent: PeerListIntent, subject: PeerListSubject, active: ActivePeerSet | null): { criteria: PeerListCriteria | null; problem: string | null } {
  if (intent.problems.length) return { criteria: null, problem: intent.problems.join(" ") };
  const explicit = Boolean(intent.charterType || intent.bothTypes || intent.states.length || intent.sameState || intent.minAssets || intent.maxAssets || intent.similarSize || intent.largest);
  const useSaved = intent.saved || (!explicit && active !== null);
  if (intent.saved && !active) return { criteria: null, problem: "No authorized active saved peer group is available for this institution. Choose one in Settings or specify state, type and asset criteria." };
  const filters = useSaved ? active?.filters : undefined;
  const descriptions: string[] = [];
  const savedType = filters?.charter_type;
  if (savedType && savedType !== "bank" && savedType !== "credit_union") return { criteria: null, problem: "The saved group's institution type is unsupported; no substitute group was used." };
  let savedStates = [...new Set(filters?.states ?? [])];
  if (filters?.state_code) {
    if (savedStates.length && !savedStates.includes(filters.state_code)) return { criteria: null, problem: "The saved group's state filters do not overlap. Update the group; no wider fallback was used." };
    savedStates = [filters.state_code];
  }
  if (useSaved && (!filters || (!savedType && !savedStates.length && !filters.asset_tiers?.length && !filters.fed_districts?.length && !filters.institutionIds?.length))) return { criteria: null, problem: "The saved peer group has no usable selection criteria. Update it in Settings; no national fallback was run." };
  let states = intent.sameState ? (subject.stateCode ? [subject.stateCode] : []) : intent.states;
  if (intent.sameState && !subject.stateCode) return { criteria: null, problem: "The subject's state is not available. Specify a state for this list." };
  if (savedStates.length) states = states.length ? states.filter(s => savedStates.includes(s)) : savedStates;
  if (savedStates.length && (intent.states.length || intent.sameState) && !states.length) return { criteria: null, problem: "The requested states do not overlap the saved group's states. No broader substitute list was run." };
  const charterType = intent.bothTypes ? (savedType as PeerCharter | undefined) ?? null : intent.charterType ?? (savedType as PeerCharter | undefined) ?? (!useSaved && (intent.peerBased || intent.similarSize) ? subject.charterType : null);
  if (intent.bothTypes && savedType) return { criteria: null, problem: "The saved group is restricted to one institution type. Remove the saved-group constraint to request both types." };
  if (useSaved && savedType && intent.charterType && savedType !== intent.charterType) return { criteria: null, problem: "The requested institution type conflicts with the saved group's type." };
  let minAssets = intent.minAssets;
  let maxAssets = intent.maxAssets;
  const defaultSimilar = intent.peerBased && !useSaved && !minAssets && !maxAssets && !intent.largest;
  const needsSimilarity = intent.similarSize || defaultSimilar;
  if (needsSimilarity) {
    if (subject.totalAssetsUsd === null || subject.totalAssetsUsd <= 0 || !subject.reportDate) return { criteria: null, problem: "Dated total assets for the research subject are unavailable. Specify an asset range or request the largest institutions in a state instead." };
    const low = { value: subject.totalAssetsUsd / 2, inclusive: true };
    const high = { value: subject.totalAssetsUsd * 2, inclusive: true };
    if (!minAssets || minAssets.value < low.value) minAssets = low;
    if (!maxAssets || maxAssets.value > high.value) maxAssets = high;
    descriptions.push(`Asset-size peers: between half and twice ${subject.name}'s ${formatPeerAssets(subject.totalAssetsUsd)} in assets (${subject.reportDate}).`);
  }
  if (minAssets && maxAssets && (minAssets.value > maxAssets.value || (minAssets.value === maxAssets.value && (!minAssets.inclusive || !maxAssets.inclusive)))) return { criteria: null, problem: "The requested asset range does not overlap the similar-size band. No wider band was used." };
  if (!useSaved && (intent.peerBased || intent.similarSize) && !charterType && !intent.bothTypes) return { criteria: null, problem: "Choose banks, credit unions, or both; the subject's institution type is unavailable." };
  if (useSaved) descriptions.push(`Saved peer group: ${active!.label}. Its filters remain in force.`);
  descriptions.push(`${charterType === "bank" ? "Banks" : charterType === "credit_union" ? "Credit unions" : "Banks and credit unions"}; ${states.length ? states.map(s => STATE_NAMES[s] ?? s).join(" or ") + " (headquarters state)" : "nationwide"}.`);
  if (minAssets) descriptions.push(`Assets ${minAssets.inclusive ? "at least" : "greater than"} ${formatPeerAssets(minAssets.value)}.`);
  if (maxAssets) descriptions.push(`Assets ${maxAssets.inclusive ? "at most" : "less than"} ${formatPeerAssets(maxAssets.value)}.`);
  if (filters?.asset_tiers?.length) descriptions.push(`Saved registry asset tiers: ${filters.asset_tiers.join(", ")}; displayed dollar assets come from dated filings.`);
  if (filters?.fed_districts?.length) descriptions.push(`Saved Federal Reserve districts: ${filters.fed_districts.join(", ")}.`);
  const sort = intent.largest ? "largest_assets" : needsSimilarity ? "closest_assets" : "name";
  descriptions.push(sort === "closest_assets" ? "Ordered by closest proportional asset size, then institution name and ID." : sort === "largest_assets" ? "Ordered by total assets, largest first, then institution name and ID." : "Ordered by institution name and ID.");
  descriptions.push("The research subject is excluded. Published fee coverage does not determine eligibility.");
  return { problem: null, criteria: {
    basis: useSaved ? "saved_peer_set" : needsSimilarity ? "similar_assets" : "explicit_filters",
    charterType, states, minAssets, maxAssets,
    institutionIds: filters?.institutionIds?.length ? [...new Set(filters.institutionIds)] : null,
    assetTiers: filters?.asset_tiers ?? [], fedDistricts: filters?.fed_districts ?? [],
    peerSetId: useSaved ? active!.id : null, peerSetLabel: useSaved ? active!.label : null,
    sort, referenceAssetsUsd: needsSimilarity ? subject.totalAssetsUsd : null,
    requiresAssets: Boolean(minAssets || maxAssets || intent.largest || needsSimilarity),
    limit: intent.limit, requestedCount: intent.requestedCount, descriptions,
  } };
}
