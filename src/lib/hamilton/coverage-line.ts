/**
 * The coverage and freshness line for the institution Hamilton is researching (Hamilton V5 §4A
 * "source coverage indicator", #1891; improvements ranked 2026-10-27, item 3): how many of its
 * published fees are on file, the date its fee schedule states, when its fees were last verified
 * against that schedule, the peer set in use and its size, and which headline fee types have no
 * published fee on file. One set of words for the command center and the board brief's PDF cover,
 * so the two never drift.
 *
 * It complements the dataset stamp (#1924, `dataset-note.ts`), which says where a screen's peer and
 * market medians came from; this line is about the subject institution's own fees. Pure and
 * client-safe; the read is `getInstitutionFeeCoverage` (data-store/institution-coverage.ts).
 */
import { getDisplayName, getFeaturedCategories } from "@/lib/fee-taxonomy";
import { PRODUCT_NAME } from "@/lib/constants";

/** The headline fee types the "not on file" part is measured against (spotlight and core tiers). */
export const COVERAGE_HEADLINE_FEES: readonly string[] = getFeaturedCategories();

export interface InstitutionCoverage {
  institutionId: number;
  institutionName: string;
  /** When the coverage was read (ISO). */
  readAt: string;
  /** Live published fee rows on file. */
  fees: number;
  /** The fee types they cover. */
  categories: string[];
  /**
   * The schedule documents behind them, each with the date it states. `statedRead` false: its date
   * has not been read yet (date and basis are then null and say nothing); true with a null date: it
   * states none. Basis `url_year` is only a year its web address names, not a date it states.
   */
  documents: { id: number; statedDate: string | null; statedBasis: string | null; statedRead: boolean }[];
  /** When the most recently verified live fee was first verified against its schedule (ISO); null when not recorded. */
  lastVerifiedAt: string | null;
  /** The peer set in use and the institutions in it with published fees on file; null when not read. */
  peer: { label: string; institutions: number } | null;
}

export interface CoverageWords {
  /** The sentences of the line, in order: fees and schedule, verification, peer set, what is missing. */
  sentences: string[];
  /** Where every number in the line comes from. */
  source: string;
}

function day(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Missing fee types named in full up to NAMED_MISSING; a longer list names the first few and counts the rest. */
const NAMED_MISSING = 5;
function namedFew(names: string[]): string[] {
  if (names.length <= NAMED_MISSING) return names;
  const shown = names.slice(0, NAMED_MISSING - 1);
  return [...shown, count(names.length - shown.length, "other", "others")];
}

type CoverageDocument = InstitutionCoverage["documents"][number];

/**
 * How one document's date reads: not read yet (its date has not been read at the current version,
 * so a null date means nothing), a date its text states, only a year its web address names (the
 * text states none; never shown as the schedule's date, and left out of any date range, as the
 * dated-edition check leaves it out), or no date at all.
 */
function dateKind(d: CoverageDocument): "unread" | "dated" | "url_year" | "none" {
  if (!d.statedRead) return "unread";
  if (d.statedDate === null) return "none";
  return d.statedBasis === "url_year" ? "url_year" : "dated";
}

/** "from its fee schedule dated Aug 1, 2026" and the variants for several, undated or unread documents. */
function scheduleClause(documents: InstitutionCoverage["documents"]): string {
  const n = documents.length;
  if (n === 0) return "";
  if (n === 1) {
    const [d] = documents;
    switch (dateKind(d)) {
      case "unread": return ", read from its fee schedule, whose date has not been read yet";
      case "none": return ", read from its fee schedule, which states no date";
      case "url_year": return `, read from its fee schedule, which states no date (its web address names ${d.statedDate!.slice(0, 4)})`;
      case "dated": return `, read from its fee schedule dated ${day(d.statedDate!)}`;
    }
  }
  const dated = documents
    .filter((d) => dateKind(d) === "dated")
    .map((d) => d.statedDate!)
    .sort();
  const unread = documents.filter((d) => dateKind(d) === "unread").length;
  const undated = n - dated.length - unread;
  const rest: string[] = [];
  if (undated > 0) rest.push(`${count(undated, "document states", "documents state")} no date`);
  if (unread > 0) rest.push(`${count(unread, "document has", "documents have")} not had ${unread === 1 ? "its date" : "their dates"} read yet`);
  if (dated.length === 0) {
    if (unread === 0) return `, read from ${n} schedule documents, none of which states a date`;
    if (undated === 0) return `, read from ${n} schedule documents whose dates have not been read yet`;
    return `, read from ${n} schedule documents; ${list(rest)}`;
  }
  const oldest = day(dated[0]);
  const newest = day(dated[dated.length - 1]);
  if (rest.length === 0) {
    return oldest === newest ? `, read from ${n} schedule documents, each dated ${newest}` : `, read from ${n} schedule documents dated ${oldest} to ${newest}`;
  }
  return `, read from ${n} schedule documents; the newest stated date is ${newest}, and ${list(rest)}`;
}

/**
 * The line's words. `peerLabelShown` is true where the page already names the peer set (the PDF
 * cover prints "Peer baseline: ..." just above), so the line gives only its size there.
 */
export function coverageWords(c: InstitutionCoverage, options: { peerLabelShown?: boolean } = {}): CoverageWords {
  const sentences: string[] = [];
  if (c.fees === 0) {
    sentences.push(`No published fee for ${c.institutionName} is on file yet.`);
  } else {
    sentences.push(`${count(c.fees, "published fee", "published fees")} on file across ${count(c.categories.length, "fee type", "fee types")}${scheduleClause(c.documents)}.`);
    sentences.push(c.lastVerifiedAt ? `Last verified against its schedule on ${day(c.lastVerifiedAt)}.` : "No verification date is recorded for these fees.");
  }
  if (c.peer) {
    const size = count(c.peer.institutions, "institution", "institutions");
    sentences.push(options.peerLabelShown
      ? `The peer baseline has ${size} with published fees on file.`
      : `Peer set: ${c.peer.label}, ${size} with published fees on file.`);
  }
  if (c.fees > 0) {
    const have = new Set(c.categories);
    const missing = COVERAGE_HEADLINE_FEES.filter((key) => !have.has(key));
    const total = COVERAGE_HEADLINE_FEES.length;
    sentences.push(missing.length === 0
      ? `All ${total} headline fee types are on file.`
      : `${missing.length} of the ${total} headline fee types ${missing.length === 1 ? "has" : "have"} no published fee on file: ${list(namedFew(missing.map(getDisplayName)))}.`);
  }
  return {
    sentences,
    source: `${PRODUCT_NAME} live published fees and the fee schedules behind them, as of ${day(c.readAt)}.`,
  };
}

/** A coverage record read back from saved JSON; anything not shaped like one gives null (an older brief). */
export function readCoverage(value: unknown): InstitutionCoverage | null {
  const c = value as Partial<InstitutionCoverage> | null;
  if (!c || typeof c !== "object") return null;
  if (typeof c.institutionId !== "number" || typeof c.institutionName !== "string" || typeof c.readAt !== "string") return null;
  if (typeof c.fees !== "number" || !Array.isArray(c.categories) || !Array.isArray(c.documents)) return null;
  const peer = c.peer && typeof c.peer.label === "string" && typeof c.peer.institutions === "number" ? { label: c.peer.label, institutions: c.peer.institutions } : null;
  return {
    institutionId: c.institutionId,
    institutionName: c.institutionName,
    readAt: c.readAt,
    fees: c.fees,
    categories: c.categories.filter((k): k is string => typeof k === "string"),
    documents: c.documents.flatMap((d) => d && typeof d.id === "number"
      ? [readDocument(d)]
      : []),
    lastVerifiedAt: typeof c.lastVerifiedAt === "string" ? c.lastVerifiedAt : null,
    peer,
  };
}

/** A saved document entry; one saved without `statedRead` counts as read only when it carries a date. */
function readDocument(d: Partial<CoverageDocument> & { id: number }): CoverageDocument {
  const statedDate = typeof d.statedDate === "string" ? d.statedDate : null;
  const statedRead = typeof d.statedRead === "boolean" ? d.statedRead : statedDate !== null;
  return {
    id: d.id,
    statedDate: statedRead ? statedDate : null,
    statedBasis: statedRead && typeof d.statedBasis === "string" ? d.statedBasis : null,
    statedRead,
  };
}
