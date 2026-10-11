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

const SUBJECT_PATHS = new Set(["/pro", "/pro/analyze", "/pro/research", "/pro/hamilton", "/pro/reports", "/pro/simulate", "/pro/monitor", "/pro/settings"]);
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
    params.set("research", encodeLandingResearch({ ...selection.research, task: path === "/pro/reports" ? "board_report" : "compare" }));
    return `${path}?${params}${fragment}`;
  }
  return hrefWithInstitutionContext(href, selection.institutionId);
}
