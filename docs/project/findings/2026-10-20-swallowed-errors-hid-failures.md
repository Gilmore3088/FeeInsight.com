# 2026-10-20: swallowed errors hid real failures

A caught error is recorded where people look (a step warning or a logged error), never turned silently into an empty result.

**What happened:** In #2414 the Deming corrective replay's timeout was caught silently, so a
timed-out run wrote an empty artifact that looked like "nothing to replay". Review caught it, and
#2414 made the timeout a visible `step.warning` before it merged. The same pattern is still in
the Hamilton shell: `getHamiltonArtifactInstitutionId(...).catch(() => null)` at
`src/app/pro/(hamilton)/layout.tsx:94` turns a read error into "no saved institution".

**Cause:** `catch` handlers that return a default value without recording the error.

**Fix:** #2414 merged with the warning. The Hamilton lookup is not fixed; it is tracked on #975.

**Lesson:** When a read or step can fail, let the error surface or record it (a run step warning,
or a logged error with context) before falling back. An empty result must mean empty.

**Guard:** The `step.warning` added in #2414, and the #975 checklist line for the
`layout.tsx:94` lookup.
