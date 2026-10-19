# Rosetta repair artifact settlement (#2313)

Normal Extract run 9660 recovered Oakwood's PDF columns but kept the old text.
The existing text-survival feedback selected artifact 12534, whose physical fee-line
score was 23. The recovered columns scored 15 despite retaining all 50 dollar
amounts. `rungTextNotWorse` refused replacement, while the attempt still recorded
`pdf_stacked: 1`; that marker prevented another normal repair.

The exact source bytes have SHA256
`e8160b6a4c57816399cfe99fe441fb227dac9e0895c56423286feae80daa0bf3`.
The incumbent text is
`9429c874685735f0f6e73ec0ac9ba1dccc84571bbefe7219945d820a065e9738`;
the recovered text is
`dc6eb4136b9e193c6b9c250ba56e74499b1b8d29f3276658e6bdd81af9241ccc`.

## Acceptance and settlement

The ordinary survival rule stays unchanged. The PDF reader additionally reports
which actual pages selected the bounded stacked-column detector, with the source
byte hash and output text hash. Only a requested vault repair may use that receipt
as an alternate survival proof. Its selected incumbent and replacement must have
exactly the same multiset of literal tokens, ignoring only whitespace and table
separators. Case, punctuation, dollar values, units, duplicate tokens and qualifying
words remain significant. This proof changes text acceptance, never price admission.

Settlement locks and rechecks the selected source and incumbent artifact ID, source
hash, text hash and full text. A changed incumbent or source is retained. Accepted
artifact writes, profile/table metadata and their attempt marker commit in one
transaction (or a savepoint inside the run ledger). The marker names the persisted
artifact ID and text hash. A failed attempt write rolls back the replacement.
Rejected replacements have explicit unsettled evidence and do not enter the
ordinary reader's playbook. Existing unavailable/mismatched vault failures keep
their explicit review exclusion and make no outside request.

Reader 3, layout 5, prose floor 4 and repair 1 remain unchanged. The successful repair
selector now requires a marker bound to the current persisted artifact. Consequently
run 9660's unbound success no longer settles its still-interleaved incumbent. Normal
Extract can select that exact source again, with the same four-per-step bound.

## Evidence and scope

At 2026-10-19 17:55:25 UTC the complete old/new owner query, in one read-only
production statement, counted 8 versus 9 due documents. Only document 17019 became
newly due; the result is the original nine-document owner cohort. No global reader,
Knox or source-check epoch changes.

The actual decoder was replayed on all nine original hash-verified source PDFs and
exact incumbent texts. Every output conserved all literal tokens (zero lost or
added); only Oakwood needed the alternate geometry proof (page 2). The other eight
passed ordinary survival. These checks do not certify downstream categories,
amounts or historical publication. Existing historical fee recovery remains a
separate reviewed last step after normal source reprocessing.

Repository regressions cover the actual Oakwood PDF and stored text with its lost-
fee feedback, the false-settled v1 marker, changed/missing price or qualification,
missing/mismatched geometry/source/output binding, a competing incumbent, atomic
rollback, and two real concurrent readers. The existing owner/readiness/Bayes tests
continue to cover vault failures, current-copy/companion scope and the four-check
limit. No schema, provider control, fee data or production state is changed by this PR.
