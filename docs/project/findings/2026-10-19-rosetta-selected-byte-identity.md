# 2026-10-19: Rosetta attributed changed HTTP bytes to the selected capture

**What happened:** Two synthetic HTML schedules differed only in a $30/$35 overdraft
price. On source `40e20866`, actual `runRosettaRead` and the native constrained SQL
writer accepted both. With capture hash A selected and body B returned, it committed
B's text, 13 table rows, profile and private normalized witness under hash A, plus a
successful read attempt. Matching A was the positive control. No bank, provider or
production request was made; these fixtures establish a reachable association defect,
not its production prevalence or a published fee error.

**Cause:** `loadDocumentBytes` returned vault or downloaded bytes without comparing
their SHA-256 with `source_documents.content_hash`; conversion and settlement used the
selected hash as though the loaded body had that identity.

**Fix:** Ordinary and paid reads pass the selected hash to the same loader. Valid
matching bytes retain the existing conversion path. Mismatch and malformed hashes stop
before conversion/provider/artifact writes and record retryable document-access evidence
failure, outside playbook/profile updates. Paid preflight does not create a paid
transcription attempt, provider call or usage event. A legitimate later capture succeeds.
HTTP fallback after a vault read error is checked too; a mismatched stored body is refused.
Missing legacy ordinary hashes remain explicitly unbound with NULL original identity;
paid selection still requires a captured hash. Observed bytes do not become an invented
historical capture. No reader version, selector replay, schema, package or provider policy
changes are included.

**Verification boundary:** Loader fixtures exercise vault/HTTP/fallback/error/hash cases;
native ordinary-reader fixtures use the actual production schema and writer inside
rolled-back transactions. Paid SQL fixtures use private `LIKE INCLUDING ALL` tables
(types/defaults/checks/indexes, not copied foreign keys), real ledger/attempt writes and
ready witness capability. They prove no mutation of the prior artifact/profile, no paid
settlement or usage on identity failure, matching storage and later-capture recovery.
Callback-only unit DB facades do not prove transactions. Native fixtures may advance
owned sequences despite rollback. The original causal pair and fixture setup failures
remain preserved separately.

**Remaining work:** #1050, #1056 and #2220 retain source authority/lifecycle and recovery
work. This compares the initially selected document to actual loaded bytes; it does not
add owner/current-state CAS, bind secondary JavaScript-linked output to that capture,
repair old misassociations or authorize replay. Artifact atomicity remains distinct from
provider receipt/paid-attempt settlement and unknown no-return spend. Private witness
capability does not confer fee authority or full historical fidelity.

**Lesson:** compare the bytes actually loaded before attributing their converted output
to a stored capture; normalized text hashes alone cannot prove that association.

**Guard:** `src/lib/agents/rosetta/source-byte-identity.test.ts`, `src/lib/agents/rosetta/source-byte-identity.db.test.ts`, `src/lib/agents/rosetta/read.test.ts`, `src/lib/agents/rosetta/paid-read.test.ts`, `src/lib/agents/rosetta/paid-read.db.test.ts`.
