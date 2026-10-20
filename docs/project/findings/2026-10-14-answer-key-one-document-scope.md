# 2026-10-14: the answer key grades every document's fees against one document
**What happened:** monthly maintenance scored 63.3% precision and 47.3% recall on the answer key
(score run 8, 2026-10-13, 129 expected fees). On the 46 tuning banks (institution id not divisible
by 4; read-only SQL, 2026-10-14), 14 live monthly maintenance predictions were wrong. 11 of the 14
came from a document other than the one the key was built from: Wells Fargo's Everyday, Prime and
Premier checking pages ($15, $25, $35) against a key read from the Clear Access fee summary
($5); Prosperity's Teen Checking and Interest Checking Plus pages; Austin Bank's checking and
savings comparison tables; DLP's savings and money market pages; Central State's consumer
schedule against a key read from its business schedule; iTHINK's personal checking page against
its business schedule. Only 3 came from the key's own document.
**Cause:** `scoreAnswerKey` (`src/lib/agents/answer-key-score.ts`, scorer v1) compares every live
`published_fee_catalog` row at the bank with the fees on one hand-checked document. A real tier
from a second document is counted as a wrong prediction, and James's rule (DECISIONS, Oct 13)
says a fee from the bank's own checking or savings page counts. So the category's precision
mostly measures how many documents the bank has, not whether the category is right.
**Fix:** not built. A scorer change is Atlas's and changes a reported number, so it needs its
own issue: score the Hamilton stage on rows whose `source_document_id` is the key's document (or
the same content hash), and report the other documents' rows as their own count. #1100's guard
v62 PR does not touch the scorer.
**Lesson:** before tuning a category against the answer key, split its misses by document. A
miss from another document is a scope question for the key, not a category error.

**Agent lesson:** atlas/pr-1324-score-key-document
