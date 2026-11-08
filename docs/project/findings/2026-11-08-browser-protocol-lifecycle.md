# 2026-11-08: Browser protocol evidence needs exact lifecycle identities

**What happened:** Strict Hamilton diagnostic captures retained uncorroborated request cancellations. Source review could not establish internal Next.js cancellation intent, action settlement or successful persistence. Independent tests and a minimal native Chromium control comparison are being used to develop a separate passive collector; they do not certify Hamilton product journeys.

**Cause:** A URL, HTTP 200 header, quiet network period or rendered destination cannot identify an exact request's transport terminal or prove an action's result. A safe-log reducer can also overstate completeness if configuration failures, contradictory terminal fields, orphan redirect hops or duplicate identities disappear during replay.

**Fix:** Foundation #1048 adds registered-session CDP capture with generated context/session/frame/document/request/hop identities, bounded projection, explicit navigation and native terminal events. The opt-in Hamilton attachment remains separate from the unchanged strict v1 gate. Replay preserves blocking reasons and rejects contradictory identities. Action settlement/effects and unseen targets remain unknown.

**Lesson:** Join native lifecycle events before discarding private identities, preserve every reason a capture is incomplete, and independently test both producer and replay. A local transport diagnostic must never grant application or production acceptance.

**Guard:** `src/lib/engineering-verification/browser-protocol.test.ts`, `tests/e2e/hamilton/evidence.test.ts`; expanded-contract and exact-build journey acceptance remain unchecked in Foundation #1048.
