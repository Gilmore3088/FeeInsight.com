# 2026-11-02: The live-site audit ran but gave no fee a verdict

**What happened:** After #2836 the daily live-site audit (#2061) finally read banks, but it
gave no fee a verdict. From the first chunk (Nov 1, 22:41 UTC) to Nov 2, 05:43 UTC, prod has 10
`live_fee_audit.chunk` events with 122 observations, and all 122 are `unknown`. There has been no
live score for 14 days. (Read-only queries of `agent_runs`, `agent_run_steps` and
`agent_run_events` on project rmhwbbjjctzfaqjyhomu, 2026-11-02.)

**Causes:**

1. **The evaluator required a complete walk of the bank's site.** Each institution began at its
   homepage, followed fee and hub links up to six pages, 160 links and 32 KiB of graph metadata,
   and any cap made the whole institution `unknown`. Of 120 institution graphs, 47 hit the
   six-page cap (38 of them before they read any schedule) and 38 dropped the whole graph at the
   32 KiB metadata cap: a page with about 300 links is about 30 KiB of metadata. Where a schedule
   was read, the evaluator still needed a proven consumer heading, the fee's own frequency,
   conditions and basis, and a single applicable document. The other reasons on prod were
   `official_schedule_unproven` (no schedule found from the homepage), `candidate_audience_unproven`,
   `live_http_failure` and `live_timeout_or_cancelled`.
2. **Half the saves ran out of SQL budget.** 9 of 20 chunk steps since Nov 1 failed with
   `live_audit_sql_budget_exhausted` 15-30 s into a step whose work ends at 70 s. The claim had
   already been written, so the failure came in the 10 s save. The save opened a new client, loaded
   the 3.9 MB draw (1.1 MB of rows, 1.1 MB of policies, 1.0 MB of source lists, 0.66 MB of
   population ids), rebuilt it and hashed it twice, re-read every chunk, and sent all ~465
   institutions' policies with the insert. Then, inside the same transaction, the capture admission
   loaded and re-hashed the draw again and compared all 500 rows and all policies. A failed save
   also failed the run and cancelled its archive step.
3. **Every version bump restarted the draw.** The draw's series named the source-check,
   category, name and audit versions, so each deploy that bumped one made the open draw
   unclaimable and admission drew again. Four bumps gave five draws on Nov 1-2 (series `source28:category101`,
   `audit10`, `category102`, `source29`, `source30`) reached 24, 0, 12, 48 and 12 of about 465
   institutions. At 12 institutions a chunk, a draw needs about 39 chunks, and no draw lived long
   enough to get them.
4. **The result fed nothing.** No verdict reached Darwin, a hold, a re-read or the accuracy
   history. The capture request (Magellan copies the live bytes so the pipeline reads them again)
   had never fired: prod has no `live_fee_audit.capture_requested` event.
5. **Sunday maintenance failed on an aborted transaction (Nov 1, run 17732).** Its seven reads ran
   in parallel on the step's ledger transaction, and only two were in a savepoint. One read timing
   out turned every later statement into "current transaction is aborted". The step failed and
   cancelled the live draw and three Atlas steps after it.

**Fix (this PR):**
- The fee is checked against a fresh copy of the page it was read from (`source.url`), not a page
  found from the homepage. HTML is read with Rosetta's own reader (`extractHtmlDomText`), and no
  links are kept. A page that loads gets a verdict from `checkFeeAgainstSource`: `supported`;
  `mismatch` (the fee's own row at another single price, or a name the category guard refuses
  for our category); or `not_found` (the reason carries the check's own). `unknown` is only for a
  page that did not load or gave no text, and it records why (`live_fetch_enotfound`,
  `live_http_404`, `live_page_no_text`, `live_timeout_or_cancelled`...).
- The live score is supported / (supported + mismatch + not found). It is on the scoreboard
  panel, the goal brief and a new "Live-site score, by draw" table in the accuracy history (one
  row per draw from the daily snapshots' `goal.liveSourceAudit`), apart from the stored-copy weeks.
- The save checks the draw with a small query that confirms it is still its day's newest draw
  event, sends only this chunk's fees, and drops the policy from the drift check. Capture
  admission runs after the save in its own transaction, reuses the draw already held, and
  compares only its candidates. The save has 20 s (work 60 s, start cutoff 35 s, step still 90 s).
  A save that still runs out completes the step without a receipt, and the next chunk reads the
  same institutions again.
- The draw series is now `live-source@2:frame1:page1:report2`. Each verdict carries
  `checker: source<v>:category<v>`, so a bump no longer restarts the day's draw.
- Feed: a fee the page did not support (mismatch or not found), served from bytes that differ
  from its stored copy, asks Magellan for a capture. The copy then goes through the usual read,
  extract, verify and publish. A fee left unsupported when the page bytes match the stored copy
  cannot be helped by a re-fetch; the step records it in `unsupportedSameBytes`. Nothing here
  takes down or holds a live fee, so no `*_LIVE` switch is added.
- Sunday maintenance runs its reads one after another, each in its own savepoint. The step runs
  in a savepoint and records a failure as its own receipt, so it no longer cancels the draw.

**Not done / to verify after deploy:** No bank page can be fetched from the build container, so
the new verdicts have no production count yet. Whether a capture's side copy is read by Rosetta
the same day has not been seen on prod, because no capture has ever been requested.
