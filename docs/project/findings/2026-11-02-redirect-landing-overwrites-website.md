# 2026-11-02: A homepage redirect's landing replaced the stored website without a check

**What happened:** The Nov 2 pipeline wiring audit (gap 8, "Official website is not kept from the
registry") found that Magellan overwrote `institution_sources.website_url` with wherever a homepage
redirect landed. `recordDiscoveryResult` wrote `website_url = COALESCE(movedTo, ...)`, and `movedTo` was
set on any cross-domain landing, ahead of the registry's website and ahead of a person's correction
lock. No step asked whose site the landing was.

**Prod evidence (read-only, 2026-11-02):** 303 institutions have a discover attempt with
`detail.moved_to` (Oct 5 - Nov 1), and 285 of them now store the landing host as their website.
Most are real rebrands (`cbibt.com` to `cbibt.bank`, `civistabank.com` to `civista.bank`). Some are
not the institution's site at all:

- bot walls: `validate.perfdrive.com` (First National Bank Texas, Vystar FCU);
- a developer copy and a cloud bucket: `jamestown2dev.wpengine.com` (Bank of Jamestown, 5 live fees on
  that host), `wwwmaxwellstate.z19.web.core.windows.net` (Maxwell State Bank);
- lapsed domains parked elsewhere: `expireddomains.com` (School Employees FCU), `tallautosales.com`
  (Holy Redeemer Community FCU), `drbamawlibrary.org` (Mahoning Valley FCU);
- other organisations' sites: `southalabama.edu` (University of South Alabama FCU), `peoriagov.org`
  (Peoria City Employees FCU).

1,534 live fees at 105 of the 303 institutions come from documents on the landing host (published
fees with `rolled_back_at` and `quarantined_at` null, joined to `source_documents.document_url`). By
the offline judgement below: 192 at `same_domain` landings, 349 at `host_names_own`, 5 at
`not_own_site` (the wpengine copy), 962 at 59 institutions whose landing needs the homepage check, and
26 at one institution whose stored website holds two addresses and could not be parsed.

**Cause:** The redirect-following code (`discovery.ts`, "A redirect to another domain (rebrand,
merger): search the site it lands on") was written for rebrands, and its only output was the save.
Website repair, the website-owner review and the website search each judge a website before trusting
it, but none of them saw the redirect.

**Fix:** `src/lib/agents/magellan/redirect-website.ts` (`REDIRECT_WEBSITE_PROOF_VERSION` v1). The search
still follows the redirect. First, a social or bot-wall host, or a subdomain of a hosting provider,
site builder or file store (anchored suffixes only: `*.wpengine.com`, `*.windows.net`,
`*.amazonaws.com` and the like), is never saved, even under the stored website's own domain. The
document-host pattern (`SHARED_CONTENT_HOST_PATTERN`) is not used: it matches substrings ("cms",
"static", "assets", "homecu") and would refuse real bank hosts such as cmsbank.com. Then the landing
replaces `website_url` only when it shares the stored website's registrable domain, its host spells
the institution's distinctive name (and no other institution has that name), or the landed homepage
names the institution and its city or charter number (`checkHomepage`, the website search's own
check). A bot challenge page proves nothing either way: a rebrand behind Cloudflare is `unproven`,
not refused. Every judgement is recorded on the discover attempt (`detail.moved_to_proof`,
`moved_to_proof_reason`, `moved_to_saved`).

**Dry run:** Offline over the 303 recorded landings (the session's egress refused bank homepages,
so the homepage and challenge legs could not be run): 42 `same_domain`, 80 `host_names_own` (all 80
read by hand as the bank's own rebrand or its parent company's site), 4 `not_own_site` (all 4 wrong),
176 left to the homepage check, 1 unparseable stored website. The `not_own_site` refusal is judged on
the host alone, so it ships on. The `unproven` leg (a landing the homepage check cannot prove, or a
challenge page) is behind
`REDIRECT_WEBSITE_PROOF_LIVE`, off: until its prod count from `detail.moved_to_proof = 'unproven'` is
sampled clean, an unproven landing is still saved as before.

**Not changed:** No stored website is corrected here, and no fee is held, rejected or re-filed, so no
Darwin re-check is needed. The 285 landings already saved stay as they are. The website search
already picks up a stored perfdrive or social host (`storedWebsiteIsThirdPartySql`) and the
website-owner review a host shared with another institution, but nothing yet re-judges the other
saved landings (the wpengine copy, the Azure bucket, the parked domains): that is a follow-up, run
through this same proof, not a hand edit. The FDIC and NCUA registry loaders, which
fill only an empty website or store none, belong to another thread. The fee-document domain check
(it accepts file hosts, same-name hosts and pages that name the bank) is a separate follow-up.

**Guard:** `src/lib/agents/magellan/redirect-website.test.ts`, `src/lib/agents/magellan/discovery.test.ts`
("a redirect's landing replaces the stored website only on proof").

**Agent lesson:** magellan/audit-2026-11-02-a-redirect-landing-is-not-yet-the-website
