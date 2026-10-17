# making-ends-meet: registration snippets

One source, `cfpb-making-ends-meet`, parser version 1 (`MAKING_ENDS_MEET_PARSER_VERSION`), writing
to `area_statistics` through `upsertAreaStats`. No new table, no migration.

| Source | Partitions | Geography | Refresh (set by the step) |
| --- | --- | --- | --- |
| `cfpb-making-ends-meet` | `current` (one standing partition; every wave is re-read and upserted) | nation `US`; region shares as series on the nation; state only if the file has a state variable | 30 days; empty 7 days |

## 1. `src/lib/agents/magellan/registry/index.ts`

Import:

```ts
import { MAKING_ENDS_MEET_PARTITION, MAKING_ENDS_MEET_SOURCE, MAKING_ENDS_MEET_TITLE, runRegistryMakingEndsMeet } from "./making-ends-meet";
```

`REGISTRY_SOURCES` entry:

```ts
  {
    source: MAKING_ENDS_MEET_SOURCE,
    stepKey: "registry-cfpb-making-ends-meet",
    title: MAKING_ENDS_MEET_TITLE,
    fixedPartition: MAKING_ENDS_MEET_PARTITION,
    run: async (input) => {
      const r = await runRegistryMakingEndsMeet({ runId: input.runId, partitionKey: input.partitionKey, dryRun: input.dryRun, db: input.db });
      return {
        summary: r.summary,
        detail: {
          ...r.detail,
          source_url: r.sourceUrl,
          rows: r.rows,
          written_rows: r.writtenRows,
          missing_fields: r.missingFields,
          unexpected_fields: r.unexpectedFields,
          empty: r.empty,
          empty_reason: r.emptyReason,
        },
      };
    },
  },
```

## 2. `src/lib/agents/registry-scheduler.ts`

Import:

```ts
import { MAKING_ENDS_MEET_PARSER_VERSION, MAKING_ENDS_MEET_SOURCE } from "@/lib/agents/magellan/registry/making-ends-meet";
```

`REGISTRY_PARSER_VERSIONS`:

```ts
  [MAKING_ENDS_MEET_SOURCE]: MAKING_ENDS_MEET_PARSER_VERSION,
```

Partitions: the source uses `fixedPartition: "current"`, so nothing goes in
`registryPartitionsBySource`. (If the scheduler needs it listed anyway:
`[MAKING_ENDS_MEET_SOURCE]: makingEndsMeetPartitions(now),`.)

## 3. `src/app/admin/data-feeds-panel.tsx`

```ts
  // FEED_LABELS
  "cfpb-making-ends-meet": "CFPB Making Ends Meet survey (overdraft, bills, savings, alternative credit)",
  // FEED_GROUP_OF
  "cfpb-making-ends-meet": "economy",
```

## 4. `src/lib/agents/magellan/AGENTS.md` versions table

```md
| `MAKING_ENDS_MEET_PARSER_VERSION` | — | v1 (questions found by codebook wording; weight named in the codebook) | `magellan/registry/making-ends-meet.ts` |
```

## 5. Optional URL overrides (no key needed; the file is free)

- `MAKING_ENDS_MEET_DATA_URL`: the public-use CSV or zip (comma-separated for one file per wave).
- `MAKING_ENDS_MEET_CODEBOOK_URL`: the codebook (PDF, xlsx, csv or text).

Unset, the step reads the file links from the CFPB data pages, then tries guessed file names.
If nothing downloads, it records the partition empty with every URL tried and the variable to set.
It does not fail.

## 6. Series written (all unit `percent`, weighted share of respondents; raw_json keeps `respondents`, `positive_respondents`, `weighted_base`, the variables and the weight used)

- Headline shares per wave: `mem_paid_overdraft_fee`, `mem_has_bank_account`, `mem_used_payday_loan`,
  `mem_used_pawn_loan`, `mem_used_auto_title_loan`, `mem_used_other_afs`, `mem_used_any_afs`,
  `mem_difficulty_paying_bills`, `mem_could_cover_emergency_expense`, `mem_has_emergency_savings`,
  `mem_paid_late_fee`.
- Distributions: `mem_credit_score_band_<band>`, and `mem_paid_overdraft_fee_times_<band>` when the
  overdraft question gives count bands.
- Breakouts: `<measure>_by_income_<band>` and `<measure>_by_region_<region>` on geo nation/US; state
  rows (geo_type state) only if the file has a state variable.
- Overdraft payers versus non-payers: `<stress measure>_among_od_payers` and `..._among_od_nonpayers`
  (difficulty paying bills, could cover an emergency expense, emergency savings, payday loan, any
  alternative financial service, late fee, credit score band).
- A share from fewer than 50 respondents carries the note "fewer than 50 respondents"; it is kept.

Aggregates: `src/lib/data-store/making-ends-meet-aggregates.ts`. `getOverdraftShareTrend()` returns
the overdraft share by wave, with the change between waves, by income and by region.
`getOverdraftStressComparison(period?)` returns payers versus non-payers, each share with its count
and the gap in points. `getMakingEndsMeetHeadlines()` returns every headline share by wave.

## 7. What could not be confirmed (consumerfinance.gov was unreachable from the sandbox)

1. **File URLs and formats.** The page URLs and the guessed file names (`..._public-use-file_csv.zip`,
   `..._codebook.pdf`) are not confirmed. The user guide URL is the one James gave. If the release
   is Stata/SAS only, the step records the partition empty and names those files. It does not read them.
2. **Whether the overdraft-fee question is in the public file: NOT confirmed.** The step settles
   it on the first run. The partition detail field `overdraft_question_in_public_file` says yes or no,
   and `overdraft_wording` quotes the codebook. If the answer is no, nothing loads for overdraft and
   the payer/non-payer comparison is empty.
3. **Codebook layout.** Tables (variable / question / value / value label columns) and running text
   (PDF) are both read. In a PDF, an entry starts at the first line that begins with a data column's
   name, and value labels are read from "1 Yes" / "1 = Yes" lines. A PDF laid out differently gives
   few or no entries. `codebook_entries` and `questions` in the detail show how many were read.
4. **Answer codes.** No code is ever assumed. An answer is placed through its codebook label (or the
   data's own text), and a measure whose answers include a label it cannot place as yes/no (or a code
   with no label) is not computed for that wave. `questions_by_wave` names the labels.
5. **Several matches.** When two variables fit one question even after the tie-breaks (12-month
   wording, "checking or savings" and so on), the measure is reported as `ambiguous` with both
   variables named, and nothing is loaded for it. The fix is to tighten the wording test in
   `MEM_MEASURES`, not to pick one by name. The alternative financial services measures are the
   exception: they are a union of every product question that matched.
6. **Weight, wave, income, region, state** are also found by wording. If no single weight is found,
   nothing is computed. If no wave variable is found, a wave year in a file name is used, but only
   when the name says "wave" or "survey". Whether the public file has region or state at all is not
   known. Credit-record-linked fields may be coarsened or missing from the public file.

## 8. Row estimate (an estimate, not a count)

Per wave: about 11 headline shares, 4–8 credit-band and overdraft-count rows, about 11 × (5–8 income
bands + 4 regions) ≈ 100–130 breakout rows, and about 7 × 2 payer/non-payer rows plus the band
splits (≈ 20). That is about 150–180 rows per wave. With 2–4 waves (2019, 2022 and later), expect
**roughly 300–700 rows**, fewer if questions are missing or ambiguous. State rows would add about
11 × 51 per wave, but only if the file has states.
