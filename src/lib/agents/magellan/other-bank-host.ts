import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * A fee schedule on another institution's website (James, Oct 8): Peoples Bank of Rock Valley,
 * Iowa published the fees of Peoples Bank, Bellingham, Washington, read from
 * peoplesbank-wa.com, because a search for "Peoples Bank fee schedule" found that bank's PDF.
 * A link whose host is another institution's own website, and not this bank's, is that other
 * bank's schedule. Discovery refuses it, and Hamilton takes down fees already read from one
 * (`hamilton/other-bank-document.ts`) unless the document names this bank's own website or city.
 *
 * On Oct 8, 62 stored documents at 44 institutions sat on another institution's host; 16 of
 * those institutions had live fees from one (321 fees).
 */
export const OTHER_BANK_HOST_CODE = "other_bank_host";

/** The host of an address, lower case and without `www.`; null when it is not a web address. */
export function urlHost(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** File and site-builder hosts many banks use for their own documents. */
export const SHARED_CONTENT_HOST_PATTERN =
  "(cdn|static|assets|s3|amazonaws|cloudfront|filesusr|usrfiles|wsimg|hubspotusercontent|ctfassets|sanity[.]io|contentstack|sitecorecloud|digitaloceanspaces|filesafe|marketpath|q4cdn|homecu|kcmspreview|website-files|cms|squarespace|blob[.]core|googleusercontent|wixstatic|azureedge|akamai|storage|wpengine)";
const SHARED_CONTENT_HOST = new RegExp(SHARED_CONTENT_HOST_PATTERN);

/** The name part of a host ("usffcu" in "usffcu.com"), as Hamilton's SQL reads it. */
export function hostLabel(host: string): string {
  const parts = host.split(".");
  return parts[Math.max(parts.length - 2, 0)] ?? host;
}

/** A bank's name as Hamilton compares it: lower case, no "N.A."/"FSB" suffix, plain characters. */
export function comparableBankName(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/,?\s+(national association|n\.a\.|ssb|fsb)\s*$/, "")
    .replace(/[^a-z0-9&' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Shortest website name that may match on name alone ("cinfed.org" and "cinfed.com"). */
export const SAME_NAME_MIN_CHARS = 6;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does `needle` appear in `text` as whole words ("t bank" is not in "first bank")? */
function hasWords(text: string, needle: string): boolean {
  return needle.length > 0 && new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}($|[^a-z0-9])`).test(text);
}

/** The bank as a document on another host must name it. */
export interface NamedBank {
  websiteHost: string;
  institutionName?: string | null;
  /**
   * Another institution has the same name ("Peoples Bank", "First National Bank",
   * `loadSharedNameIds`): the name then counts only with the city or certificate number.
   */
  nameShared?: boolean;
  city?: string | null;
  /** FDIC certificate / NCUA charter number. */
  certNumber?: string | number | null;
}

/**
 * Does this text tie a document to the bank? Its website, the website's name (4+ characters)
 * or its own name, each as whole words (#1287). A name another institution shares counts
 * only with the bank's city or its certificate / charter number in the text too.
 */
export function textNamesBank(text: string, bank: NamedBank): boolean {
  const lower = text.toLowerCase().replace(/\s+/g, " ");
  if (new RegExp(`(^|[^a-z0-9-])${escapeRegExp(bank.websiteHost)}($|[^a-z0-9-])`).test(lower)) return true;
  const label = hostLabel(bank.websiteHost);
  if (label.length >= 4 && hasWords(lower, label)) return true;
  const name = comparableBankName(bank.institutionName);
  if (name.length < 6) return false;
  if (!hasWords(lower, name) && !hasWords(lower, name.replace(" federal credit union", " credit union"))) return false;
  if (!bank.nameShared) return true;
  const city = comparableBankName(bank.city);
  return (city.length > 0 && hasWords(lower, city)) || textHasCertNumber(lower, bank.certNumber);
}

/**
 * The words that label a certificate / charter number: "Cert", "Certificate" or "Charter", or a
 * bare "FDIC" or "NCUA" only with "#", "No." or "Number" after it (#1320): "Member FDIC 175 Main
 * Street" and "Member FDIC (175) 555-1212" are not cert 175. What may stand between the label and
 * the number: "FDIC Certificate #175", "NCUA Charter No. 24051", "Cert. Number: 175".
 */
const CERT_LABEL = "(?:(?:fdic|ncua)[\\s:.()-]*(?:#|no\\b|number\\b|nbr\\b)|cert(?:ificate)?\\b|charter\\b)";
const CERT_FILLER = "(?:[\\s#:.()-]|no\\b|number\\b|nbr\\b|id\\b|cert(?:ificate)?\\b|charter\\b)*";
/**
 * What may not follow the number: more digits or a decimal ("$1750", "175.00"), a term
 * ("certificate: 175-day term", #1320) or the rest of a phone number ("(175) 555-1212", "175-2400").
 */
const CERT_END = "(?![0-9]|[.,][0-9]|\\s*-?\\s*(?:days?|months?)\\b|\\)?[\\s.-]*[0-9]{3}[\\s.-][0-9]{4}\\b|-[0-9]{4}\\b)";

/**
 * Is the bank's FDIC certificate / NCUA charter number (3+ digits) in this lower-case text,
 * right after one of those labels (#1309, #1320)? A bare number is no evidence: cert 175 is also
 * "$175.00", a phone number, a street number or a ZIP code.
 */
export function textHasCertNumber(lower: string, certNumber: string | number | null | undefined): boolean {
  const cert = certNumber == null ? "" : String(certNumber).trim().replace(/^0+(?=\d)/, "");
  if (!/^\d{3,}$/.test(cert)) return false;
  return new RegExp(`(^|[^a-z0-9])${CERT_LABEL}${CERT_FILLER}0*${cert}${CERT_END}`).test(lower);
}

/**
 * A document on a host that is neither the bank's website (or a subdomain), nor a shared file
 * host, nor a host with the website's name (healthplusfcu.org and .com; 6+ characters, so
 * fnb.bank is not taken for fnb.com, #1287), and whose text does not name the bank. Applied
 * before the link is stored (#1033), and stricter than Hamilton's takedown rule
 * (`unconfirmed_document_host`, hamilton/other-bank-document.ts): whole words only, short
 * same-name hosts are read, and a shared name needs the city or certificate number.
 * Returns why, or null when the document may be kept.
 * Another institution's own website is refused at `recordDiscoveryResult`, which can look it up.
 */
export function unconfirmedDocumentHost(
  input: Omit<NamedBank, "websiteHost"> & { url: string; websiteUrl: string | null | undefined; text: string | null | undefined },
): string | null {
  const host = urlHost(input.url);
  const own = urlHost(input.websiteUrl);
  if (!host || !own) return null;
  if (host === own || host.endsWith(`.${own}`) || own.endsWith(`.${host}`)) return null;
  if (SHARED_CONTENT_HOST.test(host)) return null;
  const label = hostLabel(own);
  if (label.length >= SAME_NAME_MIN_CHARS && hostLabel(host) === label) return null;
  if (input.text && textNamesBank(input.text, { ...input, websiteHost: own })) return null;
  return `${host} is not the bank's website (${own}) and the document does not name the bank`;
}

/** Where a failed shared-name read is recorded: the run (and step) that needed it. */
export interface SharedNameLedger {
  runId: number;
  stepId?: number | null;
}

/**
 * The ids among `banks` whose name (`comparableBankName`) another institution also has, or
 * appears as whole words inside another institution's name ("american national bank" in
 * "first american national bank", #1309); the "credit union" form of a federal credit union's
 * name counts too, either way round ("rivertown credit union" is shared with "rivertown federal
 * credit union", #1320), since `textNamesBank` accepts it. When the read fails, every bank is
 * treated as shared (a name alone then never confirms a document) and, given a `ledger`, the
 * failure is written to the run's events.
 */
export async function loadSharedNameIds(
  db: SqlTag,
  banks: ReadonlyArray<{ id: number | string; institution_name: string | null | undefined }>,
  ledger?: SharedNameLedger,
): Promise<Set<number>> {
  const shared = new Set<number>();
  if (banks.length === 0) return shared;
  let rows: Array<{ id: number | string; institution_name: string | null }>;
  try {
    rows = await inSavepoint(db, (scope) => scope<Array<{ id: number | string; institution_name: string | null }>>`
      -- institution names for the shared-name check
      SELECT id, institution_name FROM institution_sources WHERE institution_name IS NOT NULL
    `);
  } catch (error) {
    console.error("loadSharedNameIds failed:", error);
    if (ledger) await recordSharedNamesUnread(db, ledger, banks.length, error);
    return new Set(banks.map((bank) => Number(bank.id)));
  }
  const names: Array<{ id: number; name: string }> = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = comparableBankName(row.institution_name);
    if (name) names.push({ id: Number(row.id), name });
  }
  for (const bank of banks) {
    const id = Number(bank.id);
    const name = comparableBankName(bank.institution_name);
    if (!name) continue;
    const forms = creditUnionForms(name);
    const held = names.some(
      (other) =>
        other.id !== id &&
        creditUnionForms(other.name).some((otherForm) =>
          forms.some((form) => otherForm === form || (form.length >= 6 && otherForm.includes(form) && hasWords(otherForm, form))),
        ),
    );
    if (held) shared.add(id);
  }
  return shared;
}

/** A name and, for a federal credit union, its short "credit union" form (`textNamesBank` reads both). */
function creditUnionForms(name: string): string[] {
  return [...new Set([name, name.replace(" federal credit union", " credit union")])];
}

async function recordSharedNamesUnread(db: SqlTag, ledger: SharedNameLedger, banks: number, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${ledger.runId}, ${ledger.stepId ?? null}, 'magellan.shared_names_unread', 'info',
        ${`Could not read institution names for the shared-name check; all ${banks} bank(s) this step need their city or certificate number`},
        ${JSON.stringify({ banks, error: message.slice(0, 500) })}::jsonb
      )
    `);
  } catch (logError) {
    console.error("recordSharedNamesUnread failed:", logError);
  }
}

/** SQL for the host of an address column, matching `urlHost`. */
export function hostSql(column: string): string {
  return `regexp_replace(lower(substring(${column} from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?([^/:?#]+)')), '^www\\.', '')`;
}

export interface OtherBankAtHost {
  institutionId: number;
  institutionName: string;
  stateCode: string | null;
  host: string;
}

/**
 * The institution whose own website is the host of `url`, when that is not `institutionId`'s
 * own website. Null when the address is on this bank's site or on no institution's site.
 */
export async function otherInstitutionAtHost(
  db: SqlTag,
  institutionId: number,
  url: string | null | undefined,
): Promise<OtherBankAtHost | null> {
  const host = urlHost(url);
  if (!host) return null;
  // The host pattern is `hostSql`, written out because a tagged query can't splice SQL text.
  const rows = await db<{ id: number | string; institution_name: string; state_code: string | null }[]>`
    SELECT other.id, other.institution_name, other.state_code
      FROM institution_sources other
     WHERE other.id <> ${institutionId}
       AND other.website_url IS NOT NULL
       AND regexp_replace(lower(substring(other.website_url from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?([^/:?#]+)')), '^www\\.', '') = ${host}
       AND NOT EXISTS (
         SELECT 1 FROM institution_sources own
          WHERE own.id = ${institutionId}
            AND own.website_url IS NOT NULL
            AND regexp_replace(lower(substring(own.website_url from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?([^/:?#]+)')), '^www\\.', '') = ${host}
       )
     ORDER BY other.id
     LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    institutionId: Number(row.id),
    institutionName: row.institution_name,
    stateCode: row.state_code,
    host,
  };
}
