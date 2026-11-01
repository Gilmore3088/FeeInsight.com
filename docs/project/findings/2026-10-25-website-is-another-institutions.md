# 2026-10-25: a stored website was another institution's, and every finder trusted it

**Lesson:** a stored website is a claim, not a fact. When another active institution outside the
holding company stores the same website host, read the homepage and ask whose it is before
searching it; a website whose homepage names another institution (and not this one) is never
searched, never counted as this institution's own host, and goes back to the website search.

**What happened (#1455):** the registry seed (2026-02-15) stored other institutions' websites:

| Institution | Stored website | Whose it is |
|---|---|---|
| 5756 Bluegrass Community FCU, Ashland KY | ukcreditunion.org | 6729 University of Kentucky FCU, Lexington |
| 4884 Metrowest Community FCU, Framingham MA | stmaryscu.org | 8298 St. Mary's CU, Marlborough |
| 1903 First National Bank, Oldham SD (Fulda Bcorp) | firstnationalbanks.bank | 582 First National Bank, Fort Pierre SD (Capitol Bcorp) |

Magellan's finders (discovery, the companion finder, the business search, the paid schedule search)
all start from `institution_sources.website_url`, so they found the other institution's schedule
there (Oct 5-18). The other-bank check (`otherInstitutionAtHost`) passes a link whose host is this
bank's own website, and here it was both banks' website, so nothing stopped it. 52 fees went live;
Darwin's document-owner check (#1489, #1741) took them down after publishing. On Oct 25 none of the
three holds a live fee, but the websites were unchanged and 1903 still had four companions on
Fort Pierre's site, one found by the paid schedule search on Oct 18.

**Cause:** nothing asked whose website a stored website is. Website search (`website-find.ts`)
already refuses a host another institution uses and checks the homepage names the institution and
its city or charter number, but only for websites it finds itself; seeded websites were never
checked.

**Fix:**
- `src/lib/agents/magellan/website-owner.ts`: each discover step (not rescue) reviews up to 5
  active institutions whose website host another active institution also stores, outside one
  holding company (same RSSD), once per version per host every 30 days (7 when unread). It reads
  the homepage once and applies website search's own `checkHomepage` to this institution and each
  one sharing the host. `other_institution` needs positive evidence: the homepage passes the check
  for exactly one other institution and not this one, or names one other's distinctive words and
  none of this one's. Both named is `shared`, neither is `unclear`, an unreadable homepage is
  `unread`; none of these flag anything. A host that spells this institution's own name or its
  holding company's name is its own without a read. Each review is a `discover.website_owner`
  attempt (`website_host`, `verdict`, `owner_id`, the name checks, the live fees on the site) and a
  `magellan.website_owner` run event; the step detail carries `website_owners`.
- `websiteOwnedElsewhereSql` (`other-bank-host.ts`) is the one flag: the latest non-unread verdict
  for the current website host is `other_institution`, and no person's correction is locked. The
  discovery selectors, the companion finder, the paid schedule search and the paid find skip such
  banks; `otherInstitutionAtHost` no longer counts the flagged host as the bank's own, so a link
  there is refused as `other_bank_host` (it also names an active owner before a closed record).
- Website search takes flagged institutions too and may replace the flagged website with a homepage
  that names the institution and its city or charter number; it still refuses a host another
  institution uses.

**Renamed banks:** Pinnacle Bank, Elberton GA (543) has documents on vallant.bank under the same
upload path as pinnaclebank.com. Doc 12678 (vallant.bank) has the same content hash as doc 270
(pinnaclebank.com) and prints www.pinnaclebank.com; doc 31210 is the same schedule rebranded
"Vallant Bank"; the registry's holding company is Vallant Financial Inc. It is a rename served by a
redirect, the same institution. No other institution stores vallant.bank, so the review never
selects it, and a host that spells the holding company's name ("vallant") is its own even if
another record shared it. Its 29 live fees (doc 12678) are untouched.

**Dry run (prod, read-only, Oct 25):** the selector picks 26 active institutions on 13 hosts. The
homepages could not be fetched from the session, so verdicts are expected, not measured: from stored
copies, 1903 (Fort Pierre's branch list, no Oldham), 4884 and 5756 should be flagged, with 0 live
fees on the flagged sites. Other likely flags: 5286 Jackson Area FCU on fivestarcu.com (Five Star
CU's site, with a "Jackson Welcome" page after a merger; 31 live fees from that site, which Darwin's
document-owner check calls `own_named` on the menu's "Jackson") and 4027 Battle Bank on
stearnsbank.com (0 live fees). Shared or merged sites whose homepage names neither record
(originscu.org for Energy Plus and Harvester Financial) stay unflagged. No fee is held or taken down
by this change, so it needs no Darwin re-check; the live fees on a flagged site are counted on its
attempt (`live_fees_on_site`) for a document-owner follow-up.

**Not covered:** the live fees of an institution whose website turns out to be another's (5286's 31)
stay live: Darwin's document-owner check judges each document. Registry rows for merged credit
unions still listed active (4884, 5286, likely 5756) are a registry status question.

**Guard:** `src/lib/agents/magellan/website-owner.test.ts`, `src/lib/agents/magellan/website-owner.db.test.ts`,
`src/lib/agents/magellan/discovery.test.ts`. **Agent lesson:** magellan/issue-1455-whose-website-is-it.
