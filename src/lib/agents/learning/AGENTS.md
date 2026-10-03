# Learning core (L1–L3)

The pipeline's memory. Its purpose is that money and time spent learning something
about an institution are never spent learning it again.

| Module | Role |
|---|---|
| `outcomes.ts` | Typed attempt outcomes (`ok`, `unchanged`, `http_404`, `scanned_pdf`, `no_candidates`, …) and which ones are permanent for an input. |
| `attempts.ts` | `recordAttempt` (L1): appends a `pipeline_attempts` row and folds it into the playbook. `learningSchemaReady` checks that the migration is applied. |
| `playbook.ts` | The per-institution playbook (L2) on `institution_source_profiles`: learned `format`, `best_strategy`, `strategy_stats`, `do_not_retry`, `expected_fee_count`, `cost_to_date_microusd`. `applyAttempt` is pure. |
| `router.ts` | `chooseStrategy` (L3), which is pure. It never repeats a known failure, prefers a strategy that has worked here, then format priors, then the cheapest strategy. |
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

## JSON parameters

`src/lib/data-store/connection.ts` passes JSON text through unchanged
(`JSON_TEXT_PASSTHROUGH`), so `${JSON.stringify(x)}::jsonb` stores a real object or
array.

Before PR 1b it stored a JSON string, and every SQL JSON operator silently missed it.
Darwin's `outlier_flags ? 'needs_darwin_verification'` is one example: it selected
nothing. Migration `20270103000000_repair_double_encoded_jsonb.sql` unwrapped the
stored values.

## Deploy order

The code checks `learningSchemaReady` before it uses the new table and columns. Until
`supabase/migrations/20270102020000_learning_core.sql` is applied, the agents keep
their previous behavior. Hash-based "unchanged" detection still works, because it
uses the existing `last_source_hash`. Each step's `detail.learning_log` is `false`
until then.

## Not yet (later PRs)

- Discover and publish attempts.
- Knowledge promotion (L4): aliases, templates, discovery patterns.
- The error-to-test loop and weekly retrospective (L5).
- A unique `(institution_id, content_hash)` index after the dedupe workflow.
- A `learning-contract-kill` CI guard.
