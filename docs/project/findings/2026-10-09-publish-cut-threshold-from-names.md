# Publish cut a threshold out of fee names

**Found:** 2026-10-09, UAT re-check of PR 842 (trailing_cut 9 -> 12).

Knox and Darwin read "Service charge (daily balance falls below $500)" whole. At publish,
Hamilton's `nameBeforeLeaders` (PR 797) cut every name at its first " $digit", so the
row went live as "Service charge (daily balance falls below". Rows affected include 102976,
102987, 102988, 101305, 101842, 101843, 102654 and 102656.

Name-retidy v7/v8 could not repair them: they look for the name's words on the page, and the
page words differ from Knox's composed name.

**Fix:**
- A price inside an open parenthesis is the name's own threshold, and publish now keeps it.
- Retidy v9 also searches Knox's raw name for the cut figure (`raw_fee_name`).

**Lesson:** a display cut at publish must be checked against names Knox composes, not only names
copied from the page.
