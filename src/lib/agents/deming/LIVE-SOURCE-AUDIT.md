# Fresh official-source diagnostic (#2061)

This is a separate automated diagnostic of the current published dollar-fee catalog. It observes
fresh official-path bytes and distinguishes positive own-fee support, positive same-fee
contradiction, unknown evidence and unattempted work. The existing stored-copy audit, answer-key
v3/reference cohort and James's weekly 50 whole institutions remain separate. No numerical target
or launch gate is changed. Missing fees, rate fees, population exclusions, correlated layouts and
the shared source/category/name validators limit interpretation. A merged change is no live-bank
accuracy measurement or proof of recovered data.

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

**Series change.** A draw is scored only under the series it froze. That series names the
source-check, category, name and audit versions; on prod it changed between consecutive daily
draws in 5 of 8 cases. A deploy that changes the series leaves the open draw unclaimable, since
its origin no longer validates. Admission then takes a fresh draw under the new series, at most
three draws per UTC day, and that draw gets its own full 24-hour window. The superseded partial
draw keeps its own events and reads as `draw_superseded_or_malformed`. It is never pooled with the new one,
and it is never archived as if complete. We chose redrawing over continuing one draw across
series because every verdict in a draw then comes from one checker. The other approach would
need per-verdict series in every receipt shape, summary, archive and reader, and its daily score
would still drop every verdict made after the bump.

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

One claim freezes at most 12 forward-only groups, with three workers, 70 seconds of external
work and a separate ten-second receipt phase. Workers start no new group after 40 seconds; groups
already started have the rest of the 70 seconds, and groups not started stay unattempted for the
next chunk rather than becoming unknown. A group still being read when the 70 seconds run out
(six pages at eight seconds can exceed the 30 seconds left) is not recorded: the cursor stops
before the first such group and the next chunk reads it again. Only the chunk's first group is
recorded as unknown when it is cut, so a bank that never fits cannot stall the draw.

Which draw the current reader (and so the daily snapshot) reports: the newest current-series draw
once it is complete; while it is still being read, the newest current-series draw whose 24-hour
window has ended; and only when there is none, the open draw. The snapshot runs before the
scoreboard's draw step and after admission may already have started today's draw, so it never
reports a just-started or just-redrawn draw as attempted 0.

Admission's own draw runs are capped at six a UTC day, at least 30 minutes apart, counted by the
runs themselves, so a draw that keeps running out of SQL budget cannot take every tick from
captures and maintenance. Capture requests and maintenance consider only the current series. At most 500 chunks are retained because cancellation
may finish only one group per chunk. Started failures become unknown; an unstarted tail remains
visible. No transaction spans HTTP/storage.
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

Each group starts at its frozen official homepage. Only actually observed fee/hub edges are
followed; remembered row URLs, guessed paths and provider searches do not establish authority.
Pinned fee-source transport validates each redirect and actual destination connection. Fresh 200
responses are required; 304/stored bytes never substitute. Per-request eight seconds includes
streaming body and conversion: 8 MiB bytes, 30 PDF pages, 100,000 items and one million text chars.
At most six pages, 160 distinct group links and 32 KiB graph metadata are allowed; the whole draw
has a 4 MiB graph budget and each chunk a 512 KiB event cap. Unreadable linked candidates, caps,
missing homepage, timeout/cancellation, source locks/rejections and contradictory supersession
remain unknown. Current-path freshness is conditional on this bounded graph, not exhaustive search.

The evaluator requires positive institution, audience, product and own-fee identity. Consumer
service copy is no consumer heading. A null/ambiguous primary-product attestation cannot certify a
mixed-product document. Own frequency/basis/conditions/waivers must agree; a neighbor's condition
cannot support this fee, and a null catalog restriction cannot silently mean unconditional. An
absent line is unknown. Only positive contradictory same-fee evidence can produce mismatch. An old
URL returning 200 does not override a newly linked schedule; a currently delegated older named
product remains distinct from a newer general schedule. Changed bytes alone never mean wrong fee.

## Capture episodes and history

A real observation can request a side copy only when exact newly observed bytes differ from its
frozen source. Admission binds original chunk/observation, institution, policy, product, URL and
byte/text identities. Stable-identity serialization prevents duplicate active requests across
fees/chunk retries. Magellan actually consumes the request in its ledger step; its Atlas tail
archives the result. A configured vault receives a real abort signal for HEAD/PUT; this change
never activates R2. An unconfigured vault is terminal blocked without HTTP. Fresh capture must
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
rechecks current row/source/policy identity and has no older/stored fallback. Conditional support
uses supported/(supported+contradicted); selected-fee lower/upper envelope places all unknowns on
either side. This is an ignorance envelope, not a confidence interval or certification. Expired,
empty/all-unknown/unavailable samples have no percentage. Draw IDs and protocol/dependency series
are never pooled as independent labels or credited as v3/launch improvement.

Late completion updates only its original existing snapshot's diagnostic component under a row
lock, with a final atomic current-state guard. Missing snapshots remain final_unarchived. A
snapshot retry preserves a validated retained final under its lock, never arbitrary archive-field
presence. Admin history and the goal/quality-ledger brief use the same validated component; malformed
or legacy history has no numerical fallback. Protocol/authority/frame/report changes and checker,
category/name dependency versions separate series.

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
