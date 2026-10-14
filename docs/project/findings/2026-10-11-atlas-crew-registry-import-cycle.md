# Atlas registry and crew status: direct runtime import cycle removed

R07 / #983. `src/lib/agents/crew.ts` read Atlas schedules through `atlas/registry.ts`, while that registry imported the runtime `CREW` roster from `crew.ts`. This created a direct module cycle even for callers that only needed metadata.

Move the unchanged static crew member types, metadata and lookup into `crew-members.ts`. Re-export the exact same `CREW` array, lookup and type through the original `crew.ts` public path so existing clients do not change. Atlas now imports the leaf module; `crew.ts` still uses Atlas's schedule functions. No SQL, provider, output text, cron, runtime state or marketing behavior changes.

Regression coverage in `crew-import-boundary.test.ts` checks public identity, registry metadata equality and forbidden cycle edges. Existing `crew.test.ts` and `atlas/registry.test.ts` remain the behavioral tests. CI verification and any other remaining module cycles must be tracked separately; this finding does not claim all R07 cycles have been closed.
