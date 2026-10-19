# Enforce account lifecycle before authenticating

Issues #2115 and #2116, under Foundation #1048. The login action reached credential verification
on every attempt. Subscriber API keys checked payment and team membership but could still work
when their payer or named holder was disabled.

## Sign-in attempt reservations

Before calling `login`, the action must commit a reservation in the existing
`api_route_audit_events` table. A normalized identifier gets 10 attempts per rolling 15 minutes;
a known client gets 50 across identifiers. The identifier limit still applies without an IP.
Attempts include successful sign-ins; denied attempts neither consume additional slots nor
extend the window. The response is the same for known and unknown identifiers.

Both scopes use domain-separated HMAC-SHA256 with the existing cookie secret. Raw login
identifiers and IPs are not persisted. Identifiers are bounded to 320 characters and NULs are
rejected before authentication, so the database text sanitizer cannot create a different
credential lookup from the limiter's identity. Password formats and verification stay unchanged.

The implementation uses `withTransaction`, explicit READ COMMITTED isolation, and ordered
transaction-scoped advisory locks. Its separate count statement runs after the locks; the next
instance sees the preceding committed reservation. Statement timestamps give the rolling cutoff
and reservation time after lock waits. Lock and query timeouts fail closed, as do missing storage,
failed writes or a failed commit. Enforcement failure cannot reach password verification or
session creation. The audit's `login_attempt_reserved` reason identifies a reservation rather
than a successful credential check.

The client identity retains the application's first `x-forwarded-for` / `x-real-ip` contract,
accepting valid IP literals only. [Vercel documents overwriting `x-forwarded-for` to prevent
spoofing](https://vercel.com/docs/headers/request-headers#x-forwarded-for). Another hosting proxy
must preserve that trust boundary. The existing signup/reset limiter's fail-open policy is
unchanged. Cookie-secret rotation starts new hashed scopes, alongside its existing session effects.

## Subscriber keys

Every subscriber-key request requires both the payer and holder to exist and have
`is_active = true`. A legacy payer-owned key uses its payer as the holder. Payment grace,
cancellation, revocation and active team-seat checks continue to apply. Hand-made partner keys
without subscriber-user lineage retain their issued contract. Denied identities return the
existing `invalid_api_key` code with account-support guidance and never reach the accepted-key
last-used update or its request-lifecycle background retention.

API version 1.11.3 documents the expanded invalid-key guidance in OpenAPI and `/api-docs`; the
error-code set is unchanged. Copy review used the repository's copywriting/copy-editing guidance:
messages give a retry or support action, disclose no identifier/account existence, and derive the
retry duration from the enforced policy. No layout or navigation changed.

## Verification and remaining work

Focused action and key tests cover verifier ordering, operator/customer destinations, aliases,
unknown identities, missing IP, malformed inputs, both inactive/missing users, legacy keys,
payment grace, revoked keys and removed seats. A loopback-only PostgreSQL test uses a private
schema cloned from the current audit table, with its own identity sequence: parallel connections
share the identifier/client allowance, retries cannot exceed it, and old reservations expire.
CI runs this database test in its existing disposable PostgreSQL job.

This change adds no runtime DDL, migration, service, provider activation or production mutation. Existing credentials
are not cleaned up by the merge. Legacy password rehashing, bounded XLSX parsing, safe fetching,
safe health errors and remaining dependency advisories remain separate open security work.
