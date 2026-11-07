# Source documents need a trusted instruction boundary

**Cause:** Rosetta's paid transcription request placed its task and the source PDF in the user channel; its system channel contained only optional role lessons. Knox kept its extraction task in the system channel but did not explicitly tell the model that source instructions have no authority. Source text could therefore imitate a role or ask for actions without a clear trusted instruction rejecting that request.

**Evidence:** the engineering verification SEC-05 tests reached the real paid-step request builders with provider and SQL boundaries stubbed. Before the fix, two assertions failed on the actual request envelopes: Rosetta's transcription task was absent from system instructions, and Knox lacked an explicit untrusted-source policy. These are envelope failures, not a measured successful attack against a live model.

**Fix:** a shared source-data boundary stays in trusted system instructions, and Rosetta's transcription task moves to that channel. Original PDF bytes and source text remain user data. The requests expose no tools. Prospective paid-strategy identities and role lessons record the change; no historical source is reprocessed and no provider is activated.

**Guard:** `src/lib/engineering-verification/source-injection.test.ts` uses frozen synthetic PDF, HTML and text fixtures, actual normalization/parsing and stubbed paid-step requests. It checks instruction separation and side-effect containment. This deterministic test does not establish live-model immunity or current bank-fee accuracy.

**Agent lesson:** knox/issue-1048-knox-source-instructions-are-data, rosetta/issue-1048-rosetta-transcription-task-above-source
