import { MIN_GROUP } from "./call-report-items";

/**
 * Helpers over institution_network_memberships (the Fed's Regulation II exempt and
 * covered-issuer lists). A share is members over the institutions we track in the group, and a
 * group below MIN_GROUP institutions gets no share.
 */

export const COVERED_ISSUER_NETWORK = "reg-ii-not-exempt";

/** Members over institutions, or null when the group is too small to show. */
export function shareOf(members: number, institutions: number, minGroup: number = MIN_GROUP): number | null {
  if (institutions < minGroup || institutions <= 0) return null;
  return members / institutions;
}

/**
 * SQL boolean for "this institution is on the Fed's newest Regulation II Not Exempt (covered
 * issuer) list", over institution_sources aliased `alias`. For a peer dimension: a fixed
 * string, no user input. False also covers an institution the list names but we could not match.
 */
export function coveredIssuerSql(alias = "s"): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`Bad table alias: ${alias}`);
  return `EXISTS (SELECT 1 FROM institution_network_memberships m WHERE m.institution_id = ${alias}.id AND m.network = '${COVERED_ISSUER_NETWORK}' AND m.as_of = (SELECT MAX(as_of) FROM institution_network_memberships WHERE network = '${COVERED_ISSUER_NETWORK}'))`;
}
