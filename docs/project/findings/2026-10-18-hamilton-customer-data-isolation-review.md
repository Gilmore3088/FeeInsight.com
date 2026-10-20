# 2026-10-18: Hamilton customer data isolation review (#1922, gate G2)
**What happened:** a route-by-route review of everything that serves one customer's data, with a
two-account test for each. Two real leaks were found and fixed. The routes came from the
filesystem: every `src/app/**/route.ts`, every page under `src/app/pro` and `src/app/account`, and
every `"use server"` file outside `/admin`.
1. **Team roster across banks.** `/pro/settings?instId=<any bank>` loaded that bank's team (names,
   emails, roles) and its pending invite emails for any Pro user. The research subject is any
   institution, and the page fetched the roster before it knew whether the viewer was on the team.
2. **Team peer groups after leaving.** Someone who wrote a team peer group kept read, edit and delete
   rights to it after they were removed from the team (`created_by` alone matched).

Also: `savePeerSet` returned the bigint id as text, so a peer group a user had just created never
came back to the page (the bigint-as-text class, `2026-10-18-bigint-ids-arrive-as-text.md`).

**Cause:** (1) membership was checked for the manage buttons, not for the read. (2) The ownership
predicate treated the author of a shared row as its owner forever.

**Fix:** this PR. `settings/page.tsx` reads the roster only for an active member of that bank or
platform staff. `saved-peers.ts` gives team groups only to current members, and only to members who
are not viewers for edit and delete. `savePeerSet` returns `Number(row.id)`. Tests:
`src/lib/hamilton/customer-isolation.db.test.ts` (real Postgres, in `E2E_TESTS`),
`settings/page.team-isolation.test.tsx` and `custom-report/link.isolation.test.ts`. The two
leak tests fail on `main` and pass here.

**Lesson:** a page that reads by a URL id needs its own membership check before the read, not only
before the write. Shared (team) rows are authorised by current membership, never by authorship.

## Routes that serve customer data
Tests are in `customer-isolation.db.test.ts` (prefix **db**), `page.team-isolation.test.tsx`
(**page**) and `link.isolation.test.ts` (**link**). The older mocked tests in
`private-workspace.h01-acceptance.test.ts` and `chat-memory.db.test.ts` (H04-T09) still stand. In
every **db** test, B is a second paying bank: it reads, lists, exports, edits and asks again, and gets nothing back.

| Route / surface | Data | Check (file:line) | Test | Result |
|---|---|---|---|---|
| `/pro/analyze`, `/pro/saved`, `/pro/peer-research/[id]` (`loadAnalysisRecord`, `listSavedAnalyses`) | saved answers | `analyze/actions.ts:159`, `:134` | db: saved analyses 1 | refused |
| `POST /api/hamilton/ask`, `/ask/memo` (repeat cache, memo save) | saved answers, memo | `hamilton-analyses.ts:94`, `:133`, `:142`; `ask-service.ts:590`, `:642` | db: saved analyses 2 | B gets its own row; A's untouched |
| `POST /api/pro/report-pdf` (analysis and report) | PDF export | `report-pdf/route.ts:66`, `:110` | db: saved analyses 1, reports 1 | 404 |
| `/pro/reports`, `loadReport`, `saveBoardBrief`, `/account` reports list | reports | `pro-tables.ts:340`, `:247`; `board-actions.ts:25` | db: reports 1 | refused, row unchanged |
| `GET /api/reports/[id]/status`, `/download` | report jobs, signed URL | `status/route.ts:54`, `download/route.ts:51` | db: reports 2 | 403 |
| `/pro/simulate`, `loadScenarioById`, `listScenarios` | scenarios | `pro-tables.ts:126`, `simulate/actions.ts:308` | db: scenarios | refused |
| `/api/hamilton/conversations`, `/[id]/messages`, `/chat`, Analyze conversation actions | conversations | `chat-memory.ts:61-144` | db: conversations; `chat-memory.db.test.ts` | refused; append throws |
| Workspace context (every `/pro` page) | saved bank | `workspace-context.ts:57` | db: workspace 1 | B inherits nothing |
| `/api/hamilton/decisions`, `/uploads`, `/uploads/apply`, `/pro/monitor/deliverable`, `/pro/simulate` memory | decisions, bank figures, uploads | `hamilton-workspace.ts:70`, `:128`, `:219`, `:301`; `uploads/service.ts:71`; `decision-service.ts:57` | db: workspace 2 | 404 / empty |
| `/api/alerts` GET/POST/DELETE, `/api/guides/saved-institutions`, institution-page alert actions | fee alerts | `api/alerts/route.ts:29`; `alerts.ts:68`, `:112`; SQL function `deactivate_...(user_id)` | db: alerts 1 | empty / 404 |
| `/pro/monitor`, watchlist actions | watchlist, priority alerts | `monitor-data.ts:211-342`; `monitor/actions.ts:62-170` | db: alerts 2 | empty; A's list unchanged |
| Peer groups (`/pro/settings`, every chart's active group, `/pro/(hamilton)/research/peers` CSV) | personal and team peer groups | `saved-peers.ts:75`, `:91`, `:112`, `:180` | db: peer groups 1-4 | refused (fixed) |
| `/pro/settings` team section | team roster, invite emails | `settings/page.tsx:100` | page: all 3 | hidden (fixed) |
| Grant, revoke and cancel-invite actions | team membership | `settings/actions.ts:169`, `:249`, `:258`, `:308` | db: peer groups 5 | refused |
| `/account` paid reports | paid report links | `account-data.ts:63` (confirmed email only, `account/page.tsx:90`) | db: market report 1 | refused |
| `/market-report/[token]`, `/csv` | paid report | `link.ts:55`; `page.tsx:51`, `csv/route.ts:18` | link: all; db: market report 2-3 | see tokens |

Reviewed with no separate two-account test: these read only the session's own row by `user.id` and
take no client id. `/account` settings and email toggles (`email-actions.ts`), API key
issue and revoke (`api-key-actions.ts:19`, `:29`), Stripe portal (`stripe-actions.ts:162`, the
session's own customer), news watch (`watch-actions.ts:25`), `/api/session`, `/api/leads/reader`.
Unsubscribe links (`/api/alerts/unsubscribe`, `/api/leads/subscription`) act only on an HMAC over
uid and email. Billing pages and checkout are #1920's e2e. `/api/v1/*` and the MCP route serve
public fee data only. `/r/[token]` and `/pay/report/[token]` are under tokens.

## Tokens
- **`/market-report/<id>-<yyyymmdd>-<sig>`** (`custom-report/link.ts`). The signature is
  HMAC-SHA256 under `CUSTOM_REPORT_LINK_SECRET`, cut to 96 bits and compared in constant time. It
  cannot be guessed, and changing the id, the day or one digit fails (link test). A link dated more
  than a day ahead is refused. It lasts 90 days from issue, and nothing else expires it.
- **Revocation and cancelled accounts:** see #2000; the db tests market report 2 and 3 record the
  current behaviour.
- **`/pay/report/<lead>-<day>-<sig>`**: the same scheme with its own prefix. It shows the report
  link only once the lead is paid (or Stripe confirms the session's `lead_id`), and a refunded
  lead shows the refunded page.
- **`/r/<16 hex>`** (`hosted-reports.ts:35`): 64 random bits, so it cannot be guessed, but the
  tokens are not kept secret today. Tracked in #2001.

## Caches
- The **Ask repeat cache** is the 120-second duplicate window in `insertSavedAnalysis`. It is keyed on
  user, institution, focus, prompt and request hash, and locked per user and institution. B asking A's
  question gets a new row (db: saved analyses 2). The memo is written onto the user's own row.
- **`unstable_cache` with user-shaped input:** only `InstitutionBriefing.tsx:32`. It is keyed on
  institution and `{filters, label}`, and the output is a pure function of those, built from public
  fee data. Two teams with the same filters and name share an identical result, so nothing leaks.
  Every other `unstable_cache` and `public-read-cache` key holds public aggregates only.
- **Per-request `cache()`** in `peer-index.ts` covers public index data within one request.
- **Provider prompt caching** (`research/tool-output.ts`) caches the prompt prefix only. It never
  returns an answer.
- **HTTP:** no customer route sets a shared `Cache-Control`. Customer routes read the session
  cookie and are dynamic. The CSV and PDF routes send `no-store`.

## Open risks
1. Market-report links are per bank, not per buyer, so revoking one is coarse (#2000).
2. Hosted report tokens (`/r/[token]`) are not kept secret (#2001).
3. Team invite acceptance should require a confirmed email (#2002).
4. Three unused conversation reads in `research/history.ts` have no user filter (#2003).
5. Not covered here: the email senders (`agents/fee-alerts.ts`, `agents/pro-digest.ts`) group per
   user in SQL but have no two-account test. A live two-account run is #1715.
6. Seen while testing, not a leak: single JSON values in memory facts are stored as strings (#2004).

**Guard:** `src/app/pro/(hamilton)/settings/page.team-isolation.test.tsx:84` (another bank's Pro user who researches bank X sees none of X's team or invites); `src/lib/hamilton/customer-isolation.db.test.ts:404`, in CI's `E2E_TESTS`, checks a member who left a team keeps none of its peer groups
