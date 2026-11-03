# 2026-11-03: The PDF reader read sideways pages across their lines, so words joined and fees lost their amounts

**What happened:** while scoring Internet Archive copies for the source-bytes replay (#2974,
`findings/2026-11-03-archived-source-bytes.md`), the 2026-03-17 capture of Georgia United FCU's
truth-in-savings disclosure (answer key state:60) had exactly the sha256 the seed records. It is the
file the key was made from. Today's `read.pdf_layout` read of it still failed the same-document test
(token 0.8181, number 0.9535, dollars differ), and its text joined words the frozen text keeps
apart ("averagebalance", "withdrawalaccount"). The document had not changed. The reader's output
had.

**Cause: rotated text, not a word-gap threshold.** All 4 pages carry `/Rotate 90`, and every one of
the file's 1,308 text items is drawn at the matrix [0, s, -s, 0, x, y]: each line runs up the page,
and its baseline is a constant x. `pdf-layout.ts` groups items into lines by y and orders them by x.
It assumes upright text, so it read the page across its lines:
- The first words of stacked lines that start at the same height became one "line". In the rate
  table's "Average / Daily / Balance" cell, "Average" (x 227.82, y 612.36) and "Balance" (x 246.18,
  y 612.78) share a y; "Daily" starts lower and went to another line.
- An item's width runs along y, but the reader measures the gap along x. The gap from "Average"
  (end 227.82 + 29.13) to "Balance" (246.18) is negative, so no space went between them:
  "AverageBalance". Two cells that each print "Account withdrawal" became
  "Account withdrawalAccount withdrawal".
- The fee schedule's names and amounts never shared a line.

**When:** it has been there since layout v1 (`ef8fc04da`, Oct 4), the change that replaced
`read.pdf_text` (pdf.js text in drawing order) with `read.pdf_layout`. No later layout version
introduced it. Each version's `pdf-layout.ts`, from git history, was run on the capture's items:

| Reader | Token | Number | Dollars | Joined-word tokens |
|---|---|---|---|---|
| Drawing order (`read.pdf_text`'s `extractText`) | 1 | 1 | equal | 0 |
| Layout v1 `ef8fc04da` to v6 `f84064101` (each) | 0.8181 | 0.9535 | differ | 140 |
| v6 with `PDF_TEXT_DIRECTION_LIVE` on | 1 | 1 | equal | 0 |

The frozen text is the drawing-order reading, word for word. The key's stored text was written
before layout v1, or by a reader that kept drawing order.

**Joined-word metric.** A token of the re-read (the same-document test's `normalisedTokens`:
lower-case letters, digits and decimals) that is not a token of the frozen text, but equals two
adjacent frozen tokens put together. Occurrences are counted. The metric is exact for this defect,
and it never counts a word that is merely misspelt.

**Blast radius, measured offline:**
- Every PDF fixture in `src/lib/agents/deming/__fixtures__/source-bytes/` (18 on main), plus the
  state:60 capture: 19 documents with frozen texts.
- The capture is the only sideways document, with 140 joined tokens. The 18 fixtures score 0
  joined tokens on every layout version. One of them, texas:2451, holds 117 sideways items among
  5,476, too few to turn any page.
- With the switch on, each of the 18 reads byte for byte as it does off.
- **The live count is not known.** The audit has no PDF bytes. From this PR on, every PDF read
  records the sideways pages it finds (`detail.pdf_text_direction`), and dry-run section 10 counts
  them (see below).

**What it costs Knox (state:60, local run on the capture's bytes).** state:60 is not in the replay,
because its re-read fails the same-document test (and #2974 is not merged). So its result comes
from a local run of `replaySources` on the capture, with a temporary test that is not committed. It
uses the same keys, frozen manifest and `currentVariant`:

| Text | Answer-key fees published (of 36) | Published outside the key |
|---|---|---|
| Frozen (drawing order) | 30 | 0 |
| Today's re-read (switch off) | 0 | 0 |
| Re-read, switch on | 22 | 0 |

- Switch on against off: 22 keys gained, 0 lost, nothing new outside the key.
- Switch on against the frozen text: 9 keys lost, 1 gained (the $250 drill fee).
- The 14 keys still missed with the switch on are in fee cells set over 2 or 3 lines with the
  amount beside the middle line ("NSF / $35.00/Item (each / submission/resubmission)"; the minimum
  balance fees). This is the upright layout reader's wrapped-cell limit, the same on any upright
  page, and not part of this defect.

**Fix:** `src/lib/agents/rosetta/pdf-text-direction.ts`, behind `PDF_TEXT_DIRECTION_LIVE` (off).
- **Evidence:** each item's own text matrix. An item counts as a quarter turn only when its
  off-axis part is at most 2% of its size; slanted text has no vote.
- **When it acts:** a page is turned only when more than half of its characters run in one
  non-upright quarter turn. Then every item's position and matrix are turned back by that quarter
  before `layoutPageResult` groups lines.
- **Upright pages:** returned untouched, the same array, so their text is byte for byte unchanged.
- **No word list:** nothing splits words by dictionary.
- **Record:** `extractPdfDocumentText` returns `textDirection` (sideways pages, whether they were
  turned, bound to the text hash). The read attempt stores it as `detail.pdf_text_direction`,
  whatever the switch.

**Tied to a PDF-only reader version (`PDF_READ_VERSION`, `reader-versions.ts`, v1).** Flipping a
reader switch changes only texts read after the flip, and no existing version replays every PDF:
- `PDF_LAYOUT_VERSION` replays only texts with a cell break (`PDF_CELL_REPLAY_LIVE`), and a
  sideways page's text need not hold one.
- `ROSETTA_READ_VERSION` would replay every HTML page too.

So `PDF_READ_VERSION` follows `HTML_READ_VERSION` (#2971, `findings/2026-11-02-html-reader-version.md`):
- Every `read.pdf_layout` read records `detail.pdf_read`; none counts as v1.
- Above v1, reader replay makes each current completed `read.pdf_layout` text due once. No
  cell-break filter, and no other reader's text. A read of its bytes at the version, or a receipt
  with `pdf_read_version`, settles it.
- At v1 the branch is left out of the SQL, so the selection is the same text as on main.
- `reader-replay.test.ts` fails if `PDF_TEXT_DIRECTION_LIVE` flips without the bump to v2.

**Measured (switch off against on):**
- **Source-bytes replay** (38 documents on main, `source-replay-pdf-text-direction.md`): recall
  898 / 1,187 on both sides, 0 keys gained, 0 lost, outside-key publications 29 and 29. No PDF in
  the replay has a sideways page, so this shows only that the switch is inert there. state:60 is
  reported above, separately.
- **Frozen-text lab:** not moved. A reader switch cannot change stored text.
- **Unchanged and passing:** `test:shadow-lab` (ratchet included), `test:quality-gates`, the golden
  gate.

**Live effect:**
- **Now (switch off, `PDF_READ_VERSION` 1):** text is unchanged for every document. Two
  record-only additions: `detail.pdf_read: 1` on PDF reads, and `detail.pdf_text_direction` when a
  read finds a sideways page. The replay selection SQL is unchanged.
- **Dry-run section 10 (`npm run audit:switch-dry-runs`):** counts the current `read.pdf_layout`
  documents the flip's bump would re-read (their live fees too), and how many of those read since
  this change have a sideways page.
- **Before the flip:** run the dry run once PDF reads have recorded direction for a while, and
  check the sideways documents' live fees.
- **With the flip and the bump:** every current `read.pdf_layout` text is re-read once, 4 a read
  step. The lost-text rule keeps a stored text unless the new one lists at least as many fees.
- **Once the flip lands:** the state:60 capture passes the same-document test (1 / 1 / equal) and
  can join the source-bytes replay.

**Lesson:** read a PDF's text in the direction the file draws it. When the original bytes fail a
same-document test, suspect the reader before the document.

**Guard:** `src/lib/agents/rosetta/pdf-text-direction.test.ts`:
- a page built upright, then drawn at each quarter turn, reads exactly as the upright page;
- off, it shows the joined words;
- an upright page with a sideways margin note is unchanged;
- Knox reads the sideways page's fees with their own amounts.

`src/lib/agents/deming/shadow-lab/source-replay.test.ts` (experiment `pdf-text-direction`) checks
that every upright fixture PDF reads byte for byte the same on and off.
`src/lib/agents/rosetta/reader-replay.test.ts` and `reader-replay.db.test.ts` check the version.

Agent lesson: rosetta/issue-1092-read-sideways-pages-along-their-lines. Tracker: #1092.
