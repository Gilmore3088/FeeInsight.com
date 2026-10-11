/**
 * Public research selections, not execution authority or trusted evidence.
 * Serialize through the existing login/subscription return URL; the destination must
 * parse again, check access, and obtain current evidence from the governed reader.
 * No automatic execution: a shared URL or refresh must not create a paid report.
 */
import {
  HOMEPAGE_MARKET_CATEGORIES,
  homepageLocalMarketRequest,
  resolveLocalMarketCategories,
  type LocalMarketRequest,
} from "./local-market-request";

export const LANDING_RESEARCH_PARAM = "research";
export const RESEARCH_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
] as const;
export type ResearchStateCode = (typeof RESEARCH_STATE_CODES)[number];
export type ResearchScope =
  | { kind: "national" }
  | { kind: "state"; stateCode: ResearchStateCode }
  | { kind: "local"; institutionId: number };
export interface LandingResearchHandoff {
  version: 1;
  task: "compare" | "board_report";
  scope: ResearchScope;
  categories: string[];
  charter: "all" | "bank" | "credit_union";
}
const MAX_PAYLOAD_LENGTH = 4096;
const STATES = new Set<string>(RESEARCH_STATE_CODES);

export class LandingResearchError extends Error {
  constructor(message: string) { super(message); this.name = "LandingResearchError"; }
}
function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LandingResearchError("The research selection could not be read. Choose it again.");
  }
  const proto = Object.getPrototypeOf(value);
  if ((proto !== Object.prototype && proto !== null) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new LandingResearchError("This research selection contains unsupported fields.");
  }
  return value as Record<string, unknown>;
}
export function parseLandingResearch(value: unknown): LandingResearchHandoff {
  const v = object(value, ["version", "task", "scope", "categories", "charter"]);
  if (v.version !== 1 || (v.task !== "compare" && v.task !== "board_report")) {
    throw new LandingResearchError("This research workflow is not recognized.");
  }
  if (v.charter !== "all" && v.charter !== "bank" && v.charter !== "credit_union") {
    throw new LandingResearchError("Choose banks, credit unions, or both.");
  }
  const s = object(v.scope, ["kind", "stateCode", "institutionId"]);
  let scope: ResearchScope;
  if (s.kind === "national") {
    object(s, ["kind"]);
    scope = { kind: "national" };
  } else if (s.kind === "state") {
    object(s, ["kind", "stateCode"]);
    if (typeof s.stateCode !== "string" || !STATES.has(s.stateCode)) {
      throw new LandingResearchError("Choose one of the 50 states or Washington, DC.");
    }
    scope = { kind: "state", stateCode: s.stateCode as ResearchStateCode };
  } else if (s.kind === "local") {
    object(s, ["kind", "institutionId"]);
    if (typeof s.institutionId !== "number") throw new LandingResearchError("Choose an institution first.");
    const selected = homepageLocalMarketRequest(s.institutionId);
    scope = { kind: "local", institutionId: selected.institutionId! };
  } else {
    throw new LandingResearchError("Choose national, state, or local research.");
  }
  // Defaults apply only to an omitted field; explicit empty/invalid selections fail closed.
  const categories = resolveLocalMarketCategories(v.categories === undefined ? [...HOMEPAGE_MARKET_CATEGORIES] : v.categories);
  return { version: 1, task: v.task, scope, categories, charter: v.charter };
}
export function encodeLandingResearch(value: unknown): string {
  const encoded = JSON.stringify(parseLandingResearch(value));
  if (encoded.length > MAX_PAYLOAD_LENGTH) throw new LandingResearchError("This research selection is too long.");
  return encoded;
}
/** Accept the already-decoded query value from Next searchParams or URLSearchParams. */
export function decodeLandingResearch(value: unknown): LandingResearchHandoff | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PAYLOAD_LENGTH) {
    throw new LandingResearchError("This research link is invalid. Choose the selection again.");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new LandingResearchError("This research link is invalid. Choose the selection again."); }
  return parseLandingResearch(parsed);
}
/** Prepared link only: do not expose its CTA before that destination's consumer is wired/tested. */
export function landingResearchHref(value: unknown): string {
  const request = parseLandingResearch(value);
  const target = request.task === "board_report" ? "/pro/reports" : "/pro/analyze";
  return `${target}?${new URLSearchParams({ [LANDING_RESEARCH_PARAM]: encodeLandingResearch(request) })}`;
}
/** Only the existing local handler's supported scope may pass this adapter. */
export function localRequestFromLanding(value: unknown): LocalMarketRequest {
  const request = parseLandingResearch(value);
  if (request.task !== "compare" || request.scope.kind !== "local" || request.charter !== "all") {
    throw new LandingResearchError("This selection needs its matching market or report workflow; local comparison was not run.");
  }
  return homepageLocalMarketRequest(request.scope.institutionId, request.categories);
}
