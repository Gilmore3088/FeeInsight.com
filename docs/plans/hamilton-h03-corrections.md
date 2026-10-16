# Hamilton H03: holding and correcting a published fee

Issue #978, task H03-T02. James settled the four open questions on 2026-10-16:

1. A correction is a new version. The old published value is kept and marked superseded, never
   overwritten. This takes a new table (migration `20270110000053_published_fee_corrections.sql`).
2. Only an admin can correct or reverse. Analysts and admins can both hold and release.
3. A correction needs a reason, the source document, an excerpt from it, and where the excerpt
   sits in the document (page, section or row). A reason alone is not enough.
4. A hold, a release, a correction and a reversal each rebuild Hamilton's national index
   (`fee_index_cache`) straight away.

## The states a published fee can be in

| State | What the customer sees | How it gets there |
|---|---|---|
| Live | The fee, in every page, report and Hamilton answer | Hamilton publishes it, or a correction or reversal publishes it |
| Held | Nothing. The fee is gone, never shown as $0 or "Free" | An operator holds it |
| Superseded | Nothing. A newer version of the same fee is live instead | A correction or reversal replaced it |

Every published row stays in `published_fee_records`. A hold and a supersession both use the
row's quarantine flag (`quarantined_at`), which `published_fee_catalog` already leaves out. The
reason text tells them apart: `admin_hold: ...` for a hold, `admin_correction: superseded by
correction version N (fee #id)` for a supersession. A superseded row is also closed
(`rolled_back_at`, with the same reason), the way Hamilton closes a price it replaced, so agent
checks that look only at open rows never pair it with its new version. Agent restores clear
`rolled_back_at`, never the quarantine, so neither state can be undone by a pipeline step.

## Who may do what, and what each step needs

| Step | Who | Needs | What it writes |
|---|---|---|---|
| Hold | Analyst or admin | A reason (5 to 500 characters) | Quarantine on the row; a `pipeline_feedback` row (`admin.fee_hold`, `admin_hold`); a completed Hamilton run; an index rebuild |
| Release a hold | Analyst or admin | Nothing more; it clears only a hold placed by an operator | Clears the quarantine; a `pipeline_feedback` row (`admin_release`); a run; an index rebuild |
| Correct | Admin only | Fee type (one of the 50), name, amount ($0 to $10,000, two decimals), frequency, conditions (optional), source document, excerpt, location, reason, the version the editor saw | A new live published row; the old row superseded; a version row in `published_fee_corrections`; a `pipeline_feedback` row (`admin.fee_correction`, `admin_correction`); a run; an index rebuild |
| Reverse | Admin only | A reason, the version the editor saw | A new live row with the values the current version replaced; the current row superseded; a version row (`action = 'reverse'`); feedback (`admin_correction_reversed`); a run; an index rebuild |
| Dismiss a conflict | Admin only | A reason | The conflict marked dismissed, with who and why |
| Accept a conflict | Admin only | A correction read from the newer document | The correction as above; the conflict marked accepted and linked to that version |

Each step is one database transaction. If any write fails, nothing is saved. The index rebuild
runs in its own savepoint: if it fails, the action still stands, the run records the failure,
and the next publish run rebuilds the index.

## How a correction is checked

The server checks every field again; the browser's checks are a convenience. Then, against the
source document the admin chose:

- The document belongs to the same institution and has stored text.
- The excerpt is in that stored text (case, spacing and table pipes ignored).
- The category guard (`checkFeeCategory`) accepts the name under the chosen fee type.
- The shared source check (`checkFeeAgainstSource`) finds the fee at the corrected amount on its
  own row of the document, under the fee type's wording. There is no second checker.
- The fee's stored treatment agrees with the amount: a charged fee cannot be corrected to $0,
  and a no-charge fee cannot be given a price. Hold the fee instead.

A fee stated as a rate (a percentage) cannot be corrected here yet.

## Versions, concurrency and repeated submissions

Every version of one fee shares a `fee_chain_id`: the published row the first correction
replaced. Version 0 is that original row. Exactly one version per chain is current.

- **Stale edits.** The form sends the version the editor saw. The server locks the live row
  first. If the row is no longer live (another correction, a hold or an agent took it down) or
  the current version is not the one sent, nothing is written and the editor is asked to reload.
  When two editors submit at once, the first wins and the second is told it is stale.
- **Repeated submissions.** Each opened form carries an idempotency key. A retry with the same
  key returns the first result and writes nothing. The same key used for another fee is refused.

## Reversal

A reversal never deletes anything. It publishes the values the current version replaced as a
new version, and supersedes the current one. Reversing a reversal re-applies the correction.
The reversal records the document those values were read from (the earlier version's evidence,
or the original fee's own document).

## Publishing after a correction (H03-T06 and T07)

The live value is the current version's published row. Hamilton's publish step
(`insertPublishedFee`) checks every new row against current corrections before it writes it
(`correctionBlockFor`, `src/lib/fee-correction-guard.ts`). The match is the logical fee, not a row
id: same institution, same variant, an overlapping audience, and a fee type and name (punctuation
and case ignored) that any version of the chain had, before or after. The live row the step would
replace also counts. Amount and frequency are not part of the match, so a re-read at another
price is caught too.

- **A re-read of the old source, or of the same document.** It is not published. The publish
  result says "Protected by an admin correction".
- **A re-read from a newer document** (fetched after the correction's evidence, with different
  content) that agrees with the correction is not published either; the live value already
  matches it.
- **A re-read from a newer document that disagrees.** It is not published, and it is written to
  `published_fee_correction_conflicts` as an open conflict (once per verified row). The admin
  institution page lists it beside the corrected value. The admin either corrects the fee from
  that document, which accepts the conflict, or dismisses it with a reason. The newer value
  never wins silently, and it is never blocked without a person seeing it.

Before the migration is applied, the publish step skips this check and the admin page shows no
Correct action.

## Where it lives

- Rules shared with the admin page: `src/lib/fee-correction-rules.ts`
- Commands (correct, reverse, dismiss, list): `src/lib/fee-corrections.ts`
- Publish-side check: `src/lib/fee-correction-guard.ts`, called from `src/lib/agents/hamilton/publish.ts`
- Run ledger and index rebuild for every operator fee action: `src/lib/fee-admin-run.ts`
- Hold and release: `src/lib/fee-hold.ts`
- Admin page: `src/app/admin/institution/[id]/` (`fee-table.tsx`, `fee-correction-controls.tsx`, `actions.ts`)

## Not covered yet

- Corrected conditions are kept in the version row, but `published_fee_catalog` still reads
  conditions from the fee's raw lineage, so the public pages show the source's conditions text.
- Future-effective changes (a correction that takes effect on a later date) are not modelled.
- Saved reports and answers made before a correction are not marked superseded (H03-T09).
- The audit history on the admin page shows versions, evidence, who and why, and the run id. It
  does not yet show refresh status per surface (H03-T08, T10).
- An agent check (category guard, source check, rules re-check) can still take down a corrected
  row, the same as any live row. It cannot bring the superseded value back.
