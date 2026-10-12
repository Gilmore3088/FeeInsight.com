import type { sql } from "@/lib/data-store/connection";

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

/** Does this text tie a document to the bank (its website, the website's name, or its own name)? */
export function textNamesBank(text: string, bank: { websiteHost: string; institutionName?: string | null }): boolean {
  const lower = text.toLowerCase().replace(/\s+/g, " ");
  if (lower.includes(bank.websiteHost)) return true;
  const label = hostLabel(bank.websiteHost);
  if (label.length >= 4 && lower.includes(label)) return true;
  const name = comparableBankName(bank.institutionName);
  if (name.length < 6) return false;
  return lower.includes(name) || lower.includes(name.replace(" federal credit union", " credit union"));
}

/**
 * A document on a host that is neither the bank's website (or a subdomain), nor a shared file
 * host, nor a host with the website's name (healthplusfcu.org and .com), and whose text does not
 * name the bank: Hamilton's `unconfirmed_document_host` rule (hamilton/other-bank-document.ts),
 * applied before the link is stored (#1033). Returns why, or null when the document may be kept.
 * Another institution's own website is refused at `recordDiscoveryResult`, which can look it up.
 */
export function unconfirmedDocumentHost(input: {
  url: string;
  websiteUrl: string | null | undefined;
  institutionName?: string | null;
  text: string | null | undefined;
}): string | null {
  const host = urlHost(input.url);
  const own = urlHost(input.websiteUrl);
  if (!host || !own) return null;
  if (host === own || host.endsWith(`.${own}`) || own.endsWith(`.${host}`)) return null;
  if (SHARED_CONTENT_HOST.test(host)) return null;
  if (hostLabel(host) === hostLabel(own)) return null;
  if (input.text && textNamesBank(input.text, { websiteHost: own, institutionName: input.institutionName })) return null;
  return `${host} is not the bank's website (${own}) and the document does not name the bank`;
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
