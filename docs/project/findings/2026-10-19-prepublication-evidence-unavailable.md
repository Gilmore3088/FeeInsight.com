# Required publication evidence could fail open

Date: 2026-10-19
Scope: the bounded implementation checklist on existing #1069.

An enabled business-schedule query failure was deliberately treated as an empty result:
the existing connected publisher test expected one published row plus an error string.
The controlled before-fix assertion instead expected zero and failed with actual 1.
Exact-copy and page-copy reads had the same unavailable-as-no-match default. Prior live and
coexistence reads could likewise lose the evidence needed to distinguish insertion from
supersession or two legitimate prices.

The publisher now retains typed read availability across these decision inputs. Required
unavailable evidence leaves an input pending without publication, supersession, fee judgment,
negative teaching or a settled v3 fingerprint. A separate real-SQL red caught deferred rows
miscounted as rejected in aggregate outcomes; pending inputs now have no decision outcome.
Missing own document, own URL rejected by the existing page-key parser, or candidate-required
text is unavailable, while a genuine empty
live-copy set and unrelated non-pairs need no such data. Successful empty reads, already-proved outcomes,
positive independent refusals and diagnostic/off controls retain their meanings. Saved receipts
use finite check codes and bounded ID samples rather than arbitrary exception/source content.

**Guard:** src/lib/agents/hamilton/publish.test.ts,
src/lib/agents/hamilton/publication-evidence.test.ts,
src/lib/agents/hamilton/publication-evidence.db.test.ts,
src/lib/agents/hamilton/page-copy-refuse.test.ts,
src/lib/agents/hamilton/exact-duplicate.db.test.ts,
src/lib/agents/run-store.test.ts and src/lib/agents/narrate.test.ts.

This changes prospective required-read failure handling only. It does not activate switches,
reopen settled history, repair fees, add removal/clearing authority or satisfy the original
weekly below-1% takedown measurement. Existing #1069 and the broader #2072 decision process
remain open; no production recovery or new James checking is included. This receipt covers
the required publication reads reached by the selected inputs, rather than whole-pipeline
validation, source fidelity, every successfully returned field or the completeness of other
maintenance producers. No new timestamp requirement or historical collapse rule is introduced.
