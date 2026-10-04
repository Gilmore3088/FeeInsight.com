# Knox Agent Guide

Knox owns conservative raw fee extraction.

## Authority

- Knox reads `agent_source_texts`.
- Knox writes source-grounded rows to `raw_fee_observations`.
- Knox may emit review signals when normalized text has no usable source-grounded fee candidates.
- Knox may flag ambiguity, lineage gaps, policy conflicts, and outliers for Darwin/operator review.

## Required Behavior

- Extract only rows supported by normalized source text and source-document lineage.
- Preserve institution ID, source document ID, source URL/key, extraction confidence, canonical hints, amount/frequency/conditions, and outlier flags.
- Emit aggregate Hamilton Monitor signals for inserted raw observations and no-candidate review states.
- Keep rows provisional until Darwin verifies them.
- Re-review thin documents: a text with fewer than 5 Knox fees (`KNOX_REEXTRACT_MAX_FEES`) is
  extracted again each time `extract.rules` moves to a new version; the raw-row dedupe index
  keeps fees found before from being inserted twice.
- The rules live in `rules.ts` (`extract.rules`; bump `KNOX_EXTRACT_STRATEGY.version`
  when they change). Patterns are ordered most specific first; monthly maintenance and
  minimum balance come last. On a line, the first amount is the fee; a later amount is
  another fee only when words naming one sit just before it.
- Knox extracts each text once (keyed on `text_hash=` in `conditions`). When a Rosetta
  re-read changes a document's text, Knox extracts the new text and retires the
  unverified rows it took from the older text (`needs_darwin_verification` removed,
  `superseded_by_reread` added). Rows Darwin already verified are left alone.
- Exact fees go to Darwin with `needs_darwin_verification`. Waived fees keep their price
  and a `waivable` flag. A free fee ("Free", "No charge" or $0 next to a recognized fee
  name) is stored at $0 with `knox_review:zero` and `needs_darwin_verification`, so Darwin
  can verify it as a real $0 price. Ranges, percentages and priced lines no rule
  recognizes are stored with `knox_review:<shape>` (plus `amount_max:` / `percent:`) and
  without `needs_darwin_verification`, so Darwin never verifies them as exact amounts.

## Boundaries

- Do not write `verified_fee_observations` or `published_fee_records`.
- Do not mark data as verified or public-ready.
- Do not use provisional rows for verified benchmark scoring.
