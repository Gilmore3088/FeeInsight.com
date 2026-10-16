export function isCanonicalInstitutionId(value: string | null | undefined): value is string {
  if (!value) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && String(parsed) === value.trim();
}

export function normalizeCanonicalInstitutionId(
  value: string | number | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return isCanonicalInstitutionId(text) ? text : null;
}

export function hrefWithInstitutionContext(
  href: string,
  institutionId: string | null | undefined,
): string {
  const normalizedInstitutionId = normalizeCanonicalInstitutionId(institutionId);
  if (!normalizedInstitutionId) return href;
  const fragmentIndex = href.indexOf("#");
  const hrefWithoutFragment = fragmentIndex === -1 ? href : href.slice(0, fragmentIndex);
  const fragment = fragmentIndex === -1 ? "" : href.slice(fragmentIndex);
  const [path, query = ""] = hrefWithoutFragment.split("?");
  if (path !== "/pro" && !path.startsWith("/pro/")) return href;

  const params = new URLSearchParams(query);
  // Saved answers resolve their own authorized, historical subject on the server.
  // Never attach the institution currently being browsed to a history link.
  if (path === "/pro/analyze" && params.get("analysis")?.trim()) return href;
  if (!params.has("instId")) params.set("instId", normalizedInstitutionId);
  const nextQuery = params.toString();
  return `${nextQuery ? `${path}?${nextQuery}` : path}${fragment}`;
}

/**
 * Where an institution link inside Pro goes (#1546): that institution's Hamilton overview, so a
 * Pro reader stays in the workspace. The public consumer page is `publicInstitutionHref`.
 */
export function hamiltonInstitutionHref(institutionId: string | number | null | undefined): string {
  return hrefWithInstitutionContext("/pro/hamilton", normalizeCanonicalInstitutionId(institutionId));
}

/** The public consumer page for an institution, linked from Pro only as a secondary link. */
export function publicInstitutionHref(institutionId: string | number): string {
  return `/institution/${encodeURIComponent(String(institutionId))}`;
}
