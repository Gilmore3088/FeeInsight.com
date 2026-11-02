import { looksLikeBotChallenge } from "./site-signals";
import { THIRD_PARTY_HOST_PATTERN } from "./web-search-tool";
import { checkHomepage, websiteOrigin } from "./website-find";
import { hostNamesInstitution } from "./website-owner";

/**
 * Whose site did the homepage redirect land on? (Nov 2 pipeline wiring audit, gap 8.)
 *
 * Before this check, `recordDiscoveryResult` saved every cross-domain landing
 * as the bank's `website_url`, ahead of the registry's website, without asking whose site it
 * was. Prod on 2026-11-02: 303 institutions had a recorded cross-domain landing (Oct 5 - Nov 1)
 * and 285 of them now carry the landing host. Most are real rebrands ("cbibt.com" ->
 * "cbibt.bank"), but the landing was also a bot wall (`validate.perfdrive.com`, First National
 * Bank Texas and Vystar FCU), a lapsed domain parked elsewhere (`expireddomains.com`,
 * `tallautosales.com`, `drbamawlibrary.org`), a university or city site (`southalabama.edu`,
 * `peoriagov.org`), a developer copy (`jamestown2dev.wpengine.com`) or a cloud bucket
 * (`wwwmaxwellstate.z19.web.core.windows.net`). Every finder trusts the stored website after
 * that, so a wrong landing became the bank's site for good.
 *
 * The search still follows the redirect (a rebranded bank's schedule is on its new site). What
 * changes is the save: the landing replaces the stored website only on proof that it is this
 * institution's own site, checked in this order:
 *  - refused, never saved (`not_own_site`): a host that is no institution's own site
 *    (`websiteOrigin`'s list, `THIRD_PARTY_HOST_PATTERN`) or a subdomain of a hosting provider,
 *    site builder or file store (`HOSTING_HOST`, anchored suffixes only). It runs first, so a
 *    stored social or site-builder host never proves its sibling;
 *  - `same_domain`: the landing shares the stored website's registrable domain
 *    ("online.acmebank.com" for "acmebank.com");
 *  - a bot challenge page proves nothing either way: `unproven`;
 *  - `host_names_own`: the landing host spells out this institution's distinctive name
 *    (`hostNamesInstitution`), only when no other institution has the same name;
 *  - `homepage_names_own`: the landed homepage names the institution and its city or charter
 *    number (website search's own `checkHomepage`).
 * Anything else is `unproven`. Every judgement is recorded on the discover attempts
 * (`detail.moved_to_proof`, `moved_to_proof_reason`, `moved_to_saved`), so its prod dry count can
 * be read from `pipeline_attempts`.
 *
 * Offline dry run over the 303 recorded landings (2026-11-02; the session's egress could not read
 * bank homepages, so the homepage and challenge legs were not run): 42 `same_domain`, 80
 * `host_names_own` (all 80 read by hand as the bank's own rebrand or parent), 4 `not_own_site`
 * (both perfdrive bot walls, the wpengine copy, the Azure bucket: 4 of 4 wrong), 176 left to the
 * homepage check.
 */
export const REDIRECT_WEBSITE_PROOF_VERSION = 1;

/**
 * The `unproven` leg. On: a landing that could not be proven (the homepage check failed, or the
 * landing served a bot challenge) is not saved and the stored website is kept. Off (the default
 * until the leg's prod dry count, read from `detail.moved_to_proof = 'unproven'`, is sampled
 * clean): it is saved as before. A proven landing is always saved and a `not_own_site` landing
 * never is, either way: that one is judged on the host alone, which the offline dry run covered
 * in full.
 */
export const REDIRECT_WEBSITE_PROOF_LIVE = false;

/**
 * A hosting provider's, site builder's or file store's own domain: a subdomain of one is a copy of
 * a site or a file bucket, never the bank's address. Anchored on the whole suffix. The document-host
 * pattern (`SHARED_CONTENT_HOST_PATTERN`) matches substrings such as "cms", "static" or "assets"
 * and would refuse real bank hosts (cmsbank.com, firstassets.org), so it is not used here.
 */
const HOSTING_HOST =
  /(^|\.)(windows\.net|azurewebsites\.net|azureedge\.net|amazonaws\.com|cloudfront\.net|googleusercontent\.com|appspot\.com|firebaseapp\.com|web\.app|digitaloceanspaces\.com|akamaihd\.net|herokuapp\.com|netlify\.app|vercel\.app|pages\.dev|github\.io|wpengine\.com|wpenginepowered\.com|squarespace\.com|wixsite\.com|wixstatic\.com|weebly\.com|godaddysites\.com|hubspotusercontent[a-z0-9-]*\.net)$/;
const THIRD_PARTY_HOST = new RegExp(THIRD_PARTY_HOST_PATTERN);

export type RedirectWebsiteProof =
  | "same_domain"
  | "host_names_own"
  | "homepage_names_own"
  | "not_own_site"
  | "unproven";

export interface RedirectWebsiteInstitution {
  id: number | string;
  institution_name: string;
  city?: string | null;
  state_code: string | null;
  cert_number?: string | number | null;
  /** Another institution has this name: a host spelling it out proves nothing. */
  name_shared?: boolean;
}

export interface RedirectWebsiteJudgement {
  proof: RedirectWebsiteProof;
  /** True when the landing may replace the stored website. */
  proven: boolean;
  reason: string;
}

/**
 * The registrable domain of a host: its last two labels, or last three under a two-letter
 * country's short suffix ("bank.co.uk"). The same rule as Darwin's document-owner check.
 */
export function registrableDomain(host: string): string {
  const labels = host.split(".");
  const last = labels[labels.length - 1] ?? "";
  const second = labels[labels.length - 2] ?? "";
  const keep = labels.length >= 3 && last.length === 2 && second.length >= 2 && second.length <= 3 ? 3 : 2;
  return labels.slice(-keep).join(".");
}

function bareHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

/** Pure: is the redirect's landing (`landed`, its homepage `html`) this institution's own site? */
export function judgeRedirectWebsite(input: {
  institution: RedirectWebsiteInstitution;
  stored: URL;
  landed: URL;
  html: string;
}): RedirectWebsiteJudgement {
  const from = bareHost(input.stored);
  const to = bareHost(input.landed);
  if (!websiteOrigin(input.landed.toString()) || THIRD_PARTY_HOST.test(to) || HOSTING_HOST.test(to)) {
    return { proof: "not_own_site", proven: false, reason: `${to} is a third-party, file or hosting host, not an institution's own site` };
  }
  if (registrableDomain(from) === registrableDomain(to)) {
    return { proof: "same_domain", proven: true, reason: `${to} is under ${registrableDomain(from)}, the stored website's domain` };
  }
  // A challenge page shows nothing of the site behind it: a real rebrand behind Cloudflare is not
  // refused, it is left unproven (behind `REDIRECT_WEBSITE_PROOF_LIVE`).
  if (looksLikeBotChallenge(input.html)) {
    return { proof: "unproven", proven: false, reason: `${to} served a bot challenge page, so its homepage could not be read` };
  }
  const institution = input.institution;
  if (!institution.name_shared && hostNamesInstitution(to, { ...institution, city: institution.city ?? null, cert_number: institution.cert_number ?? null })) {
    return { proof: "host_names_own", proven: true, reason: `${to} spells out ${institution.institution_name}` };
  }
  const check = checkHomepage(
    {
      id: institution.id,
      institution_name: institution.institution_name,
      city: institution.city ?? null,
      state_code: institution.state_code,
      charter_type: null,
      cert_number: institution.cert_number ?? null,
    },
    input.html,
  );
  if (check.ok) return { proof: "homepage_names_own", proven: true, reason: check.reason };
  return { proof: "unproven", proven: false, reason: `${to} is not shown to be this institution's site: ${check.reason}` };
}
