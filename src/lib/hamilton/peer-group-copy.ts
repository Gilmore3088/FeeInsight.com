/**
 * The words every surface uses for a saved peer group's results: the empty state and the one
 * context line (group name, research institution, coverage). No database imports, so client
 * components can use it.
 */

/** A saved peer group that matched no institutions for the research institution. */
export interface EmptyPeerGroup {
  status: "empty";
  /** The saved group's id; null when the group could not be found. */
  id: number | null;
  name: string;
  /** The group's name, or a plain-words description when unnamed. */
  label: string;
  /** The research institution the group was resolved for. */
  institutionId: number | null;
  institutionName: string | null;
  /** Why it matched no institutions, in plain words. */
  reason: string;
}

/** A saved peer group's membership, as charts, benchmarks, reports and peer lists show it. */
export interface PeerGroupSummary {
  id: number | null;
  name: string;
  label: string;
  institutionId: number | null;
  institutionName: string | null;
  /** Institutions in the group (the research institution left out). */
  institutionCount: number;
}

/** The value a peer picker uses for "automatic peers", chosen by the user. */
export const AUTOMATIC_PEERS_ID = "auto";

const count = (n: number) => n.toLocaleString("en-US");
const plainName = (name: string | null | undefined) => (name ?? "").replace(/\.$/, "").trim();

/** `Your peer group "X" matches no institutions for Y. Reason` */
export function emptyPeerGroupMessage(group: Pick<EmptyPeerGroup, "label" | "institutionName" | "reason">): string {
  const who = plainName(group.institutionName);
  const reason = group.reason.trim();
  return `Your peer group "${group.label}" matches no institutions${who ? ` for ${who}` : ""}.${reason ? ` ${reason}` : ""}`;
}

/** "1 institution" / "24 institutions". */
function institutions(n: number): string {
  return `${count(n)} ${n === 1 ? "institution" : "institutions"}`;
}

/**
 * The coverage half of the line: `24 institutions in the group; 9 publish this fee.` Publishing
 * is a number for one fee, a [low, high] range for several, or null when not known.
 */
export function peerGroupCoverage(
  institutionCount: number,
  publishing: number | readonly [number, number] | null = null,
): string {
  const head = `${institutions(institutionCount)} in the group`;
  if (publishing === null) return `${head}.`;
  if (typeof publishing === "number") return `${head}; ${count(publishing)} ${publishing === 1 ? "publishes" : "publish"} this fee.`;
  const [low, high] = publishing;
  return low === high
    ? `${head}; ${count(low)} ${low === 1 ? "publishes" : "publish"} each fee shown.`
    : `${head}; ${count(low)} to ${count(high)} publish each fee shown.`;
}

/** One short line: `"X" for Y: 24 institutions in the group; 9 publish this fee.` */
export function peerGroupCoverageLine(
  group: Pick<PeerGroupSummary, "label" | "institutionName" | "institutionCount">,
  publishing: number | readonly [number, number] | null = null,
): string {
  const who = plainName(group.institutionName);
  return `"${group.label}"${who ? ` for ${who}` : ""}: ${peerGroupCoverage(group.institutionCount, publishing)}`;
}

/** The fewest and most institutions publishing any one fee, or null when there are none. */
export function publishingRange(counts: readonly number[]): [number, number] | null {
  return counts.length ? [Math.min(...counts), Math.max(...counts)] : null;
}

const settingsFor = (institutionId: number | null | undefined) =>
  `/pro/settings${institutionId ? `?instId=${institutionId}` : ""}`;

/** "Edit this group": Settings, at the peer groups, for this research institution. */
export function editPeerGroupHref(group: Pick<EmptyPeerGroup, "institutionId">): string {
  return `${settingsFor(group.institutionId)}#peer-sets`;
}

/** "Compare with another group" where the page has no picker: Settings' "Peer group for all charts". */
export function choosePeerGroupHref(group: Pick<EmptyPeerGroup, "institutionId">): string {
  return `${settingsFor(group.institutionId)}#peer-default`;
}
