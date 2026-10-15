import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { hostSql, textHasCertNumber } from "@/lib/agents/magellan/other-bank-host";
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
 *   `<cu-domain>/ezs3download/download/...` on six unrelated CUs (about 139 live rows), and
 *   Horizons North CU's (8416) at `5star.bank/_/kcms-doc/...` on 5Star Bank (37 live rows).
 *
 * This re-check reads the document's own text. A live (institution, document) pair is in doubt
 * when its document is shared with another institution (the document's host is that
 * institution's stored website, that institution has live fees from the same address, or one of
 * its documents has the same `text_hash`), or sits on a vendor download path
 * (`VENDOR_DOCUMENT_PATH`; a path alone is no proof). For each such pair it asks which bank the
 * text names: the institutions it shares the document with, by name or by city with its state,
 * and every institution in the registry, by name only. Never by the website host, which is the
 * thing in doubt:
 * - `own_named`: the text names this bank (a name no other named institution shares, its city,
 *   or its FDIC certificate / NCUA charter number). Passes, also when it names another bank too
 *   (a co-branded or shared-service document).
 * - `sibling_shared`: the document is shared with a charter under the same holding company
 *   (#1441: IBC's five, Wells Fargo's three). Never taken down; counted once per document.
 * - `other_bank`: the text names exactly one other, unrelated institution and never this bank.
 *   The fee is that bank's.
 * - `shared_service`: it names two or more other unrelated institutions and not this bank (a
 *   shared-service or network document). Passes.
 * - `unproven` / `no_text`: nothing decides. Passes.
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
 * Default-off switch. Off: shadow, as above. On: an `other_bank` fee goes through the shared
 * 12-hour second look (`darwin.document_owner`) and is archived (rolled back with the reason,
 * the verified row rejected with the `document_owner` flag), never deleted. It turns on by PR
 * once James has seen the count from `documentOwnerCountSql` and a sample.
 */
export const DARWIN_DOCUMENT_OWNER_TAKEDOWN = false;

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
 * Names and brand stems that never identify one institution by themselves: boilerplate
 * ("Member FDIC") and single words every schedule uses ("Members Credit Union" -> "members").
 */
const GENERIC_NAMES = new Set([
  "bank", "the bank", "credit union", "federal credit union", "savings bank", "state bank", "national bank",
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
]);
const MIN_NAME_CHARS = 6;
const MIN_CITY_CHARS = 3;
/** Longest name form (in words) the n-gram index holds. */
const MAX_FORM_WORDS = 10;

export interface OwnerBank {
  id: number;
  name: string;
  city?: string | null;
  stateCode?: string | null;
  certNumber?: string | number | null;
  holdingCompanyRssd?: string | null;
  holdingCompanyName?: string | null;
  /** Another institution's name contains this one's (`sharedNameIds`): it then counts only with its city. */
  nameShared?: boolean;
}

export type DocumentOwnerVerdict =
  | { kind: "own_named"; evidence: string }
  | { kind: "sibling_shared"; siblingIds: number[] }
  | { kind: "other_bank"; otherId: number; evidence: string }
  | { kind: "shared_service"; otherIds: number[] }
  | { kind: "unproven" }
  | { kind: "no_text" };

/** Lower case words, apostrophes dropped ("St. Mary's" is "st marys"), everything else a space. */
export function ownerWords(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/[^a-z0-9&]+/g, " ")
    .trim();
}

function hasWords(padded: string, words: string): boolean {
  return words.length > 0 && padded.includes(` ${words} `);
}

/**
 * The forms of a name the text may use: no "The" or "N.A.", the "credit union" and "FCU" short
 * forms, Saint/St, and the brand stem without "Federal Credit Union", "Credit Union", "FCU" or
 * "Bank" ("healthplus" for Healthplus Federal Credit Union). Generic forms are dropped.
 */
export function ownerNameForms(name: string | null | undefined): string[] {
  const base = ownerWords(name)
    .replace(/^the /, "")
    .replace(/ (national association|n a|ssb|fsb|inc)$/, "");
  const forms = [
    base,
    base.replace(/ federal credit union$/, " credit union"),
    base.replace(/ federal credit union$/, " fcu"),
    base.replace(/^saint /, "st "),
    base.replace(/^st /, "saint "),
    base.replace(/ (federal credit union|credit union|fcu|bank)$/, ""),
  ];
  return [...new Set(forms)].filter((form) => form.length >= MIN_NAME_CHARS && !GENERIC_NAMES.has(form));
}

/** Do two name lists overlap as whole words either way ("capital city bank" in "capital city bank group")? */
function namesOverlap(a: string[], b: string[]): boolean {
  return a.some((x) => b.some((y) => hasWords(` ${x} `, y) || hasWords(` ${y} `, x)));
}

/** Same holding company: the same RSSD, or the same holding-company name. */
export function sameHoldingCompany(a: OwnerBank, b: OwnerBank): boolean {
  const rssd = (value: string | null | undefined) => {
    const trimmed = (value ?? "").trim().replace(/^0+/, "");
    return trimmed.length > 0 ? trimmed : null;
  };
  const ra = rssd(a.holdingCompanyRssd);
  if (ra && ra === rssd(b.holdingCompanyRssd)) return true;
  const na = ownerWords(a.holdingCompanyName);
  return na.length > 0 && na === ownerWords(b.holdingCompanyName);
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

/** Every run of 1..MAX_FORM_WORDS words in the text, for whole-word name lookups. */
function wordRuns(words: string[]): Set<string> {
  const runs = new Set<string>();
  for (let start = 0; start < words.length; start += 1) {
    let run = "";
    for (let length = 0; length < MAX_FORM_WORDS && start + length < words.length; length += 1) {
      run = length === 0 ? words[start] : `${run} ${words[start + length]}`;
      runs.add(run);
    }
  }
  return runs;
}

/** The registry's names, indexed for a whole-word scan of a document's text. */
export interface NameDirectory {
  banks: Map<number, OwnerBank>;
  forms: Array<{ id: number; form: string }>;
}

export function buildNameDirectory(banks: OwnerBank[]): NameDirectory {
  return {
    banks: new Map(banks.map((bank) => [bank.id, bank])),
    forms: banks.flatMap((bank) => ownerNameForms(bank.name).map((form) => ({ id: bank.id, form }))),
  };
}

/** Pure: the ids among `ids` whose name (any form) appears as whole words in another institution's name form. */
export function sharedNameIds(directory: NameDirectory, ids: Iterable<number>): Set<number> {
  const shared = new Set<number>();
  for (const id of ids) {
    const bank = directory.banks.get(id);
    if (!bank) continue;
    const forms = ownerNameForms(bank.name);
    if (directory.forms.some((entry) => entry.id !== id && forms.some((form) => hasWords(` ${entry.form} `, form)))) shared.add(id);
  }
  return shared;
}

/** Pure: the institutions in `directory` whose name (any form) the text prints as whole words. */
export function institutionsNamedIn(text: string | null | undefined, directory: NameDirectory): number[] {
  const words = ownerWords(text).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const runs = wordRuns(words);
  const ids = new Set<number>();
  for (const entry of directory.forms) if (runs.has(entry.form)) ids.add(entry.id);
  return [...ids].sort((a, b) => a - b);
}

/**
 * Pure: which bank does this document's text name? `own` is the institution the fees are filed
 * under; `linked` the institutions it shares the document with (by host, address or text hash),
 * which may be named by name or by city and state; `found` the institutions the registry scan
 * found named in the text (`institutionsNamedIn`), which count by name only.
 */
export function documentOwnerVerdict(
  text: string | null | undefined,
  own: OwnerBank,
  linked: OwnerBank[],
  found: OwnerBank[] = [],
): DocumentOwnerVerdict {
  if (!text || !text.trim()) return { kind: "no_text" };
  const padded = ` ${ownerWords(text)} `;
  const linkedIds = new Set(linked.map((other) => other.id));
  const pool = [...new Map([...linked, ...found].filter((other) => other.id !== own.id).map((other) => [other.id, other])).values()];
  const ownForms = ownerNameForms(own.name);
  const formsOf = new Map(pool.map((other) => [other.id, ownerNameForms(other.name)] as const));

  // This bank: a name no other institution in play shares, its city (with its state when one of
  // them has the same city), or its certificate / charter number.
  const ownDistinct = ownForms.filter((form) => !pool.some((other) => namesOverlap([form], formsOf.get(other.id)!)));
  const ownName = ownDistinct.find((form) => hasWords(padded, form));
  if (ownName) return { kind: "own_named", evidence: `name: ${ownName}` };
  const ownCity = cityWords(own);
  if (ownCity) {
    const cityShared = pool.some((other) => cityWords(other) === ownCity);
    if (cityShared ? namesCityAndState(padded, own) : hasWords(padded, ownCity)) return { kind: "own_named", evidence: `city: ${ownCity}` };
  }
  if (textHasCertNumber(text.toLowerCase().replace(/\s+/g, " "), own.certNumber)) {
    return { kind: "own_named", evidence: `certificate: ${own.certNumber}` };
  }

  const named = (other: OwnerBank): string | null => {
    const forms = formsOf.get(other.id)!.filter((form) => !namesOverlap([form], ownForms));
    const name = forms.find((form) => hasWords(padded, form));
    const otherCity = cityWords(other);
    const cityHere = otherCity.length > 0 && otherCity !== ownCity && hasWords(padded, otherCity);
    if (name && (!other.nameShared || cityHere)) return `name: ${name}`;
    if (linkedIds.has(other.id) && otherCity && otherCity !== ownCity && namesCityAndState(padded, other)) {
      return `city: ${otherCity} ${(other.stateCode ?? "").toLowerCase()}`;
    }
    return null;
  };

  const siblings = pool.filter((other) => sameHoldingCompany(own, other));
  const hits = pool.flatMap((other) => {
    if (sameHoldingCompany(own, other)) return [];
    const evidence = named(other);
    return evidence ? [{ id: other.id, evidence }] : [];
  });
  // A schedule a holding company's charters share is theirs to share (#1441), whatever it names.
  if (siblings.length > 0 && (hits.length === 0 || siblings.some((other) => named(other)))) {
    return { kind: "sibling_shared", siblingIds: siblings.map((other) => other.id) };
  }
  if (hits.length === 1) return { kind: "other_bank", otherId: hits[0].id, evidence: hits[0].evidence };
  if (hits.length > 1) return { kind: "shared_service", otherIds: hits.map((hit) => hit.id) };
  return { kind: "unproven" };
}

/**
 * The live (institution, document) pairs in doubt: shared with another institution (the
 * document's host is its stored website, it has live fees from the same address, or one of its
 * documents has the same text hash), or on a vendor download path. Read-only. Hosts, addresses
 * and hashes are worked out once per table and joined by equality.
 */
function scopedPairsSql(): string {
  return `
    WITH live AS (
      SELECT fp.fee_published_id, fp.institution_id, fr.source_document_id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fr.source_document_id IS NOT NULL
    ),
    pairs AS (
      SELECT institution_id, source_document_id, count(DISTINCT fee_published_id)::int AS live_fees
        FROM live
       GROUP BY institution_id, source_document_id
    ),
    placed AS (
      SELECT p.*, btrim(sd.document_url) AS document_url, ${hostSql("sd.document_url")} AS host
        FROM pairs p
        JOIN source_documents sd ON sd.id = p.source_document_id
       WHERE sd.document_url IS NOT NULL
    ),
    sites AS (
      SELECT i.id, ${hostSql("i.website_url")} AS host
        FROM institution_sources i
       WHERE i.website_url IS NOT NULL
    ),
    hashes AS (
      SELECT DISTINCT ON (t.source_document_id) t.source_document_id, t.text_hash
        FROM agent_source_texts t
       WHERE t.source_document_id IN (SELECT source_document_id FROM pairs)
         AND t.status = 'completed' AND t.text_hash IS NOT NULL
       ORDER BY t.source_document_id, t.id DESC
    ),
    links AS (
      SELECT p.institution_id, p.source_document_id, s.id AS other_id
        FROM placed p JOIN sites s ON s.host = p.host AND s.id <> p.institution_id
      UNION
      SELECT p.institution_id, p.source_document_id, q.institution_id AS other_id
        FROM placed p JOIN placed q ON q.document_url = p.document_url AND q.institution_id <> p.institution_id
      UNION
      SELECT p.institution_id, p.source_document_id, t.institution_id AS other_id
        FROM placed p
        JOIN hashes h ON h.source_document_id = p.source_document_id
        JOIN agent_source_texts t ON t.text_hash = h.text_hash AND t.institution_id <> p.institution_id
    ),
    shared AS (
      SELECT p.institution_id, p.source_document_id, p.document_url, p.live_fees,
             COALESCE(array_agg(DISTINCT l.other_id ORDER BY l.other_id) FILTER (WHERE l.other_id IS NOT NULL), '{}'::bigint[]) AS other_ids
        FROM placed p
        LEFT JOIN links l ON l.institution_id = p.institution_id AND l.source_document_id = p.source_document_id
       GROUP BY p.institution_id, p.source_document_id, p.document_url, p.live_fees
      HAVING count(l.other_id) > 0 OR p.document_url ~* '${VENDOR_DOCUMENT_PATH}'
    )`;
}

/** The attempt fingerprint of one pair; shadow reads are kept apart so the switch re-reads them. */
export function documentOwnerFingerprint(institutionId: number, sourceDocumentId: number, live: boolean): string {
  return `owner${live ? "" : "-shadow"}:${institutionId}:${sourceDocumentId}`;
}

/**
 * The pairs this step reads: not yet read under this version and mode. With the takedown on, a
 * pair last read as `other_bank` is read again, so the second look can confirm it.
 */
export function documentOwnerPairsSql(): string {
  return `${scopedPairsSql()}
    SELECT s.institution_id, s.source_document_id, s.document_url, s.live_fees, s.other_ids
      FROM shared s
     WHERE NOT EXISTS (
       SELECT 1 FROM pipeline_attempts pa
        WHERE pa.input_fingerprint = $1 || s.institution_id::text || ':' || s.source_document_id::text
          AND pa.strategy = $2
          AND pa.strategy_version = $3
          AND ($4::boolean IS FALSE OR pa.outcome = 'ok')
     )
     ORDER BY s.live_fees DESC, s.institution_id, s.source_document_id
     LIMIT $5`;
}

/** SQL forms of `ownerWords` and `ownerNameForms`, so the count reads names as the pass does. */
function wordsSql(expr: string): string {
  return `btrim(regexp_replace(regexp_replace(lower(COALESCE(${expr}, '')), '[''’‘\`]', '', 'g'), '[^a-z0-9&]+', ' ', 'g'))`;
}
function formsSql(nameExpr: string): string {
  const base = `regexp_replace(regexp_replace(${wordsSql(nameExpr)}, '^the ', ''), ' (national association|n a|ssb|fsb|inc)$', '')`;
  const generic = [...GENERIC_NAMES].map((name) => `'${name}'`).join(", ");
  return `ARRAY(SELECT DISTINCT f FROM unnest(ARRAY[
      ${base},
      regexp_replace(${base}, ' federal credit union$', ' credit union'),
      regexp_replace(${base}, ' federal credit union$', ' fcu'),
      regexp_replace(${base}, '^saint ', 'st '),
      regexp_replace(${base}, '^st ', 'saint '),
      regexp_replace(${base}, ' (federal credit union|credit union|fcu|bank)$', '')
    ]) f WHERE length(f) >= ${MIN_NAME_CHARS} AND f NOT IN (${generic}))`;
}

/**
 * Read-only SQL for James: the live fees the document-owner check would take down, the passes
 * by verdict, and the sibling-shared documents counted once (#1441). Every live fee is counted
 * once. It mirrors `documentOwnerVerdict` with one difference: it does not read the FDIC
 * certificate / NCUA charter number, so its `other_bank` count is an upper bound of the pass's.
 * `detail` lists each (institution, document) pair instead of the totals.
 */
export function documentOwnerCountSql(options: { detail?: boolean } = {}): string {
  const states = Object.entries(STATE_NAMES)
    .map(([code, name]) => `('${code}', '${ownerWords(name)}')`)
    .join(", ");
  // Whole words: both sides padded with spaces.
  const has = (padded: string, words: string) => `(length(${words}) > 0 AND strpos(${padded}, ' ' || ${words} || ' ') > 0)`;
  const overlap = (a: string, b: string) =>
    `EXISTS (SELECT 1 FROM unnest(${a}) x, unnest(${b}) y WHERE strpos(' ' || x || ' ', ' ' || y || ' ') > 0 OR strpos(' ' || y || ' ', ' ' || x || ' ') > 0)`;
  const cityState = (padded: string, alias: string) =>
    `(length(${alias}.city_w) >= ${MIN_CITY_CHARS} AND (${has(padded, `${alias}.city_w || ' ' || lower(${alias}.state_code)`)} OR ${has(padded, `${alias}.city_w || ' ' || ${alias}.state_w`)}))`;
  const sibling = (a: string, b: string) =>
    `((${a}.hc_rssd <> '' AND ${a}.hc_rssd = ${b}.hc_rssd) OR (${a}.hc_name <> '' AND ${a}.hc_name = ${b}.hc_name))`;
  // An institution in play `c` (from `inplay`) and its evidence, as `named` in `documentOwnerVerdict`.
  const otherNamed = `(
      (EXISTS (SELECT 1 FROM unnest(c.forms) f
                WHERE NOT ${overlap("ARRAY[f]", "own.forms")} AND ${has("j.padded", "f")})
       AND (NOT c.name_shared
            OR (length(c.city_w) >= ${MIN_CITY_CHARS} AND c.city_w <> own.city_w AND ${has("j.padded", "c.city_w")})))
      OR (c.linked AND c.city_w <> own.city_w AND ${cityState("j.padded", "c")})
    )`;
  const inplay = (where: string) => `(SELECT b.*, ip.linked FROM inplay ip JOIN named_banks b ON b.id = ip.other_id
                 WHERE ip.institution_id = j.institution_id AND ip.source_document_id = j.source_document_id AND ${where})`;
  return `-- Darwin document-owner check (#1455), read-only: live fees on a document whose text names another bank.
${scopedPairsSql()},
    states(code, state_w) AS (VALUES ${states}),
    texts AS (
      SELECT DISTINCT ON (source_document_id) source_document_id,
             ' ' || ${wordsSql("normalized_text")} || ' ' AS padded
        FROM agent_source_texts
       WHERE source_document_id IN (SELECT source_document_id FROM shared)
         AND status = 'completed' AND normalized_text IS NOT NULL
       ORDER BY source_document_id, id DESC
    ),
    directory AS (
      SELECT i.id, f.form, split_part(f.form, ' ', 1) AS first_word
        FROM institution_sources i, unnest(${formsSql("i.institution_name")}) AS f(form)
       WHERE i.institution_name IS NOT NULL
    ),
    doc_words AS (
      SELECT DISTINCT t.source_document_id, w.word
        FROM texts t, regexp_split_to_table(btrim(t.padded), ' ') AS w(word)
    ),
    found AS (
      SELECT DISTINCT dw.source_document_id, d.id
        FROM doc_words dw
        JOIN directory d ON d.first_word = dw.word
        JOIN texts t ON t.source_document_id = dw.source_document_id
       WHERE strpos(t.padded, ' ' || d.form || ' ') > 0
    ),
    inplay AS (
      SELECT institution_id, source_document_id, other_id, bool_or(linked) AS linked
        FROM (
          SELECT s.institution_id, s.source_document_id, unnest(s.other_ids) AS other_id, true AS linked FROM shared s
          UNION ALL
          SELECT s.institution_id, s.source_document_id, f.id, false FROM shared s JOIN found f ON f.source_document_id = s.source_document_id
        ) x
       WHERE other_id <> institution_id
       GROUP BY institution_id, source_document_id, other_id
    ),
    banks AS (
      SELECT i.id, i.state_code,
             ${wordsSql("i.city")} AS city_w,
             COALESCE(st.state_w, '') AS state_w,
             ltrim(btrim(COALESCE(i.holding_company_rssd, '')), '0') AS hc_rssd,
             ${wordsSql("i.holding_company_name")} AS hc_name,
             ${formsSql("i.institution_name")} AS forms
        FROM institution_sources i
        LEFT JOIN states st ON st.code = upper(btrim(COALESCE(i.state_code, '')))
       WHERE i.id IN (SELECT institution_id FROM shared UNION SELECT other_id FROM inplay)
    ),
    named_banks AS (
      SELECT b.*, EXISTS (
               SELECT 1 FROM directory a, unnest(b.forms) y
                WHERE a.id <> b.id AND strpos(' ' || a.form || ' ', ' ' || y || ' ') > 0
             ) AS name_shared
        FROM banks b
    ),
    judged0 AS (
      SELECT s.institution_id, s.source_document_id, s.document_url, s.live_fees, s.other_ids, t.padded
        FROM shared s
        LEFT JOIN texts t ON t.source_document_id = s.source_document_id
    ),
    judged AS (
      SELECT j.institution_id, j.source_document_id, j.document_url, j.live_fees, j.other_ids,
             CASE
               WHEN j.padded IS NULL OR btrim(j.padded) = '' THEN 'no_text'
               WHEN EXISTS (SELECT 1 FROM unnest(own.forms) f
                             WHERE ${has("j.padded", "f")}
                               AND NOT EXISTS (SELECT 1 FROM ${inplay(overlap("ARRAY[f]", "b.forms"))} c))
                 THEN 'own_named'
               WHEN length(own.city_w) >= ${MIN_CITY_CHARS} AND (
                      CASE WHEN EXISTS (SELECT 1 FROM ${inplay("b.city_w = own.city_w")} c)
                           THEN ${cityState("j.padded", "own")}
                           ELSE ${has("j.padded", "own.city_w")} END)
                 THEN 'own_named'
               WHEN EXISTS (SELECT 1 FROM ${inplay(sibling("own", "b"))} c)
                    AND (NOT EXISTS (SELECT 1 FROM ${inplay(`NOT ${sibling("own", "b")}`)} c WHERE ${otherNamed})
                         OR EXISTS (SELECT 1 FROM ${inplay(sibling("own", "b"))} c WHERE ${otherNamed}))
                 THEN 'sibling_shared'
               ELSE CASE (SELECT count(*) FROM ${inplay(`NOT ${sibling("own", "b")}`)} c WHERE ${otherNamed})
                      WHEN 0 THEN 'unproven' WHEN 1 THEN 'other_bank' ELSE 'shared_service' END
             END AS verdict,
             (SELECT min(c.id) FROM ${inplay(`NOT ${sibling("own", "b")}`)} c WHERE ${otherNamed}) AS named_other_id
        FROM judged0 j
        JOIN named_banks own ON own.id = j.institution_id
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
    ORDER BY verdict`}`;
}

interface PairRow {
  institution_id: number | string;
  source_document_id: number | string;
  document_url: string | null;
  live_fees: number | string;
  other_ids: Array<number | string> | null;
}

interface BankRow {
  id: number | string;
  institution_name: string | null;
  city: string | null;
  state_code: string | null;
  cert_number: string | null;
  holding_company_rssd: string | null;
  holding_company_name: string | null;
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
  pairs: number;
  verdicts: Partial<Record<DocumentOwnerVerdict["kind"], number>>;
  /** Documents a holding company's charters share (#1441), each counted once; never taken down. */
  siblingSharedDocuments: number;
  /** Live fees on `other_bank` pairs: what the check takes down (or, in shadow, would). */
  wouldTakeDown: DocumentOwnerFee[];
  flagged: number;
  waiting: number;
  takenDown: number[];
}

/**
 * Darwin's document-owner re-check for one learning verify step. Never blocks the step: a failed
 * read returns an empty result.
 */
export async function recheckDocumentOwners(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; limit?: number; takedown?: boolean; now?: Date },
): Promise<DocumentOwnerResult> {
  const live = options.takedown ?? DARWIN_DOCUMENT_OWNER_TAKEDOWN;
  const limit = Math.max(1, Math.min(options.limit ?? DOCUMENT_OWNER_PAIR_LIMIT, 500));
  const result: DocumentOwnerResult = {
    live, pairs: 0, verdicts: {}, siblingSharedDocuments: 0, wouldTakeDown: [], flagged: 0, waiting: 0, takenDown: [],
  };
  let pairs: PairRow[];
  try {
    pairs = await inSavepoint(db, (scope) =>
      scope.unsafe<PairRow[]>(documentOwnerPairsSql(), [
        `owner${live ? "" : "-shadow"}:`, DOCUMENT_OWNER_STRATEGY.strategy, DOCUMENT_OWNER_STRATEGY.version, live, limit,
      ]),
    );
  } catch (error) {
    console.warn("[darwin] document owner read failed", error instanceof Error ? error.message : error);
    return result;
  }
  if (!Array.isArray(pairs) || pairs.length === 0) return result;

  let bankRows: BankRow[];
  try {
    bankRows = await inSavepoint(db, (scope) => scope<BankRow[]>`
      -- the registry for the document-owner name scan
      SELECT id, institution_name, city, state_code, cert_number, holding_company_rssd, holding_company_name
        FROM institution_sources
       WHERE institution_name IS NOT NULL
    `);
  } catch (error) {
    console.warn("[darwin] document owner institution read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const directory = buildNameDirectory((Array.isArray(bankRows) ? bankRows : []).map((row) => ({
    id: Number(row.id),
    name: row.institution_name ?? "",
    city: row.city,
    stateCode: row.state_code,
    certNumber: row.cert_number,
    holdingCompanyRssd: row.holding_company_rssd,
    holdingCompanyName: row.holding_company_name,
  })));
  const texts = await loadSourceTexts(db, [...new Set(pairs.map((pair) => Number(pair.source_document_id)))]);
  const sharedCache = new Map<number, boolean>();
  const withShared = (id: number): OwnerBank | null => {
    const bank = directory.banks.get(id);
    if (!bank) return null;
    if (!sharedCache.has(id)) sharedCache.set(id, sharedNameIds(directory, [id]).has(id));
    return { ...bank, nameShared: sharedCache.get(id) };
  };

  const failingPairs: Array<{ institutionId: number; sourceDocumentId: number; otherId: number }> = [];
  const siblingDocuments = new Set<number>();
  for (const pair of pairs) {
    const institutionId = Number(pair.institution_id);
    const sourceDocumentId = Number(pair.source_document_id);
    const own = withShared(institutionId);
    if (!own) continue;
    const text = texts.get(sourceDocumentId) ?? null;
    const linked = (pair.other_ids ?? []).map(Number).flatMap((id) => {
      const bank = withShared(id);
      return bank ? [bank] : [];
    });
    const found = institutionsNamedIn(text, directory).flatMap((id) => {
      const bank = id === institutionId ? null : withShared(id);
      return bank ? [bank] : [];
    });
    const verdict = documentOwnerVerdict(text, own, linked, found);
    result.pairs += 1;
    result.verdicts[verdict.kind] = (result.verdicts[verdict.kind] ?? 0) + 1;
    if (verdict.kind === "sibling_shared") siblingDocuments.add(sourceDocumentId);
    if (verdict.kind === "other_bank") failingPairs.push({ institutionId, sourceDocumentId, otherId: verdict.otherId });
    await recordAttempt(db, {
      institutionId,
      sourceDocumentId,
      stage: "verify",
      strategy: DOCUMENT_OWNER_STRATEGY.strategy,
      version: DOCUMENT_OWNER_STRATEGY.version,
      fingerprint: documentOwnerFingerprint(institutionId, sourceDocumentId, live),
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
        vendor_path: isVendorDocumentPath(pair.document_url),
        live_fees: Number(pair.live_fees),
        linked_ids: linked.map((other) => other.id),
        named_ids: found.map((other) => other.id).slice(0, 20),
        named_other_id: verdict.kind === "other_bank" ? verdict.otherId : null,
        evidence: "evidence" in verdict ? verdict.evidence : null,
        mode: live ? "live" : "shadow",
      },
    });
  }
  result.siblingSharedDocuments = siblingDocuments.size;

  if (failingPairs.length > 0) {
    try {
      const rows = await inSavepoint(db, (scope) => scope<Array<{
        fee_published_id: number | string; fee_verified_id: number | string; institution_id: number | string; source_document_id: number | string;
      }>>`
        SELECT DISTINCT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fr.source_document_id
          FROM published_fee_records fp
          JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
          JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
          JOIN unnest(${failingPairs.map((pair) => pair.institutionId)}::bigint[], ${failingPairs.map((pair) => pair.sourceDocumentId)}::bigint[])
               AS p(institution_id, source_document_id)
            ON p.institution_id = fp.institution_id AND p.source_document_id = fr.source_document_id
         WHERE fp.rolled_back_at IS NULL
         ORDER BY fp.fee_published_id
      `);
      const otherOf = new Map(failingPairs.map((pair) => [`${pair.institutionId}:${pair.sourceDocumentId}`, pair.otherId]));
      result.wouldTakeDown = rows.map((row) => {
        const otherInstitutionId = otherOf.get(`${Number(row.institution_id)}:${Number(row.source_document_id)}`) ?? 0;
        return {
          feePublishedId: Number(row.fee_published_id),
          feeVerifiedId: Number(row.fee_verified_id),
          institutionId: Number(row.institution_id),
          sourceDocumentId: Number(row.source_document_id),
          otherInstitutionId,
          reason: `${DOCUMENT_OWNER_REASON}: names institution ${otherInstitutionId}`,
        };
      });
    } catch (error) {
      console.warn("[darwin] document owner fee read failed", error instanceof Error ? error.message : error);
    }
  }

  if (live && result.wouldTakeDown.length > 0) {
    const look = await secondLook(db, { check: DOCUMENT_OWNER_CHECK, runId: options.runId, failing: result.wouldTakeDown, dryRun: false, now: options.now });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    if (look.confirmed.length > 0) result.takenDown = await archive(db, options.runId, look.confirmed);
  }

  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null},
        ${live ? "darwin.document_owner" : "darwin.document_owner_shadow"}, 'completed',
        ${live
          ? `Document owner: ${result.pairs} pair(s) read, ${result.wouldTakeDown.length} live fee(s) name another bank, ${result.takenDown.length} archived`
          : `Document owner (shadow): ${result.pairs} pair(s) read, would take down ${result.wouldTakeDown.length} live fee(s); nothing changed`},
        ${JSON.stringify({
          strategy: DOCUMENT_OWNER_STRATEGY,
          live,
          pairs: result.pairs,
          verdicts: result.verdicts,
          sibling_shared_documents: result.siblingSharedDocuments,
          would_take_down: result.wouldTakeDown.length,
          flagged: result.flagged,
          waiting: result.waiting,
          taken_down: result.takenDown.length,
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
  return result;
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
