# Admin correction conditions were saved but absent from public fee reads

Issue: #2127 under #978. Inspected base: `866ba11f80f85de255777dccd823b3faa3d54eff`.

A source-checked condition-only correction writes a new published version and a correction
history row. Its raw/verified lineage is intentionally retained. The dollar catalog still
read conditions and source-document ID from that original raw row, and public readers preferred
the original extraction note. The saved correction could therefore remain invisible. Reversing
a correction could also retain the newer source URL/R2 on the replacement published row even
though the recorded evidence document returned to the prior source.

## Change

Migration `20270110000066_published_fee_correction_catalog_overlay.sql` replaces the dollar
view in place. It joins only the exact current correction for that published ID and institution,
uses its condition (including explicit NULL), suppresses the old extraction note, and resolves
source ID/URL/R2 from the correction's evidence document. Ordinary rows follow their prior
expressions. Inconsistent evidence leaves the corrected source ID/link/R2 NULL together,
without exposing another bank's URL or silently falling back to an old copy. Raw/verified
lineage and correction history remain unchanged.

The view's names, order, column types, grants, security-invoker option and public eligibility
gates are preserved. The percentage catalog is unchanged; the correction service still refuses
percentage records. No permissions, controls, provider settings or fee rows are changed.

The Supabase CLI created the new migration stub. Its timestamp was advanced to the next
repository migration sequence after 20270110000065 so it is applied after the existing future
dated migration series. No previously committed migration is edited.

## Input and impact receipts

The source dollar view is migration 20270110000048, SHA256
`20be09c80a90aaca9d20afa6451de42549616c02de6f8121db940d0b331ead3d`.
The read-only production impact query at 2026-10-19 07:23:56 UTC found one current public
correction: correction 1, published fee 153754, Capital City Bank 323. Its conditions would
change and its extraction note would clear; its source ID/URL/R2 already agree. This is an
impact preview, not evidence that the migration has been applied. None of the 947 W43 audited
published IDs has a current correction.

## Verification

The existing loopback-only PostgreSQL correction suite gained a source-grounded regression.
It first failed against the original view: the returned condition remained the original and
the extraction note remained populated. After applying the migration only to an isolated
local PostgreSQL 16 database, the correction and hold suites passed (69 tests).

The regression exercises a condition-only correction; clearing it from a different evidence
document; no stale condition, note or R2 fallback; reversal back to the prior document and
condition; preserved original raw values and correction history; byte-identical unrelated
dollar and percentage rows; and continued refusal of rate corrections.

A direct PostgreSQL metadata comparison before/after the local migration found identical
column names/order/types, grants and view options. The test schema includes this migration so
the existing CI PostgreSQL correction job tests the deployed view definition.

The production privilege receipt at 07:25 UTC confirms every role with catalog SELECT also
has correction-table SELECT. The app configuration uses postgres; production postgres and
service_role have BYPASSRLS. anon and authenticated have neither catalog nor correction
SELECT. The regression creates and removes a local non-superuser BYPASSRLS reader with the
same required table SELECT permissions; it can read the corrected catalog through the
security-invoker view. No production grant or RLS policy is added.

With the locked dependency set, 137 targeted unit tests and 32 PostgreSQL tests (including
the full deterministic state-lane pipeline, Knox reread and peer-list suites) passed. Typecheck,
targeted ESLint, legacy guards and diff whitespace checks passed.

## Apply and rollback boundary

No production migration or data mutation was performed. A production application requires
approval for this exact migration and a fresh read-only impact check, then validation of the
current correction, unrelated rows and public reads/cache refresh. Existing cached application
reads may require the normal cache/index refresh even though this migration writes no fee row.

Before application, retain `pg_get_viewdef('public.published_fee_catalog'::regclass, true)`,
the view options, grants and the approval receipt. For rollback, issue only the previous
dollar `CREATE OR REPLACE VIEW public.published_fee_catalog WITH (security_invoker = true)`
statement from migration 20270110000048. Do not rerun that whole historical migration, drop
the view, alter grants or delete correction history. The old definition restores the prior
conditions/source behavior and therefore restores the known propagation defect.

Current Supabase documentation checked: https://supabase.com/docs/guides/database/tables
(Views link). The changelog index was retrieved on October 19; the listed TLS cipher retirement
does not affect this SQL-only view replacement.

