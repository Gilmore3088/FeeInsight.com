# Knox review (2026-10-12)

Part of `docs/plans/pipeline-review-2026-10-12.md`. Knox reads each document's text
(`agent_source_texts`, from Rosetta) and extracts fees into `raw_fee_observations`, which Darwin
verifies (`src/lib/agents/knox/AGENTS.md`).

**Measured** = read-only production query, 2026-10-12, 06:00–06:20 UTC. **Code** = `main` at
`f79b7c4c`.

## What Knox does (code)

- Two steps: `extract` (free) and `extract-paid` (the only provider step), scheduled in each state
  lane.
- **Which texts it reads:** completed texts not yet read at the current rules version (v65),
  current copies first. About seven triggers re-read a text: fewer than 5 rows, missing fees found
  by Hamilton's re-check, $10B+ banks, an older copy still carrying live fees, reads below v26 or
  v51, and priority banks with no live overdraft fee.
- **Free pass** (`runFreeSpecialists`): a rules reader, then table and fee-family readers; every
  find is checked against the source text (`checkFeeAgainstSource`), the limit and worked-example
  guards, then deduplicated. Confidence is a fixed 0.82–0.94.
- **Paid pass** (`claude-sonnet-5-5`, up to 8,000 output tokens, text cut at 60,000 characters, 10
  documents a run): only when the free pass found fewer than 5 fees on a text with at least 15
  priced lines, and never twice for the same text unless the first call failed. Every row it returns
  must trace to the text.
- Knox reads any document type, Truth in Savings disclosures and account agreements included. It
  has no document-type field.

## What it did (measured)

- **October 1–12:** 226,158 rows from 15,234 documents at 5,826 institutions. 172,268 went to
  Darwin, 48,437 were held for review (ranges, percentages, unclassified, untraced), 15,799 were
  retired by newer reads or copies.
- **No repeat extraction:** 225,556 distinct document-fee-amount lines for 226,158 rows; a text is
  read once per rules version.
- **Paid pass:** $76.80 for 2,867 calls on 2,695 texts (172 retries after failures, $4.82). It
  added 6,822 rows at 1,865 documents and 1,178 institutions: about 1.1 cents per row kept. Average
  call: 8,150 tokens in, 1,049 out.
- **Server time, last 7 days:** 3,386 `extract` steps (14.3 hours) and 1,514 `extract-paid` steps
  (5.4 hours).
- **Coverage:** of 6,037 institutions with readable text, 5,906 have Knox rows; 131 have none. 512
  institutions have Knox rows and no Darwin result.
- **Audience:** of rows written since Oct 10, 97.3% are `unknown`, 1.5% business, 1.0% consumer,
  0.2% both.

## What works

- Cost is in proportion: the paid pass runs only on texts the free readers clearly missed, and
  every paid row must trace to the document.
- No double paying for the same text.
- Every find is checked against the source before Darwin sees it.

## Problems

### 1. Fees lost when Rosetta re-reads a page (measured and code)

On a re-read, Knox first retires the older text's rows (`retireRowsFromOlderText`,
`extract.ts:1042`), then inserts the new read. The same fee hits the unique index and the update
only takes over held rows (`extract.ts:683–686`), so the fee stays retired. A repair exists only
for rows from the paid pass (`held-recheck.ts:455`). **1,729 free-pass rows are retired this way;
1,646 of them, at 362 institutions, are not live under any row.** The code comment at
`held-recheck.ts:429–434` describes the case.

### 2. Audience is read from the line only (code; measured above)

`feeApplicability(feeName, excerpt, amount)` sees the fee's name and a one-line excerpt, and
ignores words in an excerpt with more than one price. The only document-level rule drops fees
footnoted as business-only. `insertCandidate` also recomputes audience and discards what the
specialists worked out. Hence 97.3% `unknown`. This is #1059.

### 3. Product pages and document type (code)

Knox has no idea what kind of document it is reading. A product page with one or two fees is
re-read at every rules version (fewer than 5 rows), rarely qualifies for the paid pass (fewer than
15 priced lines), and is judged `low_yield` against the bank's whole fee schedule. Pass 1 also
skips any line matching "fee schedule", "truth in savings", "effective date" or "member fdic"
(`rules.ts:366,1000`); on a PDF flattened to one line, that can hide every fee from pass 1.

### 4. "Thin" means two different things (code)

Knox counts every Knox row, held and retired included, when deciding a document is thin
(`extract.ts:278–284`); Rosetta counts only rows sent to Darwin. A page with five held lines and no
real fees is thin to Rosetta and not to Knox. The playbook's expected fee count also mixes paid and
free reads (`playbook.ts:157`).

### 5. No account tiers (code)

There is no tier or variant field: tiers live in the fee name ("Courtesy Pay (over $5)") and
Darwin writes `variant_type` as empty. #1060 (tiers and ranges) needs this.

### 6. Why Knox rows never reach Darwin (code)

Held rows, retired rows, rows Darwin's current version already rejected (a later read of the same
line changes nothing), rows with no category hint, and rows flagged
`audience_correction_required`, which make the database trigger raise an error when Darwin inserts
them. This explains part of the 512 institutions with Knox rows and no Darwin result (#1052).

### 7. Guide out of date (code)

`knox/AGENTS.md` stops near v50 (code is v65), has two different "v30" entries, describes the old
dedupe key (it now includes audience), says each text is read once (it is once per version, with
about seven re-read triggers), and omits two re-check passes. The router can only choose one
strategy, so its skip branch never runs; `KNOX_EXTRACT_STRATEGY` is a leftover alias.

## Changes (tracker #1092)

Existing issues this review feeds: **#1059** (audience, problem 2), **#1034** (Knox does read
disclosures and agreements; problem 3 adds the line-skip hazard), **#1060** (tiers, problem 5),
**#1052** (Darwin hand-off, problem 6), **#1040** (paid yield per dollar on the scorecard).

| # | Change |
|---|---|
| K1 #1093 | Stop losing fees on a re-read: let the new read take over a retired row of the same fee, and restore the 1,646 retired free-pass fees that are not live (the restore changes production rows, so its PR says so) |
| K2 #1094 | Give every document a type (fee schedule, Truth in Savings disclosure, account agreement, product page, other) and use it: compare yield against what that type should hold, stop re-reading product pages every version, and hand them to Magellan (#1051) |
| K3 #1095 | One definition of a thin document and of expected fee count, shared by Knox, Rosetta and the playbook, counting only rows sent to Darwin, free and paid kept apart |
| K4 #1096 | Bring `knox/AGENTS.md` up to date and remove the dead router branch and the strategy alias |
