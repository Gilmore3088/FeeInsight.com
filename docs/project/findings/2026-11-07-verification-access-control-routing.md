# Verification risk routing must cover actual authority owners

**Cause:** the verification classifier recognized `lib/auth` and `api/auth`, but password hashing/reset, session-cookie signing, API-key access and workspace grants live at other repository paths. Those changes could declare R1/R2 and avoid the R3 owner-authorization requirement.

**Evidence:** independent Codex review of `c5144c0042133260b51dc01226d46d1a80c6366e` identified the real password and membership modules. Twenty regressions using actual authentication and authority paths failed against that implementation, including a lower-risk contract that did not require owner sign-off.

**Fix:** classify the repository's authentication, access-token, report-link and workspace-authority owners, including their server-action entry points, as R3 before ordinary feature routing. This changes engineering policy only; no password, membership or permission setting is changed.

**Guard:** `src/lib/engineering-verification/contract.test.ts` requires each real path to route to R3, rejects lower declared risk and rejects R3 without required owner approval. Path routing remains an ownership heuristic; reviewers must still raise risk when a new helper gains authority. Tracked with Foundation #1048 in PR #2995.
