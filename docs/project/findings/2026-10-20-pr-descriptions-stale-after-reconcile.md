# 2026-10-20: PR descriptions described work a reconcile had dropped

A push that drops scope while reconciling with `main` updates the PR title and body in the same push.

**What happened:** After merging `main`, #1935, #1936, #1960, #1732 and #1736 still described
work the reconcile had dropped. The independent reviewer flagged the mismatch on each one, and
each got a scope note in its body before it merged.

**Cause:** The reconcile changed the diff but not the description, and nothing compares the two.

**Fix:** Scope notes added by hand to all five before merge.

**Lesson:** When a reconcile drops or changes scope, edit the title and body in the same push:
say what was dropped and which PR on `main` covers it, so the review and the merge receipt
describe the exact head.

**Guard:** The independent review of the exact head (CLAUDE.md "How work runs") checks that the
body matches the diff; it caught all five here.
