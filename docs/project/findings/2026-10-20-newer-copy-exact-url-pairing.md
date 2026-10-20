# 2026-10-20: the newer-copy check missed copies saved under another spelling of the page
**What happened:** 1,377 superseded copies (3,370 live fees) have a newer current copy of similar
length that also has live fees, so both copies' fees are live (#2477, read-only prod query
2026-10-20). Hamilton's newer-copy check had reached only 772 pairs.
**Cause:** the check paired a copy only with a newer copy at the exact same `document_url`, while
Magellan's current-copy step supersedes every spelling of one page (www, port, trailing slash,
`urlIdentity`). A newer copy stored under another spelling was never compared, so fees the bank
had dropped from its page stayed live from the old copy.
**Fix:** a copy also pairs with the current copy Magellan superseded it with
(`superseded_by_id`); v3 judges every pair again. The existing guards hold: the newer copy must be
recognized as the same schedule, and a fee is retired only when its line is gone.
**Lesson:** two steps that decide "the same page" must use the same rule.
**Guard:** `src/lib/agents/hamilton/newer-copy-retire.db.test.ts` ("pairs a copy with the current
copy Magellan superseded it with under another spelling of the page").
