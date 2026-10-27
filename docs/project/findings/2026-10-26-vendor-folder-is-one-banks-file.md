# 2026-10-26: one credit union's vendor file became four other credit unions' schedule

**Lesson:** a path that opens one institution's file is not a path for another bank, even when
the other bank's own site serves it. A website vendor's file folder (`/files/<folder>/<n>/file/`)
is named for its owner's website, so it names whose file it is, whatever host it was read from.

**What happened (#1455):** the original three cases (5756, 4884, 1903; 52 fees) are down: on
Oct 26 none of them has a live fee (read-only SQL on `published_fee_catalog`). The same class, an
institution carrying another institution's schedule from its own stored website, was still live
through a CU website vendor that serves every member's files on every member domain:

| Institution | Document (live fees) | Whose file it is |
|---|---|---|
| 7353 Family First FCU, Saginaw MI | fam1st.com/files/sunrisefamilycu/1/file/Fee-Schedule-11-2025.pdf, doc 33252 (26) | 7367 Sunrise Family FCU, Bay City MI |
| 6428 Beach Municipal FCU, Virginia Beach VA | beachmunicipal.org/files/sunrisefamilycu/..., doc 35311 (26) | 7367 |
| 7078 Alhambra FCU, Phoenix AZ | alhambracu.com/files/sunrisefamilycu/..., doc 38341 (26) | 7367 |
| 7662 First Pace FCU, West St Paul MN | firstpacecu.com/files/sunrisefamilycu/..., doc 37139 (24) | 7367 |

Each text opens "Sunrise Family Credit Union Fee Schedule | Current, effective 11/01/2025" and
names none of the four. 6721 Advance Financial FCU holds a fifth copy (doc 39439, no live fees; its
text did not decode).

**Cause, in order:**
1. Magellan's platform learning (`platform-learning.ts`) counts every bank's fee link as a path to
   try at other banks on the same platform, filtered only by `isReusablePath` (no dated folder, no
   long id). `/files/sunrisefamilycu/1/file/Fee-Schedule-11-2025.pdf` passed. Sunrise's link
   produced live fees, so `discover.peer_hint` tried the path on fam1st.com (Oct 14) and the vendor
   served Sunrise's PDF there. With two banks holding it, it became a learned platform path for
   every Fiserv site, and `discover.platform_paths` found it on beachmunicipal.org (Oct 15),
   firstpacecu.com (Oct 17) and alhambracu.com (Oct 19).
2. The other-bank checks read only the host. Each copy was on that CU's own stored website, so
   `unconfirmedDocumentHost` and `otherInstitutionAtHost` passed it.
3. Darwin's document-owner check knew only `ezs3download` and `kcms-doc` as vendor paths. The two
   copies that share Sunrise's text hash (7353, 6428) were capped at `shared_service` because they
   sat on the bank's own site; the two whose text hash differs (7078, 7662) linked to no one and
   were never read as another bank's.

**Fix:**
- Magellan (the process): `isReusablePath` refuses a vendor file folder (`vendorFileFolder`,
  `VENDOR_FILE_FOLDER_PATH`) and an upload GUID; `addPathFacts` learns nothing from a link whose
  path spells its own website's name (`pathNamesOwnSite`, 6+ characters); `rankPlatformPaths`
  drops seeds that fail `isReusablePath` (the registry holds a Kentico `/getmedia/<guid>/` file).
  `otherInstitutionAtHost` also names the institution whose website's name is the link's vendor
  folder, when this bank's website does not carry that name, so discovery, hand-supplied links and
  operator schedules refuse it as `other_bank_host`.
- Darwin (the live re-check), behind `DARWIN_DOCUMENT_OWNER_FOLDER_LINKS` (off): the document-owner
  selector links the institution whose website label is the folder (`via = 'folder'`); the
  vendor-copy rule reads folder owners with the text-hash sharers; the text must still print the
  owner's name. Pairs with a folder link get their own fingerprint (`:folder`), so the switch
  re-reads them, and the publish refusal reads that fingerprint too. Off, every pair and verdict is
  as before. The takedown path is the existing one (12-hour second look, archived, never deleted).

**Dry run (prod, read-only, Oct 26, `documentOwnerCountSql({ detail: true, folderLinks: true })`):**
four `other_bank` pairs, 102 live fees, all Sunrise's file (7353 26, 6428 26, 7078 26, 7662 24);
no other pair is `other_bank`, and no other pair is folder-linked. 8578 LAFCU's own
`/files/lafcu/1/file/...` (13 live) names the folder of its own website lafcu.com, so it is never
linked to 4522 Los Angeles FCU (lafcu.org), as in Magellan's check; the folder is read case-blind. Sample of 12 (3 per institution): Bad Address $5.00, Check Cashing (non-members)
$10.00 and Courtesy Pay/Overdraft $25.00 each appear in the stored text, which names Sunrise
Family Credit Union, and in Sunrise's own copy (doc 28370 on sunrisefamilycu.org). On Magellan's
side, only Sunrise's folder matches another institution's website among stored documents, apart
from 6745's `usfcu.com/files/usfcu/` copy, which the host rule already refers to 4882.

**Not covered:** 5286 Jackson Area FCU's 31 live fees on fivestarcu.com (Five Star FCU, 8431, after
a merger) are the merged credit union's real current prices, read as `own_named` on the menu's
"Jackson welcome"; that is a registry status question (merged records still active), not another
bank's document, and stays open on #1455. The four CUs keep their stored `fee_schedule_url` until
the switch takes the fees down and `releaseOwnerLinks` releases the link.

**Guard:** `src/lib/agents/magellan/site-signals.test.ts`, `src/lib/agents/magellan/platform-learning.test.ts`,
`src/lib/agents/magellan/other-bank-host.test.ts`, `src/lib/agents/magellan/website-owner.db.test.ts`,
`src/lib/agents/darwin/document-owner.test.ts`

**Agent lesson:** magellan/issue-1455-a-vendor-folder-is-one-banks-file

**Agent lesson:** darwin/issue-1455-a-file-folder-names-its-owner
