import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";

import { onBankDomain, websiteHost } from "./link-coverage";
import { hostLabel, SHARED_CONTENT_HOST_PATTERN, urlHost } from "./other-bank-host";
import { MAX_SITE_DOMAINS, usableSearchHost } from "./web-search-tool";

type SqlTag = typeof sql;

/**
 * Other hosts a bank is known to own (#1251, item 2): a host where the bank's own stored
 * documents sit that is not its stored website. Without them a site-limited paid search runs
 * only on the stored website, and an answer on the bank's newer domain fails `onBankDomain`.
 *
 * Read-only on production, 2026-10-14: for 69 of 4,651 active institutions under $10B, the URL
 * of Magellan's latest successful find sat on a different host from the stored website. 57
 * active institutions under $10B had a stored document on a host they clearly own:
 * machiassavings.com and machiassavings.bank, healthplusfcu.com and .org,
 * cashmerevalleybank.com and cvb.bank, pinnaclebank.com and vallant.bank.
 *
 * A host counts only when all of these hold, so a file host or another bank's site never does:
 * - one of the bank's own documents was fetched from it (`source_documents`, status success);
 * - no other institution has a document on it, and it is no other institution's website;
 * - it is not the website itself or a subdomain or parent of it, and not a shared file or site
 *   builder host (`SHARED_CONTENT_HOST_PATTERN`);
 * - it has the website's name with another ending (6+ characters: "machiassavings"), or it is a
 *   `.bank` domain, which only verified banks can register.
 */

const SHARED_CONTENT_HOST = new RegExp(SHARED_CONTENT_HOST_PATTERN);
/** Shortest website name that may match on name alone ("cinfed.org" and "cinfed.com"). */
const SAME_NAME_MIN_CHARS = 6;

/** Pure: is `candidate` another host the bank with this website owns? */
export function bankOwnedHost(candidate: string, website: string | null | undefined): boolean {
  const own = website ? websiteHost(website) : null;
  if (!own || !usableSearchHost(candidate)) return false;
  if (candidate === own || candidate.endsWith(`.${own}`) || own.endsWith(`.${candidate}`)) return false;
  if (SHARED_CONTENT_HOST.test(candidate)) return false;
  if (candidate.endsWith(".bank")) return true;
  const name = hostLabel(own);
  return name.length >= SAME_NAME_MIN_CHARS && hostLabel(candidate) === name;
}

/** Is `url` on the bank's own domain (`onBankDomain`) or on one of its other own hosts? */
export function onBankHosts(url: string, website: string, ownHosts: readonly string[]): boolean {
  if (onBankDomain(url, website)) return true;
  const host = urlHost(url);
  return host != null && ownHosts.some((own) => host === own || host.endsWith(`.${own}`));
}

/**
 * The other own hosts of each bank, read in one query for a paid step's banks. An empty map
 * when the read fails: the searches then run on the stored website, as before #1251.
 */
export async function loadOwnHosts(
  db: SqlTag,
  banks: ReadonlyArray<{ id: number | string; website_url: string | null | undefined }>,
): Promise<Map<number, string[]>> {
  const hosts = new Map<number, string[]>();
  const ids = [...new Set(banks.map((bank) => Number(bank.id)).filter((id) => Number.isFinite(id)))];
  if (ids.length === 0) return hosts;
  let rows: Array<{ institution_id: number | string; host: string | null }>;
  try {
    // Inside a savepoint, so a failed read does not abort the step's transaction. The host
    // expression is `hostSql` (other-bank-host.ts), written out because a tagged query can't
    // splice SQL text.
    rows = await inSavepoint(db, (scope) => scope<Array<{ institution_id: number | string; host: string | null }>>`
      -- bank-owned document hosts
      WITH own AS (
        SELECT DISTINCT doc.institution_id,
               regexp_replace(lower(substring(doc.document_url from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?([^/:?#]+)')), '^www\\.', '') AS host
          FROM source_documents doc
         WHERE doc.institution_id = ANY(${ids}::bigint[])
           AND doc.status = 'success'
           AND doc.document_url IS NOT NULL
      )
      SELECT own.institution_id, own.host
        FROM own
       WHERE own.host IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM institution_sources other
            WHERE other.id <> own.institution_id
              AND other.website_url IS NOT NULL
              AND regexp_replace(lower(substring(other.website_url from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?([^/:?#]+)')), '^www\\.', '') = own.host
         )
         AND NOT EXISTS (
           SELECT 1 FROM source_documents doc
            WHERE doc.institution_id <> own.institution_id
              AND doc.status = 'success'
              AND regexp_replace(lower(substring(doc.document_url from '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?([^/:?#]+)')), '^www\\.', '') = own.host
         )
    `);
  } catch {
    return hosts;
  }
  const websites = new Map(banks.map((bank) => [Number(bank.id), bank.website_url]));
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = Number(row.institution_id);
    const host = row.host?.trim().toLowerCase() ?? "";
    if (!host || !bankOwnedHost(host, websites.get(id))) continue;
    const list = hosts.get(id) ?? [];
    if (!list.includes(host) && list.length < MAX_SITE_DOMAINS - 1) list.push(host);
    hosts.set(id, list.sort());
  }
  return hosts;
}
