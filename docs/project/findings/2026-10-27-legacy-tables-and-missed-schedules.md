# 2026-10-27: legacy tables caught only after reading, missed schedules with no way back

**What happened:** Legacy and discontinued-account fee tables were caught only after a fee was
read: the shared source check (`discontinuedRow`, source check v26) refused the row and Knox's
self-check turned it into a held "untraced" line, which then showed up in the untraced-read
report to Rosetta as if it were a reading error. Magellan stored "Accounts No Longer Offered"
pages and companion links as fee schedules. When Deming's answer-key replay found that a
confirmed fee came from a document the bank never had stored (2 of 62 confirmed answer keys on
prod, read-only count on 2026-10-27), there was no feedback kind for it, and the companion
finder that could fetch it was skipped entirely in rescue mode (#2070).

**Cause:** No step before extraction looked for legacy pages or tables, and the companion finder
read only its own thin-bank list, never a signal that a named document was missing.

**Fix:** #2070 (this PR). Magellan refuses a page whose address, opening title or companion link
names legacy, discontinued or no-longer-offered accounts. Knox flags discontinued rows before
reading on every document and, behind `KNOX_DISCONTINUED_TABLES_LIVE` (default off), drops them
from the text it reads. Deming files `missed_second_schedule` feedback; Magellan's companion
finder reads it first, in any state and in rescue mode, and checks the named address before
searching.

**Lesson:** A page or table the bank no longer offers is a discovery and pre-read question, not
only a post-read hold; and every miss an audit finds needs a feedback kind whose reader is the
step that can fix it, running in the mode that recovers banks.

**Guard:** `src/lib/agents/knox/discontinued-tables.test.ts`, `src/lib/agents/magellan/legacy-page.test.ts`, `src/lib/agents/magellan/missed-schedules.test.ts`, planted cases `legacy_page` and `missed_second_schedule` in `src/lib/agents/deming/planted-errors.ts`
**Agent lesson:** magellan/issue-2070-legacy-page-is-not-the-schedule, magellan/issue-2070-missed-second-schedule-goes-back-to-the-companion-finder, knox/issue-2070-flag-the-legacy-table-before-reading, deming/issue-2070-a-missing-key-document-is-magellans-miss
