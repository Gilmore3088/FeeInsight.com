# Fresh official-source diagnostic (#2061)

This is a separate automated diagnostic of the current published dollar-fee catalog. Each sampled
fee is checked against a fresh copy of the bank page it was read from (since 2026-11-02, see
`docs/project/findings/2026-11-02-live-audit-scores-nothing.md`). A page that loads gives the fee a
verdict: supported, mismatch or not found on the page. A fee is unknown only when its page did not
load or gave no text, and the reason is recorded. The existing stored-copy audit, answer-key
v3/reference cohort and James's weekly 50 whole institutions remain separate. No numerical target
or launch gate is changed. Missing fees, rate fees and population exclusions limit interpretation.

## Fixed frame and evidence identity

The exact current `fresh-audit.ts` dollar predicate selects `published_fee_catalog` rows with a
`review_status=approved`, a non-null amount and `amount_kind IS DISTINCT FROM percent`. The quick Atlas draw step
freezes the complete ordered population IDs, a cryptographic seed and up to 500 selected rows,
without network I/O. Domain-separated SHA256 orders select rows and institutional groups. A daily
transaction/advisory lock preserves the first UTC-day/series draw, including malformed/unavailable
tombstones; a retry of the same series never redraws.

The draw has two producers. The diagnostic's own admission queues a one-step draw run on a tick
where no draw of the current series exists for that UTC day and no current-series draw is still
open. The daily scoreboard's
draw step finds that draw and reuses it. Until 2026-11-01 only the scoreboard drew, after all its
measurements. An earlier scoreboard failure cancelled the draw (Oct 29, Nov 1), and the draw's
10-second SQL budget failed the whole scoreboard run (Oct 25, Oct 28). The draw now has 25
seconds. When the scoreboard's draw step runs out of SQL budget it completes without a draw, and
admission retries on a later tick.

**Series and checker versions.** A draw is identified by the frame, page and report protocol
(`LIVE_SOURCE_AUDIT_SERIES = live-source@2:frame1:page1:report2`), not by checker versions. Until
2026-11-02 the series named the source-check, category, name and audit versions, so every deploy
that bumped one made the open draw unclaimable and admission drew again. Four bumps on Nov 1-2 gave
five draws, and none got past 48 of ~465 institutions. Each verdict now carries
`checker: source<v>:category<v>` (`LIVE_SOURCE_AUDIT_CHECKER`), so a bump mid-draw keeps the same
dated draw going, and a reader can split a day's verdicts by checker. A change of frame, page or
report protocol still starts a new series, and admission's per-day redraw cap still applies.

The SQL applies the 250,000-ID sentinel before population aggregation, sampled-row size checks
before transfer, and caps actual escaped UTF8 JSON encoding. Each selected row is at most 8 KiB;
its exact full catalog projection, raw line-share and source ID/institution/URL/hash/vault/status/
supersession are fingerprinted. Semantic authority policy is whitelisted and frozen once per
institution: homepage, stored schedule/canonical URL, strategy/kind, correction version/lock,
last successful document/hash and explicit rejected/do-not-retry URLs. No full profile or graph
is duplicated 500 times. Policy is at most 32 KiB each/2 MiB total, stored-document inventory 256
per group, complete draw 8 MiB. Any necessary over-cap inventory makes the whole frame visibly
unavailable; smaller records never substitute for expensive selected rows.

The deployed read-only sizing inventory on 2026-10-19 found 82,725 eligible dollar rows across
3,965 institutions. A deterministic sizing-only 500-row example was about 1.0 MiB; it was neither
a real persisted random draw nor a correctness label. The predicate excludes percentages and
unpublished/missing fees. An absent product is unknown ownership, never general/all products.

## Finite tick work and authority

All new draw, observation, capture and archive work is pipeline-gated and non-exempt. The daily
60-second route stays queue-only. Existing BOTH-paused scoreboard continuation and its exemption
list remain unchanged. A tick admits at most one diagnostic workflow per ten-minute UTC bucket,
with one active diagnostic workflow globally. Serialized admission and whole-key run reuse cover
concurrent/terminal retries. Oldest unexpired unfinished draw work rotates with due captures;
expired bookkeeping and completed-later archives run separately so an expired draw cannot starve
fresh work. Explicit execution deadlines must fit each 90-second network step even when first.
A queued diagnostic run ranks ahead of state lanes (after storage work and a waiting scoreboard),
except on a tick that also holds the publish-sweeps run. Until 2026-11-01 the steps were priced
at 150 s and ranked with ordinary work; the tick had 30-149 s left at their turn, so no chunk ever
ran (`docs/project/findings/2026-11-01-live-source-chunk-never-fit-the-tick.md`). Admission skips
a draw frozen under an older series, which no claim can use.

One claim freezes at most 12 forward-only groups, with three workers, 60 seconds of external
work and a separate 20-second receipt phase. Workers start no new group after 35 seconds; groups
already started have the rest of the 60 seconds, and groups not started stay unattempted for the
next chunk rather than becoming unknown. A group still being read when the 60 seconds run out is
not recorded: the cursor stops before the first such group and the next chunk reads it again.
Only the chunk's first group is recorded as unknown when it is cut, so a bank that never fits
cannot stall the draw. At most 500 chunks are retained. No transaction spans HTTP/storage.

The save is small (2026-11-02). Until then it ran out of its 10 s budget on 9 of 20 chunk steps,
because it reloaded, rebuilt and hashed the 3.9 MB draw, sent every institution's policy, and ran
the capture admission (which reloaded the draw again) inside the same transaction. Now it checks
the draw with one small query (`liveAuditDrawStillCurrent`: the claimed draw's event is still its
day's newest draw event) and compares only this chunk's fees. The capture admission runs after the
save, in its own transaction, with the draw the step already holds. A save that still runs out of
budget completes the step with no receipt, and the next chunk reads the same institutions again.
The step no longer fails the run or cancels its archive step.

Which draw the current reader (and so the daily snapshot) reports: the newest current-series draw
once it is complete; while it is still being read, the newest earlier current-series draw that is
complete or whose 24-hour window has ended; and only when there is none, the open draw. The snapshot runs before the
scoreboard's draw step and after admission may already have started today's draw, so it never
reports a just-started or just-redrawn draw as attempted 0.

Admission's own draw runs are capped at six a UTC day, at least 30 minutes apart, counted by the
runs themselves, so a draw that keeps running out of SQL budget cannot take every tick from
captures and maintenance. Capture requests and maintenance consider only the current series.

The receipt phase uses one short-lived native max-one PostgreSQL client cloned only from the
supplied parsed endpoint/TLS/auth/type/schema/role options. Missing/partial options, custom sockets
and multi-host configurations fail closed rather than inheriting global/process defaults. A
single absolute deadline covers admission/settlement queries, with decreasing server statement/
lock limits for ordinary statements inside explicit short transactions, plus memoized awaited
client shutdown. SQL outside those transactions is rejected; sequential archive helpers release
their locks between transactions while sharing one absolute phase deadline. No auxiliary query-cancellation connection is
opened. No new query or commit starts after revocation. An already-sent COMMIT can finish on the
server after client shutdown; `live_audit_commit_outcome_unknown` is a failed/unavailable caller
receipt, never a successful result or proof of rollback. Later durable events are validated and
retries reuse the original generation, without duplicate counting. Application deadline/client
shutdown does not prove server-side cancellation of that in-flight COMMIT. A real ledger claim binds run, step, source, draw,
cursor, owner and lease. Settlement locks progress, validates the latest claim and original draw,
and checks current row/source/policy identities inside the insertion statement. A late/duplicate
worker cannot advance another generation. Drift becomes unknown, never old support.

Each group fetches its fees' own document addresses (`source.url`, each once, at most six). No
homepage walk, remembered alternate URL, guessed path or provider search is used. Pinned fee-source
transport validates each redirect and actual destination connection. Fresh 200 responses are
required; 304/stored bytes never substitute. Per-request eight seconds includes streaming body and
conversion: 8 MiB bytes, 30 PDF pages, 100,000 items and one million text chars. HTML is read with
Rosetta's own reader (`extractHtmlDomText`), so the page's lines look like the stored text the fee
was extracted from. No links are kept, so the graph metadata stays a few hundred bytes. A failed
fetch is recorded in the graph's `failed` list with its reason (`live_fetch_enotfound`,
`live_timeout_or_cancelled`, `live_type_unreadable`, `live_page_cap`...).

The evaluator (`evaluateLiveAuditFee`) uses the shared match rule, `checkFeeAgainstSource`:
- `supported` (`own_current_fee_supported`): the page prints the fee at our amount, and the category
  guard accepts the name for our category.
- `mismatch` (`positive_current_contradiction`): the fee's own row (a line starting with its name)
  has exactly one price that the shared check traces to this fee, and that price is not ours
  (`amount`). Or the guard refuses the name for our category (`category`).
- `not_found` (`not_on_live_page:<check reason>`): the page loaded and does not print this fee at
  our amount.
- `unknown`: the page did not load, answered with a status other than 200, or gave no text.
Until 2026-11-02 the evaluator needed a complete homepage graph, a proven consumer heading and the
fee's own frequency, conditions and basis. All 122 observations on Nov 1-2 came out unknown.

## Capture episodes and history

A real observation can request a side copy only when the page did not support the fee (mismatch
or not found) and its newly observed bytes differ from the fee's frozen source. This is the feed:
Magellan copies the exact live bytes, and the usual read, extract, verify and publish then judge
the live fee against what the bank serves today. A supported fee asks for nothing. A fee the page
did not support although its bytes match the stored copy cannot be helped by a re-fetch; the
chunk records it in `unsupportedSameBytes`, and Darwin's live re-check reads the stored copy under
today's rules. No live fee is held or taken down by this audit. Admission binds original
chunk/observation, institution, policy, product, URL and
byte/text identities. Stable-identity serialization prevents duplicate active requests across
fees/chunk retries. Magellan actually consumes the request in its ledger step; its Atlas tail
archives the result. An unconfigured vault is terminal blocked without HTTP. Fresh capture must
return the exact observed URL/hash, and its content-addressed vault receipt must match. The final
transaction rechecks original request/claim/current identities and writes only an ordinary source
side copy. An existing row is reused only for the exact observed URL/hash, successful status and
already-correct vault key. Failed, unvaulted or other-URL rows remain byte-for-byte unchanged; an
insertion uniqueness conflict records blocked instead of repairing or relabelling them. Existing
source pointers, keys, profiles, fees and human labels are unchanged.

Each episode has at most three attempts/24 hours, ten-/sixty-minute retry backoff and an actual
terminal captured/blocked/stale/failed disposition. Authority/identity drift is terminal; transient
transport/storage failures retry within the cap. After a terminal non-captured episode, only a
new fresh bound observation after 24-hour cooldown may create a linked later episode; the same
observation cannot reset it. At most three episodes per identity in rolling seven days, no duplicate
active episode and no new James queue. Newest malformed/wrong-origin claims or dispositions are
tombstones. Counts use the same bounded batched provenance validator as consumers.

The current reader performs no network or writes. It validates draw/progress/origin/arithmetic,
rechecks each fee's own row, line and document (the institution's source policy is no longer part
of the drift check), and has no older/stored fallback. The live score is
supported/(supported+mismatch+not found): the share of fees whose page loaded that the page prints
at our amount. The selected-fee envelope still places unknowns and unattempted fees on either
side. Expired, empty/all-unknown/unavailable samples have no percentage. The score is on the
scoreboard panel, in the goal brief, and in the accuracy history's "Live-site score, by draw" table
(`readLiveScoreHistory`, one row per draw from the daily snapshots' `goal.liveSourceAudit`). It is
kept apart from the stored-copy weeks and never pooled with them.

Late completion updates only its original existing snapshot's diagnostic component under a row
lock, with a final atomic current-state guard. Missing snapshots remain final_unarchived. A
snapshot retry preserves a validated retained final under its lock, never arbitrary archive-field
presence. Admin history and the goal/quality-ledger brief use the same validated component; malformed
or legacy history has no numerical fallback. Protocol, frame, page and report changes separate series;
checker versions are recorded on each verdict instead (2026-11-02).

Each summary also carries up to ten attempted fees in the draw's own seeded order (`examples`):
our row's name, amount, category and frequency, the verdict and reason, the bank line read and its
link. Components written before this field validate without it.

Compact archives are at most 128 KiB: per-fee fingerprint/verdict/observation hash, summary/reason/
dimension arithmetic, unique graph hashes, capture request IDs and ordered immutable chunk IDs
plus the digest of the full ordered ID/hash manifest. The full manifest is validated before
archiving. Individual chunk hashes, full documents/graphs and original row payloads cannot be
reconstructed after their origins age out; a checksum is not independent ground truth. An over-cap
archive remains final_unarchived without dropping selected rows. Normal 90-day origin retention
has at most seven extra days: before release, the real storage savepoint must leave a durable
compact archive or explicit provenance-unavailable tombstone. Tombstone failure rolls back trim.
Malformed orphan namespace events also require a bounded immutable-origin tombstone. Existing
retention switches are unchanged; unrelated snapshot fields and audit/key history are preserved.

## Verification and limits

All bank HTTP, parsing and storage tests use injected bytes or owned loopback fixtures. Actual
PostgreSQL tests cover draw/chunk/capture concurrency, immutable identity drift, malformed latest
receipts, 70 partial chunks, episode cooldown/caps, post-snapshot-lock drift, real scheduled
Magellan-to-Atlas archive, validated snapshot retries and finite retention/rollback. Pure tests
cover the old-200/new-current and delegated older-product cases, own applicability, complete-graph
caps, archive arithmetic, 500 origins and encoded-byte limits. Rendering/email controls keep
unknown/legacy/retention loss separate from current evidence and weekly launch measurement.

No production test, bank fetch, provider call, source/key repair, replay, migration, permission,
retention activation or extra human confirmation is part of this outcome. Broader missing-fee
recall, feedback completion, product-reader coverage and independent source authority remain in
their existing workstreams.
