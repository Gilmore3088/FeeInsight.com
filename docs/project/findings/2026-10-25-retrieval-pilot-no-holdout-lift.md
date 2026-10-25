# 2026-10-25: Retrieval pilot (O2): a metadata and full-text ranker shows no holdout lift over today's page choice

**Lesson:** Measure a retrieval add-on on a holdout of human-confirmed current schedules before
building on it. The first metadata and full-text ranker made no measurable difference to which
page comes first, so embeddings are not justified. What it did show is that today's choice
sometimes puts a page a person called stale first, and the schedule's own date catches most of
those.

**What happened:** V5 build plan item O2 (Truth lane) asks whether retrieval could rank a bank's
candidate pages better than the way the pipeline picks its current schedule now. PRD V5 section 10
sets the policy: a retrieval add-on may re-order candidate pages that are already approved; it is
never the source of truth, never proof that a fee is absent, never a currency check and never
permission to publish. Metadata and full-text search come first, and embeddings only after a
measured holdout lift.

The pilot is a shadow-lab measurement (`src/lib/agents/deming/shadow-lab/retrieval-pilot.ts`, run
by `npm run test:shadow-lab`). It ranks each labelled institution's stored pages two ways:
- **Today's choice (baseline):** the copy at the bank's fee link first
  (`institution_sources.fee_schedule_url`), then the profile's remembered address, then the bank's
  other non-rejected sources, then every other stored page. These are the sources Hamilton's
  current-copy check uses (`retiredCopiesSql`). Within each tier the newest document comes first,
  since the newest copy at a link is the current one (`magellan/current-copy.ts`).
- **Metadata and full text:** the document's own signals, never the fee link. These are BM25 over
  15 core fee terms, Rosetta's document kind, address cues, cues in the opening 3,000 characters,
  and the schedule's own year. The year comes from `stated_date` (Magellan #2615) when it is set,
  otherwise the latest year in the opening text, otherwise the latest year in the address.

**Labels:** existing ground truth only, all from `/mnt/project-files/data-quality/` (local, not
committed): the W43 live batch, the two Oct 18 live fee checks and the Oct 18 browser hunt. A page
counts as relevant when a check confirmed at least one fee on it against the bank's current schedule
(verdict MATCH) and no check called it STALE_SOURCE or WRONG_DOCUMENT. A browser-hunt find counts
as relevant, and the link it replaced counts as stale. This gives 87 institutions with 114 relevant
pages. Five were left out because no check confirmed any page for them. The candidates are 334
stored pages, from `source_documents` crawled before Oct 20, 2026 (the checks ran Oct 18-19). They
were read with SELECT only and frozen into
`src/lib/agents/deming/__fixtures__/retrieval-pilot-2026-10-25.json`. The fixture holds counts and
metadata, never document text.

The split depends only on the institution id (sha256): 45 tuning and 42 holdout. The ranker's five
weights were picked by a grid search (0, 0.5, 1 or 2 each) on the tuning split only, ranked by
recall@3, then precision@1. A test re-runs that search and fails if `TUNED_WEIGHTS` differ. The
holdout was scored once with those weights: `{bm25: 0.5, kind: 2, url: 0, head: 0.5, date: 2}`.

| Split | Ranker | recall@3 | recall@10 | precision@1 | Stale or wrong page first | Primary page outside the top 3 |
|---|---|---|---|---|---|---|
| Tuning (45) | Today | 80.3% (49/61) | 95.1% (58/61) | 71.1% (32/45) | 7 | 4 ranked lower |
| Tuning (45) | Metadata | 93.4% (57/61) | 100.0% (61/61) | 80.0% (36/45) | 1 | 0 |
| **Holdout (42)** | Today | 79.2% (42/53) | 96.2% (51/53) | 78.6% (33/42) | 3 | 2 not stored, 1 ranked lower |
| **Holdout (42)** | Metadata | 83.0% (44/53) | 96.2% (51/53) | 76.2% (32/42) | 1 | 2 not stored |

recall@k is the share of relevant pages ranked in the top k, counted over every relevant page,
stored or not. precision@1 is the share of institutions whose first page is relevant. The primary
page is the relevant page with the most confirmed fees. False negatives: on the holdout, two
institutions (825, 7656) have no stored copy at the confirmed address, so no ranker can find it
(7656's file is stored under another address, `wp-content/uploads/2024/05/...`, which the labels
do not name).
Today's choice also ranks 6741's confirmed schedule below its top 3; the metadata ranker does not.

**On the holdout, precision@1 shows 6 wins, 7 losses and 29 ties, so the sign test gives p = 1.00.
The verdict is no measurable difference, and 42 institutions are too few to show a small effect
either way.** The tuning split's gains did not carry over to the holdout: they were fitted.

For the record, a hand-set first draft of the weights was written before any run and scored on both
splits before the grid search and the page-key fix existed. It got holdout precision@1 of 83.3%
against 78.6%, with 5 wins and 3 losses (p = 0.73). That draft is not the result, and it was not
significant either.

Two caveats favour today's choice, so its numbers are an upper bound:
- The W43 reviewers checked the documents live fees cite first. On W43 labels, today's choice gets
  precision@1 of 89.1%, against 47.1% on the independent browser-hunt labels.
- The fee link is read as it stood on Oct 25, after the audit, so some links may already have been
  fixed.

**What the misses show:**
- Today's choice put a page a person called stale first for 10 of 87 institutions. They are rate
  pages and old links the fee link still points at: hillsbank deposit-rates, gncu account-rates,
  hawaiistatefcu rates, Walden's superseded PDF, and others. The metadata ranker did this for 2.
- The metadata ranker loses where the bank's confirmed current schedule carries an old year:
  Cogent's `2022/08/fee-schedule.pdf`, Cascade's `2024/09/rate-and-fee.pdf`, Avidia's 2024 PDF,
  and Simplicity's 2025-09 fees disclosure, which it ranked below a 2026 packet. A stated year is
  a weak sign of being current, which is why PRD section 10 says retrieval is never a currency
  check.
- `stated_date` was read on 21 of the 334 candidate pages and a date found on 11 (the other 10 read
  as `none`), so most years came from opening text or addresses.

**Rights and cost:** no new vendor, no spend and no provider call. The pilot reads only frozen
counts that were already in our own database, taken from pages the banks publish. The fixture
stores no document text, only term counts, cue counts and metadata (a test checks this). An
embedding model would mean a paid provider or a new hosted model, and a new place where bank text
is sent. With no holdout lift, neither is justified.

**Cause:** not a defect. This is the first measurement of an optional add-on. Today's choice is
already right for about four in five banks on these labels. Its misses are mostly a fee link that
points at a rates or product page, not a ranking problem.

**Fix:** none to live selection; nothing in the pipeline imports the pilot (a test checks this).
Next, if pursued, a single narrow signal measured on new labels as a fresh holdout (W44's live
batch): flag a bank whose fee-link page is not read as a fee schedule while a stored page of
that kind exists. It would go to Magellan's review as an alarm, not a re-rank. It must not be
tuned on this holdout. It is tracked as a checklist line on the Magellan tracker, #1027 ("find the
right document").

**Guard:** `src/lib/agents/deming/shadow-lab/retrieval-pilot.test.ts` pins the measured numbers,
re-runs the tuning-split search, keeps the fixture free of document text, and fails if anything
outside the shadow lab imports the pilot.

**Agent lesson:** deming/o2-retrieval-holdout-before-embeddings
