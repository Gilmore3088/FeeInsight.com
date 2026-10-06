# Learning core (L1–L3)

The pipeline's memory. Its purpose is that money and time spent learning something
about an institution are never spent learning it again.

| Module | Role |
|---|---|
| `outcomes.ts` | Typed attempt outcomes (`ok`, `unchanged`, `http_404`, `scanned_pdf`, `no_candidates`, …) and which ones are permanent for an input. |
| `attempts.ts` | `recordAttempt` (L1): appends a `pipeline_attempts` row and folds it into the playbook. `learningSchemaReady` checks that the migration is applied. |
| `playbook.ts` | The per-institution playbook (L2) on `institution_source_profiles`: learned `format`, `best_strategy`, `strategy_stats`, `do_not_retry`, `expected_fee_count`, `cost_to_date_microusd`. `applyAttempt` is pure. |
| `router.ts` | `chooseStrategy` (L3), which is pure. It never repeats a known failure, prefers a strategy that has worked here, then format priors, then the cheapest strategy. |
| `notes.ts` | `describePlaybook`, which is pure. It writes the playbook as plain-English notes (document type, the reader that works, what is not retried, the next step such as "Needs OCR") for the "What the pipeline has learned" panel on `/admin/institution/[id]`. |
| `format-backfill.ts` | `backfillPlaybookFormats`, run in every Rosetta read step. It fills an empty `format` from the institution's newest fee-schedule text (`completed`, `needs_ocr` or `empty`; never `wrong_document`), for institutions read before the learning core existed. It never overwrites a learned format. Step detail: `formats_backfilled`. |
| `format.ts` | `detectFormat` reads bytes, not URLs. `isLikelyScannedPdf` applies a threshold of under 200 non-whitespace characters per page. |

## Contract for every stage

1. Before acting on an input, call `chooseStrategy` with the playbook and the input
   fingerprint: the content hash for read, the text hash for extract.
2. Exclude known inputs in the candidate SQL as well, so they never take a slot in
   the batch:
   - **read:** a permanent outcome for the same content hash and reader version.
   - **extract:** any attempt for the same text hash, strategy and version.
3. After acting, call `recordAttempt` once with a typed outcome, the yield, the cost,
   the duration and the run and step ids. Free-text-only failures are not allowed.
4. Report outcome counts in the step's `detail` (`outcomes`, `learning_log`) so the
   crew log and the daily brief can narrate them.
5. Bump a strategy's `version` whenever its behavior changes. Old failures are then
   retried once with the new version; nothing else is.

## Retry rule

An input is retried only when its content changes (a new hash) or the strategy
version changes. Transient outcomes (`timeout`, `network_error`, `http_429`,
`http_5xx`) are retried normally. Permanent ones (`scanned_pdf`, `js_required`,
`empty`, `parse_error`, `unsupported_format`, `too_large`, `wrong_document`,
`no_candidates`) go into `do_not_retry`.

## Where it is wired today (PR 1a)

**Magellan fetch (`fetch.http@1`):**
- Sends `If-None-Match` / `If-Modified-Since` from the last stored document.
- A `304`, or a `200` whose hash matches the stored copy, is recorded as `unchanged`.
  It touches `last_checked_at` and does **not** insert a new `source_documents` row.

**Rosetta read (`read.pdf_text`, `read.html_text`, `read.plain_text`, version 1):**
- Detects the format from the bytes.
- Thin-text PDFs are `scanned_pdf` and learn the format `pdf_scanned`.
- HTML with no text is `js_required` and learns `html_js`.
- Word documents are `unsupported_format` until a reader exists.
- The same bytes stored under another document id are not read again.

**Knox extract (`extract.rules@1`):**
- Records its yield against the trailing-median `expected_fee_count`, giving `ok`,
  `low_yield` or `no_candidates`.
- Never re-extracts the same text hash with the same version, including duplicates
  stored under other document ids.

**Profile sync:** never flips a learned `scanned_pdf` back to `pdf`.

**Darwin verify (`verify.rules@1`, PR 1b):**
- Records one attempt per raw row, with the fingerprint `raw:<fee_raw_id>`: `ok`, or
  `rejected` with the reason in `detail`.
- Its candidate SQL excludes rows that already have an attempt for this version,
  so rejected rows can no longer starve the batch.
- Row-level stages (verify, publish) keep their failures in the attempt log only.
  They never enter the capped `do_not_retry` list, which holds document-level
  memory.

## Document vault and fee-page check (PR 1c)

**Vault.** `src/lib/agents/document-vault.ts` stores each new or changed document in R2
under a content-addressed key, `<2 hex>/<sha256>`.
- Magellan stores on `ok`. It also stores an `unchanged` document once if it predates
  the vault.
- Rosetta reads the stored copy instead of downloading again.
- Admins open "View our copy" through `/api/admin/documents/[id]`, which issues a
  1-hour presigned link.
- Without the `R2_*` env vars the vault reports `not_configured`, and everything else
  runs as before.

**Fee-page check.** `learning/fee-page.ts` exports `scoreFeePage`, which is pure, at
$0. It runs on every text Rosetta reads and on every HTML page discovery considers.
- `wrong_document` means no line pairs a fee word with a dollar amount, and the page
  has fewer than 3 dollar amounts.
- It was calibrated on production: Knox had found fees on 0.7% of such pages.
- A wrong page is stored with the status `wrong_document`, so Knox skips it.
- Its URL goes into the profile's `rejected_source_urls`, and the institution is sent
  back to Magellan, unless `locked_by_correction` is set or a newer document exists.
- Discovery never re-proposes a rejected URL.

**Backlog triage.** Each read step re-checks up to 100 earlier texts, with no
download, under the strategy `read.page_check@<FEE_PAGE_CHECK_VERSION>`. It never
rejects a text Knox already pulled fees from.

## Shared learning store (`pipeline_feedback`)

One store every agent reads and writes, so what one agent learns reaches the others
(James, 6 Oct 2026: "knowledge flow through to other agents, to and from"). One row is
one judgement about one agent's output; `pipeline_attempts` says what an agent did, this
says whether it turned out right.

| Field | Meaning |
|---|---|
| `about_stage`, `about_strategy`, `about_version`, `about_attempt_id` | The output being judged and the attempt that produced it. |
| `signal` | `wrong`, `right`, `missed` or `restored`. |
| `kind` | Why, e.g. `wrong_category`, `threshold`, `unreproduced`, `answer_key`, `produced_live_fees`, `thin_link`, `dead_link` (list in `feedback.ts`). |
| `reported_by`, `check_name` | Which agent judged it and with which check. |
| `institution_id`, `source_document_id`, `source_url`, `fee_raw_id`, `fee_verified_id`, `fee_published_id`, `canonical_fee_key`, `amount` | What it is about. Join a document on `source_document_id`, a fee on `fee_raw_id` / `fee_published_id`, a link on `source_url`. |
| `weight`, `evidence` | 1 by default (a link's live-fee count, below 1 when not proof); the line or numbers the judgement rests on. |
| `dedupe_key` | Unique; writers upsert, so a re-judgement replaces the row. |

Writers use `recordFeedback` (`feedback.ts`) and check `feedbackSchemaReady` first.
Dedupe keys in use:
- `hamilton.takedown:pub:<id>:extract` and `:verify`: a live fee Hamilton took down,
  charged both to the Knox strategy that read it and to the Darwin attempt that approved it.
- `hamilton.restore:pub:<id>`: that takedown is live again.
- `darwin.verify:raw:<fee_raw_id>`: Darwin's judgement of a Knox read. Only
  `category_mismatch` rejects are written today; holds (peer, range) are not proof.
- `answer_key:fee:<id>`: a confirmed answer-key fee (`right`, reported by a human).
- `magellan.link_yield:doc:<source_document_id>`: a link's live-fee outcome (Magellan).

`syncPipelineFeedback` (`feedback-sync.ts`) runs in every Hamilton publish step after
the source check. It fills the store from takedowns, restores, Darwin category rejects
and answer-key fees, 1,000 source rows each per step, oldest first, and reports the counts
in the step's `learning_feedback` detail.

Atlas's scoreboard reports **Knox survival**: of Knox fees ever published, the share still
live, overall and per strategy (`detail.knox_survival`). Yield rewards finding more fees;
survival rewards finding fees that stay right.

## JSON parameters

`src/lib/data-store/connection.ts` passes JSON text through unchanged
(`JSON_TEXT_PASSTHROUGH`), so `${JSON.stringify(x)}::jsonb` stores a real object or
array.

Before PR 1b it stored a JSON string, and every SQL JSON operator silently missed it.
Darwin's `outlier_flags ? 'needs_darwin_verification'` is one example: it selected
nothing. Migration `20261003132125_repair_double_encoded_jsonb.sql` unwrapped the
stored values.

## Deploy order

The code checks `learningSchemaReady` before it uses the new table and columns. Until
`supabase/migrations/20261002233217_learning_core.sql` is applied, the agents keep
their previous behavior. Hash-based "unchanged" detection still works, because it
uses the existing `last_source_hash`. Each step's `detail.learning_log` is `false`
until then.

## Not yet (later PRs)

- Discover and publish attempts.
- Knowledge promotion (L4): aliases, templates, discovery patterns.
- The error-to-test loop and weekly retrospective (L5).
- A unique `(institution_id, content_hash)` index after the dedupe workflow.
- A `learning-contract-kill` CI guard.
