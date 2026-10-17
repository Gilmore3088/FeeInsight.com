# 2026-10-17: Hamilton answer presentation contract (DRAFT for James's review)

**Status:** draft. Nothing here is approved. H05-T02 (#980) needs James's review of this contract
and its screenshots before the T03 consolidation that implements it merges (roadmap 4.12).

**What happened:** a fixture baseline of every Ask answer state (H05-T01) found the same fact set
in different ways on different answer branches, and two layouts that a phone could not read
without scrolling sideways. All figures and names in the fixtures are invented; no customer data
and no production sign-in were used.

**Cause:** each answer branch (memo, storyline, schedule scorecard, segment table, written answer,
peer list) grew its own heading, figure-tile and table styles. A site-wide `.tabular-nums` rule in
`src/app/globals.css` switches to Geist Mono, so any table that used that class drew its figures in
a second face.

**Fix:** this contract, plus the H05-T03/T06 changes on branch `acct2/hamilton-h05-presentation`
(shared primitives in `src/components/hamilton/memo/memo.tsx`, regression test
`src/components/hamilton/memo/answer-primitives.test.tsx`). Not merged.

**Lesson:** an answer branch draws its lead, figures, section headings, exhibits and sourced
findings through the shared primitives below, never with local text classes.

## How the screenshots were made

A local `next dev --webpack` server rendered the answer components with fixtures on a temporary
route that was never committed. Playwright (the pre-installed Chromium) captured each state at
320, 390, 768 and 1440px and at 200% zoom (a 720px viewport at device scale 2). The Ask loading,
written and error states ran the real `AnalyzeWorkspace`, with `/api/hamilton/ask` and
`/api/research/hamilton` answered by Playwright (a held request, a stubbed written answer, a 500).
No provider was called. The dev server was run with the page's content security policy bypassed
in the test browser only (dev mode needs `eval`).

Everything is in `/mnt/project-files/acct2/hamilton-presentation-2026-10-17/`:

- `before-<state>-<width>.png`: the baseline (H05-T01), 12 states by 5 widths.
- `after-<state>-<width>.png`: the same states on the current branch head, captured again after
  the batch review: `MemoPage` at its production default width, widths 320, 390, 768, 1024, 1440
  and 200% zoom, plus `peer-list-pages` (a 160-row list with its pager and CSV range) and
  `clarify-composer` (Analyze's one-composer clarification with a stubbed engine question).
- `compare-<state>-<width>.png`: before and after side by side (peer-list 390, storyline 390,
  segment 390, schedule 390, lookup 390 and 1440).
- `before-checks.json`, `after-checks.json`: per shot, page-level sideways overflow, every
  sideways scroll region (label, role, keyboard focus, hidden pixels), elements wider than the
  viewport, a computed type inventory (family, size, weight) and a 30-step keyboard focus walk at
  390 and 1440 (and 1024 in `after-checks.json`).
- `harness/`: the fixture page and capture script, to re-run the capture.

States: `lookup` (fee position memo), `comparison` (named competitors, a 76-character name),
`research-answer` (the Research page answer), `storyline` (written memo), `storyline-writing`
(memo still being written), `segment` (segment table), `schedule` (whole-schedule scorecard),
`peer-list` (10 rows, a long name, missing assets, a two-year-old filing, a $0 fee, an amount not
stated, a rate fee), `clarify` (Hamilton's one question), `ask-loading`, `ask-written`,
`ask-error`.

## Baseline findings (H05-T01)

| # | Finding | Where | Seen in |
|---|---|---|---|
| B1 | Peer fee table and peer table cut off at phone width: amount, frequency, assets and source sit in a sideways scroll region (376px and 404px hidden at 390px). Same at 768px and at 200% zoom. | `PeerListView.tsx` | `before-peer-list-390.png` |
| B2 | Structure matrix scrolls sideways at 320 and 390px, in a region with no label and no keyboard focus, so a keyboard user cannot reach "Not published" in the last column. | `story-exhibits.tsx` | `before-storyline-390.png` |
| B3 | Segment table hides the assets, daily limit and schedule link columns on a phone; the source link is unreachable there. Its source date prints as `2026-09-30`, where every other answer prints `Sep 2026`. | `segment-table.tsx` | `before-segment-390.png` |
| B4 | Exhibit headlines use two treatments: report-design h2 (23px bold) on most exhibits, a 16px regular caption in a boxed card on the segment table and on `Exhibit` (Research, local market, monitor). | `segment-table.tsx`, `memo.tsx` | `before-storyline-390.png` |
| B5 | Section headings inside an answer use two treatments: 20px headings on the storyline and scorecard, 12px uppercase labels on the memo ("What the data says"). | `answer-memo.tsx` | `before-lookup-390.png` |
| B6 | Key figure tiles: 30px on the memo, 24px (20px when long) on the storyline. Body text 15px on the memo and fact lists, 16px on the storyline. | `answer-memo.tsx`, `exhibit-view.tsx` | inventory |
| B7 | Table figures: Geist Mono in the peer fee table (from the site-wide `.tabular-nums` class), Geist Sans everywhere else. | `globals.css` | `before-checks.json`, `peer-list@1440` |
| B8 | A money range ("−$900,000 to −$700,000") breaks inside a figure at 320 and 390px. | `story-exhibits.tsx` | `before-storyline-390.png` |
| B9 | Three `FactList` copies and two date helpers ("Mar 1, 2025") did the same job. | `exhibit-view.tsx`, `schedule-answer.tsx`, `memo.tsx`, `story-exhibits.tsx` | code |
| B10 | Segment caption said "Bars in terra charge less than ..." ("terra" is an internal colour name) and described bars that a phone never draws. Missing assets and limits showed as "—". | `segment-table.tsx` | `before-segment-390.png` |
| B11 | Keyboard: every focus stop showed a visible ring (the shell's `:focus-visible` rule); focus order followed reading order. No failure found. | all | `*-checks.json` |
| B12 | Page-level sideways overflow: none at any width, before or after. | all | `*-checks.json` |

Seen, not in this lane (reported to their owners, not changed here):

- **Written answer, engine call failed:** after the written answer finished, the "Reading the
  data" progress panel stayed on screen, counting seconds, above the answer and on the error
  state (`before-ask-written-390.png`, `before-ask-error-390.png`). Seen on the dev server, which
  runs React Strict Mode. Cause (batch A): under Strict Mode's double effects the cleanup aborted
  the engine request and the remount skipped the re-ask, so the busy flag stayed set. A production
  build was not affected. Fixed in commit b55886fc8 on `acct2/hamilton-h04-composer` (batch A),
  with a Strict Mode test.
- **Asset formats differ:** the peer list prints full dollars ("$2,410,000,000"); the segment
  table prints "$2.4B". Owner: batch B (`formatPeerAssets` in `src/lib/hamilton/peer-list.ts`).
- **Market brief and board brief:** the Oct 15 baseline (#980 comment) found Geist Mono figures and
  three sans h2 sizes there. The numeral face is fixed for the workspace by the `.hamilton-shell`
  rule below; the h2 sizes are in `MarketBrief.tsx` (batch A) and the board brief (batch B).
- **Saved and exported answers (H05-T07):** the PDF is drawn by `PdfDocument.tsx` (batch B), so
  this contract is not applied there yet. Exported HTML outside the workspace keeps the report
  stylesheet's mono figures.

## The contract

### Order (answer first)
Already enforced by #1705 (H05-T04, `answer-order.test.tsx`): the requested result comes first.
A lookup leads with the fact and its source, a peer request with criteria and the table, a
comparison with the rows and limitations, and narrative follows. This contract adds no order rule.

### Type scale
One face: Geist Sans (`SERIF` in `memo.tsx` is a legacy name for it). Sizes come from
`ANSWER_TYPE` in `memo.tsx`:

| Role | Treatment | Component |
|---|---|---|
| Question (page h1) | 20px phone / 24px desktop when long, bold, centred on phones | `MemoHeader compact` |
| "The answer" kicker | 12px semibold capitals, brick | `AnswerLead` |
| Governing thought | 22px / 24px from sm, regular, brick rule on the left | `AnswerLead` (`ANSWER_TYPE.lead`) |
| Key figure | 24px, or 20px when longer than 8 characters; label 13px under it | `KeyFigures` (`figureSize`) |
| Exhibit label | 11px bold capitals, brick ("Exhibit 2") | `ExhibitShell` |
| Exhibit headline | report-design h2: 23px bold, 20px on phones | `ExhibitShell` |
| Section heading in an answer | 20px bold | `SectionHeading` (`ANSWER_TYPE.section`) |
| Body: findings, takeaways, memo text | 16px, relaxed leading | `ANSWER_TYPE.body` |
| Captions, evidence line, source line | 12px, warm grey | `ANSWER_TYPE.caption`, `.rd-source` |

### Heading order
Page h1 (the question), exhibit h2 (each exhibit's headline), h3 for sections inside an answer.
Headings balance (global `text-wrap: balance`); no component overrides it.

### Numbers and dates

| Value | Format | Helper |
|---|---|---|
| A fee | `$32`, `$2.50`; `$0` for a published zero | `fmtMoney` |
| A fee that is not published | "Not published" (never "Free", never "$0") | `fmtMoney(null)` |
| A fee with no amount on the schedule | "Amount not stated" | `PeerListView` (#1705) |
| A rate fee | as stated ("1.5% of the transfer ($5 minimum)"), its own line, never pooled with dollars | `PeerListView` (#1705) |
| Assets (registry, thousands) | `$3.0T`, `$48.3B`, `$950M`; missing reads "Not available" | `fmtAssets` |
| A change | `+$2.50`, `−$32` (true minus sign) | `fmtSignedPrice`, `fmtSignedMoney` |
| A range | `$27 to $34`; never broken inside a figure | `figureSize`, money-at-stake spans |
| A count against a total | `12 of 18` | text |
| Source date | `Sep 2026`; with " · Source over a year old" when old | `sourceDateWithAge` |
| Event date | `Mar 1, 2025` | `dayDate` |
| Sample size | `n=412` on the source badge | `SourceChip` |

### Tables
- Figures: Geist Sans with tabular digits (`ANSWER_TYPE.num`), right-aligned in a number column.
  Inside `.hamilton-shell` the site-wide `.tabular-nums` class and the report stylesheet's
  `--rd-mono` keep the sans face (`globals.css`). Public reports and admin are unchanged.
- Column headings: 12px medium capitals, warm grey (`ANSWER_TYPE.th`).
- The research institution's row is tinted brick and sits first.
- Phones: no table scrolls sideways. Below `sm` (segment table, structure matrix) or `md` (peer
  list, peer fee table) each row becomes a card of label and value; a column a phone hides folds
  into a line under the name, so its source link stays reachable. A scroll region kept on wider
  screens has a label and keyboard focus.

### Source badges
- A short answer (one exhibit): a source badge (`SourceChip`: label · `Sep 2026` · `n=`) at the end
  of each finding, through the one `FactList` (inline, or boxed for findings with nothing to draw).
- A storyline: a numbered note beside each line and one numbered source list at the foot.
- Every exhibit: "Source: label, Sep 2026" as its last line.

### Warnings and limitations
- A limitation sits before the text it qualifies, in a `Callout` (brick rule, tinted), never only
  inside an expandable section. Example: "Check these figures: ... could not be traced to the data
  Hamilton looked up for this answer. Treat them as unverified." (`after-ask-written-390.png`).
- Hamilton's own reading sits under its label, apart from the facts (#1705).
- Status changes (loading, writing, saved, failed) are announced with `role="status"` or
  `role="alert"`.
- Optional narrative ("Read the full answer", "1 more finding") sits behind `More`; a missing or
  stale-data caveat never does.

### Width
Analyze, Research and Reports use `MemoPage` at its default width (`max-w-5xl`, 1024px; the
`reading` width, 768px, is used by no answer screen). Exhibits, callouts, boxed findings and the
composer run the column's full width (`ExhibitShell` overrides the report sheet's own 960px
centring). Running text keeps the site measure of about 75 characters (34em, `globals.css`,
James 2026-10-09); on a written answer the next-step buttons sit beside the commentary from `lg`
up, so the measure leaves no empty column. The lead sentence keeps `max-w-[68ch]`.

## What changed (H05-T03, H05-T06)

| Change | Files |
|---|---|
| New shared primitives: `ANSWER_TYPE`, `figureSize`, `AnswerLead`, `KeyFigures`, `SectionHeading`, `ExhibitShell`, `dayDate` | `memo/memo.tsx` |
| `ExhibitFrame` and `Exhibit` both draw `ExhibitShell`; the boxed `Exhibit` look is gone | `memo/exhibit-view.tsx`, `memo/memo.tsx` |
| Memo and storyline use `AnswerLead`, `KeyFigures`, `SectionHeading` | `memo/answer-memo.tsx`, `storyline/StorylineView.tsx` |
| One `FactList` (inline or boxed); the schedule answer's copy now wraps it | `memo/exhibit-view.tsx`, `analyze/schedule-answer.tsx` |
| Segment table in the shared exhibit frame, `Sep 2026` source date, phone line with assets, limit and schedule link, "Not available" / "Not published" for missing values, caption without "terra" | `memo/segment-table.tsx` |
| Structure matrix as cards on phones; event dates through `dayDate`; ranges never break inside a figure | `storyline/story-exhibits.tsx` |
| Peer fee table and peer table as cards below md, with explicit table roles so a phone screen reader still hears a table, and real (screen-reader-hidden) labels in place of CSS `data-label` text; no scroll regions or extra tab stops | `analyze/PeerListView.tsx` |
| One numeral face inside the workspace | `src/app/globals.css` |
| Removed a storyline override of the exhibit headline that never applied (the report stylesheet is unlayered and wins) | `storyline/StorylineView.tsx` |

Result on the same fixtures: 11 of 60 state-width shots had a sideways scroll region before, 0
after; the re-capture after the batch review has 0 of 84 (14 states by 6 widths). Page-level
overflow was 0 before and after.

## Overlaps
- #939 (closed, UX audit and site-wide pass) and #1284 (open, Fee Insight design system rebrand):
  this contract uses the existing brand tokens and adds no new design system.
- #810 (closed, board-ready exhibit charts in exported Ask PDFs) and H05-T07: the PDF keeps its own
  renderer; parity with this contract is open (batch B).
- #1368 (closed, Hamilton redesign 1): the market brief and board brief it added are outside this
  change (see "Seen, not in this lane").

## For James to decide
1. Accept the type scale, especially the key figure size (24px, down from 30px on the memo) and
   section headings at 20px on the memo (up from 12px capitals).
2. Accept the boxed `Exhibit` card giving way to the report exhibit look on Research, local
   market and Monitor screens.
3. Accept stacked cards for tables on phones (peer list below 768px).
4. Accept one numeral face (Geist Sans) for every figure in the workspace.
