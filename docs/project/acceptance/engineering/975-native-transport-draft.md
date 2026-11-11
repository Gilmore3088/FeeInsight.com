# Hamilton native transport preparation

This extends the unregistered [board-brief proposal](975-board-brief-draft.md) in draft PR #3010. All original M0–M5 requirements and both required product-native groups remain in scope. The present outcome is infrastructure needed to observe an exact held save without altering its request, response or cancellation. It does not register a contract, authorize activation or replace product browser acceptance.

#3006's approved exact head merged as `baf057d9e87f7f1c48306eb0ad2ef4e60dea787f`. Its first trusted-main proof attempt `43098203644` ended in `startup_failure`, with zero jobs or artifacts; the one-time deferral is consumed. GitHub's [reported Actions outage](https://www.githubstatus.com/api/v2/incidents/unresolved.json) overlapped the attempt, but does not establish its exact cause. Keep the failure and require actual later proof; do not change the frozen workflow from a generic startup diagnostic.

Unchanged-source retry `43105077864` later produced a successful Actions artifact whose downloaded digest matches native metadata. The shipped reader still blocks its historical CI association because the reviewed merge includes disjoint main advances; this draft does not relax that gate or claim formal acceptance.

## Frozen expectations and pre-execution review

The public 29-case inventory is preserved byte for byte in `src/lib/engineering-verification/native-board-brief/__fixtures__/native-boundary-v1.json`, SHA256 `243c3b8d5eb3eb247624f6625220b15208ce5093a6eefd0953367ed5a75db0e8`. It contains synthetic HTTP/TCP literals only. Its original DESIGN_ONLY status describes the source inventory; later execution belongs in separate receipts.

The separate `native-boundary-amendments-v1.json` records prospective connection, event, queue and test-budget clarifications before implementation. Two logical client flows can need four physical TCP connections. The unchanged 256-event limit covers semantic events; raw bytes and byte/chunk counters are separate. The unchanged 8192-byte queue limit needs explicit application and Node socket buffer accounting. Kernel capacity is unmeasured. A local review of these small-fixture bounds grants no R3 owner or authenticated reviewer authority.

## Implementation and evidence order

1. Independently freeze executable transport tests and a private controller API before implementation. Exercise exact HTTP/1.1 bytes, concurrent traffic, arm/held/release causality, ambiguous and repeated controls, incomplete streams, deadlines and finite inventories with trusted literal peers. Keep expected bytes, hashes and rejection conditions unchanged.
2. Implement the bounded raw TCP relay and private in-process management capability. Expose no management URL on the data plane. Preserve request and response framing and bytes, including binary content, chunk extensions and trailers. Separate normal message completion from native connection lifecycle and incomplete or aborted messages. No retry, replacement response or manufactured EOF can repair missing evidence.
3. Execute the trusted literal transport probe in the pinned credentialless Node22 container, with no external network, candidate code, product oracle or host credentials. Retain native configuration before start, bounded raw binary process output, status/timing, wait/stop/removal replies and successful exact-owned absence queries. Container-local loopback demonstrates contained transport only.
4. Implement and independently verify the directional multi-role topology with live allowed controls and denied canaries. Ordinary internal-network membership does not establish app/browser/private-control separation. Real browser, Postgres/auth, full Linux app build and exact cross-layer save correlation each retain their own evidence requirements.
5. Reconcile the authorized #3006 merge before the final native closure freeze. Execute the immutable product baseline/target native pair under the independently reviewed complete boundary. Obtain this proposal's separate exact-head R3 review/authorization and register trusted execution. Local infrastructure results cannot satisfy those dependencies.

## Coverage and qualification

| Inventory | Required evidence | Present scope |
| --- | --- | --- |
| HTTP01–HTTP05 | Exact binary/chunked wire bytes, full duplex, actual causal backpressure, unchanged origin headers | Trusted literal transport preparation |
| HOLD01–HOLD05 | Private ordered arm/held/release witnesses, concurrent control, ambiguity and replay refusal | Trusted literal transport preparation |
| ABORT01–ABORT04 | Native incomplete/abort propagation in both directions and canceled-held refusal | Trusted literal transport preparation |
| BOUND01–BOUND04 | Actual byte/framing/deadline limits and complete contradictory-event rejection | Trusted literal transport preparation |
| NET01–NET06 | Native directional policy, live authorized controls and denied live-target probes | Required; topology not yet established |
| EVID01–EVID02 | Complete bounded raw evidence and tamper/missing-source rejection | Required; complete collector not yet established |
| CLEAN01–CLEAN03 | All owned resources independently absent, partial setup cleanup and unrelated sentinel preservation | Required; complete topology cleanup not yet established |

The transport rows include multiple counterfactuals; a test count does not establish that every observation ran. Keep a per-case ledger with executed observations, missing capabilities and raw evidence references. If the fixed 64 KiB fixture cannot induce write backpressure held until the peer's private release, HTTP04 remains NOT_MEASURED/BLOCKED. A loopback listener alone cannot demonstrate an upstream connection that the kernel never accepts. Partial timeout coverage does not complete BOUND03. Passing unit or contained-loopback tests do not close the 29-case infrastructure inventory or either product-native group.

## Retained local observations

The frozen controller, framer and observation driver are `fc5d1021…`, `46efec0a…` and `c39936d8…` respectively. The 82 focused tests pass. Independent negatives first reproduced continued forwarding after a fatal event/deadline, mutable upstream identity, contradictory held-pressure replay, a missing-input deadline hang and lost native error fields. Their fixes preserve the original budgets and wire expectations. Two separately retained harness-only amendments accommodate a legitimate parse-first refusal and the existing TypeScript environment requirement; neither changes qualifying bytes or limits.

Final local legacy, agentic, type, lint and full-suite checks pass against the actual-main integration. The host is Node24.10.0; the full suite records 24,632 passing tests, zero failures and 1,511 optional tests not run. Required-database CI and product browser acceptance are separate evidence. Earlier remote CI belongs to its earlier exact commit and cannot certify these new files.

Four later literal-peer observations ran inside pinned Node22.23.4 containers with no external network, credentials or candidate code. A separate parent and independent replay checked actual raw process output, exact wire bytes, finite artifact inventories, native configuration, exit status and successful exact-owned removal observations. Each case retained less than 170 KiB and completed within the unchanged 45-second/2 MiB budgets.

| Case | Actual scoped observation | Retained receipt SHA256 |
| --- | --- | --- |
| HTTP01 | Exact binary request/response, complete framing and one complete terminal | `4b6c23af69b1237a695685bb84c15c93e58cfd1e2cb92e1cfd2bae6d5ecb6284` |
| HTTP02 | Exact chunk extensions, trailers and binary wire, one complete terminal | `7d449b0d8da23b1a37ef94cc3dd176dfabd9b127b5058840a5b1130738fa45a3` |
| HOLD01 | No upstream/client bytes before release; private controls 1/2/3 map to the same actual arm, held request and release; forwarded once | `cc41806c2fb8cf69549e49550bcb4aaaf6f6f1e2a6dbee2fcc1cfd88849ee6b6` |
| ABORT02 | Exact partial response, four body bytes against Content-Length eight; framing incomplete, status BLOCKED and terminal aborted | `ea701e435636bf317e7a5be59d5966ba089e935f03296c97ecea0846731f8982` |

These are local observations, not registered proof. The ignored local collector is separately frozen at SHA256 `75cf0d5e3bff17459499d7bc4dbd46795f77f6b8c3c4b4a2966598776407ee3e`; independent retained replay is `4e01873d3537cf5aa532fd020e4644fc7b18a464165d42d112970cdfef7d8817`. Its prior v2 attempt refused the created container before fixture start because Docker had not populated a network ID. That failed attempt and verified cleanup remain retained. The prospective v3 correction accepts an empty pre-start network ID only with the actual created/PID-zero/blank-endpoint state, or the exact independently inspected built-in `none` ID; foreign IDs, addresses, additional endpoints and weakened isolation remain refused. Docker documents that [create does not start the container](https://docs.docker.com/reference/cli/docker/container/create/) and [none supplies only loopback](https://docs.docker.com/engine/network/drivers/none/); pre-start ID population is an explicitly observed lifecycle inference, not a documented guarantee.

All 29 infrastructure cases and both product-native groups remain required and blocked as a whole. NET, full EVID/CLEAN, actual backpressure and the unaccepted-connection deadline still need their own observations. Next, prepare Linux dependencies from the trusted lock/vendor inputs and measure a full contained Next build; the retained Darwin dependency installation is unsuitable for that probe. Complete directional multi-role isolation before running app, browser and database journeys.

The relay follows the framing and incomplete-message distinctions in [RFC 9112 sections 6.3 and 8](https://www.rfc-editor.org/rfc/rfc9112.html#section-6.3). Socket half-close, reset and stream-pressure behavior must be observed using the [Node22 socket API](https://nodejs.org/docs/latest-v22.x/api/net.html); a stream threshold is not an independently measured memory bound. These references guide implementation, while frozen literal cases and actual native observations determine the scoped result.
