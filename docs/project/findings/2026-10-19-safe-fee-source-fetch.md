# 2026-10-19: Pin fee-source connections to public destinations

**What happened:** The F15 code audit found that operator-mediated institution URLs and links
found on their pages reached native `fetch` with automatic redirects. The default Magellan and
Rosetta paths had no common restriction on resolved destinations or subsequent redirect hops.
This establishes a missing egress control, not unauthenticated SSRF, deployed private-network
reachability, or an exploited service. No production exploit or bulk source fetch was attempted.

**Cause:** URL/fee-page suitability checks and caller timeouts served a different purpose from
connection safety. A scheme check, bank-domain check, or DNS preflight alone cannot prevent a
redirect to a private address or a second DNS resolution choosing a different destination.

**Fix:** Issue [#2136](https://github.com/Gilmore3088/FeeInsight.com/issues/2136) adds the shared
Node-only `feeSourceFetch` transport and routes the default source paths below through it.
This finding describes the code change; merge/CI receipts belong to the PR. It does not perform
the current-document eligibility work in #1862 or the live measurement work in #2061.

## Connection boundary

- Only GET/HEAD URL requests using HTTP port 80 or HTTPS port 443 are supported. Explicit
  default ports normalize normally. URL credentials, other ports/protocols and Request/body
  inputs are refused. WHATWG URL parsing canonicalizes numeric/encoded IPv4 before checks.
- Every hop resolves all IPv4/IPv6 answers once, refuses empty, malformed, excessive (>128)
  or mixed public/non-public answer sets, and copies the validated addresses into the socket's
  custom lookup. Node's family selection can use only that snapshot. Literal IPs are checked
  directly. A later DNS answer cannot change the socket destination. Each redirect, even to
  the same host, starts a new resolution and validation.
- IPv4 private, loopback, link-local, unspecified, shared, multicast, documentation, benchmark,
  reserved and special-purpose blocks are refused. IPv6 must be in global unicast `2000::/3`
  outside the listed special-purpose blocks. This also refuses mapped/compatible IPv4, standard NAT64 prefixes,
  Teredo, 6to4, zones, ULA, link-local and multicast. Special-purpose protocol anycast ranges
  are conservatively refused even where IANA marks a more-specific address globally reachable.
  This is an address policy, not a bank-host allowlist. Ordinary public bank/CDN hosts need no
  enrollment. Newly allocated IPv6 space outside the policy requires a reviewed code update.
- Native HTTP(S) receives the original URL: original Host, SNI and certificate hostname
  verification remain intact. `rejectUnauthorized: true`, standard `checkServerIdentity`, a
  strict HTTP parser and 16 KiB response-header cap are explicit. There is no custom CA,
  certificate bypass or IP-as-TLS-host rewrite in the default transport.
- `agent: false` creates a one-use native agent for each hop. There is no shared connection
  pool, DNS/application cache, cookie jar, implicit retry or environment-proxy transport. This
  avoids reusing connections outside a hop's validation. Browser/Next fetch caching is not
  involved. Conditional GETs still use caller validators; a 304 keeps its headers and null body.
- Follow at most five redirects. Each target passes the full URL/address policy. Redirect
  bodies are destroyed without consuming them. Manual/error modes are supported. Caller Host,
  framing and proxy-authorization headers cannot override the URL's authority. Cross-origin
  hops drop Authorization, Cookie/Cookie2, proxy credentials and conditional validators;
  same-origin hops retain validators. User-Agent and Accept remain available.
- One 15-second deadline covers DNS, connection, headers, redirects and body. Existing caller
  AbortSignals can shorten it and destroy in-flight requests/streams. DNS itself is not
  cancellable through `dns.lookup`; the wait is bounded and a late answer cannot open a socket.
- Each final body is bounded to 15 MiB of both wire and decoded bytes. Content-Length is an
  early check; chunked/untrusted lengths and compressed bodies also pass streaming counters.
  Standard gzip, zlib deflate and Brotli are decoded as with fetch; unsupported/malformed
  encodings fail closed. Original response headers (including encoding/wire length), status,
  final URL and `redirected` flag are retained, including when cloning the Response.

The implementation uses supported native Node APIs without adding a transport dependency.
Its custom lookup/family fallback, single-use agent and TLS identity behavior follow the
[Node net connection options](https://nodejs.org/docs/latest-v22.x/api/net.html#socketconnectoptions-connectlistener),
[HTTP request options](https://nodejs.org/docs/latest-v22.x/api/http.html#httprequestoptions-callback)
and [HTTPS request documentation](https://nodejs.org/docs/latest-v22.x/api/https.html#httpsrequesturl-options-callback).
Address policy was checked against the
[IANA IPv4 special-purpose registry](https://www.iana.org/assignments/iana-ipv4-special-registry)
and [IPv6 special-purpose registry](https://www.iana.org/assignments/iana-ipv6-special-registry)
on 2026-10-19. The conservatively blocked lists are reviewed code, not a live IANA dependency.

## Default transport/caller inventory

| Default entry | Source reads reached through this seam |
| --- | --- |
| `magellan/discovery.ts` | Homepage, robots/sitemaps, observed/guessed/peer links, hub/crawl, fee validation, second-document/account/agreement/site-search checks |
| `magellan/fetch.ts` | Main schedule download/conditional re-fetch; propagated to companion fetch |
| `magellan/paid-find.ts` | Homepage links and plain validation of paid finder answers |
| `magellan/schedule-search.ts` | Plain validation of proposed supplemental schedules |
| `magellan/website-find.ts` | Plain validation of proposed official homepages |
| `rosetta/read.ts` | Unvaulted main/companion document bytes and linked/print/JavaScript fallback documents |
| `rosetta/paid-read.ts` | Plain source download before a paid read; configured vault bytes still avoid a source fetch |
| `run-store.ts` explicit transports | Address-variant and saved-link downloads, which previously injected global fetch directly |

`find-validate`, `finders`, `second-document`, `companion-fetch`, `address-variant-fetch`,
`saved-link-fetch` and Rosetta fallback functions receive the selected transport; they do not
choose an additional default. Existing explicit test transports remain injectable. The
hand-supplied reader continues answering external requests with its existing refusal transport.
Vault reads, fixed regulator/registry clients, provider APIs, Anthropic server-side web-fetch,
Growth and Atlas's audit of our own public pages use separate transports and are unchanged.
This is the fee-source HTTP boundary for these default pipeline paths, not a claim that every
outbound request in the application now has this policy. A provider fetching a page server-side
does not make a socket from this Node process and is outside this transport's enforcement.

## Compatibility and limits

The existing fetch injection contract remains `typeof fetch`, but this client intentionally
implements the URL GET/HEAD subset used by the source readers. It uses native HTTP/1.1;
HTTP/2-only endpoints, nonstandard ports, special-purpose hosts, unsupported encodings, more
than five redirects or downloads beyond the time/size cap fail explicitly. There is no fallback
to unrestricted fetch, private addresses, alternate credentials or disabled certificate checks.
The implementation and tests use the repository's Node 22 runtime and CI configuration.

Bodies are fully bounded before the fetch promise resolves. This means callers' existing
8-/15-second timers also cover download time, rather than ending at response headers. Existing
narrower reader limits (for example Rosetta's 8 MiB) still apply. A client size refusal is
classified as `too_large`, preserving the existing source-attempt category. A returned body can
be read/cloned/cancelled normally; cancellation after return discards already-bounded bytes.
No database, fee row, source URL, provider budget, deployment configuration or security setting
is changed by this implementation. Blocked URLs remain ordinary recorded fetch failures for
existing operator/retry workflows. This transport does not establish whether a public page is
the current consumer fee schedule, complete, correct, or applicable to an institution.

## Verification

The new focused suite uses an injected resolver/request adapter and owned ephemeral loopback
HTTP/TLS servers. Only the test adapter remaps validated public fixture addresses to the owned
server and trusts its public test certificate; neither capability is selected by an input URL
or used by the default client. No existing private/metadata service or production endpoint is
requested. Tests cover encoded/private/reserved IPv4/IPv6, all-answer/mixed DNS refusal,
post-validation mutation/pinning, rebinding on redirects, cross-origin credential protection,
ordinary HTML/PDF and final header/URL provenance, conditional 304/HEAD, trusted/wrong-name/
untrusted TLS, redirect loops, compressed/chunked/declared limits, header overflow, DNS/header/
body/chain deadlines and caller cancellation. Existing Magellan/Rosetta suites exercise their
injected transports unchanged. Repository type/lint/agentic/full-suite gates accompany the PR.

The schema-backed lane E2E suite formerly stubbed only global fetch. Its source-client seam
now delegates to those same in-memory bank fixtures through a test-only module mock that
preserves the client's other exports. This keeps synthetic bank names off the network while
the transport policy itself is tested separately, without a production fallback or bypass.

**Lesson:** Source suitability is not socket safety. Keep the public-destination check at the
connection boundary and route every new default fee-source path through it. Do not weaken it
when a bank blocks the crawler; retain a visible refusal and use the existing approved source
intake/read workflow.
