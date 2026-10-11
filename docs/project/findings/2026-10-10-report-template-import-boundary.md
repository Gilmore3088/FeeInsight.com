# Report templates depend on primitives, not their public barrel

R07 / issue #983. The public index exported template implementations which imported
rendering primitives from that same index, producing a module cycle. Shared exports
now live in `primitives.ts`; all nine internal template modules depend on that leaf.
The public API re-exports the same functions and types. No rendering implementation,
data query, report layout, or fee calculation changed.

Validation: the boundary test asserts exported function identity and prohibits the
old imports. Existing report-template tests remain authoritative for output behavior.
This addresses the report-template cycle only; other reported cycles need separate
review and are not claimed resolved by this extraction.
