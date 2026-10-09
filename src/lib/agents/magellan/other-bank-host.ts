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
