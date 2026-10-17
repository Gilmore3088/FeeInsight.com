import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { hostSql, textHasCertNumber, urlHost } from "@/lib/agents/magellan/other-bank-host";
import { STATE_NAMES } from "@/lib/us-states";

import { loadSourceTexts } from "./verify";

type SqlTag = typeof sql;

/**
 * Whose schedule is this? (#1455). Hamilton's other-bank check (`hamilton/other-bank-document.ts`)
 * trusts the stored website: a document on this bank's own website host is this bank's. That
 * fails two ways on prod (Oct 15, read-only):
 * - The registry seed (2026-02-15) stored another bank's website: 5756 Bluegrass Community FCU
 *   (Ashland) carried University of Kentucky FCU's PDF, 4884 Metrowest Community FCU St. Mary's
 *   CU's, 1903 First National Bank, Oldham SD First National Bank, Fort Pierre SD's (52 live fees).
 * - Credit union website vendors serve one CU's document on every member domain:
 *   Healthplus FCU's (5009) schedule ("HEALTHPLUS | Fee Schedule") at
 *   `<cu-domain>/ezs3download/download/...` on unrelated CUs, and Horizons North CU's (8416) at
 *   `5star.bank/_/kcms-doc/...` on 5Star Bank.
 *
 * A live (institution, document) pair is read when its document is linked to another institution
 * (the document's host is that institution's stored website, that institution has live fees from
 * the same address, or one of its documents has the same `text_hash`), or sits on a vendor
 * download path (`VENDOR_DOCUMENT_PATH`; a path alone is no proof). Only linked institutions can
 * take a fee down. The registry-wide name scan finds partners and ordinary words ("Fees
 * associated with" -> Associated Bank, "Currency" -> Currency Bank, a title-cased "Wells Fargo
 * Bank" correspondent on line 1), so an institution only it finds gives `registry_named`, a review
 * verdict that passes. In order (the first that applies decides):
 * - `no_text`.
 * - `sibling_shared`: every linked institution shares this bank's holding company (#1441: IBC's
 *   five, Wells Fargo's three). Never taken down; counted once per document.
 * - `own_named`: the text names this bank: a name form no linked institution shares, its CU
 *   acronym, its website (when that is not the document's host), its city, or its FDIC / NCUA
 *   number. Passes, also when it names another bank (co-branded, shared-service).
 * - Vendor copy: on a vendor path, the institution among this bank and those sharing the text
 *   hash whose name form or acronym the text prints owns it (a bare one-word brand never
 *   counts). This bank: `own_named`; another: `other_bank`.
 * - Site: this bank has a stored website, the document is not on it (`onWebsiteHost`), and the
 *   document's host is exactly one unrelated linked institution's stored website: `other_bank`.
 * - Linked institutions the text names (a name form, CU acronym, city with its state, or the
 *   header rule `headerNamesInstitution`): one unrelated is `other_bank`, two or more
 *   `shared_service`; a named sibling is `sibling_shared`. One institution linked only by
 *   address or text hash is capped at `shared_service` when the text gives only its acronym or
 *   city, or when the document is on this bank's own site: a name variant this bank's forms miss
 *   must not hand its own schedule away.
 * - `registry_named`, else `unproven`.
 * A name form is two words or more: a one-word brand counts only next to the institution's
 * city, since "currency", "customers", "direct", "popular" or "timberline" are fee words or other
 * banks' names.
 *
 * Each pair is read once per version, mode and text hash (`documentOwnerFingerprint`), and a
 * step skips the scoped read when the last one selected no pair and no text or live fee has
 * arrived since. With the takedown on, `other_bank` pairs are re-read under their own cap for the
 * second look, and pairs that pass clear their pending flags.
 *
 * Shadow first (CLAUDE.md standing rule, DECISIONS 2026-10-15): with
 * `DARWIN_DOCUMENT_OWNER_TAKEDOWN` off, each learning verify step reads up to
 * `DOCUMENT_OWNER_PAIR_LIMIT` pairs it has not read under this version, records each as a
 * `verify.document_owner` attempt, and logs the live fees it would take down as a
 * `darwin.document_owner_shadow` event. It changes no fee. `documentOwnerCountSql` is the
 * read-only count of the whole backlog for James before the switch turns on.
 */
export const DOCUMENT_OWNER_STRATEGY = { strategy: "verify.document_owner", version: 1 } as const;
export const DOCUMENT_OWNER_CHECK = "darwin.document_owner";
export const DOCUMENT_OWNER_REASON = "document_owner";
export const DOCUMENT_OWNER_FLAG = "document_owner";
export const DOCUMENT_OWNER_PAIR_LIMIT = 25;
/**
 * Takedown switch, on (James's yes, 2026-10-17, after the dry count: 228 live fees on 19
 * document/bank pairs at 10 institutions, 19 of 19 pairs right by hand). On: an `other_bank` fee
 * goes through the shared 12-hour second look (`darwin.document_owner`) and is archived (rolled
 * back with the reason, the verified row rejected with the `document_owner` flag), never deleted.
 * Off (set it to false): shadow, as above.
 */
export const DARWIN_DOCUMENT_OWNER_TAKEDOWN = true;

/**
 * Website-vendor download paths that serve one institution's file on many member domains
 * (Kentico `/_/kcms-doc/`, the CU vendor's `/ezs3download/download/`). POSIX and JS regex alike.
 */
export const VENDOR_DOCUMENT_PATH = "/(ezs3download/download|_/kcms-doc|kcms-doc)/";
const VENDOR_PATH = new RegExp(VENDOR_DOCUMENT_PATH, "i");

/** Is this address a vendor download path? */
export function isVendorDocumentPath(url: string | null | undefined): boolean {
  return VENDOR_PATH.test(url ?? "");
}

/**
 * Names, brands and acronyms that never identify one institution: boilerplate ("Member FDIC"),
 * type words, and words every schedule uses (prod, Oct 15: "currency", "customers", "applied",
 * "direct", "method", "certified", "principal", "primary", "medallion", "surety", "options",
 * "social security", "popular" each matched an institution's brand).
 */
const GENERIC_NAMES = new Set([
  "bank", "the bank", "credit union", "federal credit union", "fcu", "savings bank", "state bank", "national bank",
  "trust company", "member fdic", "federally insured by ncua", "equal housing lender", "community bank",
  "members", "member", "account", "accounts", "savings", "checking", "federal", "community", "national",
  "american", "united", "credit", "people", "peoples", "citizens", "farmers", "security", "service", "services",
  "financial", "employees", "teachers", "education", "family", "partners", "premier", "summit", "pinnacle",
  "liberty", "freedom", "heritage", "pioneer", "frontier", "central", "southern", "northern", "western",
  "eastern", "capital", "guardian", "beacon", "anchor", "harbor", "landmark", "legacy", "advantage",
  "alliance", "together", "mission", "patriot", "veterans", "military", "school", "schools", "hospital",
  "health", "medical", "postal", "police", "county", "valley", "mutual", "commerce", "merchants",
  "industrial", "insurance", "overdraft", "deposit", "deposits", "statement", "transfer", "business",
  "personal", "consumer", "online", "mobile", "digital", "first national", "first state", "first federal",
  "currency", "customers", "applied", "direct", "method", "certified", "principal", "primary", "medallion",
  "surety", "options", "social security", "popular", "first", "home", "state", "city",
]);
const MIN_NAME_CHARS = 6;
const MIN_CITY_CHARS = 3;
const MIN_ACRONYM_CHARS = 4;
/** A text hash links institutions only for a real text (this many characters or more)... */
export const HASH_LINK_MIN_CHARS = 200;
/** ...shared by this many documents or fewer; boilerplate pages share one hash with thousands. */
export const HASH_LINK_MAX_DOCUMENTS = 20;

export interface OwnerBank {
  id: number;
  name: string;
  city?: string | null;
  stateCode?: string | null;
  certNumber?: string | number | null;
  holdingCompanyRssd?: string | null;
  holdingCompanyName?: string | null;
  /** The stored website's host ("hncu.org"). */
  websiteHost?: string | null;
  /** Another institution's name contains this one's (`sharedNameIds`): it then counts only with its city. */
  nameShared?: boolean;
}

/** How a linked institution shares the document. */
export interface DocumentLinks {
  /** Its stored website is the document's host. */
  hostIds?: number[];
  /** One of its documents has the same text hash. */
  hashIds?: number[];
  /** The document's host. */
  documentHost?: string | null;
  /** The document is on a vendor download path. */
  vendorPath?: boolean;
}

export type DocumentOwnerVerdict =
  | { kind: "own_named"; evidence: string }
  | { kind: "sibling_shared"; siblingIds: number[] }
  | { kind: "other_bank"; otherId: number; evidence: string }
  | { kind: "shared_service"; otherIds: number[] }
  /** Only the registry scan found another institution's name (a partner, network or ordinary word): for review, never a takedown. */
  | { kind: "registry_named"; otherIds: number[] }
  | { kind: "unproven" }
  | { kind: "no_text" };

/**
 * Lower case words, apostrophes dropped ("St. Mary's" is "st marys"), "&" read as "and"
 * ("Bank & Trust" is "bank and trust"), everything else a space.
 */
export function ownerWords(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasWords(padded: string, words: string): boolean {
  return words.length > 0 && padded.includes(` ${words} `);
}

/** Trailing words a name may print or leave off: "N.A.", "F.S.B.", "S.S.B.", "Company", "Inc."... */
const BASE_NAME_SUFFIX = / (national association|n a|na|ssb|s s b|fsb|f s b|inc|incorporated|company|co|corp|corporation)$/;

/** A registry name without "The" or its trailing "N.A.", "Company", "Inc."... ("heartland bank and trust"). */
function baseName(name: string | null | undefined): string {
  let base = ownerWords(name).replace(/^the /, "");
  while (BASE_NAME_SUFFIX.test(base)) base = base.replace(BASE_NAME_SUFFIX, "");
  return base;
}

/** The brand without "Federal Credit Union", "Credit Union", "FCU" or "Bank" ("healthplus"). */
function brandOf(name: string | null | undefined): string {
  return baseName(name).replace(/ (federal credit union|credit union|fcu|bank)$/, "");
}

/**
 * The forms of a name the text may use, each two words or more: the name without "The" or
 * "N.A.", the "credit union" and "FCU" short forms, Saint/St, the brand when it is two words or
 * more ("horizons north"), and a one-word brand only next to the institution's city
 * ("fort pierre timberline", "timberline fort pierre"). Generic forms are dropped.
 */
export function ownerNameForms(name: string | null | undefined, city?: string | null): string[] {
  const base = baseName(name);
  const brand = brandOf(name);
  const forms = [
    base,
    base.replace(/ federal credit union$/, " credit union"),
    base.replace(/ federal credit union$/, " fcu"),
    base.replace(/^saint /, "st "),
    base.replace(/^st /, "saint "),
  ];
  if (brand !== base) {
    if (brand.includes(" ")) forms.push(brand);
    else {
      const town = ownerWords(city);
      if (town.length >= MIN_CITY_CHARS && brand.length > 0 && !GENERIC_NAMES.has(brand)) forms.push(`${town} ${brand}`, `${brand} ${town}`);
    }
  }
  return [...new Set(forms)].filter((form) => form.length >= MIN_NAME_CHARS && form.includes(" ") && !GENERIC_NAMES.has(form));
}

/** Words of a name its acronym skips. */
const TITLE_SMALL_WORDS = new Set(["of", "the", "and", "for", "at", "in", "&"]);

/**
 * A credit union's acronyms, four letters or more: "St. Mary's Federal Credit Union" is "smfcu"
 * and "smcu". Read only for linked institutions and this bank, never registry-wide.
 */
export function creditUnionAcronyms(name: string | null | undefined): string[] {
  const base = baseName(name);
  if (!/ credit union$/.test(base)) return [];
  const words = base.split(" ").filter((word) => !TITLE_SMALL_WORDS.has(word));
  const full = words.map((word) => word[0]).join("");
  const short = words.filter((word) => word !== "federal").map((word) => word[0]).join("");
  return [...new Set([full, short])].filter((acronym) => acronym.length >= MIN_ACRONYM_CHARS && !GENERIC_NAMES.has(acronym));
}

/** Do two name lists overlap as whole words either way ("capital city bank" in "capital city bank group")? */
function namesOverlap(a: string[], b: string[]): boolean {
  return a.some((x) => b.some((y) => hasWords(` ${x} `, y) || hasWords(` ${y} `, x)));
}

const HOLDING_SUFFIXES = new Set(["inc", "corp", "corporation", "co", "company", "incorporated", "ltd", "llc"]);

/** A holding-company name as compared: "Wells Fargo & Company" and "WELLS FARGO & CO." are "wells fargo". */
export function holdingCompanyKey(name: string | null | undefined): string {
  const words = ownerWords(name).split(" ").filter((word) => word && word !== "and");
  while (words.length > 1 && HOLDING_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/** Same holding company: the same RSSD, or the same holding-company name. */
export function sameHoldingCompany(a: OwnerBank, b: OwnerBank): boolean {
  const rssd = (value: string | null | undefined) => {
    const trimmed = (value ?? "").trim().replace(/^0+/, "");
    return trimmed.length > 0 ? trimmed : null;
  };
  const ra = rssd(a.holdingCompanyRssd);
  if (ra && ra === rssd(b.holdingCompanyRssd)) return true;
  const na = holdingCompanyKey(a.holdingCompanyName);
  return na.length > 0 && na === holdingCompanyKey(b.holdingCompanyName);
}

function cityWords(bank: OwnerBank): string {
  const city = ownerWords(bank.city);
  return city.length >= MIN_CITY_CHARS ? city : "";
}

/** "fort pierre sd" or "fort pierre south dakota": the city with its state right after it. */
function namesCityAndState(padded: string, bank: OwnerBank): boolean {
  const city = cityWords(bank);
  const code = (bank.stateCode ?? "").trim().toUpperCase();
  if (!city || !code) return false;
  const stateName = ownerWords(STATE_NAMES[code]);
  return hasWords(padded, `${city} ${code.toLowerCase()}`) || (stateName.length > 0 && hasWords(padded, `${city} ${stateName}`));
}

/** Does the lower-case text print this host as a whole token ("hncu.org")? */
function printsHost(lowerText: string, host: string | null | undefined): boolean {
  if (!host) return false;
  return new RegExp(`(^|[^a-z0-9-])${host.replace(/[.]/g, "\\.")}($|[^a-z0-9-])`).test(lowerText);
}

/** The registry's names, indexed by each form's first two words for a whole-word scan of a text. */
export interface NameDirectory {
  banks: Map<number, OwnerBank>;
  forms: Array<{ id: number; form: string }>;
  byFirstPair: Map<string, Array<{ id: number; words: string[] }>>;
}

export function buildNameDirectory(banks: OwnerBank[]): NameDirectory {
  const forms = banks.flatMap((bank) => ownerNameForms(bank.name, bank.city).map((form) => ({ id: bank.id, form })));
  const byFirstPair = new Map<string, Array<{ id: number; words: string[] }>>();
  for (const entry of forms) {
    const words = entry.form.split(" ");
    const key = `${words[0]} ${words[1]}`;
    const list = byFirstPair.get(key);
    if (list) list.push({ id: entry.id, words });
    else byFirstPair.set(key, [{ id: entry.id, words }]);
  }
  return { banks: new Map(banks.map((bank) => [bank.id, bank])), forms, byFirstPair };
}

/** Pure: the ids among `ids` whose name (any form) appears as whole words in another institution's name form. */
export function sharedNameIds(directory: NameDirectory, ids: Iterable<number>): Set<number> {
  const shared = new Set<number>();
  for (const id of ids) {
    const bank = directory.banks.get(id);
    if (!bank) continue;
    const forms = ownerNameForms(bank.name, bank.city);
    if (directory.forms.some((entry) => entry.id !== id && forms.some((form) => hasWords(` ${entry.form} `, form)))) shared.add(id);
  }
  return shared;
}

/**
 * Pure: the institutions in `directory` whose name (any form) the text prints as whole words.
 * One pass over the text: a form is compared only where its first two words stand together.
 */
export function institutionsNamedIn(text: string | null | undefined, directory: NameDirectory): number[] {
  const words = ownerWords(text).split(" ").filter(Boolean);
  const ids = new Set<number>();
  for (let index = 0; index + 1 < words.length; index += 1) {
    const entries = directory.byFirstPair.get(`${words[index]} ${words[index + 1]}`);
    if (!entries) continue;
    for (const entry of entries) {
      if (ids.has(entry.id) || index + entry.words.length > words.length) continue;
      if (entry.words.every((word, offset) => words[index + offset] === word)) ids.add(entry.id);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

/** Non-empty lines of a document's top that the header rule reads. */
export const HEADER_LINES = 10;

/**
 * An institution's full legal name as the header rule reads it: its registry name without "The" or
 * "N.A.", two words or more, with "bank" or "credit union" in it ("horizons north credit union",
 * "bank of america"). Null for a name that does not qualify ("Popular", "Discover").
 */
export function legalBankName(name: string | null | undefined): string | null {
  const base = baseName(name);
  if (base.split(" ").length < 2 || !/(^| )(bank|credit union)( |$)/.test(base)) return null;
  return base;
}

/** A line with apostrophes dropped and other punctuation a space, case kept. */
function caseWords(line: string): string {
  return line.replace(/['’‘`]/g, "").replace(/&/g, " and ").replace(/[^A-Za-z0-9]+/g, " ").trim();
}

/**
 * The header rule (#1455 review), read for linked institutions only: one of the document's
 * first `HEADER_LINES` non-empty lines starts with the institution's full legal name
 * (`legalBankName`), printed as a title (every word capitalised but "of", "the", "and"...), and no
 * other institution has that name. A registry-only
 * institution is never read with it: a correspondent's title line ("Wells Fargo Bank", "Bank of
 * America ATM Fees") is common on a bank's own schedule.
 */
export function headerNamesInstitution(text: string | null | undefined, name: string | null | undefined): boolean {
  const legal = legalBankName(name);
  if (!legal || !text) return false;
  const lines = text.split(/\r?\n/).map(caseWords).filter(Boolean).slice(0, HEADER_LINES);
  return lines.some((line) => {
    if (!`${line.toLowerCase()} `.startsWith(`${legal} `)) return false;
    return line.slice(0, legal.length).split(" ").every((word) => TITLE_SMALL_WORDS.has(word) || /^[A-Z0-9&]/.test(word));
  });
}

/**
 * Which of `group` (this bank first, then the text-hash sharers) owns a vendor-served copy: the
 * one whose name form (a one-word brand only next to "credit union", "bank", "fcu" or its city)
 * or acronym the text prints. A bare one-word brand never counts: a hash sharer "Access Credit
 * Union" is not named by "ATM access fee". A sharer's form or acronym counts only when it neither
 * contains nor sits inside one of this bank's own forms ("first community bank" is in "first
 * community bank of tennessee"). With `onOwnSite`, a sharer owns the copy only when its name is
 * its own: not shared with another institution, or printed with its city. Null unless exactly
 * one qualifies.
 */
export function vendorCopyOwner(text: string, group: OwnerBank[], options: { onOwnSite?: boolean } = {}): OwnerBank | null {
  const padded = ` ${ownerWords(text)} `;
  const [own] = group;
  if (!own) return null;
  const ownForms = ownerNameForms(own.name, own.city);
  const ownAcronyms = creditUnionAcronyms(own.name);
  const ownCity = cityWords(own);
  const strict = group.filter((bank, index) => {
    const forms = ownerNameForms(bank.name, bank.city);
    const acronyms = creditUnionAcronyms(bank.name);
    if (index === 0) return forms.some((form) => hasWords(padded, form)) || acronyms.some((acronym) => hasWords(padded, acronym));
    return forms.some((form) => !namesOverlap([form], ownForms) && hasWords(padded, form))
      || acronyms.some((acronym) => !ownAcronyms.includes(acronym) && hasWords(padded, acronym));
  });
  if (strict.length !== 1) return null;
  const owner = strict[0];
  if (owner.id !== own.id && options.onOwnSite && owner.nameShared) {
    const city = cityWords(owner);
    if (!(city && city !== ownCity && hasWords(padded, city))) return null;
  }
  return owner;
}

/**
 * The registrable domain of a host: its last two labels, or last three when the second-to-last
 * is a two- or three-letter public suffix under a two-letter country ("bank.co.uk", "cu.com.au").
 */
export function registrableDomain(host: string): string {
  const labels = host.split(".");
  const last = labels[labels.length - 1] ?? "";
  const second = labels[labels.length - 2] ?? "";
  const keep = labels.length >= 3 && last.length === 2 && second.length >= 2 && second.length <= 3 ? 3 : 2;
  return labels.slice(-keep).join(".");
}

/**
 * Is the document on this bank's own site: the stored host, a subdomain of it, its parent, or
 * another host under the same registrable domain ("acmebank.com" for "home.acmebank.com")?
 */
export function onWebsiteHost(documentHost: string | null | undefined, websiteHost: string | null | undefined): boolean {
  if (!documentHost || !websiteHost) return false;
  return documentHost === websiteHost
    || documentHost.endsWith(`.${websiteHost}`)
    || websiteHost.endsWith(`.${documentHost}`)
    || registrableDomain(documentHost) === registrableDomain(websiteHost);
}

/**
 * Pure: which bank does this document's text name? `own` is the institution the fees are filed
 * under; `linked` the institutions it shares the document with (by host, address or text hash);
 * `found` those the registry scan found named (`institutionsNamedIn`), which only ever give
 * `registry_named`; `links` how the linked ones share it. Order: see the module note.
 */
export function documentOwnerVerdict(
  text: string | null | undefined,
  own: OwnerBank,
  linked: OwnerBank[],
  found: OwnerBank[] = [],
  links: DocumentLinks = {},
): DocumentOwnerVerdict {
  if (!text || !text.trim()) return { kind: "no_text" };
  const padded = ` ${ownerWords(text)} `;
  const lower = text.toLowerCase();
  const pool = [...new Map(linked.filter((other) => other.id !== own.id).map((other) => [other.id, other])).values()];
  const poolIds = new Set(pool.map((other) => other.id));
  const siblings = pool.filter((other) => sameHoldingCompany(own, other));
  const unrelated = pool.filter((other) => !sameHoldingCompany(own, other));

  // Every institution the document is shared with is a sibling charter (#1441).
  if (pool.length > 0 && unrelated.length === 0) return { kind: "sibling_shared", siblingIds: siblings.map((other) => other.id) };

  // This bank: a name form or acronym no linked institution shares, its website (when the
  // document is not on that host), its city (with its state when a linked one has the same
  // city), or its certificate / charter number.
  const ownForms = ownerNameForms(own.name, own.city);
  const ownAcronyms = creditUnionAcronyms(own.name);
  const formsOf = new Map(pool.map((other) => [other.id, ownerNameForms(other.name, other.city)] as const));
  const acronymsOf = new Map(pool.map((other) => [other.id, creditUnionAcronyms(other.name)] as const));
  const ownDistinct = ownForms.filter((form) => !pool.some((other) => namesOverlap([form], formsOf.get(other.id)!)));
  const ownName = ownDistinct.find((form) => hasWords(padded, form));
  if (ownName) return { kind: "own_named", evidence: `name: ${ownName}` };
  const ownAcronym = ownAcronyms.find((acronym) => !pool.some((other) => acronymsOf.get(other.id)!.includes(acronym)) && hasWords(padded, acronym));
  if (ownAcronym) return { kind: "own_named", evidence: `acronym: ${ownAcronym}` };
  const onOwnSite = onWebsiteHost(links.documentHost, own.websiteHost);
  if (own.websiteHost && !onOwnSite && printsHost(lower, own.websiteHost)) {
    return { kind: "own_named", evidence: `website: ${own.websiteHost}` };
  }
  const ownCity = cityWords(own);
  if (ownCity) {
    const cityShared = pool.some((other) => cityWords(other) === ownCity);
    if (cityShared ? namesCityAndState(padded, own) : hasWords(padded, ownCity)) return { kind: "own_named", evidence: `city: ${ownCity}` };
  }
  if (textHasCertNumber(lower.replace(/\s+/g, " "), own.certNumber)) {
    return { kind: "own_named", evidence: `certificate: ${own.certNumber}` };
  }

  // A vendor-served copy belongs to whichever of this bank and the text-hash sharers it names.
  const hashIds = new Set(links.hashIds ?? []);
  if (links.vendorPath && pool.some((other) => hashIds.has(other.id))) {
    const owner = vendorCopyOwner(text, [own, ...pool.filter((other) => hashIds.has(other.id))], { onOwnSite });
    if (owner?.id === own.id) return { kind: "own_named", evidence: "vendor copy: own name" };
    if (owner && !sameHoldingCompany(own, owner)) return { kind: "other_bank", otherId: owner.id, evidence: "vendor copy: text hash" };
  }

  // The document sits on exactly one unrelated institution's own website, and not on this bank's
  // (a bank with no stored website never gets this rule: the other's seeded host is no evidence).
  const hostIds = new Set(links.hostIds ?? []);
  if (links.documentHost && own.websiteHost && !onOwnSite) {
    const hosts = unrelated.filter((other) => hostIds.has(other.id) && other.websiteHost === links.documentHost);
    if (hosts.length === 1) return { kind: "other_bank", otherId: hosts[0].id, evidence: `site: ${links.documentHost}` };
  }

  // Strong evidence (a name form of two words or more, or the header rule) before weak (a CU
  // acronym, or its city with its state).
  const named = (other: OwnerBank): { evidence: string; strong: boolean } | null => {
    const forms = formsOf.get(other.id)!.filter((form) => !namesOverlap([form], ownForms));
    const name = forms.find((form) => hasWords(padded, form));
    const otherCity = cityWords(other);
    const cityHere = otherCity.length > 0 && otherCity !== ownCity && hasWords(padded, otherCity);
    if (name && (!other.nameShared || cityHere)) return { evidence: `name: ${name}`, strong: true };
    const legal = legalBankName(other.name);
    if (legal && !other.nameShared && !namesOverlap([legal], ownForms) && headerNamesInstitution(text, other.name)) {
      return { evidence: `header: ${legal}`, strong: true };
    }
    const acronym = acronymsOf.get(other.id)!.find((value) => !ownAcronyms.includes(value) && hasWords(padded, value));
    if (acronym) return { evidence: `acronym: ${acronym}`, strong: false };
    if (otherCity && otherCity !== ownCity && namesCityAndState(padded, other)) {
      return { evidence: `city: ${otherCity} ${(other.stateCode ?? "").toLowerCase()}`, strong: false };
    }
    return null;
  };
  const hits = unrelated.flatMap((other) => {
    const match = named(other);
    return match ? [{ id: other.id, ...match }] : [];
  });
  // A schedule a holding company's charters share is theirs to share (#1441), whatever it names.
  if (siblings.length > 0 && (hits.length === 0 || siblings.some((other) => named(other)))) {
    return { kind: "sibling_shared", siblingIds: siblings.map((other) => other.id) };
  }
  // An institution that shares the document only by address or text hash (not by stored website)
  // is proof the file is another bank's only by its full name or the header rule, and never on
  // this bank's own site: name variants this bank's forms miss ("HBT Bank" for Heartland Bank and
  // Trust) must not hand its own schedule away on a branch city or an acronym.
  const capped = hits.length === 1 && !hostIds.has(hits[0].id) && (onOwnSite || !hits[0].strong);
  if (hits.length === 1 && !capped) return { kind: "other_bank", otherId: hits[0].id, evidence: hits[0].evidence };
  if (hits.length > 0) return { kind: "shared_service", otherIds: hits.map((hit) => hit.id) };
  const mentioned = found.filter((other) => other.id !== own.id && !poolIds.has(other.id) && !sameHoldingCompany(own, other));
  if (mentioned.length > 0) return { kind: "registry_named", otherIds: mentioned.map((other) => other.id) };
  return { kind: "unproven" };
}

/**
 * The live (institution, document) pairs in doubt: linked to another institution (the
 * document's host is its stored website, it has live fees from the same address, or one of its
 * documents has the same text hash), or on a vendor download path. Read-only. Hosts, addresses
 * and hashes are worked out once per table and joined by equality; every CTE is materialized.
 */
function scopedPairsSql(): string {
  return `
    WITH live AS MATERIALIZED (
      SELECT fp.fee_published_id, fp.institution_id, fr.source_document_id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fr.source_document_id IS NOT NULL
    ),
    pairs AS MATERIALIZED (
      SELECT institution_id, source_document_id, count(DISTINCT fee_published_id)::int AS live_fees
        FROM live
       GROUP BY institution_id, source_document_id
    ),
    placed AS MATERIALIZED (
      SELECT p.*, btrim(sd.document_url) AS document_url, ${hostSql("sd.document_url")} AS host
        FROM pairs p
        JOIN source_documents sd ON sd.id = p.source_document_id
       WHERE sd.document_url IS NOT NULL
    ),
    sites AS MATERIALIZED (
      SELECT i.id, ${hostSql("i.website_url")} AS host
        FROM institution_sources i
       WHERE i.website_url IS NOT NULL
    ),
    -- The text row the pass judges (\`loadSourceTexts\`: newest completed row with text), so the
    -- fingerprint's hash and the judged text are one row's.
    hashes AS MATERIALIZED (
      SELECT DISTINCT ON (t.source_document_id) t.source_document_id, t.text_hash, t.char_count
        FROM agent_source_texts t
       WHERE t.source_document_id IN (SELECT source_document_id FROM pairs)
         AND t.status = 'completed' AND t.normalized_text IS NOT NULL
       ORDER BY t.source_document_id, t.id DESC
    ),
    -- Hashes that link institutions: real texts (${HASH_LINK_MIN_CHARS}+ characters) shared by at most
    -- ${HASH_LINK_MAX_DOCUMENTS} documents. An empty or "Access Denied" page shares one hash with thousands.
    hash_groups AS MATERIALIZED (
      SELECT t.text_hash, array_agg(DISTINCT t.institution_id) AS institution_ids
        FROM agent_source_texts t
       WHERE t.text_hash IN (SELECT text_hash FROM hashes WHERE char_count >= ${HASH_LINK_MIN_CHARS})
         AND t.status = 'completed' AND t.char_count >= ${HASH_LINK_MIN_CHARS}
       GROUP BY t.text_hash
      HAVING count(DISTINCT t.source_document_id) <= ${HASH_LINK_MAX_DOCUMENTS}
    ),
    links AS MATERIALIZED (
      SELECT p.institution_id, p.source_document_id, s.id AS other_id, 'host' AS via
        FROM placed p JOIN sites s ON s.host = p.host AND s.id <> p.institution_id
      UNION
      SELECT p.institution_id, p.source_document_id, q.institution_id AS other_id, 'url' AS via
        FROM placed p JOIN placed q ON q.document_url = p.document_url AND q.institution_id <> p.institution_id
      UNION
      SELECT p.institution_id, p.source_document_id, g.other_id, 'hash' AS via
        FROM placed p
        JOIN hashes h ON h.source_document_id = p.source_document_id
        JOIN hash_groups hg ON hg.text_hash = h.text_hash
        CROSS JOIN LATERAL unnest(hg.institution_ids) AS g(other_id)
       WHERE g.other_id <> p.institution_id
    ),
    shared AS MATERIALIZED (
      SELECT p.institution_id, p.source_document_id, p.document_url, p.host AS document_host, p.live_fees,
             COALESCE(h.text_hash, 'none') AS text_hash,
             (p.document_url ~* '${VENDOR_DOCUMENT_PATH}') AS vendor_path,
             COALESCE(array_agg(DISTINCT l.other_id ORDER BY l.other_id) FILTER (WHERE l.other_id IS NOT NULL), '{}'::bigint[]) AS other_ids,
             COALESCE(array_agg(DISTINCT l.other_id ORDER BY l.other_id) FILTER (WHERE l.via = 'host'), '{}'::bigint[]) AS host_ids,
             COALESCE(array_agg(DISTINCT l.other_id ORDER BY l.other_id) FILTER (WHERE l.via = 'hash'), '{}'::bigint[]) AS hash_ids
        FROM placed p
        LEFT JOIN hashes h ON h.source_document_id = p.source_document_id
        LEFT JOIN links l ON l.institution_id = p.institution_id AND l.source_document_id = p.source_document_id
       GROUP BY p.institution_id, p.source_document_id, p.document_url, p.host, p.live_fees, h.text_hash
      HAVING count(l.other_id) > 0 OR p.document_url ~* '${VENDOR_DOCUMENT_PATH}'
    )`;
}

/**
 * The attempt fingerprint of one pair: its institution, document and the document's current text
 * hash, so a re-extracted text is read again. Shadow reads are kept apart so the switch re-reads them.
 */
export function documentOwnerFingerprint(institutionId: number, sourceDocumentId: number, textHash: string | null, live: boolean): string {
  return `${documentOwnerFingerprintPrefix(live)}${institutionId}:${sourceDocumentId}:${textHash ?? "none"}`;
}

export function documentOwnerFingerprintPrefix(live: boolean): string {
  return `owner${live ? "" : "-shadow"}:`;
}

/**
 * The pairs this step reads, in two legs with their own caps so re-reads never starve new pairs:
 * pairs not yet read under this version, mode and text hash (`$4`), and, with the takedown on,
 * pairs last read as `other_bank` and never passed, read again so the second look can confirm
 * them (`$5`, 0 in shadow). `$1` fingerprint prefix, `$2` strategy, `$3` version.
 */
export function documentOwnerPairsSql(): string {
  const fingerprint = "$1 || s.institution_id::text || ':' || s.source_document_id::text || ':' || s.text_hash";
  const attempts = (extra: string) => `SELECT 1 FROM pipeline_attempts pa
        WHERE pa.input_fingerprint = ${fingerprint}
          AND pa.strategy = $2
          AND pa.strategy_version = $3${extra}`;
  const columns = "s.institution_id, s.source_document_id, s.document_url, s.document_host, s.vendor_path, s.live_fees, s.other_ids, s.host_ids, s.hash_ids, s.text_hash";
  return `${scopedPairsSql()},
    fresh AS (
      SELECT ${columns}, false AS reread
        FROM shared s
       WHERE NOT EXISTS (${attempts("")})
       ORDER BY s.live_fees DESC, s.institution_id, s.source_document_id
       LIMIT $4
    ),
    rereads AS (
      SELECT ${columns}, true AS reread
        FROM shared s
       WHERE EXISTS (${attempts("\n          AND pa.outcome = 'evidence_mismatch'")})
         AND NOT EXISTS (${attempts("\n          AND pa.outcome = 'ok'")})
       ORDER BY s.live_fees DESC, s.institution_id, s.source_document_id
       LIMIT $5
    )
    SELECT * FROM fresh
    UNION ALL
    SELECT * FROM rereads`;
}

/** SQL form of `ownerWords`. */
function wordsSql(expr: string): string {
  return `btrim(regexp_replace(replace(regexp_replace(lower(COALESCE(${expr}, '')), '[''’‘\`]', '', 'g'), '&', ' and '), '[^a-z0-9]+', ' ', 'g'))`;
}
function sqlList(values: Iterable<string>): string {
  return [...values].map((value) => `'${value.replace(/'/g, "''")}'`).join(", ");
}

/**
 * Read-only SQL for James: the live fees the document-owner check would take down, the passes
 * by verdict, and the sibling-shared documents counted once (#1441). Every live fee is counted
 * once. It mirrors `documentOwnerVerdict` with one difference: it does not read the FDIC
 * certificate / NCUA number, so its `other_bank` count is an upper bound of the pass's. Every CTE
 * is materialized; the registry scan compares a name only where its first two words stand
 * together in the text, and shared names join on word sequences. `detail` lists each
 * (institution, document) pair instead of the totals.
 */
export function documentOwnerCountSql(options: { detail?: boolean } = {}): string {
  const states = Object.entries(STATE_NAMES).map(([code, name]) => `('${code}', '${ownerWords(name)}')`).join(", ");
  const generic = sqlList(GENERIC_NAMES);
  const small = sqlList(TITLE_SMALL_WORDS);
  const has = (padded: string, words: string) => `(length(${words}) > 0 AND strpos(${padded}, ' ' || ${words} || ' ') > 0)`;
  const overlap = (a: string, b: string) =>
    `EXISTS (SELECT 1 FROM unnest(${a}) x, unnest(${b}) y WHERE strpos(' ' || x || ' ', ' ' || y || ' ') > 0 OR strpos(' ' || y || ' ', ' ' || x || ' ') > 0)`;
  const cityState = (padded: string, alias: string) =>
    `(length(${alias}.city_w) >= ${MIN_CITY_CHARS} AND (${has(padded, `${alias}.city_w || ' ' || lower(${alias}.state_code)`)} OR ${has(padded, `${alias}.city_w || ' ' || ${alias}.state_w`)}))`;
  const sibling = (a: string, b: string) =>
    `((${a}.hc_rssd <> '' AND ${a}.hc_rssd = ${b}.hc_rssd) OR (${a}.hc_key <> '' AND ${a}.hc_key = ${b}.hc_key))`;
  const printsHostSql = (host: string) =>
    `(${host} <> '' AND EXISTS (SELECT 1 FROM unnest(tx.dotted) d WHERE strpos('.' || d || '.', '.' || ${host} || '.') > 0))`;
  // A linked institution `c` the text names, as `named` in `documentOwnerVerdict` (`j` the pair, `own` its bank).
  // Strong evidence: a name form, or the header rule.
  const otherNamedStrong = `(
      (EXISTS (SELECT 1 FROM unnest(c.forms) f WHERE NOT ${overlap("ARRAY[f]", "own.forms")} AND ${has("tx.padded", "f")})
       AND (NOT c.name_shared OR (c.city_w <> own.city_w AND length(c.city_w) >= ${MIN_CITY_CHARS} AND ${has("tx.padded", "c.city_w")})))
      OR (c.legal IS NOT NULL AND NOT c.name_shared AND NOT ${overlap("ARRAY[c.legal]", "own.forms")}
          AND EXISTS (SELECT 1 FROM headed hd WHERE hd.source_document_id = j.source_document_id AND hd.id = c.id))
    )`;
  // Weak evidence: a CU acronym, or the city with its state.
  const otherNamedWeak = `(
      EXISTS (SELECT 1 FROM unnest(c.acronyms) a WHERE NOT (a = ANY(own.acronyms)) AND ${has("tx.padded", "a")})
      OR (c.city_w <> own.city_w AND ${cityState("tx.padded", "c")})
    )`;
  const strictNamed = (alias: string) =>
    `(EXISTS (SELECT 1 FROM unnest(${alias}.forms) f WHERE ${has("tx.padded", "f")}) OR EXISTS (SELECT 1 FROM unnest(${alias}.acronyms) a WHERE ${has("tx.padded", "a")}))`;
  // Rows of `pool_rows` for this pair (each pair's flags are worked out once, set-wise).
  const poolOf = (where: string) =>
    `(SELECT pr.* FROM pool_rows pr WHERE pr.institution_id = j.institution_id AND pr.source_document_id = j.source_document_id AND ${where})`;
  // The document is on this bank's stored website or a subdomain of it (\`onWebsiteHost\`).
  // \`registrableDomain\` in SQL.
  const registrable = (host: string) =>
    `COALESCE(substring(${host} from '([^.]+[.][^.]{2,3}[.][^.]{2})$'), substring(${host} from '([^.]+[.][^.]+)$'), ${host})`;
  const onOwnSite = `(COALESCE(own.website_host, '') <> '' AND COALESCE(j.document_host, '') <> ''
      AND (j.document_host = own.website_host
           OR right(j.document_host, length(own.website_host) + 1) = '.' || own.website_host
           OR right(own.website_host, length(j.document_host) + 1) = '.' || j.document_host
           OR ${registrable("j.document_host")} = ${registrable("own.website_host")}))`;
  const baseSql = (nameExpr: string) =>
    `regexp_replace(regexp_replace(${wordsSql(nameExpr)}, '^the ', ''), '( (national association|n a|na|ssb|s s b|fsb|f s b|inc|incorporated|company|co|corp|corporation))+$', '')`;
  return `-- Darwin document-owner check (#1455), read-only: live fees on a document whose text names another bank.
-- Run as one script: read-only transaction, rolled back. JIT off: compiling this statement's
-- ~1,000 expressions took 11 s on a 16-row test database. Merge joins off: the planner's guesses for
-- materialized steps are far off, and its merge joins copied every text again to temp files.
BEGIN READ ONLY;
SET LOCAL jit = off;
SET LOCAL enable_mergejoin = off;
SET LOCAL statement_timeout = '120s';
${scopedPairsSql()},
    states(code, state_w) AS (VALUES ${states}),
    names AS MATERIALIZED (
      SELECT i.id, i.state_code, ${baseSql("i.institution_name")} AS base, ${wordsSql("i.city")} AS city_raw,
             ${hostSql("i.website_url")} AS website_host,
             ltrim(btrim(COALESCE(i.holding_company_rssd, '')), '0') AS hc_rssd,
             btrim(regexp_replace(regexp_replace(regexp_replace(${wordsSql("i.holding_company_name")}, '(^| )and( |$)', ' ', 'g'), ' +', ' ', 'g'),
                   '( (inc|corp|corporation|co|company|incorporated|ltd|llc))+$', '')) AS hc_key,
             COALESCE(st.state_w, '') AS state_w
        FROM institution_sources i
        LEFT JOIN states st ON st.code = upper(btrim(COALESCE(i.state_code, '')))
       WHERE i.institution_name IS NOT NULL
    ),
    branded AS MATERIALIZED (
      SELECT n.*, regexp_replace(n.base, ' (federal credit union|credit union|fcu|bank)$', '') AS brand_raw,
             CASE WHEN length(n.city_raw) >= ${MIN_CITY_CHARS} THEN n.city_raw ELSE '' END AS city_w
        FROM names n
    ),
    directory AS MATERIALIZED (
      SELECT DISTINCT b.id, f.form, split_part(f.form, ' ', 1) || ' ' || split_part(f.form, ' ', 2) AS first_pair
        FROM branded b,
        LATERAL unnest(ARRAY[
          b.base,
          regexp_replace(b.base, ' federal credit union$', ' credit union'),
          regexp_replace(b.base, ' federal credit union$', ' fcu'),
          regexp_replace(b.base, '^saint ', 'st '),
          regexp_replace(b.base, '^st ', 'saint '),
          CASE WHEN b.brand_raw <> b.base AND b.brand_raw ~ ' ' THEN b.brand_raw END,
          CASE WHEN b.brand_raw <> b.base AND b.brand_raw !~ ' ' AND b.brand_raw <> '' AND length(b.city_raw) >= ${MIN_CITY_CHARS} AND b.brand_raw NOT IN (${generic})
               THEN b.city_raw || ' ' || b.brand_raw END,
          CASE WHEN b.brand_raw <> b.base AND b.brand_raw !~ ' ' AND b.brand_raw <> '' AND length(b.city_raw) >= ${MIN_CITY_CHARS} AND b.brand_raw NOT IN (${generic})
               THEN b.brand_raw || ' ' || b.city_raw END
        ]) AS f(form)
       WHERE f.form IS NOT NULL AND length(f.form) >= ${MIN_NAME_CHARS} AND f.form ~ ' ' AND f.form NOT IN (${generic})
    ),
    in_play AS MATERIALIZED (
      SELECT institution_id AS id FROM shared UNION SELECT unnest(other_ids) FROM shared
    ),
    sequences AS MATERIALIZED (
      SELECT DISTINCT d.id, array_to_string(w.a[i:k], ' ') AS seq
        FROM directory d,
        LATERAL (SELECT string_to_array(d.form, ' ') AS a) w,
        LATERAL generate_series(1, array_length(w.a, 1)) AS i,
        LATERAL generate_series(i + 1, array_length(w.a, 1)) AS k
    ),
    shared_names AS MATERIALIZED (
      SELECT DISTINCT d.id
        FROM directory d
        JOIN sequences q ON q.seq = d.form AND q.id <> d.id
       WHERE d.id IN (SELECT id FROM in_play)
    ),
    banks AS MATERIALIZED (
      SELECT b.id, b.state_code, b.state_w, b.city_w, b.website_host, b.hc_rssd, b.hc_key,
             COALESCE((SELECT array_agg(d.form) FROM directory d WHERE d.id = b.id), '{}') AS forms,
             CASE WHEN b.base ~ ' credit union$' THEN ARRAY(
               SELECT DISTINCT a FROM unnest(ARRAY[
                 (SELECT string_agg(left(w, 1), '' ORDER BY n) FROM unnest(string_to_array(b.base, ' ')) WITH ORDINALITY AS u(w, n) WHERE w NOT IN (${small})),
                 (SELECT string_agg(left(w, 1), '' ORDER BY n) FROM unnest(string_to_array(b.base, ' ')) WITH ORDINALITY AS u(w, n) WHERE w NOT IN (${small}) AND w <> 'federal')
               ]) a WHERE length(a) >= ${MIN_ACRONYM_CHARS} AND a NOT IN (${generic})) ELSE '{}' END AS acronyms,
             CASE WHEN b.base ~ ' ' AND b.base ~ '(^| )(bank|credit union)( |$)' THEN b.base END AS legal,
             (b.id IN (SELECT id FROM shared_names)) AS name_shared
        FROM branded b
       WHERE b.id IN (SELECT id FROM in_play)
    ),
    -- One copy of each text (the row \`loadSourceTexts\` reads), kept only as what the checks read:
    -- the words, the dotted tokens a printed website can be in, and the first lines for the header rule.
    texts AS MATERIALIZED (
      SELECT l.source_document_id,
             ' ' || ${wordsSql("l.raw")} || ' ' AS padded,
             -- Each run of [a-z0-9.-] with a dot in it: \`printsHost\` holds exactly when one of them,
             -- with a dot added at each end, contains ".<host>.".
             ARRAY(SELECT DISTINCT m[1] FROM regexp_matches(lower(l.raw), '([a-z0-9.-]*[.][a-z0-9.-]*)', 'g') AS m) AS dotted,
             ARRAY(
               SELECT y.line FROM (
                 SELECT btrim(regexp_replace(replace(regexp_replace(u.l, '[''’‘\`]', '', 'g'), '&', ' and '), '[^A-Za-z0-9]+', ' ', 'g')) AS line, u.n
                   FROM unnest(regexp_split_to_array(l.raw, E'\\r?\\n')) WITH ORDINALITY AS u(l, n)
               ) y
                WHERE y.line <> ''
                ORDER BY y.n
                LIMIT ${HEADER_LINES}
             ) AS header
        FROM (
          SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text AS raw
            FROM agent_source_texts
           WHERE source_document_id IN (SELECT source_document_id FROM shared)
             AND status = 'completed' AND normalized_text IS NOT NULL
           ORDER BY source_document_id, id DESC
        ) l
    ),
    first_pairs AS MATERIALIZED (
      SELECT DISTINCT first_pair FROM directory
    ),
    -- Only the word pairs that open a registered name are kept, so this stays small on long documents.
    doc_pairs AS MATERIALIZED (
      SELECT DISTINCT t.source_document_id, x.w || ' ' || x.next_w AS first_pair
        FROM texts t,
        LATERAL (
          SELECT u.w, lead(u.w) OVER (ORDER BY u.n) AS next_w
            FROM regexp_split_to_table(btrim(t.padded), ' ') WITH ORDINALITY AS u(w, n)
        ) x
       WHERE x.next_w IS NOT NULL
         AND x.w || ' ' || x.next_w IN (SELECT first_pair FROM first_pairs)
    ),
    candidates AS MATERIALIZED (
      SELECT DISTINCT p.source_document_id, d.id, d.form
        FROM doc_pairs p
        JOIN directory d ON d.first_pair = p.first_pair
    ),
    found AS MATERIALIZED (
      SELECT DISTINCT c.source_document_id, c.id
        FROM candidates c
        JOIN texts t ON t.source_document_id = c.source_document_id
       WHERE strpos(t.padded, ' ' || c.form || ' ') > 0
    ),
    header_lines AS MATERIALIZED (
      SELECT t.source_document_id, x.line
        FROM texts t, unnest(t.header) AS x(line)
    ),
    headed AS MATERIALIZED (
      SELECT DISTINCT h.source_document_id, b.id
        FROM header_lines h
        JOIN shared s ON s.source_document_id = h.source_document_id
        JOIN banks b ON b.id = ANY(s.other_ids) AND b.legal IS NOT NULL
       WHERE left(lower(h.line) || ' ', length(b.legal) + 1) = b.legal || ' '
         AND NOT EXISTS (
           SELECT 1 FROM regexp_split_to_table(left(h.line, length(b.legal)), ' ') AS w(word)
            WHERE w.word NOT IN (${small}) AND w.word !~ '^[A-Z0-9]'
         )
    ),
    judged0 AS MATERIALIZED (
      SELECT s.*, (t.padded IS NOT NULL AND btrim(t.padded) <> '') AS has_text
        FROM shared s
        LEFT JOIN texts t ON t.source_document_id = s.source_document_id
    ),
    -- One row per pair and linked institution, with every flag the verdict reads, worked out once.
    pool_rows AS MATERIALIZED (
      SELECT j.institution_id, j.source_document_id, c.id, c.forms, c.acronyms,
             ${sibling("own", "c")} AS sib,
             (c.city_w <> '' AND c.city_w = own.city_w) AS same_city,
             (c.id = ANY(j.hash_ids)) AS via_hash,
             (c.id = ANY(j.host_ids)) AS via_host,
             (c.id = ANY(j.host_ids) AND c.website_host = j.document_host) AS site,
             (tx.padded IS NOT NULL AND ${otherNamedStrong}) AS named_strong,
             (tx.padded IS NOT NULL AND (${otherNamedStrong} OR ${otherNamedWeak})) AS named,
             (tx.padded IS NOT NULL AND (
               EXISTS (SELECT 1 FROM unnest(c.forms) f WHERE NOT ${overlap("ARRAY[f]", "own.forms")} AND ${has("tx.padded", "f")})
               OR EXISTS (SELECT 1 FROM unnest(c.acronyms) a WHERE NOT (a = ANY(own.acronyms)) AND ${has("tx.padded", "a")}))) AS strict,
             -- On this bank's own site a sharer owns a vendor copy only by a name of its own.
             (NOT c.name_shared OR (c.city_w <> '' AND c.city_w <> own.city_w AND ${has("tx.padded", "c.city_w")})) AS own_name
        FROM judged0 j
        LEFT JOIN texts tx ON tx.source_document_id = j.source_document_id
        JOIN banks own ON own.id = j.institution_id
        JOIN LATERAL unnest(j.other_ids) AS o(id) ON true
        JOIN banks c ON c.id = o.id AND c.id <> j.institution_id
    ),
    own_flags AS MATERIALIZED (
      SELECT j.institution_id, j.source_document_id,
             EXISTS (SELECT 1 FROM unnest(own.forms) f WHERE ${has("tx.padded", "f")}
                       AND NOT EXISTS (SELECT 1 FROM ${poolOf(overlap("ARRAY[f]", "pr.forms"))} c)) AS name_distinct,
             EXISTS (SELECT 1 FROM unnest(own.acronyms) a WHERE ${has("tx.padded", "a")}
                       AND NOT EXISTS (SELECT 1 FROM ${poolOf("a = ANY(pr.acronyms)")} c)) AS acronym_distinct,
             (NOT ${onOwnSite} AND ${printsHostSql("COALESCE(own.website_host, '')")}) AS website,
             (length(own.city_w) >= ${MIN_CITY_CHARS} AND (
                CASE WHEN EXISTS (SELECT 1 FROM ${poolOf("pr.same_city")} c)
                     THEN ${cityState("tx.padded", "own")}
                     ELSE ${has("tx.padded", "own.city_w")} END)) AS city,
             ${strictNamed("own")} AS strict,
             ${onOwnSite} AS on_own_site
        FROM judged0 j
        JOIN texts tx ON tx.source_document_id = j.source_document_id
        JOIN banks own ON own.id = j.institution_id
       WHERE j.has_text
    ),
    pool_agg AS MATERIALIZED (
      SELECT institution_id, source_document_id,
             count(*) AS linked,
             count(*) FILTER (WHERE NOT sib) AS unrelated,
             count(*) FILTER (WHERE sib) AS siblings,
             bool_or(sib AND named) AS sibling_named,
             count(*) FILTER (WHERE NOT sib AND named) AS hits,
             min(id) FILTER (WHERE NOT sib AND named) AS hit_id,
             bool_or(via_host) FILTER (WHERE NOT sib AND named) AS hit_via_host,
             bool_or(named_strong) FILTER (WHERE NOT sib AND named) AS hit_strong,
             count(*) FILTER (WHERE NOT sib AND site) AS sites,
             min(id) FILTER (WHERE NOT sib AND site) AS site_id,
             count(*) FILTER (WHERE via_hash) AS hash_linked,
             count(*) FILTER (WHERE via_hash AND strict) AS hash_strict,
             min(id) FILTER (WHERE via_hash AND strict) AS hash_strict_id,
             bool_or(own_name) FILTER (WHERE via_hash AND strict) AS hash_strict_own_name
        FROM pool_rows
       GROUP BY institution_id, source_document_id
    ),
    vendor AS MATERIALIZED (
      SELECT j.institution_id, j.source_document_id,
             CASE
               WHEN f.strict::int + a.hash_strict = 1 THEN CASE
                 WHEN f.strict THEN j.institution_id
                 WHEN NOT f.on_own_site OR a.hash_strict_own_name THEN a.hash_strict_id END
             END AS owner_id
        FROM judged0 j
        JOIN own_flags f ON f.institution_id = j.institution_id AND f.source_document_id = j.source_document_id
        JOIN pool_agg a ON a.institution_id = j.institution_id AND a.source_document_id = j.source_document_id
       WHERE j.vendor_path AND a.hash_linked > 0
    ),
    registry_pairs AS MATERIALIZED (
      SELECT DISTINCT s.institution_id, s.source_document_id
        FROM shared s
        JOIN found f ON f.source_document_id = s.source_document_id AND f.id <> s.institution_id AND NOT (f.id = ANY(s.other_ids))
        JOIN names r ON r.id = f.id
        JOIN names o ON o.id = s.institution_id
       WHERE NOT ${sibling("o", "r")}
    ),
    judged AS MATERIALIZED (
      SELECT j.institution_id, j.source_document_id, j.document_url, j.live_fees, j.other_ids, x.verdict,
             CASE WHEN x.verdict = 'other_bank' THEN x.named_other_id END AS named_other_id
        FROM judged0 j
        LEFT JOIN own_flags f ON f.institution_id = j.institution_id AND f.source_document_id = j.source_document_id
        LEFT JOIN pool_agg a ON a.institution_id = j.institution_id AND a.source_document_id = j.source_document_id
        LEFT JOIN vendor v ON v.institution_id = j.institution_id AND v.source_document_id = j.source_document_id
        LEFT JOIN banks vo ON vo.id = v.owner_id
        LEFT JOIN banks own ON own.id = j.institution_id
        CROSS JOIN LATERAL (
          SELECT CASE
                   WHEN NOT j.has_text THEN 'no_text'
                   WHEN COALESCE(a.linked, 0) > 0 AND a.unrelated = 0 THEN 'sibling_shared'
                   WHEN f.name_distinct OR f.acronym_distinct OR f.website OR f.city THEN 'own_named'
                   WHEN v.owner_id = j.institution_id THEN 'own_named'
                   WHEN v.owner_id IS NOT NULL AND NOT ${sibling("own", "vo")} THEN 'other_bank'
                   WHEN COALESCE(own.website_host, '') <> '' AND NOT f.on_own_site AND COALESCE(a.sites, 0) = 1 THEN 'other_bank'
                   WHEN COALESCE(a.siblings, 0) > 0 AND (a.hits = 0 OR a.sibling_named) THEN 'sibling_shared'
                   WHEN COALESCE(a.hits, 0) = 1 AND (a.hit_via_host OR (NOT f.on_own_site AND a.hit_strong)) THEN 'other_bank'
                   WHEN COALESCE(a.hits, 0) >= 1 THEN 'shared_service'
                   WHEN EXISTS (SELECT 1 FROM registry_pairs r WHERE r.institution_id = j.institution_id AND r.source_document_id = j.source_document_id)
                     THEN 'registry_named'
                   ELSE 'unproven'
                 END AS verdict,
                 CASE
                   WHEN v.owner_id IS NOT NULL AND v.owner_id <> j.institution_id AND NOT ${sibling("own", "vo")} THEN v.owner_id
                   WHEN COALESCE(own.website_host, '') <> '' AND NOT f.on_own_site AND COALESCE(a.sites, 0) = 1 THEN a.site_id
                   ELSE a.hit_id
                 END AS named_other_id
        ) x
    )
${options.detail
    ? `SELECT j.verdict, j.institution_id, i.institution_name, j.source_document_id, j.document_url, j.live_fees,
          j.other_ids, j.named_other_id, o.institution_name AS named_other_name
     FROM judged j
     JOIN institution_sources i ON i.id = j.institution_id
     LEFT JOIN institution_sources o ON o.id = j.named_other_id
    ORDER BY (j.verdict = 'other_bank') DESC, j.live_fees DESC, j.institution_id, j.source_document_id`
    : `SELECT verdict,
          count(DISTINCT live.fee_published_id) AS live_fees,
          count(DISTINCT (j.institution_id, j.source_document_id)) AS pairs,
          count(DISTINCT j.institution_id) AS institutions,
          count(DISTINCT j.source_document_id) AS documents
     FROM judged j
     JOIN live ON live.institution_id = j.institution_id AND live.source_document_id = j.source_document_id
    GROUP BY verdict
    ORDER BY verdict`};
ROLLBACK;
`;
}

interface PairRow {
  institution_id: number | string;
  source_document_id: number | string;
  document_url: string | null;
  live_fees: number | string;
  other_ids: Array<number | string> | null;
  host_ids: Array<number | string> | null;
  hash_ids: Array<number | string> | null;
  document_host: string | null;
  vendor_path: boolean | null;
  text_hash: string | null;
  reread: boolean | null;
}

interface BankRow {
  id: number | string;
  institution_name: string | null;
  city: string | null;
  state_code: string | null;
  cert_number: string | null;
  holding_company_rssd: string | null;
  holding_company_name: string | null;
  website_url: string | null;
}

export interface DocumentOwnerFee {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  sourceDocumentId: number;
  otherInstitutionId: number;
  reason: string;
}

export interface DocumentOwnerResult {
  live: boolean;
  /**
   * True when the step skipped the read: the last read selected no pair and nothing new has arrived
   * since, or the last read was less than `DOCUMENT_OWNER_SCAN_INTERVAL_HOURS` ago.
   */
  skipped: boolean;
  /** Pairs the step selected; the skip keys on this, not on `pairs`. */
  selected: number;
  /** Pairs judged (a selected pair whose bank has no registry row is recorded `unproven`, not judged). */
  pairs: number;
  /** Of `pairs`, `other_bank` pairs read again for their second look (takedown on only). */
  rereads: number;
  verdicts: Partial<Record<DocumentOwnerVerdict["kind"], number>>;
  /** Documents a holding company's charters share (#1441), each counted once; never taken down. */
  siblingSharedDocuments: number;
  /** Live fees on `other_bank` pairs: what the check takes down (or, in shadow, would). */
  wouldTakeDown: DocumentOwnerFee[];
  flagged: number;
  waiting: number;
  /** Pending second-look flags cleared because the fee's pair passes now (takedown on only). */
  cleared: number;
  takenDown: number[];
}

/** Re-reads per step with the takedown on, apart from the new-pair cap, so they never starve new pairs. */
export const DOCUMENT_OWNER_REREAD_LIMIT = 25;
/** Statement timeout for the per-step scoped pairs read, set inside its savepoint and put back after. */
export const DOCUMENT_OWNER_PAIRS_TIMEOUT = "60s";
/**
 * The scoped pairs read scans every live fee's document links, so a step runs it at most once
 * per this many hours (keyed on the mode's last event, like the watermark skip). At 25 pairs a
 * read that is 600 pairs a day.
 */
export const DOCUMENT_OWNER_SCAN_INTERVAL_HOURS = 1;

/** The step-detail form of a result (run-store's verify step). */
export function documentOwnerDetail(result: DocumentOwnerResult | null) {
  if (!result) return null;
  return {
    check: DOCUMENT_OWNER_CHECK,
    strategy: DOCUMENT_OWNER_STRATEGY,
    takedown_live: result.live,
    skipped: result.skipped,
    selected: result.selected,
    pairs: result.pairs,
    rereads: result.rereads,
    verdicts: result.verdicts,
    sibling_shared_documents: result.siblingSharedDocuments,
    would_take_down: result.wouldTakeDown.length,
    flagged: result.flagged,
    waiting: result.waiting,
    cleared: result.cleared,
    taken_down: result.takenDown.length,
    samples: result.wouldTakeDown.slice(0, 20).map((fee) => ({
      fee_published_id: fee.feePublishedId,
      institution_id: fee.institutionId,
      source_document_id: fee.sourceDocumentId,
      other_institution_id: fee.otherInstitutionId,
    })),
  };
}

interface Watermark {
  textId: number | null;
  feeId: number | null;
}

function eventType(live: boolean): string {
  return live ? "darwin.document_owner" : "darwin.document_owner_shadow";
}

/**
 * Skip the scoped-pairs read when the last read of this mode found no pair and no stored text or
 * live fee has arrived since (newest `agent_source_texts.id` and `published_fee_records` id
 * unchanged). Both are primary-key maxima, so the test is cheap. A failed read never skips.
 */
async function readWatermark(db: SqlTag, live: boolean, at: Date): Promise<{ now: Watermark; skip: boolean }> {
  const none = { now: { textId: null, feeId: null }, skip: false };
  try {
    const [current] = await inSavepoint(db, (scope) => scope<Array<{ text_id: number | string | null; fee_id: number | string | null }>>`
      SELECT (SELECT max(id) FROM agent_source_texts) AS text_id,
             (SELECT max(fee_published_id) FROM published_fee_records) AS fee_id
    `);
    const now = { textId: current?.text_id == null ? null : Number(current.text_id), feeId: current?.fee_id == null ? null : Number(current.fee_id) };
    const [last] = await inSavepoint(db, (scope) => scope<Array<{ detail: Record<string, unknown> | null; created_at: Date | string | null }>>`
      SELECT detail, created_at FROM agent_run_events
       WHERE event_type = ${eventType(live)}
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `);
    const detail = last?.detail ?? null;
    const unchanged = detail != null
      && Number(detail.selected) === 0
      && now.textId != null && Number(detail.max_text_id) === now.textId
      && now.feeId != null && Number(detail.max_fee_id) === now.feeId;
    // A scan that read nothing (skipped) does not restart the clock: only an event of a real read counts.
    const lastAt = last?.created_at == null || detail?.skipped === true ? null : new Date(last.created_at).getTime();
    const recent = lastAt != null && Number.isFinite(lastAt) && at.getTime() - lastAt < DOCUMENT_OWNER_SCAN_INTERVAL_HOURS * 3_600_000;
    return { now, skip: unchanged || recent };
  } catch (error) {
    console.warn("[darwin] document owner watermark read failed", error instanceof Error ? error.message : error);
    return none;
  }
}

/**
 * Darwin's document-owner re-check for one learning verify step. Never blocks the step: a failed
 * read returns an empty result.
 */
export async function recheckDocumentOwners(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; limit?: number; rereadLimit?: number; takedown?: boolean; now?: Date },
): Promise<DocumentOwnerResult> {
  const live = options.takedown ?? DARWIN_DOCUMENT_OWNER_TAKEDOWN;
  const limit = Math.max(1, Math.min(options.limit ?? DOCUMENT_OWNER_PAIR_LIMIT, 500));
  const rereadLimit = live ? Math.max(0, Math.min(options.rereadLimit ?? DOCUMENT_OWNER_REREAD_LIMIT, 500)) : 0;
  const result: DocumentOwnerResult = {
    live, skipped: false, selected: 0, pairs: 0, rereads: 0, verdicts: {}, siblingSharedDocuments: 0, wouldTakeDown: [],
    flagged: 0, waiting: 0, cleared: 0, takenDown: [],
  };
  const watermark = await readWatermark(db, live, options.now ?? new Date());
  if (watermark.skip) {
    result.skipped = true;
    return result;
  }
  let pairs: PairRow[];
  try {
    pairs = await inSavepoint(db, async (scope) => {
      // Cap the scoped read so it can never hold the run-ledger transaction. A transaction-local
      // setting survives RELEASE SAVEPOINT (only a rollback to the savepoint undoes it), so the
      // previous value is put back once the read succeeds; a failed read is rolled back with it.
      // JIT off too: the statement's estimated cost is far above jit_above_cost, and compiling it
      // took ten times the query itself on the synthetic test set.
      const [prior] = await scope<Array<{ value: string | null; jit: string | null }>>`
        SELECT current_setting('statement_timeout') AS value, current_setting('jit') AS jit,
               set_config('statement_timeout', ${DOCUMENT_OWNER_PAIRS_TIMEOUT}, true) AS applied,
               set_config('jit', 'off', true) AS jit_applied
      `;
      const rows = await scope.unsafe<PairRow[]>(documentOwnerPairsSql(), [
        documentOwnerFingerprintPrefix(live), DOCUMENT_OWNER_STRATEGY.strategy, DOCUMENT_OWNER_STRATEGY.version, limit, rereadLimit,
      ]);
      if (prior?.value != null) await scope`SELECT set_config('statement_timeout', ${prior.value}, true)`;
      if (prior?.jit != null) await scope`SELECT set_config('jit', ${prior.jit}, true)`;
      return rows;
    });
  } catch (error) {
    console.warn("[darwin] document owner read failed", error instanceof Error ? error.message : error);
    return result;
  }
  pairs = Array.isArray(pairs) ? pairs : [];
  result.selected = pairs.length;

  if (pairs.length > 0) {
    await judgePairs(db, options, live, pairs, result);
  }
  await recordStepEvent(db, options, live, watermark.now, result);
  return result;
}

async function judgePairs(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; now?: Date },
  live: boolean,
  pairs: PairRow[],
  result: DocumentOwnerResult,
): Promise<void> {
  let bankRows: BankRow[];
  let texts: Map<number, string>;
  try {
    bankRows = await inSavepoint(db, (scope) => scope<BankRow[]>`
      -- the registry for the document-owner name scan
      SELECT id, institution_name, city, state_code, cert_number, holding_company_rssd, holding_company_name, website_url
        FROM institution_sources
       WHERE institution_name IS NOT NULL
    `);
    texts = await inSavepoint(db, (scope) => loadSourceTexts(scope, [...new Set(pairs.map((pair) => Number(pair.source_document_id)))]));
  } catch (error) {
    console.warn("[darwin] document owner institution/text read failed", error instanceof Error ? error.message : error);
    return;
  }
  const directory = buildNameDirectory((Array.isArray(bankRows) ? bankRows : []).map((row) => ({
    id: Number(row.id),
    name: row.institution_name ?? "",
    city: row.city,
    stateCode: row.state_code,
    certNumber: row.cert_number,
    holdingCompanyRssd: row.holding_company_rssd,
    holdingCompanyName: row.holding_company_name,
    websiteHost: urlHost(row.website_url),
  })));
  const sharedCache = new Map<number, boolean>();
  const withShared = (id: number): OwnerBank | null => {
    const bank = directory.banks.get(id);
    if (!bank) return null;
    if (!sharedCache.has(id)) sharedCache.set(id, sharedNameIds(directory, [id]).has(id));
    return { ...bank, nameShared: sharedCache.get(id) };
  };

  const otherOf = new Map<string, number>();
  const passingKeys = new Set<string>();
  const siblingDocuments = new Set<number>();
  for (const pair of pairs) {
    const institutionId = Number(pair.institution_id);
    const sourceDocumentId = Number(pair.source_document_id);
    const own = withShared(institutionId);
    const text = texts.get(sourceDocumentId) ?? null;
    const linked = (pair.other_ids ?? []).map(Number).flatMap((id) => {
      const bank = withShared(id);
      return bank ? [bank] : [];
    });
    const found = institutionsNamedIn(text, directory).flatMap((id) => {
      const bank = id === institutionId ? null : withShared(id);
      return bank ? [bank] : [];
    });
    const ids = (values: Array<number | string> | null) => (values ?? []).map(Number);
    // A pair whose bank has no registry row (or no name) is recorded unproven, so it is not read again.
    const vendorPath = pair.vendor_path === true || isVendorDocumentPath(pair.document_url);
    const verdict: DocumentOwnerVerdict = own
      ? documentOwnerVerdict(text, own, linked, found, {
          hostIds: ids(pair.host_ids),
          hashIds: ids(pair.hash_ids),
          documentHost: pair.document_host,
          vendorPath,
        })
      : { kind: "unproven" };
    const key = `${institutionId}:${sourceDocumentId}`;
    if (own) result.pairs += 1;
    if (pair.reread === true) result.rereads += 1;
    result.verdicts[verdict.kind] = (result.verdicts[verdict.kind] ?? 0) + 1;
    if (verdict.kind === "sibling_shared") siblingDocuments.add(sourceDocumentId);
    if (verdict.kind === "other_bank") otherOf.set(key, verdict.otherId);
    else passingKeys.add(key);
    try {
      await inSavepoint(db, (scope) => recordAttempt(scope, {
        institutionId,
        sourceDocumentId,
        stage: "verify",
        strategy: DOCUMENT_OWNER_STRATEGY.strategy,
        version: DOCUMENT_OWNER_STRATEGY.version,
        fingerprint: documentOwnerFingerprint(institutionId, sourceDocumentId, pair.text_hash, live),
        outcome: verdict.kind === "other_bank" ? "evidence_mismatch" : "ok",
        yieldCount: verdict.kind === "other_bank" ? 0 : 1,
        costMicrousd: 0,
        durationMs: 0,
        runId: options.runId,
        stepId: options.stepId ?? null,
        foldIntoPlaybook: false,
        detail: {
          verdict: verdict.kind,
          document_url: pair.document_url,
          vendor_path: vendorPath,
          text_hash: pair.text_hash,
          live_fees: Number(pair.live_fees),
          linked_ids: linked.map((other) => other.id),
          named_ids: found.map((other) => other.id).slice(0, 20),
          named_other_id: verdict.kind === "other_bank" ? verdict.otherId : null,
          registry_named_ids: verdict.kind === "registry_named" ? verdict.otherIds.slice(0, 20) : null,
          evidence: "evidence" in verdict ? verdict.evidence : null,
          mode: live ? "live" : "shadow",
          reread: pair.reread === true,
          no_registry_row: own == null,
        },
      }));
    } catch (error) {
      console.warn("[darwin] document owner attempt failed", error instanceof Error ? error.message : error);
    }
  }
  result.siblingSharedDocuments = siblingDocuments.size;

  // The live fees of the pairs read: the failing ones are what a takedown takes; with the takedown
  // on, the passing ones clear any pending second-look flag.
  const wanted = live ? pairs : pairs.filter((pair) => otherOf.has(`${Number(pair.institution_id)}:${Number(pair.source_document_id)}`));
  if (wanted.length === 0) return;
  let rows: Array<{ fee_published_id: number | string; fee_verified_id: number | string; institution_id: number | string; source_document_id: number | string }>;
  try {
    rows = await inSavepoint(db, (scope) => scope<typeof rows>`
      SELECT DISTINCT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fr.source_document_id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        JOIN unnest(${wanted.map((pair) => Number(pair.institution_id))}::bigint[], ${wanted.map((pair) => Number(pair.source_document_id))}::bigint[])
             AS p(institution_id, source_document_id)
          ON p.institution_id = fp.institution_id AND p.source_document_id = fr.source_document_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
       ORDER BY fp.fee_published_id
    `);
  } catch (error) {
    console.warn("[darwin] document owner fee read failed", error instanceof Error ? error.message : error);
    return;
  }
  const passing: number[] = [];
  for (const row of rows) {
    const key = `${Number(row.institution_id)}:${Number(row.source_document_id)}`;
    const otherInstitutionId = otherOf.get(key);
    if (otherInstitutionId == null) {
      if (passingKeys.has(key)) passing.push(Number(row.fee_published_id));
      continue;
    }
    result.wouldTakeDown.push({
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: Number(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      sourceDocumentId: Number(row.source_document_id),
      otherInstitutionId,
      reason: `${DOCUMENT_OWNER_REASON}: names institution ${otherInstitutionId}`,
    });
  }

  if (live && (result.wouldTakeDown.length > 0 || passing.length > 0)) {
    const look = await secondLook(db, {
      check: DOCUMENT_OWNER_CHECK, runId: options.runId, failing: result.wouldTakeDown, passing, dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    result.cleared = look.cleared;
    if (look.confirmed.length > 0) result.takenDown = await archive(db, options.runId, look.confirmed);
  }
}

async function recordStepEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  live: boolean,
  watermark: Watermark,
  result: DocumentOwnerResult,
): Promise<void> {
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, ${eventType(live)}, 'completed',
        ${live
          ? `Document owner: ${result.pairs} pair(s) read, ${result.wouldTakeDown.length} live fee(s) name another bank, ${result.takenDown.length} archived`
          : `Document owner (shadow): ${result.pairs} pair(s) read, would take down ${result.wouldTakeDown.length} live fee(s); nothing changed`},
        ${JSON.stringify({
          ...documentOwnerDetail(result),
          max_text_id: watermark.textId,
          max_fee_id: watermark.feeId,
          samples: result.wouldTakeDown.slice(0, 50).map((fee) => ({
            fee_published_id: fee.feePublishedId,
            institution_id: fee.institutionId,
            source_document_id: fee.sourceDocumentId,
            other_institution_id: fee.otherInstitutionId,
          })),
        })}::jsonb
      )
    `);
  } catch (error) {
    console.warn("[darwin] document owner event failed", error instanceof Error ? error.message : error);
  }
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: DocumentOwnerFee[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-document-owner-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const done = fees.filter((fee) => ids.has(fee.feePublishedId));
      if (done.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? ${DOCUMENT_OWNER_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${DOCUMENT_OWNER_FLAG}::text)
                 END
           WHERE fv.fee_verified_id = ANY(${done.map((fee) => fee.feeVerifiedId)}::bigint[])
             AND fv.review_status IN ('verified', 'approved')
        `;
      }
      return done.map((fee) => fee.feePublishedId);
    });
    if (closed.length > 0) invalidatePublicReadCache();
    return closed;
  } catch (error) {
    console.error("[darwin] document owner takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}
