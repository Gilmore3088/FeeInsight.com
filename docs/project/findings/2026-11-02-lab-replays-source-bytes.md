# 2026-11-02: The shadow lab re-reads the answer-key documents from their public bytes

**What happened:** the lab's answer-key cases (`missed_fees`) replay the text Rosetta stored when the
keys were made, so a change to how Rosetta reads structure (heading levels, table cells, `<br>`
sub-lines, two-column PDFs) could not move any lab number
(`findings/2026-11-02-lab-misses-by-root-cause.md`). Production `source_documents` and the vault are
not reachable from a session. The holdout documents are public fee schedules, so their bytes were
fetched once from the banks' own websites and committed.

**Coverage:** 38 of the 55 holdout documents reproduce. They are 38 of the 41 that the lab replays as
answer-key cases. Of the other 17:
- 14 are Texas keys marked as not a fee schedule (`is_fee_schedule: false`). The lab leaves them out
  of `missed_fees`, so they were not fetched.
- 3 changed after they were frozen and are rejected, with nothing put in their place: state:60
  (Georgia United; same form number, but today's PDF reading joins words, token similarity 0.8181),
  state:11477 (4Front; a different page now, 0.7463) and state:9308 (St. Cloud; its rates changed,
  number similarity 0.9164).

**Where the links came from:** 37 links are in the answer-key seed migration
(`20270110000018_answer_key_seed.sql`), whose notes name the stored text each key was made from. For
4 keys the seed names another stored copy at the same bank (River City, Dieterich, Tandem, Summit),
and the similarity check decided whether it is the same document.
- Summit's seed link now redirects to the November 2026 schedule. Its rates changed (number
  similarity 0.9329), so it is a `rejected` manifest entry, and the October 2026 PDF on the bank's own
  site is the accepted copy.
- Dieterich (state:7623) refuses a plain fetch (403), so its page was fetched with the pre-installed
  Playwright Chromium. The bytes kept are the page as the server sent it, not the rendered DOM. It is
  a later revision of the frozen page: effective 10/26/2026 against the frozen 10/1/2024. Every price
  is the same. The continuous overdraft row and its footnote now name business accounts, one footnote
  adds a pointer to the Terms and Conditions, and two rows moved. It passes the test and is kept, with
  that difference written on its manifest entry.
- Marquette (state:12816) and DLP (state:7517) print a date that changes with each fetch (October 5
  frozen, November 2 fetched). Nothing else differs.

**Same-document test** (`source-bytes.ts` `sameDocument`, deterministic): the bytes go through
Rosetta's primary reader, then the re-read is compared with the frozen text on lower-case word and
number tokens.
- Multiset Dice on all tokens must be at least 0.90.
- Multiset Dice on number tokens must be at least 0.95.
- The text must print the same list of dollar amounts.

The two Dice thresholds were set before any score was read. The dollar-list rule was added after the
scores were seen. The PR's reviewer confirmed that it changes no accept or reject outcome.

Every score is in `src/lib/agents/deming/__fixtures__/source-bytes/manifest.json`, which also holds
each document's sha256, source URL, final URL, fetch time and fetch method. It also records the
HTTP request (user-agent and headers) and the Chromium settings, and marks "not recorded" what was
not kept (the Chromium user-agent).
`source-bytes.test.ts` re-reads every fixture in CI and checks that it gets the same score.

**Fetch:** a one-time local fetch on 2026-11-02, with the output committed as fixtures. The
fetching code is not in the repo, because `scripts/` holds only read-only audits and the fetch wrote
files. Anyone can repeat it from the manifest's URLs. Public documents only; nothing behind a login.
The 38 gzipped fixtures take 5,327,602 bytes (8,511,298 before gzip).

**Re-read:** `readSourceBytes` follows `readCandidate`'s offline path: the format from the bytes,
then `extractPdfDocumentText`, or `decodeTextBytes` plus `extractHtmlDomText`, then
`normalizeWhitespace`. A page that would need the JavaScript fallback or OCR is refused, not read
another way. No Rosetta, Knox, Darwin or Hamilton code changed.

**Limits:**
- The replay models only Rosetta's primary read. The JavaScript fallback, the playbook's skips and
  reader escalation, and OCR are not modelled. A document that needs one of them in production is
  read here as its primary reader reads it, or refused.
- The HTML fixtures are pages as served, so they contain public page tokens: nonces, a
  `SOSSessionID` and a Sitefinity public `apiKey`. None is a credential. The repo has no
  secret-scanner allowlist file, so none was added.

**Result** (`source-replay.test.ts`, same keys on both sides, current pipeline):

| Measure | Frozen text | Re-read |
|---|---|---|
| Recall: answer-key fees published | 898 / 1,187 (75.7%) | 897 / 1,187 (75.6%) |
| Published fees not in the answer key | 30 | 30 |
| False publication | no forbidden fees on these cases | no forbidden fees on these cases |

- Today's readers return exactly the frozen text on 23 of the 38 documents. The frozen texts are
  therefore mostly today's readers' own output, and the structure losses are still in those readers.
- On the 15 texts that differ, 6 keys are lost and 5 are gained. The Texas legacy texts move most:
  texas:841 drops from 26 to 23, texas:2451 from 24 to 23, and state:2017 rises from 25 to 28.
- Of the 159 hand-labelled R1 to R4 misses in these 38 documents, 148 are still missed on the re-read
  (153 on the frozen text):
  - R1, category only in a heading: 53 (39 PDF, 14 HTML)
  - R2, label and price in separate HTML blocks: 41
  - R4, interleaved PDF columns: 32
  - R3, several prices or `<br>` items in one cell: 22

  All 32 R4 misses stay missed with today's pdf-layout. They are the next PR's target, and the lab
  can now measure a fix for them.

**Lesson:** to measure a reader, the lab must replay the reader's input, not its output. When the
input store is out of reach, the public document can stand in for it, but only after a stated
same-document test, with every rejection listed.

**Guard:** `src/lib/agents/deming/shadow-lab/source-bytes.test.ts` (sha256, the same re-read
score, every holdout document listed once) and `source-replay.test.ts` (repeatable, no provider
calls). It measures and never gates. The ratchet baseline is unchanged and does not read the
re-read. Agent lesson: deming/issue-1092-replay-the-readers-input.
