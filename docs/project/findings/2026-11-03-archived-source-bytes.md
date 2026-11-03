# 2026-11-03: Internet Archive copies for the three answer-key pages that changed

**What happened:** the source-bytes replay (`findings/2026-11-02-lab-replays-source-bytes.md`,
#2939) left out three holdout documents because the bank's live page no longer passed the
same-document test: state:9308 (St. Cloud; its rates changed), state:11477 (4Front; a different page
now) and state:60 (Georgia United; today's PDF reading joins words). state:9308 holds 22 of the
lab's 44 R3 misses (several prices or items in one cell;
`findings/data/2026-11-02-lab-misses-by-root-cause.json`). Without its bytes, an HTML cell fix
could not be measured. The Internet Archive keeps dated copies of public pages, so its captures of
the same three URLs were scored against the frozen text, using the same test with its thresholds
unchanged.

**Result:** 1 of 3 recovered.
- **state:11477 (4Front): accepted.** The 2026-09-01 capture of the seed URL scores token 0.9954,
  number 1, dollars equal. Every price matches. Only a promotional banner differs. The 2026-06-11
  capture also passes. The later one, closer to the key's making (2026-10-06), is kept. Neither
  capture is the stored copy the key was made from: the seed's sha256 is a different one.
- **state:9308 (St. Cloud): rejected.** The archive lists two captures of `scfcu.org/rates-fees`
  (2023-07-30 and 2025-02-09) and no other spelling of the page. Both print different rates and
  dollar amounts: token 0.901 and number 0.7724 for 2025, token 0.6674 and number 0.5582 for 2023.
  The live page (number 0.9164) remains the closest copy, and it fails too. Its 22 R3 misses cannot
  be replayed.
- **state:60 (Georgia United): rejected, although these are the original bytes.** The 2026-03-17
  capture of the seed URL (version `_413`) has exactly the sha256 the seed records for this key, so
  it is the document the key was made from. It still fails (token 0.8181, the same score as the
  live copy): today's `pdf_layout` read of it joins words the frozen text keeps apart
  ("averagebalance", "withdrawalaccount"). The document is unchanged; the reader's output changed.
  The test was not relaxed for it. The case stays out, and the word joining is a reader question in
  its own right.

Each score, the capture URL, the CDX digest and the sha256 are in
`src/lib/agents/deming/__fixtures__/source-bytes/manifest.json`. An accepted copy has
`fetchedWith: "archive"` and an `archive` block. A rejected entry has `archiveTried` and
`archiveNote`. The fixture `state-11477.html.gz` adds 13,740 bytes (61,822 before gzip).

**Replay** (`npm run test:shadow-lab`, `source-replay.md` and `source-replay-html-row-pairing.md`,
same keys on both sides). On `main` before this change, the re-read recall was 898/1,187, and
914/1,187 with `HTML_ROW_PAIRING_LIVE` on. With 4Front added:

| Measure | Frozen text | Re-read, switch off | Re-read, switch on |
|---|---|---|---|
| Documents | 39 of 55 holdout (39 of the 41 lab cases) | same | same |
| Recall: answer-key fees published | 923 / 1,216 | 922 / 1,216 | 938 / 1,216 |
| Published fees not in the answer key | 29 | 29 | 30 |

4Front scores 24 of 29 on every side, and the switch does not move it. Its 5 misses are R5 (4) and
R8 (1). None of the R1 to R4 misses becomes replayable, so the R3 count on replayable documents is
still 22 of 44: the 13 at state:7450, 5 at state:3554, 2 at state:11470 and 2 at state:3141.

**St. Cloud's R3 rows, read-only** (live page fetched 2026-11-02 US Pacific, plus the 2025-02-09 capture;
neither is the frozen document, but each prints the same row labels):
- The 22 misses sit on 10 table rows. Each row is a `<tr>` with two `<td>`. The label cell holds a
  bold heading, then a `<ul>` with one `<li>` for each item. The price cell holds a `<br/>`, which
  stands in for the heading, then a `<ul>` with one `<li>` for each price.
- 17 of the 22 misses are on 8 rows where both cells hold the same number of items. 16 are on 7
  rows built from `<ul><li>` items (cashier's check and stop payment, rush card, safe deposit boxes,
  foreign check and collection, NSF / courtesy pay / deposit item return, checking maintenance,
  international wire). 1 is on a row built from `<br>` lines (notary).
- 5 misses are on 2 rows where the counts differ. Check cashing (4 misses) has 5 label items over 4
  prices, with a nested `<ul>` under "Non-Members". The international ATM fee (1 miss) has 3 label
  items over 2 prices.
- Main's `read.html_dom` writes each such row as one line ("Safe Deposit Boxes 3 x 5 3 x 10 … |
  $18.00 a year $30.00 a year …"), the same as the frozen text. With `HTML_ROW_PAIRING_LIVE` on,
  the text is byte-for-byte the same, because row pairing reads only `<div>` rows, not lists inside
  a table cell.

**Fetch** (2026-11-02, US Pacific; plain HTTP, nothing behind a login):
- Index: `curl -s "https://web.archive.org/cdx/search/cdx?url=<url>&output=json"`, then a
  `matchType=domain&collapse=urlkey` listing to look for other spellings of the page.
- Capture: `curl -s -L -o <file> "https://web.archive.org/web/<timestamp>id_/<url>"`. The `id_`
  form returns the bytes the bank's server sent the crawler, with no Wayback toolbar, and no archive
  markup was found in the accepted file. Each file's SHA-1 equals the CDX digest.
- Score: `readSourceBytes` then `similarity` and `sameDocument` (`source-bytes.ts`), unchanged. The
  scoring probe was a temporary test file and is not committed, because `scripts/` holds only
  read-only audits and nothing here is needed at runtime.

**Lesson:** a dated public archive can stand in for a page that changed, through the same test
with nothing relaxed. The test also rejects the original bytes when today's reader reads them
differently (Georgia United), so a rejection means the re-read is not the frozen text, which is
not always a sign that the document changed.

**Guard:** `src/lib/agents/deming/shadow-lab/source-bytes.test.ts`. Every archive copy names its
raw capture URL, its sha256 and its score, and is re-read to that score. Every archive capture
tried for a rejected case fails the test. Every holdout document is still listed once. It measures
and never gates. Tracker: #1092.
