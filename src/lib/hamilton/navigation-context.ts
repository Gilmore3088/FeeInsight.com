import { normalizeCanonicalInstitutionId, hrefWithInstitutionContext } from "./context-link";
import { decodeLandingResearch, encodeLandingResearch, type LandingResearchHandoff } from "./landing-research-handoff";

/** Navigation intent only; each destination still authenticates and resolves its evidence. */
export interface HamiltonNavigationSelection {
  institutionId: string | null;
  research: LandingResearchHandoff | null;
  artifact: boolean;
  invalid: boolean;
  /** Do not start an institution-only question while canonical identity is unresolved. */
  unresolved?: boolean;
}

const SUBJECT_PATHS = new Set(["/pro", "/pro/analyze", "/pro/research", "/pro/intelligence", "/pro/hamilton", "/pro/reports", "/pro/simulate", "/pro/monitor", "/pro/saved", "/pro/settings"]);
const ARTIFACT_PARAMS = ["analysis", "report_id", "report", "scenario_id", "scenario"];

export function isHamiltonSubjectPath(pathname: string): boolean {
  return SUBJECT_PATHS.has(pathname);
}

export function hamiltonNavigationSelection(pathname: string, params: URLSearchParams): HamiltonNavigationSelection {
  const empty = { institutionId: null, research: null, artifact: false, invalid: false };
  if (!isHamiltonSubjectPath(pathname)) return empty;
  if (ARTIFACT_PARAMS.some((key) => params.get(key)?.trim())) return { ...empty, artifact: true };
  if (params.has("research")) {
    try {
      const research = decodeLandingResearch(params.get("research"));
      if (!research) return { ...empty, invalid: true };
      return { ...empty, research, institutionId: research.scope.kind === "local" ? String(research.scope.institutionId) : null };
    } catch { return { ...empty, invalid: true }; }
  }
  const raw = params.get("instId");
  const institutionId = normalizeCanonicalInstitutionId(raw);
  return { ...empty, institutionId, invalid: raw !== null && !institutionId };
}

export function hrefWithHamiltonNavigation(href: string, selection: HamiltonNavigationSelection): string {
  const fragmentIndex = href.indexOf("#");
  const fragment = fragmentIndex < 0 ? "" : href.slice(fragmentIndex);
  const [path, query = ""] = (fragmentIndex < 0 ? href : href.slice(0, fragmentIndex)).split("?");
  if (!SUBJECT_PATHS.has(path)) return href;
  const params = new URLSearchParams(query);
  // A destination's explicit subject/contract or saved record remains authoritative.
  if (params.has("instId") || params.has("research") || ARTIFACT_PARAMS.some((key) => params.get(key)?.trim())) return href;
  if (selection.research && (path === "/pro/analyze" || path === "/pro/reports")) {
    // Board briefs are built from the market view or a saved answer, so Reports opens the saved list.
    if (path === "/pro/reports") return href;
    params.set("research", encodeLandingResearch({ ...selection.research, task: "compare" }));
    return `${path}?${params}${fragment}`;
  }
  return hrefWithInstitutionContext(href, selection.institutionId);
}

/** Screens that read one institution keep the reader where they are when the subject changes (#2043). */
const SWITCH_IN_PLACE = new Set(["/pro/analyze", "/pro/research", "/pro/simulate", "/pro/reports", "/pro/monitor"]);
/** What the reader was looking at, kept across a switch; the subject and saved records are not. */
const SWITCH_KEEPS = ["fee", "category", "layer"];

/** Where the context bar's switch goes: the same screen for the new institution, else its own page. */
export function subjectSwitchHref(pathname: string, institutionId: string | number, params: URLSearchParams = new URLSearchParams()): string {
  const id = normalizeCanonicalInstitutionId(institutionId);
  if (!id) return "/pro/research";
  // The one-institution briefing stays the briefing.
  if (pathname === "/pro/intelligence" && params.get("view") === "institution") return `/pro/intelligence?view=institution&instId=${id}`;
  if (!SWITCH_IN_PLACE.has(pathname)) return `/pro/research?instId=${id}`;
  const next = new URLSearchParams({ instId: id });
  for (const key of SWITCH_KEEPS) { const value = params.get(key); if (value) next.set(key, value); }
  return `${pathname}?${next}`;
}

/** The U.S. market from the bar: Ask answers for the market in place; other screens open Research. */
export function marketSwitchHref(pathname: string, nationalResearch: string): string {
  return pathname === "/pro/analyze" ? `/pro/analyze?${new URLSearchParams({ research: nationalResearch })}` : "/pro/intelligence";
}
