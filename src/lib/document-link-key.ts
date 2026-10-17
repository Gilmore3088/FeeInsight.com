/**
 * #1347: one key for "the same page", shared by Deming's link-mismatch count and Hamilton's link
 * drift pass. It lives outside both agents so neither imports the other's module graph.
 */

/**
 * Query parameters that change how a page is shown or tracked, never which page it is
 * ("?print=1", "&output=amp", "utm_source"). On Oct 17 (read-only) every one of the 1,233 live
 * links that differed from their document's URL only in the query differed in these.
 */
export const PRESENTATION_PARAM = String.raw`print|output|utm_[a-z_]+|gclid|fbclid|mc_[a-z_]+`;

/**
 * #1347: a link's key for "the same page": lower case, no scheme, no "www.", no default port, a
 * space and "%20" alike, no fragment, no presentation parameters and no trailing slash. Two links
 * with one key open the same page. On Oct 17 (read-only), 587 live links differed from their
 * document's URL only by ":443" or by "%20" written as a space. `documentLinkKeySql` is its
 * Postgres twin, the one the check runs.
 */
export function documentLinkKey(url: string | null | undefined): string | null {
  const raw = url?.trim();
  if (!raw) return null;
  return raw
    .toLowerCase()
    .replace(/#.*$/, "")
    .replace(/^https?:\/\/(?:www\.)?/, "")
    .replace(/^([^/?]+):(?:443|80)(?=[/?]|$)/, "$1")
    .replaceAll("%20", " ")
    .replace(new RegExp(String.raw`([?&])(?:${PRESENTATION_PARAM})=[^&]*`, "g"), "$1")
    .replace(/\?&+/g, "?")
    .replace(/&{2,}/g, "&")
    .replace(/[?&]+$|\/+(?=\?|$)/g, "");
}

/** Postgres twin of `documentLinkKey` for the SQL expression `column`. */
export function documentLinkKeySql(column: string): string {
  return `regexp_replace(regexp_replace(regexp_replace(regexp_replace(replace(regexp_replace(regexp_replace(regexp_replace(
            lower(${column}), '#.*$', ''), '^https?://(www\\.)?', ''), '^([^/?]+):(443|80)(?=[/?]|$)', '\\1'), '%20', ' '),
            '([?&])(${PRESENTATION_PARAM})=[^&]*', '\\1', 'g'),
            '\\?&+', '?', 'g'), '&{2,}', '&', 'g'), '[?&]+$|/+(?=[?]|$)', '', 'g')`;
}
