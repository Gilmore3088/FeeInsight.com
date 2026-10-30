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
  /** The schedule documents behind them, each with the date it states (null: states none). */
  documents: { id: number; statedDate: string | null; statedBasis: string | null }[];
  /** When the most recently verified live fee was verified against its schedule (ISO); null when not recorded. */
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

/** A stated date as the schedule gives it: a year read from the document's address is only a year. */
function statedText(date: string, basis: string | null): string {
  return basis === "url_year" ? date.slice(0, 4) : day(date);
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

/** "from its fee schedule dated Aug 1, 2026" and the variants for several or undated documents. */
function scheduleClause(documents: InstitutionCoverage["documents"]): string {
  const n = documents.length;
  if (n === 0) return "";
  const dated = documents
    .filter((d): d is { id: number; statedDate: string; statedBasis: string | null } => d.statedDate !== null)
    .sort((a, b) => a.statedDate.localeCompare(b.statedDate));
  const undated = n - dated.length;
  if (dated.length === 0) {
    return n === 1 ? ", read from one fee schedule that states no date" : `, read from ${n} schedule documents, none of which states a date`;
  }
  const oldest = statedText(dated[0].statedDate, dated[0].statedBasis);
  const newest = statedText(dated[dated.length - 1].statedDate, dated[dated.length - 1].statedBasis);
  if (undated === 0) {
    if (n === 1) return `, read from its fee schedule dated ${newest}`;
    return oldest === newest ? `, read from ${n} schedule documents, each dated ${newest}` : `, read from ${n} schedule documents dated ${oldest} to ${newest}`;
  }
  return `, read from ${n} schedule documents; the newest stated date is ${newest}, and ${count(undated, "document states", "documents state")} no date`;
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
    sentences.push(c.lastVerifiedAt ? `Last verified against its schedule ${day(c.lastVerifiedAt)}.` : "No verification date is recorded for these fees.");
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
      : `No published fee was found for ${missing.length} of the ${total} headline fee types: ${list(namedFew(missing.map(getDisplayName)))}.`);
  }
  return {
    sentences,
    source: `${PRODUCT_NAME} live published fees and the fee schedules they were read from, read ${day(c.readAt)}.`,
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
      ? [{ id: d.id, statedDate: typeof d.statedDate === "string" ? d.statedDate : null, statedBasis: typeof d.statedBasis === "string" ? d.statedBasis : null }]
      : []),
    lastVerifiedAt: typeof c.lastVerifiedAt === "string" ? c.lastVerifiedAt : null,
    peer,
  };
}
