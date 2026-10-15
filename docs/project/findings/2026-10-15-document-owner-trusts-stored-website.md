# The other-bank check trusted the stored website, so wrong-bank schedules went live

**Date:** 2026-10-15
**Found by:** James's catalog review v2 (#1455) and the coordinator's read-only prod check the same day.

## What happened
- Hamilton's other-bank check (`hamilton/other-bank-document.ts`) treats a document on the bank's own stored website host as the bank's own.
- The registry seed (2026-02-15) stored another bank's website for 5756, 4884 and 1903. Magellan then found that bank's schedule there, and the check passed it: 52 live fees (#1455).
- Credit union website vendors serve one CU's file on every member domain. Healthplus FCU's (5009) schedule sits at `<cu-domain>/ezs3download/download/...` on six unrelated CUs (about 139 live rows). Horizons North CU's (8416) sits at `5star.bank/_/kcms-doc/...` on 5Star Bank (37 live rows). These counts come from the coordinator's read; this session did not re-run them.

## Cause
No step checked the document's own text against the institution. The host stood in for identity, and the host was wrong (seed data) or did not prove ownership (vendor paths).

## Fix
- Darwin's `verify.document_owner` (`src/lib/agents/darwin/document-owner.ts`) reads the bank name and city/state printed on the document for every shared or vendor-path document.
- It is in shadow (`DARWIN_DOCUMENT_OWNER_TAKEDOWN = false`) until James sees the count from `documentOwnerCountSql()`.
- The stored websites are not corrected in code. That data fix waits on James's approval (#1455 step 2).
