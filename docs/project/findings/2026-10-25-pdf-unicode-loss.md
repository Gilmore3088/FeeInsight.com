# 2026-10-25: a PDF's Unicode map loses letters before Rosetta layout (#2598)

**Lesson:** Treat damaged words or numbers as unreadable evidence, even when a PDF
looks readable and two layout readings agree. Never guess that U+FFFD means "ti".

**Status:** Code prevention, an offline visual-recovery preview and an executed
three-document pilot, not a deployment or live repair. #2598 remains open. No production mutation, pipeline execution,
provider call, fee rename, refile or takedown was performed in this investigation.

## Earliest reproducible fault

Base inspected: `9a0444ef39a677ac19c7e29619473f5cb5fc5bab` on main.
Issue #2598 is open with no comments. Searches found no open Rosetta PR and no
ligature branch. PR #911 is earlier downstream name-retidy work, not this fix.

Reliance State Bank, institution 2521, document 31383, text 29159, published fee
140286: the bank-hosted PDF downloads to SHA-256
`e1468b1d3f3eacf88e447b1089a901d8531d10bdb925a105b914b86d8e712617`, exactly
the captured source hash. The unmodified PDF is a regression fixture with provenance.

The failure is already in the source PDF, not a newly introduced string replacement
in `pdf-layout.ts`:

1. The embedded Calibri-Bold `/ToUnicode` CMap explicitly contains
   `<019F> <FFFD>`. The regular Calibri map contains both `<019F> <FFFD>` and
   `<014C> <FFFD>`.
2. Raw pdf.js `getTextContent()` returns
   `Wire Interna\uFFFDonal Transfer-Remote Outgoing`, with normalization on or off.
   An independent pypdf extraction returns the same replacement. Therefore changing
   pdf.js compatibility normalization or applying NFKC cannot recover these letters.
3. Rosetta's layout preserves that string. `normalizeWhitespace` strips NUL and
   whitespace, not these letters; the connection's text serializer also only strips NUL.
4. The rendered schedule visibly prints the international remote outgoing wire at
   $70.00, distinct from the domestic remote outgoing wire at $40.00. Both are marked
   with the schedule's sales-tax footnote. It also prints "overdrafts" where the
   decoded text reads `overdra\uFFFDs`: a global U+FFFD-to-ti replacement is false.
5. These embedded subset fonts contain no `cmap`, `GSUB` or `post` table. There is
   no semantic font-map recovery established here. Glyph outlines remain renderable;
   they are not an authority to guess text from a fixed glyph ID across fonts.

The original maps and exact source bytes establish the fault before any Rosetta
layout. The causal pipeline defect is accepting this damaged text as completed
evidence and allowing extraction to act on a missing category word.

The bank-hosted Glendale (document 28625) and Merck Sharp & Dohme (document 2240)
PDFs also match their captured SHA-256 hashes. Independent extraction reproduces
their damaged words too. The earlier claim that Rosetta itself replaces the
ligature is thus too specific: confirmed for Reliance is a broken **source CMap**.

## Dated scope measurement

Read-only production census at **2026-10-25 15:21:52 UTC (08:21:52 Pacific)**.
The [inventory JSON](../evidence/2026-10-25-pdf-unicode-loss-inventory.json)
retains the counts, reader split and three reported lineages; the
[prepared SQL](../evidence/2026-10-25-pdf-unicode-loss-inventory.sql) describes selection.

| Screen | Count | Interpretation |
|---|---:|---|
| Stored text artifacts | 29,788 | Denominator, not a fee-accuracy audit |
| Texts containing any U+FFFD | 219 at 77 institutions | Multiple causes; not all ligatures |
| Current completed matching source copies among those texts | 125 | Source hash agrees; neither duplicate nor superseded |
| PDF-layout texts containing any U+FFFD | 44 | Broader PDF screen, including isolated marks |
| Current completed matching PDF texts with U+FFFD touching alphanumerics | 30 | Historical candidates for this guard, not 30 proven ti errors |
| Live names containing U+FFFD | 15 across 8 documents | Visible-name symptoms |
| Live fees traced to any flagged text | 497 | Potential exposure, not 497 wrong fees |
| Live fees traced to inline-corrupted texts, all formats | 336 | Includes HTML; not a PDF-only impact count |

There are 152 HTML-DOM, 16 JS-fallback, 44 PDF-layout, 2 plain-text and 5 legacy
artifacts in the 219. HTML charset decoding and isolated symbols need their own
diagnosis; this PDF guard does not claim to solve them. The census is deterministic,
not a random sample or a statistical accuracy grade. It misses corruption expressed
as other Unicode characters, which belongs to the existing font-map work.

The optimized read-only inventory SQL materializes the cheap replacement-character
screen before the regex. Earlier broad-regex and per-document repeated catalog
queries timed out; the optimized two-phase export succeeded at **09:08 Pacific**:
30 candidate documents and a baseline of **227 live fees across 16 of those documents**.
The [repair manifest](../evidence/2026-10-25-pdf-unicode-loss-repair-manifest.json)
records every candidate's text/source identity and vault key, and every baseline
fee's published/raw/verified IDs, category, price, unit, audience, variant, waiver,
conditions and event lineage. These are potential exposure and preservation baselines,
not 227 wrong fees. The candidate and fee exports were separate read-only snapshots
(16:08:12 and 16:08:43 UTC); their identities must be checked again before any write.

## Focused correction

- `pdf-text-integrity.ts` refuses U+FFFD adjacent to a Unicode letter or number,
  including adjacency exposed when the existing normalizer removes NULs. Isolated
  marks/leaders and valid Unicode ligatures are outside this scoped rejection.
- `extractPdfDocumentText` checks reconstructed page text after split items join,
  before emitting hashes or agreement/geometry receipts. The drawing-order check
  shares pdf.js's text map; agreement alone cannot detect this failure.
- `read.ts` also checks injected/alternate parsers and linked PDF reads. A primary
  PDF integrity error returns `needs_ocr` / `parse_error`, with a full-page visual
  transcription explanation and no completed corrupt text. It does not send the
  bank to Magellan or run the image-only scan reader on a logo. Linked fallback
  candidates with this error are refused through the existing fallback diagnostics.
- Failed replay/reread keeps the incumbent. No verified or published row is
  modified by this guard. The error is not a corrected name or category.
- `ROSETTA_READ_VERSION` moves from 3 to 4 as required for a reader change. Existing
  PR #2620 merged on Oct 25: its bounded replay lane now reaches older-reader
  completed documents regardless of fee count. The former thin-text-only limit
  is superseded. Layout version stays 5 because the geometry did not change.

**Release consequence:** v4 uses the existing global primary-reader version, so a
deployment also makes older HTML, plain-text, DOCX and legacy primary reads eligible,
not just these PDF candidates. The existing lane limits each read step to 4 replay
documents and retains incumbent text on failure, but fee-line counts alone are not
proof that a replacement preserved every valid fee. Keep this change in draft;
review the complete owner-query backlog and rollout before production deployment.

## Safe historical reprocessing and category verification

1. **Freeze an explicit manifest, read only.** Export each candidate's institution,
   document and current text IDs; capture/source and normalized-text hashes; reader
   versions, source URL, current-copy state and vault key. Export its published IDs
   and raw/verified lineage, names, categories, amounts, units, audience, products,
   waivers and qualifiers in a separate bounded catalog read. Count distinct
   documents and fees. Before a write, also snapshot all raw and verified rows for
   those sources, including valid unpublished observations and their exact text/hash
   lineage; the 227 published baselines are not a complete all-tier preservation
   snapshot. Separate older-hash observations and held/invalid rows for review rather
   than declaring them valid from a row count. Inventory superseded/duplicate/paid-reader sources separately
   when they still carry live fees; the replay selector does not cover all history.
2. **Read the exact captured bytes without replacing anything.** Require a valid
   content-addressed vault object and verify its SHA-256; missing/mismatched bytes
   remain unavailable. A fresh URL download is not historical evidence unless its
   hash matches. Render the whole relevant page; use full-page OCR or an approved
   visual transcription. Existing image-only Tesseract reads page images, not text
   glyphs, and is insufficient for Reliance. No paid pass is run under this code PR.
   For each proposed repaired word keep page, bounding area/line, visual evidence,
   reader and reviewer provenance. Do not rewrite a CMap by guessing from CID 019F.
3. **Stage a complete candidate reading and reconcile every fee.** Retain incumbent
   bytes/text and hashes. Run Knox's pure extraction and Darwin's source/category
   checks against the staged text; compare every baseline fee individually. Require
   its own label/amount pairing, direction, product, unit, frequency, audience and
   waiver/threshold context. A missing valid fee, an unexplained amount or qualifier
   change, or unresolved duplicate fails the document, even if total fee count rose.
   Record additions, unchanged fees, visually supported renames/refiles and proposed
   removals separately. Reconcile the complete printed schedule too, so a valid fee
   missing from the old extraction can be added. Reliance's $20 outgoing, $40 remote
   outgoing, $50 international outgoing and $70 international remote outgoing are
   distinct source statements; a shared canonical category must not collapse their
   channel/qualifier differences. Review the complete diff before an authorized ledger run.
4. **Reverify category against the original rendered schedule, separately from price.**
   For 140286, the printed international remote outgoing wording supports
   `wire_intl_outgoing`, $70.00, with the remote variant and tax qualifier retained;
   it is not evidence for changing every $70 domestic wire. The test proves that
   the shared source predicate accepts $70 and rejects $40 on that line, while the
   category guard rejects domestic and accepts international for the verified name.
   For 133140, the page must still establish *domestic only*, $20; do not turn every
   repaired ti into international. For 144304, verify the cashier's-check stop-payment
   row and $25 in its own column; its stored name also includes a cross-column prefix,
   which a character repair alone cannot justify removing.
5. **Authorize and execute the concrete data diff separately.** Verify the bank's
   currently effective schedule before publishing; the exact archived 2024 Reliance
   PDF proves this incident, not today's effective pricing. Use current semantic
   tables and normal Rosetta -> Knox -> Darwin -> Gutenberg run-ledger boundaries,
   source checks and witness capture, with document/text/source-hash rechecks at
   write time so a stale manifest cannot overwrite a newer good read. Do not delete
   prior raw, verified or published evidence. A corrected category/name can have a
   different raw identity: explicitly account for the old wrong row, or both fees
   can remain live. Refiles/retirements require their own verified diff and approval.
   Take snapshots and a rollback plan before the authorized transaction/run.
6. **Verify after the authorized run.** Require zero unexplained losses of valid
   baseline fees, zero unresolved duplicate predecessors, all approved corrections
   source-grounded and category-checked, and correct source/text/run lineage. Recount
   corrupted names and document backlog, inspect public institution/category outputs
   and benchmark membership, and report changed, unchanged, blocked and unavailable
   separately. Failure/unchanged replay receipts are not repaired-document counts.

The existing `recordReadResult` transaction/witness boundary preserves exact old and
new normalized bytes when the capability is present. Witnesses are diagnostic only:
do not manufacture missing historical text, change their authority, or seed a fake
past read. Code rollback does not undo an authorized data repair; retain receipts
and review a separate data rollback if that later becomes necessary.

## Regression evidence

**Guard:** `pdf-unicode-source.test.ts`, `pdf-text-integrity.test.ts`,
`pdf-document-text.test.ts`, `read.test.ts`, `reader-replay.test.ts`.
**Agent lesson:** rosetta/issue-2598-pdf-unicode-loss

Tests cover exact captured source bytes, raw pdf.js with normalization on/off,
unrecoverable ti/ft ambiguity, split PDF items, corrupted numbers and accented words,
NUL-separated damage, intact ligatures/qualifiers, parser disposal, no corrupt
completed artifact, no image-only OCR call, and retaining an incumbent even when the
damaged replay has more fee lines. Source matching and category verification have
separate assertions. The rendered fixture was visually inspected; independent
pypdf and font-table inspection were local diagnostic checks, not runtime dependencies.

Validation after integrating main `fcf91f4`: full Vitest 1,314 files passed,
88 files skipped; 17,550 tests passed, 12 expected failures and 1,225 gated skips.
The focused seven-file pass, including outcome registration, passed 128 tests.
Agentic on the original base: 1,867 passed, 3 skipped. Repository guards passed
again on the integration. Full original-base lint: zero errors, 71 warnings;
changed-file lint also passed. `tsc --noEmit` passed on the integration with
`NODE_OPTIONS=--max-old-space-size=4096`; the default 2 GiB heap had exhausted memory.
No local native database-test connection was configured; those local skips are
not native-SQL evidence.

GitHub's real-schema CI exposed three fixtures pinned to reader 3: paid-read
eligibility, normalized-witness paid setup and stacked-repair readiness/receipts.
They now seed/assert `ROSETTA_READ_VERSION` for the current free pass, without
weakening the runtime gate. A paired native case checks that an older free read
cannot unlock paid work and a current free read can. The exact runtime head
`b8b3247` passed all eight checks in CI run 40209292611, including all 82 native
database files / 1,187 tests. The receipt is recorded in PR #2632, separately
from the local unit counts above.

## Offline visual-recovery preview and executed pilot

`pdf-unicode-preview.ts` renders full pages, including font glyph outlines, rather
than reading only embedded images. The development-only native canvas dependency
is compatible with unpdf's optional peer range; no route, runtime OCR reader or
deployment tracing configuration calls this preview. The earlier text-only parse
can install an empty DOMMatrix shim; the preview replaces that incomplete shim
before rendering, and the real-source regression exercises that import order.

The preview reads a damaged page at 240 and 300 dpi with the bundled local English
Tesseract model. These are two scales of **one engine**, not independent readers;
confidence scores are heuristics. Every damaged internal word occurrence needs an
OCR spelling inside its original horizontal, same-font source cell, retaining all
known letters, with confidence at least 85 at both scales and at least 90 at one.
Unknown prefixes/suffixes, numbers, conflicting maps, ambiguous/weak witnesses and
nonhorizontal text remain unresolved. A dictionary never supplies missing letters.

Only missing letters are substituted into the original layout. A historical
proposal additionally binds the incumbent's source hash and exact text hash and
applies the same literal repairs to that incumbent's existing geometry. Conflicting
document-wide maps or excess incumbent occurrences refuse it. An incomplete
document gets **no complete incumbent proposal**, even when its target fee's word
was recovered. Every output says `review_required`; none is a persisted witness,
successful replay event or permission to publish. Limits: 20 MB input, 150 total
pages, two damaged pages, 100,000 text items, 1,000,000 characters, 9,000,000 pixels
per rendering and 60 seconds per preview. Cancellation destroys the parser,
cancels a render and terminates the OCR worker. Default OCR requires a local model;
the report records its gzip SHA-256 and each grayscale rendering's SHA-256.

Reproduce without database credentials or network source fetching, after `npm ci`:

```sh
node --import tsx scripts/rosetta-unicode-preview.ts \
  src/lib/agents/rosetta/test-fixtures/reliance-unicode-loss.pdf \
  e1468b1d3f3eacf88e447b1089a901d8531d10bdb925a105b914b86d8e712617 \
  /tmp/reliance-unicode-preview.json
```

An optional fourth argument names local JSON containing `text`, `sha256` and
`sourceSha256` from a read-only incumbent export. Output files cannot be overwritten.
This is a local preview, not an alternative production runtime or repair script.

The [executed pilot](../evidence/2026-10-25-pdf-unicode-loss-preview-pilot.json)
contains the exact three source hashes, incumbent texts/hashes rechecked read-only
at **2026-10-25 17:34:07 UTC**, raw and partial proposed layouts, per-word confidence,
render/model hashes, unresolved words and all **57** baseline fee comparisons
(Merck 23, Glendale 11, Reliance 23). The fee baseline is still the earlier
16:08:43 UTC snapshot; these are separate observations, requiring revalidation.
Partial incumbent substitutions retain all known characters and all 57 existing
name/price diagnostic matches, with zero such regressions. Those matchers already
accept the damaged names and Merck's crossed-column prefix: passing them does not
verify the name, category, units, audience, waivers or current effectiveness.

| Reported fee | Captured-page evidence and pilot | Remaining review |
|---|---|---|
| 140286 | `Interna�onal` -> `International`, confidence 93 at both scales; $70 remote outgoing, distinct $40 domestic remote outgoing. Existing category guard rejects domestic and proposes `wire_intl_outgoing`. | Reliance's `Automa�c` lacks a complete witness at 300 dpi (`utomatic`); full document remains incomplete. Sales-tax footnote and all other valid fees must survive. |
| 133140 | `domes�c` -> `domestic`, confidence 94/95; original page says outgoing domestic only, $20. Existing category stays `wire_domestic_outgoing`. | Glendale's terminal `Overdra�` is outside this internal-letter rule; full document remains incomplete. |
| 144304 | Original right-column row visibly states `Cashier’s Check Stop Payment Fee`, $25/check; category remains `stop_payment`. | Merck's `automa�c` is unresolved; its live name also borrows unrelated text from the left-column free excessive-withdrawal note. Letter recovery cannot delete that prefix or correct the cross-column geometry. Full document remains incomplete. |

All three previews are incomplete and produce no complete incumbent replacement.
The 30-document candidate manifest remains the recovery inventory; this pilot is
not a verified repair of 57 fees or an audit of all 227 exposed baselines. Finish
the unresolved page transcription and per-fee reconciliation described above before
an authorized ledger run. Production persistence still needs the transactional
source/text compare-and-swap and persisted-witness binding already required by the
repair procedure; no production recovery integration is claimed here.

On the final integration with main `a4c0eed`, the Rosetta directory passed 23 files /
279 tests (8 native database files / 108 tests were gated locally). The final
three Unicode files passed 22 tests, including real rendering/local OCR after a
text parse, cancellation during OCR, stale/mismatched lineage and refusal of
network-model fallback. Repository guards, changed-file lint and the lockfile
dry-run check passed. Preview head `08e3811` passed all eight checks in CI run
40218403136, including both unit shards, the real rendering/OCR regression and
82 native database files / 1,188 tests. The final main integration keeps Rosetta's
code unchanged, adopts main's identical Ask compatibility mapping (no unrelated
file remains in the PR diff), and still needs its own CI receipt before any merge
decision. That final receipt belongs in PR #2632, without rewriting this dated one.
